-- Teacher feedback: longer notes, adjustable type, editable board signatures,
-- and reversible visibility. Existing rows and RPC signatures remain valid.
alter function public.display_content(text,jsonb) rename to display_content_before_teacher_feedback;

create function public.display_content(p_kind text, p_content jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare v_result jsonb; v_text text; v_size integer; v_signature text;
begin
  if jsonb_typeof(p_content) is distinct from 'object' then raise exception '显示内容无效'; end if;
  if p_content ? 'hidden' and jsonb_typeof(p_content->'hidden') <> 'boolean' then raise exception '隐藏选项无效'; end if;
  if p_kind = 'note' then
    if jsonb_typeof(p_content->'text') is distinct from 'string' then raise exception '便签内容需要 1–300 字'; end if;
    v_text := btrim(p_content->>'text');
    if char_length(v_text) not between 1 and 300 then raise exception '便签内容需要 1–300 字'; end if;
    if coalesce(p_content->>'color', '') not in ('yellow','blue','green','pink') then raise exception '便签颜色无效'; end if;
    if p_content ? 'font_size' and (jsonb_typeof(p_content->'font_size') <> 'number'
      or (p_content->>'font_size') !~ '^[0-9]+$') then raise exception '便签字号需要 18–48 的整数'; end if;
    if p_content ? 'font_size' then
      if (p_content->>'font_size')::numeric not between 18 and 48 then raise exception '便签字号需要 18–48 的整数'; end if;
      v_size := (p_content->>'font_size')::integer;
    else v_size := 20;
    end if;
    v_result := jsonb_build_object('text', v_text, 'color', p_content->>'color', 'font_size', v_size);
    -- duty is generated only by device_duty_note, never accepted from teacher input.
  else
    v_result := public.display_content_before_teacher_feedback(p_kind, p_content);
    if p_kind = 'board' then
      if p_content ? 'signature' and jsonb_typeof(p_content->'signature') <> 'string' then raise exception '公告署名需要 1–40 字'; end if;
      v_signature := btrim(coalesce(p_content->>'signature', '班主任'));
      if char_length(v_signature) not between 1 and 40 then raise exception '公告署名需要 1–40 字'; end if;
      v_result := v_result || jsonb_build_object('signature', v_signature);
    end if;
  end if;
  if p_content ? 'hidden' then v_result := v_result || jsonb_build_object('hidden', (p_content->>'hidden')::boolean); end if;
  return v_result;
end $$;

-- Hidden items stay in overview/history and retain their original time range.
-- Every supported classroom, including old clients, receives a filtered snapshot.
create or replace function public.device_display_items() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'content', content,
      'starts_at', starts_at, 'ends_at', ends_at, 'teacher_name', teacher_name) order by created_at, id), '[]'::jsonb)
  from public.display_items
  where classroom_id = public.device_classroom() and removed_at is null
    and coalesce(content->'hidden', 'false'::jsonb) <> 'true'::jsonb
    and ends_at + case when kind = 'countdown' then interval '5 seconds' else interval '0 seconds' end > clock_timestamp()
$$;

create function public.set_display_items_hidden(p_ids uuid[], p_hidden boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if p_hidden is null or coalesce(array_length(p_ids, 1), 0) not between 1 and 500 then raise exception '请选择显示内容'; end if;
  update public.display_items set content = jsonb_set(content, '{hidden}', to_jsonb(p_hidden))
    where id = any(p_ids) and removed_at is null and ends_at > clock_timestamp();
  if not found then raise exception '内容已结束或被移除'; end if;
end $$;

alter table public.schedules add column hidden boolean not null default false;
alter table public.schedules add column duties_hidden boolean not null default false;
create function public.set_schedule_visibility(p_classroom text, p_hidden boolean, p_duties_hidden boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if p_hidden is null or p_duties_hidden is null then raise exception '隐藏选项无效'; end if;
  update public.schedules set hidden = p_hidden, duties_hidden = p_duties_hidden, updated_by = auth.uid(), updated_at = clock_timestamp()
    where classroom_id = p_classroom;
  if not found then raise exception '请先保存课表/值日'; end if;
end $$;

create or replace function public.device_schedule() returns jsonb
language sql stable security definer set search_path = '' as $$
  select days from public.schedules where classroom_id = public.device_classroom() and not hidden
$$;

create or replace function public.device_duty_note() returns jsonb
language sql stable security definer set search_path = '' as $$
  with today as (select (clock_timestamp() at time zone 'Asia/Shanghai')::date as day),
  lines as (
    select string_agg((d->>'task') || '：' || (d->'days'->>(extract(isodow from t.day)::int - 1)), E'\n' order by k) as text
    from public.schedules s, today t, jsonb_array_elements(s.duties) with ordinality as x(d, k)
    where s.classroom_id = public.device_classroom() and not s.duties_hidden and extract(isodow from t.day) between 1 and 5
      and d->'days'->>(extract(isodow from t.day)::int - 1) <> ''
  )
  select case when l.text is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
    'id', md5(public.device_classroom() || t.day::text)::uuid, 'kind', 'note',
    'content', jsonb_build_object('text', l.text, 'color', 'green', 'duty', true),
    'starts_at', '2000-01-01T00:00:00Z'::timestamptz, 'ends_at', (t.day + 1)::timestamp at time zone 'Asia/Shanghai',
    'teacher_name', '今日值日')) end
  from lines l, today t
$$;

-- The roster is first in the wire snapshot as well as in the classroom layout.
create or replace function public.display_state() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('server_now', clock_timestamp(), 'items', public.device_duty_note() || public.device_display_items(),
    'schedule', public.device_schedule(), 'birthdays', public.device_birthdays())
$$;
create or replace function public.device_heartbeat(p_connected boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_class text;
begin
  select id into v_class from public.classrooms where device_id = auth.uid();
  if v_class is null then return jsonb_build_object('active', false, 'server_now', clock_timestamp()); end if;
  update public.devices set last_seen_at = clock_timestamp(), connected = p_connected where id = auth.uid();
  return jsonb_build_object('active', true, 'classroom_id', v_class, 'server_now', clock_timestamp(),
    'display', public.device_duty_note() || public.device_display_items(), 'schedule', public.device_schedule(), 'birthdays', public.device_birthdays());
end $$;

revoke execute on function public.display_content(text,jsonb), public.display_content_before_teacher_feedback(text,jsonb),
  public.set_display_items_hidden(uuid[],boolean), public.set_schedule_visibility(text,boolean,boolean) from public, anon;
grant execute on function public.display_content(text,jsonb) to service_role;
grant execute on function public.set_display_items_hidden(uuid[],boolean), public.set_schedule_visibility(text,boolean,boolean) to authenticated, service_role;

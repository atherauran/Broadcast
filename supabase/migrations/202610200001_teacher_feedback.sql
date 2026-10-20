-- Teacher feedback: longer notes with a font size, a distinct duty roster, and a per-class switch that clears the classroom desktop.

-- Notes take up to 300 characters and an optional integer font_size of 18–28 (stored as 20 when omitted).
create or replace function public.display_content(p_kind text, p_content jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare v_title text; v_entries jsonb; v_text text;
begin
  if jsonb_typeof(p_content) is distinct from 'object' then raise exception '显示内容无效'; end if;
  if p_kind = 'board' then
    v_title := btrim(coalesce(p_content->>'title', ''));
    if v_title = '' then v_title := '公告'; end if;
    if char_length(v_title) > 30 then raise exception '标题最多 30 字'; end if;
    if jsonb_typeof(p_content->'entries') is distinct from 'array' then raise exception '请填写公告内容'; end if;
    select jsonb_agg(btrim(e) order by n) into v_entries
      from jsonb_array_elements_text(p_content->'entries') with ordinality as t(e, n) where btrim(e) <> '';
    if coalesce(jsonb_array_length(v_entries), 0) not between 1 and 12 then raise exception '公告需要 1–12 条'; end if;
    if exists(select 1 from jsonb_array_elements_text(v_entries) e where char_length(e) > 300) then raise exception '每条公告最多 300 字'; end if;
    if jsonb_typeof(p_content->'speak') is distinct from 'boolean' then raise exception '请选择是否朗读'; end if;
    if jsonb_typeof(p_content->'voice_type') is distinct from 'number'
      or (p_content->>'voice_type') not in ('101001','101004','101011','101013','101016') then raise exception '音色无效'; end if;
    if coalesce(p_content->>'theme', 'plain') not in ('plain','festive','joyful','fresh','tech','safety') then raise exception '公告背景无效'; end if;
    if jsonb_typeof(coalesce(p_content->'flag', 'false')) <> 'boolean' then raise exception '升旗选项无效'; end if;
    return jsonb_build_object('title', v_title, 'entries', v_entries, 'speak', (p_content->'speak')::boolean,
      'voice_type', (p_content->>'voice_type')::int, 'theme', coalesce(p_content->>'theme', 'plain'),
      'flag', coalesce((p_content->'flag')::boolean, false));
  elsif p_kind = 'note' then
    v_text := btrim(coalesce(p_content->>'text', ''));
    if char_length(v_text) not between 1 and 300 then raise exception '便签内容需要 1–300 字'; end if;
    if coalesce(p_content->>'color', '') not in ('yellow','blue','green','pink') then raise exception '便签颜色无效'; end if;
    if p_content ? 'font_size' and (jsonb_typeof(p_content->'font_size') <> 'number' or (p_content->>'font_size') !~ '^[0-9]+$'
      or (p_content->>'font_size')::numeric not between 18 and 28) then raise exception '便签字号需要 18–28'; end if;
    return jsonb_build_object('text', v_text, 'color', p_content->>'color', 'font_size', coalesce((p_content->>'font_size')::int, 20));
  elsif p_kind = 'countdown' then
    v_text := btrim(coalesce(p_content->>'label', ''));
    if char_length(v_text) > 20 then raise exception '倒计时名称最多 20 字'; end if;
    if jsonb_typeof(coalesce(p_content->'fullscreen', 'false')) <> 'boolean' then raise exception '倒计时显示方式无效'; end if;
    if p_content ? 'date' then
      if jsonb_typeof(p_content->'date') is distinct from 'string' or char_length(p_content->>'date') <> 10 then raise exception '日期无效'; end if;
      if coalesce((p_content->'fullscreen')::boolean, false) then raise exception '倒数日不能全屏显示'; end if;
      return jsonb_build_object('label', v_text, 'fullscreen', false, 'date', (p_content->>'date')::date::text);
    end if;
    return jsonb_build_object('label', v_text, 'fullscreen', coalesce((p_content->'fullscreen')::boolean, false));
  end if;
  raise exception '显示类型无效';
end $$;

-- The duty roster note is marked so the classroom can draw it as its own card.
create or replace function public.device_duty_note() returns jsonb
language sql stable security definer set search_path = '' as $$
  with today as (select (clock_timestamp() at time zone 'Asia/Shanghai')::date as day),
  lines as (
    select string_agg((d->>'task') || '：' || (d->'days'->>(extract(isodow from t.day)::int - 1)), E'\n' order by k) as text
    from public.schedules s, today t, jsonb_array_elements(s.duties) with ordinality as x(d, k)
    where s.classroom_id = public.device_classroom() and extract(isodow from t.day) between 1 and 5
      and d->'days'->>(extract(isodow from t.day)::int - 1) <> ''
  )
  select case when l.text is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
    'id', md5(public.device_classroom() || t.day::text)::uuid, 'kind', 'note',
    'content', jsonb_build_object('text', l.text, 'color', 'green', 'duty', true),
    'starts_at', '2000-01-01T00:00:00Z'::timestamptz, 'ends_at', (t.day + 1)::timestamp at time zone 'Asia/Shanghai',
    'teacher_name', '今日值日')) end
  from lines l, today t
$$;

-- While screen_hidden is set the class's desktop shows nothing: no items, timetable, duties or birthdays.
-- Fullscreen alerts and banners still arrive. Older classroom apps need no update, since the server sends them an empty screen.
alter table public.classrooms add column screen_hidden boolean not null default false;

create function public.set_screen_hidden(p_classroom text, p_hidden boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if p_hidden is null then raise exception '隐藏选项无效'; end if;
  update public.classrooms set screen_hidden = p_hidden where id = p_classroom;
  if not found then raise exception '班级无效'; end if;
end $$;

-- What the device's desktop shows; null for an unbound device.
create function public.device_screen() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when c.screen_hidden then jsonb_build_object('items', '[]'::jsonb, 'schedule', null, 'birthdays', null)
    else jsonb_build_object('items', public.device_duty_note() || public.device_display_items(),
      'schedule', public.device_schedule(), 'birthdays', public.device_birthdays()) end
  from public.classrooms c where c.id = public.device_classroom()
$$;

create or replace function public.display_state() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('server_now', clock_timestamp(), 'items', '[]'::jsonb, 'schedule', null, 'birthdays', null)
    || coalesce(public.device_screen(), '{}'::jsonb)
$$;

create or replace function public.device_heartbeat(p_connected boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_class text; v_screen jsonb;
begin
  select id into v_class from public.classrooms where device_id = auth.uid();
  if v_class is null then return jsonb_build_object('active', false, 'server_now', clock_timestamp()); end if;
  update public.devices set last_seen_at = clock_timestamp(), connected = p_connected where id = auth.uid();
  v_screen := public.device_screen();
  return jsonb_build_object('active', true, 'classroom_id', v_class, 'server_now', clock_timestamp(),
    'display', v_screen->'items', 'schedule', v_screen->'schedule', 'birthdays', v_screen->'birthdays');
end $$;

create or replace function public.classroom_status() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  return jsonb_build_object('server_now', clock_timestamp(), 'classrooms', (
    select jsonb_agg(jsonb_build_object('id', c.id, 'device_id', c.device_id, 'device_name', d.name,
      'last_seen_at', d.last_seen_at, 'screen_hidden', c.screen_hidden,
      'connected', coalesce(d.connected and d.last_seen_at > clock_timestamp() - interval '270 seconds', false)) order by c.id)
    from public.classrooms c left join public.devices d on d.id = c.device_id
  ));
end $$;

revoke execute on function public.set_screen_hidden(text,boolean), public.device_screen() from public, anon;
grant execute on function public.set_screen_hidden(text,boolean) to authenticated, service_role;
grant execute on function public.device_screen() to service_role;

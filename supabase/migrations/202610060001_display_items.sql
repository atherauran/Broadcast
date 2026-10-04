-- State styles: the server holds what each classroom should show; devices reconcile on heartbeat and on change.
create table public.display_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  classroom_id text not null references public.classrooms(id),
  kind text not null check (kind in ('board','note','countdown')),
  content jsonb not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  teacher_name text not null check (char_length(btrim(teacher_name)) between 1 and 40),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  removed_at timestamptz,
  check (ends_at > starts_at),
  unique (request_id, classroom_id)
);
create index display_items_live_idx on public.display_items(classroom_id, ends_at) where removed_at is null;

alter table public.display_items enable row level security;
-- Removed rows stay readable so Realtime still delivers the removal to the classroom.
create policy read_display_items on public.display_items for select to authenticated
  using (public.is_admin() or classroom_id = public.device_classroom());

create function public.display_content(p_kind text, p_content jsonb) returns jsonb
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
    if exists(select 1 from jsonb_array_elements_text(v_entries) e where char_length(e) > 100) then raise exception '每条公告最多 100 字'; end if;
    if jsonb_typeof(p_content->'speak') is distinct from 'boolean' then raise exception '请选择是否朗读'; end if;
    if jsonb_typeof(p_content->'voice_type') is distinct from 'number'
      or (p_content->>'voice_type') not in ('101001','101004','101011','101013','101016') then raise exception '音色无效'; end if;
    return jsonb_build_object('title', v_title, 'entries', v_entries, 'speak', (p_content->'speak')::boolean,
      'voice_type', (p_content->>'voice_type')::int);
  elsif p_kind = 'note' then
    v_text := btrim(coalesce(p_content->>'text', ''));
    if char_length(v_text) not between 1 and 60 then raise exception '便签内容需要 1–60 字'; end if;
    if coalesce(p_content->>'color', '') not in ('yellow','blue','green','pink') then raise exception '便签颜色无效'; end if;
    return jsonb_build_object('text', v_text, 'color', p_content->>'color');
  elsif p_kind = 'countdown' then
    v_text := btrim(coalesce(p_content->>'label', ''));
    if char_length(v_text) > 20 then raise exception '倒计时名称最多 20 字'; end if;
    return jsonb_build_object('label', v_text);
  end if;
  raise exception '显示类型无效';
end $$;

create function public.create_display_item(p_request uuid, p_kind text, p_classrooms text[], p_content jsonb, p_teacher_name text,
  p_starts_at timestamptz default null, p_ends_at timestamptz default null, p_duration_seconds integer default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp(); v_start timestamptz; v_end timestamptz; v_content jsonb; v_count int; v_full text;
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if coalesce(array_length(p_classrooms, 1), 0) not between 1 and 6 then raise exception '请选择班级'; end if;
  select count(distinct id) into v_count from public.classrooms where id = any(p_classrooms);
  if v_count <> array_length(p_classrooms, 1) then raise exception '班级列表无效'; end if;
  if char_length(btrim(coalesce(p_teacher_name, ''))) not between 1 and 40 then raise exception '老师姓名无效'; end if;
  v_content := public.display_content(p_kind, p_content);
  v_start := coalesce(p_starts_at, v_now);
  if v_start < v_now - interval '1 minute' or v_start > v_now + interval '7 days' then raise exception '显示时间无效'; end if;
  if p_kind = 'countdown' and p_duration_seconds is not null then
    if p_duration_seconds not between 60 and 43200 then raise exception '倒计时需在 1 分钟到 12 小时之间'; end if;
    v_end := v_start + make_interval(secs => p_duration_seconds);
  else
    v_end := p_ends_at;
  end if;
  if v_end is null or v_end <= greatest(v_start, v_now) or v_end > v_now + interval '7 days' then raise exception '结束时间无效'; end if;
  if p_kind = 'countdown' and v_end > greatest(v_start, v_now) + interval '12 hours' then raise exception '倒计时需在 1 分钟到 12 小时之间'; end if;

  -- Same order as bind_device, so concurrent writers serialize without deadlocks.
  perform id from public.classrooms where id = any(p_classrooms) order by id for update;
  if exists(select 1 from public.display_items where request_id = p_request) then
    if not exists(select 1 from public.display_items where request_id = p_request and kind = p_kind and content = v_content
      and created_by = auth.uid()) then
      raise exception '请求编号冲突';
    end if;
    return p_request;
  end if;
  if p_kind = 'note' then
    select string_agg(c, '、' order by c) into v_full from unnest(p_classrooms) c
      where (select count(*) from public.display_items i where i.classroom_id = c and i.kind = 'note' and i.removed_at is null
        and i.starts_at < v_end and i.ends_at > greatest(v_start, v_now)) >= 4;
    if v_full is not null then raise exception '% 已有 4 张便签，请先移除一张', v_full; end if;
  elsif p_kind = 'countdown' then
    update public.display_items set removed_at = v_now
      where kind = 'countdown' and removed_at is null and ends_at > v_now and classroom_id = any(p_classrooms);
  end if;
  insert into public.display_items(request_id, classroom_id, kind, content, starts_at, ends_at, teacher_name, created_by)
    select p_request, c, p_kind, v_content, v_start, v_end, btrim(p_teacher_name), auth.uid() from unnest(p_classrooms) c;
  return p_request;
end $$;

create function public.remove_display_item(p_id uuid, p_all boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  update public.display_items set removed_at = clock_timestamp()
    where removed_at is null and (id = p_id or (p_all and request_id = (select request_id from public.display_items where id = p_id)));
end $$;

create function public.display_overview() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  return jsonb_build_object('server_now', clock_timestamp(), 'items', coalesce((
    select jsonb_agg(to_jsonb(i) - 'created_by' - 'removed_at' order by i.classroom_id, i.starts_at, i.created_at)
    from public.display_items i where i.removed_at is null and i.ends_at > clock_timestamp()
  ), '[]'::jsonb));
end $$;

-- A countdown stays 5 seconds past zero so the classroom sees it finish.
create function public.device_display_items() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'content', content, 'starts_at', starts_at,
      'ends_at', ends_at, 'teacher_name', teacher_name) order by created_at, id), '[]'::jsonb)
  from public.display_items
  where classroom_id = public.device_classroom() and removed_at is null
    and ends_at + case when kind = 'countdown' then interval '5 seconds' else interval '0 seconds' end > clock_timestamp()
$$;

create function public.display_state() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('server_now', clock_timestamp(), 'items', public.device_display_items())
$$;

-- The status heartbeat also carries the display state, so periodic reconciliation costs no extra request.
create or replace function public.device_heartbeat(p_connected boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_class text;
begin
  select id into v_class from public.classrooms where device_id = auth.uid();
  if v_class is null then return jsonb_build_object('active', false, 'server_now', clock_timestamp()); end if;
  update public.devices set last_seen_at = clock_timestamp(), connected = p_connected where id = auth.uid();
  return jsonb_build_object('active', true, 'classroom_id', v_class, 'server_now', clock_timestamp(),
    'display', public.device_display_items());
end $$;

revoke all on public.display_items from anon, authenticated;
grant select on public.display_items to authenticated;
grant all on public.display_items to service_role;
revoke execute on function public.display_content(text,jsonb), public.device_display_items(),
  public.create_display_item(uuid,text,text[],jsonb,text,timestamptz,timestamptz,integer), public.remove_display_item(uuid,boolean),
  public.display_overview(), public.display_state() from public, anon;
grant execute on function public.create_display_item(uuid,text,text[],jsonb,text,timestamptz,timestamptz,integer),
  public.remove_display_item(uuid,boolean), public.display_overview(), public.display_state() to authenticated;
grant execute on all functions in schema public to service_role;

alter publication supabase_realtime add table public.display_items;

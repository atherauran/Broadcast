-- Each class has one weekly timetable (Monday to Friday) that its classroom shows on the right of the screen,
-- and a board can pick a background theme.
create table public.schedules (
  classroom_id text primary key references public.classrooms(id),
  days jsonb not null,
  teacher_name text not null check (char_length(btrim(teacher_name)) between 1 and 40),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.schedules enable row level security;
create policy read_schedules on public.schedules for select to authenticated
  using (public.is_admin() or classroom_id = public.device_classroom());

-- p_days holds five arrays (Monday first) of up to 12 subject ids each.
create function public.set_schedule(p_classroom text, p_days jsonb, p_teacher_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if not exists(select 1 from public.classrooms where id = p_classroom) then raise exception '班级无效'; end if;
  if char_length(btrim(coalesce(p_teacher_name, ''))) not between 1 and 40 then raise exception '老师姓名无效'; end if;
  if jsonb_typeof(p_days) is distinct from 'array' or jsonb_array_length(p_days) <> 5
    or exists(select 1 from jsonb_array_elements(p_days) d
      where case when jsonb_typeof(d) = 'array' then jsonb_array_length(d) > 12 else true end) then
    raise exception '课程表格式无效';
  end if;
  if exists(select 1 from jsonb_array_elements(p_days) d, jsonb_array_elements(d) s
    where case when jsonb_typeof(s) = 'string' then s #>> '{}' not in ('english','chinese','math','physics','biology','chemistry',
      'history','pe','morality','art','elective','club','lunch') else true end) then
    raise exception '课程无效';
  end if;
  insert into public.schedules(classroom_id, days, teacher_name, updated_by, updated_at)
    values (p_classroom, p_days, btrim(p_teacher_name), auth.uid(), clock_timestamp())
    on conflict (classroom_id) do update set days = excluded.days, teacher_name = excluded.teacher_name,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end $$;

create function public.device_schedule() returns jsonb
language sql stable security definer set search_path = '' as $$
  select days from public.schedules where classroom_id = public.device_classroom()
$$;

create or replace function public.display_state() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('server_now', clock_timestamp(), 'items', public.device_display_items(), 'schedule', public.device_schedule())
$$;

create or replace function public.device_heartbeat(p_connected boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_class text;
begin
  select id into v_class from public.classrooms where device_id = auth.uid();
  if v_class is null then return jsonb_build_object('active', false, 'server_now', clock_timestamp()); end if;
  update public.devices set last_seen_at = clock_timestamp(), connected = p_connected where id = auth.uid();
  return jsonb_build_object('active', true, 'classroom_id', v_class, 'server_now', clock_timestamp(),
    'display', public.device_display_items(), 'schedule', public.device_schedule());
end $$;

-- Boards gain an optional theme; pages that omit it get the plain white background.
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
    return jsonb_build_object('title', v_title, 'entries', v_entries, 'speak', (p_content->'speak')::boolean,
      'voice_type', (p_content->>'voice_type')::int, 'theme', coalesce(p_content->>'theme', 'plain'));
  elsif p_kind = 'note' then
    v_text := btrim(coalesce(p_content->>'text', ''));
    if char_length(v_text) not between 1 and 60 then raise exception '便签内容需要 1–60 字'; end if;
    if coalesce(p_content->>'color', '') not in ('yellow','blue','green','pink') then raise exception '便签颜色无效'; end if;
    return jsonb_build_object('text', v_text, 'color', p_content->>'color');
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

revoke all on public.schedules from anon, authenticated;
grant select on public.schedules to authenticated;
grant all on public.schedules to service_role;
revoke execute on function public.set_schedule(text,jsonb,text), public.device_schedule() from public, anon;
grant execute on function public.set_schedule(text,jsonb,text) to authenticated;
grant execute on function public.set_schedule(text,jsonb,text), public.device_schedule() to service_role;

alter publication supabase_realtime add table public.schedules;

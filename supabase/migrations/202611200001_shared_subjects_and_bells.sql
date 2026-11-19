-- Subjects are one shared list: any verified teacher can add one, and every class's timetable picks from it.
-- A custom subject's id is its own name, so a classroom app that has not been updated still shows the name.
-- A rest subject (lunch, a long break) takes no lesson number and is timed by the lessons around it.
create table public.subjects (
  n bigint generated always as identity,
  id text primary key check (char_length(id) between 1 and 20),
  label text not null,
  rest boolean not null default false,
  builtin boolean not null default false,
  created_by uuid references auth.users(id)
);
create unique index subjects_lower_id on public.subjects (lower(id));
insert into public.subjects(id, label, rest, builtin) values
  ('english', '英语 English', false, true), ('chinese', '语文 Chinese', false, true), ('math', '数学 Math', false, true),
  ('physics', '物理 Physics', false, true), ('biology', '生物 Biology', false, true), ('chemistry', '化学 Chemistry', false, true),
  ('history', '历史 History', false, true), ('pe', '体育 PE', false, true), ('morality', '道德与法治', false, true),
  ('art', '艺术 Art/Music', false, true), ('it', '信息科技 IT', false, true), ('elective', '选修 Optional', false, true),
  ('club', '社团 Club', false, true), ('lunch', '午餐 Lunch', true, true);

-- The whole grade's lesson times: for each weekday (Monday first) the "HH:mm-HH:mm" of lesson 1, 2, 3 and so on, rest rows not counted.
-- A rest row shows the gap between the lessons around it.
-- The seed is the school's current bell, with Wednesday's last lesson five minutes earlier.
create table public.lesson_bells (
  only_row boolean primary key default true check (only_row),
  days jsonb not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.lesson_bells(days) values (jsonb_build_array(
  jsonb_build_array('08:30-09:10','09:25-10:05','10:20-11:00','11:15-11:50','12:40-13:20','13:35-14:15','14:30-15:10','15:25-16:05','16:20-17:00'),
  jsonb_build_array('08:30-09:10','09:25-10:05','10:20-11:00','11:15-11:50','12:40-13:20','13:35-14:15','14:30-15:10','15:25-16:05','16:20-17:00'),
  jsonb_build_array('08:30-09:10','09:25-10:05','10:20-11:00','11:15-11:50','12:40-13:20','13:35-14:15','14:30-15:10','15:25-16:05','16:15-16:55'),
  jsonb_build_array('08:30-09:10','09:25-10:05','10:20-11:00','11:15-11:50','12:40-13:20','13:35-14:15','14:30-15:10','15:25-16:05','16:20-17:00'),
  jsonb_build_array('08:30-09:10','09:25-10:05','10:20-11:00','11:15-11:50','12:40-13:20','13:35-14:15','14:30-15:10','15:25-16:05','16:20-17:00')));

alter table public.subjects enable row level security;
alter table public.lesson_bells enable row level security;
create policy read_subjects on public.subjects for select to authenticated using (true);
create policy read_lesson_bells on public.lesson_bells for select to authenticated using (true);

create function public.add_subject(p_label text, p_rest boolean default false) returns text
language plpgsql security definer set search_path = '' as $$
declare v_label text := regexp_replace(btrim(coalesce(p_label, '')), '\s+', ' ', 'g');
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if char_length(v_label) not between 1 and 12 then raise exception '课程名需要 1–12 字'; end if;
  if p_rest is null then raise exception '休息选项无效'; end if;
  if exists(select 1 from public.subjects where lower(id) = lower(v_label) or lower(label) = lower(v_label)) then raise exception '已有这门课'; end if;
  insert into public.subjects(id, label, rest, created_by) values (v_label, v_label, p_rest, auth.uid());
  return v_label;
end $$;

-- Only a custom subject no class uses can go, so a timetable never points at a missing one.
create function public.delete_subject(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if exists(select 1 from public.schedules s, jsonb_array_elements(s.days) d, jsonb_array_elements_text(d) e where e = p_id) then
    raise exception '有班级正在使用这门课';
  end if;
  delete from public.subjects where id = p_id and not builtin;
  if not found then raise exception '课程无法删除'; end if;
end $$;

create function public.set_lesson_bells(p_days jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if jsonb_typeof(p_days) is distinct from 'array' or jsonb_array_length(p_days) <> 5
    or exists(select 1 from jsonb_array_elements(p_days) d
      where case when jsonb_typeof(d) = 'array' then jsonb_array_length(d) > 12 else true end) then
    raise exception '作息表格式无效';
  end if;
  if exists(select 1 from jsonb_array_elements(p_days) d, jsonb_array_elements(d) s
    where jsonb_typeof(s) <> 'string' or (s #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$') then
    raise exception '时间格式无效';
  end if;
  -- Each lesson starts before it ends and after the previous one has ended.
  if exists(select 1 from jsonb_array_elements(p_days) d, jsonb_array_elements_text(d) with ordinality as t(s, k)
    where substr(s, 1, 5) >= substr(s, 7, 5) or (k > 1 and substr(s, 1, 5) < substr(d->>(k::int - 2), 7, 5))) then
    raise exception '时间需按先后排列且不重叠';
  end if;
  update public.lesson_bells set days = p_days, updated_by = auth.uid(), updated_at = clock_timestamp();
end $$;

-- Subjects now come from the shared list; the rest of the function is unchanged.
create or replace function public.set_schedule_unchecked(p_classroom text, p_days jsonb, p_teacher_name text, p_duties jsonb default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_duties jsonb;
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
    where case when jsonb_typeof(s) = 'string' then not exists(select 1 from public.subjects where id = s #>> '{}') else true end) then
    raise exception '课程无效';
  end if;
  if p_duties is not null then
    if jsonb_typeof(p_duties) <> 'array' or jsonb_array_length(p_duties) > 8 or exists(select 1 from jsonb_array_elements(p_duties) d
      where jsonb_typeof(d) <> 'object' or jsonb_typeof(d->'days') is distinct from 'array' or jsonb_array_length(d->'days') <> 5
        or exists(select 1 from jsonb_array_elements(d->'days') n where jsonb_typeof(n) <> 'string')) then
      raise exception '值日表格式无效';
    end if;
    if exists(select 1 from jsonb_array_elements(p_duties) d where char_length(btrim(coalesce(d->>'task', ''))) not between 1 and 10) then
      raise exception '值日任务需要 1–10 字';
    end if;
    if exists(select 1 from jsonb_array_elements(p_duties) d, jsonb_array_elements_text(d->'days') n where char_length(btrim(n)) > 40) then
      raise exception '值日生姓名最多 40 字';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('task', btrim(d->>'task'),
        'days', (select jsonb_agg(btrim(n) order by m) from jsonb_array_elements_text(d->'days') with ordinality as x(n, m))) order by k), '[]')
      into v_duties from jsonb_array_elements(p_duties) with ordinality as t(d, k);
  end if;
  insert into public.schedules as s(classroom_id, days, duties, teacher_name, updated_by, updated_at)
    values (p_classroom, p_days, coalesce(v_duties, '[]'), btrim(p_teacher_name), auth.uid(), clock_timestamp())
    on conflict (classroom_id) do update set days = excluded.days, duties = coalesce(v_duties, s.duties),
      teacher_name = excluded.teacher_name, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end $$;

-- A device that shows a timetable also gets the names and lesson times to draw it with; older apps ignore this key.
create function public.device_catalog() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('subjects', (select jsonb_object_agg(id, jsonb_build_object('label', label, 'rest', rest)) from public.subjects),
    'bells', (select days from public.lesson_bells))
$$;

create or replace function public.device_screen() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when c.screen_hidden then jsonb_build_object('items', '[]'::jsonb, 'schedule', null, 'catalog', null, 'birthdays', null)
    else jsonb_build_object('items', public.device_duty_note() || public.device_display_items(),
      'schedule', case when c.schedule_hidden then null else public.device_schedule() end,
      'catalog', case when c.schedule_hidden then null else public.device_catalog() end, 'birthdays', public.device_birthdays()) end
  from public.classrooms c where c.id = public.device_classroom()
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
    'display', v_screen->'items', 'schedule', v_screen->'schedule', 'catalog', v_screen->'catalog', 'birthdays', v_screen->'birthdays');
end $$;

revoke all on public.subjects, public.lesson_bells from anon, authenticated;
grant select on public.subjects, public.lesson_bells to authenticated;
grant all on public.subjects, public.lesson_bells to service_role;
revoke execute on function public.add_subject(text,boolean), public.delete_subject(text), public.set_lesson_bells(jsonb), public.device_catalog() from public, anon;
grant execute on function public.add_subject(text,boolean), public.delete_subject(text), public.set_lesson_bells(jsonb) to authenticated, service_role;
grant execute on function public.device_catalog() to service_role;

-- Devices watch both tables so a new subject or a changed bell redraws the timetable.
alter publication supabase_realtime add table public.subjects, public.lesson_bells;

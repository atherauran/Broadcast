-- Each class keeps a list of student birthdays; its classroom greets them on the day (weekend birthdays on Friday).
-- students is an array of {name, date} with date as "MM-DD", so no birth year is stored.
create table public.birthdays (
  classroom_id text primary key references public.classrooms(id),
  students jsonb not null,
  teacher_name text not null check (char_length(btrim(teacher_name)) between 1 and 40),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.birthdays enable row level security;
create policy read_birthdays on public.birthdays for select to authenticated
  using (public.is_admin() or classroom_id = public.device_classroom());

create function public.set_birthdays(p_classroom text, p_students jsonb, p_teacher_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_students jsonb;
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if not exists(select 1 from public.classrooms where id = p_classroom) then raise exception '班级无效'; end if;
  if char_length(btrim(coalesce(p_teacher_name, ''))) not between 1 and 40 then raise exception '老师姓名无效'; end if;
  if jsonb_typeof(p_students) is distinct from 'array' or jsonb_array_length(p_students) > 80 then raise exception '生日名单格式无效'; end if;
  if exists(select 1 from jsonb_array_elements(p_students) s
    where jsonb_typeof(s) <> 'object' or char_length(btrim(coalesce(s->>'name', ''))) not between 1 and 40) then
    raise exception '学生姓名需要 1–40 字';
  end if;
  -- Days are checked against the months of 2000, a leap year, so 02-29 is accepted.
  if exists(select 1 from jsonb_array_elements(p_students) s
    where case when coalesce(s->>'date', '') !~ '^\d{2}-\d{2}$' or substr(s->>'date', 1, 2)::int not between 1 and 12 then true
      else substr(s->>'date', 4, 2)::int not between 1 and
        extract(day from make_date(2000, substr(s->>'date', 1, 2)::int, 1) + interval '1 month - 1 day')::int end) then
    raise exception '生日日期无效';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('name', btrim(s->>'name'), 'date', s->>'date') order by n), '[]') into v_students
    from jsonb_array_elements(p_students) with ordinality as t(s, n);
  insert into public.birthdays(classroom_id, students, teacher_name, updated_by, updated_at)
    values (p_classroom, v_students, btrim(p_teacher_name), auth.uid(), clock_timestamp())
    on conflict (classroom_id) do update set students = excluded.students, teacher_name = excluded.teacher_name,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end $$;

create function public.device_birthdays() returns jsonb
language sql stable security definer set search_path = '' as $$
  select students from public.birthdays where classroom_id = public.device_classroom()
$$;

create or replace function public.display_state() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('server_now', clock_timestamp(), 'items', public.device_display_items(), 'schedule', public.device_schedule(),
    'birthdays', public.device_birthdays())
$$;

create or replace function public.device_heartbeat(p_connected boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_class text;
begin
  select id into v_class from public.classrooms where device_id = auth.uid();
  if v_class is null then return jsonb_build_object('active', false, 'server_now', clock_timestamp()); end if;
  update public.devices set last_seen_at = clock_timestamp(), connected = p_connected where id = auth.uid();
  return jsonb_build_object('active', true, 'classroom_id', v_class, 'server_now', clock_timestamp(),
    'display', public.device_display_items(), 'schedule', public.device_schedule(), 'birthdays', public.device_birthdays());
end $$;

revoke all on public.birthdays from anon, authenticated;
grant select on public.birthdays to authenticated;
grant all on public.birthdays to service_role;
revoke execute on function public.set_birthdays(text,jsonb,text), public.device_birthdays() from public, anon;
grant execute on function public.set_birthdays(text,jsonb,text) to authenticated;
grant execute on function public.set_birthdays(text,jsonb,text), public.device_birthdays() to service_role;

alter publication supabase_realtime add table public.birthdays;

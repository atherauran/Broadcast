-- Homeroom teachers. Each class may list its homeroom teacher and the names they sign with (rows are entered by hand, not in
-- this public repository). The teacher claims the class by setting a password (Edge Function `claim-homeroom`), which creates
-- their own admin account and stores it in user_id. Once claimed, only that account and the maintainer may clear the class's
-- screen or edit its timetable, duties and birthdays; an unclaimed class stays open to every teacher, as before.
-- The homeroom teacher may also pause broadcasts to the class for a time range, which other teachers' broadcasts then skip.
create table public.homerooms (
  classroom_id text primary key references public.classrooms(id),
  teacher_name text not null check (char_length(btrim(teacher_name)) between 1 and 40),
  aliases text[] not null default '{}',
  user_id uuid unique references auth.users(id) on delete set null,
  claimed_at timestamptz
);
-- No policies: clients learn about homerooms only through the functions below.
alter table public.homerooms enable row level security;

alter table public.classrooms add column mute_from timestamptz, add column mute_until timestamptz,
  add constraint classrooms_mute_check check ((mute_from is null) = (mute_until is null) and mute_until > mute_from);

-- Names match ignoring case, spaces and dots, so "Ms.Tong" is "Ms. Tong".
create function public.name_key(p_name text) returns text language sql immutable set search_path = '' as $$
  select lower(regexp_replace(coalesce(p_name, ''), '[[:space:].·。]', '', 'g'))
$$;

-- The class whose homeroom teacher signs with this name: the login page uses it to find the teacher's own account.
create function public.homeroom_for_name(p_name text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('classroom_id', h.classroom_id, 'claimed', h.user_id is not null) from public.homerooms h
  where public.name_key(p_name) <> '' and public.name_key(p_name) in (select public.name_key(n) from unnest(h.aliases || h.teacher_name) n)
  order by h.classroom_id limit 1
$$;

-- The class's own homeroom account, or the maintainer.
create function public.is_homeroom(p_classroom text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_maintainer() or exists(select 1 from public.homerooms where classroom_id = p_classroom and user_id = auth.uid())
$$;

-- Who may clear the screen and edit class data: anyone while the class is unclaimed, then only its homeroom account.
create function public.can_manage(p_classroom text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() and (public.is_homeroom(p_classroom)
    or not exists(select 1 from public.homerooms where classroom_id = p_classroom and user_id is not null))
$$;

create or replace function public.set_screen_hidden(p_classroom text, p_hidden boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if not public.can_manage(p_classroom) then raise exception '只有 % 班主任可以操作', p_classroom; end if;
  if p_hidden is null then raise exception '隐藏选项无效'; end if;
  update public.classrooms set screen_hidden = p_hidden where id = p_classroom;
  if not found then raise exception '班级无效'; end if;
end $$;

-- A null p_until lifts the pause; a null p_from starts it now.
create function public.set_broadcast_mute(p_classroom text, p_from timestamptz, p_until timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare v_from timestamptz := coalesce(p_from, clock_timestamp());
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if not public.is_homeroom(p_classroom) then raise exception '只有 % 班主任可以操作', p_classroom; end if;
  if p_until is not null and (p_until <= v_from or p_until <= clock_timestamp() or p_until > clock_timestamp() + interval '400 days') then
    raise exception '暂停时间无效';
  end if;
  update public.classrooms set mute_from = case when p_until is null then null else v_from end, mute_until = p_until where id = p_classroom;
  if not found then raise exception '班级无效'; end if;
end $$;

-- The checks below wrap the existing functions, which keep their validation and become internal.
alter function public.set_schedule(text,jsonb,text,jsonb) rename to set_schedule_unchecked;
alter function public.set_birthdays(text,jsonb,text) rename to set_birthdays_unchecked;
alter function public.create_broadcast(uuid,text,text[],uuid,text,integer,boolean,text,integer,text,text) rename to create_broadcast_unchecked;
revoke execute on function public.set_schedule_unchecked(text,jsonb,text,jsonb), public.set_birthdays_unchecked(text,jsonb,text),
  public.create_broadcast_unchecked(uuid,text,text[],uuid,text,integer,boolean,text,integer,text,text) from public, anon, authenticated;

create function public.set_schedule(p_classroom text, p_days jsonb, p_teacher_name text, p_duties jsonb default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if not public.can_manage(p_classroom) then raise exception '只有 % 班主任可以修改', p_classroom; end if;
  perform public.set_schedule_unchecked(p_classroom, p_days, p_teacher_name, p_duties);
end $$;

create function public.set_birthdays(p_classroom text, p_students jsonb, p_teacher_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if not public.can_manage(p_classroom) then raise exception '只有 % 班主任可以修改', p_classroom; end if;
  perform public.set_birthdays_unchecked(p_classroom, p_students, p_teacher_name);
end $$;

-- Paused classes are left out, except for their own homeroom teacher and the maintainer; a send to paused classes only is refused.
create function public.create_broadcast(p_id uuid, p_body text, p_classrooms text[], p_source uuid, p_teacher_name text,
  p_repeat_count integer, p_auto_close boolean, p_emotion text, p_voice_type integer, p_style text, p_banner_position text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_muted text[];
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  select coalesce(array_agg(id order by id), '{}') into v_muted from public.classrooms
    where id = any(p_classrooms) and clock_timestamp() >= mute_from and clock_timestamp() < mute_until and not public.is_homeroom(id);
  if v_muted <> '{}' and not exists(select 1 from public.broadcasts where id = p_id) and p_classrooms <@ v_muted then
    raise exception '% 班主任已暂停接收广播', array_to_string(v_muted, '、');
  end if;
  return public.create_broadcast_unchecked(p_id, p_body, array(select c from unnest(p_classrooms) c where c <> all(v_muted)), p_source,
    p_teacher_name, p_repeat_count, p_auto_close, p_emotion, p_voice_type, p_style, p_banner_position);
end $$;

-- manage: may clear the screen and edit class data; own: is this class's homeroom account (or the maintainer).
create or replace function public.classroom_status() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  return jsonb_build_object('server_now', clock_timestamp(), 'classrooms', (
    select jsonb_agg(jsonb_build_object('id', c.id, 'device_id', c.device_id, 'device_name', d.name,
      'last_seen_at', d.last_seen_at, 'screen_hidden', c.screen_hidden, 'bazaar_enabled', c.bazaar_enabled,
      'mute_from', c.mute_from, 'mute_until', c.mute_until, 'manage', public.can_manage(c.id), 'own', public.is_homeroom(c.id),
      'homeroom', case when h.classroom_id is not null then jsonb_build_object('teacher_name', h.teacher_name, 'claimed', h.user_id is not null,
        'mine', h.user_id = auth.uid()) end,
      'connected', coalesce(d.connected and d.last_seen_at > clock_timestamp() - interval '270 seconds', false)) order by c.id)
    from public.classrooms c left join public.devices d on d.id = c.device_id left join public.homerooms h on h.classroom_id = c.id
  ));
end $$;

revoke execute on function public.name_key(text), public.homeroom_for_name(text), public.is_homeroom(text), public.can_manage(text),
  public.set_broadcast_mute(text,timestamptz,timestamptz), public.set_schedule(text,jsonb,text,jsonb), public.set_birthdays(text,jsonb,text),
  public.create_broadcast(uuid,text,text[],uuid,text,integer,boolean,text,integer,text,text) from public;
grant execute on function public.name_key(text), public.homeroom_for_name(text) to anon, authenticated, service_role;
grant execute on function public.is_homeroom(text), public.can_manage(text), public.set_broadcast_mute(text,timestamptz,timestamptz),
  public.set_schedule(text,jsonb,text,jsonb), public.set_birthdays(text,jsonb,text),
  public.create_broadcast(uuid,text,text[],uuid,text,integer,boolean,text,integer,text,text) to authenticated, service_role;
grant all on public.homerooms to service_role;

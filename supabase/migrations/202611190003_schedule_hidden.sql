-- Hides only a class's timetable on its desktop; the server just sends no schedule, so classroom apps need no update.
alter table public.classrooms add column schedule_hidden boolean not null default false;

create function public.set_schedule_hidden(p_classroom text, p_hidden boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if not public.can_manage(p_classroom) then raise exception '只有 % 班主任可以操作', p_classroom; end if;
  if p_hidden is null then raise exception '隐藏选项无效'; end if;
  update public.classrooms set schedule_hidden = p_hidden where id = p_classroom;
  if not found then raise exception '班级无效'; end if;
end $$;

create or replace function public.device_screen() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when c.screen_hidden then jsonb_build_object('items', '[]'::jsonb, 'schedule', null, 'birthdays', null)
    else jsonb_build_object('items', public.device_duty_note() || public.device_display_items(),
      'schedule', case when c.schedule_hidden then null else public.device_schedule() end, 'birthdays', public.device_birthdays()) end
  from public.classrooms c where c.id = public.device_classroom()
$$;

create or replace function public.classroom_status() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  return jsonb_build_object('server_now', clock_timestamp(), 'classrooms', (
    select jsonb_agg(jsonb_build_object('id', c.id, 'device_id', c.device_id, 'device_name', d.name,
      'last_seen_at', d.last_seen_at, 'screen_hidden', c.screen_hidden, 'schedule_hidden', c.schedule_hidden, 'bazaar_enabled', c.bazaar_enabled,
      'mute_from', c.mute_from, 'mute_until', c.mute_until, 'manage', public.can_manage(c.id), 'own', public.is_homeroom(c.id),
      'homeroom', case when h.classroom_id is not null then jsonb_build_object('teacher_name', h.teacher_name, 'claimed', h.user_id is not null,
        'mine', h.user_id = auth.uid()) end,
      'connected', coalesce(d.connected and d.last_seen_at > clock_timestamp() - interval '270 seconds', false)) order by c.id)
    from public.classrooms c left join public.devices d on d.id = c.device_id left join public.homerooms h on h.classroom_id = c.id
  ));
end $$;

revoke execute on function public.set_schedule_hidden(text,boolean) from public, anon;
grant execute on function public.set_schedule_hidden(text,boolean) to authenticated, service_role;

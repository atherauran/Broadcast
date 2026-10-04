-- Status heartbeat is now every 120 seconds; a classroom is offline 270 seconds after its last one.
create or replace function public.classroom_status() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  return jsonb_build_object('server_now', clock_timestamp(), 'classrooms', (
    select jsonb_agg(jsonb_build_object('id', c.id, 'device_id', c.device_id, 'device_name', d.name,
      'last_seen_at', d.last_seen_at,
      'connected', coalesce(d.connected and d.last_seen_at > clock_timestamp() - interval '270 seconds', false)) order by c.id)
    from public.classrooms c left join public.devices d on d.id = c.device_id
  ));
end $$;

create or replace function public.create_broadcast(
  p_id uuid,
  p_body text,
  p_classrooms text[],
  p_source uuid,
  p_teacher_name text,
  p_repeat_count integer,
  p_auto_close boolean,
  p_emotion text,
  p_voice_type integer
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_count int; v_created timestamptz := clock_timestamp();
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if coalesce(array_length(p_classrooms, 1), 0) not between 1 and 6 then raise exception '请选择班级'; end if;
  select count(distinct id) into v_count from public.classrooms where id = any(p_classrooms);
  if v_count <> array_length(p_classrooms, 1) then raise exception '班级列表无效'; end if;
  if char_length(btrim(p_teacher_name)) not between 1 and 40 then raise exception '老师姓名无效'; end if;
  if p_repeat_count not between 0 and 5 then raise exception '播报次数无效'; end if;
  if p_auto_close is null then raise exception '关闭方式无效'; end if;
  if p_emotion not in ('normal','happy','sad','angry','warning') then raise exception '情感无效'; end if;
  if p_voice_type not in (101001,101004,101011,101013,101016) then raise exception '音色无效'; end if;
  insert into public.broadcasts(id, body, created_by, source_id, teacher_name, repeat_count, auto_close, emotion, voice_type, created_at, expires_at)
    values(p_id, btrim(p_body), auth.uid(), p_source, btrim(p_teacher_name), p_repeat_count, p_auto_close, p_emotion, p_voice_type,
      v_created, v_created + interval '30 seconds')
    on conflict(id) do nothing;
  if not found then
    if not exists(select 1 from public.broadcasts where id = p_id and created_by = auth.uid() and body = btrim(p_body)
      and source_id is not distinct from p_source and teacher_name = btrim(p_teacher_name) and repeat_count = p_repeat_count
      and auto_close = p_auto_close and emotion = p_emotion and voice_type = p_voice_type) then
      raise exception '请求编号冲突';
    end if;
    return p_id;
  end if;
  insert into public.deliveries(broadcast_id, classroom_id, device_id, online_at_send)
    select p_id, c.id, c.device_id, coalesce(d.connected and d.last_seen_at > v_created - interval '270 seconds', false)
    from public.classrooms c left join public.devices d on d.id = c.device_id where c.id = any(p_classrooms);
  return p_id;
end $$;

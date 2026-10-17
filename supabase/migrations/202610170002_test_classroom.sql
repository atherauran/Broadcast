-- A hidden 测试 classroom for the maintainer's test PC. The teacher app shows it only to the maintainer account;
-- the class limits below grow to 7 so it can be picked together with the real classes.
alter table public.classrooms drop constraint classrooms_id_check;
alter table public.classrooms add constraint classrooms_id_check check (id in ('8-1','8-2','8-3','8-4','8-5','8-6','测试'));
insert into public.classrooms(id) values ('测试');

create or replace function public.create_broadcast(
  p_id uuid,
  p_body text,
  p_classrooms text[],
  p_source uuid,
  p_teacher_name text,
  p_repeat_count integer,
  p_auto_close boolean,
  p_emotion text,
  p_voice_type integer,
  p_style text,
  p_banner_position text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_count int; v_created timestamptz := clock_timestamp();
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if coalesce(array_length(p_classrooms, 1), 0) not between 1 and 7 then raise exception '请选择班级'; end if;
  select count(distinct id) into v_count from public.classrooms where id = any(p_classrooms);
  if v_count <> array_length(p_classrooms, 1) then raise exception '班级列表无效'; end if;
  if char_length(btrim(p_teacher_name)) not between 1 and 40 then raise exception '老师姓名无效'; end if;
  if p_repeat_count not between 0 and 4 then raise exception '播报次数无效'; end if;
  if p_auto_close is null then raise exception '关闭方式无效'; end if;
  if p_emotion not in ('normal','happy','sad','angry','warning') then raise exception '情感无效'; end if;
  if p_voice_type not in (101001,101004,101011,101013,101016) then raise exception '音色无效'; end if;
  if p_style is null or p_style not in ('fullscreen','banner') then raise exception '显示样式无效'; end if;
  if p_banner_position is null or p_banner_position not in ('top','bottom') then raise exception '横幅位置无效'; end if;
  if p_style = 'banner' and (p_repeat_count <> 0 or not p_auto_close or char_length(btrim(p_body)) > 80) then
    raise exception '横幅最多 80 字，且不播报语音';
  end if;
  insert into public.broadcasts(id, body, created_by, source_id, teacher_name, repeat_count, auto_close, emotion, voice_type,
      style, banner_position, created_at, expires_at)
    values(p_id, btrim(p_body), auth.uid(), p_source, btrim(p_teacher_name), p_repeat_count, p_auto_close, p_emotion, p_voice_type,
      p_style, p_banner_position, v_created, v_created + interval '30 seconds')
    on conflict(id) do nothing;
  if not found then
    if not exists(select 1 from public.broadcasts where id = p_id and created_by = auth.uid() and body = btrim(p_body)
      and source_id is not distinct from p_source and teacher_name = btrim(p_teacher_name) and repeat_count = p_repeat_count
      and auto_close = p_auto_close and emotion = p_emotion and voice_type = p_voice_type
      and style = p_style and banner_position = p_banner_position) then
      raise exception '请求编号冲突';
    end if;
    return p_id;
  end if;
  insert into public.deliveries(broadcast_id, classroom_id, device_id, online_at_send)
    select p_id, c.id, c.device_id, coalesce(d.connected and d.last_seen_at > v_created - interval '270 seconds', false)
    from public.classrooms c left join public.devices d on d.id = c.device_id where c.id = any(p_classrooms);
  return p_id;
end $$;

create or replace function public.create_display_item(p_request uuid, p_kind text, p_classrooms text[], p_content jsonb, p_teacher_name text,
  p_ends_at timestamptz default null, p_duration_seconds integer default null, p_starts_at timestamptz default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp(); v_start timestamptz := coalesce(p_starts_at, clock_timestamp()); v_end timestamptz;
  v_content jsonb; v_count int; v_full text; v_days boolean;
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if coalesce(array_length(p_classrooms, 1), 0) not between 1 and 7 then raise exception '请选择班级'; end if;
  select count(distinct id) into v_count from public.classrooms where id = any(p_classrooms);
  if v_count <> array_length(p_classrooms, 1) then raise exception '班级列表无效'; end if;
  if char_length(btrim(coalesce(p_teacher_name, ''))) not between 1 and 40 then raise exception '老师姓名无效'; end if;
  v_content := public.display_content(p_kind, p_content);
  v_days := p_kind = 'countdown' and v_content ? 'date';
  if p_starts_at is not null and (p_kind = 'countdown' or p_starts_at <= v_now or p_starts_at > v_now + interval '400 days') then
    raise exception '发布时间无效';
  end if;
  if v_days and p_duration_seconds is not null then raise exception '倒数日需要指定日期';
  elsif p_kind = 'countdown' and p_duration_seconds is not null then
    if p_duration_seconds not between 60 and 43200 then raise exception '倒计时需在 1 分钟到 12 小时之间'; end if;
    v_end := v_now + make_interval(secs => p_duration_seconds);
  else
    v_end := p_ends_at;
  end if;
  if v_end is null or v_end <= v_start or v_end > v_now + interval '400 days' then raise exception '结束时间无效'; end if;
  if p_kind = 'countdown' and not v_days and v_end > v_now + interval '12 hours' then raise exception '倒计时需在 1 分钟到 12 小时之间'; end if;

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
        and i.ends_at > v_start and i.starts_at < v_end) >= 12;
    if v_full is not null then raise exception '% 已有 12 张便签，请先移除一张', v_full; end if;
  elsif p_kind = 'countdown' then
    if v_days then
      select string_agg(c, '、' order by c) into v_full from unnest(p_classrooms) c
        where (select count(*) from public.display_items i where i.classroom_id = c and i.kind = 'countdown' and i.content ? 'date'
          and i.removed_at is null and i.ends_at > v_now) >= 3;
      if v_full is not null then raise exception '% 已有 3 个倒数日，请先移除一个', v_full; end if;
    else
      update public.display_items set removed_at = v_now
        where kind = 'countdown' and removed_at is null and ends_at > v_now and classroom_id = any(p_classrooms)
          and not (content ? 'date');
    end if;
  end if;
  insert into public.display_items(request_id, classroom_id, kind, content, starts_at, ends_at, teacher_name, created_by)
    select p_request, c, p_kind, v_content, v_start, v_end, btrim(p_teacher_name), auth.uid() from unnest(p_classrooms) c;
  return p_request;
end $$;

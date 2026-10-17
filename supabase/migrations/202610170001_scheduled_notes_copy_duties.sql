-- Notes (and boards) can be created to appear later, live items can be copied to other classes,
-- and each class keeps a weekly duty roster that its classroom shows as the first note of the day.

drop function public.create_display_item(uuid,text,text[],jsonb,text,timestamptz,integer);

-- p_starts_at schedules the item; without it the item starts now. The 12-note limit counts notes whose time on screen overlaps.
create function public.create_display_item(p_request uuid, p_kind text, p_classrooms text[], p_content jsonb, p_teacher_name text,
  p_ends_at timestamptz default null, p_duration_seconds integer default null, p_starts_at timestamptz default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp(); v_start timestamptz := coalesce(p_starts_at, clock_timestamp()); v_end timestamptz;
  v_content jsonb; v_count int; v_full text; v_days boolean;
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if coalesce(array_length(p_classrooms, 1), 0) not between 1 and 6 then raise exception '请选择班级'; end if;
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

-- Sends what the given items show, with the same start and end, to more classes under the copying teacher's name.
-- One item per request is copied, and each copy's request id derives from p_request, so a retry creates nothing twice.
create function public.copy_display_items(p_request uuid, p_ids uuid[], p_classrooms text[], p_teacher_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp(); r record; v_found boolean := false;
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  for r in select * from (select distinct on (request_id) request_id, kind, content, starts_at, ends_at, created_at
      from public.display_items where id = any(p_ids) and removed_at is null and ends_at > v_now order by request_id, created_at) s
    order by created_at
  loop
    v_found := true;
    perform public.create_display_item(md5(p_request::text || r.request_id::text)::uuid, r.kind, p_classrooms, r.content, p_teacher_name,
      r.ends_at, null, case when r.starts_at > v_now then r.starts_at end);
  end loop;
  if not v_found then raise exception '内容已结束或被移除'; end if;
end $$;

-- duties lists the roster's jobs, each {task, days} with the names on duty Monday to Friday ('' when nobody is set).
alter table public.schedules add column duties jsonb not null default '[]';

drop function public.set_schedule(text,jsonb,text);

-- Without p_duties the class keeps its roster, so an older teacher app can still save the timetable.
create function public.set_schedule(p_classroom text, p_days jsonb, p_teacher_name text, p_duties jsonb default null) returns void
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
    where case when jsonb_typeof(s) = 'string' then s #>> '{}' not in ('english','chinese','math','physics','biology','chemistry',
      'history','pe','morality','art','it','elective','club','lunch') else true end) then
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

-- Today's duty (by the school's clock) as a note the classroom shows without knowing about rosters; nothing on weekends.
-- The classroom orders notes by start, so the far-past start keeps this one at the top of the column; it ends at midnight.
create function public.device_duty_note() returns jsonb
language sql stable security definer set search_path = '' as $$
  with today as (select (clock_timestamp() at time zone 'Asia/Shanghai')::date as day),
  lines as (
    select string_agg((d->>'task') || '：' || (d->'days'->>(extract(isodow from t.day)::int - 1)), E'\n' order by k) as text
    from public.schedules s, today t, jsonb_array_elements(s.duties) with ordinality as x(d, k)
    where s.classroom_id = public.device_classroom() and extract(isodow from t.day) between 1 and 5
      and d->'days'->>(extract(isodow from t.day)::int - 1) <> ''
  )
  select case when l.text is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
    'id', md5(public.device_classroom() || t.day::text)::uuid, 'kind', 'note', 'content', jsonb_build_object('text', l.text, 'color', 'green'),
    'starts_at', '2000-01-01T00:00:00Z'::timestamptz, 'ends_at', (t.day + 1)::timestamp at time zone 'Asia/Shanghai',
    'teacher_name', '今日值日')) end
  from lines l, today t
$$;

create or replace function public.display_state() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('server_now', clock_timestamp(), 'items', public.device_display_items() || public.device_duty_note(),
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
    'display', public.device_display_items() || public.device_duty_note(), 'schedule', public.device_schedule(), 'birthdays', public.device_birthdays());
end $$;

revoke execute on function public.create_display_item(uuid,text,text[],jsonb,text,timestamptz,integer,timestamptz),
  public.copy_display_items(uuid,uuid[],text[],text), public.set_schedule(text,jsonb,text,jsonb), public.device_duty_note() from public, anon;
grant execute on function public.create_display_item(uuid,text,text[],jsonb,text,timestamptz,integer,timestamptz),
  public.copy_display_items(uuid,uuid[],text[],text), public.set_schedule(text,jsonb,text,jsonb) to authenticated, service_role;
grant execute on function public.device_duty_note() to service_role;

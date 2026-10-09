-- A countdown may instead count days to a date (content.date): it is long-term, corner-only and independent of timed countdowns.
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
    if jsonb_typeof(coalesce(p_content->'fullscreen', 'false')) <> 'boolean' then raise exception '倒计时显示方式无效'; end if;
    if p_content ? 'date' then
      if jsonb_typeof(p_content->'date') is distinct from 'string' or char_length(p_content->>'date') <> 10 then raise exception '日期无效'; end if;
      if coalesce((p_content->'fullscreen')::boolean, false) then raise exception '倒数日只能显示在右上角'; end if;
      return jsonb_build_object('label', v_text, 'fullscreen', false, 'date', (p_content->>'date')::date::text);
    end if;
    return jsonb_build_object('label', v_text, 'fullscreen', coalesce((p_content->'fullscreen')::boolean, false));
  end if;
  raise exception '显示类型无效';
end $$;


create or replace function public.create_display_item(p_request uuid, p_kind text, p_classrooms text[], p_content jsonb, p_teacher_name text,
  p_ends_at timestamptz default null, p_duration_seconds integer default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp(); v_end timestamptz; v_content jsonb; v_count int; v_full text; v_days boolean;
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if coalesce(array_length(p_classrooms, 1), 0) not between 1 and 6 then raise exception '请选择班级'; end if;
  select count(distinct id) into v_count from public.classrooms where id = any(p_classrooms);
  if v_count <> array_length(p_classrooms, 1) then raise exception '班级列表无效'; end if;
  if char_length(btrim(coalesce(p_teacher_name, ''))) not between 1 and 40 then raise exception '老师姓名无效'; end if;
  v_content := public.display_content(p_kind, p_content);
  v_days := p_kind = 'countdown' and v_content ? 'date';
  if v_days and p_duration_seconds is not null then raise exception '倒数日需要指定日期';
  elsif p_kind = 'countdown' and p_duration_seconds is not null then
    if p_duration_seconds not between 60 and 43200 then raise exception '倒计时需在 1 分钟到 12 小时之间'; end if;
    v_end := v_now + make_interval(secs => p_duration_seconds);
  else
    v_end := p_ends_at;
  end if;
  if v_end is null or v_end <= v_now or v_end > v_now + (case when v_days then interval '400 days' else interval '7 days' end) then raise exception '结束时间无效'; end if;
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
        and i.ends_at > v_now) >= 4;
    if v_full is not null then raise exception '% 已有 4 张便签，请先移除一张', v_full; end if;
  elsif p_kind = 'countdown' then
    update public.display_items set removed_at = v_now
      where kind = 'countdown' and removed_at is null and ends_at > v_now and classroom_id = any(p_classrooms)
        and (content ? 'date') = v_days;
  end if;
  insert into public.display_items(request_id, classroom_id, kind, content, starts_at, ends_at, teacher_name, created_by)
    select p_request, c, p_kind, v_content, v_now, v_end, btrim(p_teacher_name), auth.uid() from unnest(p_classrooms) c;
  return p_request;
end $$;


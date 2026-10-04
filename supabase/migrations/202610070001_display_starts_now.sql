-- Display items always start when created; scheduled start ("定时显示") is gone.
drop function public.create_display_item(uuid,text,text[],jsonb,text,timestamptz,timestamptz,integer);

create function public.create_display_item(p_request uuid, p_kind text, p_classrooms text[], p_content jsonb, p_teacher_name text,
  p_ends_at timestamptz default null, p_duration_seconds integer default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp(); v_end timestamptz; v_content jsonb; v_count int; v_full text;
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if coalesce(array_length(p_classrooms, 1), 0) not between 1 and 6 then raise exception '请选择班级'; end if;
  select count(distinct id) into v_count from public.classrooms where id = any(p_classrooms);
  if v_count <> array_length(p_classrooms, 1) then raise exception '班级列表无效'; end if;
  if char_length(btrim(coalesce(p_teacher_name, ''))) not between 1 and 40 then raise exception '老师姓名无效'; end if;
  v_content := public.display_content(p_kind, p_content);
  if p_kind = 'countdown' and p_duration_seconds is not null then
    if p_duration_seconds not between 60 and 43200 then raise exception '倒计时需在 1 分钟到 12 小时之间'; end if;
    v_end := v_now + make_interval(secs => p_duration_seconds);
  else
    v_end := p_ends_at;
  end if;
  if v_end is null or v_end <= v_now or v_end > v_now + interval '7 days' then raise exception '结束时间无效'; end if;
  if p_kind = 'countdown' and v_end > v_now + interval '12 hours' then raise exception '倒计时需在 1 分钟到 12 小时之间'; end if;

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
      where kind = 'countdown' and removed_at is null and ends_at > v_now and classroom_id = any(p_classrooms);
  end if;
  insert into public.display_items(request_id, classroom_id, kind, content, starts_at, ends_at, teacher_name, created_by)
    select p_request, c, p_kind, v_content, v_now, v_end, btrim(p_teacher_name), auth.uid() from unnest(p_classrooms) c;
  return p_request;
end $$;

revoke execute on function public.create_display_item(uuid,text,text[],jsonb,text,timestamptz,integer) from public, anon;
grant execute on function public.create_display_item(uuid,text,text[],jsonb,text,timestamptz,integer) to authenticated, service_role;

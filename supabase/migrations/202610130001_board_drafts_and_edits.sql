-- Board drafts, scheduled boards, editing what is on screen, and end times up to a year ahead.
-- A scheduled board is a set of display items whose starts_at lies ahead; classrooms already wait for starts_at,
-- so it appears on time without anything running on the server.
create table public.board_drafts (
  id uuid primary key,
  content jsonb not null,
  classrooms text[] not null,
  ends_at timestamptz,
  teacher_name text not null check (char_length(btrim(teacher_name)) between 1 and 40),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.board_drafts enable row level security;
create policy read_board_drafts on public.board_drafts for select to authenticated using (public.is_admin());

-- Saves a board under p_id: as a draft without p_publish_at, otherwise scheduled to appear then.
-- Saving again replaces whatever p_id held before, so a draft and its schedule can move back and forth.
create function public.save_board_draft(p_id uuid, p_content jsonb, p_classrooms text[], p_teacher_name text,
  p_ends_at timestamptz default null, p_publish_at timestamptz default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp(); v_content jsonb; v_count int; v_targets int := coalesce(array_length(p_classrooms, 1), 0);
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if char_length(btrim(coalesce(p_teacher_name, ''))) not between 1 and 40 then raise exception '老师姓名无效'; end if;
  select count(distinct id) into v_count from public.classrooms where id = any(p_classrooms);
  if v_count <> v_targets then raise exception '班级列表无效'; end if;
  v_content := public.display_content('board', p_content);
  if p_publish_at is not null then
    if v_targets = 0 then raise exception '请选择班级'; end if;
    if p_publish_at <= v_now or p_publish_at > v_now + interval '400 days' then raise exception '发布时间无效'; end if;
    if p_ends_at is null or p_ends_at <= p_publish_at or p_ends_at > v_now + interval '400 days' then raise exception '结束时间无效'; end if;
  end if;
  if exists(select 1 from public.display_items where request_id = p_id and starts_at <= v_now) then raise exception '这条公告已经发布'; end if;
  delete from public.display_items where request_id = p_id;
  if p_publish_at is null then
    insert into public.board_drafts(id, content, classrooms, ends_at, teacher_name, updated_by, updated_at)
      values (p_id, v_content, p_classrooms, p_ends_at, btrim(p_teacher_name), auth.uid(), v_now)
      on conflict (id) do update set content = excluded.content, classrooms = excluded.classrooms, ends_at = excluded.ends_at,
        teacher_name = excluded.teacher_name, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  else
    delete from public.board_drafts where id = p_id;
    insert into public.display_items(request_id, classroom_id, kind, content, starts_at, ends_at, teacher_name, created_by)
      select p_id, c, 'board', v_content, p_publish_at, p_ends_at, btrim(p_teacher_name), auth.uid() from unnest(p_classrooms) c;
  end if;
end $$;

-- Deletes a draft, or a scheduled board that has not appeared yet.
create function public.delete_board_draft(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  delete from public.board_drafts where id = p_id;
  delete from public.display_items where request_id = p_id and starts_at > clock_timestamp();
end $$;

-- Changes the content and end time of items on screen; all of them must be the same kind.
-- A board already read aloud is not read again, because classrooms remember items by id.
create function public.update_display_items(p_ids uuid[], p_content jsonb, p_ends_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp(); v_kinds text[]; v_content jsonb; v_days boolean;
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  select array_agg(distinct kind) into v_kinds from public.display_items where id = any(p_ids) and removed_at is null and ends_at > v_now;
  if v_kinds is null then raise exception '内容已结束或被移除'; end if;
  if array_length(v_kinds, 1) <> 1 then raise exception '只能同时编辑同一类内容'; end if;
  v_content := public.display_content(v_kinds[1], p_content);
  v_days := v_kinds[1] = 'countdown' and v_content ? 'date';
  if p_ends_at is null or p_ends_at <= v_now or p_ends_at > v_now + interval '400 days' then raise exception '结束时间无效'; end if;
  if v_kinds[1] = 'countdown' and not v_days and p_ends_at > v_now + interval '12 hours' then raise exception '倒计时最长 12 小时'; end if;
  update public.display_items set content = v_content, ends_at = p_ends_at
    where id = any(p_ids) and removed_at is null and ends_at > v_now;
end $$;

-- Boards and notes may now end up to a year ahead instead of 7 days.
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
  if v_end is null or v_end <= v_now or v_end > v_now + interval '400 days' then raise exception '结束时间无效'; end if;
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
        and i.ends_at > v_now) >= 12;
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
    select p_request, c, p_kind, v_content, v_now, v_end, btrim(p_teacher_name), auth.uid() from unnest(p_classrooms) c;
  return p_request;
end $$;

revoke all on public.board_drafts from anon, authenticated;
grant select on public.board_drafts to authenticated;
grant all on public.board_drafts to service_role;
revoke execute on function public.save_board_draft(uuid,jsonb,text[],text,timestamptz,timestamptz), public.delete_board_draft(uuid),
  public.update_display_items(uuid[],jsonb,timestamptz) from public, anon;
grant execute on function public.save_board_draft(uuid,jsonb,text[],text,timestamptz,timestamptz), public.delete_board_draft(uuid),
  public.update_display_items(uuid[],jsonb,timestamptz) to authenticated, service_role;

alter publication supabase_realtime add table public.board_drafts;

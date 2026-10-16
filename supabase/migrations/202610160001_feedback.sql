-- Teachers send feedback that every teacher can read and comment on; the maintainer moves each one through its statuses.
-- The maintainer is an admin account whose app_metadata also has maintainer = true.
-- updated_at changes with any activity, so Realtime on this one table also covers comments; replied_at changes only with the maintainer's.
create function public.is_maintainer() returns boolean language sql stable
set search_path = '' as $$
  select public.is_admin() and coalesce(auth.jwt()->'app_metadata'->>'maintainer' = 'true', false)
$$;

create table public.feedback (
  id uuid primary key,
  kind text not null check (kind in ('feature', 'bug', 'other')),
  body text not null,
  teacher_name text not null,
  status text not null default 'open' check (status in ('open', 'doing', 'install', 'done', 'declined')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  replied_at timestamptz
);
create table public.feedback_comments (
  id uuid primary key,
  feedback_id uuid not null references public.feedback(id) on delete cascade,
  body text not null,
  teacher_name text not null,
  maintainer boolean not null,
  created_at timestamptz not null default clock_timestamp()
);
create index feedback_comments_feedback on public.feedback_comments(feedback_id);
alter table public.feedback enable row level security;
alter table public.feedback_comments enable row level security;
create policy read_feedback on public.feedback for select to authenticated using (public.is_admin());
create policy read_feedback_comments on public.feedback_comments for select to authenticated using (public.is_admin());

-- Each request carries a client-made id, so a retried submit never adds a duplicate.
create function public.submit_feedback(p_id uuid, p_kind text, p_body text, p_teacher_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if p_kind is null or p_kind not in ('feature', 'bug', 'other') then raise exception '反馈类型无效'; end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 1000 then raise exception '反馈内容需要 1–1000 字'; end if;
  if char_length(btrim(coalesce(p_teacher_name, ''))) not between 1 and 40 then raise exception '老师姓名无效'; end if;
  insert into public.feedback(id, kind, body, teacher_name) values (p_id, p_kind, btrim(p_body), btrim(p_teacher_name))
    on conflict (id) do nothing;
end $$;

create function public.comment_feedback(p_id uuid, p_feedback uuid, p_body text, p_teacher_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_maintainer boolean := public.is_maintainer();
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 500 then raise exception '评论需要 1–500 字'; end if;
  if char_length(btrim(coalesce(p_teacher_name, ''))) not between 1 and 40 then raise exception '老师姓名无效'; end if;
  if not exists(select 1 from public.feedback where id = p_feedback) then raise exception '反馈不存在'; end if;
  insert into public.feedback_comments(id, feedback_id, body, teacher_name, maintainer)
    values (p_id, p_feedback, btrim(p_body), btrim(p_teacher_name), v_maintainer)
    on conflict (id) do nothing;
  if found then
    update public.feedback set updated_at = clock_timestamp(),
      replied_at = case when v_maintainer then clock_timestamp() else replied_at end where id = p_feedback;
  end if;
end $$;

create function public.set_feedback_status(p_feedback uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_maintainer() then raise exception '只有维护者可以修改状态'; end if;
  if p_status is null or p_status not in ('open', 'doing', 'install', 'done', 'declined') then raise exception '状态无效'; end if;
  update public.feedback set status = p_status, updated_at = clock_timestamp(), replied_at = clock_timestamp()
    where id = p_feedback and status <> p_status;
end $$;

revoke all on public.feedback, public.feedback_comments from anon, authenticated;
grant select on public.feedback, public.feedback_comments to authenticated;
grant all on public.feedback, public.feedback_comments to service_role;
revoke execute on function public.is_maintainer(), public.submit_feedback(uuid,text,text,text),
  public.comment_feedback(uuid,uuid,text,text), public.set_feedback_status(uuid,text) from public, anon;
grant execute on function public.is_maintainer(), public.submit_feedback(uuid,text,text,text),
  public.comment_feedback(uuid,uuid,text,text), public.set_feedback_status(uuid,text) to authenticated, service_role;

alter publication supabase_realtime add table public.feedback;

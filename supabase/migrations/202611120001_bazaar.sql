-- Bazaar income is an append-only ledger. A correction replaces one current entry;
-- zero cancels it, and the original sale time is retained for the growth curve.
alter table public.classrooms add column bazaar_enabled boolean not null default true;

create table public.bazaar_entries (
  id uuid primary key,
  classroom_id text not null references public.classrooms(id),
  group_name text not null check (char_length(btrim(group_name)) between 1 and 30),
  amount integer not null check (amount between 0 and 1000000),
  occurred_at timestamptz not null default clock_timestamp(),
  recorded_at timestamptz not null default clock_timestamp(),
  recorded_by uuid not null references auth.users(id),
  replaces_id uuid unique references public.bazaar_entries(id),
  check (replaces_id is not null or amount > 0)
);
create index bazaar_entries_class_idx on public.bazaar_entries(classroom_id, recorded_at, id);
alter table public.bazaar_entries enable row level security;
create policy read_bazaar_entries on public.bazaar_entries for select to authenticated
  using (public.is_admin() or classroom_id = public.device_classroom());
grant select on public.bazaar_entries to authenticated;
alter publication supabase_realtime add table public.bazaar_entries;

create function public.record_bazaar_income(p_id uuid, p_group text, p_amount integer, p_replaces uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_class text; v_old public.bazaar_entries; v_existing public.bazaar_entries; v_time timestamptz := clock_timestamp();
begin
  -- Lock the binding as well, so a concurrent unbind cannot write into a former classroom.
  select id into v_class from public.classrooms where device_id = auth.uid() for share;
  if v_class is null then raise exception '设备未绑定班级'; end if;
  p_group := btrim(p_group);
  if p_id is null or p_group is null or char_length(p_group) not between 1 and 30
    then raise exception '小组名称需要 1–30 字'; end if;
  if p_amount is null or p_amount not between 0 and 1000000 or (p_replaces is null and p_amount = 0)
    then raise exception '新增筹码需要 1–1000000，纠错可填 0 撤销'; end if;
  -- Serialize retries of the same request, including requests whose HTTP response was lost.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_existing from public.bazaar_entries where id = p_id;
  if found then
    if v_existing.classroom_id <> v_class or v_existing.group_name <> p_group or v_existing.amount <> p_amount
      or v_existing.replaces_id is distinct from p_replaces then raise exception '提交编号已使用'; end if;
    return;
  end if;
  if p_replaces is not null then
    select * into v_old from public.bazaar_entries where id = p_replaces and classroom_id = v_class for update;
    if not found then raise exception '记录不存在或不属于本班'; end if;
    if exists(select 1 from public.bazaar_entries where replaces_id = p_replaces)
      then raise exception '这笔记录已被纠错，请查看最新记录'; end if;
    v_time := v_old.occurred_at;
  end if;
  insert into public.bazaar_entries(id, classroom_id, group_name, amount, occurred_at, recorded_by, replaces_id)
    values(p_id, v_class, p_group, p_amount, v_time, auth.uid(), p_replaces);
end $$;

create function public.bazaar_state() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('classroom_id', c.id, 'enabled', c.bazaar_enabled and not c.screen_hidden,
    'entries', coalesce((select jsonb_agg(to_jsonb(e) order by e.recorded_at, e.id)
      from public.bazaar_entries e where e.classroom_id = c.id), '[]'::jsonb))
  from public.classrooms c where c.id = public.device_classroom()
$$;

create function public.set_bazaar_enabled(p_classroom text, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if p_enabled is null then raise exception '显示选项无效'; end if;
  update public.classrooms set bazaar_enabled = p_enabled where id = p_classroom;
  if not found then raise exception '班级无效'; end if;
end $$;

create or replace function public.classroom_status() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  return jsonb_build_object('server_now', clock_timestamp(), 'classrooms', (
    select jsonb_agg(jsonb_build_object('id', c.id, 'device_id', c.device_id, 'device_name', d.name,
      'last_seen_at', d.last_seen_at, 'screen_hidden', c.screen_hidden, 'bazaar_enabled', c.bazaar_enabled,
      'connected', coalesce(d.connected and d.last_seen_at > clock_timestamp() - interval '270 seconds', false)) order by c.id)
    from public.classrooms c left join public.devices d on d.id = c.device_id
  ));
end $$;

revoke execute on function public.record_bazaar_income(uuid,text,integer,uuid), public.bazaar_state(),
  public.set_bazaar_enabled(text,boolean) from public, anon;
grant execute on function public.record_bazaar_income(uuid,text,integer,uuid), public.bazaar_state(),
  public.set_bazaar_enabled(text,boolean) to authenticated;

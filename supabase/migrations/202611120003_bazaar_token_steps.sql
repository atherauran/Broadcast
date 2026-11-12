-- New income and corrections use multiples of 5; zero still cancels a record.
-- Preserve historical ledger entries unchanged.
create or replace function public.record_bazaar_income(p_id uuid, p_group text, p_amount integer, p_replaces uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_class text; v_old public.bazaar_entries; v_existing public.bazaar_entries; v_time timestamptz := clock_timestamp();
begin
  -- Lock the binding as well, so a concurrent unbind cannot write into a former classroom.
  select id into v_class from public.classrooms where device_id = auth.uid() for share;
  if v_class is null then raise exception '设备未绑定班级'; end if;
  p_group := btrim(p_group);
  if p_id is null or p_group is null or char_length(p_group) not between 1 and 30
    then raise exception '小组名称需要 1–30 字'; end if;
  if p_amount is null or p_amount not between 0 and 1000000 or p_amount % 5 <> 0 or (p_replaces is null and p_amount = 0)
    then raise exception '筹码数量须为 5 的整数倍（5–1000000），纠错可填 0 撤销'; end if;
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

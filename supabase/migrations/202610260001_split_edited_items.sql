-- Editing some of the classes an item was sent to splits them off under a new request, so they no longer select, copy or edit with the rest.
create or replace function public.update_display_items(p_ids uuid[], p_content jsonb, p_ends_at timestamptz) returns void
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
  -- Materialized so each split request draws its new id once.
  with s as materialized (select d.request_id, gen_random_uuid() fresh from public.display_items d
      where d.id = any(p_ids) and d.removed_at is null and d.ends_at > v_now
        and exists(select 1 from public.display_items o where o.request_id = d.request_id and not o.id = any(p_ids) and o.removed_at is null and o.ends_at > v_now)
      group by d.request_id)
  update public.display_items i set request_id = s.fresh from s
    where i.request_id = s.request_id and i.id = any(p_ids) and i.removed_at is null and i.ends_at > v_now;
  update public.display_items set content = v_content, ends_at = p_ends_at
    where id = any(p_ids) and removed_at is null and ends_at > v_now;
end $$;

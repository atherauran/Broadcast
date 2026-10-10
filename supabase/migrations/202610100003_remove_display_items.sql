-- Removes several selected items in one request; remove_display_item stays for older teacher pages.
create function public.remove_display_items(p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  update public.display_items set removed_at = clock_timestamp() where removed_at is null and id = any(p_ids);
end $$;

revoke execute on function public.remove_display_items(uuid[]) from public, anon;
grant execute on function public.remove_display_items(uuid[]) to authenticated, service_role;

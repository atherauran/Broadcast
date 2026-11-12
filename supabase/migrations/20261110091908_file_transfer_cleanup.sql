create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- A dedicated random token is shared only by Vault and the scheduled request.
select vault.create_secret(gen_random_uuid()::text || gen_random_uuid()::text, 'file_cleanup_token');

create function public.file_cleanup_candidates(p_token text) returns text[]
language plpgsql security definer set search_path = '' as $$
begin
  if p_token is null or p_token is distinct from (select decrypted_secret from vault.decrypted_secrets where name = 'file_cleanup_token')
    then raise exception '无权清理文件'; end if;
  update public.file_transfers f set deleted_at = coalesce(deleted_at, clock_timestamp())
  where deleted_at is null and (
    expires_at <= clock_timestamp() or (sent_at is null and created_at <= clock_timestamp() - interval '1 hour')
    or (sent_at is not null and not exists(select 1 from public.file_deliveries d
      where d.transfer_id = f.id and d.downloaded_at is null and d.failed_at is null))
  );
  -- Inspect actual objects as well: this catches an upload finishing after its reservation was cleaned up.
  return array(select o.name from storage.objects o left join public.file_transfers f on f.object_path = o.name
    where o.bucket_id = 'classroom-files' and (f.deleted_at is not null
      or (f.id is null and o.created_at < clock_timestamp() - interval '1 hour'))
    order by o.created_at limit 100);
end $$;
revoke execute on function public.file_cleanup_candidates(text) from public, anon, authenticated;
grant execute on function public.file_cleanup_candidates(text) to service_role;

select cron.schedule('cleanup-classroom-files', '*/15 * * * *', $job$
  select net.http_post(
    url := 'https://kmuuixuiipqxzeyoawap.supabase.co/functions/v1/broadcast-api',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-file-cleanup-token',
      (select decrypted_secret from vault.decrypted_secrets where name = 'file_cleanup_token')),
    body := '{"action":"cleanup-files"}'::jsonb
  );
$job$);

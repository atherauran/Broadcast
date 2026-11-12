-- Allow the first invocation after an idle period to finish its cold start.
select cron.schedule('cleanup-classroom-files', '*/15 * * * *', $job$
  select net.http_post(
    url := 'https://kmuuixuiipqxzeyoawap.supabase.co/functions/v1/broadcast-api',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-file-cleanup-token',
      (select decrypted_secret from vault.decrypted_secrets where name = 'file_cleanup_token')),
    body := '{"action":"cleanup-files"}'::jsonb,
    timeout_milliseconds := 60000
  );
$job$);

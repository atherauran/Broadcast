# Setup and Deployment

How to set up the backend, teacher app and classroom app for a new environment, or maintain the existing one.

## Supabase

1. Create a project and note its URL and publishable (anon) key. Clients use only the public key; never put the `service_role` key in them.
2. Link the Supabase CLI and apply the migrations:

   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

3. Disable Auth self-signup. Create these users, confirm their emails, and set `app_metadata` through the Admin API (never the user-writable `user_metadata`):
   - the shared admin, `admin@broadcast.local`: `{"role": "admin"}`. Both apps must use the same email.
   - the maintainer, `maintainer@broadcast.local` (or `VITE_MAINTAINER_EMAIL`), with its own password: `{"role": "admin", "maintainer": true}`. Signing in with it changes feedback statuses and marks comments as the maintainer's.
   - homeroom teachers are rows in `public.homerooms` (class, name, other names). Each creates their own `homeroom-<class>@broadcast.local` account from the teacher app; see [Homeroom teachers](CONTRACT.md#homeroom-teachers).
4. Set the function secret and deploy the Edge Function:

   ```bash
   supabase secrets set --env-file supabase/.env
   supabase functions deploy broadcast-api
   ```

   `ALLOWED_ORIGINS` is the only secret. It is a comma-separated list of teacher-app origins (protocol and port, no path): `http://127.0.0.1:5173,http://localhost:5173` locally, plus `https://atherauran.github.io` for GitHub Pages.

`verify_jwt` is disabled for `broadcast-api` in `supabase/config.toml`, but the function checks the caller with `auth.getUser(token)` on every request; do not remove that check.

Devices use Realtime **Postgres Changes** with row-level security. Keep the default Realtime channel settings; the publication and SELECT policies come from the migrations.

### File transfers

The migrations create the private `classroom-files` bucket, enable `pg_cron` and `pg_net`, store a cleanup token in Vault and schedule a cleanup every 15 minutes. For a different project, change the function URL in `20261110091908_file_transfer_cleanup.sql` before applying it. If cleanup fails, check the `cleanup-classroom-files` cron job and its HTTP response.

### Bazaar statistics

Needs no extra secrets or deployment. There is no reset or purge, so use the Test class for trials and keep production ledgers free of test entries.

## Tencent Cloud

Enable basic speech synthesis (`TextToVoice`). The teacher app offers five voices: 智瑜 `101001`, 智云 `101004`, 智燕 `101011`, 智辉 `101013` and 智甜 `101016`.

Each classroom PC reads the credentials from `appsettings.json` and calls `tts.tencentcloudapi.com` directly. Audio is generated and played in memory and never uploaded. Text longer than the per-call limit is split into chunks of at most 150 characters, and the client prepends one second of silence so Bluetooth, HDMI and USB audio can wake up. Synthesis has a 10-second limit; on failure the broadcast shows text only.

The teacher app's voice previews are static WAV files in `apps/teacher/public/voice-previews`. To regenerate them, set up `appsettings.local.json` and run `node scripts/generate-voice-previews.mjs`.

## Teacher app

Set `apps/teacher/.env.local`:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_KEY
VITE_ADMIN_EMAIL=admin@broadcast.local
```

Variables are baked in at build time, so rebuild after changing them. `npm --prefix apps/teacher run build` writes a static site to `apps/teacher/dist`.

`.github/workflows/pages.yml` publishes it to GitHub Pages on every push to `main`, with `/Broadcast/` as the base path. The workflow carries the public project URL and key; never put the service role or Tencent Cloud keys there. Installing the PWA on a phone requires HTTPS.

## Classroom app

Run `scripts/publish-windows.sh` to build the package, or edit `appsettings.json` in an existing one. No rebuild is needed for config changes.

```json
{
  "supabase_url": "https://YOUR_PROJECT.supabase.co",
  "supabase_anon_key": "YOUR_PUBLIC_KEY",
  "admin_email": "admin@broadcast.local",
  "tencent_tts": {
    "secret_id": "YOUR_TENCENT_SECRET_ID",
    "secret_key": "YOUR_TENCENT_SECRET_KEY",
    "region": "ap-guangzhou",
    "model_type": 1,
    "sample_rate": 16000,
    "speed": 0,
    "volume": 0
  }
}
```

The file holds Tencent Cloud keys, so restrict read access to the program directory. The repository's `appsettings.json` is a template without keys; keep the real one in the ignored `appsettings.local.json`, which the publish script uses. See the [Windows guide](WINDOWS-GUIDE.md) for installing and operating a classroom PC.

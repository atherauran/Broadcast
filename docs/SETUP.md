# Cloud Setup and Deployment

The production Supabase project `kmuuixuiipqxzeyoawap` already has its database, admin account, cloud function and local origins configured. Migration `202609080001_broadcast.sql` is registered as applied so the CLI won't rerun it. The steps below are kept for reproducing and maintaining the setup.

## Supabase

1. Create a Supabase project and note the project URL and publishable/anon key. Clients use only the public key; never put the service_role key in them. The current URL is `https://kmuuixuiipqxzeyoawap.supabase.co`.
2. Link the project with the Supabase CLI and apply every SQL file in `supabase/migrations` in filename order. `202609120001_broadcast_options.sql` adds the teacher name, repeat count, close mode, emotion and voice fields, and updates the send and pending queries. `202610040001_heartbeat_120s.sql` changes the offline threshold to 270 seconds.
3. Keep Auth self-signup disabled. Create one email/password user such as `admin@broadcast.local`, confirm the email, and set `app_metadata.role` to `admin` through the trusted Admin API. Use **app_metadata**, never the user-writable user_metadata. The admin email in the teacher and classroom apps must match.
4. Deploy the `broadcast-api` Edge Function. `supabase/config.toml` sets `verify_jwt=false` for it, but the function calls `auth.getUser(token)` on every request and checks admin or device permissions, so do not remove that check.
5. The only function secret needed is `ALLOWED_ORIGINS`. The teacher app's five preview audio clips ship with the static site, so Supabase holds no Tencent Cloud credentials.
6. `ALLOWED_ORIGINS` is a comma-separated list of full teacher-app origins, including protocol and port. Locally use `http://127.0.0.1:5173,http://localhost:5173`. For GitHub Pages use `https://willyblah.github.io`; the `/Broadcast/` path is not part of the origin.

Example CLI:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase secrets set --env-file supabase/.env
supabase functions deploy broadcast-api
```

Device registration runs in the Edge Function after admin verification, using the Auth Admin API to create a separate device user. The device's public key grants project access only, not admin rights. Devices use Realtime **Postgres Changes** with table-level RLS; arbitrary client Broadcast messages are never used as commands. Keep the default Realtime channel access settings; the publication and SELECT policies come from the migrations.

## Tencent Cloud

Enable basic speech synthesis and confirm the account can call `TextToVoice`. The teacher app offers five Chinese voices: 智瑜 `101001`, 智云 `101004`, 智燕 `101011`, 智辉 `101013` and 智甜 `101016`.

Synthesis uses `tts.tencentcloudapi.com`, API version `2019-08-23`, normal speed and 16 kHz WAV. Text over the per-call limit is split into chunks of at most 150 characters, and the PCM data is joined by parsing the RIFF chunks. The client prepends one second of silence so Bluetooth, HDMI or USB audio devices can wake up before speech starts. The whole synthesis has a 10-second limit; on failure the broadcast falls back to text only.

Preview clips are in `apps/teacher/public/voice-previews`. To regenerate them, configure `apps/classroom/Broadcast.Classroom/appsettings.local.json` locally, then run `node scripts/generate-voice-previews.mjs`. The script synthesizes only the fixed text "请Badger去吃饭".

Each classroom PC reads Tencent Cloud credentials and speech settings from `appsettings.json` next to the program, and calls Tencent Cloud directly after receiving a broadcast. The voice is chosen per broadcast, not in the classroom config. Audio is generated and played in client memory only and is never uploaded to Supabase.

## Teacher app

Fill in `apps/teacher/.env.local`:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_KEY
VITE_ADMIN_EMAIL=admin@broadcast.local
```

Restart the dev server. For a production build, run `npm --prefix apps/teacher run build`; the output in `apps/teacher/dist` can go on any static web server. Environment variables are baked in at build time, so rebuild after changing them.

Installing the PWA on a phone requires HTTPS; a phone cannot reach a Mac's localhost.

`.github/workflows/pages.yml` builds and deploys the teacher app on each push to `main`, using `/Broadcast/` as the base path for Vite, the manifest and the Service Worker. Before first use, select **GitHub Actions** as the source in the repository's Pages settings. The project URL and publishable key are public browser config and are already in the workflow; never put the service role or Tencent Cloud keys in it.

## Windows client

Fill in the distribution package's `appsettings.json`:

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

No EXE rebuild is needed. The file contains Tencent Cloud keys, so restrict read access to the program directory. The repository's `appsettings.json` is a safe template without keys; for local publishing, keep the full config in the ignored `appsettings.local.json`, which `scripts/publish-windows.sh` uses as the package's `appsettings.json`. After launch, pick a class; an admin can unbind a dead PC from the teacher app's device management.

For the first integration test, use at least one Windows x64 PC and complete receive, display, playback and history receipts with real Tencent Cloud audio.

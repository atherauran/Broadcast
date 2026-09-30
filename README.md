# Campus Classroom Broadcast System

A React + TypeScript PWA for teachers, a C# + Avalonia app for classrooms, and Supabase as the backend. Six fixed classes (8-1 to 8-6), one device per class.

The code includes real login, binding, heartbeat, broadcast, speech and receipt APIs. The production Supabase project, admin account, database migrations and cloud functions are configured, and the GitHub Pages workflow for the teacher app is ready. Still to do: enable GitHub Pages in the repository settings, and test on real Windows machines, phones and the classroom network.

## Layout

| Directory | Purpose |
| --- | --- |
| `apps/teacher` | Vite + React teacher app and PWA |
| `apps/classroom/Broadcast.Classroom` | Windows desktop app: tray, settings, fullscreen text, audio |
| `apps/classroom/Broadcast.Core` | Login session, Realtime, FIFO queue, expiry checks, receipt outbox |
| `supabase` | SQL migrations, Edge Function, auth and broadcast delivery |
| `scripts` | Local verification, icon generation, Windows packaging |
| `docs` | Setup, API contract and Windows guide |
| `artifacts` | Locally generated EXE, ZIP, static site and layout-check images (not committed) |

## Local development

Requires Node.js 24 and .NET SDK 10; Deno 2 is used for the cloud function checks. The teacher app runs without any cloud configuration.

```bash
cd apps/teacher
npm ci
cp .env.example .env.local
npm run dev
```

Open `http://127.0.0.1:5173`. The teacher app has a white and light-gray interface, with class selection, the input box and the send button on the home page. Sending is disabled when no backend is configured.

```bash
# From the project root
npm --prefix apps/teacher run build
dotnet run --project apps/classroom/Broadcast.Core.Tests
dotnet run --project apps/classroom/Broadcast.Visual.Tests -- artifacts/visual-qa
bash scripts/verify.sh
bash scripts/publish-windows.sh
```

If the SDK is not on PATH, set `DOTNET_BIN=/full/path/dotnet` for the scripts.
The Windows build is `artifacts/windows-x64/Broadcast.Classroom.exe`, and the distribution package is `artifacts/Broadcast.Classroom-win-x64.zip` (EXE, config and usage guide). The self-contained EXE needs no preinstalled .NET. The publish script packages the untracked `appsettings.local.json` if present, and falls back to the safe template otherwise.

## First-time setup (after cloning)

Two local config files are gitignored and must be created after cloning:

- `apps/teacher/.env.local`: copy `.env.example` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Both are public and match `supabase_url` and `supabase_anon_key` in `apps/classroom/Broadcast.Classroom/appsettings.json`.
- `apps/classroom/Broadcast.Classroom/appsettings.local.json`: copy `appsettings.json` from the same directory and fill in `tencent_tts.secret_id` and `secret_key`. Get the keys from the project owner or use your own Tencent Cloud account, and never commit them. Without them the classroom app still builds but cannot synthesize speech.

Logging in and sending broadcasts also requires the shared admin password from the project owner. By default the app connects to the production Supabase project; for a separate dev environment, follow the [cloud setup guide](docs/SETUP.md).

## Business rules

- Teachers log in with their name and the shared admin password. The name is saved and shown with each broadcast; it is stored only in the current browser, not in the shared admin account.
- A classroom's first binding requires admin verification, after which it uses its own device identity. Class occupancy is enforced by a database transaction and a unique constraint.
- While the Realtime subscription and heartbeat are healthy, a device reports every 60 seconds. The server treats a classroom as offline after 140 seconds without a valid heartbeat. If the teacher app itself is offline, status shows as unconfirmed.
- A broadcast is at most 300 Unicode characters and is valid for 30 seconds from its server-side creation time. Waiting for speech synthesis does not count against this.
- Common broadcast templates appear below the input box. Templates with blanks open a dialog to fill them in, then replace the input text.
- Classrooms play in FIFO order. A broadcast that hasn't started after 30 seconds is skipped; one that has started plays to the end. The server records started deliveries atomically, so a client restart never replays them.
- Each broadcast plays its speech 0–5 times (0 means text only). Repeats reuse one synthesis request, so there is no extra synthesis cost.
- Emotion can be happy, sad, angry, warning or normal; classrooms distinguish them with distinct text colors and emoji. Five Tencent Cloud Chinese voices are available.
- With auto-close, the message stays 3 seconds after audio ends normally. If speech fails or repeat is 0, it stays 10 seconds in total. With manual close, a large "关闭" (Close) button appears once playback finishes.
- Received, text displayed, audio started and audio finished are separate client receipts. "Played" means the software finished playing audio; it does not guarantee the classroom speaker was audible.
- Receipts are stored on disk while offline and submitted after reconnecting; late receipts never trigger replay. Rebinding does not transfer old deliveries to the new device.
- History keeps the text and per-class results. Resending creates a separate record with a new 30-second validity.

## Configuration and verification

See the [cloud setup guide](docs/SETUP.md), the [API contract](docs/CONTRACT.md) and the [Windows guide](docs/WINDOWS-GUIDE.md).

Automated tests use no real cloud accounts: Postgres rules run in the PGlite engine, the queue uses controllable speech and display fakes, and Avalonia layout is checked with headless rendering. Real cloud integration and Windows hardware and audio tests must be done after configuration.

`.github/workflows/pages.yml` tests, builds and publishes the teacher app on each `main` update. Before the first publish, set GitHub Actions as the source in the repository's Pages settings.

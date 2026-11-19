# Campus Classroom Broadcast System

A React + TypeScript PWA for teachers, a C# + Avalonia app for classrooms, and Supabase as the backend. Six fixed classes (8-1 to 8-6), one device per class, plus a Test class for the maintainer's test PC that the teacher app shows only to the maintainer account.

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
The Windows build is `artifacts/windows-x64/Broadcast.Classroom.exe`, and the distribution package is `artifacts/Broadcast.Classroom-win-x64.zip` (EXE, its native libraries, config and usage guide; keep the files together). The self-contained, ReadyToRun-compiled EXE needs no preinstalled .NET and extracts nothing at launch. A supervisor process restarts the app after any abnormal exit. The publish script packages the untracked `appsettings.local.json` if present, and falls back to the safe template otherwise.

## First-time setup (after cloning)

Two local config files are gitignored and must be created after cloning:

- `apps/teacher/.env.local`: copy `.env.example` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Both are public and match `supabase_url` and `supabase_anon_key` in `apps/classroom/Broadcast.Classroom/appsettings.json`.
- `apps/classroom/Broadcast.Classroom/appsettings.local.json`: copy `appsettings.json` from the same directory and fill in `tencent_tts.secret_id` and `secret_key`. Get the keys from the project owner or use your own Tencent Cloud account, and never commit them. Without them the classroom app still builds but cannot synthesize speech.

Logging in and sending broadcasts also requires the shared admin password from the project owner. By default the app connects to the production Supabase project; for a separate dev environment, follow the [cloud setup guide](docs/SETUP.md).

## Features

Details of every API and rule are in the [API contract](docs/CONTRACT.md); classroom-side behavior is in the [Windows guide](docs/WINDOWS-GUIDE.md).

- **Login**: teachers sign in with their name and the shared admin password; the name is saved in the browser and shown on everything they send. Homeroom teachers can claim their class with a personal password.
- **Binding**: a classroom PC binds to one class once (admin verified) and then logs in with its own device identity. Heartbeat every 120 seconds; offline after 270 seconds without one.
- **Broadcasts**: up to 300 characters, valid for 30 seconds from creation, played in FIFO order. Speech is synthesized on the classroom PC by Tencent Cloud (five voices, 0–4 repeats, five emotions) and never stored. Receipts (received, displayed, playing, played) are kept per class and survive offline periods. Fullscreen broadcasts during lessons ask for confirmation.
- **Banners**: text-only strip (up to 80 characters) at the top or bottom, on its own lane.
- **Screen items**: boards (themes, flag-raising button, drafts and scheduled publishing), notes, countdowns and day counts are server state shown in desktop windows and kept in memory only. The 正在显示 tab lists, removes, copies and edits them.
- **Class affairs (班务)**: weekly timetable, duty roster and student birthdays per class, with photo recognition (PaddleOCR running in the browser; the photo never leaves the device).
- **Devices (教室设备)**: bind status, unbind, hide a class's desktop, bazaar switch, and homeroom broadcast pauses.
- **File transfers**: one file up to 10 MiB to selected classes, saved to each PC's desktop; stored for 24 hours.
- **Bazaar statistics**: a realtime fundraising ranking window per class with an append-only ledger and corrections.

## Configuration and verification

See the [cloud setup guide](docs/SETUP.md), the [API contract](docs/CONTRACT.md) and the [Windows guide](docs/WINDOWS-GUIDE.md).

Automated tests use no real cloud accounts: Postgres rules run in the PGlite engine, the queue uses controllable speech and display fakes, and Avalonia layout is checked with headless rendering. Real cloud integration and Windows hardware and audio tests must be done after configuration.

`.github/workflows/pages.yml` tests, builds and publishes the teacher app on each `main` update. Before the first publish, set GitHub Actions as the source in the repository's Pages settings.

## License

The code is released under the [MIT License](LICENSE). Bundled third-party assets keep their own terms: the national anthem recording (from gov.cn) and the PaddleOCR models and runtime in `apps/teacher/public/ocr` are not covered by this license.

# Campus Classroom Broadcast System

A broadcast system for a school with six classes (8-1 to 8-6). Teachers send fullscreen announcements, banners, boards, notes and countdowns from a web app; each classroom PC shows them and reads announcements aloud. A seventh `Test` class is for the maintainer's test PC and is visible only to the maintainer account.

The teacher app is live at <https://atherauran.github.io/Broadcast/>.

## Components

| Directory | Purpose |
| --- | --- |
| `apps/teacher` | Teacher app: Vite + React + TypeScript PWA |
| `apps/classroom/Broadcast.Classroom` | Windows classroom app (Avalonia): tray, fullscreen windows, audio |
| `apps/classroom/Broadcast.Core` | Classroom logic: login, Realtime, delivery queue, receipt outbox |
| `apps/classroom/Broadcast.Core.Tests`, `Broadcast.Visual.Tests` | Logic tests and headless layout tests |
| `supabase` | Migrations, the `broadcast-api` Edge Function and database tests |
| `scripts` | Verification, Windows packaging, icon and asset generation |
| `docs` | [Setup](docs/SETUP.md), [API contract](docs/CONTRACT.md), [Windows guide](docs/WINDOWS-GUIDE.md) (Chinese) |

Supabase provides auth, Postgres, Realtime and storage. Speech is synthesized on each classroom PC by Tencent Cloud TTS and is never stored.

## Features

- **Broadcasts**: up to 300 characters, valid for 30 seconds, played in order with five voices, 0–4 repeats and five emotions. Each class reports received, displayed and played receipts, including after an offline period. A fullscreen broadcast during a lesson asks for confirmation.
- **Banners**: a text strip of up to 80 characters at the top or bottom of the screen.
- **Screen items**: boards (themes, flag-raising button, scheduled publishing), notes, countdowns and day counts. They are server state, kept in memory on the PC, and can be listed, copied, edited and removed together.
- **Class affairs**: a weekly timetable, duty roster and student birthdays per class. Teachers can add their own subjects, which every teacher can then pick, and edit the grade-wide lesson times. Photos of a printed timetable or birthday list are read in the browser with PaddleOCR.
- **Devices**: bind and unbind classroom PCs, hide a class's desktop, and let homeroom teachers pause other teachers' broadcasts to their class.
- **File transfers**: one file of up to 10 MiB to selected classes, saved to each PC's desktop.
- **Bazaar statistics**: a live ranking window with an append-only ledger and corrections.
- **Teacher feedback**: teachers submit requests and bugs in the app, and the maintainer replies there.

## Development

Requires Node.js 24, .NET SDK 10 and Deno 2.

```bash
cd apps/teacher
npm ci
cp .env.example .env.local   # fill in the values below
npm run dev                  # http://127.0.0.1:5173
```

Without a Supabase configuration the teacher app runs but cannot send anything.

Run all checks, or package the Windows app:

```bash
bash scripts/verify.sh            # teacher tests, build and lint; Deno and .NET tests; Windows build
bash scripts/publish-windows.sh  # artifacts/Broadcast.Classroom-win-x64.zip
```

Set `DOTNET_BIN` if `dotnet` is not on `PATH`. The Postgres rules are tested in PGlite, so no cloud account is needed.

### Local configuration

Two gitignored files are needed after cloning:

- `apps/teacher/.env.local`: copy `.env.example` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, which match `supabase_url` and `supabase_anon_key` in `apps/classroom/Broadcast.Classroom/appsettings.json`.
- `apps/classroom/Broadcast.Classroom/appsettings.local.json`: a copy of `appsettings.json` with `tencent_tts.secret_id` and `secret_key` filled in. Without them the classroom app cannot synthesize speech. Never commit it.

Signing in requires the shared admin password. For a separate backend, follow the [setup guide](docs/SETUP.md).

## Deployment

- **Teacher app**: `.github/workflows/pages.yml` tests, builds and publishes it to GitHub Pages on every push to `main`.
- **Backend**: `supabase db push` and `supabase functions deploy broadcast-api`; see the [setup guide](docs/SETUP.md).
- **Classroom app**: `scripts/publish-windows.sh` builds a self-contained Windows x64 package. It uses `appsettings.local.json` as the package's `appsettings.json` if present, so the package contains the Tencent Cloud keys.

## License

[MIT](LICENSE). The bundled national anthem recording (from gov.cn) and the PaddleOCR models and runtime in `apps/teacher/public/ocr` keep their own terms and are not covered by it.

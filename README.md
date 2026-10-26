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

## Business rules

- Teachers log in with their name and the shared admin password. The name is saved and shown with each broadcast; it is stored only in the current browser, not in the shared admin account.
- A classroom's first binding requires admin verification, after which it uses its own device identity. Class occupancy is enforced by a database transaction and a unique constraint.
- While the Realtime subscription and heartbeat are healthy, a device reports its status every 120 seconds, and sends a lightweight Realtime keepalive every 20 seconds. The server treats a classroom as offline after 270 seconds without a valid heartbeat. If the teacher app itself is offline, status shows as unconfirmed.
- A broadcast is at most 300 Unicode characters and is valid for 30 seconds from its server-side creation time. Waiting for speech synthesis does not count against this.
- Common broadcast templates appear below the input box. Templates with blanks open a dialog to fill them in, then replace the input text.
- Classrooms play in FIFO order. A broadcast that hasn't started after 30 seconds is skipped; one that has started plays to the end. The server records started deliveries atomically, so a client restart never replays them.
- Each broadcast plays its speech 0–4 times (0 means text only). Repeats reuse one synthesis request, so there is no extra synthesis cost.
- Emotion can be happy, sad, angry, warning or normal; classrooms distinguish them with distinct text colors and emoji. Five Tencent Cloud Chinese voices are available.
- With auto-close, the message stays 3 seconds after audio ends normally. If speech fails or repeat is 0, it stays 10 seconds in total. With manual close, a large "关闭" (Close) button appears once playback finishes. A newer broadcast interrupts one that is only waiting to be closed; when the newer one closes, the earlier one comes back and keeps waiting.
- Received, text displayed, audio started and audio finished are separate client receipts. "Played" means the software finished playing audio; it does not guarantee the classroom speaker was audible.
- Receipts are stored on disk while offline and submitted after reconnecting; late receipts never trigger replay. Rebinding does not transfer old deliveries to the new device.
- History keeps the text and per-class results. Resending creates a separate record with a new 30-second validity.
- Teachers pick a type first: 全屏广播 (fullscreen alert), 横幅 (banner), 公告板 (board), 便签 (note) or 倒计时 (countdown). Everyone can send to any class and remove any item. Everything sent carries the signed-in teacher's name; the 署名 field beside the send button changes it for one send, for example when sending for another teacher.
- A fullscreen broadcast or fullscreen countdown sent during a lesson asks first (现在是上课时间…确认要发布吗？). Lesson times are fixed for Monday to Friday, whatever the class: 8:30–9:10, 9:25–10:05, 10:20–11:00, 11:15–11:50, 12:40–13:20, 13:35–14:15, 14:30–15:10, 15:25–16:05 and 16:20–17:00 (16:15–16:55 on Wednesday).
- A banner is a text-only strip (at most 80 characters) at the top or bottom of the screen. It uses the broadcast pipeline with the same 30-second start validity, shows for 15 seconds, and a newer banner replaces the current one. Banners have their own lane, so they never delay a fullscreen broadcast, and an open fullscreen broadcast stays above them.
- Boards, notes and countdowns are screen state held by the server, not messages. The classroom keeps them in memory only (nothing on disk, so DeepFreeze is fine), refreshes them on every status heartbeat and on each change, and hides them on time using its server-calibrated clock. Items show as soon as they are published and end by default at the end of that day; the end date is picked from a calendar up to a year ahead.
- Boards and notes are normal windows: a slideshow or video covers them during class and they reappear at break. When a fullscreen app or presentation is running, a new board or note opens behind it without taking focus. A board (up to 12 lines of 300 characters) picks one of six backgrounds (简洁, 节日 with fireworks, 欢快 with confetti, 清新 with leaves, 科技 with circuit lines, 提醒 with hazard tape), drawn faintly around the edges; all boards share one window, which takes the newest board's background. Boards are not read aloud. A note holds up to 300 characters in one of four sizes (小, 标准, 大, 特大) and scrolls inside its card when it is too long for the screen. A class shows at most 12 notes at once, in as many columns as the screen height needs.
- A countdown is a small topmost timer at the top of the screen's second column from the right, or a fullscreen one the classroom can shrink to the corner, set by duration or end time, computed on the server clock. Each class has one at a time, a new one replaces the old, and at zero it stays 5 seconds before closing. A day count (up to 3 per class) counts calendar days to a date; day counts stack at the top right, above the timetable, and other windows can cover them.
- Everything sits on the right: day counts over the timetable at the edge, and the timer over the notes in the column beside them (which moves up to the edge when the edge column is empty). Notes continue in a new column to the left when they run out of height. Edge windows find their place again when the screen or projector resolution changes.
- The "课表/值日" tab sets each class's Monday–Friday timetable from a fixed subject list (plus lunch) and its duty roster (jobs such as 白板 or 扫地, with names per weekday). The classroom shows today's lessons down the right edge, below the day counts, switches at midnight on its own and shows nothing on weekends. Today's duties appear as a blue 今日值日 card at the top of the notes column, built by the server from the roster (classroom apps older than the card show it as a green note).
- A note can also be scheduled to appear at a set time; it waits in the "正在显示" list until then. A board can be saved as a draft or scheduled to appear at a set time; drafts and scheduled boards are listed below the board composer, shared by all teachers, and open back into the composer for editing. The "晨会通知" template sets the title and ends the board at 08:30 on the day it appears.
- A board can add a 升国旗 button. Pressing it in the classroom opens a fullscreen waving flag while the national anthem plays once (the official wind band recording from gov.cn, bundled with the app), and closes a few seconds after the anthem ends, or at once on a tap or Esc.
- The 生日 tab keeps each class's student birthdays (name and month/day only, pasteable from a spreadsheet). On a birthday the classroom shows a birthday card at the top of the notes column all day, and Friday also greets Saturday's and Sunday's birthdays. A board titled 晨会通知 then adds a 生日祝贺 button that opens a short fullscreen greeting with confetti and a Happy Birthday tune (generated by `scripts/birthday-song.py`).
- The 教室设备 page (gear icon) has a 隐藏桌面 button per class that clears that classroom's desktop in one click: boards, notes, countdowns, the timetable, duties and birthdays disappear and come back unchanged on 恢复桌面. Fullscreen alerts and banners still play. Older classroom apps follow within about 40 seconds.
- The 课程表 and 生日 tabs can read a photo of the printed timetable or birthday list (拍照识别). Recognition runs in the browser with PaddleOCR's PP-OCRv4 models (`apps/teacher/public/ocr`, about 30 MB with the runtime, loaded on first use), so the photo never leaves the device; the result only fills the editor for the teacher to check and save. Timetable lessons are read by their English code (E is English, M is math, OPT is elective and so on), with lunch after the morning.
- The "正在显示" tab lists each class's current items with author and end time, together with the class's online state, and lets any teacher tick items, across classes or every class an item was sent to, and remove them together, copy them to other classes (same content, start and end, under the copying teacher's name), or edit their content and end time when they all show the same thing. Editing only some of the classes an item was sent to splits those classes off as an item of their own.

## Configuration and verification

See the [cloud setup guide](docs/SETUP.md), the [API contract](docs/CONTRACT.md) and the [Windows guide](docs/WINDOWS-GUIDE.md).

Automated tests use no real cloud accounts: Postgres rules run in the PGlite engine, the queue uses controllable speech and display fakes, and Avalonia layout is checked with headless rendering. Real cloud integration and Windows hardware and audio tests must be done after configuration.

`.github/workflows/pages.yml` tests, builds and publishes the teacher app on each `main` update. Before the first publish, set GitHub Actions as the source in the repository's Pages settings.

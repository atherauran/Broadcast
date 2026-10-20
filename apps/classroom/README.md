# Classroom display compatibility

The classroom app accepts old display-state payloads and the updated teacher controls:

- Notes retain their full text, including 300 Unicode scalar values, emoji and newlines. The server enforces the input limit; the desktop does not truncate received content. Optional numeric `content.font_size` selects 18–48 DIPs, including fractional sizes. Missing sizes keep the existing 20 DIP appearance; out-of-range finite values clamp to the range. Long cards scroll vertically without shrinking the chosen font. When many cards exceed the available screen width, the note columns scroll horizontally.
- Boards traverse `content.entries` in the received array order, including after drag sorting. Optional `content.signature` is used in the footer. New teacher-created boards supply the default `班主任`; old payloads with no signature, null or blank still show `teacher_name`. The existing ordering/background of multiple boards remains unchanged.
- Synthetic notes marked `content.duty: true` use a distinct blue duty card with a heading and divider, rather than an ordinary green note. Legacy synthetic notes are recognized only by both `teacher_name: 今日值日` and `starts_at: 2000-01-01T00:00:00Z`; an ordinary green note or a teacher with the same name is not enough.
- `content.hidden: true` is excluded from visible state without mutating the desired payload. A later update with `hidden: false` restores its text and order. Schedule JSON remains the existing week array: the server sends `schedule: null` while hidden and sends the preserved week again on restore. No new schedule object format is required.

Fullscreen alerts and banners keep their existing delivery, audio, receipt, expiry and focus behavior. These changes affect display state, not the alert pipeline.

## Local verification on D:

```powershell
$env:DOTNET_CLI_HOME='D:\Codex\Temp\Broadcast-dotnet-home'
$env:NUGET_PACKAGES='D:\Codex\Temp\Broadcast-nuget'
$env:NUGET_HTTP_CACHE_PATH='D:\Codex\Temp\NuGetHttpCache'
$env:NUGET_PLUGINS_CACHE_PATH='D:\Codex\Temp\NuGetPlugins'
$env:TEMP='D:\Codex\Temp'
$env:TMP=$env:TEMP
& D:\Codex\Tools\dotnet10\dotnet.exe run --project apps/classroom/Broadcast.Core.Tests
& D:\Codex\Tools\dotnet10\dotnet.exe run --project apps/classroom/Broadcast.Visual.Tests -- D:\Codex\Temp\Broadcast-desktop-visual
```

Use the repository's original lock files. A previous win-x64 publish can leave runtime/linker entries in those lock files, so local non-publish restore may report a lock mismatch; preserve the originals if a local verification restore rewrites them. Tests use local fakes/headless Avalonia and no production Supabase or credentials. The visual tests load the production Fluent theme, exercise actual ScrollViewer viewports, scroll to the last line, and render 150%/200% images. This is headless layout/rendering evidence, not a real Windows DPI-switch or classroom projector/focus test.

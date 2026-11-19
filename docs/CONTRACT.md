# API Contract

All times are UTC ISO 8601 and all IDs are UUIDs. Broadcast text is limited to 300 Unicode code points. Admin status comes from Supabase Auth's `app_metadata.role=admin`. The device UID is `devices.id`, and the active binding is determined by `classrooms.device_id`. Besides 8-1 to 8-6 there is a `Test` classroom for testing; the server treats it like any class (so up to 7 classes per request), and the teacher app hides it and everything sent only there from every account but the maintainer.

## Edge Function

Endpoint: `POST /functions/v1/broadcast-api`, with `Authorization: Bearer <access_token>` and `apikey` headers. Requests and responses are JSON. Errors are returned as `{ "error": "<readable message>" }`.

| action | Other request parameters | Result |
| --- | --- | --- |
| `register-device` | `classroom_id`, `name` | Supabase `session`, `classroom_id`, and the device's fixed login `credential` (`id`, `email`, `password`) |

`register-device` is admin-only. Broadcasts are sent through the `create_broadcast` RPC below: a banner must have a body of at most 80 characters, `repeat_count` 0 and `auto_close` true, and requests are deduplicated by `p_id`, so a retry of the same logical request must keep its ID and an explicit resend uses a new one. Neither the Edge Function nor the database generates, stores or returns audio.

## Database RPCs

| RPC | Parameters | Returns / access |
| --- | --- | --- |
| `classroom_status` | none | `{server_now, classrooms}`, each with `id`, `device_id`, `device_name`, `last_seen_at`, `connected` and `screen_hidden`; admin |
| `bind_device` | `p_device`, `p_classroom`, `p_name` | empty; admin or server |
| `unbind_device` | `p_classroom` | empty; admin |
| `set_screen_hidden` | `p_classroom`, `p_hidden` | empty; admin. Sets `classrooms.screen_hidden` (see Hidden desktop) |
| `device_heartbeat` | `p_connected` | `{active, classroom_id, server_now, display, schedule, birthdays}`; current device. `display`, `schedule` and `birthdays` are the same as in `display_state` |
| `pending_broadcasts` | none | `{server_now, items}`; only this device's current class, not started and not expired |
| `start_delivery` | `p_delivery` | boolean; the server atomically checks the binding, the 30-second validity and that it hasn't started |
| `ack_delivery` | `p_delivery`, `p_event`, `p_at`, nullable `p_error` | empty; this device's receipt, safe to retry |
| `broadcast_history` | nullable `p_before`, nullable `p_id` | up to 20 broadcasts with nested `deliveries`; admin |
| `create_display_item` | `p_request`, `p_kind`, `p_classrooms`, `p_content`, `p_teacher_name`, nullable `p_ends_at`, nullable `p_duration_seconds`, nullable `p_starts_at` | the request ID; admin, idempotent per request |
| `copy_display_items` | `p_request`, `p_ids`, `p_classrooms`, `p_teacher_name` | empty; admin. Creates each given live item's request again (one per request, same kind, content, start and end) for the given classes; each copy's request ID is `md5(p_request ‖ source request)`, so a retry is idempotent |
| `remove_display_items` | `p_ids` | empty; admin. Removes the given items in one request |
| `update_display_items` | `p_ids`, `p_content`, `p_ends_at` | empty; admin. Replaces the content and end of live items of one kind |
| `save_board_draft` | `p_id`, `p_content`, `p_classrooms`, `p_teacher_name`, nullable `p_ends_at`, nullable `p_publish_at` | empty; admin. Saves a board draft, or schedules it when `p_publish_at` is set (see Board drafts) |
| `delete_board_draft` | `p_id` | empty; admin. Deletes a draft or a scheduled board that has not appeared yet |
| `display_overview` | none | `{server_now, items}`: every live or scheduled item in all classes; admin |
| `display_state` | none | `{server_now, items, schedule, birthdays}`: this device's class items with `id`, `kind`, `content`, `starts_at`, `ends_at`, `teacher_name`, its class's week (see Schedules) or null, and its class's birthday list or null |
| `set_schedule` | `p_classroom`, `p_days`, `p_teacher_name`, nullable `p_duties` | empty; admin. Replaces the class's week, and its duty roster unless `p_duties` is null |
| `set_birthdays` | `p_classroom`, `p_students`, `p_teacher_name` | empty; admin. Replaces the class's birthday list (see Birthdays) |

`create_broadcast` is an admin RPC called by the teacher app with `p_id`, `p_body`, `p_classrooms`, `p_source`, `p_teacher_name`, `p_repeat_count` (0–4), `p_auto_close`, `p_emotion`, `p_voice_type`, `p_style` and `p_banner_position`. It validates every field, is idempotent per `p_id`, and writes the broadcast and all class deliveries in one transaction.

Each item in `pending_broadcasts.items` has `delivery_id`, `broadcast_id`, `body`, `teacher_name`, `repeat_count`, `auto_close`, `emotion`, `voice_type`, `style`, `banner_position`, `created_at` and `expires_at`. The query takes no device ID; the server identifies the device from its JWT. The classroom client calls Tencent Cloud TTS directly with `body` and `voice_type` and plays the WAV locally, reusing the same WAV when `repeat_count` is above 1.

`emotion` is one of `normal`, `happy`, `sad`, `angry`, `warning`. `voice_type` is one of `101001`, `101004`, `101011`, `101013`, `101016`. The teacher app ships a fixed WAV preview for each voice, all saying "请Badger去吃饭", so previews never call Tencent Cloud or Supabase.

Receipt events are `received`, `displayed`, `playing`, `played`, `audio_failed`, `finished` and `failed`. Each field stores the time of the first such event; a receipt cannot overwrite an existing time or update the table directly. `played` requires the delivery to have started and a `playing` receipt to exist. Times come from the client's server-calibrated clock, and the server rejects clearly future times.

## Display items

`display_items` holds one row per class for each board, note or countdown: `request_id`, `classroom_id`, `kind`, `content`, `starts_at`, `ends_at`, `teacher_name`, `created_by`, `created_at` and nullable `removed_at`. Devices may select only their current class's rows (removed rows included, so Realtime delivers removals). Every write goes through the admin RPCs above.

`content` by kind:
- board: `{title, entries, theme, flag}`, with title at most 30 characters (default 公告), 1–12 entries of at most 300 characters each, theme `plain` (default), `festive`, `joyful`, `fresh`, `tech` or `safety`, and optional boolean `flag` (default false). All boards share one window, which uses the newest board's theme and shows the flag-raising button when any of them has `flag`.
- note: `{text, color, font_size}`, with text 1–300 characters, color `yellow`, `blue`, `green` or `pink`, and optional integer `font_size` 18–28 (stored as 20 when omitted; the teacher app offers 18, 20, 24 and 28).
- countdown: `{label, fullscreen}`, label at most 20 characters; `fullscreen` is optional and defaults to false. A day count adds `date` (`YYYY-MM-DD`, `fullscreen` must be false): the device shows the calendar days left on its local date, "今天" on the day itself.

Every item starts when it is created (`starts_at` is the server time), unless `p_starts_at` sets a later start (not for countdowns) or it is a scheduled board; the end must fall in the future and within 400 days. A countdown takes either `p_duration_seconds` (60–43200, counted on the server clock) or `p_ends_at`, and replaces any live countdown of the same type in its classes. A day count (`content.date`) must be sent with `p_ends_at` (the end of that date) up to 400 days ahead, is not subject to the 12-hour limit, and never replaces anything: up to 3 day counts can be live per class (a fourth is refused), and a timed countdown replaces only another timed one. The device shows the day counts (soonest first) at the top right, above the timetable, in a desktop window that other windows can cover. Beside that column sit the newest timed countdown in its own topmost window and, below it, the notes (oldest first) in a desktop window that other windows can cover, starting a new column to the left when the screen height runs out. A note is refused when 12 notes of a target class would overlap its time on screen. Device queries keep a countdown for 5 seconds past `ends_at`.

## Schedules

### Board drafts

`board_drafts` holds unpublished boards: `id`, validated board `content`, `classrooms` (possibly empty), nullable `ends_at` (null means the end of the day it is published), `teacher_name`, `updated_by` and `updated_at`. Only admins can read it. `save_board_draft` keeps one board under `p_id`: without `p_publish_at` it is a draft row; with it the draft row is deleted and the board becomes `display_items` rows with `request_id = p_id` and `starts_at = p_publish_at`, which need classes and an end after the publish time. Saving again replaces the earlier draft or pending rows, so a board can move between draft and scheduled; once its `starts_at` has passed it can no longer be saved or deleted that way. Devices already hide items until `starts_at`, so a scheduled board needs no server job and appears on time from the classroom's calibrated clock.

`update_display_items` changes live items in place, so the device keeps them by id. Timed countdowns keep the 12-hour limit.

`schedules` holds one row per class: `classroom_id`, `days`, `duties`, `teacher_name`, `updated_by` and `updated_at`. `days` is an array of five arrays (Monday to Friday) of up to 12 subject ids each, from `english`, `chinese`, `math`, `physics`, `biology`, `chemistry`, `history`, `pe`, `morality`, `art`, `it`, `elective`, `club` and `lunch`. Admins read every row and devices only their class's; writes go through `set_schedule`. The device shows the list for its local weekday down the right edge of the screen below the day counts, in a desktop window like notes, and nothing on weekends or on an empty day.

`duties` is an array of up to 8 `{task, days}`: task 1–10 characters and `days` five name strings (Monday first, at most 40 characters, `''` for nobody). On a weekday by Asia/Shanghai time, `display_state` and `device_heartbeat` put one synthetic note first in the items: id `md5(classroom ‖ date)`, `content` `{text, color: 'green', duty: true}` with one `task：names` line per job that has names that day, `teacher_name` `今日值日`, `starts_at` 2000-01-01 (so the device, which orders notes by start, puts it first) and `ends_at` the next midnight. It is not a `display_items` row, so it never counts toward the note limit or appears in `display_overview`.

### Birthdays

`birthdays` holds one row per class: `classroom_id`, `students`, `teacher_name`, `updated_by` and `updated_at`. `students` is an array of up to 80 `{name, date}`, name 1–40 characters and date `MM-DD` (02-29 allowed); no birth year is stored. Admins read every row and devices only their class's; writes go through `set_birthdays`. On the PC's local date the device greets that day's birthdays, and on Friday also Saturday's and Sunday's; a 02-29 birthday falls on 02-28 in other years. It shows them as a card at the top of the notes column, and a board titled 晨会通知 (the teacher app's morning meeting template) gets a button that plays a fullscreen greeting.

## Hidden desktop

`classrooms.screen_hidden` (default false) clears a class's desktop without touching its data: while it is set, `display_state` and `device_heartbeat` return no items (the duty note included) and null `schedule` and `birthdays`; clearing it brings everything back as it was. Fullscreen alerts and banners are unaffected. The classroom subscribes to `classrooms` UPDATEs and refreshes at once.

## Homeroom teachers

`homerooms` lists at most one homeroom teacher per class: `classroom_id`, `teacher_name`, `aliases` (other names they sign with), nullable `user_id` and `claimed_at`. Rows are entered by hand in Supabase (not in migrations, since this repository is public). Clients have no table access; names match through `name_key`, which ignores case, spaces and dots.

- `homeroom_for_name(p_name)` (anon and authenticated) returns `{classroom_id, claimed}` or null. The login page uses it to try `homeroom-<class>@broadcast.local` before the shared admin and maintainer accounts; the teacher app uses it to prompt an unclaimed homeroom teacher on the shared account to set a password.
- The Edge Function action `claim-homeroom` (`classroom_id`, `password`, 6–72 characters, not the caller's shared password) is admin-only. It creates the class's admin account, stores it in `user_id` once (a class cannot be claimed twice) and returns its `session`, which the teacher app adopts without a new sign-in. To reset a claim, delete that Auth user; `user_id` then becomes null.
- `can_manage(class)`: any admin while the class is unclaimed, then only its homeroom account and the maintainer. `set_screen_hidden`, `set_schedule` and `set_birthdays` require it.
- `set_broadcast_mute(p_classroom, p_from, p_until)` is for the class's homeroom account and the maintainer only. It stores `classrooms.mute_from`/`mute_until` (null `p_from` means now, null `p_until` lifts the pause; the end must be in the future, within 400 days). During the range, `create_broadcast` from anyone else leaves the class out of the deliveries, and refuses a request whose targets are all paused. Display items and files are unaffected.
- `classroom_status` adds `mute_from`, `mute_until`, `manage`, `own` (homeroom account or maintainer) and `homeroom` (`{teacher_name, claimed, mine}` or null) to each class.

`create_broadcast`, `set_schedule` and `set_birthdays` wrap internal `*_unchecked` functions that clients cannot call.

## Teacher names

`p_teacher_name` on `create_broadcast`, `create_display_item` and `save_board_draft` is the name the classroom shows. The teacher app sends the signed-in teacher's name unless the teacher types another one into the 署名 field for that send.

## Realtime and presence

The teacher app subscribes to Postgres Changes on `devices`, `classrooms` and `deliveries`. The teacher app also subscribes to `display_items`, `board_drafts`, `schedules` and `birthdays`. The classroom app subscribes to `deliveries` INSERTs over Supabase's Phoenix v1 JSON protocol, filtered by `device_id=eq.<UID>`, and RLS then checks the current class. It also subscribes to all `display_items`, `schedules` and `birthdays` changes and `classrooms` UPDATEs without a filter, which RLS limits to its class; such a change triggers one `display_state` query. WebSocket messages only trigger a query for valid deliveries; they never bypass the database's validity and binding checks.

After the subscription succeeds, the classroom starts reporting heartbeats: every 20 seconds it sends a Phoenix keepalive over the WebSocket and waits for the ack (Supabase requires one at least every 25 seconds; it does no database work). Every 120 seconds it also reports the device heartbeat, whose response carries the display state, and the server marks a classroom offline after 270 seconds without a valid heartbeat. Reconnects back off to about 10 seconds and, once restored, query for unexpired messages. Every 40 seconds a healthy connection also re-queries valid deliveries, so a single lost notification is not missed.

`start_delivery` is the persistent gate against duplicate playback. If the gate was written but the app crashed before displaying, the message is not replayed; history keeps the start record and waits for a completion receipt, and one missing for over 5 minutes shows "结果待确认" (result unconfirmed). This favors never replaying over crash recovery, and an unknown outcome is never shown as played.

Receipts and online status are shown separately. The 30-second validity limits only when playback may start; it never interrupts a broadcast already playing. Reconnecting can only recover deliveries and submit receipts, and never replays a message that has started.

## File transfers

File transfers are separate from broadcasts and display items. `file_transfers` stores the original Windows-compatible filename, byte size, target classes, teacher, immutable object path (`<request UUID>/file`), creation/send/expiry times and `deleted_at`. `file_deliveries` stores one row per target, bound to the device at send time, with `received_at`, `downloaded_at`, `failed_at`, `saved_name` and `error`. Rebinding a classroom does not give its new device an earlier file.

Teacher RPCs (admin only):

- `prepare_file_transfer(p_id, p_filename, p_size, p_classrooms, p_teacher_name)` reserves a request and returns `{path, uploaded, sent}`. Retries reuse the reservation and any completed upload. Files must be 1 byte–10 MiB, with at most 200 MiB of outstanding reservations/stored files. Windows-invalid filenames are rejected. Upload the bytes directly to the private `classroom-files` bucket with the teacher JWT and `upsert: false`.
- `send_file_transfer(p_id)` checks that the uploaded object has the reserved size and all target classes are bound, then creates the deliveries atomically. Offline bound devices are allowed. Repeated calls return the same ID. Downloads are valid for 24 hours after sending.
- `file_transfer_history(p_before = null, p_id = null)` returns up to 20 sent transfers, newest first, with nested deliveries. An ID fetch refreshes an individual record after a Realtime update.

Device RPCs:

- `pending_file_transfers()` returns `{server_now, items}` with `delivery_id`, `transfer_id`, `filename`, `size_bytes`, `object_path` and `expires_at`, restricted to unfinished transfers assigned to the currently bound device/class.
- `ack_file_delivery(p_delivery, p_event, p_at, p_error = null, p_saved_name = null)` records `received`, `downloaded` or `failed`. Terminal results cannot replace each other. A downloaded receipt requires the saved filename. Device/time checks match broadcast receipts.

Storage INSERT is restricted to an admin's own unpublished reservation, less than one hour old. There is no client UPDATE or DELETE policy. Storage SELECT requires an active, unfinished transfer assigned to the authenticated device's current classroom. Neither public objects nor signed public download links are used.


The classroom subscribes to `file_deliveries` INSERTs on its existing Realtime connection and rechecks on reconnect/every 40 seconds. Downloads run separately from announcements. The file streams to a temporary desktop file (maximum declared size, five-minute timeout), is length-checked, and moves to the final desktop filename without overwriting. Existing names gain `(1)`, `(2)`, etc. A local per-delivery destination/completion marker and the existing durable receipt outbox prevent duplicate copies after a lost receipt or process restart. The client never opens a received file. A download failure is terminal and shown to the teacher; sending the file again creates a new transfer.

Every 15 minutes, `pg_cron`/`pg_net` invoke `broadcast-api` with a dedicated random token kept in Vault. The service-role-only `file_cleanup_candidates` RPC verifies this token, marks transfers unavailable when expired, abandoned for one hour, or terminal for every target, and returns up to 100 eligible Storage paths. The Edge Function deletes them through the Storage API, which removes the actual bytes as well as their metadata. Failed deletion remains eligible for the next run; orphaned and late-finishing uploads are covered too. Transfer/receipt history stays in Postgres. The cleanup migration's function URL must match the deployed project when reproducing this setup elsewhere.

## Bazaar statistics

`classrooms.bazaar_enabled` defaults to true and is included in `classroom_status`. The admin-only `set_bazaar_enabled(p_classroom, p_enabled)` controls the statistics window. `screen_hidden` also hides it. Neither switch deletes income.

The classroom input asks for the group leader’s name (up to 29 characters) and appends `组` when saving `group_name`: 张三 becomes 张三组. Selecting an existing group or correcting an entry removes the final `组` when filling the leader field, so saving again keeps the same group name.

`bazaar_entries` is an append-only class ledger: request UUID `id`, `classroom_id`, `group_name` (trimmed, 1–30 characters), integer `amount`, server timestamps `occurred_at` and `recorded_at`, `recorded_by`, and nullable unique `replaces_id`. RLS allows teachers to read all rows and bound devices to read only their current class. Authenticated clients have no direct INSERT/UPDATE/DELETE privileges.

- Device RPC `record_bazaar_income(p_id, p_group, p_amount, p_replaces = null)` derives the class from the current device binding. New income must be a multiple of 5, from 5 to 1,000,000 tokens. A correction references a current entry in the same class and supplies its complete replacement group/amount (0–1,000,000, in multiples of 5; 0 cancels it). Original rows are retained. Corrections inherit the original `occurred_at`, while `recorded_at` records when the correction was saved. A chain can be corrected again, including restoring a cancellation. Only one successor is allowed per entry; a stale competing correction is rejected. Identical request retries succeed without inserting another row; a reused ID with different values is rejected.
- Device RPC `bazaar_state()` returns `{classroom_id, enabled, entries}` or null for an unbound device. `enabled` combines `bazaar_enabled` and `screen_hidden`; the full ledger is returned even when hidden. There is no daily reset. A replacement device reads the same class history.

Totals and rankings use only entries with no successor; the cumulative curve groups these effective amounts by the original sale time. A correction therefore replaces the original contribution in the curve instead of appearing as another sale. Equal totals sort by group name. Zero-value groups remain visible.

The classroom subscribes to `bazaar_entries` INSERTs on its existing Realtime socket, without a filter (RLS restricts the class), and re-fetches on changes, classroom UPDATEs, reconnect and the 40-second recovery check. Income synchronization runs separately from broadcasts and file downloads. The input window retains a request's ID and values after an uncertain network result and offers retry. No offline income queue is stored on disk: successful saves require a server response. Statistics windows are normal desktop windows, never topmost; a local close is reversible via the tray menu.



# API Contract

All times are UTC ISO 8601 and all IDs are UUIDs. Broadcast text is limited to 300 Unicode code points. Admin status comes from Supabase Auth's `app_metadata.role=admin`. The device UID is `devices.id`, and the active binding is determined by `classrooms.device_id`.

## Edge Function

Endpoint: `POST /functions/v1/broadcast-api`, with `Authorization: Bearer <access_token>` and `apikey` headers. Requests and responses are JSON. Errors are returned as `{ "error": "<readable message>" }`.

| action | Other request parameters | Result |
| --- | --- | --- |
| `register-device` | `classroom_id`, `name` | Supabase `session`, `classroom_id`, and the device's fixed login `credential` (`id`, `email`, `password`) |

`register-device` is admin-only. Broadcasts are sent through the `create_broadcast` RPC below: a banner must have a body of at most 80 characters, `repeat_count` 0 and `auto_close` true, and requests are deduplicated by `p_id`, so a retry of the same logical request must keep its ID and an explicit resend uses a new one. Neither the Edge Function nor the database generates, stores or returns audio.

## Database RPCs

| RPC | Parameters | Returns / access |
| --- | --- | --- |
| `classroom_status` | none | `{server_now, classrooms}`; admin |
| `bind_device` | `p_device`, `p_classroom`, `p_name` | empty; admin or server |
| `unbind_device` | `p_classroom` | empty; admin |
| `device_heartbeat` | `p_connected` | `{active, classroom_id, server_now, display}`; current device. `display` is the same item list as `display_state` |
| `pending_broadcasts` | none | `{server_now, items}`; only this device's current class, not started and not expired |
| `start_delivery` | `p_delivery` | boolean; the server atomically checks the binding, the 30-second validity and that it hasn't started |
| `ack_delivery` | `p_delivery`, `p_event`, `p_at`, nullable `p_error` | empty; this device's receipt, safe to retry |
| `broadcast_history` | nullable `p_before`, nullable `p_id` | up to 20 broadcasts with nested `deliveries`; admin |
| `create_display_item` | `p_request`, `p_kind`, `p_classrooms`, `p_content`, `p_teacher_name`, nullable `p_ends_at`, nullable `p_duration_seconds` | the request ID; admin, idempotent per request |
| `remove_display_item` | `p_id`, `p_all` (default false) | empty; admin. `p_all` removes the item from every class of the same request |
| `display_overview` | none | `{server_now, items}`: every live item in all classes; admin |
| `display_state` | none | `{server_now, items}`: this device's class items with `id`, `kind`, `content`, `starts_at`, `ends_at`, `teacher_name` |

`create_broadcast` is an admin RPC called by the teacher app with `p_id`, `p_body`, `p_classrooms`, `p_source`, `p_teacher_name`, `p_repeat_count` (0–4), `p_auto_close`, `p_emotion`, `p_voice_type`, `p_style` and `p_banner_position`. It validates every field, is idempotent per `p_id`, and writes the broadcast and all class deliveries in one transaction.

Each item in `pending_broadcasts.items` has `delivery_id`, `broadcast_id`, `body`, `teacher_name`, `repeat_count`, `auto_close`, `emotion`, `voice_type`, `style`, `banner_position`, `created_at` and `expires_at`. The query takes no device ID; the server identifies the device from its JWT. The classroom client calls Tencent Cloud TTS directly with `body` and `voice_type` and plays the WAV locally, reusing the same WAV when `repeat_count` is above 1.

`emotion` is one of `normal`, `happy`, `sad`, `angry`, `warning`. `voice_type` is one of `101001`, `101004`, `101011`, `101013`, `101016`. The teacher app ships a fixed WAV preview for each voice, all saying "请Badger去吃饭", so previews never call Tencent Cloud or Supabase.

Receipt events are `received`, `displayed`, `playing`, `played`, `audio_failed`, `finished` and `failed`. Each field stores the time of the first such event; a receipt cannot overwrite an existing time or update the table directly. `played` requires the delivery to have started and a `playing` receipt to exist. Times come from the client's server-calibrated clock, and the server rejects clearly future times.

## Display items

`display_items` holds one row per class for each board, note or countdown: `request_id`, `classroom_id`, `kind`, `content`, `starts_at`, `ends_at`, `teacher_name`, `created_by`, `created_at` and nullable `removed_at`. Devices may select only their current class's rows (removed rows included, so Realtime delivers removals). Every write goes through the admin RPCs above.

`content` by kind:
- board: `{title, entries, speak, voice_type}`, with title at most 30 characters (default 公告) and 1–12 entries of at most 300 characters each.
- note: `{text, color}`, with text 1–60 characters and color `yellow`, `blue`, `green` or `pink`.
- countdown: `{label, fullscreen}`, label at most 20 characters; `fullscreen` is optional and defaults to false. A day count adds `date` (`YYYY-MM-DD`, `fullscreen` must be false): the device shows the calendar days left on its local date, "今天" on the day itself.

Every item starts when it is created (`starts_at` is the server time); the end must fall in the future and within 7 days. A countdown takes either `p_duration_seconds` (60–43200, counted on the server clock) or `p_ends_at`, and replaces any live countdown of the same type in its classes. A day count (`content.date`) must be sent with `p_ends_at` (the end of that date) up to 400 days ahead, is not subject to the 7-day and 12-hour limits, and is replaced only by another day count; a timed countdown takes the corner while it runs. A note is refused when a target class already shows 4 notes. Device queries keep a countdown for 5 seconds past `ends_at`.

## Realtime and presence

The teacher app subscribes to Postgres Changes on `devices`, `classrooms` and `deliveries`. The teacher app also subscribes to `display_items`. The classroom app subscribes to `deliveries` INSERTs over Supabase's Phoenix v1 JSON protocol, filtered by `device_id=eq.<UID>`, and RLS then checks the current class. It also subscribes to all `display_items` changes without a filter, which RLS limits to its class; such a change triggers one `display_state` query. WebSocket messages only trigger a query for valid deliveries; they never bypass the database's validity and binding checks.

After the subscription succeeds, the classroom starts reporting heartbeats: every 20 seconds it sends a Phoenix keepalive over the WebSocket and waits for the ack (Supabase requires one at least every 25 seconds; it does no database work). Every 120 seconds it also reports the device heartbeat, whose response carries the display state, and the server marks a classroom offline after 270 seconds without a valid heartbeat. Reconnects back off to about 10 seconds and, once restored, query for unexpired messages. Every 40 seconds a healthy connection also re-queries valid deliveries, so a single lost notification is not missed.

`start_delivery` is the persistent gate against duplicate playback. If the gate was written but the app crashed before displaying, the message is not replayed; history keeps the start record and waits for a completion receipt, and one missing for over 5 minutes shows "结果待确认" (result unconfirmed). This is a deliberate trade-off between never replaying and surviving crashes, and an unknown outcome is never disguised as played.

Receipts and online status are shown separately. The 30-second validity limits only when playback may start; it never interrupts a broadcast already playing. Reconnecting can only recover deliveries and submit receipts, and never replays a message that has started.

## Rollout order

Apply the migrations, deploy the Edge Function, publish the teacher app, then update the classroom app. `create_broadcast` gained two parameters, so the migration and Edge Function must ship together. Classroom apps from before this change ignore `style` and show banners as fullscreen broadcasts, and they never show display items.

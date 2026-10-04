# API Contract

All times are UTC ISO 8601 and all IDs are UUIDs. Broadcast text is limited to 300 Unicode code points. Admin status comes from Supabase Auth's `app_metadata.role=admin`. The device UID is `devices.id`, and the active binding is determined by `classrooms.device_id`.

## Edge Function

Endpoint: `POST /functions/v1/broadcast-api`, with `Authorization: Bearer <access_token>` and `apikey` headers. Requests and responses are JSON. Errors are returned as `{ "error": "<readable message>" }`.

| action | Other request parameters | Result |
| --- | --- | --- |
| `send` | `request_id`, `body`, `classrooms: string[]`, `teacher_name`, `repeat_count` (0–5), `auto_close`, `emotion`, `voice_type`, nullable `source_id` | `id` |
| `register-device` | `classroom_id`, `name` | Supabase `session`, `classroom_id`, and the device's fixed login `credential` (`id`, `email`, `password`) |

Both actions are admin-only. Requests are deduplicated by `request_id`: a retry of the same logical request must keep its ID, and an explicit resend uses a new one. The Edge Function sends only text and delivery info; it never generates, stores or returns audio.

## Database RPCs

| RPC | Parameters | Returns / access |
| --- | --- | --- |
| `classroom_status` | none | `{server_now, classrooms}`; admin |
| `bind_device` | `p_device`, `p_classroom`, `p_name` | empty; admin or server |
| `unbind_device` | `p_classroom` | empty; admin |
| `device_heartbeat` | `p_connected` | `{active, classroom_id, server_now}`; current device |
| `pending_broadcasts` | none | `{server_now, items}`; only this device's current class, not started and not expired |
| `start_delivery` | `p_delivery` | boolean; the server atomically checks the binding, the 30-second validity and that it hasn't started |
| `ack_delivery` | `p_delivery`, `p_event`, `p_at`, nullable `p_error` | empty; this device's receipt, safe to retry |
| `broadcast_history` | nullable `p_before`, nullable `p_id` | up to 20 broadcasts with nested `deliveries`; admin |

`create_broadcast` is called by the send function under the admin identity, with `p_id`, `p_body`, `p_classrooms`, `p_source`, `p_teacher_name`, `p_repeat_count`, `p_auto_close`, `p_emotion` and `p_voice_type`. It writes the broadcast and all class deliveries in one transaction.

Each item in `pending_broadcasts.items` has `delivery_id`, `broadcast_id`, `body`, `teacher_name`, `repeat_count`, `auto_close`, `emotion`, `voice_type`, `created_at` and `expires_at`. The query takes no device ID; the server identifies the device from its JWT. The classroom client calls Tencent Cloud TTS directly with `body` and `voice_type` and plays the WAV locally, reusing the same WAV when `repeat_count` is above 1.

`emotion` is one of `normal`, `happy`, `sad`, `angry`, `warning`. `voice_type` is one of `101001`, `101004`, `101011`, `101013`, `101016`. The teacher app ships a fixed WAV preview for each voice, all saying "请Badger去吃饭", so previews never call Tencent Cloud or Supabase.

Receipt events are `received`, `displayed`, `playing`, `played`, `audio_failed`, `finished` and `failed`. Each field stores the time of the first such event; a receipt cannot overwrite an existing time or update the table directly. `played` requires the delivery to have started and a `playing` receipt to exist. Times come from the client's server-calibrated clock, and the server rejects clearly future times.

## Realtime and presence

The teacher app subscribes to Postgres Changes on `devices`, `classrooms` and `deliveries`. The classroom app subscribes to `deliveries` INSERTs over Supabase's Phoenix v1 JSON protocol, filtered by `device_id=eq.<UID>`, and RLS then checks the current class. WebSocket messages only trigger a query for valid deliveries; they never bypass the database's validity and binding checks.

After the subscription succeeds, the classroom starts reporting heartbeats: every 20 seconds it sends a Phoenix keepalive over the WebSocket and waits for the ack (Supabase requires one at least every 25 seconds; it does no database work). Every 120 seconds it also reports the device heartbeat, and the server marks a classroom offline after 270 seconds without a valid heartbeat. Reconnects back off to about 10 seconds and, once restored, query for unexpired messages. Every 40 seconds a healthy connection also re-queries valid deliveries, so a single lost notification is not missed.

`start_delivery` is the persistent gate against duplicate playback. If the gate was written but the app crashed before displaying, the message is not replayed; history keeps the start record and waits for a completion receipt, and one missing for over 5 minutes shows "结果待确认" (result unconfirmed). This is a deliberate trade-off between never replaying and surviving crashes, and an unknown outcome is never disguised as played.

Receipts and online status are shown separately. The 30-second validity limits only when playback may start; it never interrupts a broadcast already playing. Reconnecting can only recover deliveries and submit receipts, and never replays a message that has started.

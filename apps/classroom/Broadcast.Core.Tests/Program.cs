using Broadcast.Core;
using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Text.Json;

var tests = new (string Name, Func<Task> Run)[]
{
    ("Audio receipt order and three-second linger", Happy),
    ("One synthesis can be played repeatedly", Repeats),
    ("Zero repeats is an intentional text-only broadcast", ZeroRepeats),
    ("Manual close keeps the completed broadcast visible", ManualClose),
    ("A newer broadcast interrupts one waiting to be closed, which returns afterwards", ManualCloseInterrupted),
    ("TTS failure displays only text for ten seconds", TextOnly),
    ("Audio player failure does not report played", AudioFailure),
    ("FIFO skips a queued broadcast that expires", ExpiredQueue),
    ("Expired delivery never claims or shows", Expired),
    ("Duplicate notifications and restart do not replay", Duplicates),
    ("Uncommitted claim failure retries on next sync", Retry),
    ("Receipts survive restart and flush idempotently", Persistence),
    ("A rejected receipt is dropped, a throttled one retries", RejectedReceipt),
    ("Failed display emits a failure receipt", DisplayFailure),
    ("A banner shows text only and does not delay a fullscreen broadcast", BannerBesideAlert),
    ("A newer banner replaces the current one", BannerReplace),
    ("Display items appear and end on the server clock, countdowns linger", DisplaySchedule),
    ("Unchanged display state is not re-applied, removal is", DisplayDiff),
    ("The schedule shows the local weekday's lessons, Monday to Friday", ScheduleDays),
    ("Lessons take the grade's bells in order, and a rest row the gap between them", ScheduleTimes),
    ("Birthdays are greeted on the day, and weekend ones on Friday", BirthdayDays),
    ("Display payloads keep long notes, font sizes and board order", DisplayPayload),
    ("Files save without overwriting and survive receipt loss and restart", FileDownloads),
    ("Files reject unsafe names, partial downloads and expired work", FileFailures),
    ("Bazaar corrections recalculate ranks and curve without double counting", BazaarTotals),
};
var failed = 0;
foreach (var test in tests)
{
    try { await test.Run(); Console.WriteLine("PASS " + test.Name); }
    catch (Exception e) { failed++; Console.WriteLine("FAIL " + test.Name + ": " + e.Message); }
}
Console.WriteLine($"{tests.Length - failed} passed, {failed} failed");
if (args.Contains("--realtime"))
{
    try { await RealtimeSmoke(); Console.WriteLine("PASS Real WebSocket join, subscription readiness and heartbeat acknowledgement"); }
    catch (Exception e) { failed++; Console.WriteLine("FAIL Realtime smoke: " + e.Message); }
    try { await RefreshSmoke(false); Console.WriteLine("PASS Concurrent token refresh rotates credentials once"); }
    catch (Exception e) { failed++; Console.WriteLine("FAIL Token refresh: " + e.Message); }
    try { await RefreshSmoke(true); Console.WriteLine("PASS Revoked refresh token requires a new binding"); }
    catch (Exception e) { failed++; Console.WriteLine("FAIL Revoked token: " + e.Message); }
    try { await DeviceSignInSmoke(); Console.WriteLine("PASS Device credential signs in again after a restored refresh token fails"); }
    catch (Exception e) { failed++; Console.WriteLine("FAIL Device sign-in: " + e.Message); }
    try { await VoidRpcSmoke(); Console.WriteLine("PASS A function returning void accepts the empty response"); }
    catch (Exception e) { failed++; Console.WriteLine("FAIL Void RPC: " + e.Message); }
}
return failed == 0 ? 0 : 1;

static Task BazaarTotals()
{
    var at = DateTimeOffset.Parse("2026-11-12T08:00:00Z");
    var a = new BazaarEntry(Guid.NewGuid(), "第1组", 100, at, at);
    var b = new BazaarEntry(Guid.NewGuid(), "第2组", 200, at.AddMinutes(2), at.AddMinutes(2));
    var c = new BazaarEntry(Guid.NewGuid(), "第1组", 50, at.AddMinutes(2), at.AddMinutes(2));
    var fixedA = new BazaarEntry(Guid.NewGuid(), "第2组", 80, a.OccurredAt, at.AddMinutes(3), a.Id);
    var cancelledB = new BazaarEntry(Guid.NewGuid(), "第2组", 0, b.OccurredAt, at.AddMinutes(4), b.Id);
    var summary = new BazaarSummary([cancelledB, c, a, fixedA, b]);
    Check(summary.Total == 130);
    Check(summary.Groups.SequenceEqual(new[] { new BazaarGroup("第2组", 80), new BazaarGroup("第1组", 50) }));
    Check(summary.Curve.SequenceEqual(new[] { new BazaarPoint(at, 80), new BazaarPoint(at.AddMinutes(2), 130) }));
    Check(summary.Current.Length == 3 && summary.Current.All(e => e.Id != a.Id && e.Id != b.Id));
    var restored = cancelledB with { Id = Guid.NewGuid(), Amount = 20, ReplacesId = cancelledB.Id };
    Check(new BazaarSummary([a, b, c, fixedA, cancelledB, restored]).Total == 150);
    Check(new BazaarSummary([]).Total == 0 && new BazaarSummary([]).Curve.Length == 0);
    var simultaneous = new BazaarSummary([a, b with { OccurredAt = at }, c with { OccurredAt = at }]);
    Check(simultaneous.Curve.SequenceEqual(new[] { new BazaarPoint(at, 350) }));
    // The cumulative amount must not overflow Int32 when the ledger grows.
    Check(new BazaarSummary(Enumerable.Range(0, 3000).Select(i => a with { Id = Guid.NewGuid(), Amount = 1000000 }).ToArray()).Total == 3000000000L);
    var payload = JsonSerializer.Deserialize<BazaarBatch>("""{"classroom_id":"8-1","enabled":true,"entries":[{"id":"20000000-0000-4000-8000-000000000001","group_name":"第1组","amount":25,"occurred_at":"2026-11-12T08:00:00Z","recorded_at":"2026-11-12T08:01:00Z","replaces_id":null}]}""", Json.Options)!;
    Check(payload.Enabled && new BazaarSummary(payload.Entries).Total == 25);
    return Task.CompletedTask;
}

static async Task FileDownloads()
{
    var folder = Path.Combine(Path.GetTempPath(), "broadcast-files-" + Guid.NewGuid());
    var desktop = Path.Combine(folder, "desktop"); Directory.CreateDirectory(desktop);
    try
    {
        await File.WriteAllTextAsync(Path.Combine(desktop, "资料.pdf"), "original");
        var backend = new FakeFileBackend();
        var transfer = Guid.NewGuid();
        backend.Items = [new FileTransfer(Guid.NewGuid(), transfer, "资料.pdf", 3, transfer + "/file", DateTimeOffset.UtcNow.AddHours(1))];
        var receiptPath = Path.Combine(folder, "receipts.json");
        var state = Path.Combine(folder, "state");
        var outbox = new ReceiptOutbox(receiptPath);
        var receiver = new FileTransferReceiver(backend, outbox, new ServerClock(), desktop, state);
        await receiver.SyncAsync(default);
        Check(await File.ReadAllTextAsync(Path.Combine(desktop, "资料.pdf")) == "original");
        Check(await File.ReadAllTextAsync(Path.Combine(desktop, "资料 (1).pdf")) == "abc");
        Check(backend.Downloads == 1);
        var receipts = new FakeBackend();
        await new ReceiptOutbox(receiptPath).FlushAsync(receipts, default);
        Check(receipts.Receipts.Select(r => r.Event).SequenceEqual(new[] { "received", "downloaded" }));
        Check(receipts.Receipts.All(r => r.Kind == "file") && receipts.Receipts.Last().SavedName == "资料 (1).pdf");
        // Simulate a server still returning this delivery after a lost receipt, with no pending local outbox.
        var restarted = new FileTransferReceiver(backend, new ReceiptOutbox(receiptPath), new ServerClock(), desktop, state);
        await restarted.SyncAsync(default);
        Check(backend.Downloads == 1 && Directory.GetFiles(desktop).Length == 2);
    }
    finally { Directory.Delete(folder, true); }
}
static async Task FileFailures()
{
    var folder = Path.Combine(Path.GetTempPath(), "broadcast-files-" + Guid.NewGuid()); Directory.CreateDirectory(folder);
    try
    {
        var transfer = Guid.NewGuid();
        var file = new FileTransfer(Guid.NewGuid(), transfer, "ok.pdf", 3, transfer + "/file", DateTimeOffset.UtcNow.AddHours(1));
        foreach (var name in new[] { "../escape", "CON.txt", "LPT¹.txt", "file.", "file:ads" })
        {
            try { FileTransferReceiver.Validate(file with { Filename = name }); throw new Exception("Unsafe filename accepted"); }
            catch (IOException) { }
        }
        var backend = new FakeFileBackend { Items = [file], Content = "a" };
        var receipts = new FakeBackend();
        var outbox = new ReceiptOutbox(Path.Combine(folder, "receipts.json"));
        var desktop = Path.Combine(folder, "desktop");
        var receiver = new FileTransferReceiver(backend, outbox, new ServerClock(), desktop, Path.Combine(folder, "state"));
        await receiver.SyncAsync(default);
        Check(Directory.GetFiles(desktop).Length == 0, "Partial download reached the desktop");
        await outbox.FlushAsync(receipts, default);
        Check(receipts.Receipts.Any(r => r.Event == "failed") && !receipts.Receipts.Any(r => r.Event == "downloaded"));
        backend.Items = [file with { DeliveryId = Guid.NewGuid(), ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(-1) }];
        await receiver.SyncAsync(default);
        Check(backend.Downloads == 1, "Expired file was downloaded");
    }
    finally { Directory.Delete(folder, true); }
}

static async Task RefreshSmoke(bool invalid)
{
    using var backend = new BackendClient(new ServiceConfig("http://127.0.0.1:54329", "fixture-key"),
        new AuthSession("expired", invalid ? "invalid" : "valid-refresh", 1,
            new AuthUser("20000000-0000-4000-8000-000000000001", [])));
    if (invalid)
    {
        try { await backend.AccessTokenAsync(default); } catch (SessionExpiredException) { return; }
        throw new Exception("Expected a session expiry");
    }
    var tokens = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => backend.AccessTokenAsync(default)));
    Check(tokens.All(t => t == "rotated-token") && backend.Session!.RefreshToken == "rotated-refresh");
}

static async Task DeviceSignInSmoke()
{
    var config = new ServiceConfig("http://127.0.0.1:54329", "fixture-key");
    var device = new DeviceCredential("20000000-0000-4000-8000-000000000001", "device@devices.broadcast.invalid", "device-password");
    using (var fresh = new BackendClient(config, device: device))
        Check(await fresh.AccessTokenAsync(default) == "device-token" && fresh.Session!.User.Id == device.Id);
    using (var restored = new BackendClient(config, new AuthSession("expired", "invalid", 1, new AuthUser(device.Id, [])), device))
        Check(await restored.AccessTokenAsync(default) == "device-token");
    using var wrong = new BackendClient(config, device: device with { Password = "wrong" });
    try { await wrong.AccessTokenAsync(default); } catch (SessionExpiredException) { return; }
    throw new Exception("Expected a session expiry");
}

static async Task VoidRpcSmoke()
{
    using var backend = new BackendClient(new ServiceConfig("http://127.0.0.1:54329", "fixture-key"),
        device: new DeviceCredential("20000000-0000-4000-8000-000000000001", "device@devices.broadcast.invalid", "device-password"));
    await backend.RpcAsync("unbind_device", new { p_classroom = "8-1" });
}

static async Task RealtimeSmoke()
{
    using var backend = new BackendClient(new ServiceConfig("http://127.0.0.1:54329", "fixture-public-key"),
        new AuthSession("fixture-access-token", "fixture-refresh-token", DateTimeOffset.UtcNow.AddHours(1).ToUnixTimeSeconds(),
            new AuthUser("20000000-0000-4000-8000-000000000001", [])));
    using var life = new CancellationTokenSource(TimeSpan.FromSeconds(20));
    var changes = 0; var beats = 0; var displayChanges = 0; var fileChanges = 0; var bazaarChanges = 0;
    // 50 ms keepalives: the status heartbeat fires every 6th and the missed-broadcast check every 2nd.
    try
    {
        await new RealtimeConnection(backend, TimeSpan.FromMilliseconds(50)).RunAsync(() => changes++, () => displayChanges++, async ct =>
        {
            var result = await backend.RpcAsync<Heartbeat>("device_heartbeat", new { p_connected = true }, ct);
            Check(result.Active && result.ClassroomId == "8-1");
            if (++beats == 3) life.Cancel();
        }, life.Token, () => fileChanges++, () => bazaarChanges++);
    }
    catch (OperationCanceledException) when (beats == 3) { }
    // beats: 1 on join + 1 per 6 keepalives; changes: 1 on join + 1 per 2 keepalives.
    Check(beats == 3 && changes >= 1 + 3 * (beats - 1), "Subscription/heartbeat did not confirm readiness");
    Check(displayChanges == 3, "Display item, schedule and classroom changes were not routed separately");
    Check(fileChanges == 1, "File delivery changes were not routed separately");
    Check(bazaarChanges == 2, "Bazaar income and classroom switches must refresh bazaar state");
    using var http = new HttpClient();
    var stats = await http.GetFromJsonAsync<JsonElement>("http://127.0.0.1:54329/stats");
    Check(stats.GetProperty("keepalives").GetInt32() >= 12, "Keepalives were not sent on the fast cycle");
}

static void Check(bool condition, string message = "Assertion failed") { if (!condition) throw new Exception(message); }
static async Task Until(Func<bool> condition)
{
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
    while (!condition()) await Task.Delay(5, timeout.Token);
}
static async Task Receipt(Harness h, Guid id, string kind)
{
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
    while (true)
    {
        await h.Outbox.FlushAsync(h.Backend, default);
        if (h.Backend.Receipts.Any(r => r.DeliveryId == id && r.Event == kind)) return;
        await Task.Delay(5, timeout.Token);
    }
}
static async Task Happy()
{
    await using var h = new Harness(); h.Backend.Items = [h.Item("A")];
    await h.Start(); await Until(() => h.Display.Hidden == 1); await h.Outbox.FlushAsync(h.Backend, default);
    Check(h.Backend.Receipts.Select(r => r.Event).SequenceEqual(new[] { "received", "displayed", "playing", "played", "finished" }));
    Check(h.Delays.Single() == TimeSpan.FromSeconds(3));
}
static async Task Repeats()
{
    await using var h = new Harness(); h.Backend.Items = [h.Item("repeat") with { RepeatCount = 3, VoiceType = 101013 }];
    await h.Start(); await Until(() => h.Display.Hidden == 1); await h.Outbox.FlushAsync(h.Backend, default);
    Check(h.Speech.Calls == 1 && h.Speech.VoiceTypes.Single() == 101013); Check(h.Audio.Played == 3);
    Check(h.Backend.Receipts.Count(r => r.Event == "playing") == 1 && h.Backend.Receipts.Count(r => r.Event == "played") == 1);
}
static async Task ZeroRepeats()
{
    await using var h = new Harness(); h.Backend.Items = [h.Item("text only") with { RepeatCount = 0 }];
    await h.Start(); await Until(() => h.Display.Hidden == 1); await h.Outbox.FlushAsync(h.Backend, default);
    Check(h.Speech.Calls == 0 && h.Audio.Played == 0); Check(h.Delays.Single().TotalSeconds is > 9 and <= 10);
    Check(!h.Backend.Receipts.Any(r => r.Event is "playing" or "played" or "audio_failed"));
}
static async Task ManualClose()
{
    await using var h = new Harness(); h.Backend.Items = [h.Item("keep") with { AutoClose = false }];
    await h.Start(); await Until(() => h.Display.CloseShown == 1); await Task.Delay(20);
    Check(h.Display.Hidden == 0); h.Display.CloseGate.SetResult();
    await Until(() => h.Display.Hidden == 1); await h.Outbox.FlushAsync(h.Backend, default);
    Check(h.Delays.IsEmpty && h.Backend.Receipts.Any(r => r.Event == "finished"));
}
static async Task ManualCloseInterrupted()
{
    await using var h = new Harness(); var one = h.Item("keep") with { AutoClose = false };
    h.Backend.Items = [one]; await h.Start(); await Until(() => h.Display.CloseShown == 1);
    var two = h.Item("urgent") with { CreatedAt = one.CreatedAt.AddSeconds(1) }; h.Backend.Items = [one, two];
    await h.Queue.SyncAsync(default); await Until(() => h.Display.Shown.Count == 3 && h.Display.CloseShown == 2);
    Check(h.Display.Shown.Select(item => item.Body).SequenceEqual(new[] { "keep", "urgent", "keep" }), "The earlier broadcast did not come back");
    Check(h.Display.Hidden == 2, "The interrupted broadcast should be hidden while the newer one plays");
    await h.Outbox.FlushAsync(h.Backend, default);
    Check(!h.Backend.Receipts.Any(r => r.DeliveryId == one.DeliveryId && r.Event == "finished"), "Interrupted broadcast finished early");
    Check(h.Backend.Receipts.Count(r => r.DeliveryId == two.DeliveryId && r.Event == "finished") == 1);
    h.Display.CloseGate.SetResult(); await Until(() => h.Display.Hidden == 3); await h.Outbox.FlushAsync(h.Backend, default);
    Check(h.Backend.Receipts.Count(r => r.DeliveryId == one.DeliveryId && r.Event == "displayed") == 1);
    Check(h.Backend.Receipts.Any(r => r.DeliveryId == one.DeliveryId && r.Event == "finished"));
}
static async Task TextOnly()
{
    await using var h = new Harness(); h.Backend.Items = [h.Item("text")]; h.Speech.Fail = true;
    await h.Start(); await Until(() => h.Display.Hidden == 1); await h.Outbox.FlushAsync(h.Backend, default);
    Check(h.Display.Shown.Single().Body == "text"); Check(h.Audio.Played == 0);
    Check(h.Delays.Single().TotalSeconds is > 9 and <= 10);
    Check(h.Backend.Receipts.Any(r => r.Event == "audio_failed") && !h.Backend.Receipts.Any(r => r.Event == "played"));
}
static async Task AudioFailure()
{
    await using var h = new Harness(); h.Backend.Items = [h.Item("A")]; h.Audio.Fail = true;
    await h.Start(); await Until(() => h.Display.Hidden == 1); await h.Outbox.FlushAsync(h.Backend, default);
    Check(h.Backend.Receipts.Any(r => r.Event == "audio_failed")); Check(!h.Backend.Receipts.Any(r => r.Event == "played"));
}
static async Task ExpiredQueue()
{
    await using var h = new Harness(); var one = h.Item("first"); var two = h.Item("second") with { CreatedAt = one.CreatedAt.AddSeconds(1) };
    h.Backend.Items = [two, one]; h.Audio.Gate = new(TaskCreationOptions.RunContinuationsAsynchronously);
    await h.Start(); await Until(() => h.Audio.Played == 1); h.Clock.Sync(DateTimeOffset.UtcNow.AddMinutes(1)); h.Audio.Gate.SetResult();
    await Until(() => h.Display.Hidden == 1); await Task.Delay(30);
    Check(h.Display.Shown.Select(item => item.Body).SequenceEqual(new[] { "first" })); Check(h.Backend.Claims.Count == 1);
}
static async Task Expired()
{
    await using var h = new Harness(); h.Backend.Items = [h.Item("old") with { ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(-1) }];
    await h.Start(); await Task.Delay(30); Check(h.Display.Shown.IsEmpty); Check(h.Backend.Claims.IsEmpty);
}
static async Task Duplicates()
{
    await using var h = new Harness(); h.Backend.Items = [h.Item("once")]; await h.Start();
    await Until(() => h.Display.Hidden == 1); await h.Queue.SyncAsync(default); await Task.Delay(30);
    Check(h.Display.Shown.Count == 1);
    using var life = new CancellationTokenSource();
    var restarted = new DeliveryQueue(h.Backend, h.Display, h.Speech, h.Audio, h.Outbox, h.Clock,
        new BannerLane(h.Backend, h.Banners, h.Outbox, h.Clock), (_, _) => Task.CompletedTask);
    await restarted.SyncAsync(default); var task = restarted.RunAsync(life.Token); await Task.Delay(30);
    life.Cancel(); try { await task; } catch (OperationCanceledException) { }
    Check(h.Display.Shown.Count == 1);
}
static async Task Retry()
{
    await using var h = new Harness(); h.Backend.Items = [h.Item("retry")]; h.Backend.FailClaim = true;
    await h.Start(); await Until(() => h.Errors.Count == 1); await h.Queue.SyncAsync(default);
    await Until(() => h.Display.Hidden == 1); Check(h.Display.Shown.Count == 1);
}
static async Task Persistence()
{
    await using var h = new Harness(); var receipt = new Receipt(Guid.NewGuid(), "received", DateTimeOffset.UtcNow);
    h.Outbox.Enqueue(receipt); h.Outbox.Enqueue(receipt);
    var recovered = new ReceiptOutbox(h.Path); await recovered.FlushAsync(h.Backend, default); await recovered.FlushAsync(h.Backend, default);
    Check(h.Backend.Receipts.Count == 1);
}
static async Task RejectedReceipt()
{
    await using var h = new Harness(); var rejected = new Receipt(Guid.NewGuid(), "received", DateTimeOffset.UtcNow);
    h.Outbox.Enqueue(rejected); h.Outbox.Enqueue(new Receipt(Guid.NewGuid(), "received", DateTimeOffset.UtcNow));
    h.Backend.Reject[rejected.DeliveryId] = System.Net.HttpStatusCode.TooManyRequests;
    try { await h.Outbox.FlushAsync(h.Backend, default); throw new Exception("Throttled receipt was dropped"); } catch (BackendException) { }
    h.Backend.Reject[rejected.DeliveryId] = System.Net.HttpStatusCode.BadRequest;
    await h.Outbox.FlushAsync(h.Backend, default); await new ReceiptOutbox(h.Path).FlushAsync(h.Backend, default);
    Check(h.Backend.Receipts.Count == 1 && h.Backend.Receipts.Single().DeliveryId != rejected.DeliveryId);
}
static async Task DisplayFailure()
{
    await using var h = new Harness(); h.Display.Fail = true; h.Backend.Items = [h.Item("oops")];
    await h.Start(); await Until(() => h.Errors.Count == 1); await h.Outbox.FlushAsync(h.Backend, default);
    Check(h.Backend.Receipts.Any(r => r.Event == "failed")); Check(!h.Backend.Receipts.Any(r => r.Event == "played"));
}
static async Task BannerBesideAlert()
{
    await using var h = new Harness(); var alert = h.Item("alert"); var banner = h.Item("banner") with { Style = "banner", RepeatCount = 0, CreatedAt = alert.CreatedAt.AddSeconds(-1) };
    h.Backend.Items = [banner, alert]; h.BannerDelay = new(TaskCreationOptions.RunContinuationsAsynchronously);
    await h.Start(); await Until(() => h.Display.Hidden == 1 && h.Banners.Shown.Count == 1);
    Check(h.Display.Shown.Single().Body == "alert" && h.Banners.Hidden == 0, "Banner delayed the alert");
    h.BannerDelay.SetResult(); await Receipt(h, banner.DeliveryId, "finished");
    var events = h.Backend.Receipts.Where(r => r.DeliveryId == banner.DeliveryId).Select(r => r.Event);
    Check(events.SequenceEqual(new[] { "received", "displayed", "finished" }));
}
static async Task BannerReplace()
{
    await using var h = new Harness(); h.BannerDelay = new(TaskCreationOptions.RunContinuationsAsynchronously);
    var one = h.Item("one") with { Style = "banner" }; h.Backend.Items = [one];
    await h.Start(); await Until(() => h.Banners.Shown.Count == 1);
    var two = h.Item("two") with { Style = "banner", BannerPosition = "bottom" }; h.Backend.Items = [one, two];
    await h.Queue.SyncAsync(default); await Until(() => h.Banners.Shown.Count == 2);
    await Receipt(h, one.DeliveryId, "finished");
    Check(h.Banners.Hidden == 0, "Replacing should not hide the strip");
    Check(!h.Backend.Receipts.Any(r => r.DeliveryId == two.DeliveryId && r.Event == "finished"));
    h.BannerDelay.SetResult(); await Receipt(h, two.DeliveryId, "finished"); Check(h.Banners.Hidden == 1);
    Check(h.Banners.Shown.Select(b => b.Body).SequenceEqual(new[] { "one", "two" }));
}
static DisplayItem Shown(string kind, DateTimeOffset start, DateTimeOffset end, DisplayContent? content = null) =>
    new(Guid.NewGuid(), kind, content ?? new DisplayContent(Text: kind), start, end, "李老师");
static async Task DisplaySchedule()
{
    var clock = new ServerClock(); var now = DateTimeOffset.UtcNow; var screen = new FakeScreen();
    var state = new DisplayState(screen, clock);
    var note = Shown("note", now.AddMinutes(10), now.AddMinutes(30)); var countdown = Shown("countdown", now, now.AddMinutes(5));
    await state.UpdateAsync([note, countdown], null, null, default);
    Check(screen.Last.Select(i => i.Kind).SequenceEqual(new[] { "countdown" }), "Scheduled note shown early");
    clock.Sync(now.AddMinutes(10)); await state.UpdateAsync([note, countdown], null, null, default);
    Check(screen.Last.Select(i => i.Kind).SequenceEqual(new[] { "note" }), "Note not shown at its start");
    Check(DisplayState.Visible(countdown, now.AddMinutes(5).AddSeconds(4)) && !DisplayState.Visible(countdown, now.AddMinutes(5).AddSeconds(5)));
    Check(!DisplayState.Visible(note, note.EndsAt));
}
static async Task DisplayDiff()
{
    var clock = new ServerClock(); var now = clock.Now; var screen = new FakeScreen();
    var state = new DisplayState(screen, clock);
    var note = Shown("note", now.AddMinutes(-1), now.AddMinutes(30));
    await state.UpdateAsync([note], null, null, default); await state.UpdateAsync([note with { }], null, null, default);
    Check(screen.Applied.Count == 1, "Same state was applied twice");
    await state.UpdateAsync([], null, null, default); Check(screen.Applied.Count == 2 && screen.Last.Count == 0);
}
static Task DisplayPayload()
{
    var text = string.Concat(Enumerable.Repeat("便签😀\n", 75)); // 300 Unicode scalar values, including newlines and surrogate pairs.
    Check(text.EnumerateRunes().Count() == 300);
    var item = Shown("note", DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), new DisplayContent(Text: text, FontSize: 28));
    var restored = JsonSerializer.Deserialize<DisplayItem>(JsonSerializer.Serialize(item, Json.Options), Json.Options)!;
    Check(restored.Content.Text == text && restored.Content.NoteFontSize == 28, "Long note lost text or its selected size");
    var old = JsonSerializer.Deserialize<DisplayContent>("{\"text\":\"旧便签\"}", Json.Options)!;
    Check(old.NoteFontSize == 20 && !old.Duty, "Missing fields changed defaults");
    Check(new DisplayContent(FontSize: 18).NoteFontSize == 18 && new DisplayContent(FontSize: 24).NoteFontSize == 24
        && new DisplayContent(FontSize: 10).NoteFontSize == 18 && new DisplayContent(FontSize: 48).NoteFontSize == 28
        && new DisplayContent(FontSize: double.NaN).NoteFontSize == 20, "Note size range");
    var board = JsonSerializer.Deserialize<DisplayContent>("{\"entries\":[\"第三条\",\"第一条\",\"第二条\"]}", Json.Options)!;
    Check(board.Entries!.SequenceEqual(new[] { "第三条", "第一条", "第二条" }), "Entry ordering lost");
    return Task.CompletedTask;
}
static async Task BirthdayDays()
{
    Birthday[] list = [new("周四", "10-15"), new("周五", "10-16"), new("周六", "10-17"), new("周日", "10-18"), new("闰日", "02-29")];
    DateTimeOffset At(int year, int month, int day) => new(new DateTime(year, month, day, 9, 0, 0, DateTimeKind.Local));
    Check(DisplayState.Celebrations(list, At(2026, 10, 15)).Select(c => c.Name).SequenceEqual(["周四"]), "Thursday");
    var friday = DisplayState.Celebrations(list, At(2026, 10, 16));
    Check(friday.Select(c => c.Name).SequenceEqual(["周五", "周六", "周日"]) && friday[1].On == new DateOnly(2026, 10, 17), "Friday must greet the weekend");
    Check(DisplayState.Celebrations(list, At(2026, 10, 19)).Length == 0, "Monday greets the weekend again");
    Check(DisplayState.Celebrations(list, At(2027, 2, 28)).Single().Name == "闰日" && DisplayState.Celebrations(list, At(2028, 2, 28)).Length == 0
        && DisplayState.Celebrations(list, At(2028, 2, 29)).Single().Name == "闰日", "29 February");
    Check(DisplayState.Celebrations(null, At(2026, 10, 16)).Length == 0, "Missing list");
    var clock = new ServerClock(); var screen = new FakeScreen();
    var state = new DisplayState(screen, clock);
    clock.Sync(At(2026, 10, 15)); await state.UpdateAsync([], null, list, default);
    Check(screen.Birthdays.Single().Name == "周四", "Birthday not applied");
    clock.Sync(At(2026, 10, 16)); await state.UpdateAsync([], null, list, default);
    Check(screen.Applied.Count == 2 && screen.Birthdays.Count == 3, "Birthdays did not move to the next day");
}
static Task ScheduleTimes()
{
    var catalog = new Catalog(new() { ["english"] = new("英语 English"), ["math"] = new("数学 Math"), ["lunch"] = new("午餐 Lunch", true), ["午休"] = new("午休", true) },
        [["08:30-09:10", "09:25-10:05", "10:20-11:00"], ["08:00-08:45"], [], [], []]);
    static string Clock(Lesson lesson) => lesson.Start is { } start && lesson.End is { } end ? $"{start:HH:mm}-{end:HH:mm}" : "";
    var monday = DisplayState.Lessons(["english", "lunch", "math", "午休", "english", "math"], catalog, DayOfWeek.Monday);
    Check(monday.Select(l => l.Name).SequenceEqual(["英语 English", "午餐 Lunch", "数学 Math", "午休", "英语 English", "数学 Math"]), "Subject names not resolved");
    Check(monday.Select(Clock).SequenceEqual(["08:30-09:10", "09:10-09:25", "09:25-10:05", "10:05-10:20", "10:20-11:00", ""]), "Lesson times wrong: " + string.Join(" ", monday.Select(Clock)));
    Check(monday[1].Rest && !monday[0].Rest, "Rest flag not carried");
    Check(DisplayState.Lessons(["lunch", "math"], catalog, DayOfWeek.Monday).Select(Clock).SequenceEqual(["", "08:30-09:10"]), "A rest row without a lesson before it was timed");
    Check(DisplayState.Lessons(["math", "lunch"], catalog, DayOfWeek.Monday).Select(Clock).SequenceEqual(["08:30-09:10", ""]), "A rest row without a lesson after it was timed");
    Check(DisplayState.Lessons(["math", "math"], catalog, DayOfWeek.Tuesday).Select(Clock).SequenceEqual(["08:00-08:45", ""]), "Day with fewer bells than lessons");
    Check(DisplayState.Lessons(["math"], catalog, DayOfWeek.Wednesday).Select(Clock).SequenceEqual([""]), "Day with no bells");
    Check(DisplayState.Lessons(["实验课"], null, DayOfWeek.Monday).Single() is { Name: "实验课", Start: null }, "Without a catalog a subject shows its id and no time");
    Check(JsonSerializer.Deserialize<Heartbeat>("{\"active\":true,\"server_now\":\"2026-10-12T01:00:00Z\",\"catalog\":{\"subjects\":{\"math\":{\"label\":\"数学 Math\",\"rest\":false}},\"bells\":[[\"08:30-09:10\"],[],[],[],[]]}}", Json.Options)
        is { Catalog.Bells.Length: 5 } beat && beat.Catalog.Subjects["math"].Label == "数学 Math", "Catalog JSON not read");
    return Task.CompletedTask;
}
static async Task ScheduleDays()
{
    string[][] week = [["english", "lunch"], ["math"], [], ["art"], ["club"]];
    DateTimeOffset At(int day) => new(new DateTime(2026, 10, day, 9, 0, 0, DateTimeKind.Local));
    Check(DisplayState.Today(week, null, At(12)) is { Lessons: [{ Name: "english" }, { Name: "lunch" }] } monday && monday.Date == new DateOnly(2026, 10, 12), "Monday");
    Check(DisplayState.Today(week, null, At(16))?.Lessons.Single().Name == "club", "Friday");
    Check(DisplayState.Today(week, null, At(14)) is null && DisplayState.Today(week, null, At(17)) is null && DisplayState.Today(week, null, At(18)) is null, "Empty day or weekend shown");
    Check(DisplayState.Today(null, null, At(12)) is null, "Missing schedule shown");
    var clock = new ServerClock(); var screen = new FakeScreen();
    var state = new DisplayState(screen, clock);
    clock.Sync(At(12)); await state.UpdateAsync([], week, null, default);
    Check(screen.Today?.Lessons.Length == 2, "Schedule not applied");
    await state.UpdateAsync([], week, null, default); Check(screen.Applied.Count == 1, "Same schedule applied twice");
    clock.Sync(At(13)); await state.UpdateAsync([], week, null, default);
    Check(screen.Applied.Count == 2 && screen.Today?.Lessons.Single().Name == "math", "Schedule did not move to the next day");
    clock.Sync(At(17)); await state.UpdateAsync([], week, null, default); Check(screen.Today is null, "Weekend still shows a schedule");
}

sealed class Harness : IAsyncDisposable
{
    public readonly FakeBackend Backend = new(); public readonly FakeDisplay Display = new(); public readonly FakeBanners Banners = new();
    public TaskCompletionSource? BannerDelay; public readonly FakeSpeech Speech = new(); public readonly FakeAudio Audio = new();
    public readonly ServerClock Clock = new(); public readonly ConcurrentBag<TimeSpan> Delays = []; public readonly ConcurrentBag<Exception> Errors = [];
    public readonly string Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "broadcast-tests-" + Guid.NewGuid(), "outbox.json");
    public readonly ReceiptOutbox Outbox; public readonly DeliveryQueue Queue;
    private readonly CancellationTokenSource _life = new(); private Task? _task;
    public Harness()
    {
        Outbox = new(Path);
        var banners = new BannerLane(Backend, Banners, Outbox, Clock, (_, ct) => BannerDelay?.Task.WaitAsync(ct) ?? Task.CompletedTask);
        Queue = new(Backend, Display, Speech, Audio, Outbox, Clock, banners, (span, _) => { Delays.Add(span); return Task.CompletedTask; });
        Queue.Error += Errors.Add; banners.Error += Errors.Add;
    }
    public Delivery Item(string body) => new(Guid.NewGuid(), Guid.NewGuid(), body, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddSeconds(30));
    public async Task Start() { await Queue.SyncAsync(_life.Token); _task = Queue.RunAsync(_life.Token); }
    public async ValueTask DisposeAsync()
    {
        await _life.CancelAsync(); if (_task is not null) try { await _task; } catch (OperationCanceledException) { }
        _life.Dispose(); if (Directory.Exists(System.IO.Path.GetDirectoryName(Path))) Directory.Delete(System.IO.Path.GetDirectoryName(Path)!, true);
    }
}
sealed class FakeBackend : IBackend
{
    public Delivery[] Items = []; public bool FailClaim; public readonly ConcurrentDictionary<Guid, System.Net.HttpStatusCode> Reject = [];
    public readonly ConcurrentDictionary<Guid, byte> Claims = []; public readonly ConcurrentQueue<Receipt> Receipts = [];
    public Task<PendingBatch> PendingAsync(CancellationToken ct) => Task.FromResult(new PendingBatch(DateTimeOffset.UtcNow, Items));
    public Task<bool> ClaimAsync(Guid id, CancellationToken ct)
    { if (FailClaim) { FailClaim = false; throw new IOException("offline"); } return Task.FromResult(Claims.TryAdd(id, 0)); }
    public Task AcknowledgeAsync(Receipt r, CancellationToken ct)
    { if (Reject.TryGetValue(r.DeliveryId, out var status)) throw new BackendException("回执时间无效", status); Receipts.Enqueue(r); return Task.CompletedTask; }
}
sealed class FakeDisplay : IDisplay
{
    public readonly ConcurrentQueue<Delivery> Shown = []; public readonly TaskCompletionSource CloseGate = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public int Hidden; public int CloseShown; public bool Fail;
    public Task ShowAsync(Delivery delivery, CancellationToken ct) { if (Fail) throw new IOException("display unavailable"); Shown.Enqueue(delivery); return Task.CompletedTask; }
    public Task ShowCloseButtonAsync() { Interlocked.Increment(ref CloseShown); return Task.CompletedTask; }
    public Task WaitForCloseAsync(CancellationToken ct) => CloseGate.Task.WaitAsync(ct);
    public Task HideAsync() { Interlocked.Increment(ref Hidden); return Task.CompletedTask; }
}
sealed class FakeScreen : IStateDisplay
{
    public readonly ConcurrentQueue<IReadOnlyList<DisplayItem>> Applied = [];
    public IReadOnlyList<DisplayItem> Last => Applied.Last();
    public DaySchedule? Today;
    public IReadOnlyList<Celebration> Birthdays = [];
    public Task ApplyAsync(IReadOnlyList<DisplayItem> visible, DaySchedule? today, IReadOnlyList<Celebration> birthdays)
    { Applied.Enqueue(visible); Today = today; Birthdays = birthdays; return Task.CompletedTask; }
}
sealed class FakeBanners : IBannerDisplay
{
    public readonly ConcurrentQueue<Delivery> Shown = []; public int Hidden;
    public Task ShowAsync(Delivery delivery, CancellationToken ct) { Shown.Enqueue(delivery); return Task.CompletedTask; }
    public Task HideAsync() { Interlocked.Increment(ref Hidden); return Task.CompletedTask; }
}
sealed class FakeAudio : IAudioPlayer
{
    public int Played; public bool Fail; public TaskCompletionSource? Gate;
    public async Task PlayAsync(byte[] audio, Action started, CancellationToken ct)
    { if (Fail) throw new IOException("no device"); Interlocked.Increment(ref Played); started(); if (Gate is not null) await Gate.Task.WaitAsync(ct); }
}
sealed class FakeSpeech : ISpeechSynthesizer
{
    public bool Fail; public int Calls; public readonly ConcurrentQueue<int> VoiceTypes = [];
    public Task<byte[]> SynthesizeAsync(string text, int voiceType, CancellationToken ct)
    { Interlocked.Increment(ref Calls); VoiceTypes.Enqueue(voiceType); return Fail
        ? Task.FromException<byte[]>(new InvalidOperationException("tts failed"))
        : Task.FromResult(new byte[] { 1 }); }
}

sealed class FakeFileBackend : IFileTransferBackend
{
    public FileTransfer[] Items = [];
    public string Content = "abc";
    public int Downloads;
    public Task<FileTransferBatch> PendingFilesAsync(CancellationToken ct) => Task.FromResult(new FileTransferBatch(DateTimeOffset.UtcNow, Items));
    public async Task DownloadFileAsync(FileTransfer file, string destination, CancellationToken ct)
    { Downloads++; await File.WriteAllTextAsync(destination, Content, ct); }
}

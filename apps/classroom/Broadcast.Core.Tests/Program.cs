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
    ("TTS failure displays only text for ten seconds", TextOnly),
    ("Audio player failure does not report played", AudioFailure),
    ("FIFO skips a queued broadcast that expires", ExpiredQueue),
    ("Expired delivery never claims or shows", Expired),
    ("Duplicate notifications and restart do not replay", Duplicates),
    ("Uncommitted claim failure retries on next sync", Retry),
    ("Receipts survive restart and flush idempotently", Persistence),
    ("Failed display emits a failure receipt", DisplayFailure),
    ("A banner shows text only and does not delay a fullscreen broadcast", BannerBesideAlert),
    ("A newer banner replaces the current one", BannerReplace),
    ("Display items appear and end on the server clock, countdowns linger", DisplaySchedule),
    ("Unchanged display state is not re-applied, removal is", DisplayDiff),
    ("A board is read once, line by line, only near its start", BoardReadOnce),
    ("A fullscreen broadcast cuts off board reading", PrimaryPreempts),
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
}
return failed == 0 ? 0 : 1;

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

static async Task RealtimeSmoke()
{
    using var backend = new BackendClient(new ServiceConfig("http://127.0.0.1:54329", "fixture-public-key"),
        new AuthSession("fixture-access-token", "fixture-refresh-token", DateTimeOffset.UtcNow.AddHours(1).ToUnixTimeSeconds(),
            new AuthUser("20000000-0000-4000-8000-000000000001", [])));
    using var life = new CancellationTokenSource(TimeSpan.FromSeconds(20));
    var changes = 0; var beats = 0; var displayChanges = 0;
    // 50 ms keepalives: the status heartbeat fires every 6th and the missed-broadcast check every 2nd.
    try
    {
        await new RealtimeConnection(backend, TimeSpan.FromMilliseconds(50)).RunAsync(() => changes++, () => displayChanges++, async ct =>
        {
            var result = await backend.RpcAsync<Heartbeat>("device_heartbeat", new { p_connected = true }, ct);
            Check(result.Active && result.ClassroomId == "8-1");
            if (++beats == 3) life.Cancel();
        }, life.Token);
    }
    catch (OperationCanceledException) when (beats == 3) { }
    // beats: 1 on join + 1 per 6 keepalives; changes: 1 on join + 1 per 2 keepalives.
    Check(beats == 3 && changes >= 1 + 3 * (beats - 1), "Subscription/heartbeat did not confirm readiness");
    Check(displayChanges == 1, "Display item changes were not routed separately");
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
    var state = new DisplayState(screen, clock, new BoardReader(new FakeSpeech(), new FakeAudio()));
    var note = Shown("note", now.AddMinutes(10), now.AddMinutes(30)); var countdown = Shown("countdown", now, now.AddMinutes(5));
    await state.UpdateAsync([note, countdown], default);
    Check(screen.Last.Select(i => i.Kind).SequenceEqual(new[] { "countdown" }), "Scheduled note shown early");
    clock.Sync(now.AddMinutes(10)); await state.UpdateAsync([note, countdown], default);
    Check(screen.Last.Select(i => i.Kind).SequenceEqual(new[] { "note" }), "Note not shown at its start");
    Check(DisplayState.Visible(countdown, now.AddMinutes(5).AddSeconds(4)) && !DisplayState.Visible(countdown, now.AddMinutes(5).AddSeconds(5)));
    Check(!DisplayState.Visible(note, note.EndsAt));
}
static async Task DisplayDiff()
{
    var clock = new ServerClock(); var now = clock.Now; var screen = new FakeScreen();
    var state = new DisplayState(screen, clock, new BoardReader(new FakeSpeech(), new FakeAudio()));
    var note = Shown("note", now.AddMinutes(-1), now.AddMinutes(30));
    await state.UpdateAsync([note], default); await state.UpdateAsync([note with { }], default);
    Check(screen.Applied.Count == 1, "Same state was applied twice");
    await state.UpdateAsync([], default); Check(screen.Applied.Count == 2 && screen.Last.Count == 0);
}
static async Task BoardReadOnce()
{
    var clock = new ServerClock(); var now = clock.Now; var speech = new FakeSpeech(); var audio = new FakeAudio();
    var state = new DisplayState(new FakeScreen(), clock, new BoardReader(speech, audio));
    var entries = Enumerable.Range(1, 12).Select(i => $"第{i}条：" + new string('字', 95)).ToArray();
    var board = Shown("board", now.AddSeconds(-5), now.AddHours(1), new DisplayContent("本周公告", entries, true, 101011));
    await state.UpdateAsync([board], default); await state.UpdateAsync([board], default);
    await Until(() => audio.Played == 13);
    Check(speech.Calls == 13 && speech.VoiceTypes.All(v => v == 101011), "Each line should be one short synthesis");
    var old = Shown("board", now.AddMinutes(-5), now.AddHours(1), new DisplayContent("旧公告", ["已经过了朗读时间"], true));
    await state.UpdateAsync([board, old], default); await Task.Delay(30);
    Check(speech.Calls == 13, "A board seen long after its start was read aloud");
}
static async Task PrimaryPreempts()
{
    var device = new FakeAudio { Gate = new(TaskCreationOptions.RunContinuationsAsynchronously) };
    var shared = new SharedAudio(device);
    var reading = shared.Secondary.PlayAsync([1], () => { }, default);
    await Until(() => device.Played == 1);
    var alert = shared.Primary.PlayAsync([1], () => { }, default);
    try { await reading; throw new Exception("Board reading was not interrupted"); } catch (OperationCanceledException) { }
    try { await shared.Secondary.PlayAsync([1], () => { }, default); throw new Exception("Board started over a broadcast"); } catch (OperationCanceledException) { }
    device.Gate.SetResult(); await alert;
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
    public Delivery[] Items = []; public bool FailClaim;
    public readonly ConcurrentDictionary<Guid, byte> Claims = []; public readonly ConcurrentQueue<Receipt> Receipts = [];
    public Task<PendingBatch> PendingAsync(CancellationToken ct) => Task.FromResult(new PendingBatch(DateTimeOffset.UtcNow, Items));
    public Task<bool> ClaimAsync(Guid id, CancellationToken ct)
    { if (FailClaim) { FailClaim = false; throw new IOException("offline"); } return Task.FromResult(Claims.TryAdd(id, 0)); }
    public Task AcknowledgeAsync(Receipt r, CancellationToken ct) { Receipts.Enqueue(r); return Task.CompletedTask; }
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
    public Task ApplyAsync(IReadOnlyList<DisplayItem> visible) { Applied.Enqueue(visible); return Task.CompletedTask; }
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

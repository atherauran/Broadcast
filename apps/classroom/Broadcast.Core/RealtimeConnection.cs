using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace Broadcast.Core;

// Supabase's documented Phoenix v1 JSON protocol; no Broadcast or Presence messages are accepted.
public sealed class RealtimeConnection(BackendClient backend, TimeSpan? keepAlive = null)
{
    // Supabase closes a socket that goes 25 seconds without a Phoenix heartbeat. The ping is a tiny frame with no database work.
    private static readonly TimeSpan KeepAliveInterval = TimeSpan.FromSeconds(20);
    private const int RecheckEvery = 2;   // every 40 seconds, so a missed notification is recovered while a 30-second broadcast may still be valid
    private const int StatusEvery = 6;    // every 120 seconds

    public async Task RunAsync(Action changed, Func<CancellationToken, Task> liveHeartbeat, CancellationToken ct)
    {
        using var life = CancellationTokenSource.CreateLinkedTokenSource(ct);
        using var socket = new ClientWebSocket();
        socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(60);
        var uri = new UriBuilder(backend.Config.SupabaseUrl) { Scheme = backend.Config.SupabaseUrl.StartsWith("https:") ? "wss" : "ws",
            Path = "/realtime/v1/websocket", Query = "apikey=" + Uri.EscapeDataString(backend.Config.SupabaseAnonKey) + "&vsn=1.0.0" };
        await socket.ConnectAsync(uri.Uri, ct);
        var token = await backend.AccessTokenAsync(ct);
        var topic = "realtime:device-" + backend.Session!.User.Id;
        var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        TaskCompletionSource? heartbeatAck = null;
        var heartbeatRef = "";
        var receiveTask = ReceiveAsync();
        try
        {
            await SendAsync(topic, "phx_join", "join", new
            {
                config = new { broadcast = new { ack = false, self = false }, presence = new { key = "" },
                    postgres_changes = new[] { new { @event = "INSERT", schema = "public", table = "deliveries", filter = "device_id=eq." + backend.Session.User.Id } } },
                access_token = token
            });
            await ready.Task.WaitAsync(TimeSpan.FromSeconds(15), ct);
            await liveHeartbeat(ct);
            changed();
            var sequence = 0;
            while (!ct.IsCancellationRequested)
            {
                var delay = Task.Delay(keepAlive ?? KeepAliveInterval, ct);
                if (await Task.WhenAny(receiveTask, delay) == receiveTask) { await receiveTask; throw new IOException("实时连接已关闭"); }
                await delay;
                var currentToken = await backend.AccessTokenAsync(ct);
                if (currentToken != token)
                {
                    await SendAsync(topic, "access_token", "token-" + sequence, new { access_token = currentToken });
                    token = currentToken;
                }
                heartbeatRef = "heartbeat-" + ++sequence;
                heartbeatAck = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                await SendAsync("phoenix", "heartbeat", heartbeatRef, new { });
                await heartbeatAck.Task.WaitAsync(TimeSpan.FromSeconds(8), ct);
                if (sequence % StatusEvery == 0) await liveHeartbeat(ct);
                if (sequence % RecheckEvery == 0) changed();
            }
        }
        finally
        {
            await life.CancelAsync(); socket.Abort();
            try { await receiveTask; } catch (Exception) when (life.IsCancellationRequested) { }
        }

        async Task SendAsync(string target, string kind, string reference, object payload)
        {
            var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { topic = target, @event = kind, @ref = reference,
                join_ref = target == "phoenix" ? null : "join", payload }));
            await socket.SendAsync(bytes.AsMemory(), WebSocketMessageType.Text, true, life.Token);
        }
        async Task ReceiveAsync()
        {
            try
            {
                var buffer = new byte[8192];
                while (!life.IsCancellationRequested)
                {
                    using var stream = new MemoryStream();
                    ValueWebSocketReceiveResult result;
                    do
                    {
                        result = await socket.ReceiveAsync(buffer.AsMemory(), life.Token);
                        if (result.MessageType == WebSocketMessageType.Close) throw new IOException("实时连接已关闭");
                        stream.Write(buffer, 0, result.Count);
                        if (stream.Length > 1024 * 1024) throw new IOException("实时消息过大");
                    } while (!result.EndOfMessage);
                    using var doc = JsonDocument.Parse(stream.ToArray());
                    var root = doc.RootElement;
                    var kind = root.GetProperty("event").GetString();
                    var payload = root.GetProperty("payload");
                    if (kind == "phx_error" || kind == "phx_close") throw new IOException("实时订阅已断开");
                    if (kind == "phx_reply")
                    {
                        if (payload.GetProperty("status").GetString() == "error") throw new IOException("实时订阅失败");
                        if (root.GetProperty("ref").GetString() == heartbeatRef) heartbeatAck?.TrySetResult();
                    }
                    if (kind == "system" && payload.TryGetProperty("extension", out var extension) && extension.GetString() == "postgres_changes")
                    {
                        if (payload.GetProperty("status").GetString() != "ok") throw new IOException("数据库订阅尚未就绪");
                        ready.TrySetResult();
                    }
                    if (kind == "postgres_changes") changed();
                }
            }
            catch (Exception e) { ready.TrySetException(e); heartbeatAck?.TrySetException(e); throw; }
        }
    }
}

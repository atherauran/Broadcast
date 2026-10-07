namespace Broadcast.Core;

public sealed class BindingRevokedException() : Exception("设备已解绑，请重新设置");

public sealed class ReceiverService(BackendClient backend, DeliveryQueue queue, ReceiptOutbox outbox, ServerClock clock, DisplayState display)
{
    private readonly SemaphoreSlim _work = new(0, 1);
    private readonly SemaphoreSlim _flushWork = new(0, 1);
    private readonly SemaphoreSlim _displayWork = new(0, 1);
    public event Action<string>? StatusChanged;
    public event Action? BindingRevoked;
    public event Action<Exception>? Error;
    public async Task RunAsync(CancellationToken ct)
    {
        using var life = CancellationTokenSource.CreateLinkedTokenSource(ct);
        outbox.Changed += SignalFlush;
        queue.Error += Report;
        var playback = queue.RunAsync(life.Token);
        var syncing = SyncLoop(life.Token);
        var flushing = FlushLoop(life.Token);
        var showing = display.RunAsync(life.Token);
        var displaySyncing = DisplayLoop(life.Token);
        try
        {
            var attempt = 0;
            while (!life.IsCancellationRequested)
            {
                try
                {
                    StatusChanged?.Invoke("正在连接");
                    await new RealtimeConnection(backend).RunAsync(SignalAll, SignalDisplay, async token =>
                    {
                        var state = await backend.RpcAsync<Heartbeat>("device_heartbeat", new { p_connected = true }, token);
                        clock.Sync(state.ServerNow);
                        if (!state.Active) throw new BindingRevokedException();
                        if (state.Display is not null) await display.UpdateAsync(state.Display, token);
                        attempt = 0;
                        StatusChanged?.Invoke(state.ClassroomId + " · 在线");
                    }, life.Token);
                }
                catch (BindingRevokedException) { BindingRevoked?.Invoke(); return; }
                catch (SessionExpiredException)
                { BindingRevoked?.Invoke(); return; }
                catch (BackendException e) when (e.Status == System.Net.HttpStatusCode.Unauthorized)
                { BindingRevoked?.Invoke(); return; }
                catch (OperationCanceledException) when (life.IsCancellationRequested) { return; }
                catch (Exception e)
                {
                    Report(e); StatusChanged?.Invoke("连接中断，正在重连");
                    await Task.Delay(TimeSpan.FromMilliseconds(Math.Min(10_000, 1000 * Math.Pow(2, Math.Min(attempt++, 4))) + Random.Shared.Next(300)), life.Token);
                }
            }
        }
        finally
        {
            outbox.Changed -= SignalFlush; queue.Error -= Report;
            await life.CancelAsync();
            try { await Task.WhenAll(playback, syncing, flushing, showing, displaySyncing); } catch (OperationCanceledException) { }
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            try { await backend.RpcAsync<Heartbeat>("device_heartbeat", new { p_connected = false }, timeout.Token); } catch (Exception) { }
        }
    }
    private void Signal() { lock (_work) if (_work.CurrentCount == 0) _work.Release(); }
    private void SignalFlush() { lock (_flushWork) if (_flushWork.CurrentCount == 0) _flushWork.Release(); }
    // A Realtime notification or periodic check looks for new broadcasts and also retries stuck receipts.
    private void SignalAll() { Signal(); SignalFlush(); }
    private void SignalDisplay() { lock (_displayWork) if (_displayWork.CurrentCount == 0) _displayWork.Release(); }
    private void Report(Exception e) => Error?.Invoke(e);
    private async Task SyncLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await _work.WaitAsync(ct);
            try { await queue.SyncAsync(ct); }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { return; }
            catch (Exception e) { Report(e); }
        }
    }
    // Receipts have their own loop, so a new receipt never triggers a broadcast query and a slow upload never delays one.
    private async Task FlushLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await _flushWork.WaitAsync(ct);
            try { await outbox.FlushAsync(backend, ct); }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { return; }
            catch (Exception e) { Report(e); }
        }
    }
    // Only a display_items change fetches display state; the periodic check rides on the status heartbeat.
    private async Task DisplayLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await _displayWork.WaitAsync(ct);
            try
            {
                var state = await backend.RpcAsync<DisplayBatch>("display_state", new { }, ct);
                clock.Sync(state.ServerNow);
                await display.UpdateAsync(state.Items, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { return; }
            catch (Exception e) { Report(e); }
        }
    }
}

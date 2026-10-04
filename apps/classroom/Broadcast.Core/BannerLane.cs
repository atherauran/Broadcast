namespace Broadcast.Core;

// One banner at a time, shown as soon as it is claimed; a newer banner replaces the current one.
public sealed class BannerLane(IBackend backend, IBannerDisplay display, ReceiptOutbox outbox, ServerClock clock,
    Func<TimeSpan, CancellationToken, Task>? delay = null)
{
    public static readonly TimeSpan Duration = TimeSpan.FromSeconds(15);
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly HashSet<Guid> _handled = [];
    private readonly object _lock = new();
    private readonly Func<TimeSpan, CancellationToken, Task> _delay = delay ?? Task.Delay;
    private CancellationTokenSource? _current;
    public event Action<Exception>? Error;

    public void Offer(Delivery item, CancellationToken ct)
    {
        if (item.ExpiresAt <= clock.Now) return;
        lock (_lock) if (!_handled.Add(item.DeliveryId)) return;
        outbox.Enqueue(new Receipt(item.DeliveryId, "received", clock.Now));
        _ = PlayAsync(item, ct);
    }

    private async Task PlayAsync(Delivery item, CancellationToken ct)
    {
        var claimed = false;
        CancellationTokenSource? life = null;
        try
        {
            await _gate.WaitAsync(ct);
            try
            {
                if (item.ExpiresAt <= clock.Now) return;
                claimed = await backend.ClaimAsync(item.DeliveryId, ct);
                if (!claimed) return;
                if (_current is not null) await _current.CancelAsync();
                life = _current = CancellationTokenSource.CreateLinkedTokenSource(ct);
                await display.ShowAsync(item, ct);
                Report("displayed");
            }
            finally { _gate.Release(); }
            try { await _delay(Duration, life.Token); }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested) { }
            await _gate.WaitAsync(ct);
            try
            {
                if (_current == life) { await display.HideAsync(); _current = null; }
            }
            finally { _gate.Release(); }
            Report("finished");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { await display.HideAsync(); }
        catch (Exception e)
        {
            if (!claimed) { lock (_lock) _handled.Remove(item.DeliveryId); }
            else Report("failed", "横幅显示未完成");
            Error?.Invoke(e);
        }
        finally { life?.Dispose(); }
        void Report(string kind, string? error = null) => outbox.Enqueue(new Receipt(item.DeliveryId, kind, clock.Now, error));
    }
}

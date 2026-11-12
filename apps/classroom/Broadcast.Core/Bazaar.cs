namespace Broadcast.Core;

public sealed record BazaarEntry(Guid Id, string GroupName, int Amount, DateTimeOffset OccurredAt,
    DateTimeOffset RecordedAt, Guid? ReplacesId = null);
public sealed record BazaarBatch(string ClassroomId, bool Enabled, BazaarEntry[] Entries);
public sealed record BazaarGroup(string Name, long Amount);
public sealed record BazaarPoint(DateTimeOffset At, long Amount);
public sealed record BazaarRequest(Guid Id, string Group, int Amount, Guid? Replaces = null);

public sealed class BazaarSummary
{
    public BazaarEntry[] Current { get; }
    public BazaarGroup[] Groups { get; }
    public BazaarPoint[] Curve { get; }
    public long Total { get; }

    public BazaarSummary(IReadOnlyList<BazaarEntry> entries)
    {
        var replaced = entries.Where(e => e.ReplacesId.HasValue).Select(e => e.ReplacesId!.Value).ToHashSet();
        Current = entries.Where(e => !replaced.Contains(e.Id)).OrderBy(e => e.OccurredAt).ThenBy(e => e.Id).ToArray();
        Groups = Current.GroupBy(e => e.GroupName).Select(g => new BazaarGroup(g.Key, g.Sum(e => (long)e.Amount)))
            .OrderByDescending(g => g.Amount).ThenBy(g => g.Name, StringComparer.Ordinal).ToArray();
        long total = 0;
        Curve = Current.Where(e => e.Amount > 0).GroupBy(e => e.OccurredAt)
            .Select(g => new BazaarPoint(g.Key, total += g.Sum(e => (long)e.Amount))).ToArray();
        Total = total;
    }
}

// Independent of broadcasts and file downloads. Reconnects and periodic checks recover missed notifications.
public sealed class BazaarSync(BackendClient backend)
{
    private readonly SemaphoreSlim _work = new(0, 1);
    public event Action<BazaarBatch?>? Changed;
    public event Action<Exception>? Error;
    public void Signal() { lock (_work) if (_work.CurrentCount == 0) _work.Release(); }
    public async Task SaveAsync(BazaarRequest request, CancellationToken ct) =>
        await backend.RpcAsync("record_bazaar_income", new { p_id = request.Id, p_group = request.Group,
            p_amount = request.Amount, p_replaces = request.Replaces }, ct);

    public async Task RunAsync(CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                await _work.WaitAsync(ct);
                try { Changed?.Invoke(await backend.RpcAsync<BazaarBatch?>("bazaar_state", new { }, ct)); }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { return; }
                catch (Exception e) { Error?.Invoke(e); }
            }
        }
        finally { Changed?.Invoke(null); }
    }
}

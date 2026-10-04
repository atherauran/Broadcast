using System.Text.Json;

namespace Broadcast.Core;

// Holds the server's desired screen state in memory only and applies whatever is due by the calibrated clock,
// so items expire on time without the server pushing anything.
public sealed class DisplayState(IStateDisplay display, ServerClock clock, BoardReader reader, Func<TimeSpan, CancellationToken, Task>? delay = null)
{
    public static readonly TimeSpan CountdownLinger = TimeSpan.FromSeconds(5);
    // A restart (or a late sync) must not read an old board aloud again, and nothing is kept on disk to remember it.
    public static readonly TimeSpan ReadWindow = TimeSpan.FromSeconds(60);
    private readonly Func<TimeSpan, CancellationToken, Task> _delay = delay ?? Task.Delay;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly HashSet<Guid> _read = [];
    private DisplayItem[] _items = [];
    private string _shown = "[]";
    public event Action<Exception>? Error;

    public static bool Visible(DisplayItem item, DateTimeOffset now) =>
        item.StartsAt <= now && now < item.EndsAt + (item.Kind == "countdown" ? CountdownLinger : TimeSpan.Zero);

    public async Task UpdateAsync(DisplayItem[] items, CancellationToken ct)
    {
        Volatile.Write(ref _items, items);
        await TickAsync(ct);
    }

    public async Task RunAsync(CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                try { await TickAsync(ct); }
                catch (Exception e) when (!ct.IsCancellationRequested) { Error?.Invoke(e); }
                await _delay(TimeSpan.FromSeconds(1), ct);
            }
        }
        finally
        {
            reader.Retain([]);
            await display.ApplyAsync([]);
        }
    }

    private async Task TickAsync(CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            var now = clock.Now;
            var visible = Volatile.Read(ref _items).Where(item => Visible(item, now)).ToArray();
            var signature = JsonSerializer.Serialize(visible, Json.Options);
            if (signature != _shown) { await display.ApplyAsync(visible); _shown = signature; }
            reader.Retain(visible.Select(item => item.Id));
            foreach (var board in visible.Where(item => item.Kind == "board" && item.Content.Speak && now - item.StartsAt < ReadWindow))
                if (_read.Add(board.Id)) reader.Start(board, ct);
        }
        finally { _gate.Release(); }
    }
}

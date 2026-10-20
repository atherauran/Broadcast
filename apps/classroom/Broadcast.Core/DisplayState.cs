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
    private Desired _desired = new([], null, null);
    private string _shown = "";
    public event Action<Exception>? Error;

    public static bool Visible(DisplayItem item, DateTimeOffset now) =>
        !item.Content.Hidden && item.StartsAt <= now && now < item.EndsAt + (item.Kind == "countdown" ? CountdownLinger : TimeSpan.Zero);

    // The timetable for the PC's local date; nothing on weekends (Sunday is -1, Saturday 5) or on a day without lessons.
    public static DaySchedule? Today(string[][]? week, DateTimeOffset now)
    {
        var date = DateOnly.FromDateTime(now.LocalDateTime);
        var day = (int)date.DayOfWeek - 1;
        return week is not null && day >= 0 && day < week.Length && week[day] is { Length: > 0 } periods ? new(date, periods) : null;
    }

    // Birthdays on the PC's local date; Friday also greets Saturday's and Sunday's. In other years a 29 February birthday falls on the 28th.
    public static Celebration[] Celebrations(Birthday[]? birthdays, DateTimeOffset now)
    {
        var today = DateOnly.FromDateTime(now.LocalDateTime);
        var days = today.DayOfWeek == DayOfWeek.Friday ? new[] { today, today.AddDays(1), today.AddDays(2) } : [today];
        return days.SelectMany(day => (birthdays ?? []).Where(b => Falls(b.Date, day)).Select(b => new Celebration(b.Name, day))).ToArray();

        static bool Falls(string date, DateOnly day) => date == day.ToString("MM-dd")
            || (date == "02-29" && !DateTime.IsLeapYear(day.Year) && day is { Month: 2, Day: 28 });
    }

    public async Task UpdateAsync(DisplayItem[] items, string[][]? week, Birthday[]? birthdays, CancellationToken ct)
    {
        Volatile.Write(ref _desired, new(items, week, birthdays));
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
            await display.ApplyAsync([], null, []);
        }
    }

    private async Task TickAsync(CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            var now = clock.Now;
            var desired = Volatile.Read(ref _desired);
            var visible = desired.Items.Where(item => Visible(item, now)).ToArray();
            var today = Today(desired.Week, now);
            var birthdays = Celebrations(desired.Birthdays, now);
            var signature = JsonSerializer.Serialize(new { visible, today, birthdays }, Json.Options);
            if (signature != _shown) { await display.ApplyAsync(visible, today, birthdays); _shown = signature; }
            reader.Retain(visible.Select(item => item.Id));
            foreach (var board in visible.Where(item => item.Kind == "board" && item.Content.Speak && now - item.StartsAt < ReadWindow))
                if (_read.Add(board.Id)) reader.Start(board, ct);
        }
        finally { _gate.Release(); }
    }

    private sealed record Desired(DisplayItem[] Items, string[][]? Week, Birthday[]? Birthdays);
}

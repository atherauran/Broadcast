using System.Text.Json;

namespace Broadcast.Core;

// Holds the server's desired screen state in memory only and applies whatever is due by the calibrated clock,
// so items expire on time without the server pushing anything.
public sealed class DisplayState(IStateDisplay display, ServerClock clock, Func<TimeSpan, CancellationToken, Task>? delay = null)
{
    public static readonly TimeSpan CountdownLinger = TimeSpan.FromSeconds(5);
    private readonly Func<TimeSpan, CancellationToken, Task> _delay = delay ?? Task.Delay;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private Desired _desired = new([], null, null);
    private string _shown = "";
    public event Action<Exception>? Error;

    public static bool Visible(DisplayItem item, DateTimeOffset now) =>
        item.StartsAt <= now && now < item.EndsAt + (item.Kind == "countdown" ? CountdownLinger : TimeSpan.Zero);

    // The timetable for the PC's local date; nothing on weekends (Sunday is -1, Saturday 5) or on a day without lessons.
    public static DaySchedule? Today(string[][]? week, Catalog? catalog, DateTimeOffset now)
    {
        var date = DateOnly.FromDateTime(now.LocalDateTime);
        var day = (int)date.DayOfWeek - 1;
        return week is not null && day >= 0 && day < week.Length && week[day] is { Length: > 0 } periods ? new(date, Lessons(periods, catalog, date.DayOfWeek)) : null;
    }

    // A lesson row takes the day's next bell; a rest row spans from the end of the lesson before it to the start of the one after;
    // a row without a bell, or without lessons on both sides, shows no time. A subject the catalog lacks shows its id.
    public static Lesson[] Lessons(string[] periods, Catalog? catalog, DayOfWeek day)
    {
        var bells = catalog?.Bells is { } all && (int)day - 1 is >= 0 and var at && at < all.Length ? all[at] : [];
        var subjects = periods.Select(id => catalog?.Subjects.GetValueOrDefault(id) ?? new Subject(id)).ToArray();
        var next = 0;
        var ranges = subjects.Select(subject => subject.Rest ? null : Range(bells.ElementAtOrDefault(next++))).ToArray();
        return subjects.Select((subject, i) =>
        {
            if (!subject.Rest) return new Lesson(subject.Label, false, ranges[i]?.Start, ranges[i]?.End);
            var before = ranges[..i].LastOrDefault(range => range is not null);
            var after = ranges[(i + 1)..].FirstOrDefault(range => range is not null);
            return before is not null && after is not null ? new Lesson(subject.Label, true, before.Value.End, after.Value.Start) : new Lesson(subject.Label, true, null, null);
        }).ToArray();

        static (TimeOnly Start, TimeOnly End)? Range(string? text) =>
            text is { Length: 11 } ? (TimeOnly.ParseExact(text[..5], "HH:mm"), TimeOnly.ParseExact(text[6..], "HH:mm")) : null;
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

    public async Task UpdateAsync(DisplayItem[] items, string[][]? week, Birthday[]? birthdays, CancellationToken ct, Catalog? catalog = null)
    {
        Volatile.Write(ref _desired, new(items, week, birthdays, catalog));
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
            var today = Today(desired.Week, desired.Catalog, now);
            var birthdays = Celebrations(desired.Birthdays, now);
            var signature = JsonSerializer.Serialize(new { visible, today, birthdays }, Json.Options);
            if (signature != _shown) { await display.ApplyAsync(visible, today, birthdays); _shown = signature; }
        }
        finally { _gate.Release(); }
    }

    private sealed record Desired(DisplayItem[] Items, string[][]? Week, Birthday[]? Birthdays, Catalog? Catalog = null);
}

using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Media;
using Avalonia.Threading;
using Broadcast.Classroom;
using Broadcast.Core;

AppBuilder.Configure<Application>().UseSkia().UseHeadless(new AvaloniaHeadlessPlatformOptions { UseHeadlessDrawing = false }).SetupWithoutStarting();
var output = args.Length > 0 ? args[0] : Path.Combine(Path.GetTempPath(), "broadcast-visual-tests");
Directory.CreateDirectory(output);
foreach (var (name, body, emotion, width, height) in new[]
{
    ("short", "请同学们回到教室，准备上课。", "happy", 1920, 1080),
    ("long", string.Concat(Enumerable.Repeat("请同学们整理好课本，保持教室安静。", 16)), "sad", 1366, 768),
    ("mixed", "各位老师、同学：\n今天的英语活动在 15:30 开始。\nPlease return to classroom 8-1. Thank you!", "warning", 1280, 720),
})
{
    var delivery = new Delivery(Guid.NewGuid(), Guid.NewGuid(), body, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddSeconds(30),
        "王老师", 1, true, emotion, 101001);
    var window = new BroadcastWindow(delivery) { WindowState = WindowState.Normal, Width = width, Height = height };
    window.Show(); Dispatcher.UIThread.RunJobs();
    var text = window.Body;
    if (text.Text != body || text.TextAlignment != TextAlignment.Center || text.FontSize < 28 || window.Teacher.Text != "王老师 发布" || !window.Emoji.IsVisible)
        throw new Exception(name + ": content, alignment or readable size failed");
    text.Measure(new Size(width - 128, double.PositiveInfinity));
    if (text.DesiredSize.Height > height - 256 + 1 || text.DesiredSize.Width > width - 128 + 1)
        throw new Exception(name + ": text overflows the screen");
    if (!window.Topmost || window.SystemDecorations != SystemDecorations.None || window.ShowInTaskbar)
        throw new Exception(name + ": broadcast window chrome is visible");
    using var frame = window.CaptureRenderedFrame();
    frame?.Save(Path.Combine(output, name + ".png"));
    Console.WriteLine($"PASS {name}: {width}x{height}, font {text.FontSize:F1}px, height {text.DesiredSize.Height:F1}px");
    window.Dismiss();
}

var colors = new HashSet<string?>();
foreach (var emotion in new[] { "normal", "happy", "sad", "angry", "warning" })
{
    var delivery = new Delivery(Guid.NewGuid(), Guid.NewGuid(), "颜色测试", DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddSeconds(30),
        "李老师", 0, false, emotion, 101004);
    var window = new BroadcastWindow(delivery) { WindowState = WindowState.Normal, Width = 1280, Height = 720 };
    window.Show(); Dispatcher.UIThread.RunJobs(); colors.Add(window.Body.Foreground?.ToString());
    if ((emotion == "normal") == window.Emoji.IsVisible) throw new Exception(emotion + ": emoji visibility failed");
    window.ShowCloseButton(); Dispatcher.UIThread.RunJobs();
    if (!window.CloseButton.IsVisible) throw new Exception(emotion + ": manual close button is hidden");
    window.Dismiss();
}
if (colors.Count != 5) throw new Exception("Emotion text colors are not distinct");
Console.WriteLine("PASS emotion colors, emoji and manual close button");

foreach (var (name, body, width) in new[] { ("banner-short", "请各班班长到大厅领取材料", 1920), ("banner-long", string.Concat(Enumerable.Repeat("请同学们下课后到操场集合，", 7))[..80], 1366) })
{
    var delivery = new Delivery(Guid.NewGuid(), Guid.NewGuid(), body, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddSeconds(30),
        "王老师", 0, true, "warning", 101001, "banner", "top");
    var window = new BannerWindow { Width = width };
    window.Present(delivery); window.Show(); Dispatcher.UIThread.RunJobs();
    var text = window.Body;
    if (text.Text != body || text.FontSize < 20 || window.Teacher.Text != "王老师" || !window.Emoji.IsVisible)
        throw new Exception(name + ": content or readable size failed");
    if (!window.Topmost || window.ShowInTaskbar || window.SystemDecorations != SystemDecorations.None || window.Height != BannerWindow.StripHeight)
        throw new Exception(name + ": banner must be a topmost strip without chrome");
    if (text.Bounds.Height > BannerWindow.StripHeight - 24 + 1) throw new Exception(name + ": banner text overflows the strip");
    using var frame = window.CaptureRenderedFrame();
    frame?.Save(Path.Combine(output, name + ".png"));
    Console.WriteLine($"PASS {name}: {width}px, font {text.FontSize:F1}px");
    window.Dismiss();
}

static DisplayItem Item(string kind, DisplayContent content, string teacher = "李老师") =>
    new(Guid.NewGuid(), kind, content, DateTimeOffset.UtcNow.AddMinutes(-1), DateTimeOffset.UtcNow.AddHours(2), teacher);

foreach (var (name, count, entries, width, height) in new[]
{
    ("board-short", 1, new[] { "明天穿校服", "下午第三节课大扫除", "周五前交回执" }, 1536, 864),
    ("board-two", 2, new[] { "第一条", "第二条" }, 1536, 864),
    ("board-five", 5, new[] { "公告内容1", "公告内容2" }, 1536, 864),
    ("board-medium", 1, Enumerable.Range(1, 8).Select(i => $"第{i}条：请同学们按时完成作业并带齐学习用品，周五前交回执").ToArray(), 1093, 614),
    ("board-long", 1, Enumerable.Range(1, 12).Select(i => $"第{i}条：" + string.Concat(Enumerable.Repeat("请同学们按时完成作业并带齐学习用品，", 6))[..95]).ToArray(), 1093, 614),
})
{
    var board = new BoardWindow { Width = width, Height = height };
    board.Present(Enumerable.Range(1, count).Select(i => Item("board", new DisplayContent($"今日公告{i}", entries, true))).ToArray()); board.Show(); Dispatcher.UIThread.RunJobs();
    if (board.Topmost || !board.ShowInTaskbar || board.Title != "公告") throw new Exception(name + ": board must be a normal window");
    // Only content too long for the window at the smallest size may scroll.
    if (board.Boards.Bounds.Height > board.ClientSize.Height - 80 + 1 && board.BaseSize > 14.5) throw new Exception(name + ": board overflows its window");
    if (name != "board-long" && board.BaseSize < 22) throw new Exception(name + ": board text below readable size");
    if (name == "board-five" && board.Columns < 2) throw new Exception(name + ": short boards should spread into columns");
    if (board.BaseSize > 40) throw new Exception(name + ": board text above the size cap");
    using var frame = board.CaptureRenderedFrame(); frame?.Save(Path.Combine(output, name + ".png"));
    Console.WriteLine($"PASS {name}: {width}x{height}, {board.Columns} column(s), font {board.BaseSize:F1}px");
    board.Dismiss();
}

foreach (var theme in new[] { "plain", "festive", "joyful", "fresh", "tech", "safety" })
{
    var board = new BoardWindow { Width = 1280, Height = 720 };
    board.Present([Item("board", new DisplayContent("国庆放假通知", ["10月1日至7日放假，8日正常上课", "假期外出注意安全，不到河边玩水"], Theme: theme)),
        Item("board", new DisplayContent("旧公告", ["较早的公告沿用最新公告的背景"], Theme: "plain"))]);
    board.Show(); Dispatcher.UIThread.RunJobs();
    if ((theme == "plain") != (board.Background == Brushes.White) || board.LookName != theme) throw new Exception("board-" + theme + ": background does not follow the newest board");
    using var frame = board.CaptureRenderedFrame(); frame?.Save(Path.Combine(output, "board-" + theme + ".png"));
    board.Dismiss();
}
Console.WriteLine("PASS board themes: the newest board sets the background");

var clock = new ServerClock();
var countdown = new CountdownWindow(clock);
countdown.Present(Item("countdown", new DisplayContent(Label: "距离下课")) with { EndsAt = clock.Now.AddMinutes(25).AddSeconds(-0.5) });
countdown.Show(); Dispatcher.UIThread.RunJobs();
if (!countdown.Topmost || countdown.ShowInTaskbar || countdown.Digits.Text != "25:00" || countdown.Label.Text != "距离下课")
    throw new Exception("countdown: must be a topmost corner timer");
countdown.Present(Item("countdown", new DisplayContent(Label: "距离放学")) with { EndsAt = clock.Now.AddHours(10) });
Dispatcher.UIThread.RunJobs();
// "10:00:00" is wider than the column, so it must be scaled down to fit rather than cut off.
if (countdown.Bounds.Width > NotesWindow.ColumnWidth + .5 || countdown.Digits.DesiredSize.Width <= ((Viewbox)countdown.Digits.Parent!).Bounds.Width)
    throw new Exception("countdown: hour digits must shrink to fit the column");
if (CountdownWindow.Format(TimeSpan.FromSeconds(3725)) != "1:02:05" || CountdownWindow.Format(TimeSpan.FromSeconds(-3)) != "00:00")
    throw new Exception("countdown: digit format failed");
using (var frame = countdown.CaptureRenderedFrame()) frame?.Save(Path.Combine(output, "countdown.png"));
Console.WriteLine("PASS countdown: topmost, label and digits");
countdown.Dismiss();

string DayText(int ahead) => DateOnly.FromDateTime(clock.Now.LocalDateTime).AddDays(ahead).ToString("yyyy-MM-dd");
string Shown(TextBlock block) => string.Concat(block.Inlines!.OfType<Avalonia.Controls.Documents.Run>().Select(run => run.Text));
DisplayItem Day(string label, int ahead) => Item("countdown", new DisplayContent(Label: label, Date: DayText(ahead))) with { EndsAt = clock.Now.AddDays(ahead + 1) };
var noteItems = new[] { "yellow", "blue", "green", "pink" }.Select((color, i) =>
    Item("note", new DisplayContent(Text: i == 3 ? string.Concat(Enumerable.Repeat("记得带体育服和水杯，", 6)) : $"第{i + 1}张便签", Color: color))).ToArray();
var notesWindow = new NotesWindow();
notesWindow.Present(noteItems);
notesWindow.Show(); Dispatcher.UIThread.RunJobs();
if (notesWindow.Topmost || notesWindow.ShowInTaskbar || notesWindow.Cards.Children.Count != 4) throw new Exception("notes: must be four non-topmost cards");
using (var frame = notesWindow.CaptureRenderedFrame()) frame?.Save(Path.Combine(output, "notes.png"));
// A short screen pushes the stack into more columns, all within the height limit.
notesWindow.Cards.MaxHeight = 300; Dispatcher.UIThread.RunJobs();
// Headless capture returns the last rendered frame, so a change made after showing needs a fresh render first.
AvaloniaHeadlessPlatform.ForceRenderTimerTick(); Dispatcher.UIThread.RunJobs();
var columns = notesWindow.Cards.Children.GroupBy(card => card.Bounds.X).ToArray();
if (columns.Length < 2 || notesWindow.Cards.Children.Any(card => card.Bounds.Bottom > 300.5) || notesWindow.Cards.Children[0].Bounds.X < columns.Max(c => c.Key))
    throw new Exception("notes: overflowing cards must move into a new column");
using (var frame = notesWindow.CaptureRenderedFrame()) frame?.Save(Path.Combine(output, "notes-columns.png"));
Console.WriteLine($"PASS notes: {columns.Length} columns within 300px");
notesWindow.Dismiss();

var dayWindow = new DayCountWindow(clock);
dayWindow.Present([Day("距离期末", 23), Day("距离中考", 90), Day("距离运动会", 5)]);
dayWindow.Show(); Dispatcher.UIThread.RunJobs();
var firstDigits = (TextBlock)((StackPanel)((Border)dayWindow.Cards.Children[0]).Child!).Children[1];
if (dayWindow.Topmost || dayWindow.ShowInTaskbar || dayWindow.Cards.Children.Count != 3 || Shown(firstDigits) != "23 天")
    throw new Exception("days: must be three day counts in a window others can cover");
if (DayCountWindow.Days(DateOnly.FromDateTime(clock.Now.LocalDateTime), clock.Now) != "今天") throw new Exception("days: the day itself must read 今天");
using (var frame = dayWindow.CaptureRenderedFrame()) frame?.Save(Path.Combine(output, "days.png"));
Console.WriteLine($"PASS days: {dayWindow.Bounds.Width:F0}x{dayWindow.Bounds.Height:F0}, not topmost");
dayWindow.Dismiss();

var schedule = new ScheduleWindow();
var monday = new DateOnly(2026, 10, 12);
schedule.Present(new DaySchedule(monday, ["english", "math", "physics", "chemistry", "lunch", "morality", "it", "pe", "club"]));
schedule.Show(); Dispatcher.UIThread.RunJobs();
var header = (TextBlock)((Viewbox)((Border)schedule.Rows.Children[0]).Child!).Child!;
var lunch = (Border)schedule.Rows.Children[5];
if (schedule.Topmost || schedule.ShowInTaskbar || schedule.Rows.Children.Count != 10 || header.Text != "10/12 Monday"
    || ((TextBlock)((Viewbox)lunch.Child!).Child!).Text != "午餐 Lunch" || lunch.Background is null)
    throw new Exception("schedule: header, rows or lunch row failed");
if (schedule.RowHeight < 40) throw new Exception("schedule: rows must fill the column readably");
using (var frame = schedule.CaptureRenderedFrame()) frame?.Save(Path.Combine(output, "schedule.png"));
Console.WriteLine($"PASS schedule: {schedule.Bounds.Width:F0}x{schedule.Bounds.Height:F0}, rows {schedule.RowHeight:F0}px");
var screen = schedule.Screens.Primary!;
schedule.Dismiss();

var shrunk = false;
var full = new CountdownWindow(clock, () => shrunk = true) { WindowState = WindowState.Normal, Width = 1366, Height = 768 };
full.Present(Item("countdown", new DisplayContent(Label: "距离考试结束", Fullscreen: true)) with { EndsAt = clock.Now.AddHours(1).AddMinutes(2).AddSeconds(4.5) });
full.Show(); Dispatcher.UIThread.RunJobs();
if (!full.Topmost || full.ShowInTaskbar || !full.IsFullscreen || full.Digits.Text != "1:02:05" || full.ShrinkButton is not { IsVisible: true })
    throw new Exception("countdown-fullscreen: must be a topmost fullscreen timer with a shrink button");
if (full.Digits.Parent is not Viewbox { Bounds.Width: > 900 }) throw new Exception("countdown-fullscreen: digits must fill the screen");
using (var frame = full.CaptureRenderedFrame()) frame?.Save(Path.Combine(output, "countdown-fullscreen.png"));
full.ShrinkButton.RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));
if (!shrunk) throw new Exception("countdown-fullscreen: shrink button does nothing");
Console.WriteLine("PASS countdown-fullscreen: digits fill the screen, shrink button works");
full.Dismiss();

// The whole screen through StateDisplay: every window must land in its column, under the topmost ones, and stay on screen.
var (area, scale) = (screen.WorkingArea, screen.Scaling);
var stateDisplay = new StateDisplay(clock, new BroadcastDisplay());
var week = new DaySchedule(monday, ["english", "math", "physics", "chemistry", "lunch", "morality", "art", "pe"]);
var timer = Item("countdown", new DisplayContent(Label: "距离下课")) with { EndsAt = clock.Now.AddMinutes(20) };
var festive = Item("board", new DisplayContent("国庆放假通知", ["10月1日至7日放假，8日正常上课", "假期外出注意安全"], Theme: "festive"));
void Apply(string step, DaySchedule? today, params DisplayItem[] items)
{
    var task = stateDisplay.ApplyAsync(items, today);
    Dispatcher.UIThread.RunJobs();
    if (!task.IsCompletedSuccessfully) throw new Exception(step + ": apply did not finish");
    var windows = stateDisplay.Open.Where(w => w is not BoardWindow).ToArray();
    double Top(Window w) => (w.Position.Y - area.Y) / scale;
    double Right(Window w) => area.Width / scale - (w.Position.X - area.X) / scale - w.Bounds.Width;
    foreach (var w in windows)
        if (Top(w) < 23 || Right(w) < 23 || Right(w) + w.Bounds.Width > area.Width / scale - 23 || Top(w) + w.Bounds.Height > area.Height / scale - 23)
            throw new Exception($"{step}: {w.GetType().Name} is off screen");
    var days = windows.OfType<DayCountWindow>().SingleOrDefault();
    var table = windows.OfType<ScheduleWindow>().SingleOrDefault();
    var corner = windows.OfType<CountdownWindow>().SingleOrDefault(c => !c.IsFullscreen);
    var notes = windows.OfType<NotesWindow>().SingleOrDefault();
    var inner = days is not null || table is not null ? ScheduleWindow.ColumnWidth + StateDisplay.Gap : 0;
    void At(Window? w, double right, double top, string what)
    {
        if (w is not null && (Math.Abs(Right(w) - right) > 1.5 || Math.Abs(Top(w) - top) > 1.5))
            throw new Exception($"{step}: {what} at right {Right(w):F0}, top {Top(w):F0}; expected {right:F0}, {top:F0}");
    }
    At(days, 24, 24, "day counts");
    At(table, 24, days is null ? 24 : Top(days) + days.Bounds.Height + StateDisplay.Gap, "schedule");
    At(corner, 24 + inner, 24, "timer");
    At(notes, 24 + inner, corner is null ? 24 : Top(corner) + corner.Bounds.Height + StateDisplay.Gap, "notes");
}
Apply("full", week, [.. noteItems, Day("距离期末", 23), Day("距离中考", 90), timer, festive]);
Apply("no-days", week, [.. noteItems[..2], timer]);
Apply("notes-only", null, [.. noteItems, timer]);
Apply("three-days", week, [noteItems[0], Day("距离期末", 23), Day("距离中考", 90), Day("运动会", 3)]);
Apply("two-days", week, [noteItems[0], Day("距离期末", 23), Day("距离中考", 90)]);
var twelve = Enumerable.Range(1, 12).Select(i => Item("note", new DisplayContent(Text: i % 3 == 0 ? string.Concat(Enumerable.Repeat("记得带体育服和水杯，", 6)) : $"第{i}张便签", Color: "yellow"))).ToArray();
Apply("twelve-notes", week, [.. twelve, Day("距离期末", 23), Day("距离中考", 90), Day("运动会", 3), timer]);
if (stateDisplay.Open.OfType<NotesWindow>().Single().Cards.Children.Select(card => card.Bounds.X).Distinct().Count() < 2)
    throw new Exception("twelve-notes: notes should spread over several columns");
Apply("weekend", null, [Day("距离期末", 23), timer]);
Apply("empty", null);
if (stateDisplay.Open.Any()) throw new Exception("empty: windows left open");
Console.WriteLine("PASS layout: columns, stacking and on-screen bounds across updates");

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
    board.Present(Enumerable.Range(1, count).Select(i => Item("board", new DisplayContent($"今日公告{i}", entries, true))).ToArray(), []); board.Show(); Dispatcher.UIThread.RunJobs();
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
        Item("board", new DisplayContent("旧公告", ["较早的公告沿用最新公告的背景"], Theme: "plain"))], []);
    board.Show(); Dispatcher.UIThread.RunJobs();
    if ((theme == "plain") != (board.Background == Brushes.White) || board.LookName != theme) throw new Exception("board-" + theme + ": background does not follow the newest board");
    using var frame = board.CaptureRenderedFrame(); frame?.Save(Path.Combine(output, "board-" + theme + ".png"));
    board.Dismiss();
}
Console.WriteLine("PASS board themes: the newest board sets the background");

var (raised, celebrated) = (0, 0);
var today = DateOnly.FromDateTime(DateTime.Now);
Celebration[] birthdays = [new("胡昊凯 Martin", today), new("许书杨 Sophia", today.AddDays(1))];
var flagBoard = new BoardWindow(() => raised++, () => celebrated++) { Width = 1280, Height = 720 };
var morning = Item("board", new DisplayContent("晨会通知", Enumerable.Range(1, 6).Select(i => $"第{i}条：请同学们按时完成作业并带齐学习用品").ToArray(), Flag: true));
flagBoard.Present([morning], []);
flagBoard.Show(); Dispatcher.UIThread.RunJobs();
if (flagBoard.BirthdayButton.IsVisible) throw new Exception("board-flag: no birthday, no birthday button");
var textBottom = flagBoard.Boards.TranslatePoint(new Point(0, flagBoard.Boards.Bounds.Height), flagBoard)!.Value.Y;
if (!flagBoard.FlagButton.IsVisible || flagBoard.FlagButton.TranslatePoint(default, flagBoard)!.Value.Y < textBottom + 12)
    throw new Exception("board-flag: the flag button must show below the text");
flagBoard.FlagButton.RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));
if (raised != 1) throw new Exception("board-flag: the flag button does nothing");
flagBoard.Present([morning], birthdays); Dispatcher.UIThread.RunJobs();
if (!flagBoard.BirthdayButton.IsVisible || !flagBoard.FlagButton.IsVisible) throw new Exception("board-flag: a morning board with a birthday shows both buttons");
flagBoard.BirthdayButton.RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));
if (celebrated != 1) throw new Exception("board-flag: the birthday button does nothing");
AvaloniaHeadlessPlatform.ForceRenderTimerTick(); Dispatcher.UIThread.RunJobs();
using (var frame = flagBoard.CaptureRenderedFrame()) frame?.Save(Path.Combine(output, "board-flag.png"));
flagBoard.Present([Item("board", new DisplayContent("国庆升旗", ["请同学们起立"], Theme: "festive", Flag: true))], birthdays);
AvaloniaHeadlessPlatform.ForceRenderTimerTick(); Dispatcher.UIThread.RunJobs();
using (var frame = flagBoard.CaptureRenderedFrame()) frame?.Save(Path.Combine(output, "board-flag-festive.png"));
if (flagBoard.BirthdayButton.IsVisible) throw new Exception("board-flag: only the morning meeting board offers the birthday greeting");
flagBoard.Present([Item("board", new DisplayContent("通知", ["没有升旗"]))], []); Dispatcher.UIThread.RunJobs();
if (flagBoard.FlagButton.IsVisible) throw new Exception("board-flag: boards without the flag must hide the button");
flagBoard.Dismiss();
Console.WriteLine("PASS board-flag: button below the text raises the flag");

var anthem = new SilentAudio();
var flag = new PlaybackWindow(anthem, "anthem.wav", new FlagScene()) { WindowState = WindowState.Normal, Width = 1366, Height = 768 };
flag.Show(); Dispatcher.UIThread.RunJobs();
if (!flag.Topmost || flag.ShowInTaskbar || anthem.Played < 1_000_000) throw new Exception("flag: must be topmost and play the anthem");
foreach (var seconds in new[] { 0, 1 })
{
    flag.Scene.Seconds = seconds; flag.Scene.InvalidateVisual();
    AvaloniaHeadlessPlatform.ForceRenderTimerTick(); Dispatcher.UIThread.RunJobs();
    using var frame = flag.CaptureRenderedFrame(); frame?.Save(Path.Combine(output, $"flag-{seconds}.png"));
}
flag.MouseDown(new Point(400, 300), Avalonia.Input.MouseButton.Left);
for (var i = 0; i < 20 && flag.IsVisible; i++) { Thread.Sleep(10); Dispatcher.UIThread.RunJobs(); }
if (flag.IsVisible || !anthem.Stopped) throw new Exception("flag: a tap must stop the anthem and close the window");

// The stars sit on the flag's 30 × 20 grid at any pixel size, and land in place when the screen is scaled.
(byte R, byte G, byte B) Pixel(Avalonia.Media.Imaging.Bitmap bitmap, int x, int y)
{
    var buffer = new byte[4];
    var pin = System.Runtime.InteropServices.GCHandle.Alloc(buffer, System.Runtime.InteropServices.GCHandleType.Pinned);
    try { bitmap.CopyPixels(new PixelRect(x, y, 1, 1), pin.AddrOfPinnedObject(), 4, 4); } finally { pin.Free(); }
    return bitmap.Format == Avalonia.Platform.PixelFormat.Rgba8888 ? (buffer[0], buffer[1], buffer[2]) : (buffer[2], buffer[1], buffer[0]);
}
bool Yellow((byte R, byte G, byte B) p) => p.R > 200 && p.G > 170 && p.B < 90;
bool Red((byte R, byte G, byte B) p) => p.R > 150 && p.G < 80 && p.B < 80;
foreach (var width in new[] { 300, 450, 600 })
{
    using var art = FlagArt.Bitmap(new PixelSize(width, width * 2 / 3));
    int At(double units) => (int)(units * width / 30);
    if (!Yellow(Pixel(art, At(5), At(5))) || !Yellow(Pixel(art, At(10), At(2))) || !Yellow(Pixel(art, At(12), At(7)))
        || !Red(Pixel(art, At(5), At(1.5) - 2)) || !Red(Pixel(art, At(20), At(10))) || !Red(Pixel(art, At(8), At(10))))
        throw new Exception($"flag: stars misplaced at {width}px");
}
var scaled = new FlagScene();
scaled.Measure(new Size(600, 400)); scaled.Arrange(new Rect(0, 0, 600, 400));
using (var frame = new Avalonia.Media.Imaging.RenderTargetBitmap(new PixelSize(1200, 800), new Vector(192, 192)))
{
    frame.Render(scaled);
    // The flag is 540 × 360 at (30, 20); positions double in a 200% frame.
    int X(double units) => (int)((30 + units * 18) * 2);
    int Y(double units) => (int)((20 + units * 18) * 2);
    if (!Yellow(Pixel(frame, X(5), Y(5))) || !Yellow(Pixel(frame, X(10), Y(2) + 2)) || !Red(Pixel(frame, X(20), Y(10))) || !Red(Pixel(frame, X(8), Y(10))))
        throw new Exception("flag: stars misplaced on a 200% screen");
    frame.Save(Path.Combine(output, "flag-200.png"));
}
Console.WriteLine("PASS flag: anthem plays, a tap ends it, stars in place at any scaling");

var song = new SilentAudio();
var party = new PlaybackWindow(song, "birthday.wav", new BirthdayScene(birthdays, today)) { WindowState = WindowState.Normal, Width = 1366, Height = 768 };
party.Show(); Dispatcher.UIThread.RunJobs();
if (song.Played < 100_000) throw new Exception("birthday: the song must play");
party.Scene.Seconds = 3; party.Scene.Advance();
AvaloniaHeadlessPlatform.ForceRenderTimerTick(); Dispatcher.UIThread.RunJobs();
using (var frame = party.CaptureRenderedFrame()) frame?.Save(Path.Combine(output, "birthday.png"));
party.KeyPress(Avalonia.Input.Key.Escape, Avalonia.Input.RawInputModifiers.None, Avalonia.Input.PhysicalKey.Escape, null);
for (var i = 0; i < 20 && party.IsVisible; i++) { Thread.Sleep(10); Dispatcher.UIThread.RunJobs(); }
if (party.IsVisible) throw new Exception("birthday: Esc must close the window");
if (BirthdayArt.Label(birthdays[1], today) != (today.AddDays(1).DayOfWeek == DayOfWeek.Saturday ? "许书杨 Sophia（周六）" : "许书杨 Sophia（周日）"))
    throw new Exception("birthday: a weekend birthday must name its day");
Console.WriteLine("PASS birthday: the song plays with the greeting and Esc ends it");

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
notesWindow.Present(noteItems, [], today);
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
notesWindow.Present(noteItems[..2], birthdays, today); notesWindow.Cards.MaxHeight = 1000;
AvaloniaHeadlessPlatform.ForceRenderTimerTick(); Dispatcher.UIThread.RunJobs();
if (notesWindow.Cards.Children.Count != 3) throw new Exception("notes: the birthday card must lead the notes");
using (var frame = notesWindow.CaptureRenderedFrame()) frame?.Save(Path.Combine(output, "notes-birthday.png"));
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
TextBlock Cell(int row, int index) => ((Border)schedule.Rows.Children[row]).Child switch { Viewbox v => (TextBlock)v.Child!, var c => (TextBlock)((StackPanel)c!).Children[index] };
var lunch = (Border)schedule.Rows.Children[5];
if (schedule.Topmost || schedule.ShowInTaskbar || schedule.Rows.Children.Count != 10 || Cell(0, 0).Text != "10/12 Monday"
    || Cell(5, 0).Text != "午餐 Lunch" || lunch.Background is null || Cell(1, 1).Text != "8:30–9:10" || Cell(5, 1).Text != "11:50–12:40")
    throw new Exception("schedule: header, rows, times or lunch row failed");
// 8-4's Wednesday: four lessons, lunch, five more.
var wednesday = ScheduleWindow.Times(["chinese", "chinese", "math", "pe", "lunch", "english", "english", "physics", "biology", "club"])
    .Select(t => $"{t.Start:H:mm}-{t.End:H:mm}");
if (string.Join(" ", wednesday) != "8:30-9:10 9:25-10:05 10:20-11:00 11:15-11:50 11:50-12:40 12:40-13:20 13:35-14:15 14:30-15:10 15:25-16:05 16:20-17:00")
    throw new Exception("schedule: lesson times are wrong: " + string.Join(" ", wednesday));
if (schedule.RowHeight < 40) throw new Exception("schedule: rows must fill the column readably");
using (var frame = schedule.CaptureRenderedFrame()) frame?.Save(Path.Combine(output, "schedule.png"));
// A long day under tall day counts leaves short rows; each name and time must still fit its row.
schedule.Present(new DaySchedule(monday, ["english", "math", "physics", "chemistry", "lunch", "morality", "it", "pe", "club", "art", "history", "biology"]));
schedule.Place(top: 560); Dispatcher.UIThread.RunJobs();
foreach (var row in schedule.Rows.Children.OfType<Border>().Skip(1))
{
    row.Child!.Measure(Size.Infinity);
    if (row.Child.DesiredSize.Height > schedule.RowHeight) throw new Exception($"schedule: a {schedule.RowHeight}px row overflows");
}
AvaloniaHeadlessPlatform.ForceRenderTimerTick(); Dispatcher.UIThread.RunJobs();
using (var frame = schedule.CaptureRenderedFrame()) frame?.Save(Path.Combine(output, "schedule-short.png"));
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
var stateDisplay = new StateDisplay(clock, new BroadcastDisplay(), new SilentAudio());
var week = new DaySchedule(monday, ["english", "math", "physics", "chemistry", "lunch", "morality", "art", "pe"]);
var timer = Item("countdown", new DisplayContent(Label: "距离下课")) with { EndsAt = clock.Now.AddMinutes(20) };
var festive = Item("board", new DisplayContent("国庆放假通知", ["10月1日至7日放假，8日正常上课", "假期外出注意安全"], Theme: "festive"));
void Apply(string step, DaySchedule? today, params DisplayItem[] items)
{
    var task = stateDisplay.ApplyAsync(items, today, []);
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
var birthdayOnly = stateDisplay.ApplyAsync([], null, birthdays); Dispatcher.UIThread.RunJobs();
if (!birthdayOnly.IsCompletedSuccessfully || stateDisplay.Open.OfType<NotesWindow>().SingleOrDefault()?.Cards.Children.Count != 1)
    throw new Exception("birthday-only: the birthday card must show without notes");
Apply("empty-again", null);
if (stateDisplay.Open.Any()) throw new Exception("empty: windows left open");
Console.WriteLine("PASS layout: columns, stacking and on-screen bounds across updates");

// Stands in for the speakers: holds the sound until it is stopped.
sealed class SilentAudio : IAudioPlayer
{
    public int Played { get; private set; }
    public bool Stopped { get; private set; }
    public async Task PlayAsync(byte[] audio, Action started, CancellationToken ct)
    {
        Played = audio.Length;
        try { await Task.Delay(Timeout.Infinite, ct); } finally { Stopped = true; }
    }
}

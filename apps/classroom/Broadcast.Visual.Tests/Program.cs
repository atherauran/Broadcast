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
    using var frame = board.CaptureRenderedFrame(); frame?.Save(Path.Combine(output, name + ".png"));
    Console.WriteLine($"PASS {name}: {width}x{height}, {board.Columns} column(s), font {board.BaseSize:F1}px");
    board.Dismiss();
}

var notes = new NotesWindow();
notes.Present(new[] { "yellow", "blue", "green", "pink" }.Select((color, i) =>
    Item("note", new DisplayContent(Text: i == 3 ? string.Concat(Enumerable.Repeat("记得带体育服和水杯，", 6)) : $"第{i + 1}张便签", Color: color))).ToArray());
notes.Show(); Dispatcher.UIThread.RunJobs();
if (notes.Topmost || notes.ShowInTaskbar || notes.Cards.Children.Count != 4) throw new Exception("notes: must be four non-topmost cards");
using (var frame = notes.CaptureRenderedFrame()) frame?.Save(Path.Combine(output, "notes.png"));
Console.WriteLine($"PASS notes: {notes.Bounds.Width:F0}x{notes.Bounds.Height:F0}");
notes.Dismiss();

var clock = new ServerClock();
var countdown = new CountdownWindow(clock);
countdown.Present(Item("countdown", new DisplayContent(Label: "距离下课")) with { EndsAt = clock.Now.AddMinutes(25).AddSeconds(-0.5) });
countdown.Show(); Dispatcher.UIThread.RunJobs();
if (!countdown.Topmost || countdown.ShowInTaskbar || countdown.Digits.Text != "25:00" || countdown.Label.Text != "距离下课")
    throw new Exception("countdown: must be a topmost corner timer");
if (CountdownWindow.Format(TimeSpan.FromSeconds(3725)) != "1:02:05" || CountdownWindow.Format(TimeSpan.FromSeconds(-3)) != "00:00")
    throw new Exception("countdown: digit format failed");
using (var frame = countdown.CaptureRenderedFrame()) frame?.Save(Path.Combine(output, "countdown.png"));
Console.WriteLine("PASS countdown: topmost, label and digits");
countdown.Dismiss();

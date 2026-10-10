using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Documents;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Styling;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Broadcast.Core;

namespace Broadcast.Classroom;

// Classroom windows close only when the app says so; classroom users cannot close them.
internal abstract class ClassroomWindow : Window
{
    public static readonly FontFamily Font = new("Microsoft YaHei, Segoe UI");
    public static readonly IBrush Night = new SolidColorBrush(Color.Parse("#111827")).ToImmutable();
    protected bool Dismissed { get; private set; }

    protected ClassroomWindow() { Closing += (_, e) => WindowLayer.KeepOpen(e, Dismissed); }

    public void Dismiss() { Dismissed = true; Close(); }
}

// A window showing part of the server's display state.
internal abstract class StateWindow : ClassroomWindow
{
    protected const double ScreenMargin = 24;

    // A projector or resolution change moves the working area, so edge windows must find their place again.
    protected StateWindow() { Screens.Changed += (_, _) => Dispatcher.UIThread.Post(() => { if (!Dismissed) Relayout(); }); }

    // Edge windows hang from the top right. Top leaves room for a topmost window above in the same column,
    // inner for the column between this one and the screen edge.
    protected double Top { get; private set; }
    protected double Inner { get; private set; }
    public void Place(double top = 0, double inner = 0) { Top = top; Inner = inner; Relayout(); }
    protected virtual void Relayout() { }

    // Usable height of the primary screen inside the margins.
    protected double ScreenHeight => Screens.Primary is { } screen ? screen.WorkingArea.Height / screen.Scaling - ScreenMargin * 2 : 1000;

    // The content's size right now: a window that was just created or changed is not laid out until the next pass,
    // and the measure cache would otherwise keep the previous size.
    internal Size ContentSize()
    {
        var root = (Layoutable)Content!;
        foreach (var control in root.GetSelfAndVisualDescendants().OfType<Layoutable>()) control.InvalidateMeasure();
        root.Measure(Size.Infinity);
        return root.DesiredSize;
    }

    protected void PlaceRight(double width)
    {
        if (Screens.Primary is not { } screen) return;
        var area = screen.WorkingArea;
        var margin = (int)(ScreenMargin * screen.Scaling);
        Position = new PixelPoint(area.Right - margin - (int)((width + Inner) * screen.Scaling), area.Y + margin + (int)(Top * screen.Scaling));
    }

    // A borderless window the size of its content; only the content's own rounded shapes show.
    protected void Chromeless(bool topmost)
    {
        SystemDecorations = SystemDecorations.None; ShowInTaskbar = false; Topmost = topmost; CanResize = false;
        TransparencyLevelHint = [WindowTransparencyLevel.Transparent]; Background = Brushes.Transparent;
        SizeToContent = SizeToContent.WidthAndHeight; WindowStartupLocation = WindowStartupLocation.Manual;
    }

    protected static string Until(DateTimeOffset end)
    {
        var local = end.ToLocalTime();
        return "至 " + (local.Date == DateTime.Today ? local.ToString("HH:mm") : local.ToString("M月d日 HH:mm"));
    }

    protected static TextBlock Text(string text, double size, string color, FontWeight weight = FontWeight.Normal) => new()
    {
        Text = text, FontSize = size, FontWeight = weight, FontFamily = Font, Foreground = new SolidColorBrush(Color.Parse(color)),
        TextWrapping = TextWrapping.Wrap,
    };

    protected static TextBlock Centered(TextBlock block) { block.HorizontalAlignment = HorizontalAlignment.Center; return block; }

    protected static TextBlock DigitText(double size) => new()
    {
        FontFamily = new FontFamily("Consolas, Cascadia Mono, Microsoft YaHei"), FontSize = size, FontWeight = FontWeight.Bold,
        Foreground = Brushes.White, HorizontalAlignment = HorizontalAlignment.Center,
    };
}

// Boards flow top to bottom, then into the next column, in whichever column count gives the largest text.
internal sealed class BoardWindow : StateWindow
{
    private const double ColumnGap = 56, MinColumn = 320, MinSize = 14, MaxSize = 40;
    private sealed record Look(IBrush Background, string Title, string Body, string Muted);
    private static IBrush Gradient(string from, string to) => new LinearGradientBrush
    {
        StartPoint = new RelativePoint(0, 0, RelativeUnit.Relative), EndPoint = new RelativePoint(1, 1, RelativeUnit.Relative),
        GradientStops = { new GradientStop(Color.Parse(from), 0), new GradientStop(Color.Parse(to), 1) },
    }.ToImmutable();
    private static readonly Dictionary<string, Look> Looks = new()
    {
        ["plain"] = new(Brushes.White, "#1D4ED8", "#182236", "#5F6C80"),
        ["festive"] = new(Gradient("#C81E1E", "#7F1D1D"), "#FDE68A", "#FFF7ED", "#FECACA"),
        ["joyful"] = new(Gradient("#FFE0EF", "#FFF1C2"), "#BE185D", "#3B1D2A", "#8A4B66"),
        ["fresh"] = new(Gradient("#DCF5E7", "#D6ECFB"), "#047857", "#10302A", "#4B6B63"),
        ["tech"] = new(Gradient("#0B1220", "#15305A"), "#38BDF8", "#E2E8F0", "#94A3B8"),
        ["safety"] = new(Gradient("#FFF6D8", "#FFE2A8"), "#B45309", "#3B2A10", "#7C5A26"),
    };
    private readonly Grid _columns = new();
    private readonly Backdrop _backdrop = new();
    // A block is one entry; the board's title rides on its first entry and the footer on its last, so neither is orphaned.
    private readonly List<(StackPanel Panel, bool Starts)> _blocks = [];
    private readonly List<(TextBlock Block, double Scale)> _texts = [];
    private readonly List<TextBlock> _numbers = [];
    internal Grid Boards => _columns;
    internal string LookName => _backdrop.Look;
    internal int Columns { get; private set; }
    internal double BaseSize { get; private set; }

    public BoardWindow()
    {
        Title = "公告"; FontFamily = Font;
        var scroller = new ScrollViewer
        {
            HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled,
            Content = new Border { Padding = new Thickness(56, 40), Child = _columns },
        };
        Content = new Panel { Children = { _backdrop, scroller } };
        SizeChanged += (_, _) => Fit();
    }

    // Boards share one window, so it takes the background of the newest one (boards arrive newest first).
    public void Present(IReadOnlyList<DisplayItem> boards)
    {
        _blocks.Clear(); _texts.Clear(); _numbers.Clear();
        var name = boards.FirstOrDefault()?.Content.Theme is { } id && Looks.ContainsKey(id) ? id : "plain";
        var look = Looks[name];
        Background = look.Background; _backdrop.Look = name;
        foreach (var board in boards)
        {
            var entries = board.Content.Entries ?? [];
            for (var i = 0; i < Math.Max(1, entries.Length); i++)
            {
                var block = new StackPanel();
                if (i == 0) Add(block, Text(board.Content.Title ?? "公告", 22, look.Title, FontWeight.Bold), 1.3);
                if (i < entries.Length)
                {
                    var row = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*") };
                    var number = Text($"{i + 1}.", 22, look.Muted, FontWeight.SemiBold); _numbers.Add(number);
                    var body = Text(entries[i], 22, look.Body, FontWeight.Medium);
                    Grid.SetColumn(body, 1); row.Children.Add(number); row.Children.Add(body);
                    _texts.Add((number, 1)); _texts.Add((body, 1)); block.Children.Add(row);
                }
                if (i >= entries.Length - 1) Add(block, Text($"{board.TeacherName} · {Until(board.EndsAt)}", 22, look.Muted), .7);
                _blocks.Add((block, i == 0));
            }
        }
        Fit();

        void Add(StackPanel parent, TextBlock block, double scale) { _texts.Add((block, scale)); parent.Children.Add(block); }
    }

    private void Fit()
    {
        var width = Math.Max(100, ClientSize.Width - 112 - 20);
        var height = Math.Max(100, ClientSize.Height - 80);
        var most = Math.Clamp((int)((width + ColumnGap) / (MinColumn + ColumnGap)), 1, 4);
        (int Columns, double Size) best = (1, 0);
        for (var count = 1; count <= Math.Min(most, _blocks.Count); count++)
        {
            var column = ColumnWidth(width, count);
            if (!Fits(count, column, MinSize, height)) continue;
            double lo = MinSize, hi = MaxSize;
            while (hi - lo > .5)
            {
                var size = (lo + hi) / 2;
                if (Fits(count, column, size, height)) lo = size; else hi = size;
            }
            // More columns only when they buy clearly larger text.
            if (lo > best.Size * 1.05) best = (count, lo);
        }
        // Content too long for any layout falls back to one scrolling column.
        var capacity = best.Size > 0 ? height : double.PositiveInfinity;
        if (best.Size == 0) best = (1, MinSize);
        Arrange(best.Columns, ColumnWidth(width, best.Columns), best.Size, capacity);
    }

    private static double ColumnWidth(double width, int count) => (width - ColumnGap * (count - 1)) / count;

    private bool Fits(int count, double column, double size, double height)
    {
        var heights = Measure(size, column);
        return heights.All(h => h <= height) && Fill(heights, size, height).Max() < count;
    }

    private double[] Measure(double size, double column)
    {
        foreach (var (block, scale) in _texts) { block.FontSize = size * scale; block.LineHeight = block.FontSize * 1.4; }
        foreach (var number in _numbers) number.Width = size * 1.45; // room for "12." so the text column lines up
        return _blocks.Select(b =>
        {
            b.Panel.Spacing = size * .45; b.Panel.Margin = default;
            // Measure caches per control, so the nested rows must be invalidated or they report the previous size.
            foreach (var control in b.Panel.GetSelfAndVisualDescendants().OfType<Layoutable>()) control.InvalidateMeasure();
            b.Panel.Measure(new Size(column, double.PositiveInfinity));
            return b.Panel.DesiredSize.Height;
        }).ToArray();
    }

    private double Gap(int block, double size) => _blocks[block].Starts ? size * 1.5 : size * .45;

    // Column index of each block when columns are filled in order up to the given height.
    private int[] Fill(double[] heights, double size, double capacity)
    {
        var columns = new int[heights.Length];
        double used = 0; var current = 0;
        for (var i = 0; i < heights.Length; i++)
        {
            var gap = used > 0 ? Gap(i, size) : 0;
            if (used > 0 && used + gap + heights[i] > capacity) { current++; used = 0; gap = 0; }
            used += gap + heights[i]; columns[i] = current;
        }
        return columns;
    }

    private void Arrange(int count, double column, double size, double capacity)
    {
        var heights = Measure(size, column);
        // Shortest column height that still fits, so the columns come out balanced instead of one full and one sparse.
        if (count > 1)
        {
            double lo = heights.Max(), hi = capacity;
            while (hi - lo > 1)
            {
                var mid = (lo + hi) / 2;
                if (Fill(heights, size, mid).Max() < count) hi = mid; else lo = mid;
            }
            capacity = hi;
        }
        var placement = Fill(heights, size, capacity);
        foreach (var panel in _columns.Children.OfType<StackPanel>()) panel.Children.Clear();
        _columns.Children.Clear(); _columns.ColumnDefinitions.Clear();
        for (var c = 0; c < count; c++)
        {
            if (c > 0) _columns.ColumnDefinitions.Add(new ColumnDefinition(ColumnGap, GridUnitType.Pixel));
            _columns.ColumnDefinitions.Add(new ColumnDefinition(1, GridUnitType.Star));
            var panel = new StackPanel(); Grid.SetColumn(panel, c * 2); _columns.Children.Add(panel);
        }
        var columns = _columns.Children.OfType<StackPanel>().ToArray();
        for (var i = 0; i < _blocks.Count; i++)
        {
            var target = columns[placement[i]];
            _blocks[i].Panel.Margin = new Thickness(0, target.Children.Count == 0 ? 0 : Gap(i, size), 0, 0);
            target.Children.Add(_blocks[i].Panel);
        }
        Columns = count; BaseSize = size;
    }
}

// Lays children top to bottom and starts a new column to the left when the next one would pass the height limit.
internal sealed class ColumnFlow : Panel
{
    public double Gap { get; init; } = 12;
    private Rect[] _places = [];
    private double _width;

    protected override Size MeasureOverride(Size available)
    {
        _places = new Rect[Children.Count];
        double x = 0, y = 0, width = 0, right = 0, bottom = 0;
        for (var i = 0; i < Children.Count; i++)
        {
            Children[i].Measure(Size.Infinity);
            var size = Children[i].DesiredSize;
            if (y > 0 && y + size.Height > available.Height) { x += width + Gap; y = 0; width = 0; }
            _places[i] = new Rect(new Point(x, y), size);
            right = Math.Max(right, x + size.Width); bottom = Math.Max(bottom, y + size.Height);
            y += size.Height + Gap; width = Math.Max(width, size.Width);
        }
        _width = right;
        return new Size(right, bottom);
    }

    protected override Size ArrangeOverride(Size final)
    {
        for (var i = 0; i < _places.Length; i++) Children[i].Arrange(_places[i].WithX(_width - _places[i].Right));
        return final;
    }
}

// Notes stack down the column beside the timetable, in an ordinary desktop window that other windows can cover.
internal sealed class NotesWindow : StateWindow
{
    public const double ColumnWidth = 270, Gap = 12;
    private static readonly Dictionary<string, string> Colors = new()
    { ["yellow"] = "#FFF1A8", ["blue"] = "#D3E5FF", ["green"] = "#D2F0DC", ["pink"] = "#FFD9E6" };
    private readonly ColumnFlow _cards = new() { Gap = Gap };
    internal ColumnFlow Cards => _cards;

    public NotesWindow()
    {
        Chromeless(topmost: false);
        Content = _cards;
    }

    // Extra columns grow leftwards, so the window's width is measured to keep its right edge put.
    protected override void Relayout()
    {
        _cards.MaxHeight = ScreenHeight - Top;
        PlaceRight(ContentSize().Width);
    }

    // Oldest first, so a new note joins the end instead of pushing the others around.
    public void Present(IReadOnlyList<DisplayItem> notes)
    {
        _cards.Children.Clear();
        foreach (var note in notes)
        {
            var author = Text("— " + note.TeacherName, 14, "#4B5563");
            author.HorizontalAlignment = HorizontalAlignment.Right; author.Margin = new Thickness(0, 4, 0, 0);
            _cards.Children.Add(new Border
            {
                Width = ColumnWidth, Padding = new Thickness(14, 10), CornerRadius = new CornerRadius(12),
                Background = new SolidColorBrush(Color.Parse(Colors.GetValueOrDefault(note.Content.Color ?? "", Colors["yellow"]))),
                BorderBrush = new SolidColorBrush(Color.Parse("#1A000000")), BorderThickness = new Thickness(1),
                Child = new StackPanel { Children = { Text(note.Content.Text ?? "", 20, "#1F2937", FontWeight.Medium), author } },
            });
        }
        Relayout();
    }
}

// Long-term day counts stack at the top right, soonest first, above the timetable; like it, other windows can cover them.
internal sealed class DayCountWindow : StateWindow
{
    private readonly ServerClock _clock;
    private readonly DispatcherTimer _timer;
    private readonly StackPanel _cards = new();
    private readonly List<(TextBlock Digits, DateOnly Date)> _days = [];
    internal StackPanel Cards => _cards;

    public DayCountWindow(ServerClock clock)
    {
        _clock = clock;
        Chromeless(topmost: false);
        Content = new Border { Background = Night, CornerRadius = new CornerRadius(16), ClipToBounds = true, Child = _cards };
        _timer = new DispatcherTimer(TimeSpan.FromSeconds(1), DispatcherPriority.Normal, (_, _) => Tick());
        Closed += (_, _) => _timer.Stop();
    }

    protected override void Relayout() => PlaceRight(ScheduleWindow.ColumnWidth);

    public void Present(IReadOnlyList<DisplayItem> days)
    {
        _cards.Children.Clear(); _days.Clear();
        foreach (var day in days)
        {
            var name = Centered(Text(day.Content.Label ?? "", 20, "#D6DEE9", FontWeight.SemiBold));
            name.IsVisible = name.Text!.Length > 0;
            var digits = Centered(Text("", 46, "#FFFFFF", FontWeight.Bold));
            _cards.Children.Add(new Border
            {
                Width = ScheduleWindow.ColumnWidth, Padding = new Thickness(16, 10),
                BorderBrush = new SolidColorBrush(Color.Parse("#374151")), BorderThickness = new Thickness(0, _cards.Children.Count == 0 ? 0 : 1, 0, 0),
                Child = new StackPanel { Children = { name, digits } },
            });
            _days.Add((digits, DateOnly.Parse(day.Content.Date!)));
        }
        Tick(); _timer.Start();
    }

    internal void Tick()
    {
        foreach (var (digits, date) in _days) ShowDays(digits, Days(date, _clock.Now));
    }

    // Number and unit share one font, so they sit on one baseline; the unit is smaller so the number leads.
    private static void ShowDays(TextBlock block, string text)
    {
        if (block.Tag as string == text) return;
        block.Tag = text; block.Inlines!.Clear();
        if (text.EndsWith(" 天")) { block.Inlines.Add(new Run(text[..^2])); block.Inlines.Add(new Run(" 天") { FontSize = block.FontSize * .5 }); }
        else block.Inlines.Add(new Run(text));
    }

    // Calendar days on the PC's local date, so it flips at midnight rather than 24 hours after the last change.
    public static string Days(DateOnly target, DateTimeOffset now) =>
        target.DayNumber - DateOnly.FromDateTime(now.LocalDateTime).DayNumber is var days and > 0 ? $"{days} 天" : "今天";
}

// Today's timetable down the right edge, an ordinary desktop window like the notes.
internal sealed class ScheduleWindow : StateWindow
{
    public const double ColumnWidth = 224, MaxRow = 96;
    private static readonly IBrush Ink = new SolidColorBrush(Color.Parse("#1F2937")).ToImmutable();
    private static readonly IBrush Lunch = new SolidColorBrush(Color.Parse("#FDEBC0")).ToImmutable();
    private static readonly Dictionary<string, string> Names = new()
    {
        ["english"] = "英语 English", ["chinese"] = "语文 Chinese", ["math"] = "数学 Math", ["physics"] = "物理 Physics",
        ["biology"] = "生物 Biology", ["chemistry"] = "化学 Chemistry", ["history"] = "历史 History", ["pe"] = "体育 PE",
        ["morality"] = "道德与法治", ["art"] = "艺术 Art/Music", ["it"] = "信息科技 IT", ["elective"] = "选修 Optional", ["club"] = "社团 Club",
        ["lunch"] = "午餐 Lunch",
    };
    private readonly StackPanel _rows = new();
    private DaySchedule? _today;
    internal StackPanel Rows => _rows;
    internal double RowHeight { get; private set; }

    public ScheduleWindow()
    {
        Chromeless(topmost: false);
        Content = new Border
        {
            Width = ColumnWidth, Background = new SolidColorBrush(Color.Parse("#F8FAFC")), BorderBrush = Ink, BorderThickness = new Thickness(3),
            CornerRadius = new CornerRadius(14), ClipToBounds = true, Child = _rows,
        };
    }

    public void Present(DaySchedule today) { _today = today; Relayout(); }

    // Rows share the height left below the day counts, up to a comfortable maximum; text shrinks only when a name is too wide.
    protected override void Relayout()
    {
        PlaceRight(ColumnWidth);
        if (_today is not { } today) return;
        _rows.Children.Clear();
        RowHeight = Math.Floor(Math.Clamp((ScreenHeight - Top - 6) / (today.Periods.Length + 1), 18, MaxRow));
        var size = Math.Clamp(RowHeight * .36, 15, 30);
        Add($"{today.Date.Month}/{today.Date.Day} {today.Date.DayOfWeek}", size * 1.2, FontWeight.Bold, null);
        foreach (var id in today.Periods) Add(Names.GetValueOrDefault(id, id), size, FontWeight.SemiBold, id == "lunch" ? Lunch : null);

        void Add(string text, double fontSize, FontWeight weight, IBrush? fill)
        {
            var label = Text(text, fontSize, "#1F2937", weight);
            label.TextWrapping = TextWrapping.NoWrap;
            _rows.Children.Add(new Border
            {
                Height = RowHeight, Padding = new Thickness(14, 0), Background = fill,
                // A heavier line under the date header.
                BorderBrush = Ink, BorderThickness = new Thickness(0, _rows.Children.Count switch { 0 => 0, 1 => 3, _ => 1.5 }, 0, 0),
                Child = new Viewbox { StretchDirection = StretchDirection.DownOnly, Child = label,
                    HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center },
            });
        }
    }
}

// The corner timer, or a fullscreen one the class can shrink back to the corner.
internal sealed class CountdownWindow : StateWindow
{
    private static readonly IBrush Running = Brushes.White;
    private static readonly IBrush Done = new SolidColorBrush(Color.Parse("#F87171"));
    private readonly ServerClock _clock;
    private readonly DispatcherTimer _timer;
    private DateTimeOffset _end;
    internal TextBlock Label { get; } = Centered(Text("", 20, "#D6DEE9", FontWeight.SemiBold));
    internal TextBlock Digits { get; } = DigitText(64);
    internal Button? ShrinkButton { get; }
    public bool IsFullscreen => ShrinkButton is not null;

    public CountdownWindow(ServerClock clock, Action? shrink = null)
    {
        _clock = clock;
        _timer = new DispatcherTimer(TimeSpan.FromMilliseconds(250), DispatcherPriority.Normal, (_, _) => Tick());
        Closed += (_, _) => _timer.Stop();
        if (shrink is null)
        {
            Chromeless(topmost: true);
            // The outline tells the timer apart from the day counts.
            Content = new Border
            {
                Width = NotesWindow.ColumnWidth, Padding = new Thickness(28, 14, 28, 10), Background = Night, CornerRadius = new CornerRadius(18),
                BorderBrush = new SolidColorBrush(Color.Parse("#38BDF8")), BorderThickness = new Thickness(3),
                // Hours make the digits wider than the column, so they shrink to fit instead of being cut off.
                Child = new StackPanel { Children = { Label, new Viewbox { StretchDirection = StretchDirection.DownOnly, Child = Digits } } },
            };
            return;
        }
        SystemDecorations = SystemDecorations.None; ShowInTaskbar = false; Topmost = true; CanResize = false;
        WindowState = WindowState.FullScreen; Background = Night; RequestedThemeVariant = ThemeVariant.Dark;
        Label.FontSize = 44;
        // The digits scale to whatever room the screen leaves, however many places they need.
        var digits = new Viewbox { Child = Digits, Margin = new Thickness(0, 24, 0, 0) };
        Grid.SetRow(digits, 1);
        ShrinkButton = new Button
        {
            Content = "缩小", FontFamily = Font, FontSize = 20, Padding = new Thickness(24, 10), CornerRadius = new CornerRadius(10),
            HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 24, 24, 0),
            Cursor = new Cursor(StandardCursorType.Hand),
        };
        ShrinkButton.Click += (_, _) => shrink();
        var layout = new Grid { RowDefinitions = new RowDefinitions("Auto,*"), Children = { Label, digits } };
        Content = new Grid { Children = { new Border { Padding = new Thickness(64, 48), Child = layout }, ShrinkButton } };
    }

    protected override void Relayout() { if (!IsFullscreen) PlaceRight(NotesWindow.ColumnWidth); }

    public void Present(DisplayItem countdown)
    {
        _end = countdown.EndsAt;
        Label.Text = countdown.Content.Label ?? ""; Label.IsVisible = Label.Text.Length > 0;
        Tick(); _timer.Start();
    }

    internal void Tick()
    {
        var left = _end - _clock.Now;
        Digits.Text = Format(left); Digits.Foreground = left > TimeSpan.Zero ? Running : Done;
    }

    public static string Format(TimeSpan left)
    {
        var total = (long)Math.Max(0, Math.Ceiling(left.TotalSeconds));
        return total >= 3600 ? $"{total / 3600}:{total % 3600 / 60:00}:{total % 60:00}" : $"{total / 60:00}:{total % 60:00}";
    }
}

// Two columns at the right: the day counts over the timetable at the edge, and the timer over the notes beside them.
internal sealed class StateDisplay(ServerClock clock, BroadcastDisplay alerts) : IStateDisplay
{
    public const double Gap = 12;
    private BoardWindow? _board;
    private NotesWindow? _notes;
    private DayCountWindow? _days;
    private ScheduleWindow? _schedule;
    private CountdownWindow? _countdown;
    private DisplayItem? _timer;
    private Guid _shrunk;
    internal IEnumerable<Window> Open => new Window?[] { _board, _notes, _schedule, _days, _countdown }.OfType<Window>();

    // Topmost windows go first, so each column below can be placed under them before it shows.
    public async Task ApplyAsync(IReadOnlyList<DisplayItem> visible, DaySchedule? today) => await Dispatcher.UIThread.InvokeAsync(() =>
    {
        var boards = visible.Where(i => i.Kind == "board").OrderByDescending(i => i.StartsAt).ToArray();
        var notes = visible.Where(i => i.Kind == "note").OrderBy(i => i.StartsAt).ToArray();
        var countdowns = visible.Where(i => i.Kind == "countdown").ToArray();
        var days = countdowns.Where(i => i.Content.Date is not null).OrderBy(i => i.EndsAt).ToArray();
        _timer = countdowns.Where(i => i.Content.Date is null).MaxBy(i => i.StartsAt);
        Sync(ref _board, boards.Length > 0, NewBoard, w => w.Present(boards), WindowLayer.ShowBehindLesson);
        Sync(ref _days, days.Length > 0, () => new DayCountWindow(clock), w => w.Present(days), WindowLayer.ShowBehindLesson);
        Sync(ref _schedule, today is not null, () => new ScheduleWindow(), w => w.Present(today!), WindowLayer.ShowBehindLesson);
        ShowCountdown();
        Sync(ref _notes, notes.Length > 0, () => new NotesWindow(), w => w.Present(notes), WindowLayer.ShowBehindLesson);
        Stack();
    });

    // A shrunk countdown stays in the corner until a new timed one replaces it.
    private void ShowCountdown()
    {
        var fullscreen = _timer is { Content.Fullscreen: true } && _timer.Id != _shrunk;
        if (_countdown is not null && _countdown.IsFullscreen != fullscreen) { _countdown.Dismiss(); _countdown = null; }
        Sync(ref _countdown, _timer is not null, () => new CountdownWindow(clock, fullscreen ? Shrink : null), w => w.Present(_timer!), ShowTimer);
    }

    private void Shrink() { _shrunk = _timer!.Id; ShowCountdown(); Stack(); }

    // A fullscreen broadcast already on screen stays above the timer.
    private void ShowTimer(Window window)
    {
        WindowLayer.ShowPassive(window);
        if (alerts.Current is { } alert) WindowLayer.PlaceBelow(window, alert);
    }

    // The column beside the edge moves up to the edge when the edge column is empty.
    private void Stack()
    {
        var inner = _days is not null || _schedule is not null ? ScheduleWindow.ColumnWidth + Gap : 0;
        var corner = _countdown is { IsFullscreen: false } ? _countdown : null;
        _days?.Place();
        _schedule?.Place(top: _days is null ? 0 : _days.ContentSize().Height + Gap);
        corner?.Place(inner: inner);
        _notes?.Place(top: corner is null ? 0 : corner.ContentSize().Height + Gap, inner);
    }

    private static BoardWindow NewBoard()
    {
        var window = new BoardWindow { WindowStartupLocation = WindowStartupLocation.CenterScreen };
        if (window.Screens.Primary is { } screen)
        {
            window.Width = screen.WorkingArea.Width * .8 / screen.Scaling;
            window.Height = screen.WorkingArea.Height * .8 / screen.Scaling;
        }
        return window;
    }

    // Content changes update the open window in place, so it never jumps above the lesson again.
    // A new window is placed before it first shows instead of jumping there afterwards; the callers restack the rest.
    private void Sync<T>(ref T? window, bool wanted, Func<T> create, Action<T> present, Action<Window> show) where T : StateWindow
    {
        if (!wanted) { window?.Dismiss(); window = null; return; }
        if (window is not null) { present(window); return; }
        window = create(); present(window); Stack(); show(window);
    }
}

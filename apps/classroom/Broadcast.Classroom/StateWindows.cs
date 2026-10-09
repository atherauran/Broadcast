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

// Display items close only when the server state says so; classroom users cannot close them.
internal abstract class StateWindow : Window
{
    private bool _closing;
    protected static readonly FontFamily Font = new("Microsoft YaHei, Segoe UI");
    protected StateWindow() { Closing += (_, e) => WindowLayer.KeepOpen(e, _closing); }
    public void Dismiss() { _closing = true; Close(); }

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
    protected void PlaceInCorner(bool top)
    {
        if (Screens.Primary is not { } screen) return;
        var area = screen.WorkingArea; var margin = (int)(24 * screen.Scaling);
        var size = PixelSize.FromSize(Bounds.Size, screen.Scaling);
        Position = new PixelPoint(area.Right - size.Width - margin, top ? area.Y + margin : area.Bottom - size.Height - margin);
    }
}

// Boards flow top to bottom, then into the next column, in whichever column count gives the largest text.
internal sealed class BoardWindow : StateWindow
{
    private const double ColumnGap = 56, MinColumn = 320, MinSize = 14, MaxSize = 40;
    private readonly Grid _columns = new();
    // A block is one entry; the board's title rides on its first entry and the footer on its last, so neither is orphaned.
    private readonly List<(StackPanel Panel, bool Starts)> _blocks = [];
    private readonly List<(TextBlock Block, double Scale)> _texts = [];
    private readonly List<TextBlock> _numbers = [];
    internal Grid Boards => _columns;
    internal int Columns { get; private set; }
    internal double BaseSize { get; private set; }

    public BoardWindow()
    {
        Title = "公告"; ShowInTaskbar = true; Topmost = false;
        Background = Brushes.White; FontFamily = Font;
        Content = new ScrollViewer
        {
            HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled,
            Content = new Border { Padding = new Thickness(56, 40), Child = _columns },
        };
        SizeChanged += (_, _) => Fit();
    }

    public void Present(IReadOnlyList<DisplayItem> boards)
    {
        _blocks.Clear(); _texts.Clear(); _numbers.Clear();
        foreach (var board in boards)
        {
            var entries = board.Content.Entries ?? [];
            for (var i = 0; i < Math.Max(1, entries.Length); i++)
            {
                var block = new StackPanel();
                if (i == 0) Add(block, Text(board.Content.Title ?? "公告", 22, "#1D4ED8", FontWeight.Bold), 1.3);
                if (i < entries.Length)
                {
                    var row = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*") };
                    var number = Text($"{i + 1}.", 22, "#5F6C80", FontWeight.SemiBold); _numbers.Add(number);
                    var body = Text(entries[i], 22, "#182236", FontWeight.Medium);
                    Grid.SetColumn(body, 1); row.Children.Add(number); row.Children.Add(body);
                    _texts.Add((number, 1)); _texts.Add((body, 1)); block.Children.Add(row);
                }
                if (i >= entries.Length - 1) Add(block, Text($"{board.TeacherName} · {Until(board.EndsAt)}", 22, "#5F6C80"), .7);
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

internal sealed class NotesWindow : StateWindow
{
    public const double CardWidth = 300;
    private static readonly Dictionary<string, string> Colors = new()
    { ["yellow"] = "#FFF1A8", ["blue"] = "#D3E5FF", ["green"] = "#D2F0DC", ["pink"] = "#FFD9E6" };
    private readonly StackPanel _cards = new() { Spacing = 12 };
    internal StackPanel Cards => _cards;

    public NotesWindow()
    {
        SystemDecorations = SystemDecorations.None; ShowInTaskbar = false; Topmost = false; CanResize = false;
        TransparencyLevelHint = [WindowTransparencyLevel.Transparent]; Background = Brushes.Transparent;
        SizeToContent = SizeToContent.WidthAndHeight;
        Content = _cards;
        SizeChanged += (_, _) => PlaceInCorner(top: false);
    }

    // Newest note sits closest to the corner.
    public void Present(IReadOnlyList<DisplayItem> notes)
    {
        _cards.Children.Clear();
        foreach (var note in notes)
        {
            var author = Text("— " + note.TeacherName, 14, "#4B5563"); author.HorizontalAlignment = HorizontalAlignment.Right; author.Margin = new Thickness(0, 6, 0, 0);
            var content = new StackPanel(); content.Children.Add(Text(note.Content.Text ?? "", 20, "#1F2937", FontWeight.Medium)); content.Children.Add(author);
            _cards.Children.Add(new Border
            {
                Width = CardWidth, Padding = new Thickness(18, 14), CornerRadius = new CornerRadius(12), Child = content,
                Background = new SolidColorBrush(Color.Parse(Colors.GetValueOrDefault(note.Content.Color ?? "", Colors["yellow"]))),
                BorderBrush = new SolidColorBrush(Color.Parse("#1A000000")), BorderThickness = new Thickness(1),
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
    internal TextBlock Label { get; }
    internal TextBlock Digits { get; }
    internal Button? ShrinkButton { get; }
    public bool IsFullscreen => ShrinkButton is not null;

    public CountdownWindow(ServerClock clock, Action? shrink = null)
    {
        _clock = clock;
        SystemDecorations = SystemDecorations.None; ShowInTaskbar = false; Topmost = true; CanResize = false;
        Label = Text("", 20, "#D6DEE9", FontWeight.SemiBold); Label.HorizontalAlignment = HorizontalAlignment.Center;
        Digits = new TextBlock { FontFamily = new FontFamily("Consolas, Cascadia Mono, Microsoft YaHei"), FontSize = 64, FontWeight = FontWeight.Bold,
            HorizontalAlignment = HorizontalAlignment.Center };
        _timer = new DispatcherTimer(TimeSpan.FromMilliseconds(250), DispatcherPriority.Normal, (_, _) => Tick());
        Closed += (_, _) => _timer.Stop();
        if (shrink is null)
        {
            TransparencyLevelHint = [WindowTransparencyLevel.Transparent]; Background = Brushes.Transparent;
            SizeToContent = SizeToContent.WidthAndHeight;
            var stack = new StackPanel(); stack.Children.Add(Label); stack.Children.Add(Digits);
            Content = new Border { Background = new SolidColorBrush(Color.Parse("#EB111827")), CornerRadius = new CornerRadius(18),
                Padding = new Thickness(28, 14, 28, 10), MinWidth = 240, Child = stack };
            SizeChanged += (_, _) => PlaceInCorner(top: true);
            return;
        }
        WindowState = WindowState.FullScreen; RequestedThemeVariant = ThemeVariant.Dark;
        Background = new SolidColorBrush(Color.Parse("#111827"));
        Label.FontSize = 44;
        // The digits scale to whatever room the screen leaves, however many places they need.
        var digits = new Viewbox { Child = Digits, Margin = new Thickness(0, 24, 0, 0) };
        var layout = new Grid { RowDefinitions = new RowDefinitions("Auto,*") };
        Grid.SetRow(digits, 1); layout.Children.Add(Label); layout.Children.Add(digits);
        ShrinkButton = new Button
        {
            Content = "缩小", FontFamily = Font, FontSize = 20, Padding = new Thickness(24, 10), CornerRadius = new CornerRadius(10),
            HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 24, 24, 0),
            Cursor = new Cursor(StandardCursorType.Hand),
        };
        ShrinkButton.Click += (_, _) => shrink();
        Content = new Grid { Children = { new Border { Padding = new Thickness(64, 48), Child = layout }, ShrinkButton } };
    }

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

// Long-term day counts live on the desktop like notes: an ordinary window that other windows can cover.
internal sealed class DayCountdownWindow : StateWindow
{
    private readonly ServerClock _clock;
    private readonly DispatcherTimer _timer;
    private readonly StackPanel _rows = new() { Spacing = 14 };
    private readonly List<(TextBlock Digits, DateOnly Date)> _days = [];
    internal StackPanel Rows => _rows;

    public DayCountdownWindow(ServerClock clock)
    {
        _clock = clock;
        SystemDecorations = SystemDecorations.None; ShowInTaskbar = false; Topmost = false; CanResize = false;
        TransparencyLevelHint = [WindowTransparencyLevel.Transparent]; Background = Brushes.Transparent;
        SizeToContent = SizeToContent.WidthAndHeight;
        Content = new Border { Background = new SolidColorBrush(Color.Parse("#EB111827")), CornerRadius = new CornerRadius(18),
            Padding = new Thickness(28, 14), MinWidth = 240, Child = _rows };
        SizeChanged += (_, _) => PlaceInCorner(top: true);
        _timer = new DispatcherTimer(TimeSpan.FromSeconds(1), DispatcherPriority.Normal, (_, _) => Tick());
        Closed += (_, _) => _timer.Stop();
    }

    public void Present(IReadOnlyList<DisplayItem> days)
    {
        _rows.Children.Clear(); _days.Clear();
        foreach (var day in days)
        {
            if (!DateOnly.TryParse(day.Content.Date, out var date)) continue;
            var name = Text(day.Content.Label ?? "", 20, "#D6DEE9", FontWeight.SemiBold); name.HorizontalAlignment = HorizontalAlignment.Center;
            name.IsVisible = !string.IsNullOrEmpty(name.Text);
            var digits = new TextBlock { FontFamily = new FontFamily("Consolas, Cascadia Mono, Microsoft YaHei"), FontSize = days.Count > 1 ? 48 : 64,
                FontWeight = FontWeight.Bold, Foreground = Brushes.White, HorizontalAlignment = HorizontalAlignment.Center };
            var row = new StackPanel(); row.Children.Add(name); row.Children.Add(digits);
            _rows.Children.Add(row); _days.Add((digits, date));
        }
        Tick(); _timer.Start();
    }

    internal void Tick()
    {
        foreach (var (digits, date) in _days) ShowDays(digits, Days(date, _clock.Now));
    }

    // The unit is set smaller than the number: its CJK fallback font would otherwise dwarf the digits.
    private static void ShowDays(TextBlock block, string text)
    {
        if (block.Tag as string == text) return;
        block.Tag = text; block.Inlines!.Clear();
        if (text.EndsWith(" 天")) { block.Inlines.Add(new Run(text[..^2])); block.Inlines.Add(new Run(" 天") { FontSize = block.FontSize * .7 }); }
        else block.Inlines.Add(new Run(text));
    }

    // Calendar days on the PC's local date, so it flips at midnight rather than 24 hours after the last change.
    public static string Days(DateOnly target, DateTimeOffset now) =>
        target.DayNumber - DateOnly.FromDateTime(now.LocalDateTime).DayNumber is var days and > 0 ? $"{days} 天" : "今天";
}

internal sealed class StateDisplay(ServerClock clock, BroadcastDisplay alerts) : IStateDisplay
{
    private BoardWindow? _board;
    private NotesWindow? _notes;
    private CountdownWindow? _countdown;
    private DayCountdownWindow? _dayCounts;
    private DisplayItem? _timer;
    private Guid _shrunk;

    public async Task ApplyAsync(IReadOnlyList<DisplayItem> visible) => await Dispatcher.UIThread.InvokeAsync(() =>
    {
        var boards = visible.Where(i => i.Kind == "board").OrderByDescending(i => i.StartsAt).ToArray();
        var notes = visible.Where(i => i.Kind == "note").OrderBy(i => i.StartsAt).ToArray();
        var countdowns = visible.Where(i => i.Kind == "countdown").ToArray();
        var timed = countdowns.Where(i => i.Content.Date is null).MaxBy(i => i.StartsAt);
        var days = countdowns.Where(i => i.Content.Date is not null).OrderBy(i => i.EndsAt).ToArray();
        Sync(ref _board, boards.Length > 0, NewBoard, w => w.Present(boards), WindowLayer.ShowBehindLesson);
        Sync(ref _notes, notes.Length > 0, () => new NotesWindow(), w => w.Present(notes), WindowLayer.ShowBehindLesson);
        Sync(ref _dayCounts, days.Length > 0, () => new DayCountdownWindow(clock), w => w.Present(days), WindowLayer.ShowBehindLesson);
        _timer = timed; ShowCountdown();
    });

    // A shrunk countdown stays in the corner until a new timed one replaces it.
    private void ShowCountdown()
    {
        var fullscreen = _timer is { Content.Fullscreen: true } && _timer.Id != _shrunk;
        if (_countdown is not null && _countdown.IsFullscreen != fullscreen) { _countdown.Dismiss(); _countdown = null; }
        Sync(ref _countdown, _timer is not null, () => new CountdownWindow(clock, fullscreen ? Shrink : null), w => w.Present(_timer!), w =>
        {
            WindowLayer.ShowPassive(w);
            // A fullscreen broadcast already on screen stays above the timer.
            if (alerts.Current is { } alert) WindowLayer.PlaceBelow(w, alert);
        });
    }

    private void Shrink() { _shrunk = _timer!.Id; ShowCountdown(); }

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
    private static void Sync<T>(ref T? window, bool wanted, Func<T> create, Action<T> present, Action<Window> show) where T : StateWindow
    {
        if (!wanted) { window?.Dismiss(); window = null; return; }
        if (window is not null) { present(window); return; }
        window = create(); present(window); show(window);
    }
}

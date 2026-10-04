using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Broadcast.Core;

namespace Broadcast.Classroom;

// Display items close only when the server state says so; classroom users cannot close them.
internal abstract class StateWindow : Window
{
    private bool _closing;
    protected static readonly FontFamily Font = new("Microsoft YaHei, Segoe UI");
    protected StateWindow() { Closing += (_, e) => { if (!_closing) e.Cancel = true; }; }
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
    private const double ColumnGap = 56, MinColumn = 320, MinSize = 14, MaxSize = 64;
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

internal sealed class CountdownWindow : StateWindow
{
    private static readonly IBrush Running = Brushes.White;
    private static readonly IBrush Done = new SolidColorBrush(Color.Parse("#F87171"));
    private readonly ServerClock _clock;
    private readonly DispatcherTimer _timer;
    private DateTimeOffset _end;
    internal TextBlock Label { get; }
    internal TextBlock Digits { get; }

    public CountdownWindow(ServerClock clock)
    {
        _clock = clock;
        SystemDecorations = SystemDecorations.None; ShowInTaskbar = false; Topmost = true; CanResize = false;
        TransparencyLevelHint = [WindowTransparencyLevel.Transparent]; Background = Brushes.Transparent;
        SizeToContent = SizeToContent.WidthAndHeight;
        Label = Text("", 20, "#D6DEE9", FontWeight.SemiBold); Label.HorizontalAlignment = HorizontalAlignment.Center;
        Digits = new TextBlock { FontFamily = new FontFamily("Consolas, Cascadia Mono, Microsoft YaHei"), FontSize = 64, FontWeight = FontWeight.Bold,
            HorizontalAlignment = HorizontalAlignment.Center };
        var stack = new StackPanel(); stack.Children.Add(Label); stack.Children.Add(Digits);
        Content = new Border { Background = new SolidColorBrush(Color.Parse("#EB111827")), CornerRadius = new CornerRadius(18),
            Padding = new Thickness(28, 14, 28, 10), MinWidth = 240, Child = stack };
        _timer = new DispatcherTimer(TimeSpan.FromMilliseconds(250), DispatcherPriority.Normal, (_, _) => Tick());
        SizeChanged += (_, _) => PlaceInCorner(top: true);
        Closed += (_, _) => _timer.Stop();
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

internal sealed class StateDisplay(ServerClock clock) : IStateDisplay
{
    private BoardWindow? _board;
    private NotesWindow? _notes;
    private CountdownWindow? _countdown;

    public async Task ApplyAsync(IReadOnlyList<DisplayItem> visible) => await Dispatcher.UIThread.InvokeAsync(() =>
    {
        var boards = visible.Where(i => i.Kind == "board").OrderByDescending(i => i.StartsAt).ToArray();
        var notes = visible.Where(i => i.Kind == "note").OrderBy(i => i.StartsAt).ToArray();
        var countdown = visible.Where(i => i.Kind == "countdown").MaxBy(i => i.StartsAt);
        Sync(ref _board, boards.Length > 0, NewBoard, w => w.Present(boards), WindowLayer.ShowBehindLesson);
        Sync(ref _notes, notes.Length > 0, () => new NotesWindow(), w => w.Present(notes), WindowLayer.ShowBehindLesson);
        Sync(ref _countdown, countdown is not null, () => new CountdownWindow(clock), w => w.Present(countdown!), WindowLayer.ShowPassive);
    });

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

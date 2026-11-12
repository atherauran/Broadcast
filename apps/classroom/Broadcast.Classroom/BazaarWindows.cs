using System.Globalization;
using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Broadcast.Core;

namespace Broadcast.Classroom;

internal sealed class BazaarDisplay(BazaarSync sync, CancellationToken ct) : IDisposable
{
    private BazaarBatch? _state;
    private BazaarWindow? _window;
    private BazaarInputWindow? _input;
    private bool _disposed;
    private string _status = "正在连接";
    private bool _syncFailed;

    public void Apply(BazaarBatch? state)
    {
        if (_disposed) return;
        var wasEnabled = _state?.Enabled == true;
        _state = state;
        _syncFailed = false;
        if (state?.Enabled != true) { CloseWindows(); return; }
        if (!wasEnabled) Show();
        _window?.Present(state);
        _input?.Present(state);
        SetStatus(_status);
    }

    public void SetStatus(string status)
    {
        _status = status.EndsWith("在线", StringComparison.Ordinal) ? "实时同步中" : status;
        var shown = _syncFailed ? "统计同步失败，正在重试" : _status;
        _window?.SetStatus(shown);
        _input?.SetStatus(shown);
    }

    public void SyncFailed() { _syncFailed = true; SetStatus(_status); }

    public void Show()
    {
        if (_disposed || _state is not { Enabled: true } state) return;
        if (_window is not null) { _window.Activate(); return; }
        _window = new BazaarWindow(OpenInput);
        _window.Closed += (_, _) => _window = null;
        _window.Present(state); _window.SetStatus(_status);
        WindowLayer.ShowBehindLesson(_window);
    }

    private void OpenInput()
    {
        if (_input is not null) { _input.Activate(); return; }
        if (_state is null) return;
        _input = new BazaarInputWindow(sync.SaveAsync, sync.Signal, ct);
        _input.Closed += (_, _) => _input = null;
        _input.Present(_state); _input.SetStatus(_status); _input.Show();
    }

    private void CloseWindows() { _input?.Close(); _window?.Close(); }
    public void Dispose() { _disposed = true; CloseWindows(); }
}

internal static class BazaarStyle
{
    public static readonly IBrush Ink = Brush("#172B28"), Green = Brush("#087F5B"), Muted = Brush("#526861");
    public static IBrush Brush(string color) => new SolidColorBrush(Color.Parse(color));
    public static TextBlock Text(string text, double size = 16, IBrush? color = null, bool bold = false) => new()
    {
        Text = text, FontSize = size, Foreground = color ?? Ink,
        FontWeight = bold ? FontWeight.SemiBold : FontWeight.Normal, TextWrapping = TextWrapping.Wrap,
    };
    public static Button Button(string text) => new() { Content = text, Padding = new Thickness(16, 9), FontSize = 16 };
    public static void Setup(Window window, string title, int width, int height, int minWidth, int minHeight)
    {
        window.Title = title; window.Width = width; window.Height = height;
        window.MinWidth = minWidth; window.MinHeight = minHeight;
        window.FontFamily = ClassroomWindow.Font; window.Background = Brushes.White;
        window.Topmost = false; window.CanResize = true; window.ShowInTaskbar = true;
    }
}

internal sealed class BazaarWindow : Window
{
    internal TextBlock Total { get; } = BazaarStyle.Text("0", 52, BazaarStyle.Green, true);
    internal StackPanel Ranking { get; } = new() { Spacing = 12 };
    internal BazaarChart Chart { get; } = new();
    private readonly TextBlock _class = BazaarStyle.Text("义卖实时统计", 24, bold: true);
    private readonly TextBlock _status = BazaarStyle.Text("正在连接", 14, BazaarStyle.Muted);

    public BazaarWindow(Action openInput)
    {
        BazaarStyle.Setup(this, "义卖实时统计", 860, 780, 600, 600);
        var input = BazaarStyle.Button("录入筹码 / 查看记录");
        input.Click += (_, _) => openInput();
        var heading = new DockPanel { LastChildFill = true };
        DockPanel.SetDock(input, Dock.Right); heading.Children.Add(input); heading.Children.Add(_class);
        var total = new StackPanel { Spacing = 0, Children = { BazaarStyle.Text("全班累计筹码", 16, BazaarStyle.Muted), Total } };
        var ranking = new ScrollViewer { Content = Ranking, HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled };
        var curve = new Grid { RowDefinitions = new RowDefinitions("Auto,*"), Children = { BazaarStyle.Text("收入增长趋势", 18, bold: true), Chart } };
        Grid.SetRow(Chart, 1);
        var page = new Grid { Margin = new Thickness(28), RowDefinitions = new RowDefinitions("Auto,Auto,Auto,*,*,Auto"), RowSpacing = 18 };
        Control[] rows = [heading, total, BazaarStyle.Text("小组排行榜", 18, bold: true), ranking, curve, _status];
        for (var i = 0; i < rows.Length; i++) { Grid.SetRow(rows[i], i); page.Children.Add(rows[i]); }
        Content = page;
    }

    public void SetStatus(string status) => _status.Text = status;
    public void Present(BazaarBatch state)
    {
        Title = state.ClassroomId + " · 义卖实时统计";
        _class.Text = state.ClassroomId + " · 义卖";
        var summary = new BazaarSummary(state.Entries);
        Total.Text = summary.Total.ToString("N0");
        Ranking.Children.Clear();
        if (summary.Groups.Length == 0) Ranking.Children.Add(BazaarStyle.Text("还没有收入，录入第一笔筹码吧。", color: BazaarStyle.Muted));
        var rank = 0;
        foreach (var group in summary.Groups)
        {
            var row = new Grid { ColumnDefinitions = new ColumnDefinitions("40,*,Auto"), RowDefinitions = new RowDefinitions("Auto,6"), RowSpacing = 6 };
            var number = BazaarStyle.Text((++rank).ToString("00"), 19, BazaarStyle.Muted);
            var name = BazaarStyle.Text(group.Name, 20, bold: true);
            var amount = BazaarStyle.Text(group.Amount.ToString("N0") + " 筹码", 20, BazaarStyle.Green, true);
            Grid.SetColumn(name, 1); Grid.SetColumn(amount, 2);
            var bar = new ProgressBar { Minimum = 0, Maximum = Math.Max(1, summary.Groups[0].Amount), Value = group.Amount,
                Height = 6, Foreground = BazaarStyle.Green, Background = BazaarStyle.Brush("#E7F1EC") };
            Grid.SetRow(bar, 1); Grid.SetColumn(bar, 1); Grid.SetColumnSpan(bar, 2);
            row.Children.AddRange([number, name, amount, bar]); Ranking.Children.Add(row);
        }
        Chart.Points = summary.Curve; Chart.InvalidateVisual();
    }
}

internal sealed class BazaarChart : Control
{
    public BazaarPoint[] Points { get; set; } = [];
    public override void Render(DrawingContext context)
    {
        base.Render(context);
        var left = 62d; var top = 18d; var right = Math.Max(left + 1, Bounds.Width - 12); var bottom = Math.Max(top + 1, Bounds.Height - 30);
        var max = Math.Max(1, Points.LastOrDefault()?.Amount ?? 0);
        var grid = new Pen(BazaarStyle.Brush("#DBE6E1"), 1);
        for (var i = 0; i <= 2; i++)
        {
            var y = bottom - (bottom - top) * i / 2;
            context.DrawLine(grid, new Point(left, y), new Point(right, y));
            Label((max * i / 2).ToString("N0"), 0, y - 9);
        }
        if (Points.Length == 0) { Label("录入后显示累计收入", left + 12, top + 24); return; }
        var start = Points[0].At.AddMinutes(-1);
        var end = Points[^1].At > Points[0].At ? Points[^1].At : Points[0].At.AddMinutes(1);
        double X(DateTimeOffset at) => left + (at - start).TotalSeconds / (end - start).TotalSeconds * (right - left);
        double Y(long amount) => bottom - (double)amount / max * (bottom - top);
        var geometry = new StreamGeometry();
        using (var path = geometry.Open())
        {
            path.BeginFigure(new Point(left, bottom), false);
            long previous = 0;
            foreach (var point in Points)
            {
                path.LineTo(new Point(X(point.At), Y(previous)));
                path.LineTo(new Point(X(point.At), Y(point.Amount))); previous = point.Amount;
            }
            path.LineTo(new Point(right, Y(previous))); path.EndFigure(false);
        }
        context.DrawGeometry(null, new Pen(BazaarStyle.Green, 3), geometry);
        var format = start.LocalDateTime.Date == end.LocalDateTime.Date ? "HH:mm" : "M/d HH:mm";
        Label(start.ToLocalTime().ToString(format), left, bottom + 8);
        Label(end.ToLocalTime().ToString(format), right - (format == "HH:mm" ? 36 : 78), bottom + 8);

        void Label(string value, double x, double y) => context.DrawText(new FormattedText(value, CultureInfo.CurrentCulture,
            FlowDirection.LeftToRight, new Typeface(ClassroomWindow.Font), 12, BazaarStyle.Muted), new Point(x, y));
    }
}

internal sealed class BazaarInputWindow : Window
{
    internal TextBox Leader { get; } = new() { Watermark = "例如：Beaver", MaxLength = 29, FontSize = 18 };
    internal NumericUpDown Amount { get; } = new() { Minimum = 5, Maximum = 1000000, Increment = 5, FormatString = "0", Value = 5, FontSize = 18 };
    internal Button Submit { get; } = BazaarStyle.Button("添加收入");
    internal StackPanel Records { get; } = new() { Spacing = 12 };
    private readonly StackPanel _groups = new() { Orientation = Orientation.Horizontal, Spacing = 8 };
    private readonly TextBlock _mode = BazaarStyle.Text("新增筹码", 22, bold: true);
    private readonly TextBlock _message = BazaarStyle.Text("", 14, BazaarStyle.Muted);
    private readonly TextBlock _status = BazaarStyle.Text("正在连接", 14, BazaarStyle.Muted);
    private readonly Button _cancel = BazaarStyle.Button("取消纠错");
    private readonly Func<BazaarRequest, CancellationToken, Task> _save;
    private readonly Action _refresh;
    private readonly CancellationToken _ct;
    private BazaarBatch? _state;
    private Guid? _correcting;
    private BazaarRequest? _pending;
    private bool _busy;

    public BazaarInputWindow(Func<BazaarRequest, CancellationToken, Task> save, Action refresh, CancellationToken ct)
    {
        _save = save; _refresh = refresh; _ct = ct;
        BazaarStyle.Setup(this, "义卖 · 录入与记录", 620, 740, 520, 600);
        AutomationProperties.SetName(Leader, "组长姓名"); AutomationProperties.SetName(Amount, "筹码数量");
        var form = new StackPanel { Spacing = 10, Children = { _mode, BazaarStyle.Text("组长姓名"), Leader,
            new ScrollViewer { Content = _groups, HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto,
                VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled },
            BazaarStyle.Text("筹码数量（5 的整数倍）"), Amount,
            new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Children = { Submit, _cancel } }, _message } };
        var page = new Grid { Margin = new Thickness(24), RowDefinitions = new RowDefinitions("Auto,Auto,*,Auto"), RowSpacing = 14 };
        var history = new ScrollViewer { Content = Records, HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled };
        Control[] rows = [form, BazaarStyle.Text("收入记录", 20, bold: true), history, _status];
        for (var i = 0; i < rows.Length; i++) { Grid.SetRow(rows[i], i); page.Children.Add(rows[i]); }
        Content = page; _cancel.IsVisible = false;
        Submit.Click += async (_, _) => await SaveAsync();
        _cancel.Click += (_, _) => Reset();
    }

    public void SetStatus(string status) => _status.Text = status;
    public void Present(BazaarBatch state)
    {
        _state = state; Title = state.ClassroomId + " · 义卖录入与记录";
        _groups.Children.Clear(); Records.Children.Clear();
        var summary = new BazaarSummary(state.Entries);
        foreach (var group in summary.Groups)
        {
            var button = BazaarStyle.Button(group.Name);
            button.Click += (_, _) => Leader.Text = LeaderName(group.Name); _groups.Children.Add(button);
        }
        var current = summary.Current.Select(e => e.Id).ToHashSet();
        var byId = state.Entries.ToDictionary(e => e.Id);
        if (state.Entries.Length == 0) Records.Children.Add(BazaarStyle.Text("暂无收入记录", color: BazaarStyle.Muted));
        foreach (var entry in state.Entries.OrderByDescending(e => e.RecordedAt).ThenByDescending(e => e.Id))
        {
            var active = current.Contains(entry.Id);
            var row = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto"), ColumnSpacing = 12 };
            var description = new StackPanel { Spacing = 3 };
            description.Children.Add(BazaarStyle.Text($"{entry.GroupName}   {entry.Amount:N0} 筹码", 18, active ? BazaarStyle.Ink : BazaarStyle.Muted, active));
            var label = !active ? "已被纠错" : entry.Amount == 0 ? "已撤销" : entry.ReplacesId.HasValue ? "纠错后" : "新增";
            description.Children.Add(BazaarStyle.Text($"{entry.RecordedAt.ToLocalTime():M/d HH:mm:ss} · {label}", 13, BazaarStyle.Muted));
            if (entry.ReplacesId is { } previous && byId.TryGetValue(previous, out var old))
                description.Children.Add(BazaarStyle.Text($"原记录：{old.GroupName} {old.Amount:N0} 筹码", 13, BazaarStyle.Muted));
            row.Children.Add(description);
            if (active)
            {
                var edit = BazaarStyle.Button("纠错"); Grid.SetColumn(edit, 1); edit.VerticalAlignment = VerticalAlignment.Top;
                edit.Click += (_, _) => Correct(entry); row.Children.Add(edit);
            }
            Records.Children.Add(row);
        }
        LockInputs();
    }

    internal void Correct(BazaarEntry entry)
    {
        _correcting = entry.Id; Leader.Text = LeaderName(entry.GroupName); Amount.Minimum = 0; Amount.Value = entry.Amount;
        _mode.Text = "纠正这笔收入"; Submit.Content = "保存纠错"; _cancel.IsVisible = true;
        _message.Text = "填写正确的组长姓名和数量；填 0 撤销这笔收入。"; Leader.Focus();
    }

    private static string LeaderName(string groupName) => groupName.EndsWith('组') ? groupName[..^1] : groupName;

    private async Task SaveAsync()
    {
        if (_busy) return;
        if (_pending is null)
        {
            var leader = Leader.Text?.Trim() ?? "";
            if (leader.Length == 0 || Amount.Value is not { } value || value % 5 != 0 || value < (_correcting.HasValue ? 0 : 5))
            { _message.Text = "请填写组长姓名，筹码数量须为 5 的整数倍。"; return; }
            _pending = new(Guid.NewGuid(), leader + "组", (int)value, _correcting);
        }
        _busy = true; LockInputs();
        _message.Text = "正在保存…";
        try
        {
            await _save(_pending, _ct);
            Reset(); _message.Text = "已保存"; _refresh();
        }
        catch (BackendException e) when ((int)e.Status >= 400 && (int)e.Status < 500)
        {
            _pending = null; Submit.Content = _correcting.HasValue ? "保存纠错" : "添加收入";
            _message.Text = e.Message; _refresh();
        }
        catch (Exception e) when (!_ct.IsCancellationRequested)
        {
            // Keep the request ID and values after an uncertain response, so retrying cannot double count.
            Submit.Content = "重试提交"; _message.Text = "尚未确认保存，请重试：" + e.Message;
        }
        catch (OperationCanceledException) when (_ct.IsCancellationRequested) { }
        finally { _busy = false; LockInputs(); }
    }

    private void Reset()
    {
        _correcting = null; _pending = null; Amount.Minimum = 5; Amount.Value = 5;
        _mode.Text = "新增筹码"; Submit.Content = "添加收入"; _cancel.IsVisible = false; _message.Text = "";
    }

    private void LockInputs()
    {
        var editable = !_busy && _pending is null;
        Leader.IsEnabled = Amount.IsEnabled = _groups.IsEnabled = Records.IsEnabled = _cancel.IsEnabled = editable;
        Submit.IsEnabled = !_busy;
        // A competing correction may have arrived while the form was open.
        if (editable && _correcting is { } id && _state?.Entries.Any(e => e.ReplacesId == id) == true)
        { Reset(); _message.Text = "这笔记录已被纠错，请从最新记录重新选择。"; }
    }
}

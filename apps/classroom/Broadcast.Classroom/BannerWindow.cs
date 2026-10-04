using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Broadcast.Core;

namespace Broadcast.Classroom;

internal sealed class BannerWindow : Window
{
    public const double StripHeight = 100;
    private bool _closing;
    internal TextBlock Body { get; }
    internal TextBlock Emoji { get; }
    internal TextBlock Teacher { get; }

    public BannerWindow()
    {
        SystemDecorations = SystemDecorations.None;
        Topmost = true; ShowInTaskbar = false; CanResize = false;
        Height = StripHeight;
        Background = new SolidColorBrush(Color.Parse("#111827"));
        var font = new FontFamily("Microsoft YaHei, Segoe UI");
        Emoji = new TextBlock { FontSize = 38, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 16, 0) };
        Body = new TextBlock
        {
            FontFamily = font, FontWeight = FontWeight.Medium, TextWrapping = TextWrapping.Wrap, MaxLines = 2,
            TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center,
        };
        Teacher = new TextBlock
        {
            FontFamily = font, FontSize = 18, Foreground = new SolidColorBrush(Color.Parse("#D6DEE9")),
            VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(24, 0, 0, 0),
        };
        var layout = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*,Auto") };
        Grid.SetColumn(Emoji, 0); Grid.SetColumn(Body, 1); Grid.SetColumn(Teacher, 2);
        layout.Children.Add(Emoji); layout.Children.Add(Body); layout.Children.Add(Teacher);
        Content = new Border { Padding = new Thickness(36, 12), Child = layout };
        SizeChanged += (_, _) => Fit();
        Closing += (_, e) => { if (!_closing) e.Cancel = true; };
    }

    public void Present(Delivery delivery)
    {
        var (emoji, foreground) = BroadcastWindow.Style(delivery.Emotion);
        Emoji.Text = emoji; Emoji.IsVisible = emoji.Length > 0;
        Body.Text = delivery.Body; Body.Foreground = foreground;
        Teacher.Text = delivery.TeacherName;
        if (Screens.Primary is { } screen)
        {
            var area = screen.WorkingArea;
            Width = area.Width / screen.Scaling;
            var top = delivery.BannerPosition == "bottom" ? area.Bottom - (int)Math.Ceiling(StripHeight * screen.Scaling) : area.Y;
            Position = new PixelPoint(area.X, top);
        }
        Fit();
    }

    // Largest font that keeps the text within two lines of the strip.
    private void Fit()
    {
        Teacher.Measure(Size.Infinity); Emoji.Measure(Size.Infinity);
        var width = Math.Max(100, ClientSize.Width - 72 - Teacher.DesiredSize.Width - 24 - (Emoji.IsVisible ? Emoji.DesiredSize.Width + 16 : 0));
        var height = StripHeight - 24;
        double lo = 14, hi = 44;
        Body.MaxLines = 0;
        while (hi - lo > .5)
        {
            var size = (lo + hi) / 2;
            Body.FontSize = size;
            Body.Measure(new Size(width, double.PositiveInfinity));
            if (Body.DesiredSize.Height <= height) lo = size; else hi = size;
        }
        Body.FontSize = lo; Body.MaxLines = 2;
    }

    public void Dismiss() { _closing = true; Close(); }
}

internal sealed class BannerDisplay(BroadcastDisplay alerts) : IBannerDisplay
{
    private BannerWindow? _window;
    public async Task ShowAsync(Delivery delivery, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        await Dispatcher.UIThread.InvokeAsync(() =>
        {
            if (_window is null) { _window = new BannerWindow(); _window.Present(delivery); WindowLayer.ShowPassive(_window); }
            else _window.Present(delivery);
            // A fullscreen broadcast already on screen stays above the strip.
            if (alerts.Current is { } alert) WindowLayer.PlaceBelow(_window, alert);
        });
    }
    public async Task HideAsync() => await Dispatcher.UIThread.InvokeAsync(() => { _window?.Dismiss(); _window = null; });
}

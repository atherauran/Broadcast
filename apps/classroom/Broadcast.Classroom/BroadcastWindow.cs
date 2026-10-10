using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Presenters;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Styling;
using Avalonia.Threading;
using Broadcast.Core;

namespace Broadcast.Classroom;

internal sealed class BroadcastWindow : ClassroomWindow
{
    private readonly TaskCompletionSource _closeRequested = new(TaskCreationOptions.RunContinuationsAsynchronously);
    internal TextBlock Body { get; }
    internal TextBlock Emoji { get; }
    internal TextBlock Teacher { get; }
    internal Button CloseButton { get; }

    public BroadcastWindow(Delivery delivery)
    {
        SystemDecorations = SystemDecorations.None; WindowState = WindowState.FullScreen;
        Topmost = true; ShowInTaskbar = false; CanResize = false;
        Background = Night;
        Cursor = new Cursor(StandardCursorType.None);
        var (emoji, foreground) = Style(delivery.Emotion);
        Teacher = new TextBlock
        {
            Text = delivery.TeacherName + " 发布", Foreground = new SolidColorBrush(Color.Parse("#D6DEE9")),
            FontFamily = Font, FontSize = 24, FontWeight = FontWeight.SemiBold,
            HorizontalAlignment = HorizontalAlignment.Center, TextAlignment = TextAlignment.Center,
        };
        Emoji = new TextBlock
        {
            Text = emoji, IsVisible = emoji.Length > 0, FontSize = 64, TextAlignment = TextAlignment.Center,
            Foreground = foreground, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 0, 0, 14),
        };
        Body = new TextBlock
        {
            Text = delivery.Body, Foreground = foreground, FontFamily = Font, FontWeight = FontWeight.Medium,
            TextAlignment = TextAlignment.Center, TextWrapping = TextWrapping.Wrap, VerticalAlignment = VerticalAlignment.Center,
        };
        CloseButton = new Button
        {
            Content = "关闭", IsVisible = false, Width = 150, Height = 54, FontSize = 20, Padding = new Thickness(0),
            Background = Brushes.White, Foreground = Night, BorderBrush = Brushes.White,
            HorizontalAlignment = HorizontalAlignment.Center, HorizontalContentAlignment = HorizontalAlignment.Center,
            VerticalContentAlignment = VerticalAlignment.Center,
            Cursor = new Cursor(StandardCursorType.Hand), Margin = new Thickness(0, 20, 0, 0),
        };
        // The button keeps its colors when hovered, pressed or disabled instead of taking the theme's.
        CloseButton.Classes.Add("broadcast-close");
        foreach (var state in new[] { ":pointerover", ":pressed", ":disabled" })
            Styles.Add(new Style(x => x.OfType<Button>().Class("broadcast-close").Class(state).Template().OfType<ContentPresenter>().Name("PART_ContentPresenter"))
            {
                Setters =
                {
                    new Setter(ContentPresenter.BackgroundProperty, Brushes.White),
                    new Setter(ContentPresenter.BorderBrushProperty, Brushes.White),
                    new Setter(ContentPresenter.ForegroundProperty, Night),
                },
            });
        CloseButton.Click += (_, _) => { CloseButton.IsEnabled = false; _closeRequested.TrySetResult(); };
        var message = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Children = { Emoji, Body } };
        Grid.SetRow(message, 1); Grid.SetRow(CloseButton, 2);
        var layout = new Grid { RowDefinitions = new RowDefinitions("Auto,*,Auto"), Children = { Teacher, message, CloseButton } };
        Content = new Border { Padding = new Thickness(64, 48), Child = layout };
        SizeChanged += (_, _) => Fit();
        Opened += (_, _) => Fit();
        Closed += (_, _) => _closeRequested.TrySetResult();
    }

    internal static (string Emoji, IBrush Foreground) Style(string emotion) => emotion switch
    {
        "happy" => ("😀", new SolidColorBrush(Color.Parse("#60A5FA"))),
        "sad" => ("☹️", new SolidColorBrush(Color.Parse("#FDE047"))),
        "angry" => ("😡", new SolidColorBrush(Color.Parse("#F87171"))),
        "warning" => ("⚠️", new SolidColorBrush(Color.Parse("#FB923C"))),
        _ => ("", Brushes.White),
    };

    private void Fit()
    {
        var width = Math.Max(100, ClientSize.Width - 128);
        var reserved = 96 + 44 + (Emoji.IsVisible ? 92 : 0) + (CloseButton.IsVisible ? 74 : 0);
        var height = Math.Max(100, ClientSize.Height - reserved);
        double lo = 12, hi = Math.Min(150, height);
        while (hi - lo > .5)
        {
            var size = (lo + hi) / 2;
            Body.FontSize = size;
            Body.Measure(new Size(width, double.PositiveInfinity));
            if (Body.DesiredSize.Height <= height && Body.DesiredSize.Width <= width + 1) lo = size; else hi = size;
        }
        // A notch below the largest fit, so the text has room to breathe.
        Body.FontSize = lo * .85;
    }

    public void ShowCloseButton() { CloseButton.IsVisible = true; Cursor = new Cursor(StandardCursorType.Arrow); Fit(); }

    public Task WaitForCloseAsync(CancellationToken ct) => _closeRequested.Task.WaitAsync(ct);
}

internal sealed class BroadcastDisplay : IDisplay
{
    private BroadcastWindow? _window;
    internal BroadcastWindow? Current => _window;
    public async Task ShowAsync(Delivery delivery, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        await Dispatcher.UIThread.InvokeAsync(() => { _window = new BroadcastWindow(delivery); _window.Show(); _window.Activate(); });
        await Dispatcher.UIThread.InvokeAsync(() => { }, DispatcherPriority.Render);
    }

    public async Task ShowCloseButtonAsync() => await Dispatcher.UIThread.InvokeAsync(() => _window?.ShowCloseButton());
    public async Task WaitForCloseAsync(CancellationToken ct)
    {
        var window = _window ?? throw new InvalidOperationException("广播界面未打开");
        await window.WaitForCloseAsync(ct);
    }

    public async Task HideAsync() => await Dispatcher.UIThread.InvokeAsync(() => { _window?.Dismiss(); _window = null; });
}

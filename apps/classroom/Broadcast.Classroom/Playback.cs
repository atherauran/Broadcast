using System.Diagnostics;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Platform;
using Avalonia.Threading;
using Broadcast.Core;
using NAudio.Wave;

namespace Broadcast.Classroom;

// An animated picture for a fullscreen moment: Seconds since it opened, and Progress through the sound from 0 to 1.
// Overlay is laid out on top of what the scene draws.
internal abstract class Scene : Control
{
    public double Progress { get; set; }
    public double Seconds { get; set; }
    public virtual Control? Overlay => null;
    public virtual void Advance() => InvalidateVisual();
}

// A fullscreen moment a teacher starts from a board: its sound plays once with the scene, then the window closes on its own.
internal sealed class PlaybackWindow : ClassroomWindow
{
    private readonly IAudioPlayer _audio;
    private readonly byte[] _sound;
    private readonly TimeSpan _length;
    private readonly CancellationTokenSource _stop = new();
    private readonly DispatcherTimer _timer;
    private readonly long _opened = Stopwatch.GetTimestamp();
    private long _started;
    internal Scene Scene { get; }
    internal Button CloseButton { get; }
    public event Action<Exception>? Error;

    // sound is a WAV under Assets.
    public PlaybackWindow(IAudioPlayer audio, string sound, Scene scene)
    {
        _audio = audio; Scene = scene;
        using (var stream = AssetLoader.Open(new Uri($"avares://{typeof(PlaybackWindow).Assembly.GetName().Name}/Assets/{sound}")))
        using (var copy = new MemoryStream()) { stream.CopyTo(copy); _sound = copy.ToArray(); }
        using (var reader = new WaveFileReader(new MemoryStream(_sound, false))) _length = reader.TotalTime;
        SystemDecorations = SystemDecorations.None; WindowState = WindowState.FullScreen;
        Topmost = true; ShowInTaskbar = false; CanResize = false; Background = Night;
        CloseButton = new Button
        {
            Content = "关闭", FontFamily = Font, FontSize = 20, Padding = new Thickness(24, 10), CornerRadius = new CornerRadius(10),
            HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 24, 24, 0),
            Cursor = new Avalonia.Input.Cursor(Avalonia.Input.StandardCursorType.Hand),
        };
        CloseButton.Click += (_, _) => _stop.Cancel();
        var layers = new Grid { Children = { scene } };
        if (scene.Overlay is { } overlay) layers.Children.Add(overlay);
        layers.Children.Add(CloseButton);
        Content = layers;
        _timer = new DispatcherTimer(TimeSpan.FromMilliseconds(16), DispatcherPriority.Render, (_, _) => Tick());
        Opened += async (_, _) => { _timer.Start(); await PlayAsync(); };
        Closed += (_, _) => { _timer.Stop(); _stop.Cancel(); };
    }

    private void Tick()
    {
        Scene.Seconds = Stopwatch.GetElapsedTime(_opened).TotalSeconds;
        if (_started != 0) Scene.Progress = Stopwatch.GetElapsedTime(_started) / _length;
        Scene.Advance();
    }

    private async Task PlayAsync()
    {
        try
        {
            await _audio.PlayAsync(_sound, () => Dispatcher.UIThread.Post(() => _started = Stopwatch.GetTimestamp()), _stop.Token);
            await Task.Delay(TimeSpan.FromSeconds(3), _stop.Token);
        }
        catch (OperationCanceledException) { }
        catch (Exception e) { Error?.Invoke(e); }
        Dismiss();
    }
}

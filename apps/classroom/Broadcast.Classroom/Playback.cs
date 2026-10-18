using System.Diagnostics;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Platform;
using Avalonia.Threading;
using Broadcast.Core;

namespace Broadcast.Classroom;

// An animated picture for a fullscreen moment, Seconds since it opened. Overlay is laid out on top of what the scene draws.
internal abstract class Scene : Control
{
    public double Seconds { get; set; }
    public virtual Control? Overlay => null;
    public virtual void Advance() => InvalidateVisual();
}

// A fullscreen moment a teacher starts from a board: its sound plays once with the scene, then the window closes on its own.
internal sealed class PlaybackWindow : ClassroomWindow
{
    private readonly IAudioPlayer _audio;
    private readonly byte[] _sound;
    private readonly CancellationTokenSource _stop = new();
    private readonly DispatcherTimer _timer;
    private readonly long _opened = Stopwatch.GetTimestamp();
    internal Scene Scene { get; }
    public event Action<Exception>? Error;

    // sound is a WAV under Assets.
    public PlaybackWindow(IAudioPlayer audio, string sound, Scene scene)
    {
        _audio = audio; Scene = scene;
        using (var stream = AssetLoader.Open(new Uri($"avares://{typeof(PlaybackWindow).Assembly.GetName().Name}/Assets/{sound}")))
        { _sound = new byte[stream.Length]; stream.ReadExactly(_sound); }
        SystemDecorations = SystemDecorations.None; WindowState = WindowState.FullScreen;
        Topmost = true; ShowInTaskbar = false; CanResize = false; Background = Night;
        // No button covers the picture: a tap anywhere or Esc ends it early.
        PointerPressed += (_, _) => _stop.Cancel();
        KeyDown += (_, e) => { if (e.Key == Avalonia.Input.Key.Escape) _stop.Cancel(); };
        var layers = new Grid { Children = { scene } };
        if (scene.Overlay is { } overlay) layers.Children.Add(overlay);
        Content = layers;
        _timer = new DispatcherTimer(TimeSpan.FromMilliseconds(16), DispatcherPriority.Render, (_, _) => Tick());
        Opened += async (_, _) => { _timer.Start(); await PlayAsync(); };
        Closed += (_, _) => { _timer.Stop(); _stop.Cancel(); };
    }

    private void Tick()
    {
        Scene.Seconds = Stopwatch.GetElapsedTime(_opened).TotalSeconds;
        Scene.Advance();
    }

    private async Task PlayAsync()
    {
        try
        {
            await _audio.PlayAsync(_sound, () => { }, _stop.Token);
            await Task.Delay(TimeSpan.FromSeconds(3), _stop.Token);
        }
        catch (OperationCanceledException) { }
        catch (Exception e) { Error?.Invoke(e); }
        Dismiss();
    }
}

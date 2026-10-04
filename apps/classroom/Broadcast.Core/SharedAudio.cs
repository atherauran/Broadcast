namespace Broadcast.Core;

// Fullscreen broadcasts play on Primary and cut off a board being read on Secondary; Secondary never starts over Primary.
public sealed class SharedAudio
{
    private readonly IAudioPlayer _player;
    private readonly object _lock = new();
    private CancellationTokenSource _background = new();
    private int _foreground;
    public IAudioPlayer Primary { get; }
    public IAudioPlayer Secondary { get; }

    public SharedAudio(IAudioPlayer player)
    {
        _player = player;
        Primary = new Channel(PlayPrimaryAsync);
        Secondary = new Channel(PlaySecondaryAsync);
    }

    private async Task PlayPrimaryAsync(byte[] audio, Action started, CancellationToken ct)
    {
        lock (_lock) { _foreground++; _background.Cancel(); _background = new(); }
        try { await _player.PlayAsync(audio, started, ct); }
        finally { lock (_lock) _foreground--; }
    }

    private async Task PlaySecondaryAsync(byte[] audio, Action started, CancellationToken ct)
    {
        CancellationToken stop;
        lock (_lock)
        {
            if (_foreground > 0) throw new OperationCanceledException();
            stop = _background.Token;
        }
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, stop);
        await _player.PlayAsync(audio, started, linked.Token);
    }

    private sealed class Channel(Func<byte[], Action, CancellationToken, Task> play) : IAudioPlayer
    {
        public Task PlayAsync(byte[] audio, Action started, CancellationToken ct) => play(audio, started, ct);
    }
}

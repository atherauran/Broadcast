namespace Broadcast.Core;

// Reads a board line by line: each line is its own short synthesis with its own timeout, and the next line is
// synthesized while the current one plays, so a long list neither hits the timeout nor pauses between lines.
public sealed class BoardReader(ISpeechSynthesizer speech, IAudioPlayer audio)
{
    private static readonly TimeSpan SynthesisTimeout = TimeSpan.FromSeconds(10);
    private readonly SemaphoreSlim _turn = new(1, 1);
    private readonly Dictionary<Guid, CancellationTokenSource> _reading = [];
    public event Action<Exception>? Error;

    public void Start(DisplayItem board, CancellationToken ct)
    {
        var life = CancellationTokenSource.CreateLinkedTokenSource(ct);
        lock (_reading) _reading[board.Id] = life;
        _ = ReadAsync(board, life);
    }

    // Stops reading any board that is no longer on screen.
    public void Retain(IEnumerable<Guid> visible)
    {
        var keep = visible.ToHashSet();
        lock (_reading) foreach (var (id, life) in _reading) if (!keep.Contains(id)) life.Cancel();
    }

    private async Task ReadAsync(DisplayItem board, CancellationTokenSource life)
    {
        var ct = life.Token;
        try
        {
            await _turn.WaitAsync(ct);
            try
            {
                string[] lines = [board.Content.Title ?? "公告", .. board.Content.Entries ?? []];
                var next = SynthesizeAsync(lines[0], board.Content.VoiceType, ct);
                for (var i = 0; i < lines.Length; i++)
                {
                    var bytes = await next;
                    if (i + 1 < lines.Length) next = SynthesizeAsync(lines[i + 1], board.Content.VoiceType, ct);
                    if (bytes is not null) await audio.PlayAsync(bytes, () => { }, ct);
                }
            }
            finally { _turn.Release(); }
        }
        // Removed, ended, or interrupted by a fullscreen broadcast: the board simply stops reading.
        catch (OperationCanceledException) { }
        catch (Exception e) { Error?.Invoke(e); }
        finally
        {
            lock (_reading) if (_reading.TryGetValue(board.Id, out var current) && current == life) _reading.Remove(board.Id);
            life.Dispose();
        }
    }

    private async Task<byte[]?> SynthesizeAsync(string text, int voiceType, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(SynthesisTimeout);
        try { return await speech.SynthesizeAsync(text, voiceType, timeout.Token); }
        catch (Exception e) when (!ct.IsCancellationRequested) { Error?.Invoke(e); return null; }
    }
}

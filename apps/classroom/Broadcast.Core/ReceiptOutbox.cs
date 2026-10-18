using System.Text.Json;

namespace Broadcast.Core;

public sealed class ReceiptOutbox
{
    private readonly string _path;
    private readonly List<Receipt> _pending;
    private readonly object _lock = new();
    private readonly SemaphoreSlim _flush = new(1, 1);
    public event Action? Changed;
    public ReceiptOutbox(string path)
    {
        _path = path;
        _pending = File.Exists(path) ? JsonSerializer.Deserialize<List<Receipt>>(File.ReadAllText(path), Json.Options)! : [];
    }

    public void Enqueue(Receipt receipt)
    {
        lock (_lock)
        {
            if (_pending.Any(r => r.DeliveryId == receipt.DeliveryId && r.Event == receipt.Event)) return;
            _pending.Add(receipt); Save();
        }
        Changed?.Invoke();
    }

    public async Task FlushAsync(IBackend backend, CancellationToken ct)
    {
        await _flush.WaitAsync(ct);
        try
        {
            while (true)
            {
                Receipt? receipt;
                lock (_lock) receipt = _pending.FirstOrDefault();
                if (receipt is null) return;
                try { await backend.AcknowledgeAsync(receipt, ct); }
                // A rejected receipt (a revoked binding, an invalid time) would otherwise block every later one; auth, timeouts and throttling retry.
                catch (BackendException e) when ((int)e.Status is >= 400 and < 500 and not (401 or 408 or 429)) { }
                lock (_lock) { _pending.Remove(receipt); Save(); }
            }
        }
        finally { _flush.Release(); }
    }

    private void Save()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        File.WriteAllText(_path + ".tmp", JsonSerializer.Serialize(_pending, Json.Options));
        File.Move(_path + ".tmp", _path, true);
    }
}

using System.Text.Json;

namespace Broadcast.Core;

public sealed record FileTransfer(Guid DeliveryId, Guid TransferId, string Filename, long SizeBytes, string ObjectPath, DateTimeOffset ExpiresAt);
public sealed record FileTransferBatch(DateTimeOffset ServerNow, FileTransfer[] Items);
public interface IFileTransferBackend
{
    Task<FileTransferBatch> PendingFilesAsync(CancellationToken ct);
    Task DownloadFileAsync(FileTransfer file, string destination, CancellationToken ct);
}

// This worker has its own loop: file downloads never hold up a broadcast or its receipts.
public sealed class FileTransferReceiver(IFileTransferBackend backend, ReceiptOutbox outbox, ServerClock clock, string desktop, string stateFolder)
{
    public event Action<Exception>? Error;
    public async Task SyncAsync(CancellationToken ct)
    {
        var batch = await backend.PendingFilesAsync(ct);
        clock.Sync(batch.ServerNow);
        foreach (var file in batch.Items)
        {
            if (file.ExpiresAt <= clock.Now || outbox.HasFileResult(file.DeliveryId)) continue;
            var marker = Path.Combine(stateFolder, file.DeliveryId + ".json");
            try
            {
                outbox.Enqueue(new Receipt(file.DeliveryId, "received", clock.Now, Kind: "file"));
                if (string.IsNullOrEmpty(desktop)) throw new IOException("找不到 Windows 桌面");
                Validate(file);
                Directory.CreateDirectory(desktop);
                Directory.CreateDirectory(stateFolder);
                // Remember the destination before downloading, so a restart or lost receipt cannot create a second copy.
                var saved = File.Exists(marker) ? JsonSerializer.Deserialize<SavedFile>(await File.ReadAllTextAsync(marker, ct), Json.Options)! : new SavedFile(ChooseName(file.Filename), false);
                await SaveAsync(saved);
                if (!saved.Complete)
                {
                    var destination = Path.Combine(desktop, saved.Name);
                    var temporary = destination + "." + file.DeliveryId + ".part";
                    try
                    {
                        // A crash after the move but before the marker write is recovered from the completed destination.
                        if (!File.Exists(destination))
                        {
                            await backend.DownloadFileAsync(file, temporary, ct);
                            if (new FileInfo(temporary).Length != file.SizeBytes) throw new IOException("文件下载不完整");
                            File.Move(temporary, destination); // Never replace an existing desktop file.
                        }
                        else if (new FileInfo(destination).Length != file.SizeBytes) throw new IOException("桌面上已有同名文件，请重命名后重新发送");
                        saved = saved with { Complete = true };
                        await SaveAsync(saved);
                    }
                    finally { File.Delete(temporary); }
                }
                outbox.Enqueue(new Receipt(file.DeliveryId, "downloaded", clock.Now, Kind: "file", SavedName: saved.Name));
                async Task SaveAsync(SavedFile value)
                {
                    await File.WriteAllTextAsync(marker + ".tmp", JsonSerializer.Serialize(value, Json.Options), ct);
                    File.Move(marker + ".tmp", marker, true);
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception e)
            {
                Error?.Invoke(e);
                outbox.Enqueue(new Receipt(file.DeliveryId, "failed", clock.Now, e.Message, "file"));
            }
        }
    }

    private string ChooseName(string filename)
    {
        if (!File.Exists(Path.Combine(desktop, filename))) return filename;
        var stem = Path.GetFileNameWithoutExtension(filename);
        var extension = Path.GetExtension(filename);
        for (var i = 1; ; i++)
        {
            var name = $"{stem} ({i}){extension}";
            if (!File.Exists(Path.Combine(desktop, name))) return name;
        }
    }

    public static void Validate(FileTransfer file)
    {
        // New sends are capped at 10 MiB by the server; still receive files sent under the former 20 MiB limit.
        var name = file.Filename;
        var stem = name.Split('.')[0].ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(name) || name.Length > 180 || name.Any(c => c < 32 || "<>:\"/\\|?*".Contains(c))
            || name.EndsWith('.') || name.EndsWith(' ') || stem is "CON" or "PRN" or "AUX" or "NUL"
            || (stem.Length == 4 && (stem.StartsWith("COM") || stem.StartsWith("LPT")) && "123456789¹²³".Contains(stem[3]))
            || file.SizeBytes is < 1 or > 20 * 1024 * 1024 || file.ObjectPath != file.TransferId + "/file")
            throw new IOException("无效的传输文件");
    }
    private sealed record SavedFile(string Name, bool Complete);
}

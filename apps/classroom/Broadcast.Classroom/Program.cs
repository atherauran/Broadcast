using Avalonia;
using System.Diagnostics;
using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text;

namespace Broadcast.Classroom;

internal static class Program
{
    private static Mutex? _instance;
    internal static readonly string InstanceName = "BroadcastClassroom-" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Environment.UserName)))[..16];
    [STAThread]
    public static int Main(string[] args)
    {
        if (args.Contains("--worker")) return RunWorker(args);
        _instance = new Mutex(true, InstanceName, out var first);
        if (!first)
        {
            try { using var pipe = new NamedPipeClientStream(".", InstanceName, PipeDirection.Out); pipe.Connect(1000); pipe.WriteByte(1); }
            catch (TimeoutException) { }
            return 0;
        }
        try { return Supervise(args); }
        finally { _instance.ReleaseMutex(); _instance.Dispose(); }
    }

    // The app runs in a child process that is restarted after any abnormal exit; leaving through the tray exits with 0 and ends the loop.
    private static int Supervise(string[] args)
    {
        while (true)
        {
            var started = Stopwatch.GetTimestamp();
            var info = new ProcessStartInfo(Environment.ProcessPath!);
            foreach (var arg in args.Append("--worker")) info.ArgumentList.Add(arg);
            using var worker = Process.Start(info)!;
            worker.WaitForExit();
            if (worker.ExitCode == 0) return 0;
            LocalState.Log(new InvalidOperationException($"教室程序异常退出（代码 {worker.ExitCode}），正在重启"));
            // A crash right at startup waits longer, so a persistent fault does not spin.
            Thread.Sleep(Stopwatch.GetElapsedTime(started) < TimeSpan.FromSeconds(10) ? 30_000 : 2_000);
        }
    }

    private static int RunWorker(string[] args)
    {
        AppDomain.CurrentDomain.UnhandledException += (_, e) => LocalState.Log(e.ExceptionObject as Exception ?? new InvalidOperationException(e.ExceptionObject.ToString()));
        return BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
    }
    public static AppBuilder BuildAvaloniaApp() => AppBuilder.Configure<App>().UsePlatformDetect().LogToTrace();
}

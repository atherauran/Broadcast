using System.Runtime.InteropServices;
using Avalonia.Controls;

namespace Broadcast.Classroom;

// Display items must not take focus from the lesson: an activated window would swallow the PPT clicker keys.
internal static class WindowLayer
{
    private const uint NoSize = 0x1, NoMove = 0x2, NoActivate = 0x10;

    // Classroom users cannot close these windows, but they must not hold up Windows shutdown or the app's own exit.
    public static void KeepOpen(WindowClosingEventArgs e, bool dismissed)
    {
        if (!dismissed && e.CloseReason is not (WindowCloseReason.OSShutdown or WindowCloseReason.ApplicationShutdown)) e.Cancel = true;
    }

    public static void ShowPassive(Window window)
    {
        window.ShowActivated = false;
        window.Show();
    }

    // Normal windows slide in under a running slideshow or fullscreen video, so they are next in line at break.
    public static void ShowBehindLesson(Window window)
    {
        ShowPassive(window);
        if (!OperatingSystem.IsWindows() || !LessonRunning()) return;
        var foreground = GetForegroundWindow();
        if (Handle(window) is { } handle && foreground != IntPtr.Zero && foreground != handle)
            SetWindowPos(handle, foreground, 0, 0, 0, 0, NoSize | NoMove | NoActivate);
    }

    public static void PlaceBelow(Window window, Window above)
    {
        if (OperatingSystem.IsWindows() && Handle(window) is { } handle && Handle(above) is { } target)
            SetWindowPos(handle, target, 0, 0, 0, 0, NoSize | NoMove | NoActivate);
    }

    private static IntPtr? Handle(Window window) => window.TryGetPlatformHandle()?.Handle;

    // QUNS_BUSY, QUNS_RUNNING_D3D_FULL_SCREEN and QUNS_PRESENTATION_MODE.
    private static bool LessonRunning() => SHQueryUserNotificationState(out var state) == 0 && state is 2 or 3 or 4;

    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
    [DllImport("shell32.dll")] private static extern int SHQueryUserNotificationState(out int state);
}

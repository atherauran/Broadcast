using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Broadcast.Core;

namespace Broadcast.Classroom;

internal static class BirthdayArt
{
    public static readonly Color Pink = Color.Parse("#DB2777");
    public static readonly IBrush Background = new LinearGradientBrush
    {
        StartPoint = new RelativePoint(0, 0, RelativeUnit.Relative), EndPoint = new RelativePoint(1, 1, RelativeUnit.Relative),
        GradientStops = { new GradientStop(Color.Parse("#EC4899"), 0), new GradientStop(Color.Parse("#A855F7"), .6), new GradientStop(Color.Parse("#7C3AED"), 1) },
    }.ToImmutable();

    // A weekend birthday greeted on Friday carries its day.
    public static string Label(Celebration birthday, DateOnly today) =>
        birthday.On == today ? birthday.Name : $"{birthday.Name}（{(birthday.On.DayOfWeek == DayOfWeek.Saturday ? "周六" : "周日")}）";

    public static TextBlock Text(string text, double size, FontWeight weight = FontWeight.Bold) => new()
    {
        Text = text, FontSize = size, FontWeight = weight, FontFamily = ClassroomWindow.Font, Foreground = Brushes.White,
        TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center,
    };

    // The day's special note at the top of the notes column.
    public static Border Card(IReadOnlyList<Celebration> birthdays, DateOnly today)
    {
        var names = new StackPanel { Spacing = 2 };
        // One line per student, shrunk rather than broken when a name with its weekday is long.
        foreach (var birthday in birthdays)
        {
            var name = Text(Label(birthday, today), 22, FontWeight.SemiBold);
            name.TextWrapping = TextWrapping.NoWrap;
            names.Children.Add(new Viewbox { StretchDirection = StretchDirection.DownOnly, Child = name });
        }
        return new Border
        {
            Width = NotesWindow.ColumnWidth, Padding = new Thickness(14, 12), CornerRadius = new CornerRadius(12), Background = Background,
            BorderBrush = new SolidColorBrush(Color.Parse("#FDE047")), BorderThickness = new Thickness(2),
            Child = new StackPanel { Spacing = 6, Children = { Text("🎂 生日快乐", 24), names } },
        };
    }
}

// Confetti falling over a pink and purple sky, under a gently bouncing greeting with the names.
internal sealed class BirthdayScene : Scene
{
    private static readonly IBrush[] Colors = new[] { "#FDE047", "#34D399", "#60A5FA", "#F9A8D4", "#FFFFFF", "#FB923C" }
        .Select(color => (IBrush)new SolidColorBrush(Color.Parse(color)).ToImmutable()).ToArray();
    private readonly (double X, double Y, double Fall, double Size, IBrush Color, double Spin, double Sway, double Phase)[] _confetti;
    private readonly ScaleTransform _bounce = new();
    public override Control Overlay { get; }

    public BirthdayScene(IReadOnlyList<Celebration> birthdays, DateOnly today)
    {
        var random = new Random(11);
        _confetti = Enumerable.Range(0, 150).Select(_ => (random.NextDouble(), random.NextDouble(), .07 + random.NextDouble() * .1, 8 + random.NextDouble() * 10,
            Colors[random.Next(Colors.Length)], random.NextDouble() * 6 - 3, 6 + random.NextDouble() * 18, random.NextDouble() * Math.Tau)).ToArray();
        var title = BirthdayArt.Text("Happy Birthday!", 140);
        title.RenderTransform = _bounce; title.RenderTransformOrigin = RelativePoint.Center;
        title.Effect = new DropShadowEffect { Color = Color.Parse("#5B21B6"), BlurRadius = 16, OffsetX = 0, OffsetY = 6, Opacity = .55 };
        var names = BirthdayArt.Text(string.Join("　", birthdays.Select(b => BirthdayArt.Label(b, today))), 64, FontWeight.SemiBold);
        names.Margin = new Thickness(0, 28, 0, 0);
        // Laid out at a fixed design width and scaled to the screen, so the greeting keeps its proportions everywhere.
        Overlay = new Viewbox
        {
            Margin = new Thickness(64, 80), StretchDirection = StretchDirection.Both,
            Child = new StackPanel
            {
                Width = 1400,
                Children = { BirthdayArt.Text("🎂", 130, FontWeight.Normal), title, names },
            },
        };
    }

    public override void Advance()
    {
        var scale = 1 + .035 * Math.Sin(Seconds * 5);
        _bounce.ScaleX = scale; _bounce.ScaleY = scale;
        InvalidateVisual();
    }

    public override void Render(DrawingContext context)
    {
        var (w, h) = (Bounds.Width, Bounds.Height);
        context.FillRectangle(BirthdayArt.Background, new Rect(Bounds.Size));
        foreach (var (x, y, fall, size, color, spin, sway, phase) in _confetti)
        {
            var top = ((y + fall * Seconds) % 1.1 - .05) * h;
            var left = x * w + sway * Math.Sin(Seconds * 2 + phase);
            using (context.PushTransform(Matrix.CreateRotation(phase + spin * Seconds) * Matrix.CreateTranslation(left, top)))
                context.FillRectangle(color, new Rect(-size / 2, -size / 4, size, size / 2));
        }
    }
}

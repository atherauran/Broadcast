using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Media.Imaging;

namespace Broadcast.Classroom;

// The national flag on its 30 × 20 grid: the large star and four small ones, each small star pointing at the large one.
internal static class FlagArt
{
    public static readonly Color Red = Color.Parse("#DE2910"), Yellow = Color.Parse("#FFDE00");
    private static readonly (double X, double Y, double R)[] Stars = [(5, 5, 3), (10, 2, 1), (12, 4, 1), (12, 7, 1), (10, 9, 1)];

    // The flag as a picture of the given pixel size, drawn in pixels at 96 dpi so the screen's scaling never enters into it.
    public static RenderTargetBitmap Bitmap(PixelSize size)
    {
        var bitmap = new RenderTargetBitmap(size, new Vector(96, 96));
        using var context = bitmap.CreateDrawingContext();
        Draw(context, new Rect(0, 0, size.Width, size.Height));
        return bitmap;
    }

    public static void Draw(DrawingContext context, Rect area)
    {
        context.FillRectangle(new SolidColorBrush(Red), area);
        var unit = area.Width / 30;
        var yellow = new SolidColorBrush(Yellow);
        foreach (var (x, y, r) in Stars)
        {
            var angle = r == 3 ? -Math.PI / 2 : Math.Atan2(5 - y, 5 - x);
            context.DrawGeometry(yellow, null, Star(new Point(area.X + x * unit, area.Y + y * unit), r * unit, angle));
        }
    }

    private static StreamGeometry Star(Point center, double radius, double angle)
    {
        var geometry = new StreamGeometry();
        using var g = geometry.Open();
        for (var i = 0; i < 10; i++)
        {
            var r = i % 2 == 0 ? radius : radius * .381966;
            var a = angle + i * Math.PI / 5;
            var point = new Point(center.X + r * Math.Cos(a), center.Y + r * Math.Sin(a));
            if (i == 0) g.BeginFigure(point, true); else g.LineTo(point);
        }
        g.EndFigure(true);
        return geometry;
    }
}

internal sealed class FlagIcon : Control
{
    public override void Render(DrawingContext context) => FlagArt.Draw(context, new Rect(Bounds.Size));
}

// The flag filling the screen, waving from its hoist edge.
internal sealed class FlagScene : Scene
{
    // The shade's strongest alpha is .16 × 255 ≈ 41, so one brush per alpha step looks the same as an exact one and none is made per frame.
    private const int ShadeSteps = 41;
    private static readonly IBrush[] Light = Shades(Colors.White), Dark = Shades(Colors.Black);
    private RenderTargetBitmap? _flag;

    private static IBrush[] Shades(Color color) =>
        Enumerable.Range(0, ShadeSteps + 1).Select(i => (IBrush)new SolidColorBrush(color, i * .16 / ShadeSteps).ToImmutable()).ToArray();

    public FlagScene() { SizeChanged += (_, _) => { _flag?.Dispose(); _flag = null; }; }

    public override void Render(DrawingContext context)
    {
        var (w, h) = (Bounds.Width, Bounds.Height);
        if (w < 1 || h < 1) return;
        // As large as the screen allows, with room left for the wave.
        var fw = Math.Min(w * .94, h * .9 * 1.5);
        var fh = fw * 2 / 3;
        var (left, top) = ((w - fw) / 2, (h - fh) / 2);
        // Sharp at the screen's scaling; strips are cut from it in its own pixels.
        var scale = TopLevel.GetTopLevel(this)?.RenderScaling ?? 1;
        _flag ??= FlagArt.Bitmap(new PixelSize((int)Math.Ceiling(fw * scale), (int)Math.Ceiling(fh * scale)));
        var pixels = _flag.PixelSize.Width / fw;
        // Vertical strips ride a travelling wave that grows away from the hoist, and are shaded by their slope.
        const double strip = 4;
        var count = (int)Math.Ceiling(fw / strip);
        for (var i = 0; i < count; i++)
        {
            var u = (i + .5) / count;
            var phase = u * 2.6 * Math.PI - Seconds * 3.4;
            var x = i * strip;
            var width = Math.Min(strip, fw - x);
            var dest = new Rect(left + x, top + fh * .04 * u * Math.Sin(phase), width + .6, fh);
            context.DrawImage(_flag, new Rect(x * pixels, 0, width * pixels, _flag.PixelSize.Height), dest);
            var slope = Math.Cos(phase) * (.3 + .7 * u);
            context.FillRectangle((slope > 0 ? Light : Dark)[(int)Math.Round(Math.Abs(slope) * ShadeSteps)], dest);
        }
    }
}

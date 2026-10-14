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
    private RenderTargetBitmap? _flag;

    public FlagScene() { SizeChanged += (_, _) => { _flag?.Dispose(); _flag = null; }; }

    public override void Render(DrawingContext context)
    {
        var (w, h) = (Bounds.Width, Bounds.Height);
        if (w < 1 || h < 1) return;
        // As large as the screen allows, with room left for the wave.
        var fw = Math.Min(w * .94, h * .9 * 1.5);
        var fh = fw * 2 / 3;
        var (left, top) = ((w - fw) / 2, (h - fh) / 2);
        var scale = TopLevel.GetTopLevel(this)?.RenderScaling ?? 1;
        if (_flag is null)
        {
            _flag = new RenderTargetBitmap(new PixelSize((int)Math.Ceiling(fw * scale), (int)Math.Ceiling(fh * scale)), new Vector(96 * scale, 96 * scale));
            using var art = _flag.CreateDrawingContext();
            FlagArt.Draw(art, new Rect(_flag.Size));
        }
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
            context.DrawImage(_flag, new Rect(x, 0, width, fh), dest);
            var slope = Math.Cos(phase) * (.3 + .7 * u);
            context.FillRectangle(new SolidColorBrush(slope > 0 ? Colors.White : Colors.Black, Math.Abs(slope) * .16), dest);
        }
    }
}

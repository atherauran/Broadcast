using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;

namespace Broadcast.Classroom;

// Decoration painted behind a board. It stays in the window's padding and corners and is drawn faintly, so the text stays easy to read.
// A fixed seed keeps the pattern identical on every redraw.
internal sealed class Backdrop : Control
{
    private string _look = "plain";
    public string Look { get => _look; set { _look = value; InvalidateVisual(); } }

    public Backdrop() { IsHitTestVisible = false; SizeChanged += (_, _) => InvalidateVisual(); }

    public override void Render(DrawingContext context)
    {
        var (w, h) = (Bounds.Width, Bounds.Height);
        if (w < 1 || h < 1) return;
        var random = new Random(7);
        switch (_look)
        {
            case "festive": Festive(context, w, h, random); break;
            case "joyful": Joyful(context, w, h, random); break;
            case "fresh": Fresh(context, w, h); break;
            case "tech": Tech(context, w, h); break;
            case "safety": Safety(context, w, h); break;
        }
    }

    private static IBrush Brush(string color, double opacity) => new SolidColorBrush(Color.Parse(color), opacity);

    // Fireworks burst over the top-right and bottom corners, away from where the title starts.
    private static void Festive(DrawingContext context, double w, double h, Random random)
    {
        var m = Math.Min(w, h);
        Burst(context, new Point(w * .88, h * .17), m * .13, 16, "#FDE68A", .34);
        Burst(context, new Point(w * .72, h * .07), m * .06, 12, "#FBCFE8", .3);
        Burst(context, new Point(w * .07, h * .86), m * .1, 14, "#FDE68A", .28);
        Burst(context, new Point(w * .95, h * .82), m * .07, 12, "#FECACA", .3);
        Burst(context, new Point(w * .5, h * .97), m * .05, 10, "#FDE68A", .22);
        for (var i = 0; i < 40; i++)
        {
            var radius = 1.2 + random.NextDouble() * 1.6;
            context.DrawEllipse(Brush("#FDE68A", .2 + random.NextDouble() * .3), null, Edge(random, w, h, 34), radius, radius);
        }
    }

    private static void Burst(DrawingContext context, Point center, double radius, int rays, string color, double opacity)
    {
        var pen = new Pen(Brush(color, opacity), Math.Max(1.5, radius / 40), lineCap: PenLineCap.Round);
        var dot = Brush(color, opacity * 1.3);
        var size = Math.Max(1.6, radius / 30);
        for (var i = 0; i < rays; i++)
        {
            var angle = Math.PI * 2 * i / rays + .2;
            var ray = new Point(Math.Cos(angle), Math.Sin(angle)) * radius;
            // Alternate rays start at different distances, so the burst looks less mechanical.
            context.DrawLine(pen, center + ray * (i % 2 == 0 ? .3 : .45), center + ray * .9);
            context.DrawEllipse(dot, null, center + ray * 1.04, size, size);
        }
    }

    // A point inside the window's outer band, where the board's padding keeps text away.
    private static Point Edge(Random random, double w, double h, double band) => random.Next(4) switch
    {
        0 => new Point(random.NextDouble() * w, random.NextDouble() * band),
        1 => new Point(random.NextDouble() * w, h - random.NextDouble() * band),
        2 => new Point(random.NextDouble() * band, random.NextDouble() * h),
        _ => new Point(w - random.NextDouble() * band, random.NextDouble() * h),
    };

    private static void Joyful(DrawingContext context, double w, double h, Random random)
    {
        string[] colors = ["#F472B6", "#FB923C", "#FACC15", "#34D399", "#60A5FA", "#A78BFA"];
        for (var i = 0; i < 70; i++)
        {
            var point = Edge(random, w, h, 40);
            var brush = Brush(colors[random.Next(colors.Length)], .55);
            if (random.Next(3) == 0) { context.DrawEllipse(brush, null, point, 3.5, 3.5); continue; }
            using (context.PushTransform(Matrix.CreateRotation(random.NextDouble() * Math.PI) * Matrix.CreateTranslation(point.X, point.Y)))
                context.DrawRectangle(brush, null, new Rect(-3, -6.5, 6, 13), 1.5, 1.5);
        }
    }

    // Soft light circles and a leafy sprig in the corners.
    private static void Fresh(DrawingContext context, double w, double h)
    {
        var m = Math.Min(w, h);
        Glow(context, new Point(w * .96, h * .04), m * .45, "#FFFFFF", .7);
        Glow(context, new Point(w * .02, h * 1.02), m * .4, "#FFFFFF", .55);
        Glow(context, new Point(w * .7, h * .98), m * .22, "#A7F3D0", .35);
        var leaf = Brush("#059669", .16);
        var stem = new Pen(Brush("#059669", .2), 2, lineCap: PenLineCap.Round);
        var step = new Point(-1, -.55) * (m * .055);
        var at = new Point(w - 12, h - 8);
        // Leaves alternate sides along a stem rising from the bottom-right corner.
        for (var i = 0; i < 6; i++)
        {
            context.DrawLine(stem, at, at += step);
            using (context.PushTransform(Matrix.CreateRotation(i % 2 == 0 ? -.9 : 2.2) * Matrix.CreateTranslation(at.X, at.Y)))
                context.DrawGeometry(leaf, null, Leaf(m * .05));
        }
    }

    private static Geometry Leaf(double length)
    {
        var shape = new StreamGeometry();
        using var draw = shape.Open();
        draw.BeginFigure(new Point(0, 0), true);
        draw.QuadraticBezierTo(new Point(length * .5, -length * .45), new Point(length, 0));
        draw.QuadraticBezierTo(new Point(length * .5, length * .45), new Point(0, 0));
        draw.EndFigure(true);
        return shape;
    }

    private static Geometry Polygon(params Point[] points)
    {
        var shape = new StreamGeometry();
        using var draw = shape.Open();
        draw.BeginFigure(points[0], true);
        foreach (var point in points[1..]) draw.LineTo(point);
        draw.EndFigure(true);
        return shape;
    }

    private static void Glow(DrawingContext context, Point center, double radius, string color, double opacity)
    {
        var tint = Color.Parse(color);
        var brush = new RadialGradientBrush
        {
            GradientStops =
            {
                new GradientStop(Color.FromArgb((byte)(255 * opacity), tint.R, tint.G, tint.B), 0),
                new GradientStop(Color.FromArgb(0, tint.R, tint.G, tint.B), 1),
            },
        };
        context.DrawEllipse(brush, null, center, radius, radius);
    }

    // A faint grid with circuit traces running in from two corners.
    private static void Tech(DrawingContext context, double w, double h)
    {
        var grid = new Pen(Brush("#38BDF8", .06), 1);
        for (double x = 40; x < w; x += 40) context.DrawLine(grid, new Point(x, 0), new Point(x, h));
        for (double y = 40; y < h; y += 40) context.DrawLine(grid, new Point(0, y), new Point(w, y));
        Glow(context, new Point(w * .92, h * .08), Math.Min(w, h) * .4, "#38BDF8", .16);
        // Each trace runs in from the window edge, turns once and ends in a node; points are offsets into the window from a corner.
        var pen = new Pen(Brush("#38BDF8", .3), 2, lineCap: PenLineCap.Round, lineJoin: PenLineJoin.Round);
        var node = Brush("#38BDF8", .45);
        Point TopRight(double x, double y) => new(w - x, y);
        Point BottomLeft(double x, double y) => new(x, h - y);
        foreach (var (from, bend, end) in new[]
        {
            (TopRight(120, 0), TopRight(120, 40), TopRight(200, 40)), (TopRight(60, 0), TopRight(60, 90), TopRight(150, 90)),
            (TopRight(24, 0), TopRight(24, 140), TopRight(90, 140)),
            (BottomLeft(110, 0), BottomLeft(110, 36), BottomLeft(190, 36)), (BottomLeft(50, 0), BottomLeft(50, 80), BottomLeft(130, 80)),
        })
        {
            context.DrawLine(pen, from, bend); context.DrawLine(pen, bend, end);
            context.DrawEllipse(node, null, end, 4, 4);
        }
    }

    // Hazard tape along the top and bottom edges and a faint warning sign in the corner.
    private static void Safety(DrawingContext context, double w, double h)
    {
        const double tape = 12;
        var stripe = Brush("#1F2937", .82);
        foreach (var top in new[] { 0.0, h - tape })
            using (context.PushClip(new Rect(0, top, w, tape)))
                for (double x = -tape; x < w + tape; x += tape * 2)
                    context.DrawGeometry(stripe, null, Polygon(new(x, top + tape), new(x + tape, top), new(x + tape * 2, top), new(x + tape, top + tape)));
        var size = Math.Min(w, h) * .32;
        var corner = new Point(w - size * .65, h - size * .55);
        var ink = new Pen(Brush("#B45309", .1), size / 14, lineJoin: PenLineJoin.Round, lineCap: PenLineCap.Round);
        context.DrawGeometry(null, ink, Polygon(corner + new Point(0, -size / 2), corner + new Point(size / 2, size * .38), corner + new Point(-size / 2, size * .38)));
        context.DrawLine(ink, corner + new Point(0, -size * .17), corner + new Point(0, size * .1));
        context.DrawEllipse(Brush("#B45309", .1), null, corner + new Point(0, size * .23), size / 26, size / 26);
    }
}

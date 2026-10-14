// Text recognition that runs entirely in the browser with PaddleOCR's PP-OCRv4 models (Apache-2.0).
// Detection marks text regions; each region is cut out along its own slant and read by the recognition model.
export interface Raw { data: Uint8ClampedArray; width: number; height: number }
export type Point = [number, number];
// box is the region's four corners (top left, top right, bottom right, bottom left) in image pixels.
export interface OcrLine { text: string; score: number; box: Point[] }
export type Model = (input: Float32Array, dims: number[]) => Promise<{ data: Float32Array; dims: readonly number[] }>;

const LINE_HEIGHT = 48, MAX_SIDE = 1920;

function sample(img: Raw, x: number, y: number, out: Float32Array, at: number, plane: number) {
  const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(x))), y0 = Math.max(0, Math.min(img.height - 1, Math.floor(y)));
  const x1 = Math.min(img.width - 1, x0 + 1), y1 = Math.min(img.height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0)), fy = Math.max(0, Math.min(1, y - y0));
  // The models take blue, green and red planes scaled to 0–1.
  for (let c = 0; c < 3; c++) {
    const p = (yy: number, xx: number) => img.data[(yy * img.width + xx) * 4 + 2 - c];
    const top = p(y0, x0) * (1 - fx) + p(y0, x1) * fx, bottom = p(y1, x0) * (1 - fx) + p(y1, x1) * fx;
    out[c * plane + at] = (top * (1 - fy) + bottom * fy) / 255;
  }
}

// Samples a w × h picture whose top left is origin and whose axes run along u and v (in source pixels per output pixel).
function picture(img: Raw, origin: Point, u: Point, v: Point, w: number, h: number): Float32Array {
  const out = new Float32Array(3 * w * h);
  for (let i = 0; i < h; i++) for (let j = 0; j < w; j++)
    sample(img, origin[0] + u[0] * (j + .5) + v[0] * (i + .5), origin[1] + u[1] * (j + .5) + v[1] * (i + .5), out, i * w + j, w * h);
  return out;
}

// Regions of the probability map above 0.3, each as a rotated rectangle grown by PaddleOCR's unclip ratio of 1.5.
function regions(map: Float32Array, width: number, height: number): { center: Point; angle: number; w: number; h: number }[] {
  const seen = new Uint8Array(width * height);
  const found = [];
  const stack: number[] = [];
  for (let start = 0; start < map.length; start++) {
    if (seen[start] || map[start] <= .3) continue;
    const pixels: number[] = [];
    seen[start] = 1; stack.push(start);
    while (stack.length) {
      const at = stack.pop()!; pixels.push(at);
      const x = at % width, y = (at - x) / width;
      for (const next of [x > 0 ? at - 1 : -1, x < width - 1 ? at + 1 : -1, y > 0 ? at - width : -1, y < height - 1 ? at + width : -1])
        if (next >= 0 && !seen[next] && map[next] > .3) { seen[next] = 1; stack.push(next); }
    }
    if (pixels.length < 12) continue;
    let sum = 0, cx = 0, cy = 0;
    for (const at of pixels) { sum += map[at]; cx += at % width; cy += Math.floor(at / width); }
    if (sum / pixels.length < .6) continue;
    cx /= pixels.length; cy /= pixels.length;
    let xx = 0, yy = 0, xy = 0;
    for (const at of pixels) { const dx = at % width - cx, dy = Math.floor(at / width) - cy; xx += dx * dx; yy += dy * dy; xy += dx * dy; }
    // Text runs left to right, so a region that looks steeper than 45° (a single tall character) is taken as level.
    let angle = .5 * Math.atan2(2 * xy, xx - yy);
    if (Math.abs(angle) > Math.PI / 4) angle = 0;
    const [ux, uy, vx, vy] = [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle)];
    let [u0, u1, v0, v1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const at of pixels) {
      const dx = at % width - cx, dy = Math.floor(at / width) - cy;
      const u = dx * ux + dy * uy, v = dx * vx + dy * vy;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const [w, h] = [u1 - u0 + 1, v1 - v0 + 1];
    const grow = w * h * 1.5 / (2 * (w + h));
    const [mu, mv] = [(u0 + u1) / 2, (v0 + v1) / 2];
    found.push({ center: [cx + ux * mu + vx * mv, cy + uy * mu + vy * mv] as Point, angle, w: w + 2 * grow, h: h + 2 * grow });
  }
  return found;
}

// CTC greedy decoding: index 0 is blank, repeats collapse, and the dictionary ends with a space.
function decode(probs: Float32Array, steps: number, classes: number, dictionary: string[]): { text: string; score: number } {
  let text = '', total = 0, count = 0, last = 0;
  for (let t = 0; t < steps; t++) {
    let best = 0, value = -Infinity;
    for (let c = 0; c < classes; c++) { const p = probs[t * classes + c]; if (p > value) { value = p; best = c; } }
    if (best !== 0 && best !== last) { text += dictionary[best - 1] ?? ''; total += value; count++; }
    last = best;
  }
  return { text, score: count ? total / count : 0 };
}

export async function recognize(img: Raw, detect: Model, read: Model, dictionary: string[]): Promise<OcrLine[]> {
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const [w, h] = [Math.max(32, Math.ceil(img.width * scale / 32) * 32), Math.max(32, Math.ceil(img.height * scale / 32) * 32)];
  const [sx, sy] = [img.width / w, img.height / h];
  const map = await detect(picture(img, [0, 0], [sx, 0], [0, sy], w, h), [1, 3, h, w]);
  const lines: OcrLine[] = [];
  for (const region of regions(map.data, w, h)) {
    // Back in source pixels: the region's axes, sizes and corners.
    const u: Point = [Math.cos(region.angle) * sx, Math.sin(region.angle) * sy];
    const v: Point = [-Math.sin(region.angle) * sx, Math.cos(region.angle) * sy];
    const [lu, lv] = [Math.hypot(...u) * region.w, Math.hypot(...v) * region.h];
    if (lv < 4) continue;
    const corner = (a: number, b: number): Point =>
      [region.center[0] * sx + u[0] * region.w * a + v[0] * region.h * b, region.center[1] * sy + u[1] * region.w * a + v[1] * region.h * b];
    const box = [corner(-.5, -.5), corner(.5, -.5), corner(.5, .5), corner(-.5, .5)];
    const width = Math.max(LINE_HEIGHT, Math.min(LINE_HEIGHT * 40, Math.round(LINE_HEIGHT * lu / lv)));
    const step = (d: Point, length: number, n: number): Point => [d[0] / Math.hypot(...d) * length / n, d[1] / Math.hypot(...d) * length / n];
    const out = await read(picture(img, box[0], step(u, lu, width), step(v, lv, LINE_HEIGHT), width, LINE_HEIGHT), [1, 3, LINE_HEIGHT, width]);
    const { text, score } = decode(out.data, out.dims[1], out.dims[2], dictionary);
    if (text.trim() && score >= .5) lines.push({ text: text.trim(), score, box });
  }
  return lines.sort((a, b) => a.box[0][1] - b.box[0][1] || a.box[0][0] - b.box[0][0]);
}

let loaded: Promise<(img: Raw) => Promise<OcrLine[]>> | null = null;

// The runtime and models (about 30 MB) load on first use and stay in the browser cache afterwards.
export function loadOcr(): Promise<(img: Raw) => Promise<OcrLine[]>> {
  loaded ??= (async () => {
    const [ort, { default: wasm }] = await Promise.all([import('onnxruntime-web/wasm'), import('onnxruntime-web/ort-wasm-simd-threaded.wasm?url')]);
    ort.env.wasm.wasmPaths = { wasm };
    ort.env.wasm.numThreads = 1;
    const base = `${import.meta.env.BASE_URL}ocr/`;
    const [det, rec, keys] = await Promise.all([ort.InferenceSession.create(`${base}det.onnx`), ort.InferenceSession.create(`${base}rec.onnx`),
      fetch(`${base}keys.txt`).then(r => { if (!r.ok) throw new Error('识别模型下载失败'); return r.text(); })]);
    const model = (session: typeof det): Model => async (input, dims) => {
      const output = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, dims) });
      const tensor = output[session.outputNames[0]];
      return { data: tensor.data as Float32Array, dims: tensor.dims };
    };
    const dictionary = [...keys.split('\n'), ' '];
    return (img: Raw) => recognize(img, model(det), model(rec), dictionary);
  })();
  loaded.catch(() => { loaded = null; });
  return loaded;
}

// A photo as pixels, shrunk so its long side is at most MAX_SIDE.
export async function readImage(file: Blob): Promise<Raw> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d')!;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

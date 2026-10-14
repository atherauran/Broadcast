import { DAY_PERIODS, pastedBirthdays, type Birthday, type Week } from './domain';
import type { OcrLine, Point } from './ocr';

// The subject comes from the code after each lesson (the school's timetables mark lessons taught by the English teacher "E",
// by the math teacher "M" and so on), not from its Chinese name.
const CODES: Record<string, string> = {
  CHN: 'chinese', ENG: 'english', E: 'english', MATH: 'math', M: 'math', PHY: 'physics', BIO: 'biology', CHE: 'chemistry', CHEM: 'chemistry',
  HIST: 'history', PE: 'pe', CIV: 'morality', ART: 'art', IT: 'it', OPT: 'elective', CLUB: 'club',
};

// One letter misread, added or dropped ("CHIN", "ENGG") still names the subject; short codes such as E and M must match exactly.
function subject(code: string): string | undefined {
  if (CODES[code]) return CODES[code];
  if (code.length < 3) return undefined;
  const close = Object.keys(CODES).filter(known => known.length >= 3 && distance(known, code) <= 1);
  return close.length === 1 ? CODES[close[0]] : undefined;
}

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

// Photos are seldom level: positions are turned by the typical slant of the text, so a row keeps one height across the page.
function leveler(lines: OcrLine[]) {
  const slopes = lines.map(l => l.box).filter(b => b[1][0] - b[0][0] > 40).map(b => (b[1][1] - b[0][1]) / (b[1][0] - b[0][0])).sort((a, b) => a - b);
  const slope = slopes.length ? slopes[Math.floor(slopes.length / 2)] : 0;
  return (box: Point[]) => {
    const [x, y] = [box.reduce((s, p) => s + p[0], 0) / 4, box.reduce((s, p) => s + p[1], 0) / 4];
    return { x: x + slope * y, y: y - slope * x, height: Math.hypot(box[3][0] - box[0][0], box[3][1] - box[0][1]) };
  };
}

const nearest = <T,>(items: T[], value: number, at: (item: T) => number) =>
  items.reduce((best, item) => Math.abs(at(item) - value) < Math.abs(at(best) - value) ? item : best);

// A photographed timetable: 星期一–星期五 across the top, 上午n / 下午n down the side, and lunch between morning and afternoon.
export function scheduleFromLines(lines: OcrLine[]): { week: Week; unknown: string[] } {
  const level = leveler(lines);
  const placed = lines.map(line => ({ text: line.text.replace(/\s+/g, ' ').trim(), ...level(line.box) }));
  const days = placed.filter(p => /^(星期|周)/.test(p.text) && !p.text.includes('节')).sort((a, b) => a.x - b.x);
  const rows = placed.flatMap(p => {
    const found = /^([上下])午\s*(\d+)/.exec(p.text);
    return found ? [{ ...p, afternoon: found[1] === '下', period: +found[2] }] : [];
  });
  if (days.length !== 5 || !rows.length) throw new Error('没有找到完整的课程表，请拍下整张表，包括星期和节次');
  const cells = new Map<string, string>();
  const unknown = new Set<string>();
  for (const p of placed) {
    const code = /([A-Za-z]+)$/.exec(p.text)?.[1].toUpperCase();
    if (!code || p.x < days[0].x - (days[1].x - days[0].x) / 2) continue;
    const id = subject(code);
    if (!id) { unknown.add(p.text); continue; }
    const row = nearest(rows, p.y, r => r.y);
    cells.set(`${days.indexOf(nearest(days, p.x, d => d.x))}/${row.afternoon ? 1 : 0}/${row.period}`, id);
  }
  const order = (afternoon: boolean) => [...new Set(rows.filter(r => r.afternoon === afternoon).map(r => r.period))].sort((a, b) => a - b);
  const week = days.map((_, day) => {
    const lessons = (afternoon: boolean) => order(afternoon).flatMap(n => cells.get(`${day}/${afternoon ? 1 : 0}/${n}`) ?? []);
    const [morning, afternoon] = [lessons(false), lessons(true)];
    return [...morning, ...(afternoon.length ? ['lunch'] : []), ...afternoon].slice(0, DAY_PERIODS);
  });
  if (week.every(day => !day.length)) throw new Error('没有识别出课程代号，请拍得更清楚一些');
  return { week, unknown: [...unknown] };
}

// A photographed birthday table: cells are grouped into rows and read like pasted spreadsheet rows.
// OCR may break a nickname into pieces ("Wi ll iam"), so short letter groups are joined back.
export function birthdaysFromLines(lines: OcrLine[]): Birthday[] {
  const level = leveler(lines);
  const placed = lines.map(line => ({ text: line.text.trim(), ...level(line.box) })).sort((a, b) => a.y - b.y);
  const rows: (typeof placed)[] = [];
  for (const p of placed) {
    const row = rows.at(-1);
    if (row && p.y - row[0].y < row[0].height * .6) row.push(p); else rows.push([p]);
  }
  const join = (text: string) => /^[A-Za-z ]+$/.test(text) && text.split(' ').some(part => part.length <= 2) ? text.replaceAll(' ', '') : text;
  return pastedBirthdays(rows.map(row => row.sort((a, b) => a.x - b.x).map(p => join(p.text)).join('\t')).join('\n'));
}

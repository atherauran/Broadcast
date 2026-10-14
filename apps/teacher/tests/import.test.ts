import { describe, expect, it } from 'vitest';
import { birthdaysFromLines, scheduleFromLines } from '../lib/import';
import schedulePhoto from './fixtures/schedule-photo.json';
import birthdayPhoto from './fixtures/birthday-photo.json';
import type { OcrLine } from '../lib/ocr';

// Both fixtures are the real recognition output for photos of 8-4's printed timetable and birthday list.
describe('reading photographed tables', () => {
  it('reads a timetable by lesson codes, with lunch after the morning', () => {
    const { week, unknown } = scheduleFromLines(schedulePhoto as OcrLine[]);
    expect(unknown).toEqual([]);
    expect(week).toEqual([
      ['morality', 'chinese', 'elective', 'math', 'lunch', 'biology', 'english', 'english', 'pe'],
      ['it', 'physics', 'english', 'english', 'lunch', 'chinese', 'pe', 'math', 'math'],
      ['chinese', 'chinese', 'math', 'pe', 'lunch', 'english', 'english', 'physics', 'biology', 'club'],
      ['chinese', 'english', 'english', 'pe', 'lunch', 'morality', 'physics', 'chemistry', 'math'],
      ['art', 'chinese', 'english', 'english', 'lunch', 'history', 'math'],
    ]);
  });
  it('accepts a code with one letter misread', () => {
    const lines = (schedulePhoto as OcrLine[]).map(l => ({ ...l, text: l.text.replace('语文 CHN', '语文 CHIN').replace('物理 PHY', '物理 PH') }));
    const { week, unknown } = scheduleFromLines(lines);
    expect(week[2].slice(0, 2)).toEqual(['chinese', 'chinese']);
    expect(unknown).toEqual(['物理 PH']);
  });
  it('refuses a picture without the timetable header', () => {
    expect(() => scheduleFromLines((schedulePhoto as OcrLine[]).filter(l => !l.text.startsWith('星期')))).toThrow('完整的课程表');
  });
  it('reads a birthday list row by row', () => {
    const rows = birthdaysFromLines(birthdayPhoto as OcrLine[]);
    expect(rows).toHaveLength(27);
    expect(rows[0]).toEqual({ name: '胡昊凯 Martin', date: '01-02' });
    expect(rows[3]).toEqual({ name: '徐一航 William', date: '12-01' });
    expect(rows.at(-1)).toEqual({ name: '许书杨 Sophia', date: '09-07' });
    expect(rows.map(r => r.date)).toEqual(['01-02', '03-12', '04-08', '12-01', '11-15', '10-27', '09-18', '10-15', '04-22', '09-10', '10-20', '08-26', '10-24',
      '10-31', '09-09', '12-12', '02-28', '05-29', '09-14', '09-08', '07-27', '03-13', '06-28', '07-09', '03-19', '02-20', '09-07']);
  });
});

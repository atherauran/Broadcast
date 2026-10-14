import { useState, type ClipboardEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BIRTHDAY_LIMIT, CLASSROOM_IDS, clockText, monthDays, pad, pastedBirthdays, type Birthday, type BirthdayList } from '@/lib/domain';
import { birthdaysFromLines } from '@/lib/import';
import { PhotoImport } from './photo-import';
import { classKey } from './schedule';

// A row as typed: month and day are free text until saved.
export interface BirthdayRow { name: string; month: string; day: string }
const blank: BirthdayRow = { name: '', month: '', day: '' };
const shown = (list: Birthday[]): BirthdayRow[] => list.map(s => ({ name: s.name, month: String(+s.date.slice(0, 2)), day: String(+s.date.slice(3)) }));
const number = (text: string, most: number) => /^\d{1,2}$/.test(text.trim()) && +text >= 1 && +text <= most ? +text : 0;
const month = (row: BirthdayRow) => number(row.month, 12);
// A day is checked against its month, or against 31 while the month is still wrong.
const day = (row: BirthdayRow) => number(row.day, monthDays(month(row) || 1));

// Unsaved lists live in the parent, so switching class or tab keeps them.
export function BirthdayEditor({ lists, drafts, setDrafts, now, ready, busy, onSave, onError }: {
  lists: BirthdayList[]; drafts: Record<string, BirthdayRow[]>; setDrafts: (update: (old: Record<string, BirthdayRow[]>) => Record<string, BirthdayRow[]>) => void;
  now: number; ready: boolean; busy: string; onSave: (classroom: string, students: Birthday[]) => Promise<boolean>; onError: (message: string) => void;
}) {
  const [classroom, setClassroom] = useState(() => localStorage.getItem(classKey) || '');
  const saved = lists.find(item => item.classroom_id === classroom);
  const savedList = saved?.students ?? [];
  // An empty class starts with one blank row, ready to type or paste into.
  const students = drafts[classroom] ?? (savedList.length ? shown(savedList) : [blank]);
  const named = students.filter(s => s.name.trim()).map(s => ({ name: s.name.trim(), date: month(s) && day(s) ? `${pad(month(s))}-${pad(day(s))}` : '' }));
  const valid = named.every(s => s.date);
  const dirty = JSON.stringify(named) !== JSON.stringify(savedList);
  const edit = (next: BirthdayRow[]) => setDrafts(old => ({ ...old, [classroom]: next }));
  const change = (index: number, patch: Partial<BirthdayRow>) => edit(students.map((old, at) => at === index ? { ...old, ...patch } : old));
  function pick(id: string) { setClassroom(id); localStorage.setItem(classKey, id); }
  // Several pasted lines replace this row and continue below it.
  function paste(index: number, e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text');
    if (!/[\r\n]/.test(text)) return;
    const rows = pastedBirthdays(text);
    e.preventDefault();
    if (!rows.length) { onError('没有识别到生日，请包含姓名和日期（如 2013/1/2）'); return; }
    const next = [...students.slice(0, index), ...shown(rows), ...students.slice(index + 1)];
    if (next.length > BIRTHDAY_LIMIT) onError(`每班最多 ${BIRTHDAY_LIMIT} 位，多余的已忽略`);
    edit(next.slice(0, BIRTHDAY_LIMIT));
  }
  async function save() {
    if (await onSave(classroom, named))
      setDrafts(old => { const rest = { ...old }; delete rest[classroom]; return rest; });
  }

  return <>
    <section className="section">
      <div className="section-heading">
        <h1>生日</h1>
        {classroom && <span className="muted">{saved ? `${saved.teacher_name} · ${clockText(saved.updated_at, now)} 更新` : '尚未设置'}</span>}
      </div>
      <div className="choice-row schedule-classes">
        {CLASSROOM_IDS.map(id => <button type="button" key={id} className={id === classroom ? 'active' : ''} aria-pressed={id === classroom} onClick={() => pick(id)}>{id}</button>)}
      </div>
    </section>
    {classroom && <section className="section composer">
      <div className="section-heading"><div className="heading-title"><h2>{classroom} 学生生日</h2><span className="heading-hint">可粘贴 Excel 或拍照识别</span></div>
        <span className="character-count">{students.length} / {BIRTHDAY_LIMIT}</span></div>
      <ol className="entry-list birthday-list">{students.map((student, index) => <li key={index} className="entry-row">
          <span className="entry-number">{index + 1}</span>
          <Input aria-label={`第 ${index + 1} 位姓名`} placeholder="姓名" maxLength={40} value={student.name}
            onChange={e => change(index, { name: e.target.value })} onPaste={e => paste(index, e)} />
          <span className="birthday-date">
            <Input aria-label={`第 ${index + 1} 位生日（月）`} inputMode="numeric" maxLength={2} value={student.month}
              className={student.name.trim() && !month(student) ? 'invalid' : ''} onChange={e => change(index, { month: e.target.value })} />月
            <Input aria-label={`第 ${index + 1} 位生日（日）`} inputMode="numeric" maxLength={2} value={student.day}
              className={student.name.trim() && !day(student) ? 'invalid' : ''} onChange={e => change(index, { day: e.target.value })} />日
          </span>
          <Button type="button" variant="ghost" className="icon-action" aria-label={`删除第 ${index + 1} 位`}
            onClick={() => edit(students.filter((_, at) => at !== index))}><X size={18} /></Button>
        </li>)}</ol>
      {students.length < BIRTHDAY_LIMIT && <Button type="button" variant="outline" className="action add-entry"
        onClick={() => edit([...students, blank])}><Plus size={17} />添加一位</Button>}
      <div className="composer-bottom">
        <span />
        <div className="send-actions">
          <PhotoImport disabled={!!busy} onError={onError} onLines={lines => {
            const rows = birthdaysFromLines(lines).slice(0, BIRTHDAY_LIMIT);
            if (rows.length) edit(shown(rows)); else onError('没有识别出生日，请拍清楚包含姓名和出生日期的表格');
          }} />
          <Button className="action primary" disabled={!ready || !!busy || !dirty || !valid} onClick={() => void save()}>
            {busy === 'birthdays' ? '保存中…' : `保存 ${classroom} 生日`}
          </Button>
        </div>
      </div>
    </section>}
  </>;
}

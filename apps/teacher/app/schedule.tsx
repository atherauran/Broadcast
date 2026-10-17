import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DAY_PERIODS, DUTY_LIMIT, SCHOOL_DAYS, SUBJECTS, clockText, dutyRows, emptyWeek, type Duty, type Schedule, type Timetable } from '@/lib/domain';
import { scheduleFromLines } from '@/lib/import';
import { PhotoImport } from './photo-import';

export const classKey = 'broadcast-schedule-class';
// Monday to Friday open on their own day; a weekend opens on Monday.
const thisSchoolDay = () => { const day = new Date().getDay(); return day >= 1 && day <= 5 ? day - 1 : 0; };

const blankDuty = (): Duty => ({ task: '', days: SCHOOL_DAYS.map(() => '') });

// Unsaved timetables live in the parent, so switching class or tab keeps them. Duty jobs are shared by the week; each day tab edits that day's names.
export function ScheduleEditor({ classes, schedules, drafts, setDrafts, now, ready, busy, onSave, onError }: {
  classes: string[]; schedules: Schedule[]; drafts: Record<string, Timetable>; setDrafts: (update: (old: Record<string, Timetable>) => Record<string, Timetable>) => void;
  now: number; ready: boolean; busy: string; onSave: (classroom: string, timetable: Timetable) => Promise<boolean>; onError: (message: string) => void;
}) {
  const [classroom, setClassroom] = useState(() => localStorage.getItem(classKey) || '');
  const [day, setDay] = useState(thisSchoolDay);
  const saved = schedules.find(item => item.classroom_id === classroom);
  const savedTable: Timetable = { days: saved?.days ?? emptyWeek(), duties: saved?.duties ?? [] };
  const table = drafts[classroom] ?? savedTable;
  const { days: week, duties } = table;
  const rows = dutyRows(duties);
  const valid = rows.every(duty => duty.task && Array.from(duty.task).length <= 10);
  const dirty = JSON.stringify({ days: week, duties: rows }) !== JSON.stringify(savedTable);
  const periods = week[day];
  const change = (next: Partial<Timetable>) => setDrafts(old => ({ ...old, [classroom]: { ...table, ...next } }));
  const edit = (next: string[]) => change({ days: week.map((list, at) => at === day ? next : list) });
  const editDuty = (index: number, next: Duty) => change({ duties: duties.map((old, at) => at === index ? next : old) });
  function pick(id: string) { setClassroom(id); localStorage.setItem(classKey, id); }
  // A photographed week replaces all five days of this class's draft.
  function imported(lines: Parameters<typeof scheduleFromLines>[0]) {
    const { week: read, unknown } = scheduleFromLines(lines);
    change({ days: read });
    if (unknown.length) onError(`这些课没有认出科目，已跳过，请手动补上：${unknown.join('、')}`);
  }
  async function save() {
    if (await onSave(classroom, { days: week, duties: rows })) setDrafts(old => { const rest = { ...old }; delete rest[classroom]; return rest; });
  }

  return <>
    <section className="section">
      <div className="section-heading">
        <h1>课程表</h1>
        {classroom && <span className="muted">{saved ? `${saved.teacher_name} · ${clockText(saved.updated_at, now)} 更新` : '尚未设置'}</span>}
      </div>
      <div className="choice-row schedule-classes">
        {classes.map(id => <button type="button" key={id} className={id === classroom ? 'active' : ''} aria-pressed={id === classroom} onClick={() => pick(id)}>{id}</button>)}
      </div>
    </section>
    {classroom && <section className="section composer">
      <div className="day-tabs" aria-label="星期">{SCHOOL_DAYS.map((label, at) => <button type="button" key={label} className={at === day ? 'active' : ''}
        aria-pressed={at === day} onClick={() => setDay(at)}>{label}<small>{week[at].length ? `${week[at].length} 节` : '空'}</small></button>)}</div>
      <ol className="entry-list period-list">{periods.map((id, index) => <li key={index} className="entry-row">
        <span className="entry-number">{index + 1}</span>
        <select className="period-select" aria-label={`第 ${index + 1} 节`} value={id}
          onChange={e => edit(periods.map((old, at) => at === index ? e.target.value : old))}>
          {SUBJECTS.map(subject => <option key={subject.id} value={subject.id}>{subject.label}</option>)}
        </select>
        <Button type="button" variant="ghost" className="icon-action" aria-label={`删除第 ${index + 1} 节`}
          onClick={() => edit(periods.filter((_, at) => at !== index))}><X size={18} /></Button>
      </li>)}</ol>
      <div className="subject-grid">{SUBJECTS.map(subject => <button type="button" key={subject.id} className={subject.id === 'lunch' ? 'lunch' : ''}
        disabled={periods.length >= DAY_PERIODS} onClick={() => edit([...periods, subject.id])}><Plus size={15} />{subject.label}</button>)}</div>
      <div className="section-heading duty-heading"><h2>{SCHOOL_DAYS[day]}值日生</h2></div>
      <ol className="entry-list duty-list">{duties.map((duty, index) => <li key={index} className="entry-row">
        <Input aria-label={`第 ${index + 1} 项值日`} placeholder="任务" maxLength={10} value={duty.task}
          className={'duty-task' + (!duty.task.trim() && duty.days.some(name => name.trim()) ? ' invalid' : '')}
          onChange={e => editDuty(index, { ...duty, task: e.target.value })} />
        <Input aria-label={`${SCHOOL_DAYS[day]}${duty.task || `第 ${index + 1} 项`}值日生`} placeholder="姓名" maxLength={40} value={duty.days[day]}
          onChange={e => editDuty(index, { ...duty, days: duty.days.map((name, at) => at === day ? e.target.value : name) })} />
        <Button type="button" variant="ghost" className="icon-action" aria-label={`删除第 ${index + 1} 项值日`}
          onClick={() => change({ duties: duties.filter((_, at) => at !== index) })}><X size={18} /></Button>
      </li>)}</ol>
      {duties.length < DUTY_LIMIT && <Button type="button" variant="outline" className="action add-entry"
        onClick={() => change({ duties: [...duties, blankDuty()] })}><Plus size={17} />添加一项</Button>}
      <div className="composer-bottom">
        <span />
        <div className="send-actions">
          <PhotoImport disabled={!!busy} onError={onError} onLines={lines => { try { imported(lines); } catch (e) { onError((e as Error).message); } }} />
          <Button className="action primary" disabled={!ready || !!busy || !dirty || !valid} onClick={() => void save()}>
            {busy === 'schedule' ? '保存中…' : `保存 ${classroom} 课表/值日`}
          </Button>
        </div>
      </div>
    </section>}
  </>;
}

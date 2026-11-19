import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DAY_PERIODS, DUTY_LIMIT, SCHOOL_DAYS, clockText, dutyRows, emptyWeek, type Duty, type Schedule, type Subject, type Timetable } from '@/lib/domain';
import { scheduleFromLines } from '@/lib/import';
import { PhotoImport } from './photo-import';

// Monday to Friday open on their own day; a weekend opens on Monday.
const thisSchoolDay = () => { const day = new Date().getDay(); return day >= 1 && day <= 5 ? day - 1 : 0; };

const blankDuty = (): Duty => ({ task: '', days: SCHOOL_DAYS.map(() => '') });

// Unsaved timetables live in the parent, so switching class or tab keeps them. Duty jobs are shared by the week; each day tab edits that day's names.
export function ScheduleEditor({ classroom, schedules, subjects, drafts, setDrafts, now, ready, busy, onSave, onAddSubject, onDeleteSubject, onError }: {
  classroom: string; schedules: Schedule[]; subjects: Subject[]; drafts: Record<string, Timetable>;
  setDrafts: (update: (old: Record<string, Timetable>) => Record<string, Timetable>) => void;
  now: number; ready: boolean; busy: string; onSave: (classroom: string, timetable: Timetable) => Promise<boolean>;
  // A new subject joins the shared list for every teacher; the id comes back, or '' when it could not be added.
  onAddSubject: (label: string, rest: boolean) => Promise<string>; onDeleteSubject: (id: string) => Promise<boolean>; onError: (message: string) => void;
}) {
  const [day, setDay] = useState(thisSchoolDay);
  const [name, setName] = useState('');
  const [rest, setRest] = useState(false);
  const saved = schedules.find(item => item.classroom_id === classroom);
  const savedTable: Timetable = { days: saved?.days ?? emptyWeek(), duties: saved?.duties ?? [] };
  const table = drafts[classroom] ?? savedTable;
  const { days: week, duties } = table;
  const rows = dutyRows(duties);
  const valid = rows.every(duty => duty.task && Array.from(duty.task).length <= 10);
  // The database returns each job as {days, task} (jsonb sorts keys), so the saved side goes through dutyRows too before comparing.
  const dirty = JSON.stringify({ days: week, duties: rows }) !== JSON.stringify({ days: savedTable.days, duties: dutyRows(savedTable.duties) });
  const periods = week[day];
  // Rest rows (lunch) are not lessons: they take no number and do not count toward the day.
  const isRest = (id: string) => !!subjects.find(subject => subject.id === id)?.rest;
  const lessonCount = (ids: string[]) => ids.filter(id => !isRest(id)).length;
  let lesson = 0;
  const numbers = periods.map(id => isRest(id) ? '' : ++lesson);
  const change = (next: Partial<Timetable>) => setDrafts(old => ({ ...old, [classroom]: { ...table, ...next } }));
  const edit = (next: string[]) => change({ days: week.map((list, at) => at === day ? next : list) });
  const editDuty = (index: number, next: Duty) => change({ duties: duties.map((old, at) => at === index ? next : old) });
  // A photographed week replaces all five days of this class's draft.
  function imported(lines: Parameters<typeof scheduleFromLines>[0]) {
    const { week: read, unknown } = scheduleFromLines(lines);
    change({ days: read });
    if (unknown.length) onError(`这些课没有认出科目，已跳过，请手动补上：${unknown.join('、')}`);
  }
  // An existing subject with the same name is used as it is; otherwise the name joins the shared list first.
  async function addNamed() {
    const label = name.trim().replace(/\s+/g, ' ');
    if (!label || periods.length >= DAY_PERIODS) return;
    const existing = subjects.find(subject => [subject.id, subject.label].some(text => text.toLowerCase() === label.toLowerCase()));
    const id = existing?.id ?? await onAddSubject(label, rest);
    if (!id) return;
    edit([...periods, id]); setName(''); setRest(false);
  }
  async function save() {
    if (await onSave(classroom, { days: week, duties: rows })) setDrafts(old => { const rest = { ...old }; delete rest[classroom]; return rest; });
  }

  return <section className="section composer">
      <div className="section-heading">
        <h2>{classroom} 课表/值日</h2>
        <span className="muted">{saved ? `${saved.teacher_name} 于 ${clockText(saved.updated_at, now)} 更新` : '尚未设置'}</span>
      </div>
      <div className="day-tabs" aria-label="星期">{SCHOOL_DAYS.map((label, at) => <button type="button" key={label} className={at === day ? 'active' : ''}
        aria-pressed={at === day} onClick={() => setDay(at)}>{label}<small>{lessonCount(week[at]) ? `${lessonCount(week[at])} 节` : '空'}</small></button>)}</div>
      <ol className="entry-list period-list">{periods.map((id, index) => <li key={index} className="entry-row">
        <span className="entry-number">{numbers[index]}</span>
        <select className="period-select" aria-label={`第 ${index + 1} 节`} value={id}
          onChange={e => edit(periods.map((old, at) => at === index ? e.target.value : old))}>
          {subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.label}</option>)}
        </select>
        <Button type="button" variant="ghost" className="icon-action" aria-label={`删除第 ${index + 1} 节`}
          onClick={() => edit(periods.filter((_, at) => at !== index))}><X size={18} /></Button>
      </li>)}</ol>
      <div className="subject-grid">{subjects.map(subject => <div key={subject.id} className="subject-item">
        <button type="button" className={subject.rest ? 'lunch' : ''} disabled={periods.length >= DAY_PERIODS} onClick={() => edit([...periods, subject.id])}><Plus size={15} />{subject.label}</button>
        {!subject.builtin && <button type="button" className="subject-delete" aria-label={`删除课程 ${subject.label}`} disabled={!ready || !!busy} onClick={() => void onDeleteSubject(subject.id)}><X size={14} /></button>}
      </div>)}</div>
      <form className="subject-add" onSubmit={e => { e.preventDefault(); void addNamed(); }}>
        <Input aria-label="新课程名称" placeholder="添加上面没有的课" maxLength={12} value={name} onChange={e => setName(e.target.value)} />
        <label><input type="checkbox" checked={rest} onChange={e => setRest(e.target.checked)} />休息（不占节次）</label>
        <Button type="submit" variant="outline" className="action" disabled={!ready || !!busy || !name.trim() || periods.length >= DAY_PERIODS}><Plus size={17} />添加</Button>
      </form>
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
    </section>;
}

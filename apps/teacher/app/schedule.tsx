import { useState } from 'react';
import { ChevronRight, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CLASSROOM_IDS, DAY_PERIODS, SCHOOL_DAYS, SUBJECTS, clockText, emptyWeek, type Schedule, type Week } from '@/lib/domain';

const classKey = 'broadcast-schedule-class';
// Monday to Friday open on their own day; a weekend opens on Monday.
const thisSchoolDay = () => { const day = new Date().getDay(); return day >= 1 && day <= 5 ? day - 1 : 0; };

// Unsaved weeks live in the parent, so switching class or tab keeps them.
export function ScheduleEditor({ schedules, drafts, setDrafts, now, ready, busy, onSave }: {
  schedules: Schedule[]; drafts: Record<string, Week>; setDrafts: (update: (old: Record<string, Week>) => Record<string, Week>) => void;
  now: number; ready: boolean; busy: string; onSave: (classroom: string, days: Week) => Promise<boolean>;
}) {
  const [classroom, setClassroom] = useState(() => localStorage.getItem(classKey) || '');
  const [day, setDay] = useState(thisSchoolDay);
  const saved = schedules.find(item => item.classroom_id === classroom);
  const savedWeek = saved?.days ?? emptyWeek();
  const week = drafts[classroom] ?? savedWeek;
  const dirty = JSON.stringify(week) !== JSON.stringify(savedWeek);
  const periods = week[day];
  const edit = (next: string[]) => setDrafts(old => ({ ...old, [classroom]: week.map((list, at) => at === day ? next : list) }));
  function pick(id: string) { setClassroom(id); localStorage.setItem(classKey, id); }
  async function save() {
    if (await onSave(classroom, week)) setDrafts(old => { const rest = { ...old }; delete rest[classroom]; return rest; });
  }

  return <>
    <section className="section">
      <div className="section-heading">
        <h1>课程表</h1>
        {classroom && <span className="muted">{saved ? `${saved.teacher_name} · ${clockText(saved.updated_at, now)} 更新` : '尚未设置'}</span>}
      </div>
      <div className="choice-row schedule-classes">
        {CLASSROOM_IDS.map(id => <button type="button" key={id} className={id === classroom ? 'active' : ''} aria-pressed={id === classroom} onClick={() => pick(id)}>{id}</button>)}
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
      <div className="composer-bottom">
        <span>{day < SCHOOL_DAYS.length - 1 &&
          <Button type="button" variant="outline" className="action" onClick={() => setDay(day + 1)}>{SCHOOL_DAYS[day + 1]}<ChevronRight size={17} /></Button>}</span>
        <div className="send-actions">
          <Button className="action primary" disabled={!ready || !!busy || !dirty} onClick={() => void save()}>
            {busy === 'schedule' ? '保存中…' : `保存 ${classroom} 课程表`}
          </Button>
        </div>
      </div>
    </section>}
  </>;
}

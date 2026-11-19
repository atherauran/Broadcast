import { useState } from 'react';
import { Clock, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { BELL_LIMIT, SCHOOL_DAYS, bellsError, pad, shiftBells, type Bells } from '@/lib/domain';

const thisSchoolDay = () => { const day = new Date().getDay(); return day >= 1 && day <= 5 ? day - 1 : 0; };

// The whole grade's lesson times. Changing a start moves that lesson and the ones after it; changing an end only that lesson.
export function BellEditor({ bells, ready, busy, onSave }: { bells: Bells; ready: boolean; busy: string; onSave: (days: Bells) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Bells>(bells);
  const [day, setDay] = useState(thisSchoolDay);
  const lessons = draft[day];
  const set = (next: string[]) => setDraft(old => old.map((list, at) => at === day ? next : list));
  const invalid = bellsError(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(bells);
  const last = lessons.at(-1)?.slice(6);
  // The next lesson starts 15 minutes after the last ends and lasts 40.
  const next = (() => {
    const from = last ? +last.slice(0, 2) * 60 + +last.slice(3) + 15 : 8 * 60 + 30;
    return from + 40 < 1440 ? `${pad(Math.floor(from / 60))}:${pad(from % 60)}-${pad(Math.floor((from + 40) / 60))}:${pad((from + 40) % 60)}` : '';
  })();
  const setStart = (at: number, value: string) => { if (value) { const moved = shiftBells(lessons, at, value); if (moved) set(moved); } };
  const setEnd = (at: number, value: string) => { if (value) set(lessons.map((range, index) => index === at ? `${range.slice(0, 5)}-${value}` : range)); };
  async function save() { if (await onSave(draft)) setOpen(false); }

  return <>
    <Button type="button" variant="outline" className="action" disabled={!ready} onClick={() => { setDraft(bells); setOpen(true); }}><Clock size={17} />作息时间</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="template-card edit-card" showCloseButton={false}>
        <div className="section-heading"><DialogTitle>作息时间（全年级）</DialogTitle></div>
        <div className="day-tabs" aria-label="星期">{SCHOOL_DAYS.map((label, at) => <button type="button" key={label} className={at === day ? 'active' : ''}
          aria-pressed={at === day} onClick={() => setDay(at)}>{label}</button>)}</div>
        <ol className="entry-list period-list">{lessons.map((range, at) => <li key={at} className="entry-row bell-row">
          <span className="entry-number">{at + 1}</span>
          <input type="time" aria-label={`第 ${at + 1} 节上课`} value={range.slice(0, 5)} onChange={e => setStart(at, e.target.value)} />
          <span>–</span>
          <input type="time" aria-label={`第 ${at + 1} 节下课`} value={range.slice(6)} className={range.slice(0, 5) >= range.slice(6) ? 'invalid' : ''} onChange={e => setEnd(at, e.target.value)} />
          <Button type="button" variant="ghost" className="icon-action" aria-label={`删除第 ${at + 1} 节`} onClick={() => set(lessons.filter((_, index) => index !== at))}><X size={18} /></Button>
        </li>)}</ol>
        <div className="bell-actions">
          <Button type="button" variant="outline" className="action" disabled={lessons.length >= BELL_LIMIT || !next} onClick={() => set([...lessons, next])}><Plus size={17} />添加一节</Button>
          <Button type="button" variant="outline" className="action" disabled={!lessons.length} onClick={() => setDraft(old => old.map(() => lessons))}>复制到其他日</Button>
        </div>
        {invalid && <p className="muted">每节需先上课后下课，且不能早于上一节的下课时间</p>}
        <p className="muted">休息（如午餐）不占节次，时间自动取前后两节之间。</p>
        <div className="confirm-actions">
          <DialogClose className="action" render={<Button variant="outline" />}>取消</DialogClose>
          <Button className="action primary" disabled={!ready || !!busy || !dirty || invalid} onClick={() => void save()}>{busy === 'bells' ? '保存中…' : '保存作息时间'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}

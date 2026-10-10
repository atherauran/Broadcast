import { useState } from 'react';
import { Check, ChevronRight, ClipboardList, StickyNote, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { clockText, daysUntil, isOnline, remaining, type Classroom, type DisplayItem } from '@/lib/domain';
import { roomStatus } from './class-picker';

const icons = { board: ClipboardList, note: StickyNote, countdown: Timer };
const kindLabel = { board: '公告板', note: '便签', countdown: '倒计时' };

function summary(item: DisplayItem, now: number): string {
  if (item.kind === 'board') return `${item.content.title} · ${item.content.entries.length} 条`;
  if (item.kind === 'note') return item.content.text;
  const label = item.content.label || '倒计时';
  if (item.content.date) { const days = daysUntil(item.content.date, now); return `${label} · ${days ? `还有 ${days} 天` : '就是今天'}`; }
  return `${label} · 剩余 ${remaining(Date.parse(item.ends_at) - now)}`;
}

// Items are ticked, possibly across classes, and removed together from the bar that appears at the bottom.
export function OnScreen({ items, rooms, known, now, ready, busy, onRemove }: {
  items: DisplayItem[]; rooms: Classroom[]; known: boolean; now: number; ready: boolean; busy: string;
  onRemove: (ids: string[]) => Promise<boolean>;
}) {
  const [open, setOpen] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const live = items.filter(item => Date.parse(item.ends_at) > now);
  // Items that ended or were removed elsewhere drop out of the selection on their own.
  const selected = picked.filter(id => live.some(item => item.id === id));
  const toggle = (ids: string[], on: boolean) => setPicked(old => on ? [...new Set([...old, ...ids])] : old.filter(id => !ids.includes(id)));
  async function remove() { if (await onRemove(selected)) setPicked([]); }

  return <section className="history-section">
    <div className="section-heading"><h1>正在显示</h1><span className="muted">公告板、便签和倒计时</span></div>
    {rooms.map(room => {
      const own = live.filter(item => item.classroom_id === room.id);
      const expanded = own.length > 0 && open.includes(room.id);
      return <article key={room.id} className="screen-card">
        <button className="screen-heading" aria-expanded={expanded} disabled={!own.length}
          onClick={() => setOpen(old => old.includes(room.id) ? old.filter(id => id !== room.id) : [...old, room.id])}>
          <span className="screen-room">
            <strong>{room.id}</strong>
            <span className="class-status"><span className={'tiny-dot ' + (known && isOnline(room, now) ? 'online' : '')} />{roomStatus(room, known, now)}</span>
          </span>
          <span className="screen-count">{own.length ? <>{own.length} 项<ChevronRight size={17} className={expanded ? 'rotated' : ''} /></> : '没有显示内容'}</span>
        </button>
        {expanded && <div className="screen-items">{own.map(item => {
          const Icon = icons[item.kind];
          const on = selected.includes(item.id);
          const siblings = live.filter(other => other.request_id === item.request_id).map(other => other.id);
          const allSiblings = siblings.every(id => selected.includes(id));
          return <div key={item.id} className={'screen-item' + (on ? ' selected' : '')}>
            <button type="button" className="screen-select" aria-pressed={on} onClick={() => toggle([item.id], !on)}>
              <span className="select-mark">{on && <Check size={14} strokeWidth={3} />}</span>
              <span className={'screen-icon ' + (item.kind === 'note' ? 'note-' + item.content.color : '')}><Icon size={18} /></span>
              <span className="screen-text">
                <span className="screen-summary">{summary(item, now)}</span>
                <span className="muted">{kindLabel[item.kind]} · {item.teacher_name} · 至 {clockText(item.ends_at, now)}</span>
              </span>
            </button>
            {siblings.length > 1 && <button type="button" className="screen-siblings" aria-pressed={allSiblings} onClick={() => toggle(siblings, !allSiblings)}>
              {allSiblings ? '取消' : '选中'}全部 {siblings.length} 个班级
            </button>}
          </div>;
        })}</div>}
      </article>;
    })}
    {selected.length > 0 && <div className="selection-bar">
      <span>已选择 <strong>{selected.length}</strong> 项</span>
      <Button variant="outline" className="action" onClick={() => setPicked([])}>取消</Button>
      <Button className="action primary" disabled={!ready || !!busy} onClick={() => void remove()}>{busy === 'remove' ? '移除中…' : '移除'}</Button>
    </div>}
  </section>;
}

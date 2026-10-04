import { useState } from 'react';
import { ChevronRight, ClipboardList, StickyNote, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { clockText, isOnline, remaining, type Classroom, type DisplayItem } from '@/lib/domain';
import { roomStatus } from './class-picker';

const icons = { board: ClipboardList, note: StickyNote, countdown: Timer };
const kindLabel = { board: '公告板', note: '便签', countdown: '倒计时' };

function summary(item: DisplayItem, now: number): string {
  if (item.kind === 'board') return `${item.content.title} · ${item.content.entries.length} 条`;
  if (item.kind === 'note') return item.content.text;
  return `${item.content.label || '倒计时'} · 剩余 ${remaining(Date.parse(item.ends_at) - now)}`;
}

export function OnScreen({ items, rooms, known, now, ready, busy, onRemove }: {
  items: DisplayItem[]; rooms: Classroom[]; known: boolean; now: number; ready: boolean; busy: string;
  onRemove: (item: DisplayItem, all: boolean) => Promise<unknown>;
}) {
  const [open, setOpen] = useState<string[]>([]);
  const live = items.filter(item => Date.parse(item.ends_at) > now);
  return <section className="history-section"><div className="section-heading"><h1>正在显示</h1><span className="muted">公告板、便签和倒计时</span></div>
    {rooms.map(room => {
      const own = live.filter(item => item.classroom_id === room.id);
      const expanded = own.length > 0 && open.includes(room.id);
      return <article key={room.id} className="screen-card">
        <button className="screen-heading" aria-expanded={expanded} disabled={!own.length}
          onClick={() => setOpen(old => old.includes(room.id) ? old.filter(id => id !== room.id) : [...old, room.id])}>
          <span className="screen-room"><strong>{room.id}</strong><span className="class-status"><span className={'tiny-dot ' + (known && isOnline(room, now) ? 'online' : '')} />{roomStatus(room, known, now)}</span></span>
          <span className="screen-count">{own.length ? <>{own.length} 项<ChevronRight size={17} className={expanded ? 'rotated' : ''} /></> : '没有显示内容'}</span>
        </button>
        {expanded && <div className="screen-items">{own.map(item => {
          const Icon = icons[item.kind];
          const siblings = live.filter(other => other.request_id === item.request_id).length;
          return <div key={item.id} className="screen-item">
            <span className={'screen-icon ' + (item.kind === 'note' ? 'note-' + item.content.color : '')}><Icon size={18} /></span>
            <div className="screen-text"><p>{summary(item, now)}</p>
              <span className="muted">{kindLabel[item.kind]} · {item.teacher_name} · 至 {clockText(item.ends_at, now)}</span></div>
            <span className="screen-actions">
              <Button variant="outline" className="action" disabled={!ready || !!busy} onClick={() => void onRemove(item, false)}>移除</Button>
              {siblings > 1 && <Button variant="outline" className="action" disabled={!ready || !!busy} onClick={() => void onRemove(item, true)}>从 {siblings} 个班级移除</Button>}
            </span>
          </div>;
        })}</div>}
      </article>;
    })}
  </section>;
}

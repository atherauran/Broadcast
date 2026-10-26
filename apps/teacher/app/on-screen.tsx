import { useState } from 'react';
import { Check, ChevronRight, ClipboardList, StickyNote, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { clockText, daysUntil, isOnline, remaining, sameContent, upcoming, type Classroom, type DisplayItem } from '@/lib/domain';
import { roomStatus } from './class-picker';
import { EditItem } from './edit-item';

const icons = { board: ClipboardList, note: StickyNote, countdown: Timer };
const kindLabel = { board: '公告板', note: '便签', countdown: '倒计时' };

function summary(item: DisplayItem, now: number): string {
  if (item.kind === 'board') return `${item.content.title} · ${item.content.entries.length} 条`;
  if (item.kind === 'note') return item.content.text;
  const label = item.content.label || '倒计时';
  if (item.content.date) { const days = daysUntil(item.content.date, now); return `${label} · ${days ? `还有 ${days} 天` : '就是今天'}`; }
  return `${label} · 剩余 ${remaining(Date.parse(item.ends_at) - now)}`;
}

// Sends the ticked items, with their start and end, to the classes picked here.
function CopyItems({ classes, count, busy, ready, onClose, onCopy }: {
  classes: string[]; count: number; busy: string; ready: boolean; onClose: () => void; onCopy: (classrooms: string[]) => void;
}) {
  const [targets, setTargets] = useState<string[]>([]);
  const toggle = (id: string) => setTargets(old => old.includes(id) ? old.filter(other => other !== id) : [...old, id]);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="template-card" showCloseButton={false}>
      <DialogTitle>复制 {count} 项到</DialogTitle>
      <div className="class-grid copy-targets">{classes.map(id => {
        const on = targets.includes(id);
        return <button key={id} type="button" className={'class-card ' + (on ? 'selected' : '')} aria-label={id} aria-pressed={on} onClick={() => toggle(id)}>
          <span className="class-top"><span className="class-number">{id}</span><span className="selection-mark">{on && <Check size={15} strokeWidth={3} />}</span></span>
        </button>;
      })}</div>
      <div className="confirm-actions">
        <DialogClose className="action" render={<Button variant="outline" />}>取消</DialogClose>
        <Button className="action primary" disabled={!ready || !!busy || !targets.length} onClick={() => onCopy(targets.toSorted())}>
          {busy === 'copy' ? '复制中…' : '复制'}
        </Button>
      </div>
    </DialogContent>
  </Dialog>;
}

// Items are ticked, possibly across classes, and removed, edited or copied together from the bar that appears at the bottom.
export function OnScreen({ items, rooms, classes, known, now, ready, busy, onRemove, onEdit, onCopy, onError }: {
  items: DisplayItem[]; rooms: Classroom[]; classes: string[]; known: boolean; now: number; ready: boolean; busy: string;
  onRemove: (ids: string[]) => Promise<boolean>; onEdit: (ids: string[], content: object, endsAt: string) => Promise<boolean>;
  onCopy: (ids: string[], classrooms: string[]) => Promise<boolean>; onError: (message: string) => void;
}) {
  const [open, setOpen] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [copying, setCopying] = useState(false);
  // Scheduled boards that have not appeared yet are listed with the board drafts instead; scheduled notes are listed here.
  const live = items.filter(item => !(item.kind === 'board' && upcoming(item, now)) && Date.parse(item.ends_at) > now);
  // Items that ended or were removed elsewhere drop out of the selection on their own.
  const selected = picked.filter(id => live.some(item => item.id === id));
  const chosen = live.filter(item => selected.includes(item.id));
  // Only items showing the same thing, such as one board sent to several classes, can be edited together.
  const editable = chosen.length > 0 && chosen.every(item => item.kind === chosen[0].kind && sameContent(item.content, chosen[0].content));
  const toggle = (ids: string[], on: boolean) => setPicked(old => on ? [...new Set([...old, ...ids])] : old.filter(id => !ids.includes(id)));
  async function remove() { if (await onRemove(selected)) setPicked([]); }
  async function edit(content: object, endsAt: string) { if (await onEdit(selected, content, endsAt)) { setEditing(false); setPicked([]); } }
  async function copy(classrooms: string[]) { if (await onCopy(selected, classrooms)) { setCopying(false); setPicked([]); } }

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
                <span className="muted">{kindLabel[item.kind]} · {item.teacher_name} · {upcoming(item, now) &&
                  <span className="blue">{clockText(item.starts_at, now)} 发布 · </span>}至 {clockText(item.ends_at, now)}</span>
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
      {editable && <Button variant="outline" className="action" disabled={!ready || !!busy} onClick={() => setEditing(true)}>编辑</Button>}
      <Button variant="outline" className="action" disabled={!ready || !!busy} onClick={() => setCopying(true)}>复制</Button>
      <Button className="action primary" disabled={!ready || !!busy} onClick={() => void remove()}>{busy === 'remove' ? '移除中…' : '移除'}</Button>
    </div>}
    {copying && <CopyItems classes={classes} count={new Set(chosen.map(item => item.request_id)).size} busy={busy} ready={ready} onClose={() => setCopying(false)} onCopy={classrooms => void copy(classrooms)} />}
    {editing && editable && <EditItem item={chosen[0]} now={now} ready={ready} busy={busy} onClose={() => setEditing(false)} onSave={edit} onError={onError} />}
  </section>;
}

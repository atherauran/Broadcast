import { Check, Square } from 'lucide-react';
import { CLASSROOM_IDS, isOnline, type Classroom } from '@/lib/domain';

export function roomStatus(room: Classroom, known: boolean, now: number): string {
  if (!known) return '状态待确认';
  return isOnline(room, now) ? '在线' : room.device_id ? '离线' : '离线 · 未绑定';
}

export function ClassPicker({ rooms, known, now, selected, setSelected }: {
  rooms: Classroom[]; known: boolean; now: number; selected: string[]; setSelected: (update: (old: string[]) => string[]) => void;
}) {
  return <section className="section classrooms-section"><div className="section-heading"><div><h1>选择班级</h1><p className="muted">{known ? rooms.filter(r => isOnline(r, now)).length + ' / 6 个班级在线' : '8 年级 · 共 6 个班级'}</p></div>
    <button className="select-all" onClick={() => setSelected(old => old.length === 6 ? [] : [...CLASSROOM_IDS])}>{selected.length === 6 ? <Check size={17} /> : <Square size={17} />}{selected.length === 6 ? '取消全选' : '全选'}</button></div>
    <div className="class-grid">{rooms.map(room => <button key={room.id} className={'class-card ' + (selected.includes(room.id) ? 'selected' : '')} aria-pressed={selected.includes(room.id)} onClick={() => setSelected(old => old.includes(room.id) ? old.filter(id => id !== room.id) : [...old, room.id])}>
      <span className="class-top"><span className="class-number">{room.id}</span><span className="selection-mark">{selected.includes(room.id) && <Check size={15} strokeWidth={3} />}</span></span>
      <span className="class-status"><span className={'tiny-dot ' + (known && isOnline(room, now) ? 'online' : '')} />{roomStatus(room, known, now)}</span>
    </button>)}</div>
  </section>;
}

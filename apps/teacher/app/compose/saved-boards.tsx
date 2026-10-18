import { useState } from 'react';
import { CalendarClock, ChevronRight, FileText, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { clockText, type SavedBoard } from '@/lib/domain';

// Scheduled boards first, by the time they appear, then drafts; picking one loads it into the composer above.
// Other teachers' boards stay folded below, still reachable after a teacher signs in under another name.
export function SavedBoards({ boards, teacher, editing, now, ready, busy, onOpen, onDelete }: {
  boards: SavedBoard[]; teacher: string; editing: string | null; now: number; ready: boolean; busy: string;
  onOpen: (board: SavedBoard) => void; onDelete: (id: string) => void;
}) {
  const [othersOpen, setOthersOpen] = useState(false);
  const others = boards.filter(board => board.teacher_name !== teacher);
  const row = (board: SavedBoard) => {
      const Icon = board.publish_at ? CalendarClock : FileText;
      return <div key={board.id} className={'saved-row' + (board.id === editing ? ' selected' : '')}>
        <button type="button" className="screen-select" onClick={() => onOpen(board)}>
          <span className="screen-icon"><Icon size={18} /></span>
          <span className="screen-text">
            <span className="screen-summary">{board.content.title} · {board.content.entries[0]}</span>
            <span className="muted">
              {board.publish_at ? <span className="blue">{clockText(board.publish_at, now)} 发布</span> : '草稿'}
              {' · '}{board.classrooms.length ? board.classrooms.toSorted().join('、') : '未选班级'} · {board.teacher_name}
            </span>
          </span>
        </button>
        <Button variant="ghost" className="icon-action" aria-label="删除" disabled={!ready || !!busy} onClick={() => onDelete(board.id)}><Trash2 size={18} /></Button>
      </div>;
  };
  return <section className="section">
    <div className="section-heading"><h2>草稿与定时公告</h2></div>
    <div className="saved-list">
      {boards.filter(board => board.teacher_name === teacher).map(row)}
      {others.length > 0 && <div className="saved-row">
        <button type="button" className="screen-select saved-others" aria-expanded={othersOpen} onClick={() => setOthersOpen(open => !open)}>
          其他老师的 {others.length} 条<ChevronRight size={17} className={othersOpen ? 'rotated' : ''} />
        </button>
      </div>}
      {othersOpen && others.map(row)}
    </div>
  </section>;
}

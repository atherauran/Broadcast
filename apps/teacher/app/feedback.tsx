import { useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { FEEDBACK_KINDS, FEEDBACK_STATUSES, type Feedback, type FeedbackKind, type FeedbackStatus } from '@/lib/domain';
import { time } from './history';

const closed = (item: Feedback) => item.status === 'done' || item.status === 'declined';
const message = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试';
const Status = ({ status }: { status: FeedbackStatus }) => <span className={'ticket-status status-' + status}>{FEEDBACK_STATUSES[status]}</span>;

export function FeedbackDialog({ items, maintainer, focus, onClose, onSubmit, onComment, onStatus }: {
  items: Feedback[]; maintainer: boolean; focus: string | null; onClose: () => void;
  onSubmit: (kind: FeedbackKind, body: string) => Promise<void>; onComment: (id: string, body: string) => Promise<void>;
  onStatus: (id: string, status: FeedbackStatus) => Promise<void>;
}) {
  const [kind, setKind] = useState<FeedbackKind | null>(null);
  const [body, setBody] = useState('');
  const [expanded, setExpanded] = useState(focus);
  const [showClosed, setShowClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); return true; } catch (e) { setError(message(e)); return false; } finally { setBusy(false); }
  }
  const active = items.filter(item => !closed(item)), finished = items.filter(closed);
  const ticket = (item: Feedback) => <Ticket key={item.id} item={item} maintainer={maintainer} busy={busy} open={expanded === item.id}
    onToggle={() => setExpanded(expanded === item.id ? null : item.id)} run={run} onComment={onComment} onStatus={onStatus} />;

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="template-card edit-card ticket-card" showCloseButton={false}>
      <div className="section-heading"><DialogTitle>反馈</DialogTitle>
        <Button variant="ghost" className="icon-action" aria-label="关闭" onClick={onClose}><X size={19} /></Button>
      </div>
      <form onSubmit={e => {
        e.preventDefault();
        void run(() => onSubmit(kind!, body)).then(ok => { if (ok) { setBody(''); setKind(null); } });
      }}>
        <Textarea className="broadcast-input short" aria-label="反馈内容" maxLength={1000} value={body} onChange={e => setBody(e.target.value)}
          placeholder="写下遇到的问题或功能建议" />
        <div className="ticket-form-bottom">
          <div className="choice-row">
            {(Object.keys(FEEDBACK_KINDS) as FeedbackKind[]).map(k =>
              <button key={k} type="button" className={kind === k ? 'active' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>{FEEDBACK_KINDS[k]}</button>)}
          </div>
          <Button className="action primary" type="submit" disabled={busy || !kind || !body.trim()}>提交</Button>
        </div>
      </form>
      {error && <p className="feedback error" role="alert">{error}</p>}
      <div className="ticket-list">
        {active.map(ticket)}
        {finished.length > 0 && <button className="ticket-more" onClick={() => setShowClosed(!showClosed)}>
          {showClosed ? '收起' : '查看'}已完成和已拒绝的 {finished.length} 条<ChevronRight size={16} className={showClosed ? 'rotated' : ''} />
        </button>}
        {showClosed && finished.map(ticket)}
        {items.length === 0 && <p className="muted ticket-empty">还没有反馈</p>}
      </div>
    </DialogContent>
  </Dialog>;
}

function Ticket({ item, maintainer, busy, open, onToggle, run, onComment, onStatus }: {
  item: Feedback; maintainer: boolean; busy: boolean; open: boolean; onToggle: () => void; run: (action: () => Promise<void>) => Promise<boolean>;
  onComment: (id: string, body: string) => Promise<void>; onStatus: (id: string, status: FeedbackStatus) => Promise<void>;
}) {
  const [reply, setReply] = useState('');
  const comments = item.feedback_comments;
  return <article className="ticket">
    <button className="ticket-summary" aria-expanded={open} onClick={onToggle}>
      <span className="ticket-meta"><span>{FEEDBACK_KINDS[item.kind]} · {item.teacher_name} · {time(item.created_at)}</span><Status status={item.status} /></span>
      <span className={'ticket-body' + (open ? '' : ' clamped')}>{item.body}</span>
      {!open && comments.length > 0 && <span className="ticket-count">{comments.length} 条评论</span>}
    </button>
    {open && <div className="ticket-detail">
      {comments.map(c => <div key={c.id} className={'comment' + (c.maintainer ? ' maintainer' : '')}>
        <div className="comment-meta"><strong>{c.teacher_name}</strong><span>{time(c.created_at)}</span></div>
        <p>{c.body}</p>
      </div>)}
      {maintainer && <label className="ticket-status-field">状态
        <select className="period-select" value={item.status} disabled={busy}
          onChange={e => void run(() => onStatus(item.id, e.target.value as FeedbackStatus))}>
          {(Object.keys(FEEDBACK_STATUSES) as FeedbackStatus[]).map(s => <option key={s} value={s}>{FEEDBACK_STATUSES[s]}</option>)}
        </select>
      </label>}
      <form className="comment-form" onSubmit={e => {
        e.preventDefault();
        void run(() => onComment(item.id, reply)).then(ok => { if (ok) setReply(''); });
      }}>
        <Input aria-label="评论" placeholder="写评论" maxLength={500} value={reply} onChange={e => setReply(e.target.value)} />
        <Button className="action" variant="outline" type="submit" disabled={busy || !reply.trim()}>发送</Button>
      </form>
    </div>}
  </article>;
}

// Tells a teacher what the maintainer did with their feedback since they last looked.
export function FeedbackNews({ items, onView, onDismiss }: { items: Feedback[]; onView: () => void; onDismiss: () => void }) {
  return <Dialog open onOpenChange={open => { if (!open) onDismiss(); }}>
    <DialogContent className="confirm-card ticket-news" showCloseButton={false}>
      <DialogTitle>你的反馈有新进展</DialogTitle>
      {items.map(item => {
        const reply = item.feedback_comments.findLast(c => c.maintainer);
        return <div key={item.id} className="news-item">
          <div className="ticket-meta"><span className="news-body">{item.body}</span><Status status={item.status} /></div>
          {reply && <p className="comment maintainer">{reply.body}</p>}
        </div>;
      })}
      <div className="confirm-actions">
        <Button className="action" variant="outline" onClick={onDismiss}>知道了</Button>
        <Button className="action primary" onClick={onView}>查看</Button>
      </div>
    </DialogContent>
  </Dialog>;
}

import { ClipboardList, Megaphone, PanelTop, Send, StickyNote, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { KINDS, countdownError, endError, validAlert, validBanner, validBoard, validNote, type Classroom, type Kind } from '@/lib/domain';
import { ClassPicker } from '../class-picker';
import { AlertForm, BannerForm, BoardForm, CountdownForm, NoteForm } from './forms';
import type { Drafts, Patch } from './drafts';

const icons = { alert: Megaphone, banner: PanelTop, board: ClipboardList, note: StickyNote, countdown: Timer };
const actions: Record<Kind, string> = { alert: '发送广播', banner: '发送横幅', board: '发布公告', note: '贴上便签', countdown: '开始倒计时' };

// Text problems only disable sending; time problems are explained because the teacher cannot see them otherwise.
export function draftCheck(kind: Kind, drafts: Drafts, now: number): { ok: boolean; hint: string } {
  if (kind === 'alert') return { ok: validAlert(drafts.alert.body), hint: '' };
  if (kind === 'banner') return { ok: validBanner(drafts.banner.body), hint: '' };
  if (kind === 'board') {
    const hint = endError(drafts.board.endAt, now);
    return { ok: validBoard(drafts.board.title, drafts.board.entries) && !hint, hint };
  }
  if (kind === 'note') {
    const hint = endError(drafts.note.endAt, now);
    return { ok: validNote(drafts.note.text) && !hint, hint };
  }
  const c = drafts.countdown;
  const hint = countdownError(c.mode, c.minutes, c.until, now, c.date);
  return { ok: !hint && (c.mode !== 'days' || !!c.date) && Array.from(c.label.trim()).length <= 20, hint };
}

export function Compose({ kind, setKind, rooms, known, now, selected, setSelected, drafts, patch, ready, busy, onSubmit, onError }: {
  kind: Kind; setKind: (kind: Kind) => void; rooms: Classroom[]; known: boolean; now: number;
  selected: string[]; setSelected: (update: (old: string[]) => string[]) => void;
  drafts: Drafts; patch: Patch; ready: boolean; busy: string; onSubmit: () => void; onError: (message: string) => void;
}) {
  const check = draftCheck(kind, drafts, now);
  return <>
    <section className="section"><div className="kind-picker" aria-label="发布方式">{KINDS.map(item => {
      const Icon = icons[item.id];
      return <button key={item.id} type="button" aria-pressed={kind === item.id} className={'kind-card ' + (kind === item.id ? 'selected' : '')}
        onClick={() => setKind(item.id)}><Icon size={22} />{item.label}</button>;
    })}</div></section>
    <ClassPicker rooms={rooms} known={known} now={now} selected={selected} setSelected={setSelected} />
    <section className="section composer">
      {kind === 'alert' && <AlertForm draft={drafts.alert} onChange={change => patch('alert', change)} onError={onError} />}
      {kind === 'banner' && <BannerForm draft={drafts.banner} onChange={change => patch('banner', change)} />}
      {kind === 'board' && <BoardForm draft={drafts.board} now={now} onChange={change => patch('board', change)} onError={onError} />}
      {kind === 'note' && <NoteForm draft={drafts.note} now={now} onChange={change => patch('note', change)} />}
      {kind === 'countdown' && <CountdownForm draft={drafts.countdown} now={now} onChange={change => patch('countdown', change)} />}
      {check.hint && <p className="form-hint error-text">{check.hint}</p>}
      <div className="composer-bottom">
        <span className="selected-count">{selected.length ? <>已选择 <strong>{selected.length}</strong> 个班级</> : '请选择接收班级'}</span>
        <div className="send-actions">
          <Button className="action primary" onClick={onSubmit} disabled={!ready || !!busy || !check.ok || !selected.length}>
            <Send size={17} />{busy === 'send' ? '发送中…' : actions[kind]}
          </Button>
        </div>
      </div>
    </section>
  </>;
}

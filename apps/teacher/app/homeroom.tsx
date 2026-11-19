import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { endOfDay, localDate, localInput, muted, type Classroom } from '@/lib/domain';
import { DatePick, Option, TimeSelect } from './compose/fields';
import { time } from './history';

// The pause as the homeroom teacher sees it; an ended one counts as none.
export function muteStatus(room: Classroom, now: number): string {
  if (!room.mute_from || !room.mute_until || Date.parse(room.mute_until) <= now) return '';
  return muted(room, now) ? `暂停中，至 ${time(room.mute_until)}` : `将在 ${time(room.mute_from)} – ${time(room.mute_until)} 暂停`;
}

export function HomeroomPanel({ room, now, ready, busy, onHide, onHideSchedule, onMute }: {
  room: Classroom; now: number; ready: boolean; busy: string;
  onHide: (hidden: boolean) => Promise<boolean>; onHideSchedule: (hidden: boolean) => Promise<boolean>; onMute: (from: string | null, until: string | null) => Promise<boolean>;
}) {
  const [pausing, setPausing] = useState(false);
  const status = muteStatus(room, now);
  return <section className="section homeroom-panel">
    <h2>{room.id} 班主任</h2>
    <div className="homeroom-controls">
      <div className="homeroom-control">
        <div><strong>教室桌面</strong><p className={room.screen_hidden ? 'paused' : 'muted'}>{room.screen_hidden ? '已清屏' : '正常显示'}</p></div>
        <Button variant="outline" className="action" disabled={!ready || !!busy} onClick={() => void onHide(!room.screen_hidden)}>
          {room.screen_hidden ? '恢复桌面' : '一键清屏'}</Button>
      </div>
      <div className="homeroom-control">
        <div><strong>课表</strong><p className={room.schedule_hidden ? 'paused' : 'muted'}>{room.schedule_hidden ? '已隐藏' : '正常显示'}</p></div>
        <Button variant="outline" className="action" disabled={!ready || !!busy} onClick={() => void onHideSchedule(!room.schedule_hidden)}>
          {room.schedule_hidden ? '显示课表' : '隐藏课表'}</Button>
      </div>
      <div className="homeroom-control">
        <div><strong>其他老师的广播</strong><p className={status ? 'paused' : 'muted'}>{status || '正常接收'}</p></div>
        {status
          ? <Button variant="outline" className="action" disabled={!ready || !!busy} onClick={() => void onMute(null, null)}>解除暂停</Button>
          : <Button variant="outline" className="action" disabled={!ready || !!busy} onClick={() => setPausing(true)}>暂停接收</Button>}
      </div>
    </div>
    {pausing && <MuteDialog classroom={room.id} now={now} busy={busy} onClose={() => setPausing(false)}
      onConfirm={(from, until) => onMute(from, until).then(ok => { if (ok) setPausing(false); })} />}
  </section>;
}

function MuteDialog({ classroom, now, busy, onClose, onConfirm }: {
  classroom: string; now: number; busy: string; onClose: () => void; onConfirm: (from: string | null, until: string) => void;
}) {
  // An empty start means right away.
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState(endOfDay(now));
  const start = from ? Date.parse(from) : now;
  const error = Date.parse(until) <= Math.max(start, now) ? '结束时间需晚于开始时间' : '';
  const [startDate, startTime] = from.split('T');
  const [endDate, endTime] = until.split('T');
  return <AlertDialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <AlertDialogContent className="confirm-card mute-card">
      <AlertDialogTitle>暂停接收其他老师的广播</AlertDialogTitle>
      <AlertDialogDescription>期间其他老师的语音广播和横幅不会发到 <span className="nowrap">{classroom}</span>。公告、便签不受影响，您自己仍可以发。</AlertDialogDescription>
      <Option label="开始"><div className="choice-row">
        <button type="button" className={from ? '' : 'active'} aria-pressed={!from} onClick={() => setFrom('')}>立即</button>
        <button type="button" className={from ? 'active' : ''} aria-pressed={!!from}
          onClick={() => !from && setFrom(localInput(Math.ceil(now / 300_000) * 300_000))}>定时</button>
        {from && <>
          <DatePick value={startDate} label="开始日期" now={now} min={localDate(now)} onChange={next => setFrom(`${next}T${startTime}`)} />
          <TimeSelect value={startTime} label="开始时间" onChange={next => setFrom(`${startDate}T${next}`)} />
        </>}
      </div></Option>
      <Option label="结束"><div className="choice-row">
        <DatePick value={endDate} label="结束日期" now={now} min={localDate(start)} onChange={next => setUntil(`${next}T${endTime}`)} />
        <TimeSelect value={endTime} label="结束时间" onChange={next => setUntil(`${endDate}T${next}`)} />
      </div></Option>
      {error && <p className="feedback error">{error}</p>}
      <div className="confirm-actions">
        <AlertDialogCancel className="action" disabled={!!busy}>取消</AlertDialogCancel>
        <Button className="action primary" disabled={!!busy || !!error}
          onClick={() => onConfirm(from ? new Date(start).toISOString() : null, new Date(until).toISOString())}>暂停</Button>
      </div>
    </AlertDialogContent>
  </AlertDialog>;
}

// Shown to a homeroom teacher still on the shared account.
export function ClaimPrompt({ classroom, claimed, busy, onClaim, onDismiss }: {
  classroom: string; claimed: boolean; busy: string; onClaim: (password: string) => Promise<boolean>; onDismiss: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const error = password.length > 0 && password.length < 6 ? '密码至少 6 位' : repeat && repeat !== password ? '两次输入的密码不一致' : '';
  if (claimed) return <div className="feedback info">{classroom} 班主任密码已设置。退出后用自己的密码登录，即可使用班主任功能。
    <Button variant="link" onClick={onDismiss}>知道了</Button></div>;
  return <>
    <div className="feedback info">您是 {classroom} 班主任，设置自己的密码后，可以一键清屏、暂停接收其他老师的广播。
      <Button variant="link" onClick={() => setOpen(true)}>设置密码</Button></div>
    <AlertDialog open={open} onOpenChange={next => { if (!next && !busy) setOpen(false); }}>
      <AlertDialogContent className="confirm-card">
        <AlertDialogTitle>设置 {classroom} 班主任密码</AlertDialogTitle>
        <AlertDialogDescription>以后登录时，填写您的名字和这个密码即可。请不要使用大家共用的密码。</AlertDialogDescription>
        <form className="claim-form" onSubmit={e => { e.preventDefault(); void onClaim(password).then(ok => { if (ok) setOpen(false); }); }}>
          <Input type="password" className="login-input" autoComplete="new-password" aria-label="新密码" placeholder="新密码" value={password} onChange={e => setPassword(e.target.value)} />
          <Input type="password" className="login-input" autoComplete="new-password" aria-label="再次输入" placeholder="再次输入" value={repeat} onChange={e => setRepeat(e.target.value)} />
          {error && <p className="feedback error">{error}</p>}
          <div className="confirm-actions">
            <AlertDialogCancel className="action" disabled={!!busy}>取消</AlertDialogCancel>
            <Button type="submit" className="action primary" disabled={!!busy || !!error || !password || repeat !== password}>{busy === 'claim' ? '正在设置…' : '设置密码'}</Button>
          </div>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}

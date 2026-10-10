import { Fragment, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { CalendarDays, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ALERT_LIMIT, BANNER_LIMIT, BOARD_ENTRIES, BOARD_ENTRY_LIMIT, BOARD_THEMES, COUNTDOWN_MINUTES, NOTE_COLORS, NOTE_LIMIT, TEMPLATES,
  chars, daysUntil, fillTemplate, localInput, pastedLines, soonTime, templateBlanks, weekday, type BoardTheme } from '@/lib/domain';
import { Choices, EmotionPicker, EndPicker, Option, TimeSelect, VoicePicker } from './fields';
import type { AlertDraft, BannerDraft, BoardDraft, CountdownDraft, NoteDraft } from './drafts';

function Heading({ title, hint, length, limit }: { title: string; hint?: string; length?: number; limit?: number }) {
  return <div className="section-heading">
    <div className="heading-title"><h2>{title}</h2>{hint && <span className="heading-hint">{hint}</span>}</div>
    {limit !== undefined && <span className={'character-count ' + (length! > limit ? 'error-text' : '')}>{length} / {limit}</span>}
  </div>;
}

export function AlertForm({ draft, onChange, onError }: { draft: AlertDraft; onChange: (change: Partial<AlertDraft>) => void; onError: (message: string) => void }) {
  const [template, setTemplate] = useState('');
  const [blanks, setBlanks] = useState<string[]>([]);
  const [filling, setFilling] = useState(false);
  const firstBlank = useRef<HTMLInputElement>(null);
  function pickTemplate(item: string) {
    const blankCount = templateBlanks(item);
    if (!blankCount) { onChange({ body: item }); return; }
    setBlanks(Array.from({ length: blankCount }, () => '')); setTemplate(item); setFilling(true);
  }
  return <>
    <Heading title="广播内容" length={chars(draft.body)} limit={ALERT_LIMIT} />
    <Textarea className="broadcast-input" aria-label="广播内容" placeholder="输入需要广播的内容…" value={draft.body} onChange={e => onChange({ body: e.target.value })} />
    <div className="template-row">
      {TEMPLATES.map(item => <button type="button" key={item.text} className="template-chip" onClick={() => pickTemplate(item.text)}>{item.label}</button>)}
    </div>
    <div className="broadcast-options">
      <Choices legend="播报几遍" compact value={draft.repeatCount} options={[0, 1, 2, 3, 4].map(id => ({ id, label: String(id) }))}
        onChange={repeatCount => onChange({ repeatCount })} />
      <Choices legend="完成后" value={draft.autoClose ? 'auto' : 'manual'} options={[{ id: 'auto', label: '自动关闭' }, { id: 'manual', label: '保留，手动关闭' }]}
        onChange={value => onChange({ autoClose: value === 'auto' })} />
      <EmotionPicker value={draft.emotion} onChange={emotion => onChange({ emotion })} />
      <VoicePicker value={draft.voiceType} onChange={voiceType => onChange({ voiceType })} onError={onError} />
    </div>
    <Dialog open={filling} onOpenChange={setFilling}>
      <DialogContent className="template-card" showCloseButton={false} initialFocus={firstBlank}><DialogTitle>补全模版</DialogTitle>
        <form className="template-form" onSubmit={e => { e.preventDefault(); onChange({ body: fillTemplate(template, blanks) }); setFilling(false); }}>
          <p className="template-fill">{template.split('_').map((part, index, parts) => <Fragment key={index}>{part}
            {index < parts.length - 1 && <Input className="blank-input" ref={index === 0 ? firstBlank : undefined} maxLength={40}
              aria-label={`第 ${index + 1} 处填空`} value={blanks[index] ?? ''}
              onChange={e => setBlanks(old => old.map((value, at) => at === index ? e.target.value : value))} />}
          </Fragment>)}</p>
          <div className="confirm-actions">
            <DialogClose className="action" render={<Button variant="outline" />}>取消</DialogClose>
            <Button className="action primary" type="submit" disabled={blanks.some(value => !value.trim())}>填入广播</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}

export function BannerForm({ draft, onChange }: { draft: BannerDraft; onChange: (change: Partial<BannerDraft>) => void }) {
  return <>
    <Heading title="横幅内容" length={chars(draft.body)} limit={BANNER_LIMIT} />
    <Textarea className="broadcast-input short" aria-label="横幅内容" placeholder="输入横幅文字…" value={draft.body} onChange={e => onChange({ body: e.target.value })} />
    <div className="broadcast-options">
      <Choices legend="位置" value={draft.position} options={[{ id: 'top', label: '屏幕顶部' }, { id: 'bottom', label: '屏幕底部' }]}
        onChange={position => onChange({ position })} />
      <EmotionPicker value={draft.emotion} onChange={emotion => onChange({ emotion })} />
    </div>
  </>;
}

const burst = (x: number, y: number, r: number) => Array.from({ length: 10 }, (_, i) => {
  const [dx, dy] = [Math.cos(Math.PI * i / 5 + .2) * r, Math.sin(Math.PI * i / 5 + .2) * r];
  return <line key={`${x}-${i}`} x1={x + dx * .35} y1={y + dy * .35} x2={x + dx} y2={y + dy} />;
});
const confetti = [[6, 5, '#f472b6'], [20, 33, '#fb923c'], [34, 4, '#34d399'], [52, 34, '#60a5fa'],
  [70, 6, '#a78bfa'], [76, 28, '#facc15'], [62, 18, '#f472b6'], [4, 22, '#facc15']] as const;
const leaves = [[70, 30, 6, -35], [62, 34, 6, 25], [76, 22, 5, -70]] as const;

// A small picture of each board background, echoing the decoration the classroom draws.
function ThemeArt({ theme }: { theme: BoardTheme }) {
  if (theme === 'plain') return null;
  return <svg className="theme-art" viewBox="0 0 80 38" preserveAspectRatio="xMidYMid slice" aria-hidden>
    {theme === 'festive' && <g stroke="#fde68a" strokeOpacity=".7" strokeLinecap="round">{burst(68, 10, 9)}{burst(9, 30, 7)}</g>}
    {theme === 'joyful' && confetti.map(([x, y, color], i) =>
      <rect key={i} x={x} y={y} width="3" height="6" rx="1" fill={color} opacity=".75" transform={`rotate(${i * 37} ${x + 1.5} ${y + 3})`} />)}
    {theme === 'fresh' && <g fill="#059669" opacity=".35">
      {leaves.map(([x, y, r, angle]) => <ellipse key={x} cx={x} cy={y} rx={r} ry={r * .42} transform={`rotate(${angle} ${x} ${y})`} />)}
    </g>}
    {theme === 'tech' && <g stroke="#38bdf8" fill="none">
      <path d="M0 12H80M0 26H80M20 0V38M40 0V38M60 0V38" strokeOpacity=".12" />
      <path d="M80 6H66V14H58M80 20H72V28" strokeOpacity=".6" />
      <circle cx="58" cy="14" r="1.6" fill="#38bdf8" /><circle cx="72" cy="28" r="1.6" fill="#38bdf8" />
    </g>}
    {theme === 'safety' && <g fill="#1f2937" opacity=".8">
      {Array.from({ length: 12 }, (_, i) => <path key={i} d={`M${i * 8 - 4} 4L${i * 8} 0H${i * 8 + 4}L${i * 8} 4ZM${i * 8 - 4} 38L${i * 8} 34H${i * 8 + 4}L${i * 8} 38Z`} />)}
    </g>}
  </svg>;
}

export function BoardForm({ draft, now, onChange, onError }: {
  draft: BoardDraft; now: number; onChange: (change: Partial<BoardDraft>) => void; onError: (message: string) => void;
}) {
  const setEntry = (index: number, value: string) => onChange({ entries: draft.entries.map((entry, at) => at === index ? value : entry) });
  const list = useRef<HTMLOListElement>(null);
  const focusAt = useRef<number | null>(null);
  function paste(index: number, e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text');
    if (!/[\r\n]/.test(text)) return;
    const lines = pastedLines(text);
    if (!lines.length) return;
    e.preventDefault();
    const { value, selectionStart, selectionEnd } = e.currentTarget;
    lines[0] = value.slice(0, selectionStart ?? 0) + lines[0];
    lines[lines.length - 1] += value.slice(selectionEnd ?? 0);
    const entries = draft.entries.flatMap((entry, at) => at === index ? lines : [entry]);
    if (entries.length > BOARD_ENTRIES) onError(`最多 ${BOARD_ENTRIES} 条公告，多余内容已忽略`);
    focusAt.current = Math.min(index + lines.length, entries.length, BOARD_ENTRIES) - 1;
    onChange({ entries: entries.slice(0, BOARD_ENTRIES) });
  }
  // Enter starts a new line right after this one; while an input method is composing, Enter only confirms the characters.
  function enter(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || draft.entries.length >= BOARD_ENTRIES) return;
    e.preventDefault();
    focusAt.current = index + 1;
    onChange({ entries: [...draft.entries.slice(0, index + 1), '', ...draft.entries.slice(index + 1)] });
  }
  useEffect(() => {
    if (focusAt.current === null) return;
    const input = list.current?.querySelectorAll('input')[focusAt.current];
    focusAt.current = null;
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }, [draft.entries]);
  return <>
    <Heading title="公告内容" hint="多行可直接粘贴" />
    <Input className="title-input" aria-label="公告标题" placeholder="标题（默认为“公告”）" maxLength={30} value={draft.title} onChange={e => onChange({ title: e.target.value })} />
    <ol className="entry-list" ref={list}>{draft.entries.map((entry, index) => <li key={index} className="entry-row">
      <span className="entry-number">{index + 1}</span>
      <Input aria-label={`第 ${index + 1} 条`} placeholder="公告内容" value={entry} className={chars(entry) > BOARD_ENTRY_LIMIT ? 'invalid' : ''}
        onChange={e => setEntry(index, e.target.value)} onPaste={e => paste(index, e)} onKeyDown={e => enter(index, e)} />
      {draft.entries.length > 1 && <Button type="button" variant="ghost" className="icon-action" aria-label={`删除第 ${index + 1} 条`}
        onClick={() => onChange({ entries: draft.entries.filter((_, at) => at !== index) })}><X size={18} /></Button>}
    </li>)}</ol>
    {draft.entries.length < BOARD_ENTRIES && <Button type="button" variant="outline" className="action add-entry"
      onClick={() => onChange({ entries: [...draft.entries, ''] })}><Plus size={17} />添加一条</Button>}
    <div className="broadcast-options">
      <Option label="背景"><div className="choice-row">
        {BOARD_THEMES.map(theme => <button type="button" key={theme.id} className={'theme-choice theme-' + theme.id + (draft.theme === theme.id ? ' active' : '')}
          aria-pressed={draft.theme === theme.id} onClick={() => onChange({ theme: theme.id })}><ThemeArt theme={theme.id} /><span>{theme.label}</span></button>)}
      </div></Option>
      <EndPicker endAt={draft.endAt} now={now} onChange={endAt => onChange({ endAt })} />
      <Choices legend="显示时朗读" value={draft.speak ? 'yes' : 'no'} options={[{ id: 'no', label: '不朗读' }, { id: 'yes', label: '朗读一遍' }]}
        onChange={value => onChange({ speak: value === 'yes' })} />
      {draft.speak && <VoicePicker value={draft.voiceType} onChange={voiceType => onChange({ voiceType })} onError={onError} />}
    </div>
  </>;
}

export function NoteForm({ draft, now, onChange }: { draft: NoteDraft; now: number; onChange: (change: Partial<NoteDraft>) => void }) {
  return <>
    <Heading title="便签内容" length={chars(draft.text)} limit={NOTE_LIMIT} />
    <Textarea className={`broadcast-input short note-${draft.color}`} aria-label="便签内容" placeholder="输入便签文字…" value={draft.text}
      onChange={e => onChange({ text: e.target.value })} />
    <div className="broadcast-options">
      <Option label="颜色"><div className="choice-row">
        {NOTE_COLORS.map(color => <button type="button" key={color.id} className={'color-choice note-' + color.id + (draft.color === color.id ? ' active' : '')}
          aria-pressed={draft.color === color.id} onClick={() => onChange({ color: color.id })}>{color.label}</button>)}
      </div></Option>
      <EndPicker endAt={draft.endAt} now={now} onChange={endAt => onChange({ endAt })} />
    </div>
  </>;
}

// A yyyy/mm/dd mask: typed digits replace the placeholder letters one by one and the slashes stay put.
// The input holds the masked text but is drawn transparent; the layer behind it greys whatever is still a placeholder.
const maskText = (digits: string) => {
  const full = digits + 'yyyymmdd'.slice(digits.length);
  return `${full.slice(0, 4)}/${full.slice(4, 6)}/${full.slice(6)}`;
};
const caretAt = (digits: number) => digits + (digits > 6 ? 2 : digits > 4 ? 1 : 0);
const realDate = (digits: string) => {
  const [y, m, d] = [+digits.slice(0, 4), +digits.slice(4, 6), +digits.slice(6)];
  const date = new Date(y, m - 1, d);
  return digits.length === 8 && date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
};

function DateInput({ value, now, onChange }: { value: string; now: number; onChange: (date: string) => void }) {
  const [digits, setDigits] = useState(value.replaceAll('-', ''));
  const input = useRef<HTMLInputElement>(null);
  function edit(raw: string) {
    const next = raw.replace(/\D/g, '').slice(0, 8);
    setDigits(next);
    onChange(realDate(next) ? `${next.slice(0, 4)}-${next.slice(4, 6)}-${next.slice(6)}` : '');
    const caret = caretAt(next.length);
    requestAnimationFrame(() => input.current?.setSelectionRange(caret, caret));
  }
  const parked = () => { const caret = caretAt(digits.length); input.current?.setSelectionRange(caret, caret); };
  const days = value ? daysUntil(value, now) : 0;
  return <>
    <span className="date-field">
      <span className="date-box">
        <span className="date-mask" aria-hidden>
          {maskText(digits).split('').map((ch, at) => <span key={at} className={/\d/.test(ch) ? 'typed' : ''}>{ch}</span>)}
        </span>
        <Input ref={input} className="date-input" inputMode="numeric" aria-label="目标日期（年/月/日）" value={maskText(digits)} onChange={e => edit(e.target.value)}
          onFocus={() => requestAnimationFrame(parked)} onClick={e => { if (e.currentTarget.selectionStart === e.currentTarget.selectionEnd) parked(); }} />
      </span>
      <span className="calendar-pick" title="从日历选择"><CalendarDays size={18} />
        <input type="date" className="calendar-native" aria-label="从日历选择" min={localInput(now).slice(0, 10)} value={value}
          onChange={e => e.target.value && edit(e.target.value)} />
      </span>
    </span>
    {value && days >= 0 && <span className="muted">{weekday(new Date(`${value}T00:00`))} · {days ? `还有 ${days} 天` : '就是今天'}</span>}
  </>;
}

export function CountdownForm({ draft, now, onChange }: { draft: CountdownDraft; now: number; onChange: (change: Partial<CountdownDraft>) => void }) {
  return <>
    <Heading title="倒计时" />
    <Input className="title-input" aria-label="倒计时名称" placeholder={draft.mode === 'days' ? '名称，如“距离期末”' : '名称，如“距离下课”'} maxLength={20}
      value={draft.label} onChange={e => onChange({ label: e.target.value })} />
    <div className="broadcast-options">
      <Choices legend="计时方式" value={draft.mode} options={[{ id: 'duration', label: '按时长' }, { id: 'until', label: '到指定时间' }, { id: 'days', label: '按天数' }]}
        onChange={mode => onChange({ mode, until: draft.until || soonTime(now) })} />
      {draft.mode === 'duration' && <Option label="时长"><div className="choice-row">
        {COUNTDOWN_MINUTES.map(minutes => <button type="button" key={minutes} className={draft.minutes === minutes ? 'active' : ''}
          aria-pressed={draft.minutes === minutes} onClick={() => onChange({ minutes })}>{minutes} 分钟</button>)}
        <span className="minutes-input">
          <Input type="number" inputMode="numeric" min={1} max={720} aria-label="自定义分钟" value={Number.isNaN(draft.minutes) ? '' : draft.minutes}
            onChange={e => onChange({ minutes: e.target.valueAsNumber })} />分钟
        </span>
      </div></Option>}
      {draft.mode === 'until' && <Option label="结束时间"><div className="choice-row">
        <TimeSelect value={draft.until} label="倒计时结束时间" onChange={until => onChange({ until })} />
      </div></Option>}
      {draft.mode === 'days' && <Option label="目标日期"><div className="choice-row">
        <DateInput value={draft.date} now={now} onChange={date => onChange({ date })} />
      </div></Option>}
      {draft.mode !== 'days' && <Choices legend="显示方式" value={draft.fullscreen ? 'fullscreen' : 'corner'}
        options={[{ id: 'corner', label: '右上角' }, { id: 'fullscreen', label: '全屏' }]} onChange={value => onChange({ fullscreen: value === 'fullscreen' })} />}
    </div>
  </>;
}

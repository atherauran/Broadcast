import { Fragment, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { BANNER_LIMIT, BOARD_ENTRIES, BOARD_ENTRY_LIMIT, COUNTDOWN_MINUTES, NOTE_COLORS, NOTE_LIMIT, TEMPLATES,
  fillTemplate, soonTime, templateBlanks } from '@/lib/domain';
import { Choices, EmotionPicker, EndPicker, Option, TimeSelect, VoicePicker } from './fields';
import type { AlertDraft, BannerDraft, BoardDraft, CountdownDraft, NoteDraft } from './drafts';

const count = (value: string) => Array.from(value.trim()).length;
function Heading({ title, length, limit }: { title: string; length?: number; limit?: number }) {
  return <div className="section-heading"><h2>{title}</h2>{limit !== undefined && <span className={'character-count ' + (length! > limit ? 'error-text' : '')}>{length} / {limit}</span>}</div>;
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
    <Heading title="广播内容" length={count(draft.body)} limit={300} />
    <Textarea className="broadcast-input" aria-label="广播内容" placeholder="输入需要广播的内容…" value={draft.body} onChange={e => onChange({ body: e.target.value })} />
    <div className="template-row">{TEMPLATES.map(item => <button type="button" key={item.text} className="template-chip" onClick={() => pickTemplate(item.text)}>{item.label}</button>)}</div>
    <div className="broadcast-options">
      <Choices legend="播报几遍" compact value={draft.repeatCount} options={[0, 1, 2, 3, 4].map(id => ({ id, label: String(id) }))} onChange={repeatCount => onChange({ repeatCount })} />
      <Choices legend="完成后" value={draft.autoClose ? 'auto' : 'manual'} options={[{ id: 'auto', label: '自动关闭' }, { id: 'manual', label: '保留，手动关闭' }]} onChange={value => onChange({ autoClose: value === 'auto' })} />
      <EmotionPicker value={draft.emotion} onChange={emotion => onChange({ emotion })} />
      <VoicePicker value={draft.voiceType} onChange={voiceType => onChange({ voiceType })} onError={onError} />
    </div>
    <Dialog open={filling} onOpenChange={setFilling}>
      <DialogContent className="template-card" showCloseButton={false} initialFocus={firstBlank}><DialogTitle>补全模版</DialogTitle>
        <form className="template-form" onSubmit={e => { e.preventDefault(); onChange({ body: fillTemplate(template, blanks) }); setFilling(false); }}>
          <p className="template-fill">{template.split('_').map((part, index, parts) => <Fragment key={index}>{part}
            {index < parts.length - 1 && <Input className="blank-input" ref={index === 0 ? firstBlank : undefined} maxLength={40} aria-label={`第 ${index + 1} 处填空`} value={blanks[index] ?? ''}
              onChange={e => setBlanks(old => old.map((value, at) => at === index ? e.target.value : value))} />}
          </Fragment>)}</p>
          <div className="confirm-actions"><DialogClose className="action" render={<Button variant="outline" />}>取消</DialogClose>
            <Button className="action primary" type="submit" disabled={blanks.some(value => !value.trim())}>填入广播</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}

export function BannerForm({ draft, onChange }: { draft: BannerDraft; onChange: (change: Partial<BannerDraft>) => void }) {
  return <>
    <Heading title="横幅内容" length={count(draft.body)} limit={BANNER_LIMIT} />
    <Textarea className="broadcast-input short" aria-label="横幅内容" placeholder="输入横幅文字…" value={draft.body} onChange={e => onChange({ body: e.target.value })} />
    <div className="broadcast-options">
      <Choices legend="位置" value={draft.position} options={[{ id: 'top', label: '屏幕顶部' }, { id: 'bottom', label: '屏幕底部' }]} onChange={position => onChange({ position })} />
      <EmotionPicker value={draft.emotion} onChange={emotion => onChange({ emotion })} />
    </div>
  </>;
}

export function BoardForm({ draft, now, onChange, onError }: { draft: BoardDraft; now: number; onChange: (change: Partial<BoardDraft>) => void; onError: (message: string) => void }) {
  const setEntry = (index: number, value: string) => onChange({ entries: draft.entries.map((entry, at) => at === index ? value : entry) });
  return <>
    <Heading title="公告内容" />
    <Input className="title-input" aria-label="公告标题" placeholder="标题（默认为“公告”）" maxLength={30} value={draft.title} onChange={e => onChange({ title: e.target.value })} />
    <ol className="entry-list">{draft.entries.map((entry, index) => <li key={index} className="entry-row">
      <span className="entry-number">{index + 1}</span>
      <Input aria-label={`第 ${index + 1} 条`} placeholder="公告内容" value={entry} onChange={e => setEntry(index, e.target.value)} className={count(entry) > BOARD_ENTRY_LIMIT ? 'invalid' : ''} />
      {draft.entries.length > 1 && <Button type="button" variant="ghost" className="icon-action" aria-label={`删除第 ${index + 1} 条`} onClick={() => onChange({ entries: draft.entries.filter((_, at) => at !== index) })}><X size={18} /></Button>}
    </li>)}</ol>
    {draft.entries.length < BOARD_ENTRIES && <Button type="button" variant="outline" className="action add-entry" onClick={() => onChange({ entries: [...draft.entries, ''] })}><Plus size={17} />添加一条</Button>}
    <div className="broadcast-options">
      <EndPicker endAt={draft.endAt} now={now} onChange={endAt => onChange({ endAt })} />
      <Choices legend="显示时朗读" value={draft.speak ? 'yes' : 'no'} options={[{ id: 'no', label: '不朗读' }, { id: 'yes', label: '朗读一遍' }]} onChange={value => onChange({ speak: value === 'yes' })} />
      {draft.speak && <VoicePicker value={draft.voiceType} onChange={voiceType => onChange({ voiceType })} onError={onError} />}
    </div>
  </>;
}

export function NoteForm({ draft, now, onChange }: { draft: NoteDraft; now: number; onChange: (change: Partial<NoteDraft>) => void }) {
  return <>
    <Heading title="便签内容" length={count(draft.text)} limit={NOTE_LIMIT} />
    <Textarea className={`broadcast-input short note-${draft.color}`} aria-label="便签内容" placeholder="输入便签文字…" value={draft.text} onChange={e => onChange({ text: e.target.value })} />
    <div className="broadcast-options">
      <Option label="颜色"><div className="choice-row">
        {NOTE_COLORS.map(color => <button type="button" key={color.id} className={'color-choice note-' + color.id + (draft.color === color.id ? ' active' : '')} aria-pressed={draft.color === color.id} onClick={() => onChange({ color: color.id })}>{color.label}</button>)}
      </div></Option>
      <EndPicker endAt={draft.endAt} now={now} onChange={endAt => onChange({ endAt })} />
    </div>
  </>;
}

export function CountdownForm({ draft, now, onChange }: { draft: CountdownDraft; now: number; onChange: (change: Partial<CountdownDraft>) => void }) {
  return <>
    <Heading title="倒计时" />
    <Input className="title-input" aria-label="倒计时名称" placeholder="名称，如“距离下课”" maxLength={20} value={draft.label} onChange={e => onChange({ label: e.target.value })} />
    <div className="broadcast-options">
      <Choices legend="计时方式" value={draft.mode} options={[{ id: 'duration', label: '按时长' }, { id: 'until', label: '到指定时间' }]} onChange={mode => onChange({ mode, until: draft.until || soonTime(now) })} />
      {draft.mode === 'duration'
        ? <Option label="时长"><div className="choice-row">
          {COUNTDOWN_MINUTES.map(minutes => <button type="button" key={minutes} className={draft.minutes === minutes ? 'active' : ''} aria-pressed={draft.minutes === minutes} onClick={() => onChange({ minutes })}>{minutes} 分钟</button>)}
          <span className="minutes-input"><Input type="number" inputMode="numeric" min={1} max={720} aria-label="自定义分钟" value={Number.isNaN(draft.minutes) ? '' : draft.minutes} onChange={e => onChange({ minutes: e.target.valueAsNumber })} />分钟</span>
        </div></Option>
        : <Option label="结束时间"><div className="choice-row">
          <TimeSelect value={draft.until} label="倒计时结束时间" onChange={until => onChange({ until })} />
        </div></Option>}
      <Choices legend="显示方式" value={draft.fullscreen ? 'fullscreen' : 'corner'} options={[{ id: 'corner', label: '右上角' }, { id: 'fullscreen', label: '全屏' }]} onChange={value => onChange({ fullscreen: value === 'fullscreen' })} />
    </div>
  </>;
}

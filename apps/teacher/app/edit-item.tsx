import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { NOTE_FONTS, NOTE_LIMIT, boardEntries, chars, countdownError, endError, endOfDay, localInput, todayAt, upcoming, validBoard, validNote, type DisplayItem } from '@/lib/domain';
import { Choices, EndPicker, Option, TimeSelect } from './compose/fields';
import { DateInput, EntryList } from './compose/forms';

const kindTitle = { board: '编辑公告', note: '编辑便签', countdown: '编辑倒计时' };

// Edits the content and end time of what a class is showing. Several items share one edit when they show the same thing.
export function EditItem({ item, now, ready, busy, onClose, onSave, onError }: {
  item: DisplayItem; now: number; ready: boolean; busy: string; onClose: () => void;
  onSave: (content: object, endsAt: string) => Promise<void>; onError: (message: string) => void;
}) {
  const initialEnd = localInput(Date.parse(item.ends_at));
  const [title, setTitle] = useState(item.kind === 'board' ? item.content.title : '');
  const [entries, setEntries] = useState(item.kind === 'board' ? item.content.entries : []);
  const [fontSize, setFontSize] = useState(item.kind === 'note' ? item.content.font_size ?? 20 : 20);
  const [text, setText] = useState(item.kind === 'note' ? item.content.text : item.kind === 'countdown' ? item.content.label : '');
  const [endAt, setEndAt] = useState(initialEnd);
  const [date, setDate] = useState(item.kind === 'countdown' ? item.content.date ?? '' : '');
  const timer = item.kind === 'countdown' && !item.content.date;
  const start = upcoming(item, now) ? Date.parse(item.starts_at) : now;
  const until = endAt.slice(11);

  let hint = '', ok = true, content: object = {}, ends = '';
  if (item.kind === 'board') {
    content = { ...item.content, title: title.trim(), entries: boardEntries(entries) };
    ok = validBoard(title, entries);
  } else if (item.kind === 'note') {
    content = { ...item.content, text: text.trim(), font_size: fontSize };
    ok = validNote(text);
  } else {
    content = { ...item.content, label: text.trim(), ...(timer ? {} : { date }) };
    ok = chars(text) <= 20 && (timer || !!date);
  }
  if (timer) {
    hint = countdownError('until', 0, until, now);
    // An untouched end keeps its seconds.
    ends = endAt === initialEnd ? item.ends_at : new Date(todayAt(now, until)).toISOString();
  } else if (item.kind === 'countdown') {
    hint = countdownError('days', 0, '', now, date);
    ends = date && new Date(`${date}T23:59:59`).toISOString();
  } else {
    hint = endError(endAt, now, start);
    ends = endAt === initialEnd ? item.ends_at : new Date(endAt).toISOString();
  }

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="template-card edit-card" showCloseButton={false}>
      <div className="section-heading"><DialogTitle>{kindTitle[item.kind]}</DialogTitle>
        {item.kind === 'note' && <span className={'character-count ' + (chars(text) > NOTE_LIMIT ? 'error-text' : '')}>{chars(text)} / {NOTE_LIMIT}</span>}
      </div>
      <form className="edit-form" onSubmit={e => { e.preventDefault(); void onSave(content, ends); }}>
        {item.kind === 'board' && <>
          <Input className="title-input" aria-label="公告标题" placeholder="标题（默认为“公告”）" maxLength={30} value={title} onChange={e => setTitle(e.target.value)} />
          <EntryList entries={entries} onChange={setEntries} onError={onError} />
        </>}
        {item.kind === 'note' && <Textarea className={`broadcast-input short note-${item.content.color}`} aria-label="便签内容" value={text}
          onChange={e => setText(e.target.value)} />}
        {item.kind === 'countdown' && <Input className="title-input" aria-label="倒计时名称" placeholder="名称" maxLength={20} value={text}
          onChange={e => setText(e.target.value)} />}
        <div className="broadcast-options">
          {item.kind === 'note' && <Choices legend="字号" value={fontSize} options={NOTE_FONTS} onChange={setFontSize} />}
          {timer && <Option label="结束时间"><div className="choice-row">
            <TimeSelect value={until} label="倒计时结束时间" onChange={next => setEndAt(`${endAt.slice(0, 10)}T${next}`)} />
          </div></Option>}
          {item.kind === 'countdown' && !timer && <Option label="目标日期"><div className="choice-row">
            <DateInput value={date} now={now} onChange={setDate} />
          </div></Option>}
          {item.kind !== 'countdown' && <EndPicker endAt={endAt} now={now} from={start} onChange={next => setEndAt(next || endOfDay(start))} />}
        </div>
        {hint && <p className="form-hint error-text">{hint}</p>}
        <div className="confirm-actions">
          <DialogClose className="action" render={<Button variant="outline" />}>取消</DialogClose>
          <Button className="action primary" type="submit" disabled={!ready || !!busy || !ok || !!hint}>{busy === 'edit' ? '保存中…' : '保存'}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

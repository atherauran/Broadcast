import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CalendarDays, Volume2 } from 'lucide-react';
import { zhCN } from 'react-day-picker/locale';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EMOTIONS, END_DAYS, VOICES, daysUntil, endOfDay, localDate, pad, weekday, type Emotion } from '@/lib/domain';

const previewUrl = (voice: number) => `${import.meta.env.BASE_URL}voice-previews/${voice}.wav`;

// One labelled row of the composer: label on the left, controls on the right.
export function Option({ label, children }: { label: string; children: ReactNode }) {
  return <fieldset aria-label={label} className="option-field"><span className="option-label">{label}</span>{children}</fieldset>;
}

export function Choices<T extends string | number>({ legend, value, options, onChange, compact }: {
  legend: string; value: T; options: { id: T; label: string }[]; onChange: (value: T) => void; compact?: boolean;
}) {
  return <Option label={legend}><div className={'choice-row' + (compact ? ' compact' : '')}>
    {options.map(item => <button type="button" key={item.id} className={value === item.id ? 'active' : ''} aria-pressed={value === item.id}
      onClick={() => onChange(item.id)}>{item.label}</button>)}
  </div></Option>;
}

export function EmotionPicker({ value, onChange }: { value: Emotion; onChange: (value: Emotion) => void }) {
  return <Option label="情感"><div className="choice-row emotion-row">
    {EMOTIONS.map(item => <button type="button" key={item.id} className={value === item.id ? `active emotion-${item.id}` : ''} aria-pressed={value === item.id}
      onClick={() => onChange(item.id)}><span>{item.emoji || '无 emoji'}</span>{item.label}</button>)}
  </div></Option>;
}

export function VoicePicker({ value, onChange, onError }: { value: number; onChange: (value: number) => void; onError: (message: string) => void }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => { audio.current?.pause(); }, []);
  async function preview(id: number) {
    onError('');
    try {
      audio.current?.pause();
      const player = new Audio(previewUrl(id)); audio.current = player;
      await player.play();
    } catch (e) { onError(e instanceof Error ? e.message : '试听失败'); }
  }
  return <Option label="音色"><div className="voice-list">
    {VOICES.map(voice => <div className={'voice-row ' + (value === voice.id ? 'selected' : '')} key={voice.id}>
      <label aria-label={`${voice.name} ${voice.detail}`}>
        <input type="radio" name="voice" checked={value === voice.id} onChange={() => onChange(voice.id)} />
        <span><strong>{voice.name}</strong><small>{voice.detail}</small></span>
      </label>
      <Button type="button" variant="outline" className="preview-button" onClick={() => void preview(voice.id)}><Volume2 size={16} />试听</Button>
    </div>)}
  </div></Option>;
}

const HOURS = Array.from({ length: 24 }, (_, h) => pad(h));

// Hour and minute selects on a 5-minute grid; an off-grid value such as 23:59 stays selectable.
export function TimeSelect({ value, label, onChange }: { value: string; label: string; onChange: (value: string) => void }) {
  const [hour, minute] = value.split(':');
  const minutes = Array.from({ length: 12 }, (_, m) => pad(m * 5));
  if (!minutes.includes(minute)) { minutes.push(minute); minutes.sort(); }
  return <span className="time-select">
    <select aria-label={`${label}（时）`} value={hour} onChange={e => onChange(`${e.target.value}:${minute}`)}>
      {HOURS.map(h => <option key={h} value={h}>{h}</option>)}
    </select>:
    <select aria-label={`${label}（分）`} value={minute} onChange={e => onChange(`${hour}:${e.target.value}`)}>
      {minutes.map(m => <option key={m} value={m}>{m}</option>)}
    </select>
  </span>;
}

const asDate = (value: string) => new Date(`${value}T00:00`);

function dayLabel(value: string, now: number): string {
  const offset = daysUntil(value, now);
  if (offset >= 0 && offset <= 2) return ['今天', '明天', '后天'][offset];
  const d = asDate(value);
  const year = d.getFullYear() === new Date(now).getFullYear() ? '' : `${d.getFullYear()}年`;
  return `${year}${d.getMonth() + 1}月${d.getDate()}日 ${weekday(d)}`;
}

// A "YYYY-MM-DD" picked from a calendar that opens below the button, limited to min up to END_DAYS from today.
export function DatePick({ value, label, now, min, onChange }: { value: string; label: string; now: number; min: string; onChange: (date: string) => void }) {
  const [open, setOpen] = useState(false);
  const last = new Date(now); last.setDate(last.getDate() + END_DAYS);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger className="date-pick" aria-label={label}><CalendarDays size={17} />{dayLabel(value, now)}</PopoverTrigger>
    <PopoverContent className="date-popover" align="start">
      <Calendar mode="single" locale={zhCN} formatters={{ formatCaption: d => `${d.getFullYear()}年${d.getMonth() + 1}月` }} required selected={asDate(value)} defaultMonth={asDate(value)} startMonth={asDate(min)} endMonth={last}
        disabled={[{ before: asDate(min) }, { after: last }]} onSelect={date => { onChange(localDate(date.getTime())); setOpen(false); }} />
    </PopoverContent>
  </Popover>;
}

// An empty endAt means the end of the day the item starts (from), which is today unless it is scheduled.
export function EndPicker({ endAt, now, from = now, onChange }: { endAt: string; now: number; from?: number; onChange: (endAt: string) => void }) {
  const value = endAt || endOfDay(from);
  const [date, time] = value.split('T');
  return <Option label="结束时间"><div className="choice-row">
    <DatePick value={date} label="结束日期" now={now} min={localDate(from)} onChange={next => onChange(`${next}T${time}`)} />
    <TimeSelect value={time} label="结束时间" onChange={next => onChange(`${date}T${next}`)} />
    {value !== endOfDay(from) && <button type="button" onClick={() => onChange('')}>{localDate(from) === localDate(now) ? '今天结束' : '当天结束'}</button>}
  </div></Option>;
}

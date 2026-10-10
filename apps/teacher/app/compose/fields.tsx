import { useEffect, useRef, type ReactNode } from 'react';
import { Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EMOTIONS, VOICES, endOfToday, localInput, pad, weekday, type Emotion } from '@/lib/domain';

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

export function EndPicker({ endAt, now, onChange }: { endAt: string; now: number; onChange: (endAt: string) => void }) {
  const value = endAt || endOfToday(now);
  const [date, time] = value.split('T');
  const days = Array.from({ length: 7 }, (_, offset) => {
    const d = new Date(now); d.setDate(d.getDate() + offset);
    const label = ['今天', '明天', '后天'][offset] ?? `${d.getMonth() + 1}月${d.getDate()}日 ${weekday(d)}`;
    return { id: localInput(d.getTime()).slice(0, 10), label };
  });
  if (!days.some(day => day.id === date)) days.unshift({ id: date, label: date });
  return <Option label="结束时间"><div className="choice-row">
    <span className="time-select"><select aria-label="结束日期" value={date} onChange={e => onChange(`${e.target.value}T${time}`)}>
      {days.map(day => <option key={day.id} value={day.id}>{day.label}</option>)}
    </select></span>
    <TimeSelect value={time} label="结束时间" onChange={next => onChange(`${date}T${next}`)} />
    {value !== endOfToday(now) && <button type="button" onClick={() => onChange('')}>今天结束</button>}
  </div></Option>;
}

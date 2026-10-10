export const CLASSROOM_IDS = ['8-1', '8-2', '8-3', '8-4', '8-5', '8-6'];
export type Emotion = 'normal' | 'happy' | 'sad' | 'angry' | 'warning';
export const EMOTIONS: { id: Emotion; label: string; emoji: string }[] = [
  { id: 'normal', label: '普通', emoji: '' },
  { id: 'happy', label: '高兴', emoji: '😀' },
  { id: 'sad', label: '难过', emoji: '☹️' },
  { id: 'angry', label: '生气', emoji: '😡' },
  { id: 'warning', label: '提醒', emoji: '⚠️' },
];
export const VOICES = [
  { id: 101001, name: '智瑜', detail: '情感女声' },
  { id: 101004, name: '智云', detail: '通用男声' },
  { id: 101011, name: '智燕', detail: '新闻女声' },
  { id: 101013, name: '智辉', detail: '新闻男声' },
  { id: 101016, name: '智甜', detail: '女童声' },
] as const;
export const TEMPLATES: { label: string; text: string }[] = [
  { label: '请人到办公室', text: '请_到_办公室' },
  { label: '请到某处集合', text: '请到_集合' },
  { label: '请把东西交到某处', text: '请把_交到_' },
  { label: '下节课去某处', text: '下节课去_' },
  { label: '戴好红领巾', text: '戴好红领巾' },
  { label: '回到座位，保持安静', text: '回到座位，保持安静' },
];
export interface Classroom {
  id: string; device_id: string | null; device_name: string | null;
  last_seen_at: string | null; connected: boolean;
}
export interface Delivery {
  id: string; classroom_id: string; device_id: string | null; online_at_send: boolean;
  received_at: string | null; started_at: string | null; displayed_at: string | null;
  playback_started_at: string | null; played_at: string | null; finished_at: string | null;
  audio_error: string | null;
  execution_error?: string | null;
}
export type Style = 'fullscreen' | 'banner';
export type BannerPosition = 'top' | 'bottom';
export interface Broadcast {
  id: string; body: string; created_at: string; expires_at: string;
  source_id: string | null; teacher_name: string; repeat_count: number; auto_close: boolean;
  emotion: Emotion; voice_type: number; style: Style; banner_position: BannerPosition;
  deliveries: Delivery[];
}
export type Kind = 'alert' | 'banner' | 'board' | 'note' | 'countdown';
export type DisplayKind = Exclude<Kind, 'alert' | 'banner'>;
export const KINDS: { id: Kind; label: string }[] = [
  { id: 'alert', label: '全屏广播' },
  { id: 'banner', label: '横幅' },
  { id: 'board', label: '公告板' },
  { id: 'note', label: '便签' },
  { id: 'countdown', label: '倒计时' },
];
export const ALERT_LIMIT = 300;
export const BANNER_LIMIT = 80;
export const BOARD_ENTRIES = 12;
export const BOARD_ENTRY_LIMIT = 300;
export const NOTE_LIMIT = 60;
export type NoteColor = 'yellow' | 'blue' | 'green' | 'pink';
export const NOTE_COLORS: { id: NoteColor; label: string }[] = [
  { id: 'yellow', label: '黄' }, { id: 'blue', label: '蓝' }, { id: 'green', label: '绿' }, { id: 'pink', label: '粉' },
];
export const COUNTDOWN_MINUTES = [5, 10, 15, 25, 45];
export type BoardTheme = 'plain' | 'festive' | 'joyful' | 'fresh' | 'tech' | 'safety';
export const BOARD_THEMES: { id: BoardTheme; label: string }[] = [
  { id: 'plain', label: '简洁' }, { id: 'festive', label: '节日' }, { id: 'joyful', label: '欢快' },
  { id: 'fresh', label: '清新' }, { id: 'tech', label: '科技' }, { id: 'safety', label: '安全提醒' },
];
export interface BoardContent { title: string; entries: string[]; speak: boolean; voice_type: number; theme?: BoardTheme }
export interface NoteContent { text: string; color: NoteColor }
export interface CountdownContent { label: string; fullscreen: boolean; date?: string }
export type DisplayItem = {
  id: string; request_id: string; classroom_id: string; starts_at: string; ends_at: string;
  teacher_name: string; created_at: string;
} & ({ kind: 'board'; content: BoardContent } | { kind: 'note'; content: NoteContent } | { kind: 'countdown'; content: CountdownContent });
export function isOnline(room: Classroom, now: number): boolean {
  return !!room.device_id && room.connected && !!room.last_seen_at && now - Date.parse(room.last_seen_at) < 270_000;
}
export function deliveryStatus(d: Delivery, b: Broadcast, now: number): { label: string; tone: string } {
  if (d.played_at) return { label: `已播放 ${b.repeat_count} 遍`, tone: 'success' };
  if (d.execution_error) return { label: d.execution_error, tone: 'warning' };
  if (d.started_at && !d.finished_at && now - Date.parse(d.started_at) > 300_000) return { label: '结果待确认 · 回执中断', tone: 'warning' };
  if (d.audio_error && d.displayed_at) return { label: '仅文字 · 语音失败', tone: 'warning' };
  if (d.finished_at) return { label: b.repeat_count === 0 ? '已完成 · 仅文字' : '展示已结束', tone: 'muted' };
  if (d.playback_started_at) return { label: '播放中', tone: 'blue' };
  if (d.displayed_at) return { label: b.repeat_count === 0 ? '正在展示文字' : '正文已显示', tone: 'blue' };
  if (d.started_at) return { label: '正在打开广播', tone: 'blue' };
  if (now >= Date.parse(b.expires_at)) return { label: d.received_at ? '排队过期 · 未播放' : '已过期 · 未收到', tone: 'muted' };
  if (d.received_at) return { label: '已收到 · 等待播放', tone: 'blue' };
  return { label: d.device_id ? '等待接收' : '未绑定设备', tone: 'muted' };
}
export type DeliveryRow = Delivery & { broadcast_id: string };
// Realtime rows carry the whole record, so the screen is patched from them instead of being fetched again.
// Delivery times only ever go from empty to set, so a row and a fetched snapshot can be merged in any order.
export function patchDelivery(history: Broadcast[], row: DeliveryRow): Broadcast[] {
  return history.map(item => {
    if (item.id !== row.broadcast_id) return item;
    const old = item.deliveries.find(d => d.id === row.id);
    if (!old) return { ...item, deliveries: [...item.deliveries, row].sort((a, b) => a.classroom_id.localeCompare(b.classroom_id)) };
    const set = Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null && value !== undefined));
    return { ...item, deliveries: item.deliveries.map(d => d.id === row.id ? { ...d, ...set } : d) };
  });
}
export function patchRoom(rooms: Classroom[], device: { id: string; name: string; last_seen_at: string | null; connected: boolean }): Classroom[] {
  return rooms.map(room => room.device_id === device.id
    ? { ...room, device_name: device.name, last_seen_at: device.last_seen_at, connected: device.connected } : room);
}
export type DisplayRow = DisplayItem & { removed_at?: string | null; created_by?: string };
export function patchDisplayItems(items: DisplayItem[], removal: boolean, row: Pick<DisplayRow, 'id'> & Partial<DisplayRow>): DisplayItem[] {
  const rest = items.filter(item => item.id !== row.id);
  if (removal || row.removed_at) return rest;
  const { removed_at: _removed, created_by: _creator, ...item } = row as DisplayRow;
  return [...rest, item as DisplayItem].sort((a, b) => a.classroom_id.localeCompare(b.classroom_id)
    || Date.parse(a.starts_at) - Date.parse(b.starts_at) || Date.parse(a.created_at) - Date.parse(b.created_at));
}
// Length in characters as the server counts them, so an emoji is one.
export const chars = (value: string) => Array.from(value.trim()).length;
export function validAlert(body: string): boolean {
  return chars(body) > 0 && chars(body) <= ALERT_LIMIT;
}
export function validDraft(body: string, selected: string[]): boolean {
  return validAlert(body) && selected.length > 0;
}
export function validTeacherName(name: string): boolean {
  const length = Array.from(name.trim()).length;
  return length > 0 && length <= 40;
}
export function templateBlanks(template: string): number {
  return template.split('_').length - 1;
}
export function fillTemplate(template: string, blanks: string[]): string {
  let index = 0;
  return template.replace(/_/g, () => blanks[index++]?.trim() ?? '');
}
export function validBanner(body: string): boolean {
  return chars(body) > 0 && chars(body) <= BANNER_LIMIT;
}
export function boardEntries(entries: string[]): string[] {
  return entries.map(entry => entry.trim()).filter(Boolean);
}
// Splits pasted text into announcement lines, dropping blank lines and "1." / "2、" / "(3)" style numbering.
export function pastedLines(text: string): string[] {
  return text.split(/\r?\n/).map(line => line.replace(/^\s*[(（]?\d+\s*[.、)）．]\s*/, '').trim()).filter(Boolean);
}
export function validBoard(title: string, entries: string[]): boolean {
  const list = boardEntries(entries);
  return chars(title) <= 30 && list.length > 0 && list.length <= BOARD_ENTRIES && list.every(entry => chars(entry) <= BOARD_ENTRY_LIMIT);
}
export function validNote(text: string): boolean {
  return chars(text) > 0 && chars(text) <= NOTE_LIMIT;
}
export const pad = (value: number) => String(value).padStart(2, '0');
// Values for <input type="datetime-local">, in the teacher's local time.
export function localInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function endOfToday(now: number): string {
  return localInput(now).slice(0, 10) + 'T23:59';
}
// "HH:mm" at least 10 minutes ahead, on the 5-minute grid.
export function soonTime(now: number): string {
  return localInput(Math.ceil((now + 600_000) / 300_000) * 300_000).slice(11);
}
// Today's time "HH:mm" as an absolute instant.
export function todayAt(now: number, time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  const d = new Date(now); d.setHours(hours, minutes, 0, 0);
  return d.getTime();
}
// An empty endAt means the end of today.
export function endError(endAt: string, now: number): string {
  const end = Date.parse(endAt || endOfToday(now));
  if (Number.isNaN(end) || end <= now) return '结束时间已过';
  if (end > now + 7 * 86_400_000) return '最多显示 7 天';
  return '';
}
export const COUNTDOWN_DAYS = 366;
// Whole calendar days from today to a "YYYY-MM-DD" date.
export function daysUntil(date: string, now: number): number {
  const [y, m, d] = date.split('-').map(Number);
  const today = new Date(now);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86_400_000);
}
export function countdownError(mode: 'duration' | 'until' | 'days', minutes: number, until: string, now: number, date = ''): string {
  if (mode === 'days') {
    if (!date) return '';
    const days = daysUntil(date, now);
    return days < 0 ? '日期已过' : days > COUNTDOWN_DAYS ? `最多倒数 ${COUNTDOWN_DAYS} 天` : '';
  }
  if (mode === 'duration') return Number.isInteger(minutes) && minutes >= 1 && minutes <= 720 ? '' : '请填写 1–720 分钟';
  const end = todayAt(now, until);
  if (end <= now) return '结束时间已过';
  return end - now > 12 * 3_600_000 ? '倒计时最长 12 小时' : '';
}
export const weekday = (date: Date) => '周' + '日一二三四五六'[date.getDay()];
export function clockText(value: string, now: number): string {
  const d = new Date(value); const today = new Date(now);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString() === today.toDateString() ? hm : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}
export function remaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export const SUBJECTS = [
  { id: 'english', label: '英语 English' }, { id: 'chinese', label: '语文 Chinese' }, { id: 'math', label: '数学 Math' },
  { id: 'physics', label: '物理 Physics' }, { id: 'biology', label: '生物 Biology' }, { id: 'chemistry', label: '化学 Chemistry' },
  { id: 'history', label: '历史 History' }, { id: 'pe', label: '体育 PE' }, { id: 'morality', label: '道德与法治' },
  { id: 'art', label: '艺术 Art/Music' }, { id: 'it', label: '信息科技 IT' }, { id: 'elective', label: '选修 Optional' }, { id: 'club', label: '社团 Club' },
  { id: 'lunch', label: '午餐 Lunch' },
] as const;
export const subjectLabel = (id: string) => SUBJECTS.find(subject => subject.id === id)?.label ?? id;
export const SCHOOL_DAYS = ['周一', '周二', '周三', '周四', '周五'];
export const DAY_PERIODS = 12;
// Monday to Friday, each an ordered list of subject ids.
export type Week = string[][];
export const emptyWeek = (): Week => SCHOOL_DAYS.map(() => []);
export interface Schedule { classroom_id: string; days: Week; teacher_name: string; updated_at: string }
export function patchSchedule(schedules: Schedule[], row: Schedule): Schedule[] {
  const { classroom_id, days, teacher_name, updated_at } = row;
  return [...schedules.filter(item => item.classroom_id !== classroom_id), { classroom_id, days, teacher_name, updated_at }];
}

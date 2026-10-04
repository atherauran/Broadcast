import { describe, expect, it } from 'vitest';
import { TEMPLATES, countdownError, endOfToday, localInput, endError, remaining, soonTime, todayAt, validBanner, validBoard, validNote, deliveryStatus, fillTemplate, isOnline, templateBlanks, validDraft, validTeacherName, type Broadcast, type Classroom, type Delivery } from '../lib/domain';
const now = Date.parse('2026-09-08T10:00:00Z');
const room: Classroom = { id: '8-1', device_id: 'one', device_name: 'PC', connected: true, last_seen_at: new Date(now - 269_999).toISOString() };
const d: Delivery = { id: 'one', classroom_id: '8-1', device_id: 'device', online_at_send: true, received_at: null, started_at: null, displayed_at: null, playback_started_at: null, played_at: null, finished_at: null, audio_error: null };
const b: Broadcast = { id: 'one', body: '测试', created_at: new Date(now - 30_000).toISOString(), expires_at: new Date(now).toISOString(),
  source_id: null, teacher_name: '王老师', repeat_count: 1, auto_close: true, emotion: 'normal', voice_type: 101001, style: 'fullscreen', banner_position: 'top', deliveries: [d] };
describe('truthful device status', () => {
  it('expires the heartbeat at exactly 270 seconds', () => { expect(isOnline(room, now)).toBe(true); expect(isOnline(room, now + 1)).toBe(false); });
  it('requires a current binding and a working connection', () => { expect(isOnline({ ...room, device_id: null }, now)).toBe(false); expect(isOnline({ ...room, connected: false }, now)).toBe(false); });
  it('does not mistake server creation for receipt or playback', () => { expect(deliveryStatus(d, b, now - 1).label).toBe('等待接收'); });
  it('expires queued broadcasts without expiring one already playing', () => {
    expect(deliveryStatus({ ...d, received_at: 'time' }, b, now).label).toBe('排队过期 · 未播放');
    expect(deliveryStatus({ ...d, playback_started_at: 'time' }, b, now + 60_000).label).toBe('播放中');
  });
  it('keeps text-only distinct from played', () => { expect(deliveryStatus({ ...d, displayed_at: 'time', audio_error: 'failed', finished_at: 'time' }, b, now).label).toBe('仅文字 · 语音失败'); });
  it('labels a deliberate zero-repeat broadcast as text-only', () => { expect(deliveryStatus({ ...d, displayed_at: 'time', finished_at: 'time' }, { ...b, repeat_count: 0 }, now).label).toBe('已完成 · 仅文字'); });
  it('requires nonempty text and targets with a 300 code point limit', () => { expect(validDraft('  ', ['8-1'])).toBe(false); expect(validDraft('你好', [])).toBe(false); expect(validDraft('🎒'.repeat(300), ['8-1'])).toBe(true); expect(validDraft('字'.repeat(301), ['8-1'])).toBe(false); });
  it('requires a teacher name on the new login', () => { expect(validTeacherName('王老师')).toBe(true); expect(validTeacherName(' ')).toBe(false); expect(validTeacherName('字'.repeat(41))).toBe(false); });
});
describe('broadcast templates', () => {
  it('counts the blanks each template asks the teacher to fill', () => {
    expect(TEMPLATES.map(item => templateBlanks(item.text))).toEqual([2, 1, 2, 1, 0, 0]);
  });
  it('fills every blank in order and trims the entered words', () => {
    expect(fillTemplate('请_到_办公室', [' 张小明 ', '二楼'])).toBe('请张小明到二楼办公室');
    expect(fillTemplate('戴好红领巾', [])).toBe('戴好红领巾');
  });
});

describe('display styles', () => {
  const local = new Date(2026, 9, 4, 14, 3).getTime();
  it('limits banners, boards and notes', () => {
    expect(validBanner('字'.repeat(80))).toBe(true); expect(validBanner('字'.repeat(81))).toBe(false); expect(validBanner(' ')).toBe(false);
    expect(validBoard('', ['', ' 明天穿校服 '])).toBe(true); expect(validBoard('', ['', ' '])).toBe(false);
    expect(validBoard('', Array(13).fill('条'))).toBe(false); expect(validBoard('', ['字'.repeat(101)])).toBe(false);
    expect(validNote('字'.repeat(60))).toBe(true); expect(validNote('字'.repeat(61))).toBe(false);
  });
  it('defaults the end time to the end of the local day', () => {
    expect(localInput(local)).toBe('2026-10-04T14:03'); expect(endOfToday(local)).toBe('2026-10-04T23:59');
    expect(todayAt(local, '15:40')).toBe(new Date(2026, 9, 4, 15, 40).getTime()); expect(soonTime(local)).toBe('14:15');
  });
  it('explains impossible times', () => {
    expect(endError('', local)).toBe(''); expect(endError('2026-10-04T14:00', local)).toBe('结束时间已过');
    expect(endError('2026-10-12T14:00', local)).toBe('最多显示 7 天');
    expect(countdownError('duration', 25, '', local)).toBe(''); expect(countdownError('duration', 0, '', local)).not.toBe('');
    expect(countdownError('until', 0, '13:00', local)).toBe('结束时间已过'); expect(countdownError('until', 0, '15:40', local)).toBe('');
  });
  it('formats the remaining countdown time', () => {
    expect(remaining(25 * 60_000)).toBe('25:00'); expect(remaining(3_725_000)).toBe('1:02:05'); expect(remaining(-5)).toBe('00:00');
  });
});

import { describe, expect, it } from 'vitest';
import { daysUntil, pastedBirthdays, pastedLines, patchDelivery, patchDisplayItems, patchRoom, TEMPLATES, countdownError, endOfDay, localInput, endError, publishError, nextAt, savedBoards, shiftDays, remaining, soonTime, todayAt, validBanner, validBoard, validNote, deliveryStatus, fillTemplate, isOnline, templateBlanks, validDraft, validTeacherName, type Broadcast, type Classroom, type Delivery, type DisplayItem } from '../lib/domain';
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
    expect(validBoard('', Array(13).fill('条'))).toBe(false); expect(validBoard('', ['字'.repeat(300)])).toBe(true); expect(validBoard('', ['字'.repeat(301)])).toBe(false);
    expect(validNote('字'.repeat(60))).toBe(true); expect(validNote('字'.repeat(61))).toBe(false);
  });
  it('defaults the end time to the end of the local day', () => {
    expect(localInput(local)).toBe('2026-10-04T14:03'); expect(endOfDay(local)).toBe('2026-10-04T23:59');
    expect(shiftDays('2026-10-31T08:30', 1)).toBe('2026-11-01T08:30');
    expect(nextAt(local, '15:40')).toBe('2026-10-04T15:40'); expect(nextAt(local, '08:30')).toBe('2026-10-05T08:30');
    expect(todayAt(local, '15:40')).toBe(new Date(2026, 9, 4, 15, 40).getTime()); expect(soonTime(local)).toBe('14:15');
  });
  it('explains impossible times', () => {
    expect(endError('', local)).toBe(''); expect(endError('2026-10-04T14:00', local)).toBe('结束时间已过');
    expect(endError('2027-10-04T14:00', local)).toBe(''); expect(endError('2027-10-06T14:00', local)).toBe('最多显示一年');
    const tomorrow = new Date(2026, 9, 5, 7, 30).getTime();
    expect(endError('', local, tomorrow)).toBe(''); expect(endError('2026-10-05T07:00', local, tomorrow)).toBe('结束时间需晚于发布时间');
    expect(publishError('', local)).toBe(''); expect(publishError('2026-10-04T14:00', local)).toBe('发布时间已过'); expect(publishError('2026-10-05T07:30', local)).toBe('');
    expect(countdownError('duration', 25, '', local)).toBe(''); expect(countdownError('duration', 0, '', local)).not.toBe('');
    expect(countdownError('days', 0, '', local, '')).toBe(''); expect(countdownError('days', 0, '', local, '2026-10-04')).toBe(''); expect(countdownError('days', 0, '', local, '2026-10-03')).toBe('日期已过'); expect(countdownError('days', 0, '', local, '2028-01-01')).not.toBe('');
    expect(daysUntil('2026-10-06', local)).toBe(2);
    expect(pastedLines('1. 带水杯\n2、交作业\r\n\n(3) 大扫除\n2024年开学')).toEqual(['带水杯', '交作业', '大扫除', '2024年开学']);
    expect(countdownError('until', 0, '13:00', local)).toBe('结束时间已过'); expect(countdownError('until', 0, '15:40', local)).toBe('');
  });
  it('lists scheduled boards by start time before drafts, one per request', () => {
    const content = { title: '晨会通知', entries: ['升旗'], speak: false, voice_type: 101001 };
    const board = (id: string, request: string, classroom: string, start: number): DisplayItem => ({ id, request_id: request, classroom_id: classroom, kind: 'board', content,
      starts_at: new Date(start).toISOString(), ends_at: new Date(start + 3_600_000).toISOString(), teacher_name: '李老师', created_at: new Date(local).toISOString() });
    // "now" sent right away: created and started on the server a moment after the page's clock last ticked.
    const sent = { ...board('d', 'now', '8-4', local + 2_000), created_at: new Date(local + 2_000).toISOString() };
    const items = [board('a1', 'late', '8-1', local + 7_200_000), board('a2', 'late', '8-2', local + 7_200_000), board('b', 'soon', '8-3', local + 60_000),
      board('c', 'shown', '8-1', local - 60_000), sent];
    const draft = { id: 'draft', content, classrooms: [], ends_at: null, teacher_name: '王老师', updated_at: new Date(local).toISOString() };
    const list = savedBoards([draft], items, local);
    expect(list.map(b => [b.id, b.classrooms, !!b.publish_at])).toEqual([['soon', ['8-3'], true], ['late', ['8-1', '8-2'], true], ['draft', [], false]]);
  });
  it('formats the remaining countdown time', () => {
    expect(remaining(25 * 60_000)).toBe('25:00'); expect(remaining(3_725_000)).toBe('1:02:05'); expect(remaining(-5)).toBe('00:00');
  });
});

describe('patching from realtime rows', () => {
  it('merges a delivery row without losing times already known, in any order', () => {
    const late = { ...d, broadcast_id: 'one', received_at: 'r', displayed_at: 'd' };
    const early = { ...d, broadcast_id: 'one', received_at: 'r' };
    const once = patchDelivery([b], late)[0].deliveries[0];
    expect(patchDelivery([{ ...b, deliveries: [once] }], early)[0].deliveries[0]).toMatchObject({ received_at: 'r', displayed_at: 'd' });
  });
  it('adds a delivery of a known broadcast and ignores another broadcast', () => {
    const next = { ...d, id: 'two', classroom_id: '8-0', broadcast_id: 'one' };
    expect(patchDelivery([b], next)[0].deliveries.map(x => x.id)).toEqual(['two', 'one']);
    expect(patchDelivery([b], { ...next, broadcast_id: 'other' })[0]).toBe(b);
  });
  it('patches only the room that owns the device', () => {
    const rooms = [room, { ...room, id: '8-2', device_id: 'two' }];
    const next = patchRoom(rooms, { id: 'two', name: 'PC2', last_seen_at: 'now', connected: false });
    expect(next[0]).toBe(rooms[0]); expect(next[1]).toMatchObject({ device_name: 'PC2', last_seen_at: 'now', connected: false });
  });
  it('keeps display items sorted by class and start, and drops removed or deleted ones', () => {
    const item = (id: string, classroom_id: string, starts_at: string) => ({ id, request_id: 'r', classroom_id, kind: 'note', content: { text: '', color: 'yellow' },
      starts_at, ends_at: '2030-01-01T00:00:00Z', teacher_name: '李老师', created_at: starts_at }) as DisplayItem;
    const a = item('a', '8-2', '2026-10-01T08:00:00Z'), c = item('c', '8-1', '2026-10-01T09:00:00Z');
    expect(patchDisplayItems(patchDisplayItems([], false, a), false, c).map(x => x.id)).toEqual(['c', 'a']);
    expect(patchDisplayItems([a, c], false, { ...a, removed_at: 'now' } as never).map(x => x.id)).toEqual(['c']);
    expect(patchDisplayItems([a, c], true, { id: 'c' }).map(x => x.id)).toEqual(['a']);
    expect(patchDisplayItems([a], false, { ...a, created_by: 'x', removed_at: null } as never)[0]).not.toHaveProperty('created_by');
  });
});
describe('pasted birthdays', () => {
  it('reads spreadsheet rows, keeping the first and last name cells', () => {
    const text = '编号\t中文名\t英文名\t昵称\t出生日期\n1\t胡昊凯\tHu, Hao Kai\tMartin\t2013/1/2\r\n27\t许书杨\tXu, Shu Yang\tSophia\t2012/9/7\n';
    expect(pastedBirthdays(text)).toEqual([{ name: '胡昊凯 Martin', date: '01-02' }, { name: '许书杨 Sophia', date: '09-07' }]);
  });
  it('accepts plain lines and Chinese dates, and skips impossible ones', () => {
    expect(pastedBirthdays('张三 3月12日\n李四 2-30\n王五 2012-02-29')).toEqual([{ name: '张三', date: '03-12' }, { name: '王五', date: '02-29' }]);
  });
});

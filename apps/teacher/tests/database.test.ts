import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const admin = '10000000-0000-4000-8000-000000000001';
const first = '20000000-0000-4000-8000-000000000001';
const second = '20000000-0000-4000-8000-000000000002';
const third = '20000000-0000-4000-8000-000000000003';
let db: PGlite;
async function identity(id: string, role = 'device') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: id, role: 'authenticated', app_metadata: { role } })]);
  await db.exec('set role authenticated');
}
async function scalar<T>(sql: string, args: unknown[] = []) { return Object.values((await db.query<Record<string, T>>(sql, args)).rows[0])[0]; }
async function create(targets = ['8-1']) {
  const id = crypto.randomUUID();
  await identity(admin, 'admin');
  await db.query('select create_broadcast($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [id, '请同学们回到教室。', targets, null, '王老师', 2, false, 'warning', 101013, 'fullscreen', 'top']);
  return id;
}
async function show(kind: string, content: object, targets = ['8-1'], extra: { end?: string; duration?: number } = {}) {
  const id = crypto.randomUUID();
  await identity(admin, 'admin');
  await db.query('select create_display_item($1,$2,$3,$4,$5,$6::timestamptz,$7)', [id, kind, targets, JSON.stringify(content), '李老师',
    extra.end ?? (extra.duration ? null : new Date(Date.now() + 3_600_000).toISOString()), extra.duration ?? null]);
  return id;
}
type Shown = { id: string; kind: string; content: Record<string, unknown>; starts_at: string };
// The rebind test above leaves 8-1 on the third device.
async function screen(device = third) { await identity(device); return (await scalar<{ display: Shown[] }>('select device_heartbeat(true)')).display; }
async function rowId(request: string, classroom = '8-1') { await identity(admin, 'admin'); return scalar<string>('select id from display_items where request_id=$1 and classroom_id=$2', [request, classroom]); }
async function clearDisplay() { await db.exec('reset role'); await db.exec('update display_items set removed_at = clock_timestamp() where removed_at is null'); }
async function delivery(id: string, classroom = '8-1') { await identity(admin, 'admin'); return scalar<string>('select id from deliveries where broadcast_id=$1 and classroom_id=$2', [id, classroom]); }
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims', true), '')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    create function auth.role() returns text language sql stable as $$select auth.jwt()->>'role'$$;
    grant usage on schema auth, public to authenticated, anon, service_role;
    create publication supabase_realtime;
    insert into auth.users values ('${admin}'),('${first}'),('${second}'),('${third}');`);
  await db.exec(await readFile(new URL('../../../supabase/migrations/202609080001_broadcast.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../../supabase/migrations/202609100001_heartbeat_intervals.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../../supabase/migrations/202609120001_broadcast_options.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../../supabase/migrations/202610040001_heartbeat_120s.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../../supabase/migrations/202610050001_broadcast_style.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../../supabase/migrations/202610060001_display_items.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../../supabase/migrations/202610070001_display_starts_now.sql', import.meta.url), 'utf8'));
  await identity(admin, 'admin');
  await db.query('select bind_device($1,$2,$3)', [first, '8-1', 'classroom-one']);
  await db.query('select bind_device($1,$2,$3)', [second, '8-2', 'classroom-two']);
});
afterAll(async () => { await db?.close(); });
describe('database contract and RLS (real PostgreSQL engine)', () => {
  it('seeds exactly six classrooms', async () => { await identity(admin, 'admin'); expect(await scalar<number>('select count(*)::int from classrooms')).toBe(6); });
  it('rejects a second device competing for an occupied classroom', async () => { await identity(admin, 'admin'); await expect(db.query('select bind_device($1,$2,$3)', [third, '8-1', 'competitor'])).rejects.toThrow('已被其他设备绑定'); });
  it('prevents device users from changing bindings or sending broadcasts', async () => { await identity(first); await expect(db.query('select unbind_device($1)', ['8-2'])).rejects.toThrow('管理员'); await expect(db.query('select create_broadcast($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [crypto.randomUUID(), 'forged', ['8-2'], null, '伪造者', 1, true, 'normal', 101001, 'fullscreen', 'top'])).rejects.toThrow('管理员'); });
  it('only exposes the device own classroom and deliveries', async () => {
    const id = await create(['8-1','8-2']); await identity(first);
    expect(await scalar<number>('select count(*)::int from classrooms')).toBe(1);
    const rows = await db.query<{ classroom_id: string }>('select classroom_id from deliveries where broadcast_id=$1', [id]);
    expect(rows.rows).toEqual([{ classroom_id: '8-1' }]);
    expect(await scalar<number>('select count(*)::int from broadcasts')).toBe(0);
  });
  it('uses a server timestamp and a 30 second TTL, and retries are idempotent', async () => {
    const id = await create(); await db.query('select create_broadcast($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [id, '请同学们回到教室。', ['8-1'], null, '王老师', 2, false, 'warning', 101013, 'fullscreen', 'top']);
    expect(await scalar<number>('select count(*)::int from deliveries where broadcast_id=$1', [id])).toBe(1);
    expect(await scalar<number>('select extract(epoch from expires_at-created_at)::int from broadcasts where id=$1', [id])).toBe(30);
  });
  it('delivers the teacher name and presentation options to the classroom', async () => {
    await create(); await identity(first);
    const pending = await scalar<{ items: Array<Record<string, unknown>> }>('select pending_broadcasts()');
    expect(pending.items[0]).toMatchObject({ teacher_name: '王老师', repeat_count: 2, auto_close: false,
      emotion: 'warning', voice_type: 101013, style: 'fullscreen', banner_position: 'top' });
  });
  it('requires a client receipt and atomically claims only once', async () => {
    const id = await create(); const did = await delivery(id); await identity(first);
    await expect(db.query("select ack_delivery($1,'played',clock_timestamp())", [did])).rejects.toThrow('尚未开始');
    expect(await scalar<boolean>('select start_delivery($1)', [did])).toBe(true);
    expect(await scalar<boolean>('select start_delivery($1)', [did])).toBe(false);
    await db.query("select ack_delivery($1,'displayed',clock_timestamp())", [did]);
    await db.query("select ack_delivery($1,'playing',clock_timestamp())", [did]);
    await db.query("select ack_delivery($1,'played',clock_timestamp())", [did]);
    const played = await scalar<string>('select played_at::text from deliveries where id=$1', [did]);
    await db.query("select ack_delivery($1,'played',clock_timestamp())", [did]);
    expect(await scalar<string>('select played_at::text from deliveries where id=$1', [did])).toBe(played);
  });
  it('does not return expired messages on reconnect and refuses an expired start', async () => {
    const id = await create(); const did = await delivery(id); await db.exec('reset role');
    await db.query("update broadcasts set expires_at=clock_timestamp()-interval '1 second' where id=$1", [id]);
    await identity(first);
    const pending = await scalar<{ items: { broadcast_id: string }[] }>('select pending_broadcasts()');
    expect(pending.items.some(x => x.broadcast_id === id)).toBe(false);
    expect(await scalar<boolean>('select start_delivery($1)', [did])).toBe(false);
  });
  it('cannot write another classroom receipt', async () => { const id = await create(['8-2']); const did = await delivery(id, '8-2'); await identity(first); await expect(db.query("select ack_delivery($1,'received',clock_timestamp())", [did])).rejects.toThrow('无权'); });
  it('blocks direct writes that could forge online or playback state', async () => { await identity(first); await expect(db.query('update devices set connected=true')).rejects.toThrow('permission denied'); await expect(db.query('update deliveries set played_at=clock_timestamp()')).rejects.toThrow('permission denied'); });
  it('records heartbeats and expires them after 270 seconds', async () => {
    await identity(first); expect((await scalar<{ active: boolean }>('select device_heartbeat(true)')).active).toBe(true);
    await identity(admin, 'admin'); let status = await scalar<{ classrooms: {id:string;connected:boolean}[] }>('select classroom_status()');
    expect(status.classrooms.find(c => c.id === '8-1')?.connected).toBe(true);
    await db.exec('reset role'); await db.query("update devices set last_seen_at=clock_timestamp()-interval '270 seconds' where id=$1", [first]);
    await identity(admin, 'admin'); status = await scalar<{ classrooms: {id:string;connected:boolean}[] }>('select classroom_status()');
    expect(status.classrooms.find(c => c.id === '8-1')?.connected).toBe(false);
  });
  it('invalidates old-class messages after rebind and does not transfer them to replacement devices', async () => {
    const id = await create(); const did = await delivery(id);
    await db.query('select bind_device($1,$2,$3)', [first, '8-3', 'moved']);
    await db.query('select bind_device($1,$2,$3)', [third, '8-1', 'replacement']);
    for (const device of [first, third]) { await identity(device); expect(await scalar<boolean>('select start_delivery($1)', [did])).toBe(false); }
    await identity(admin, 'admin'); await db.query('select unbind_device($1)', ['8-3']); await identity(first);
    expect((await scalar<{ active: boolean }>('select device_heartbeat(true)')).active).toBe(false);
  });
});
describe('banner style', () => {
  const banner = (body: string, repeat = 0, autoClose = true) => db.query('select create_broadcast($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [crypto.randomUUID(), body, ['8-1'], null, '王老师', repeat, autoClose, 'happy', 101001, 'banner', 'bottom']);
  it('delivers a text-only banner with its position', async () => {
    await identity(admin, 'admin'); await banner('请班长到大厅'); await identity(third);
    const pending = await scalar<{ items: Array<Record<string, unknown>> }>('select pending_broadcasts()');
    expect(pending.items.find(x => x.body === '请班长到大厅')).toMatchObject({ style: 'banner', banner_position: 'bottom', repeat_count: 0 });
  });
  it('rejects speech, manual close and long text on a banner', async () => {
    await identity(admin, 'admin');
    await expect(banner('有声横幅', 1)).rejects.toThrow('横幅'); await expect(banner('手动关闭', 0, false)).rejects.toThrow('横幅');
    await expect(banner('字'.repeat(81))).rejects.toThrow('横幅');
  });
});
describe('display items', () => {
  const board = { title: '', entries: ['  明天穿校服 ', '', '下午大扫除'], speak: true, voice_type: 101004 };
  it('shows a class only its own items, normalized, through the heartbeat', async () => {
    await clearDisplay(); const id = await show('board', board, ['8-1', '8-3']); await show('note', { text: '8-2 的便签', color: 'pink' }, ['8-2']);
    const items = await screen();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'board', content: { title: '公告', entries: ['明天穿校服', '下午大扫除'], speak: true, voice_type: 101004 } });
    expect(await scalar<number>('select count(*)::int from display_items')).toBe(1);
    await identity(admin, 'admin'); expect(await scalar<number>('select count(*)::int from display_items where request_id=$1', [id])).toBe(2);
  });
  it('starts every item when it is created', async () => {
    await clearDisplay(); const before = Date.now();
    await show('note', { text: '马上出现', color: 'yellow' });
    const items = await screen(); expect(items).toHaveLength(1); expect(Date.parse(items[0].starts_at)).toBeGreaterThanOrEqual(before - 1000);
    const state = await scalar<{ items: Shown[] }>('select display_state()'); expect(state.items).toHaveLength(1);
  });
  it('drops removed and ended items, and removes one class or all of a request', async () => {
    await clearDisplay(); const id = await show('note', { text: '移除测试', color: 'blue' }, ['8-1', '8-2']);
    await db.query('select remove_display_item($1)', [await rowId(id)]);
    expect(await screen()).toHaveLength(0); expect(await screen(second)).toHaveLength(1);
    await db.query('select remove_display_item($1, true)', [await rowId(id, '8-2')]); expect(await screen(second)).toHaveLength(0);
    const ended = await show('note', { text: '已结束', color: 'blue' }); await db.exec('reset role');
    await db.query("update display_items set starts_at=clock_timestamp()-interval '2 minutes', ends_at=clock_timestamp()-interval '1 second' where request_id=$1", [ended]);
    expect(await screen()).toHaveLength(0);
  });
  it('allows at most 4 overlapping notes per class', async () => {
    await clearDisplay(); for (let i = 0; i < 4; i++) await show('note', { text: '便签' + i, color: 'green' });
    await expect(show('note', { text: '第五张', color: 'green' }, ['8-1', '8-2'])).rejects.toThrow('8-1 已有 4 张便签');
    await show('note', { text: '别的班', color: 'green' }, ['8-2']);
  });
  it('keeps one countdown per class, computes its end on the server and lingers 5 seconds', async () => {
    await clearDisplay(); await show('countdown', { label: '午休' }, ['8-1', '8-2'], { duration: 1500 });
    const second = await show('countdown', { label: '考试' }, ['8-1'], { duration: 600 });
    const items = await screen(); expect(items.map(i => i.content.label)).toEqual(['考试']);
    await identity(admin, 'admin');
    expect(await scalar<number>('select extract(epoch from ends_at-starts_at)::int from display_items where request_id=$1', [second])).toBe(600);
    await db.exec('reset role');
    await db.query("update display_items set starts_at=clock_timestamp()-interval '1 minute', ends_at=clock_timestamp()-interval '3 seconds' where request_id=$1", [second]);
    expect(await screen()).toHaveLength(1);
    await expect(show('countdown', { label: '太长' }, ['8-1'], { duration: 43_201 })).rejects.toThrow('倒计时');
  });
  it('validates content and times', async () => {
    await expect(show('board', { entries: [], speak: false, voice_type: 101001 })).rejects.toThrow('1–12');
    await expect(show('board', { entries: ['字'.repeat(101)], speak: false, voice_type: 101001 })).rejects.toThrow('100');
    await expect(show('note', { text: '颜色', color: 'red' })).rejects.toThrow('颜色');
    await expect(show('note', { text: '过去', color: 'red' }, ['8-1'], { end: new Date(Date.now() - 1000).toISOString() })).rejects.toThrow();
    await expect(show('note', { text: '太远', color: 'yellow' }, ['8-1'], { end: new Date(Date.now() + 8 * 86_400_000).toISOString() })).rejects.toThrow('结束时间');
  });
  it('is idempotent per request and refuses a conflicting retry', async () => {
    await clearDisplay(); const id = crypto.randomUUID(); const end = new Date(Date.now() + 3_600_000).toISOString();
    const run = (text: string) => db.query('select create_display_item($1,$2,$3,$4,$5,$6::timestamptz,null)', [id, 'note', ['8-1'], JSON.stringify({ text, color: 'yellow' }), '李老师', end]);
    await identity(admin, 'admin'); await run('重试'); await run('重试');
    expect(await scalar<number>('select count(*)::int from display_items where request_id=$1', [id])).toBe(1);
    await expect(run('不同内容')).rejects.toThrow('请求编号冲突');
  });
  it('lets only admins write, and never directly', async () => {
    await identity(third);
    await expect(db.query('select create_display_item($1,$2,$3,$4,$5,null,600)', [crypto.randomUUID(), 'countdown', ['8-1'], '{}', '伪造者'])).rejects.toThrow('管理员');
    await expect(db.query('select remove_display_item($1)', [crypto.randomUUID()])).rejects.toThrow('管理员');
    await expect(db.query('select display_overview()')).rejects.toThrow('管理员');
    await expect(db.query("update display_items set removed_at=clock_timestamp()")).rejects.toThrow('permission denied');
    await expect(db.query('select device_display_items()')).rejects.toThrow('permission denied');
  });
  it('gives admins an overview of every class', async () => {
    await clearDisplay(); await show('note', { text: '全校', color: 'yellow' }, ['8-1', '8-4']);
    await identity(admin, 'admin'); const overview = await scalar<{ items: { classroom_id: string; teacher_name: string }[] }>('select display_overview()');
    expect(overview.items.map(i => i.classroom_id)).toEqual(['8-1', '8-4']); expect(overview.items[0].teacher_name).toBe('李老师');
  });
});

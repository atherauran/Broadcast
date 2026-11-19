import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_BELLS } from '../lib/domain';
const admin = '10000000-0000-4000-8000-000000000001';
const first = '20000000-0000-4000-8000-000000000001';
const second = '20000000-0000-4000-8000-000000000002';
const third = '20000000-0000-4000-8000-000000000003';
let db: PGlite;
async function identity(id: string, role = 'device', maintainer = false) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: id, role: 'authenticated', app_metadata: { role, maintainer } })]);
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
async function show(kind: string, content: object, targets = ['8-1'], extra: { end?: string; duration?: number; start?: string } = {}) {
  const id = crypto.randomUUID();
  await identity(admin, 'admin');
  await db.query('select create_display_item($1,$2,$3,$4,$5,$6::timestamptz,$7,$8::timestamptz)', [id, kind, targets, JSON.stringify(content), '李老师',
    extra.end ?? (extra.duration ? null : new Date(Date.now() + 3_600_000).toISOString()), extra.duration ?? null, extra.start ?? null]);
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
    create schema storage;
    create schema vault;
    create schema cron;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint);
    create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text, metadata jsonb, created_at timestamptz default clock_timestamp());
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated, service_role;
    grant select, insert on storage.objects to authenticated;
    grant all on storage.objects to service_role;
    create table vault.decrypted_secrets(name text, decrypted_secret text);
    create function vault.create_secret(secret text, name text) returns uuid language sql as $$insert into vault.decrypted_secrets values(name, secret) returning gen_random_uuid()$$;
    create table cron.jobs(name text primary key, schedule text, command text);
    create function cron.schedule(name text, schedule text, command text) returns bigint language sql as $$insert into cron.jobs values(name, schedule, command) on conflict(name) do update set schedule=excluded.schedule, command=excluded.command returning 1::bigint$$;
    create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims', true), '')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    create function auth.role() returns text language sql stable as $$select auth.jwt()->>'role'$$;
    grant usage on schema auth, public to authenticated, anon, service_role;
    create publication supabase_realtime;
    insert into auth.users values ('${admin}'),('${first}'),('${second}'),('${third}');`);
  const migrations = new URL('../../../supabase/migrations/', import.meta.url);
  for (const file of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort())
    // PGlite runs the real schema/RLS/functions; hosted scheduling extensions are represented above.
    await db.exec((await readFile(new URL(file, migrations), 'utf8')).replace(/^create extension if not exists (pg_cron|pg_net).*;$/gm, ''));
  await identity(admin, 'admin');
  await db.query('select bind_device($1,$2,$3)', [first, '8-1', 'classroom-one']);
  await db.query('select bind_device($1,$2,$3)', [second, '8-2', 'classroom-two']);
});
afterAll(async () => { await db?.close(); });

describe('database contract and RLS (real PostgreSQL engine)', () => {
  it('seeds the six classrooms and the hidden test one', async () => { await identity(admin, 'admin'); expect(await scalar<string[]>('select array_agg(id order by id) from classrooms')).toEqual(['8-1', '8-2', '8-3', '8-4', '8-5', '8-6', 'Test']); });
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
  it('plays a broadcast at most 4 times', async () => {
    await identity(admin, 'admin');
    const send = (repeat: number) => db.query('select create_broadcast($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [crypto.randomUUID(), '请同学们回到教室。', ['8-1'], null, '王老师', repeat, true, 'normal', 101001, 'fullscreen', 'top']);
    await send(4);
    await expect(send(5)).rejects.toThrow('播报次数');
  });
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
  const board = { title: '', entries: ['  明天穿校服 ', '', '下午大扫除'] };
  it('shows a class only its own items, normalized, through the heartbeat', async () => {
    await clearDisplay(); const id = await show('board', board, ['8-1', '8-3']); await show('note', { text: '8-2 的便签', color: 'pink' }, ['8-2']);
    const items = await screen();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'board', content: { title: '公告', entries: ['明天穿校服', '下午大扫除'] } });
    expect(await scalar<number>('select count(*)::int from display_items')).toBe(1);
    await identity(admin, 'admin'); expect(await scalar<number>('select count(*)::int from display_items where request_id=$1', [id])).toBe(2);
  });
  it('starts every item when it is created', async () => {
    await clearDisplay(); const before = Date.now();
    await show('note', { text: '马上出现', color: 'yellow' });
    const items = await screen(); expect(items).toHaveLength(1); expect(Date.parse(items[0].starts_at)).toBeGreaterThanOrEqual(before - 1000);
    const state = await scalar<{ items: Shown[] }>('select display_state()'); expect(state.items).toHaveLength(1);
  });
  it('drops removed and ended items, and removes items by id', async () => {
    await clearDisplay(); const id = await show('note', { text: '移除测试', color: 'blue' }, ['8-1', '8-2']);
    await db.query('select remove_display_items($1)', [[await rowId(id)]]);
    expect(await screen()).toHaveLength(0); expect(await screen(second)).toHaveLength(1);
    await db.query('select remove_display_items($1)', [[await rowId(id, '8-2')]]); expect(await screen(second)).toHaveLength(0);
    const ended = await show('note', { text: '已结束', color: 'blue' }); await db.exec('reset role');
    await db.query("update display_items set starts_at=clock_timestamp()-interval '2 minutes', ends_at=clock_timestamp()-interval '1 second' where request_id=$1", [ended]);
    expect(await screen()).toHaveLength(0);
  });
  it('removes several selected items at once, only for admins', async () => {
    await clearDisplay(); await show('note', { text: '一', color: 'blue' }, ['8-1', '8-2']); await show('note', { text: '二', color: 'blue' });
    const keep = await show('note', { text: '三', color: 'blue' });
    await identity(admin, 'admin');
    const ids = (await db.query<{ id: string }>('select id from display_items where removed_at is null and request_id <> $1', [keep])).rows.map(r => r.id);
    await identity(third); await expect(db.query('select remove_display_items($1)', [ids])).rejects.toThrow('管理员');
    await identity(admin, 'admin'); await db.query('select remove_display_items($1)', [ids]);
    expect((await screen()).map(i => i.content.text)).toEqual(['三']); expect(await screen(second)).toHaveLength(0);
  });
  it('allows at most 12 overlapping notes per class', async () => {
    await clearDisplay(); for (let i = 0; i < 12; i++) await show('note', { text: '便签' + i, color: 'green' });
    await expect(show('note', { text: '第十三张', color: 'green' }, ['8-1', '8-2'])).rejects.toThrow('8-1 已有 12 张便签');
    await show('note', { text: '别的班', color: 'green' }, ['8-2']);
  });
  it('schedules a note to appear later and counts only notes overlapping its time', async () => {
    await clearDisplay(); const later = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
    await show('note', { text: '下午提醒', color: 'blue' }, ['8-1'], { start: later(60), end: later(120) });
    const [item] = await screen(); expect(item.content.text).toBe('下午提醒'); expect(Date.parse(item.starts_at)).toBeGreaterThan(Date.now() + 3_500_000);
    await expect(show('note', { text: '过去', color: 'blue' }, ['8-1'], { start: later(-1) })).rejects.toThrow('发布时间');
    await expect(show('note', { text: '先结束', color: 'blue' }, ['8-1'], { start: later(90), end: later(80) })).rejects.toThrow('结束时间');
    await expect(show('countdown', { label: '定时' }, ['8-1'], { start: later(10), end: later(20) })).rejects.toThrow('发布时间');
    for (let i = 0; i < 12; i++) await show('note', { text: '便签' + i, color: 'green' }, ['8-1'], { end: later(50) });
    await expect(show('note', { text: '重叠', color: 'green' }, ['8-1'], { start: later(40), end: later(65) })).rejects.toThrow('12 张');
    await show('note', { text: '错开', color: 'green' }, ['8-1'], { start: later(55), end: later(70) });
  });
  it('copies what items show to other classes once per request, credited to the copying teacher', async () => {
    await clearDisplay(); const later = new Date(Date.now() + 7_200_000).toISOString();
    const shared = await show('board', board, ['8-1', '8-3'], { end: later }); await show('note', { text: '带伞', color: 'pink' });
    await identity(admin, 'admin');
    const ids = (await db.query<{ id: string }>('select id from display_items where removed_at is null')).rows.map(r => r.id);
    const copy = (request: string, list = ids) => db.query('select copy_display_items($1,$2,$3,$4)', [request, list, ['8-2'], '周老师']);
    const request = crypto.randomUUID(); await copy(request); await copy(request);
    const copied = await screen(second);
    expect(copied.map(i => i.kind).toSorted()).toEqual(['board', 'note']);
    await identity(admin, 'admin');
    const rows = (await db.query<{ teacher_name: string; ends_at: Date }>("select teacher_name, ends_at from display_items where classroom_id='8-2' and kind='board'")).rows;
    expect(rows).toHaveLength(1); expect(rows[0].teacher_name).toBe('周老师'); expect(rows[0].ends_at.toISOString()).toBe(later);
    await db.query('select remove_display_items($1)', [ids]);
    await expect(copy(crypto.randomUUID())).rejects.toThrow('已结束');
    const row = await rowId(shared); await identity(third); await expect(copy(crypto.randomUUID(), [row])).rejects.toThrow('管理员');
  });
  it('keeps one countdown per class, computes its end on the server and lingers 5 seconds', async () => {
    await clearDisplay(); await show('countdown', { label: '午休' }, ['8-1', '8-2'], { duration: 1500 });
    const second = await show('countdown', { label: '考试' }, ['8-1'], { duration: 600 });
    const items = await screen(); expect(items.map(i => i.content)).toEqual([{ label: '考试', fullscreen: false }]);
    await identity(admin, 'admin');
    expect(await scalar<number>('select extract(epoch from ends_at-starts_at)::int from display_items where request_id=$1', [second])).toBe(600);
    await db.exec('reset role');
    await db.query("update display_items set starts_at=clock_timestamp()-interval '1 minute', ends_at=clock_timestamp()-interval '3 seconds' where request_id=$1", [second]);
    expect(await screen()).toHaveLength(1);
    await expect(show('countdown', { label: '太长' }, ['8-1'], { duration: 43_201 })).rejects.toThrow('倒计时');
    await clearDisplay(); await show('countdown', { label: '全屏', fullscreen: true }, ['8-1'], { duration: 600 });
    expect((await screen()).map(i => i.content)).toEqual([{ label: '全屏', fullscreen: true }]);
    await expect(show('countdown', { label: '全屏', fullscreen: 'yes' }, ['8-1'], { duration: 600 })).rejects.toThrow('显示方式');
  });
  it('validates content and times', async () => {
    await expect(show('board', { entries: [] })).rejects.toThrow('1–12');
    await expect(show('board', { entries: ['字'.repeat(301)] })).rejects.toThrow('300');
    await expect(show('note', { text: '颜色', color: 'red' })).rejects.toThrow('颜色');
    await expect(show('note', { text: '过去', color: 'red' }, ['8-1'], { end: new Date(Date.now() - 1000).toISOString() })).rejects.toThrow();
    await show('note', { text: '一年', color: 'yellow' }, ['8-2'], { end: new Date(Date.now() + 365 * 86_400_000).toISOString() });
    await expect(show('note', { text: '太远', color: 'yellow' }, ['8-1'], { end: new Date(Date.now() + 401 * 86_400_000).toISOString() })).rejects.toThrow('结束时间');
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
    await expect(db.query('select remove_display_items($1)', [[crypto.randomUUID()]])).rejects.toThrow('管理员');
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
describe('board drafts, scheduled boards and edits', () => {
  const board = { title: '晨会通知', entries: ['升旗仪式'] };
  const later = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
  const save = (id: string, extra: { classes?: string[]; end?: string | null; publish?: string | null; content?: object } = {}) =>
    db.query('select save_board_draft($1,$2,$3,$4,$5::timestamptz,$6::timestamptz)',
      [id, JSON.stringify(extra.content ?? board), extra.classes ?? ['8-1'], '周老师', extra.end ?? null, extra.publish ?? null]);
  const drafts = async () => (await db.query<{ id: string }>('select id from board_drafts')).rows.map(r => r.id);
  it('keeps a draft without showing it, then schedules it to appear later', async () => {
    await clearDisplay(); const id = crypto.randomUUID();
    await identity(admin, 'admin'); await save(id, { classes: [] }); await save(id, { classes: [] });
    expect(await drafts()).toEqual([id]); expect(await screen()).toHaveLength(0);
    await identity(admin, 'admin'); await expect(save(id, { classes: [], publish: later(60), end: later(120) })).rejects.toThrow('请选择班级');
    await expect(save(id, { publish: later(60), end: later(30) })).rejects.toThrow('结束时间');
    await expect(save(id, { publish: later(-1), end: later(30) })).rejects.toThrow('发布时间');
    await save(id, { classes: ['8-1', '8-2'], publish: later(60), end: later(120) });
    expect(await drafts()).toEqual([]);
    const items = await screen(); expect(items).toHaveLength(1); expect(Date.parse(items[0].starts_at)).toBeGreaterThan(Date.now() + 3_500_000);
    await identity(admin, 'admin'); await save(id, { classes: ['8-2'], publish: later(30), end: later(120) });
    expect(await screen()).toHaveLength(0); expect(await screen(second)).toHaveLength(1);
    await identity(admin, 'admin'); await save(id, { classes: ['8-2'] });
    expect(await drafts()).toEqual([id]); expect(await screen(second)).toHaveLength(0);
  });
  it('deletes drafts and pending boards, but never a board already shown', async () => {
    await clearDisplay(); const id = crypto.randomUUID();
    await identity(admin, 'admin'); await save(id, { publish: later(60), end: later(120) });
    await db.query('select delete_board_draft($1)', [id]); expect(await screen()).toHaveLength(0);
    const shown = crypto.randomUUID(); await identity(admin, 'admin'); await save(shown, { publish: later(60), end: later(120) });
    await db.exec('reset role'); await db.query("update display_items set starts_at=clock_timestamp()-interval '1 minute' where request_id=$1", [shown]);
    await identity(admin, 'admin'); await expect(save(shown)).rejects.toThrow('已经发布');
    await db.query('select delete_board_draft($1)', [shown]); expect(await screen()).toHaveLength(1);
  });
  it('edits content and end time of items on screen', async () => {
    await clearDisplay(); const id = await show('board', board, ['8-1', '8-2']);
    const ids = [await rowId(id), await rowId(id, '8-2')];
    const edit = (content: object, end: string, targets = ids) => db.query('select update_display_items($1,$2,$3::timestamptz)', [targets, JSON.stringify(content), end]);
    await identity(admin, 'admin'); await edit({ ...board, entries: ['改到操场'] }, later(90));
    const items = await screen(); expect(items[0].content.entries).toEqual(['改到操场']);
    await identity(admin, 'admin'); await expect(edit({ ...board, entries: [] }, later(90))).rejects.toThrow('1–12');
    await expect(edit(board, later(-1))).rejects.toThrow('结束时间');
    const note = await rowId(await show('note', { text: '便签', color: 'pink' }));
    await identity(admin, 'admin'); await expect(edit(board, later(90), [ids[0], note])).rejects.toThrow('同一类');
    const timer = await rowId(await show('countdown', { label: '考试' }, ['8-1'], { duration: 600 }));
    await identity(admin, 'admin'); await expect(edit({ label: '考试' }, later(13 * 60), [timer])).rejects.toThrow('12 小时');
    await edit({ label: '期中考试', fullscreen: false }, later(30), [timer]);
    expect((await screen()).find(i => i.kind === 'countdown')?.content.label).toBe('期中考试');
    await identity(third); await expect(edit(board, later(90))).rejects.toThrow('管理员');
    await expect(save(crypto.randomUUID())).rejects.toThrow('管理员');
    await expect(db.query('select delete_board_draft($1)', [id])).rejects.toThrow('管理员');
    await expect(db.query('select count(*) from board_drafts')).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });
  it('splits classes edited apart from the rest of their item', async () => {
    await clearDisplay(); const id = await show('board', board, ['8-1', '8-2', '8-3']);
    const ids = await Promise.all(['8-1', '8-2', '8-3'].map(room => rowId(id, room)));
    const edit = (targets: string[]) => db.query('select update_display_items($1,$2,$3::timestamptz)', [targets, JSON.stringify({ ...board, entries: ['改了'] }), later(90)]);
    const requests = async () => { await db.exec('reset role'); return (await db.query<{ request_id: string }>('select request_id from display_items where id = any($1) order by classroom_id', [ids])).rows.map(r => r.request_id); };
    await identity(admin, 'admin'); await edit(ids.slice(1));
    const [one, two, three] = await requests();
    expect(one).toBe(id); expect(two).not.toBe(id); expect(three).toBe(two);
    await identity(admin, 'admin'); await edit([ids[0]]); expect(await requests()).toEqual([id, two, two]);
  });
});
describe('board themes and schedules', () => {
  it('defaults a board to the plain theme and validates the choice', async () => {
    await clearDisplay(); await show('board', { entries: ['节日快乐'], theme: 'festive' });
    await show('board', { entries: ['旧页面'] });
    expect((await screen()).map(i => String(i.content.theme)).toSorted((a, b) => a.localeCompare(b))).toEqual(['festive', 'plain']);
    await expect(show('board', { entries: ['x'], theme: 'neon' })).rejects.toThrow('背景');
  });
  it('keeps the flag-raising choice and defaults it to off', async () => {
    await clearDisplay(); await show('board', { title: '晨会', entries: ['升旗'], flag: true });
    await show('board', { entries: ['旧页面'] });
    expect((await screen()).map(i => String(i.content.flag)).toSorted((a, b) => a.localeCompare(b))).toEqual(['false', 'true']);
    await expect(show('board', { entries: ['x'], flag: 'yes' })).rejects.toThrow('升旗');
  });
  const week = [['english', 'math', 'lunch', 'pe'], ['chinese'], [], ['club', 'it'], ['art', 'elective']];
  const save = (classroom: string, days: unknown) => db.query('select set_schedule($1,$2,$3)', [classroom, JSON.stringify(days), '赵老师']);
  it('saves a weekly schedule that only its own class receives', async () => {
    await identity(admin, 'admin'); await save('8-1', week); await save('8-1', week);
    const rows = await db.query<{ classroom_id: string; days: string[][]; teacher_name: string }>('select classroom_id, days, teacher_name from schedules');
    expect(rows.rows).toEqual([{ classroom_id: '8-1', days: week, teacher_name: '赵老师' }]);
    await identity(third); expect((await scalar<{ schedule: string[][] }>('select device_heartbeat(true)')).schedule).toEqual(week);
    expect((await scalar<{ schedule: string[][] }>('select display_state()')).schedule).toEqual(week);
    await identity(second); expect((await scalar<{ schedule: string[][] | null }>('select display_state()')).schedule).toBeNull();
    expect(await scalar<number>('select count(*)::int from schedules')).toBe(0);
  });
  it('shows today\'s duty roster as the first note, and keeps the roster when saved without one', async () => {
    const duties = [{ task: ' 白板 ', days: ['Sissie', 'Penny', 'Eva', 'Maya', 'Nicole'] }, { task: '扫地', days: ['Daniel', '', 'Milo', 'Alfred', 'Amy'] }];
    await clearDisplay(); await show('note', { text: '老便签', color: 'yellow' });
    await identity(admin, 'admin'); await db.query('select set_schedule($1,$2,$3,$4)', ['8-1', JSON.stringify(week), '赵老师', JSON.stringify(duties)]);
    await save('8-1', week);
    expect(await scalar('select duties from schedules where classroom_id=$1', ['8-1'])).toEqual([{ ...duties[0], task: '白板' }, duties[1]]);
    const day = new Date(Date.now() + 8 * 3_600_000).getUTCDay() - 1;
    const expected = day >= 0 && day < 5 ? [`白板：${duties[0].days[day]}`, duties[1].days[day] && `扫地：${duties[1].days[day]}`].filter(Boolean).join('\n') : null;
    const notes = await screen(); const state = (await scalar<{ items: Shown[] }>('select display_state()')).items;
    expect(notes.map(i => i.content.text)).toEqual(expected ? [expected, '老便签'] : ['老便签']);
    expect(state.map(i => i.content.text)).toEqual(notes.map(i => i.content.text));
    if (expected) expect(Date.parse(notes[0].starts_at)).toBeLessThan(Date.parse(notes[1].starts_at));
    expect((await screen(second)).length).toBe(0);
    await identity(admin, 'admin');
    await expect(db.query('select set_schedule($1,$2,$3,$4)', ['8-1', JSON.stringify(week), '赵老师', JSON.stringify([{ task: '', days: ['', '', '', '', ''] }])])).rejects.toThrow('任务');
    await expect(db.query('select set_schedule($1,$2,$3,$4)', ['8-1', JSON.stringify(week), '赵老师', JSON.stringify([{ task: '扫地', days: ['a'] }])])).rejects.toThrow('格式');
    await db.query('select set_schedule($1,$2,$3,$4)', ['8-1', JSON.stringify(week), '赵老师', '[]']); await clearDisplay();
  });
  it('keeps a class birthday list that only its own class receives', async () => {
    const save = (classroom: string, students: unknown) => db.query('select set_birthdays($1,$2,$3)', [classroom, JSON.stringify(students), '赵老师']);
    await identity(admin, 'admin'); await save('8-1', [{ name: ' 胡昊凯 Martin ', date: '01-02' }, { name: '闰年', date: '02-29' }]);
    await identity(third); expect((await scalar<{ birthdays: unknown }>('select device_heartbeat(true)')).birthdays)
      .toEqual([{ name: '胡昊凯 Martin', date: '01-02' }, { name: '闰年', date: '02-29' }]);
    await identity(second); expect((await scalar<{ birthdays: unknown }>('select display_state()')).birthdays).toBeNull();
    expect(await scalar<number>('select count(*)::int from birthdays')).toBe(0);
    await identity(admin, 'admin');
    await expect(save('8-1', [{ name: '错', date: '02-30' }])).rejects.toThrow('日期');
    await expect(save('8-1', [{ name: '错', date: '13-01' }])).rejects.toThrow('日期');
    await expect(save('8-1', [{ name: '错', date: '2013-01-02' }])).rejects.toThrow('日期');
    await expect(save('8-1', [{ name: ' ', date: '01-02' }])).rejects.toThrow('姓名');
    await identity(first); await expect(save('8-3', [])).rejects.toThrow('管理员');
  });
  it('lets teachers submit and discuss feedback while only the maintainer changes its status', async () => {
    const id = crypto.randomUUID();
    const comment = (body: string) => db.query('select comment_feedback($1,$2,$3,$4)', [crypto.randomUUID(), id, body, '钱老师']);
    const replied = () => scalar<string | null>('select replied_at::text from feedback where id=$1', [id]);
    await identity(admin, 'admin');
    await db.query('select submit_feedback($1,$2,$3,$4)', [id, 'bug', ' 课程表不显示 ', '钱老师']);
    await db.query('select submit_feedback($1,$2,$3,$4)', [id, 'bug', '课程表不显示', '钱老师']);
    expect(await scalar<number>('select count(*)::int from feedback')).toBe(1);
    await comment('补充一下，是 8-3 班');
    expect(await replied()).toBeNull();
    await expect(db.query('select set_feedback_status($1,$2)', [id, 'done'])).rejects.toThrow('维护者');
    await expect(db.query('select submit_feedback($1,$2,$3,$4)', [crypto.randomUUID(), 'idea', '内容', '钱老师'])).rejects.toThrow('类型');
    await identity(admin, 'admin', true);
    await db.query('select set_feedback_status($1,$2)', [id, 'install']);
    await comment('已修好，等教室电脑更新');
    expect(await replied()).not.toBeNull();
    const rows = await db.query<{ body: string; maintainer: boolean }>('select body, maintainer from feedback_comments where feedback_id=$1 order by created_at', [id]);
    expect(rows.rows).toEqual([{ body: '补充一下，是 8-3 班', maintainer: false }, { body: '已修好，等教室电脑更新', maintainer: true }]);
    expect(await scalar<string>('select status from feedback where id=$1', [id])).toBe('install');
    await identity(first); expect(await scalar<number>('select count(*)::int from feedback')).toBe(0);
    await expect(comment('伪造')).rejects.toThrow('管理员');
  });
  it('shares custom subjects and one grade-wide bell table, and sends both to the device', async () => {
    const bells = DEFAULT_BELLS.map(day => [...day]);
    await identity(admin, 'admin');
    expect(await scalar<string>("select add_subject('  实验   课 ')")).toBe('实验 课');
    expect(await scalar<string>("select add_subject('午休', true)")).toBe('午休');
    for (const label of ['实验 课', 'MATH', '数学 math']) await expect(db.query('select add_subject($1)', [label])).rejects.toThrow('已有');
    await expect(db.query("select add_subject('')")).rejects.toThrow('课程名');
    await expect(db.query("select add_subject('一二三四五六七八九十一二三')")).rejects.toThrow('课程名');
    await save('8-1', [['实验 课', '午休'], [], [], [], []]);
    await expect(db.query("select delete_subject('实验 课')")).rejects.toThrow('使用');
    await expect(db.query("select delete_subject('math')")).rejects.toThrow('无法删除');
    await identity(first); await expect(db.query("select add_subject('偷偷加')")).rejects.toThrow('管理员');
    await expect(db.query('select set_lesson_bells($1)', [JSON.stringify(bells)])).rejects.toThrow('管理员');
    await identity(third);
    type Catalog = { subjects: Record<string, { label: string; rest: boolean }>; bells: string[][] };
    const state = await scalar<{ schedule: string[][]; catalog: Catalog }>('select device_heartbeat(true)');
    expect(state.schedule[0]).toEqual(['实验 课', '午休']);
    expect(state.catalog.subjects['午休']).toEqual({ label: '午休', rest: true });
    expect(state.catalog.subjects.lunch).toEqual({ label: '午餐 Lunch', rest: true });
    expect(state.catalog.bells).toEqual(DEFAULT_BELLS);
    bells[0] = ['08:00-08:45', '09:00-09:45']; bells[2] = [];
    await identity(admin, 'admin'); await db.query('select set_lesson_bells($1)', [JSON.stringify(bells)]);
    await identity(third); expect((await scalar<{ catalog: Catalog }>('select display_state()')).catalog.bells).toEqual(bells);
    await identity(admin, 'admin');
    for (const bad of [bells.slice(0, 4), [...bells.slice(0, 4), Array(13).fill('08:00-08:30')], [...bells.slice(0, 4), ['8:00-9:00']], [...bells.slice(0, 4), ['09:00-08:00']],
      [...bells.slice(0, 4), ['08:00-09:00', '08:30-09:30']], [...bells.slice(0, 4), ['08:00-24:00']]])
      await expect(db.query('select set_lesson_bells($1)', [JSON.stringify(bad)])).rejects.toThrow(/作息表|时间/);
    await db.query('select set_lesson_bells($1)', [JSON.stringify(DEFAULT_BELLS)]);
    await db.exec('reset role; delete from schedules'); await identity(admin, 'admin');
    await db.query("select delete_subject('实验 课')"); await db.query("select delete_subject('午休')");
    expect(await scalar<number>('select count(*)::int from subjects')).toBe(14);
    await identity(second); expect((await scalar<{ catalog: unknown }>('select display_state()')).catalog).not.toBeNull();
  });
  it('rejects malformed schedules and non-admin writes', async () => {
    await identity(admin, 'admin');
    await expect(save('8-1', week.slice(0, 4))).rejects.toThrow('格式');
    await expect(save('8-1', [...week.slice(0, 4), Array(13).fill('math')])).rejects.toThrow('格式');
    await expect(save('8-1', [...week.slice(0, 4), 'math'])).rejects.toThrow('格式');
    await expect(save('8-1', [...week.slice(0, 4), ['geography']])).rejects.toThrow('课程');
    await expect(save('8-1', [...week.slice(0, 4), [1]])).rejects.toThrow('课程');
    await expect(save('8-9', week)).rejects.toThrow('班级');
    await identity(first); await expect(save('8-3', week)).rejects.toThrow('管理员');
    await expect(db.query("update schedules set days='[]'")).rejects.toThrow('permission denied');
  });
});

describe('long notes, font sizes and hidden desktops', () => {
  it('accepts 300-character notes with a font size of 18–28, defaulting to 20', async () => {
    await clearDisplay();
    await show('note', { text: '😀'.repeat(300), color: 'yellow', font_size: 28 });
    await show('note', { text: '旧版便签', color: 'blue' });
    const items = await screen();
    expect(items.find(item => item.content.text === '旧版便签')?.content.font_size).toBe(20);
    expect(items.find(item => item.content.font_size === 28)?.content.text).toBe('😀'.repeat(300));
    await expect(show('note', { text: '字'.repeat(301), color: 'yellow' })).rejects.toThrow('300');
    for (const size of [17, 29, 20.5, '20', null]) await expect(show('note', { text: 'bad', color: 'yellow', font_size: size })).rejects.toThrow('字号');
  });
  it('marks the duty roster and puts it first', async () => {
    await clearDisplay(); await show('note', { text: '普通便签', color: 'green' });
    await identity(admin, 'admin');
    await db.query('select set_schedule($1,$2,$3,$4)', ['8-1', JSON.stringify([[], [], [], [], []]), '老师', JSON.stringify([{ task: '白板', days: ['A', 'B', 'C', 'D', 'E'] }])]);
    const weekday = await scalar<boolean>("select extract(isodow from (clock_timestamp() at time zone 'Asia/Shanghai')::date) between 1 and 5");
    const items = await screen();
    if (weekday) expect(items[0]).toMatchObject({ teacher_name: '今日值日', content: { duty: true, color: 'green' } });
    expect(items.find(item => item.content.text === '普通便签')?.content.duty).toBeUndefined();
  });
  it('clears a hidden classroom desktop and restores it unchanged; only admins can switch it', async () => {
    await clearDisplay(); await show('note', { text: '隐藏后仍保留', color: 'pink' }, ['8-1', '8-2']);
    await identity(admin, 'admin');
    await db.query('select set_schedule($1,$2,$3,$4)', ['8-1', JSON.stringify([['math'], ['math'], ['math'], ['math'], ['math']]), '老师', null]);
    await db.query('select set_screen_hidden($1,true)', ['8-1']);
    expect(await scalar<Array<{ id: string; screen_hidden: boolean }>>("select classroom_status()->'classrooms'")).toContainEqual(expect.objectContaining({ id: '8-1', screen_hidden: true }));
    await identity(third);
    expect(await scalar('select display_state()')).toMatchObject({ items: [], schedule: null, birthdays: null });
    expect(await scalar('select device_heartbeat(true)')).toMatchObject({ active: true, display: [], schedule: null, birthdays: null });
    await expect(db.query('select set_screen_hidden($1,false)', ['8-1'])).rejects.toThrow('管理员');
    expect((await screen(second)).map(item => item.content.text)).toContain('隐藏后仍保留');
    await identity(admin, 'admin'); await db.query('select set_screen_hidden($1,false)', ['8-1']);
    await identity(third); const state = await scalar<{ items: Shown[]; schedule: unknown }>('select display_state()');
    expect(state.items.some(item => item.content.text === '隐藏后仍保留')).toBe(true); expect(state.schedule).not.toBeNull();
    await identity(admin, 'admin'); await expect(db.query('select set_screen_hidden($1,true)', ['9-9'])).rejects.toThrow('班级无效');
  });
  it('hides only the timetable of a class, keeping everything else on screen', async () => {
    await clearDisplay(); await show('note', { text: '课表隐藏时仍显示', color: 'blue' });
    await identity(admin, 'admin');
    await db.query('select set_schedule($1,$2,$3,$4)', ['8-1', JSON.stringify([['math'], ['math'], ['math'], ['math'], ['math']]), '老师', null]);
    await db.query('select set_schedule_hidden($1,true)', ['8-1']);
    expect(await scalar<Array<{ id: string; schedule_hidden: boolean }>>("select classroom_status()->'classrooms'")).toContainEqual(expect.objectContaining({ id: '8-1', schedule_hidden: true }));
    await identity(third);
    const hidden = await scalar<{ items: Shown[]; schedule: unknown }>('select display_state()');
    expect(hidden.schedule).toBeNull(); expect(hidden.items.map(item => item.content.text)).toContain('课表隐藏时仍显示');
    expect(await scalar<{ schedule: unknown }>('select device_heartbeat(true)')).toMatchObject({ schedule: null });
    await expect(db.query('select set_schedule_hidden($1,false)', ['8-1'])).rejects.toThrow('管理员');
    await identity(admin, 'admin'); await db.query('select set_schedule_hidden($1,false)', ['8-1']);
    await identity(third); expect((await scalar<{ schedule: unknown }>('select display_state()')).schedule).not.toBeNull();
    await identity(admin, 'admin'); await expect(db.query('select set_schedule_hidden($1,true)', ['9-9'])).rejects.toThrow('班级无效');
    // Leave the original suite's shared fixtures unchanged.
    await db.exec('reset role; delete from schedules'); await clearDisplay();
  });
  it('lets an unbound device read an empty screen', async () => {
    await identity(first); expect(await scalar('select display_state()')).toMatchObject({ items: [], schedule: null });
  });
});

describe('file transfers', () => {
  async function prepare(targets = ['8-1', '8-2'], filename = '课堂资料.pdf', size = 123) {
    const id = crypto.randomUUID();
    await identity(admin, 'admin');
    const { path } = await scalar<{ path: string }>('select prepare_file_transfer($1,$2,$3,$4,$5)', [id, filename, size, targets, '王老师']);
    return { id, path };
  }
  async function upload(path: string, size = 123) {
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('classroom-files',$1,$2)", [path, JSON.stringify({ size })]);
  }
  async function sent() {
    const f = await prepare(); await upload(f.path);
    await db.query('select send_file_transfer($1)', [f.id]);
    return f;
  }
  it('enforces size, Windows filenames, classes, permissions and immutable requests', async () => {
    for (const name of ['../bad.pdf', 'CON.txt', 'LPT¹.txt', 'file.', 'bad:name']) await expect(prepare(['8-1'], name)).rejects.toThrow('文件名');
    await expect(prepare(['8-1'], 'empty.pdf', 0)).rejects.toThrow('大小');
    await expect(prepare(['8-1'], 'big.pdf', 10485761)).rejects.toThrow('10 MB');
    await expect(prepare(['8-1', '8-1'])).rejects.toThrow('班级');
    const f = await prepare();
    await expect(db.query('select send_file_transfer($1)', [f.id])).rejects.toThrow('尚未上传');
    await expect(db.query('select prepare_file_transfer($1,$2,123,$3,$4)', [f.id, 'different.pdf', ['8-1','8-2'], '王老师'])).rejects.toThrow('冲突');
    await identity(second);
    await expect(db.query('select prepare_file_transfer($1,$2,123,$3,$4)', [crypto.randomUUID(), 'a.pdf', ['8-2'], '伪造'])).rejects.toThrow('管理员');
    await expect(upload(f.path)).rejects.toThrow('row-level security');
  });
  it('accepts exactly 10 MiB and caps the Storage bucket at the same size', async () => {
    await prepare(['8-1'], 'limit.pdf', 10485760);
    await db.exec('reset role');
    expect(await scalar<number>("select file_size_limit::int from storage.buckets where id='classroom-files'")).toBe(10485760);
  });
  it('retains old large-file history but refuses new sends above 10 MiB', async () => {
    const sent = crypto.randomUUID(), unsent = crypto.randomUUID();
    await db.exec('reset role');
    for (const id of [sent, unsent])
      await db.query("insert into file_transfers(id,filename,size_bytes,classrooms,teacher_name,created_by,sent_at) values($1,'legacy.pdf',20971520,ARRAY['8-1'],'王老师',$2,$3)",
        [id, admin, id === sent ? new Date().toISOString() : null]);
    await identity(admin, 'admin');
    expect(await scalar('select send_file_transfer($1)', [sent])).toBe(sent);
    expect(await scalar<number>('select size_bytes::int from file_transfers where id=$1', [sent])).toBe(20971520);
    await expect(db.query('select send_file_transfer($1)', [unsent])).rejects.toThrow('10 MB');
    await db.exec('reset role');
    await db.query('update file_transfers set deleted_at=clock_timestamp() where id = any($1)', [[sent, unsent]]);
  });
  it('publishes once and authorizes only the bound target devices to download', async () => {
    const f = await sent();
    await db.query('select send_file_transfer($1)', [f.id]);
    expect(await scalar<number>('select count(*)::int from file_deliveries where transfer_id=$1', [f.id])).toBe(2);
    expect(await scalar<number>('select extract(epoch from expires_at-sent_at)::int from file_transfers where id=$1', [f.id])).toBe(86400);
    await identity(second);
    const batch = await scalar<{ items: { transfer_id: string; object_path: string }[] }>('select pending_file_transfers()');
    expect(batch.items).toContainEqual(expect.objectContaining({ transfer_id: f.id, object_path: f.path }));
    expect(await scalar<number>("select count(*)::int from storage.objects where name=$1", [f.path])).toBe(1);
    await identity(first); // The old device no longer owns 8-1.
    expect(await scalar('select pending_file_transfers()')).toMatchObject({ items: [] });
    expect(await scalar<number>('select count(*)::int from storage.objects where name=$1', [f.path])).toBe(0);
    await identity(second);
    const delivery = await scalar<string>('select id from file_deliveries where transfer_id=$1', [f.id]);
    await db.query("select ack_file_delivery($1,'downloaded',clock_timestamp(),null,'课堂资料.pdf')", [delivery]);
    await db.query("select ack_file_delivery($1,'failed',clock_timestamp(),'late failure')", [delivery]);
    expect(await scalar('select downloaded_at is not null and failed_at is null from file_deliveries where id=$1', [delivery])).toBe(true);
    expect(await scalar('select can_download_classroom_file($1)', [f.path])).toBe(false);
    await identity(third);
    await expect(db.query("select ack_file_delivery($1,'downloaded',clock_timestamp(),null,'forged.pdf')", [delivery])).rejects.toThrow('无权');
  });
  it('cleans terminal, expired, abandoned and orphaned objects but keeps pending downloads', async () => {
    const pending = await sent();
    const done = await sent();
    const expired = await sent();
    const abandoned = await prepare(); await upload(abandoned.path);
    await db.exec('reset role');
    await db.query("update file_deliveries set downloaded_at=clock_timestamp() where transfer_id=$1", [done.id]);
    await db.query("update file_transfers set expires_at=clock_timestamp()-interval '1 second' where id=$1", [expired.id]);
    await db.query("update file_transfers set created_at=clock_timestamp()-interval '2 hours' where id=$1", [abandoned.id]);
    await db.query("insert into storage.objects(bucket_id,name,created_at) values('classroom-files','orphan',clock_timestamp()-interval '2 hours')");
    await expect(db.query("select file_cleanup_candidates('wrong')")).rejects.toThrow('无权');
    const token = await scalar<string>("select decrypted_secret from vault.decrypted_secrets where name='file_cleanup_token'");
    const paths = await scalar<string[]>('select file_cleanup_candidates($1)', [token]);
    expect(paths).toEqual(expect.arrayContaining([done.path, expired.path, abandoned.path, 'orphan']));
    expect(paths).not.toContain(pending.path);
    // Failed Storage removal remains eligible on the next run.
    expect(await scalar<string[]>('select file_cleanup_candidates($1)', [token])).toEqual(paths);
    expect(await scalar<number>("select count(*)::int from cron.jobs where name='cleanup-classroom-files' and schedule='*/15 * * * *'")).toBe(1);
    expect(await scalar<string>("select command from cron.jobs where name='cleanup-classroom-files'")).toContain('timeout_milliseconds := 60000');
    await identity(admin, 'admin');
    await expect(db.query('select file_cleanup_candidates($1)', [token])).rejects.toThrow('permission denied');
  });
  it('caps concurrent reservations at 200 MB and checks the actual uploaded size', async () => {
    const f = await prepare(); await upload(f.path, 124);
    await expect(db.query('select send_file_transfer($1)', [f.id])).rejects.toThrow('尚未上传');
    await db.exec('reset role');
    await db.exec("update file_transfers set deleted_at=clock_timestamp(); delete from storage.objects");
    for (let i = 0; i < 20; i++) await prepare(['8-1'], `f${i}.pdf`, 10485760);
    await expect(prepare()).rejects.toThrow('200 MB');
  });
});

describe('bazaar income ledger', () => {
  const sale = crypto.randomUUID();
  const correction = crypto.randomUUID();
  const record = (id: string, group: string | null, amount: number | null, replaces: string | null = null) =>
    db.query('select record_bazaar_income($1,$2,$3,$4)', [id, group, amount, replaces]);
  type Entry = { id: string; group_name: string; amount: number; occurred_at: string; recorded_at: string; replaces_id: string | null };
  const state = () => scalar<{ classroom_id: string; enabled: boolean; entries: Entry[] }>('select bazaar_state()');

  it('defaults every class to enabled and stores server timestamps with an idempotent request', async () => {
    await identity(admin, 'admin');
    expect((await scalar<{ classrooms: { bazaar_enabled: boolean }[] }>('select classroom_status()')).classrooms.every(c => c.bazaar_enabled)).toBe(true);
    await identity(second); const before = Date.now();
    await record(sale, '  第1组  ', 125); await record(sale, '第1组', 125);
    const batch = await state();
    expect(batch).toMatchObject({ classroom_id: '8-2', enabled: true });
    expect(batch.entries).toHaveLength(1);
    expect(batch.entries[0]).toMatchObject({ id: sale, group_name: '第1组', amount: 125, replaces_id: null });
    expect(Date.parse(batch.entries[0].occurred_at)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(batch.entries[0].recorded_at)).toBeGreaterThanOrEqual(before - 1000);
    await expect(record(sale, '第1组', 130)).rejects.toThrow('编号已使用');
  });
  it('appends corrections, retains original income and sale time, and rejects competing corrections', async () => {
    await identity(second); const original = (await state()).entries[0];
    await record(correction, '第2组', 100, sale); await record(correction, '第2组', 100, sale);
    const entries = (await state()).entries;
    expect(entries).toHaveLength(2);
    expect(entries.find(e => e.id === sale)).toEqual(original);
    expect(entries.find(e => e.id === correction)).toMatchObject({ group_name: '第2组', amount: 100, replaces_id: sale, occurred_at: original.occurred_at });
    await expect(record(crypto.randomUUID(), '第1组', 50, sale)).rejects.toThrow('已被纠错');
    await record(crypto.randomUUID(), '第2组', 0, correction);
    expect((await state()).entries).toHaveLength(3);
  });
  it('validates group names, positive new income, correction bounds and missing records', async () => {
    await identity(second);
    for (const name of [null, '', '  ', '组'.repeat(31)])
      await expect(record(crypto.randomUUID(), name, 1)).rejects.toThrow('小组名称');
    for (const amount of [null, 0, -1, 1, 4, 6, 11, 999999, 1000001])
      await expect(record(crypto.randomUUID(), '第1组', amount)).rejects.toThrow('筹码');
    await expect(record(crypto.randomUUID(), '第1组', 7, correction)).rejects.toThrow('5 的整数倍');
    await expect(record(crypto.randomUUID(), '第1组', 5, crypto.randomUUID())).rejects.toThrow('记录不存在');
    await record(crypto.randomUUID(), '第1组', 5);
  });
  it('isolates classes, blocks direct writes and denies unbound or anonymous submissions', async () => {
    await identity(third);
    expect(await scalar<number>('select count(*)::int from bazaar_entries')).toBe(0);
    expect((await state()).entries).toEqual([]);
    await expect(record(crypto.randomUUID(), '越权', 5, sale)).rejects.toThrow('不属于本班');
    await expect(record(sale, '第1组', 125)).rejects.toThrow('编号已使用');
    await expect(db.query("insert into bazaar_entries(id,classroom_id,group_name,amount,recorded_by) values($1,'8-2','伪造',1,$2)", [crypto.randomUUID(), third])).rejects.toThrow('permission denied');
    await expect(db.query('update bazaar_entries set amount=999')).rejects.toThrow('permission denied');
    await expect(db.query('delete from bazaar_entries')).rejects.toThrow('permission denied');
    await identity(first);
    expect(await state()).toBeNull();
    await expect(record(crypto.randomUUID(), '第1组', 1)).rejects.toThrow('未绑定');
    await db.exec('reset role; set role anon');
    await expect(record(crypto.randomUUID(), '第1组', 1)).rejects.toThrow('permission denied');
    await expect(db.query('select bazaar_state()')).rejects.toThrow('permission denied');
  });
  it('lets only teachers switch display and preserves the full ledger when hidden', async () => {
    await identity(second); const entries = (await state()).entries;
    await expect(db.query("select set_bazaar_enabled('8-2',false)")).rejects.toThrow('管理员');
    await identity(admin, 'admin');
    await db.query("select set_bazaar_enabled('8-2',false)");
    await identity(second); expect(await state()).toEqual({ classroom_id: '8-2', enabled: false, entries });
    await identity(admin, 'admin');
    await db.query("select set_bazaar_enabled('8-2',true)");
    await db.query("select set_screen_hidden('8-2',true)");
    await identity(second); expect((await state()).enabled).toBe(false);
    await identity(admin, 'admin'); await db.query("select set_screen_hidden('8-2',false)");
    await expect(db.query("select set_bazaar_enabled('missing',true)")).rejects.toThrow('班级无效');
    await expect(db.query("select set_bazaar_enabled('8-2',null)")).rejects.toThrow('选项无效');
    await identity(second); expect(await state()).toEqual({ classroom_id: '8-2', enabled: true, entries });
  });
});

describe('homeroom teachers', () => {
  const homeroom = '30000000-0000-4000-8000-000000000001';
  const maintainer = '30000000-0000-4000-8000-000000000002';
  const send = (targets: string[]) => db.query('select create_broadcast($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [crypto.randomUUID(), '请到操场集合。', targets, null, '王老师', 0, true, 'normal', 101001, 'fullscreen', 'top']).then(r => Object.values(r.rows[0] as object)[0] as string);
  const classes = async (id: string) => { await identity(admin, 'admin'); return (await db.query<{ classroom_id: string }>('select classroom_id from deliveries where broadcast_id=$1 order by 1', [id])).rows.map(r => r.classroom_id); };
  beforeAll(async () => {
    await db.exec(`reset role; insert into auth.users values ('${homeroom}'),('${maintainer}');
      insert into homerooms(classroom_id, teacher_name, aliases) values ('8-3', 'Ms.Tong', '{"童老师"}');`);
  });
  it('matches names ignoring case, spaces and dots, before sign-in too', async () => {
    await db.exec('reset role; set role anon');
    expect(await scalar('select homeroom_for_name($1)', ['ms. tong'])).toEqual({ classroom_id: '8-3', claimed: false });
    expect(await scalar('select homeroom_for_name($1)', ['童老师'])).toEqual({ classroom_id: '8-3', claimed: false });
    expect(await scalar('select homeroom_for_name($1)', ['王老师'])).toBeNull();
    await expect(db.query('select * from homerooms')).rejects.toThrow();
  });
  it('keeps an unclaimed class open to every teacher, then only to its homeroom teacher and the maintainer', async () => {
    const week = JSON.stringify([[], [], [], [], []]);
    await identity(admin, 'admin'); await db.query("select set_screen_hidden('8-3', true)");
    await expect(db.query("select set_broadcast_mute('8-3', null, clock_timestamp() + interval '1 hour')")).rejects.toThrow('班主任');
    await db.exec(`reset role; update homerooms set user_id = '${homeroom}', claimed_at = now() where classroom_id = '8-3'`);
    await identity(admin, 'admin');
    await expect(db.query("select set_screen_hidden('8-3', false)")).rejects.toThrow('只有 8-3 班主任');
    await expect(db.query("select set_schedule_hidden('8-3', true)")).rejects.toThrow('只有 8-3 班主任');
    await expect(db.query("select set_schedule('8-3', $1, '王老师')", [week])).rejects.toThrow('只有 8-3 班主任');
    await expect(db.query(`select set_birthdays('8-3', '[]', '王老师')`)).rejects.toThrow('只有 8-3 班主任');
    await db.query("select set_screen_hidden('8-4', true)");
    const rooms = await scalar<Array<Record<string, unknown>>>("select classroom_status()->'classrooms'");
    expect(rooms.find(r => r.id === '8-3')).toMatchObject({ manage: false, own: false, homeroom: { teacher_name: 'Ms.Tong', claimed: true, mine: false } });
    await identity(homeroom, 'admin');
    await db.query("select set_screen_hidden('8-3', false)"); await db.query("select set_schedule('8-3', $1, 'Ms.Tong')", [week]);
    expect((await scalar<Array<Record<string, unknown>>>("select classroom_status()->'classrooms'")).find(r => r.id === '8-3'))
      .toMatchObject({ manage: true, own: true, homeroom: { mine: true } });
    await identity(maintainer, 'admin', true);
    await db.query("select set_screen_hidden('8-3', true)"); await db.query("select set_screen_hidden('8-3', false)"); await db.query("select set_screen_hidden('8-4', false)");
    await db.exec("reset role; delete from schedules where classroom_id = '8-3'");
  });
  it('leaves a paused class out of other teachers broadcasts during the chosen range', async () => {
    await identity(homeroom, 'admin');
    await expect(db.query("select set_broadcast_mute('8-3', null, clock_timestamp() - interval '1 minute')")).rejects.toThrow('暂停时间无效');
    await db.query("select set_broadcast_mute('8-3', clock_timestamp() + interval '1 hour', clock_timestamp() + interval '2 hours')");
    await identity(admin, 'admin'); expect(await classes(await send(['8-3']))).toEqual(['8-3']);
    await identity(homeroom, 'admin'); await db.query("select set_broadcast_mute('8-3', null, clock_timestamp() + interval '1 hour')");
    await identity(admin, 'admin');
    await expect(send(['8-3'])).rejects.toThrow('8-3 班主任已暂停接收广播');
    expect(await classes(await send(['8-3', '8-4']))).toEqual(['8-4']);
    await identity(homeroom, 'admin'); expect(await classes(await send(['8-3']))).toEqual(['8-3']);
    await identity(maintainer, 'admin', true); expect(await classes(await send(['8-3']))).toEqual(['8-3']);
    await identity(admin, 'admin'); await expect(db.query("select set_broadcast_mute('8-3', null, null)")).rejects.toThrow('班主任');
    await identity(homeroom, 'admin'); await db.query("select set_broadcast_mute('8-3', null, null)");
    await identity(admin, 'admin'); expect(await classes(await send(['8-3']))).toEqual(['8-3']);
    await expect(db.query("select create_broadcast_unchecked($1,'x',$2,null,'王老师',0,true,'normal',101001,'fullscreen','top')", [crypto.randomUUID(), ['8-3']])).rejects.toThrow();
  });
});

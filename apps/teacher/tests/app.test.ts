// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '../app/page';
import { OnScreen } from '../app/on-screen';
import { Devices } from '../app/devices';
import { SavedBoards } from '../app/compose/saved-boards';
import { CLASSROOM_IDS, type Classroom, type DisplayItem, type SavedBoard } from '../lib/domain';

let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(App)));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function click(text: string, root: ParentNode = host) {
  const button = Array.from(root.querySelectorAll('button')).find(b => b.textContent?.trim() === text);
  if (!button) throw new Error('Missing button: ' + text);
  await act(async () => button.click());
}
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Reflect.set(HTMLInputElement.prototype, 'value', value, input);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('keeps 300-character notes and offers a few font sizes', async () => {
  await click('便签');
  expect(host.textContent).toContain('/ 300');
  const sizes = Array.from(host.querySelectorAll('fieldset[aria-label="字号"] button')).map(b => b.textContent);
  expect(sizes).toEqual(['小', '标准', '大', '特大']);
  expect(host.querySelector('fieldset[aria-label="字号"] button.active')?.textContent).toBe('标准');
  await click('特大'); expect(host.querySelector('fieldset[aria-label="字号"] button.active')?.textContent).toBe('特大');
});
it('reorders announcement lines by accessible buttons', async () => {
  await click('公告板');
  await type(host.querySelector<HTMLInputElement>('[aria-label="第 1 条"]')!, '第一条');
  await click('添加一条');
  await type(host.querySelector<HTMLInputElement>('[aria-label="第 2 条"]')!, '第二条');
  const down = host.querySelector<HTMLButtonElement>('[aria-label="下移第 1 条"]')!;
  await act(async () => down.click());
  expect(host.querySelector<HTMLInputElement>('[aria-label="第 1 条"]')!.value).toBe('第二条');
  expect(host.querySelector<HTMLInputElement>('[aria-label="第 2 条"]')!.value).toBe('第一条');
});
it('signs every type with the teacher\'s own name unless changed', async () => {
  await act(async () => root.unmount());
  localStorage.setItem('broadcast-teacher-session-v2', '王老师');
  root = createRoot(host); await act(async () => root.render(createElement(App)));
  for (const kind of ['全屏广播', '横幅', '公告板', '便签', '倒计时']) {
    await click(kind);
    expect(host.querySelector<HTMLInputElement>('[aria-label="署名"]')!.value).toBe('王老师');
  }
  const sign = host.querySelector<HTMLInputElement>('[aria-label="署名"]')!;
  await type(sign, '李老师'); await click('全屏广播');
  expect(host.querySelector<HTMLInputElement>('[aria-label="署名"]')!.value).toBe('李老师');
  await type(host.querySelector<HTMLInputElement>('[aria-label="署名"]')!, ' ');
  expect(host.querySelector<HTMLInputElement>('[aria-label="署名"]')!.className).toContain('invalid');
});
it('hides and restores a classroom desktop with one click', async () => {
  const onHide = vi.fn().mockResolvedValue(true);
  const room: Classroom = { id: '8-1', device_id: 'pc', device_name: '8-1 电脑', connected: true, last_seen_at: null };
  const render = (screen_hidden: boolean) => act(async () => root.render(createElement(Devices, { rooms: [{ ...room, screen_hidden }], ready: true, busy: '',
    onBack: vi.fn(), onUnbind: vi.fn(), onHide })));
  await render(false);
  await click('隐藏桌面'); expect(onHide).toHaveBeenCalledWith(expect.objectContaining({ id: '8-1' }), true);
  await render(true);
  expect(host.textContent).toContain('桌面已隐藏');
  await click('恢复桌面'); expect(onHide).toHaveBeenLastCalledWith(expect.objectContaining({ id: '8-1' }), false);
});
it('mounts the complete app and modal provider without configured cloud credentials', () => {
  expect(host.textContent).toContain('广播服务尚未配置');
  expect(host.querySelectorAll('.class-card')).toHaveLength(6);
  expect(Array.from(host.querySelectorAll('.class-status')).every(e => e.textContent === '状态待确认')).toBe(true);
  const send = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.trim() === '发送广播');
  expect(send?.disabled).toBe(true);
});
it('selects and deselects all classrooms in the real React component', async () => {
  await click('全选'); expect(host.querySelectorAll('.class-card[aria-pressed="true"]')).toHaveLength(6);
  await click('取消全选'); expect(host.querySelectorAll('.class-card[aria-pressed="true"]')).toHaveLength(0);
  await act(async () => (host.querySelector('.class-card') as HTMLButtonElement).click());
  expect(host.querySelectorAll('.class-card[aria-pressed="true"]')).toHaveLength(1);
  expect(host.querySelector('.selected-count')?.textContent).toContain('1');
});
it('opens history without presenting fabricated records', async () => {
  await click('广播历史'); expect(host.textContent).toContain('连接后查看广播历史');
  expect(host.querySelectorAll('.history-card')).toHaveLength(0);
  await click('发布'); expect(host.querySelector('textarea')).not.toBeNull();
  await click('正在显示'); expect(host.querySelectorAll('.screen-card')).toHaveLength(6);
  expect(host.textContent).toContain('没有显示内容');
});
it('plays the selected voice from the published static samples', async () => {
  const play = vi.fn().mockResolvedValue(undefined);
  const Audio = vi.fn(function (this: { play: typeof play; pause: () => void }, source: string) {
    expect(source).toBe('/voice-previews/101001.wav');
    this.play = play; this.pause = vi.fn();
  });
  vi.stubGlobal('Audio', Audio);
  await click('试听');
  expect(Audio).toHaveBeenCalledOnce(); expect(play).toHaveBeenCalledOnce();
});
it('writes a template without blanks straight into the broadcast box', async () => {
  await click('戴好红领巾');
  expect(host.querySelector('textarea')?.value).toBe('戴好红领巾');
});
it('collects every blank before replacing the broadcast text', async () => {
  await click('请人到办公室');
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('.blank-input'));
  expect(inputs).toHaveLength(2);
  const submit = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === '填入广播') as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  await type(inputs[0], '张小明');
  await type(inputs[1], '二楼');
  expect(submit.disabled).toBe(false);
  await act(async () => submit.click());
  expect(host.querySelector('textarea')?.value).toBe('请张小明到二楼办公室');
  expect(document.querySelector('.blank-input')).toBeNull();
});
it('picks the type first and shows only the options that apply', async () => {
  const radio = (label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('.kind-card')).find(b => b.textContent === label)!;
  expect(radio('全屏广播').getAttribute('aria-pressed')).toBe('true');
  await act(async () => radio('横幅').click());
  expect(host.textContent).toContain('横幅内容'); expect(host.textContent).toContain('屏幕底部');
  expect(host.textContent).not.toContain('播报几遍'); expect(host.textContent).not.toContain('试听');
  await act(async () => radio('公告板').click());
  expect(host.querySelector('[aria-label="结束日期"]')).not.toBeNull(); expect(host.textContent).not.toContain('定时显示');
  expect(host.textContent).not.toContain('试听');
  expect(host.textContent).not.toContain('朗读');
  await click('添加一条'); expect(host.querySelectorAll('.entry-row')).toHaveLength(2);
  const entries = () => Array.from(host.querySelectorAll<HTMLInputElement>('.entry-row input'));
  const press = (input: HTMLInputElement, isComposing = false) => act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing }));
  });
  await type(entries()[0], '明天穿校服');
  await press(entries()[0], true); expect(entries()).toHaveLength(2);
  await press(entries()[0]);
  expect(entries().map(input => input.value)).toEqual(['明天穿校服', '', '']);
  expect(document.activeElement).toBe(entries()[1]);
  await act(async () => radio('倒计时').click());
  expect(host.querySelector('[aria-label="目标日期（年/月/日）"]')).not.toBeNull();
  await click('按时长'); expect(host.textContent).toContain('25 分钟');
  await act(async () => radio('便签').click());
  const send = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.trim() === '贴上便签');
  expect(send?.disabled).toBe(true);
});
it('keeps each draft when switching types', async () => {
  const radio = (label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('.kind-card')).find(b => b.textContent === label)!;
  await click('戴好红领巾');
  await act(async () => radio('横幅').click()); expect(host.querySelector('textarea')?.value).toBe('');
  await act(async () => radio('全屏广播').click()); expect(host.querySelector('textarea')?.value).toBe('戴好红领巾');
});
it('folds each class on the on-screen tab and removes ticked items together', async () => {
  const now = Date.now(); const onRemove = vi.fn(async () => true);
  const rooms: Classroom[] = ['8-1', '8-2', '8-3'].map(id => ({ id, device_id: null, device_name: null, connected: false, last_seen_at: null }));
  const note = (id: string, request: string, classroom: string, text: string): DisplayItem => ({ id, request_id: request, classroom_id: classroom, kind: 'note',
    content: { text, color: 'yellow' }, starts_at: new Date(now).toISOString(), ends_at: new Date(now + 3_600_000).toISOString(), teacher_name: '李老师',
    created_at: new Date(now).toISOString() });
  const items = [note('a1', 'a', '8-1', '带水杯'), note('a2', 'a', '8-2', '带水杯'), note('b', 'b', '8-1', '交作业')];
  await act(async () => root.render(createElement(OnScreen, { items, rooms, classes: CLASSROOM_IDS, known: false, now, ready: true, busy: '', onRemove, onEdit: vi.fn(), onCopy: vi.fn(), onError: vi.fn() })));
  const headings = () => Array.from(host.querySelectorAll<HTMLButtonElement>('.screen-heading'));
  expect(headings()[0].getAttribute('aria-expanded')).toBe('false'); expect(host.textContent).not.toContain('带水杯');
  expect(headings()[2].disabled).toBe(true); expect(headings()[2].textContent).toContain('没有显示内容');
  await act(async () => headings()[0].click()); expect(host.textContent).toContain('带水杯');
  expect(host.querySelector('.selection-bar')).toBeNull();
  const select = (text: string) => act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('.screen-select')).find(b => b.textContent?.includes(text))!.click());
  await select('交作业'); expect(host.querySelector('.selection-bar')?.textContent).toContain('已选择 1 项');
  await click('选中全部 2 个班级'); expect(host.querySelector('.selection-bar')?.textContent).toContain('已选择 3 项');
  await click('取消全部 2 个班级'); await click('选中全部 2 个班级');
  await click('移除', host.querySelector('.selection-bar')!);
  expect(onRemove).toHaveBeenCalledWith(['b', 'a1', 'a2']); expect(host.querySelector('.selection-bar')).toBeNull();
  await act(async () => headings()[0].click()); expect(host.textContent).not.toContain('带水杯');
});
it('edits items that show the same thing, and hides boards that have not appeared yet', async () => {
  const now = Date.now(); const onEdit = vi.fn(async () => true);
  const rooms: Classroom[] = ['8-1', '8-2'].map(id => ({ id, device_id: null, device_name: null, connected: false, last_seen_at: null }));
  const at = (ms: number) => new Date(ms).toISOString();
  const content = { title: '通知', entries: ['带水杯'], speak: false, voice_type: 101001, theme: 'plain' as const };
  const board = (id: string, classroom: string, start: number, title = content.title): DisplayItem => ({ id, request_id: id[0], classroom_id: classroom, kind: 'board',
    content: { ...content, title }, starts_at: at(start), ends_at: at(now + 3_600_000), teacher_name: '李老师', created_at: at(now) });
  // A realtime update lists the content keys in another order than the overview.
  const reordered: DisplayItem = { ...board('a2', '8-2', now), kind: 'board', content: Object.fromEntries(Object.entries(content).reverse()) as typeof content };
  const items = [board('a1', '8-1', now), reordered, board('b', '8-1', now, '作业'), board('later', '8-2', now + 600_000, '明天的')];
  await act(async () => root.render(createElement(OnScreen, { items, rooms, classes: CLASSROOM_IDS, known: false, now, ready: true, busy: '', onRemove: vi.fn(), onEdit, onCopy: vi.fn(), onError: vi.fn() })));
  const headings = () => Array.from(host.querySelectorAll<HTMLButtonElement>('.screen-heading'));
  await act(async () => headings()[0].click()); await act(async () => headings()[1].click());
  expect(host.textContent).not.toContain('明天的');
  const select = (text: string, index = 0) => act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('.screen-select')).filter(b => b.textContent?.includes(text))[index].click());
  await click('选中全部 2 个班级');
  expect(host.querySelector('.selection-bar')?.textContent).toContain('编辑');
  await select('作业'); expect(host.querySelector('.selection-bar')?.textContent).not.toContain('编辑');
  await select('作业'); await click('取消全部 2 个班级');
  // Copies of one item that were edited apart before such edits split them off still edit together.
  await act(async () => root.render(createElement(OnScreen, { items: [items[0], { ...reordered, content: { ...content, title: '旧通知' } }, ...items.slice(2)], rooms, classes: CLASSROOM_IDS,
    known: false, now, ready: true, busy: '', onRemove: vi.fn(), onEdit, onCopy: vi.fn(), onError: vi.fn() })));
  await click('选中全部 2 个班级'); expect(host.querySelector('.selection-bar')?.textContent).toContain('编辑');
  await select('作业'); expect(host.querySelector('.selection-bar')?.textContent).not.toContain('编辑');
  await select('作业'); await click('编辑', host.querySelector('.selection-bar')!);
  const entry = document.querySelector<HTMLInputElement>('.edit-card [aria-label="第 1 条"]')!;
  expect(entry.value).toBe('带水杯');
  await type(entry, '带水杯和雨伞');
  await click('保存', document.querySelector('.edit-card')!);
  expect(onEdit).toHaveBeenCalledWith(['a1', 'a2'], { ...content, entries: ['带水杯和雨伞'] }, at(now + 3_600_000));
  expect(document.querySelector('.edit-card')).toBeNull(); expect(host.querySelector('.selection-bar')).toBeNull();
});
it('lists scheduled notes with their start and copies ticked items to other classes', async () => {
  const now = Date.now(); const onCopy = vi.fn(async () => true);
  const rooms: Classroom[] = ['8-1', '8-2'].map(id => ({ id, device_id: null, device_name: null, connected: false, last_seen_at: null }));
  const at = (ms: number) => new Date(ms).toISOString();
  const note = (id: string, request: string, classroom: string, start: number): DisplayItem => ({ id, request_id: request, classroom_id: classroom, kind: 'note',
    content: { text: '下午带伞', color: 'blue' }, starts_at: at(start), ends_at: at(now + 7_200_000), teacher_name: '李老师', created_at: at(now) });
  const items = [note('a1', 'a', '8-1', now + 3_600_000), note('a2', 'a', '8-2', now + 3_600_000), note('b', 'b', '8-1', now)];
  await act(async () => root.render(createElement(OnScreen, { items, rooms, classes: CLASSROOM_IDS, known: false, now, ready: true, busy: '', onRemove: vi.fn(), onEdit: vi.fn(), onCopy, onError: vi.fn() })));
  await act(async () => host.querySelector<HTMLButtonElement>('.screen-heading')!.click());
  expect(host.querySelectorAll('.screen-item')).toHaveLength(2); expect(host.querySelector('.screen-item .blue')?.textContent).toContain('发布');
  for (const button of Array.from(host.querySelectorAll<HTMLButtonElement>('.screen-select'))) await act(async () => button.click());
  await click('选中全部 2 个班级');
  await click('复制', host.querySelector('.selection-bar')!);
  const dialog = document.querySelector('.template-card')!;
  expect(dialog.textContent).toContain('复制 2 项到');
  const confirm = () => Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent === '复制')!;
  expect(confirm().disabled).toBe(true);
  await click('8-4', dialog); await click('8-3', dialog); await act(async () => confirm().click());
  expect(onCopy).toHaveBeenCalledWith(['a1', 'b', 'a2'], ['8-3', '8-4']);
  expect(document.querySelector('.template-card')).toBeNull(); expect(host.querySelector('.selection-bar')).toBeNull();
});
it('fills the morning meeting template and schedules a board for later', async () => {
  const radio = (label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('.kind-card')).find(b => b.textContent === label)!;
  await act(async () => radio('公告板').click());
  await click('晨会通知');
  expect(host.querySelector<HTMLInputElement>('[aria-label="公告标题"]')?.value).toBe('晨会通知');
  const time = (label: string) => [host.querySelector<HTMLSelectElement>(`[aria-label="${label}（时）"]`)!.value, host.querySelector<HTMLSelectElement>(`[aria-label="${label}（分）"]`)!.value].join(':');
  expect(time('结束时间')).toBe('08:30');
  expect(host.querySelector('[aria-label="发布日期"]')).toBeNull();
  await click('定时');
  expect(host.querySelector('[aria-label="发布日期"]')).not.toBeNull();
  expect(Array.from(host.querySelectorAll('button')).some(b => b.textContent?.trim() === '定时发布')).toBe(true);
  expect(Array.from(host.querySelectorAll('button')).some(b => b.textContent?.trim() === '存草稿')).toBe(true);
  await click('立即');
  expect(host.querySelector('[aria-label="发布日期"]')).toBeNull();
});
it('lists a teacher\'s own saved boards and folds the other teachers\' ones', async () => {
  const board = (id: string, teacher_name: string): SavedBoard => ({ id, content: { title: id, entries: ['升旗'], speak: false, voice_type: 101001 },
    classrooms: ['8-4'], ends_at: null, publish_at: null, teacher_name, updated_at: '2026-10-18T00:00:00Z' });
  const onDelete = vi.fn();
  await act(async () => root.render(createElement(SavedBoards, { boards: [board('mine', '王老师'), board('a', '李老师'), board('b', '张老师')],
    teacher: '王老师', editing: null, now: Date.now(), ready: true, busy: '', onOpen: vi.fn(), onDelete })));
  const titles = () => Array.from(host.querySelectorAll('.screen-summary')).map(e => e.textContent!.split(' · ')[0]);
  expect(titles()).toEqual(['mine']);
  await click('其他老师的 2 条'); expect(titles()).toEqual(['mine', 'a', 'b']);
  await act(async () => host.querySelectorAll<HTMLButtonElement>('[aria-label="删除"]')[2].click());
  expect(onDelete).toHaveBeenCalledWith('b');
});
it('builds a weekly schedule day by day and keeps it across tabs', async () => {
  await click('课表/值日'); expect(host.querySelector('.day-tabs')).toBeNull();
  await click('8-2'); expect(localStorage.getItem('broadcast-schedule-class')).toBe('8-2');
  const day = (label: string) => act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('.day-tabs button')).find(b => b.textContent?.startsWith(label))!.click());
  await day('周一');
  for (const subject of ['英语 English', '数学 Math', '午餐 Lunch']) await click(subject);
  const selects = () => Array.from(host.querySelectorAll<HTMLSelectElement>('.period-select')).map(select => select.value);
  expect(selects()).toEqual(['english', 'math', 'lunch']);
  await act(async () => (host.querySelector('[aria-label="删除第 2 节"]') as HTMLButtonElement).click());
  expect(selects()).toEqual(['english', 'lunch']);
  await day('周二'); expect(selects()).toEqual([]); await click('体育 PE');
  expect(host.querySelector('.day-tabs')?.textContent).toContain('周一2 节');
  await click('发布'); await click('课表/值日');
  expect(host.querySelector('.day-tabs')?.textContent).toContain('周二1 节');
  const save = () => Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('保存 8-2 课表/值日'))!;
  expect(save().disabled).toBe(true);
  await day('周二'); await click('添加一项');
  await type(host.querySelector<HTMLInputElement>('[aria-label="第 1 项值日"]')!, '白板');
  await type(host.querySelector<HTMLInputElement>('[aria-label="周二白板值日生"]')!, 'Penny');
  await day('周三'); expect(host.querySelector<HTMLInputElement>('[aria-label="周三白板值日生"]')!.value).toBe('');
  await type(host.querySelector<HTMLInputElement>('[aria-label="第 1 项值日"]')!, '');
  await type(host.querySelector<HTMLInputElement>('[aria-label="周三第 1 项值日生"]')!, 'Eva');
  expect(host.querySelector('.duty-task.invalid')).not.toBeNull();
});

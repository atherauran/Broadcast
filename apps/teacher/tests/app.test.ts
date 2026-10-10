// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '../app/page';
import { OnScreen } from '../app/on-screen';
import type { Classroom, DisplayItem } from '../lib/domain';

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
  await click('朗读一遍'); expect(host.textContent).toContain('试听');
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
  expect(host.textContent).toContain('25 分钟');
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
  await act(async () => root.render(createElement(OnScreen, { items, rooms, known: false, now, ready: true, busy: '', onRemove })));
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
it('builds a weekly schedule day by day and keeps it across tabs', async () => {
  await click('课程表'); expect(host.querySelector('.day-tabs')).toBeNull();
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
  await click('发布'); await click('课程表');
  expect(host.querySelector('.day-tabs')?.textContent).toContain('周二1 节');
  const save = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('保存 8-2 课程表'));
  expect(save?.disabled).toBe(true);
});

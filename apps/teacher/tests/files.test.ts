import { expect, it } from 'vitest';
import { fileError, fileStatus, MAX_FILE_BYTES, type FileTransfer, type FileReceipt } from '../lib/files';
it('validates the file limit and Windows filename rules', () => {
  expect(MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
  for (const name of ['../file', 'CON.txt', 'COM¹.exe', 'file.', 'file ', 'file:stream']) expect(fileError({ name, size: 1 })).toContain('文件名');
  expect(fileError({ name: '课堂资料.pdf', size: MAX_FILE_BYTES })).toBeNull();
  expect(fileError({ name: 'empty', size: 0 })).toContain('大小');
  expect(fileError({ name: 'large', size: MAX_FILE_BYTES + 1 })).toBe('文件大小须为 1 字节至 10 MB');
});
it('keeps actual download results after cloud expiry and distinguishes pending downloads', () => {
  const item = { expires_at: new Date(10000).toISOString(), deleted_at: null } as FileTransfer;
  const receipt = { downloaded_at: null, failed_at: null, received_at: null } as FileReceipt;
  expect(fileStatus(receipt, item, 0).label).toBe('等待电脑接收');
  expect(fileStatus({ ...receipt, received_at: 'now' }, item, 0).label).toBe('正在下载');
  expect(fileStatus(receipt, item, 20000).label).toBe('已过期');
  expect(fileStatus({ ...receipt, downloaded_at: 'now' }, item, 20000).label).toBe('已下载到桌面');
  expect(fileStatus({ ...receipt, failed_at: 'now' }, item, 20000).label).toBe('下载失败');
});

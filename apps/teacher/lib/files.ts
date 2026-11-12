export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export type FileReceipt = {
  id: string; classroom_id: string; received_at: string | null; downloaded_at: string | null;
  failed_at: string | null; saved_name: string | null; error: string | null;
};
export type FileTransfer = {
  id: string; filename: string; size_bytes: number; teacher_name: string; created_at: string;
  expires_at: string; deleted_at: string | null; deliveries: FileReceipt[];
};
export function fileError(file: Pick<File, 'name' | 'size'>): string | null {
  if (!file.size || file.size > MAX_FILE_BYTES) return '文件大小须为 1 字节至 20 MB';
  if (file.name.length > 180 || file.name.split('').some(c => c.charCodeAt(0) < 32) || /[<>:"/\\|?*]|[. ]$/.test(file.name)
    || /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$/i.test(file.name.split('.')[0]))
    return '文件名不适用于 Windows，请重命名后上传';
  return null;
}
export const fileSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export function fileStatus(delivery: FileReceipt, transfer: FileTransfer, now: number) {
  if (delivery.downloaded_at) return { label: '已下载到桌面', tone: 'green' };
  if (delivery.failed_at) return { label: '下载失败', tone: 'red' };
  if (Date.parse(transfer.expires_at) <= now || transfer.deleted_at) return { label: '已过期', tone: 'muted' };
  if (delivery.received_at) return { label: '正在下载', tone: 'blue' };
  return { label: '等待电脑接收', tone: 'muted' };
}

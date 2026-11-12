import { useRef, useState } from 'react';
import { FileUp, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Classroom } from '@/lib/domain';
import { fileError, fileSize, fileStatus, type FileTransfer } from '@/lib/files';
import { ClassPicker } from './class-picker';
import { time } from './history';

export function Files({ rooms, known, now, ready, busy, history, hasMore, onMore, onSend, onError }: {
  rooms: Classroom[]; known: boolean; now: number; ready: boolean; busy: string; history: FileTransfer[]; hasMore: boolean;
  onMore: () => void; onSend: (file: File, classrooms: string[]) => Promise<boolean>; onError: (error: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  return <>
    <ClassPicker rooms={rooms} known={known} now={now} selected={selected} setSelected={setSelected} />
    <section className="section file-upload">
      <div className="section-heading"><h1>文件传输</h1></div>
      <p className="muted">自动保存到教室电脑桌面，不会打开。每次一个文件，最大 20 MB；离线电脑可在 24 小时内接收。</p>
      <label className="file-input-label" htmlFor="classroom-file"><FileUp size={22} /><span>{file ? `${file.name} · ${fileSize(file.size)}` : '选择文件'}</span>
      <input ref={input} id="classroom-file" className="file-input" type="file" disabled={!!busy} onChange={event => {
        const picked = event.target.files?.[0];
        if (!picked) return;
        const error = fileError(picked);
        if (error) { onError(error); event.target.value = ''; setFile(null); }
        else { onError(''); setFile(picked); }
      }} /></label>
      <div className="file-send-row"><span className="muted">全部下载完成或过期后自动清理云端文件</span>
        <Button className="action primary" disabled={!ready || !!busy || !file || !selected.length || selected.some(id => !rooms.find(room => room.id === id)?.device_id)}
          onClick={async () => {
            if (file && await onSend(file, selected)) { setFile(null); if (input.current) input.current.value = ''; }
          }}><Send size={17} />{busy === 'files' ? '正在上传并发送…' : '发送文件'}</Button>
      </div>
      {selected.some(id => !rooms.find(room => room.id === id)?.device_id) && <p className="error">所选班级尚未绑定电脑</p>}
    </section>
    <section className="history-section">
      <div className="section-heading"><h2>传输记录</h2></div>
      {!history.length && <p className="empty-state muted">还没有传输记录</p>}
      {history.map(item => <article key={item.id} className="history-card file-history">
        <div className="history-meta"><span><strong>{item.teacher_name}</strong><time>{time(item.created_at)}</time></span><span>{fileSize(item.size_bytes)}</span></div>
        <h3>{item.filename}</h3>
        <div className="receipts">{item.deliveries.map(delivery => {
          const status = fileStatus(delivery, item, now);
          return <div className="receipt-row file-receipt" key={delivery.id}>
            <span className="receipt-class">{delivery.classroom_id}</span><span className={'receipt-state ' + status.tone}>{status.label}</span>
            {(delivery.error || delivery.saved_name) && <span className="muted file-saved-name">{delivery.error || delivery.saved_name}</span>}
          </div>;
        })}</div>
      </article>)}
      {hasMore && <Button variant="outline" className="action load-more" disabled={!ready || !!busy} onClick={onMore}>加载更多</Button>}
    </section>
  </>;
}

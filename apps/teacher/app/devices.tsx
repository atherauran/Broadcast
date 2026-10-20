import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from '@/components/ui/alert-dialog';
import type { Classroom } from '@/lib/domain';

export function Devices({ rooms, ready, busy, onBack, onUnbind, onHide }: {
  rooms: Classroom[]; ready: boolean; busy: string; onBack: () => void; onUnbind: (room: Classroom) => Promise<boolean>;
  onHide: (room: Classroom, hidden: boolean) => Promise<boolean>;
}) {
  const [confirmRoom, setConfirmRoom] = useState<Classroom | null>(null);
  return <section className="section devices-panel">
    <Button variant="ghost" className="back-button" onClick={onBack}><ArrowLeft size={18} />返回广播</Button>
    <h1>教室设备</h1>
    <p className="muted device-intro">隐藏桌面会收起该班电脑上的公告、便签、课表等，恢复后原样显示。更换电脑前，可在这里解除原设备绑定。</p>
    {rooms.map(room => <div className="device-row" key={room.id}>
      <div><strong>{room.id}</strong><p className="muted">{room.device_name || '未绑定设备'}{room.screen_hidden && <span className="screen-hidden"> · 桌面已隐藏</span>}</p></div>
      <div className="device-actions">
        <Button variant="outline" className="action" disabled={!ready || !!busy} onClick={() => void onHide(room, !room.screen_hidden)}>{room.screen_hidden ? '恢复桌面' : '隐藏桌面'}</Button>
        <Button variant="outline" className="action" disabled={!room.device_id || !ready} onClick={() => setConfirmRoom(room)}>解绑</Button>
      </div>
    </div>)}
    <AlertDialog open={!!confirmRoom} onOpenChange={open => { if (!open && !busy) setConfirmRoom(null); }}>
      <AlertDialogContent className="confirm-card">
        <AlertDialogTitle>解除 {confirmRoom?.id} 的绑定？</AlertDialogTitle>
        <AlertDialogDescription>这台电脑将停止接收广播，班级可以绑定新设备。</AlertDialogDescription>
        <div className="confirm-actions">
          <AlertDialogCancel className="action" disabled={!!busy}>取消</AlertDialogCancel>
          <Button className="action primary" disabled={!!busy} onClick={() => void onUnbind(confirmRoom!).then(ok => { if (ok) setConfirmRoom(null); })}>确认解绑</Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}

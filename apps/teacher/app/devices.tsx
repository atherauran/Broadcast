import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from '@/components/ui/alert-dialog';
import type { Classroom } from '@/lib/domain';
import { muteStatus } from './homeroom';

export function Devices({ rooms, now, ready, busy, onBack, onUnbind, onHide, onHideSchedule }: {
  rooms: Classroom[]; now: number; ready: boolean; busy: string; onBack: () => void; onUnbind: (room: Classroom) => Promise<boolean>;
  onHide: (room: Classroom, hidden: boolean) => Promise<boolean>; onHideSchedule: (room: Classroom, hidden: boolean) => Promise<boolean>;
}) {
  const [confirmRoom, setConfirmRoom] = useState<Classroom | null>(null);
  return <section className="section devices-panel">
    <Button variant="ghost" className="back-button" onClick={onBack}><ArrowLeft size={18} />返回广播</Button>
    <h1>教室设备</h1>
    <p className="muted device-intro">隐藏桌面会收起该班电脑上的公告、便签、课表等，隐藏课表只收起课表；恢复后原样显示；班主任设置密码后，只有班主任可以操作本班桌面。更换电脑前，可在这里解除原设备绑定。</p>
    {rooms.map(room => {
      // A claimed class is managed from its homeroom teacher's panel; only the maintainer still gets these buttons here.
      const managedByHomeroom = !!room.homeroom?.claimed && !(room.own && !room.homeroom.mine);
      return <div className="device-row" key={room.id}>
      <div><p className="device-title"><strong>{room.id}</strong><span className="muted">{room.device_name || '未绑定设备'}</span>{room.screen_hidden && <span className="screen-hidden">桌面已隐藏</span>}{room.schedule_hidden && <span className="screen-hidden">课表已隐藏</span>}</p>
        {room.homeroom && <p className="muted">班主任 {room.homeroom.teacher_name}{room.homeroom.claimed ? '' : '（未设置密码）'}</p>}
        {muteStatus(room, now) && <p className="screen-hidden">广播{muteStatus(room, now)}</p>}</div>
      <div className="device-actions">
        {!managedByHomeroom && <>
          <Button variant="outline" className="action" disabled={!ready || !!busy} onClick={() => void onHide(room, !room.screen_hidden)}>{room.screen_hidden ? '恢复桌面' : '隐藏桌面'}</Button>
          <Button variant="outline" className="action" disabled={!ready || !!busy} onClick={() => void onHideSchedule(room, !room.schedule_hidden)}>{room.schedule_hidden ? '显示课表' : '隐藏课表'}</Button>
        </>}
        <Button variant="outline" className="action" disabled={!room.device_id || !ready} onClick={() => setConfirmRoom(room)}>解绑</Button>
      </div>
    </div>; })}
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

import { ChevronRight, Clock3, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EMOTIONS, VOICES, deliveryStatus, isOnline, type Broadcast, type Classroom } from '@/lib/domain';

const timeFormat = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
export const time = (value: string) => timeFormat.format(new Date(value));

export function broadcastMeta(item: Broadcast): string {
  const emoji = EMOTIONS.find(e => e.id === item.emotion)?.emoji;
  if (item.style === 'banner') return ['横幅', item.banner_position === 'bottom' ? '底部' : '顶部', emoji].filter(Boolean).join(' · ');
  const voice = VOICES.find(v => v.id === item.voice_type)?.name;
  return [emoji || '无 emoji', item.repeat_count ? `播放 ${item.repeat_count} 遍` : '仅文字', voice, item.auto_close ? '自动关闭' : '手动关闭'].join(' · ');
}

export function Receipts({ item, rooms, known, now }: { item: Broadcast; rooms: Classroom[]; known: boolean; now: number }) {
  return <div className="receipts">{item.deliveries.map(delivery => {
    const state = deliveryStatus(delivery, item, now);
    const room = rooms.find(r => r.id === delivery.classroom_id)!;
    return <div className="receipt-row" key={delivery.id}>
      <span className="receipt-class">{delivery.classroom_id}<span className={'tiny-dot ' + (known && isOnline(room, now) ? 'online' : '')} /></span>
      <span className={'receipt-state ' + state.tone}>{state.label}</span>
      {known && !isOnline(room, now) && <span className="muted receipt-offline">当前离线</span>}
    </div>;
  })}</div>;
}

export function History({ history, expanded, setExpanded, hasMore, canLoad, onLoadMore, onResend, rooms, known, now, configured }: {
  history: Broadcast[]; expanded: string | null; setExpanded: (id: string | null) => void; hasMore: boolean; canLoad: boolean;
  onLoadMore: () => void; onResend: (item: Broadcast) => void; rooms: Classroom[]; known: boolean; now: number; configured: boolean;
}) {
  return <section className="history-section">
    <div className="section-heading"><h1>广播历史</h1><span className="muted">按发送时间排列</span></div>
    {!history.length && <div className="empty-state">
      <Clock3 size={32} /><h2>{configured ? '还没有广播记录' : '连接后查看广播历史'}</h2><p className="muted">发过的内容和教室回执会保存在这里。</p>
    </div>}
    {history.map(item => {
      const open = expanded === item.id;
      const textOnly = item.repeat_count === 0;
      const done = item.deliveries.filter(d => textOnly ? d.finished_at : d.played_at).length;
      return <article key={item.id} className="history-card">
        <button className="history-summary" aria-expanded={open} onClick={() => setExpanded(open ? null : item.id)}>
          <span className="history-meta"><span><strong>{item.teacher_name}</strong><time>{time(item.created_at)}</time></span><span>{item.deliveries.length} 个班级</span></span>
          <p className="broadcast-body">{item.body}</p>
          <span className="broadcast-meta">{broadcastMeta(item)}</span>
          <span className="history-footer">
            <span>{done} / {item.deliveries.length} {textOnly ? '已完成' : '已播放'}</span>
            <span>送达详情<ChevronRight size={17} className={open ? 'rotated' : ''} /></span>
          </span>
        </button>
        {open && <div className="history-detail">
          <Receipts item={item} rooms={rooms} known={known} now={now} />
          <Button variant="outline" className="action resend" onClick={() => onResend(item)}><Send size={16} />重新发送</Button>
        </div>}
      </article>;
    })}
    {hasMore && <Button variant="outline" className="action load-more" disabled={!canLoad} onClick={onLoadMore}>加载更多</Button>}
  </section>;
}

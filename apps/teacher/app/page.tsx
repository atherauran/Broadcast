import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { ArrowUpRight, AudioLines, Cake, CalendarDays, Clock3, LogOut, MessageSquareText, MonitorPlay, Radio, Settings2, WifiOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { registerBroadcastTools } from '@/lib/webmcp';
import { adminEmail, configured, getBirthdays, getBoardDrafts, getClassrooms, getFeedback, getHistory, getOverview, getSchedules, maintainerEmail, once, rpc, supabase } from '@/lib/api';
import { CLASSROOM_IDS, boardEntries, endOfDay, isOnline, localInput, patchBirthdays, patchBoardDrafts, patchDelivery, patchDisplayItems, patchRoom, patchSchedule, savedBoards,
  todayAt, validTeacherName, type BoardDraftRow, type Broadcast, type Classroom, type DeliveryRow, type DisplayItem, type DisplayRow, type Kind,
  type BirthdayList, type Feedback, type FeedbackKind, type FeedbackStatus, type SavedBoard, type Schedule, type Week } from '@/lib/domain';
import { Login } from './login';
import { Compose } from './compose/compose';
import { blankBoard, initialDrafts, type Drafts, type Patch } from './compose/drafts';
import { History, Receipts, broadcastMeta, time } from './history';
import { OnScreen } from './on-screen';
import { Devices } from './devices';
import { BirthdayEditor, type BirthdayRow } from './birthdays';
import { ScheduleEditor } from './schedule';
import { FeedbackDialog, FeedbackNews } from './feedback';

const emptyRooms: Classroom[] = CLASSROOM_IDS.map(id => ({ id, device_id: null, device_name: null, connected: false, last_seen_at: null }));
const message = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试';
const teacherKey = 'broadcast-teacher-session-v2';
const rememberedTeacher = () => localStorage.getItem(teacherKey)?.trim() || '';
const introKey = 'broadcast-feedback-intro';
// The newest feedback activity each teacher name has seen in this browser.
const seenKey = 'broadcast-feedback-seen';
const readSeen = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(seenKey) || '{}'); } catch { return {}; } };
// An empty endAt means the end of the day the item starts.
const endsAt = (endAt: string, start: number) => new Date(endAt || endOfDay(start)).toISOString();

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!configured);
  const [password, setPassword] = useState('');
  const [loginName, setLoginName] = useState('');
  const [teacherName, setTeacherName] = useState(rememberedTeacher);
  const [rooms, setRooms] = useState<Classroom[]>(emptyRooms);
  const [selected, setSelected] = useState<string[]>([]);
  const [kind, setKind] = useState<Kind>('alert');
  const [drafts, setDrafts] = useState<Drafts>(initialDrafts);
  const [history, setHistory] = useState<Broadcast[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [overview, setOverview] = useState<DisplayItem[]>([]);
  const [boardDrafts, setBoardDrafts] = useState<BoardDraftRow[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [birthdays, setBirthdays] = useState<BirthdayList[]>([]);
  const [birthdayDrafts, setBirthdayDrafts] = useState<Record<string, BirthdayRow[]>>({});
  const [weekDrafts, setWeekDrafts] = useState<Record<string, Week>>({});
  const [feedback, setFeedback] = useState<Feedback[] | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState<{ focus: string | null } | null>(null);
  const [seenMap, setSeenMap] = useState(readSeen);
  const [intro, setIntro] = useState(() => !localStorage.getItem(introKey));
  const [tab, setTab] = useState<'send' | 'screen' | 'history' | 'schedule' | 'birthdays' | 'devices'>('send');
  const [latestId, setLatestId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [live, setLive] = useState(false);
  const [network, setNetwork] = useState(navigator.onLine);
  const [now, setNow] = useState(Date.now);
  // Server time is the local clock until the first response calibrates it.
  const clock = useRef({ server: 0, local: 0 });
  const historyRef = useRef(history);
  const sw = useRegisterSW();
  const userId = session?.user.id;
  const maintainer = session?.user.app_metadata.maintainer === true;

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    void supabase.auth.getSession().then(async ({ data, error }) => {
      if (!mounted) return;
      if (error) setError('登录状态读取失败，请重新登录');
      if (data.session && !validTeacherName(rememberedTeacher())) {
        await supabase!.auth.signOut({ scope: 'local' });
        if (!mounted) return;
        setSession(null); setTeacherName(''); setAuthReady(true);
        return;
      }
      setSession(data.session); setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, current) => { setSession(current); setAuthReady(true); if (!current) setLive(false); });
    return () => { mounted = false; data.subscription.unsubscribe(); };
  }, []);
  const serverNow = () => clock.current.server + performance.now() - clock.current.local;
  useEffect(() => {
    clock.current = { server: Date.now(), local: performance.now() };
    const online = () => setNetwork(true);
    const offline = () => { setNetwork(false); setLive(false); };
    window.addEventListener('online', online); window.addEventListener('offline', offline);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, []);
  // Only the on-screen tab shows a countdown, so only it needs a per-second render.
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) setNow(serverNow()); }, tab === 'screen' ? 1000 : 5000);
    return () => clearInterval(timer);
  }, [tab]);
  useEffect(() => { historyRef.current = history; }, [history]);
  const mergeHistory = useCallback((items: Broadcast[]) => setHistory(old => {
    const all = new Map(old.map(item => [item.id, item]));
    items.forEach(item => all.set(item.id, item));
    return [...all.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }), []);
  const sync = useCallback((server: string) => {
    clock.current = { server: Date.parse(server), local: performance.now() };
    setNow(clock.current.server);
  }, []);
  const refreshRooms = useCallback(async () => {
    const result = await getClassrooms();
    sync(result.server_now); setRooms(result.classrooms);
  }, [sync]);
  const refreshFeedback = useCallback(async () => setFeedback(await getFeedback()), []);
  const refreshOverview = useCallback(async () => {
    const result = await getOverview();
    sync(result.server_now); setOverview(result.items);
  }, [sync]);
  useEffect(() => {
    if (!userId || !supabase || !network) return;
    let disposed = false;
    // Deliveries of a broadcast this page has not loaded yet wait here while its history is fetched once.
    const loading = new Map<string, DeliveryRow[]>();
    const load = async () => {
      try {
        await refreshRooms();
        const [items, weeks, saved, lists, tickets] = await Promise.all([getHistory(), getSchedules(), getBoardDrafts(), getBirthdays(), getFeedback(), refreshOverview()]);
        if (!disposed) { mergeHistory(items); setHasMore(items.length === 20); setSchedules(weeks); setBoardDrafts(saved); setBirthdays(lists); setFeedback(tickets); }
      } catch (e) { if (!disposed) { setError(message(e)); setLive(false); } }
    };
    const channel = supabase.channel('teacher-status')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, payload => {
        if (payload.eventType !== 'DELETE') setRooms(old => patchRoom(old, payload.new as Parameters<typeof patchRoom>[1]));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'classrooms' }, () => { void refreshRooms().catch(e => setError(message(e))); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'display_items' }, payload => {
        const removal = payload.eventType === 'DELETE';
        setOverview(old => patchDisplayItems(old, removal, (removal ? payload.old : payload.new) as DisplayRow));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'board_drafts' }, payload => {
        const removal = payload.eventType === 'DELETE';
        setBoardDrafts(old => patchBoardDrafts(old, removal, (removal ? payload.old : payload.new) as BoardDraftRow));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, payload => {
        if (payload.eventType !== 'DELETE') setSchedules(old => patchSchedule(old, payload.new as Schedule));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'birthdays' }, payload => {
        if (payload.eventType !== 'DELETE') setBirthdays(old => patchBirthdays(old, payload.new as BirthdayList));
      })
      // Comments touch their feedback row too, so this one table covers all feedback activity.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feedback' }, () => { void refreshFeedback().catch(e => setError(message(e))); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, payload => {
        if (payload.eventType === 'DELETE') return;
        const row = payload.new as DeliveryRow;
        const id = row.broadcast_id;
        if (historyRef.current.some(item => item.id === id)) { setHistory(old => patchDelivery(old, row)); return; }
        const waiting = loading.get(id);
        if (waiting) { waiting.push(row); return; }
        loading.set(id, [row]);
        void getHistory(null, id).then(items => {
          if (disposed) return;
          mergeHistory(items);
          setHistory(old => (loading.get(id) ?? []).reduce(patchDelivery, old));
        }).catch(e => { if (!disposed) setError(message(e)); }).finally(() => loading.delete(id));
      })
      .subscribe(status => {
        if (disposed) return;
        setLive(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED') void load();
      });
    // A brief switch away keeps the socket alive and misses nothing; a longer one may have lost events, so reload then.
    let hiddenAt = 0;
    const resume = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (Date.now() - hiddenAt > 30_000) void load();
    };
    document.addEventListener('visibilitychange', resume);
    return () => { disposed = true; document.removeEventListener('visibilitychange', resume); void supabase!.removeChannel(channel); };
  }, [userId, network, refreshRooms, refreshOverview, refreshFeedback, mergeHistory]);
  useEffect(() => { localStorage.setItem('broadcast-draft', drafts.alert.body); }, [drafts.alert.body]);
  const patch: Patch = useCallback((key, change) => setDrafts(old => ({ ...old, [key]: { ...old[key], ...change } })), []);

  async function run(name: string, action: () => Promise<void>): Promise<boolean> {
    setBusy(name); setError('');
    try { await action(); return true; } catch (e) { setError(message(e)); return false; } finally { setBusy(''); }
  }
  function logout() {
    void run('logout', async () => {
      const { error } = await supabase!.auth.signOut({ scope: 'local' });
      if (error) throw error;
      localStorage.removeItem(teacherKey);
      setTeacherName(''); setHistory([]); setOverview([]); setBoardDrafts([]); setSchedules([]); setWeekDrafts({}); setBirthdays([]); setBirthdayDrafts({}); setRooms(emptyRooms); setFeedback(null); setFeedbackOpen(null);
    });
  }
  async function login() {
    if (!validTeacherName(loginName)) { setError('请输入 1–40 字老师姓名'); return; }
    await run('login', async () => {
      let result = await supabase!.auth.signInWithPassword({ email: adminEmail, password });
      // The maintainer signs in on the same form with their own password.
      if (result.error) result = await supabase!.auth.signInWithPassword({ email: maintainerEmail, password });
      if (result.error) throw new Error('密码不正确或登录服务暂不可用');
      if (result.data.user.app_metadata.role !== 'admin') { await supabase!.auth.signOut(); throw new Error('此账号没有管理员权限'); }
      const name = loginName.trim();
      localStorage.setItem(teacherKey, name); setTeacherName(name); setPassword(''); setLoginName('');
    });
  }
  async function sendBroadcast(input: Record<string, unknown>) {
    const classrooms = [...selected].sort();
    const id = await once('broadcast-attempt', [input, classrooms, teacherName], id =>
      rpc<string>('create_broadcast', { p_id: id, p_classrooms: classrooms, p_teacher_name: teacherName, ...input }));
    setLatestId(id);
    // While live, the new delivery rows arrive over Realtime and fetch this broadcast themselves.
    if (!live) await getHistory(null, id).then(mergeHistory).catch(() => setError('广播已创建，回执暂时无法读取，请检查历史记录'));
  }
  const boardContent = () => {
    const b = drafts.board;
    // Boards are never read aloud; the server still expects the reading fields.
    return { title: b.title.trim(), entries: boardEntries(b.entries), speak: false, voice_type: 101001, theme: b.theme, flag: b.flag };
  };
  // Saving under the same id replaces the earlier draft or schedule; without publishAt it stays a draft.
  async function saveBoard(publishAt: string) {
    const b = drafts.board;
    const start = publishAt ? Date.parse(publishAt) : now;
    await rpc('save_board_draft', { p_id: b.draftId ?? crypto.randomUUID(), p_content: boardContent(), p_classrooms: [...selected].sort(),
      p_teacher_name: teacherName, p_ends_at: publishAt || b.endAt ? endsAt(b.endAt, start) : null, p_publish_at: publishAt ? new Date(start).toISOString() : null });
    if (!live) await Promise.all([getBoardDrafts().then(setBoardDrafts), refreshOverview()]);
  }
  function saveDraft() {
    void run('draft', async () => { await saveBoard(''); patch('board', blankBoard()); });
  }
  function openSaved(board: SavedBoard) {
    const { content } = board;
    patch('board', { title: content.title, entries: content.entries, theme: content.theme ?? 'plain', flag: !!content.flag,
      endAt: board.ends_at ? localInput(Date.parse(board.ends_at)) : '', publishAt: board.publish_at ? localInput(Date.parse(board.publish_at)) : '', draftId: board.id });
    setSelected(board.classrooms);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function deleteSaved(id: string) {
    void run('draft', async () => {
      await rpc('delete_board_draft', { p_id: id });
      if (drafts.board.draftId === id) patch('board', { draftId: null });
      if (!live) await Promise.all([getBoardDrafts().then(setBoardDrafts), refreshOverview()]);
    });
  }
  async function createDisplay(display: 'board' | 'note' | 'countdown', content: object, times: object) {
    const classrooms = [...selected].sort();
    await once('display-attempt', [display, content, times, classrooms, teacherName], id =>
      rpc('create_display_item', { p_request: id, p_kind: display, p_classrooms: classrooms, p_content: content, p_teacher_name: teacherName, ...times }));
    if (!live) await refreshOverview().catch(e => setError(message(e)));
  }
  function submit() {
    void run('send', async () => {
      if (kind === 'alert') {
        const a = drafts.alert;
        await sendBroadcast({ p_body: a.body, p_source: a.sourceId, p_repeat_count: a.repeatCount, p_auto_close: a.autoClose, p_emotion: a.emotion,
          p_voice_type: a.voiceType, p_style: 'fullscreen', p_banner_position: 'top' });
        patch('alert', { sourceId: null });
      } else if (kind === 'banner') {
        const b = drafts.banner;
        await sendBroadcast({ p_body: b.body, p_source: null, p_repeat_count: 0, p_auto_close: true, p_emotion: b.emotion,
          p_voice_type: 101001, p_style: 'banner', p_banner_position: b.position });
      } else if (kind === 'board') {
        const b = drafts.board;
        if (b.publishAt) await saveBoard(b.publishAt);
        else {
          await createDisplay('board', boardContent(), { p_ends_at: endsAt(b.endAt, now) });
          // Published from a saved board, which is no longer needed.
          if (b.draftId) await rpc('delete_board_draft', { p_id: b.draftId });
        }
        patch('board', blankBoard());
      } else if (kind === 'note') {
        await createDisplay('note', { text: drafts.note.text.trim(), color: drafts.note.color }, { p_ends_at: endsAt(drafts.note.endAt, now) });
        patch('note', { text: '' });
      } else {
        const c = drafts.countdown;
        if (c.mode === 'days') await createDisplay('countdown', { label: c.label.trim(), fullscreen: false, date: c.date }, { p_ends_at: new Date(`${c.date}T23:59:59`).toISOString() });
        else await createDisplay('countdown', { label: c.label.trim(), fullscreen: c.fullscreen }, c.mode === 'until'
          ? { p_ends_at: new Date(todayAt(now, c.until)).toISOString() } : { p_duration_seconds: c.minutes * 60 });
        patch('countdown', { label: '' });
      }
    });
  }
  function resend(item: Broadcast) {
    if (item.style === 'banner') { patch('banner', { body: item.body, emotion: item.emotion, position: item.banner_position }); setKind('banner'); }
    else {
      patch('alert', { body: item.body, sourceId: item.id, repeatCount: item.repeat_count, autoClose: item.auto_close, emotion: item.emotion, voiceType: item.voice_type });
      setKind('alert');
    }
    setSelected(item.deliveries.map(d => d.classroom_id));
    setTab('send'); setLatestId(null); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  // Teachers follow the maintainer's replies to their own feedback; the maintainer follows all activity.
  const mark = (item: Feedback) => maintainer ? item.updated_at : item.teacher_name === teacherName ? item.replied_at : null;
  const latestMark = (feedback ?? []).reduce((max, item) => { const at = mark(item); return at && at > max ? at : max; }, '');
  const seen = seenMap[teacherName];
  const unread = !!feedback && seen !== undefined && latestMark > seen;
  function markSeen(at: string) {
    const next = { ...seenMap, [teacherName]: at };
    localStorage.setItem(seenKey, JSON.stringify(next)); setSeenMap(next);
  }
  // Nothing is announced until this browser has opened feedback or sent some, so old replies never pop up on a new device.
  const news = !maintainer && unread && !feedbackOpen ? feedback.filter(item => item.teacher_name === teacherName && item.replied_at && item.replied_at > seen) : [];
  function openFeedback(focus: string | null = null) {
    setFeedbackOpen({ focus });
    if (intro) { localStorage.setItem(introKey, '1'); setIntro(false); }
  }
  function closeFeedback() { setFeedbackOpen(null); markSeen(latestMark); }
  async function submitFeedback(kind: FeedbackKind, body: string) {
    await once('feedback-attempt', [kind, body, teacherName], id => rpc('submit_feedback', { p_id: id, p_kind: kind, p_body: body, p_teacher_name: teacherName }));
    if (seen === undefined) markSeen(latestMark);
    if (!live) await refreshFeedback();
  }
  async function commentFeedback(id: string, body: string) {
    await once('comment-attempt', [id, body, teacherName], cid => rpc('comment_feedback', { p_id: cid, p_feedback: id, p_body: body, p_teacher_name: teacherName }));
    if (!live) await refreshFeedback();
  }
  async function setFeedbackStatus(id: string, status: FeedbackStatus) {
    await rpc('set_feedback_status', { p_feedback: id, p_status: status });
    if (!live) await refreshFeedback();
  }

  const known = configured && !!session && live && network;
  const ready = configured && !!session && network && validTeacherName(teacherName);
  const latest = history.find(b => b.id === latestId);
  useEffect(() => registerBroadcastTools(
    () => ({ connected: known, classrooms: rooms.map(room => ({ id: room.id, online: known ? isOnline(room, serverNow()) : null })) }),
    (text, targets) => { patch('alert', { body: text, sourceId: null }); setSelected(targets); setKind('alert'); setTab('send'); },
  ), [known, rooms, patch]);

  if (configured && !authReady) return <main className="login-shell"><p>正在恢复登录…</p></main>;
  if (configured && !session) return <Login name={loginName} setName={setLoginName} password={password} setPassword={setPassword}
    error={error} busy={busy} network={network} onSubmit={() => void login()} />;
  return <div className="app-shell">
    <header className="app-header">
      <div className="brand"><span className="brand-icon"><Radio size={22} /></span><span>校园广播</span></div>
      <div className="header-actions">
        <span className="teacher-chip">{teacherName}</span>
        <Button variant="ghost" className="icon-action" aria-label="设备管理" onClick={() => setTab('devices')}><Settings2 size={20} /></Button>
        {session && <span className="feedback-anchor">
          <Button variant="ghost" className="icon-action" aria-label="反馈" onClick={() => openFeedback()}><MessageSquareText size={19} /></Button>
          {maintainer && unread && !feedbackOpen && <span className="unread-dot" />}
          {intro && !news.length && <div className="intro-bubble">遇到问题或者有建议，都可以写在这里
            <button onClick={() => { localStorage.setItem(introKey, '1'); setIntro(false); }}>知道了</button></div>}
        </span>}
        {session && <Button variant="ghost" className="icon-action" aria-label="退出登录" onClick={logout}><LogOut size={19} /></Button>}
      </div>
    </header>
    <main className="workspace">
      <nav className="tabs" aria-label="主要导航">
        <button className={tab === 'send' ? 'active' : ''} onClick={() => setTab('send')}><AudioLines size={19} />发布</button>
        <button className={tab === 'screen' ? 'active' : ''} onClick={() => setTab('screen')}><MonitorPlay size={18} />正在显示</button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><Clock3 size={18} />广播历史</button>
        <button className={tab === 'schedule' ? 'active' : ''} onClick={() => setTab('schedule')}><CalendarDays size={18} />课程表</button>
        <button className={tab === 'birthdays' ? 'active' : ''} onClick={() => setTab('birthdays')}><Cake size={18} />生日</button>
      </nav>
      {!configured && <div className="feedback config-notice"><span className="tiny-dot" />广播服务尚未配置，连接后即可使用。</div>}
      {configured && !known && <output className="feedback warning"><WifiOff size={17} />{network ? '正在连接，设备状态待确认' : '网络已断开，草稿已保留'}</output>}
      {error && <div className="feedback error" role="alert">{error}<button aria-label="关闭提示" onClick={() => setError('')}><X size={17} /></button></div>}
      {sw.needRefresh[0] && <div className="feedback info">有新版本可用<Button variant="link" onClick={() => void sw.updateServiceWorker(true)} disabled={!!busy}>更新应用</Button></div>}
      {tab === 'send' && <>
        <Compose kind={kind} setKind={setKind} rooms={rooms} known={known} now={now} selected={selected} setSelected={setSelected}
          drafts={drafts} patch={patch} ready={ready} busy={busy} onSubmit={submit} onError={setError}
          saved={savedBoards(boardDrafts, overview, now)} onSaveDraft={saveDraft} onOpenSaved={openSaved} onDeleteSaved={deleteSaved} />
        {latest && <section className="section delivery-panel" aria-live="polite">
          <div className="section-heading"><h2>本次广播 · {latest.teacher_name}</h2><span className="muted">{time(latest.created_at)}</span></div>
          <p className="broadcast-body">{latest.body}</p>
          <p className="broadcast-meta">{broadcastMeta(latest)}</p>
          <Receipts item={latest} rooms={rooms} known={known} now={now} />
        </section>}
        {!latest && history.length > 0 && <button className="recent-link" onClick={() => { setTab('history'); setExpanded(history[0].id); }}>
          <span><span className="muted">最近广播 · {time(history[0].created_at)}</span><span className="recent-body">{history[0].body}</span></span>
          <ArrowUpRight size={20} />
        </button>}
      </>}
      {tab === 'screen' && <OnScreen items={overview} rooms={rooms} known={known} now={now} ready={ready} busy={busy}
        onRemove={ids => run('remove', async () => { await rpc('remove_display_items', { p_ids: ids }); if (!live) await refreshOverview(); })}
        onEdit={(ids, content, ends) => run('edit', async () => {
          await rpc('update_display_items', { p_ids: ids, p_content: content, p_ends_at: ends }); if (!live) await refreshOverview();
        })} onError={setError} />}
      {tab === 'history' && <History history={history} expanded={expanded} setExpanded={setExpanded} hasMore={hasMore} canLoad={!busy && ready}
        onLoadMore={() => void run('history', async () => { const items = await getHistory(history.at(-1)!.created_at); mergeHistory(items); setHasMore(items.length === 20); })}
        onResend={resend} rooms={rooms} known={known} now={now} configured={configured} />}
      {tab === 'schedule' && <ScheduleEditor schedules={schedules} drafts={weekDrafts} setDrafts={setWeekDrafts} now={now} ready={ready} busy={busy} onError={setError}
        onSave={(classroom, days) => run('schedule', async () => {
          await rpc('set_schedule', { p_classroom: classroom, p_days: days, p_teacher_name: teacherName });
          setSchedules(old => patchSchedule(old, { classroom_id: classroom, days, teacher_name: teacherName, updated_at: new Date(now).toISOString() }));
        })} />}
      {tab === 'birthdays' && <BirthdayEditor lists={birthdays} drafts={birthdayDrafts} setDrafts={setBirthdayDrafts} now={now} ready={ready} busy={busy}
        onError={setError} onSave={(classroom, students) => run('birthdays', async () => {
          await rpc('set_birthdays', { p_classroom: classroom, p_students: students, p_teacher_name: teacherName });
          setBirthdays(old => patchBirthdays(old, { classroom_id: classroom, students, teacher_name: teacherName, updated_at: new Date(now).toISOString() }));
        })} />}
      {tab === 'devices' && <Devices rooms={rooms} ready={ready} busy={busy} onBack={() => setTab('send')}
        onUnbind={room => run('unbind', async () => { await rpc('unbind_device', { p_classroom: room.id }); if (!live) await refreshRooms(); })} />}
    </main>
    {feedbackOpen && <FeedbackDialog items={feedback ?? []} maintainer={maintainer} focus={feedbackOpen.focus} onClose={closeFeedback}
      onSubmit={submitFeedback} onComment={commentFeedback} onStatus={setFeedbackStatus} />}
    {news.length > 0 && <FeedbackNews items={news} onDismiss={() => markSeen(latestMark)} onView={() => openFeedback(news[0].id)} />}
  </div>;
}

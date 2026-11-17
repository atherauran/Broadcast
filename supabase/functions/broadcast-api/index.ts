import { createClient } from 'npm:@supabase/supabase-js@2';
import { validateTargets } from '../_shared/domain.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const key = Deno.env.get('SUPABASE_ANON_KEY')!;
const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') || 'http://127.0.0.1:5173,http://localhost:5173').split(',').map(s => s.trim());

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin');
  const cors: Record<string, string> = { 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' };
  if (origin && allowedOrigins.includes(origin)) cors['Access-Control-Allow-Origin'] = origin;
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (origin && !allowedOrigins.includes(origin)) return reply({ error: '此访问地址未获允许' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return reply({ error: '仅支持 POST' }, 405);
  try {
    const cleanupToken = request.headers.get('x-file-cleanup-token');
    if (cleanupToken) {
      const { data: paths, error } = await service.rpc('file_cleanup_candidates', { p_token: cleanupToken });
      if (error) return reply({ error: '无权清理文件' }, 403);
      if (paths?.length) {
        // Storage's API removes both the bytes and metadata; SQL deletion alone leaks stored files.
        const { error: removalError } = await service.storage.from('classroom-files').remove(paths);
        if (removalError) throw removalError;
      }
      return reply({ deleted: paths?.length ?? 0 });
    }
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return reply({ error: '请先登录' }, 401);
    const { data: { user }, error: authError } = await service.auth.getUser(token);
    if (authError || !user) return reply({ error: '登录已失效，请重新登录' }, 401);
    const admin = user.app_metadata.role === 'admin';
    const input = await request.json();
    if (!admin) return reply({ error: '需要管理员权限' }, 403);
    if (input.action === 'register-device') {
      const classroom = validateTargets([input.classroom_id])[0];
      const name = typeof input.name === 'string' ? input.name.trim().slice(0, 100) : '';
      if (!name) throw new Error('设备名称不能为空');
      const password = crypto.randomUUID() + crypto.randomUUID();
      const email = `device-${crypto.randomUUID()}@devices.broadcast.invalid`;
      const created = await service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role: 'device' } });
      if (created.error) throw created.error;
      try {
        const bound = await service.rpc('bind_device', { p_device: created.data.user.id, p_classroom: classroom, p_name: name });
        if (bound.error) throw bound.error;
        const deviceAuth = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
        const signedIn = await deviceAuth.auth.signInWithPassword({ email, password });
        if (signedIn.error) throw signedIn.error;
        // Devices restored by DeepFreeze cannot keep rotated refresh tokens, so they sign in with this fixed credential.
        return reply({ session: signedIn.data.session, classroom_id: classroom,
          credential: { id: created.data.user.id, email, password } });
      } catch (error) {
        await service.auth.admin.deleteUser(created.data.user.id);
        throw error;
      }
    }
    if (input.action === 'claim-homeroom') {
      const classroom = validateTargets([input.classroom_id])[0];
      const password = typeof input.password === 'string' ? input.password : '';
      if (password.length < 6 || password.length > 72) throw new Error('密码需要 6–72 位');
      const { data: row, error } = await service.from('homerooms').select('user_id').eq('classroom_id', classroom).maybeSingle();
      if (error) throw error;
      if (!row) throw new Error(`${classroom} 没有登记班主任`);
      if (row.user_id) throw new Error(`${classroom} 班主任已设置过密码`);
      const anon = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      // With the shared password, anyone signing with this teacher's name would get their account.
      if (user.email && !(await anon().auth.signInWithPassword({ email: user.email, password })).error) throw new Error('不能使用共用密码');
      const email = `homeroom-${classroom}@broadcast.local`;
      const created = await service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role: 'admin' } });
      if (created.error) throw created.error;
      const { data: claimed, error: claimError } = await service.from('homerooms')
        .update({ user_id: created.data.user.id, claimed_at: new Date().toISOString() }).eq('classroom_id', classroom).is('user_id', null).select('classroom_id');
      if (claimError || !claimed?.length) {
        await service.auth.admin.deleteUser(created.data.user.id);
        throw claimError ?? new Error(`${classroom} 班主任已设置过密码`);
      }
      const signedIn = await anon().auth.signInWithPassword({ email, password });
      if (signedIn.error) throw signedIn.error;
      return reply({ session: signedIn.data.session });
    }
    return reply({ error: '未知操作' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : (error as { message?: string })?.message || '操作失败';
    return reply({ error: message }, 400);
  }
});

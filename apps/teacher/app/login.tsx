import { Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { validTeacherName } from '@/lib/domain';

export function Login({ name, setName, password, setPassword, error, busy, network, onSubmit }: {
  name: string; setName: (value: string) => void; password: string; setPassword: (value: string) => void;
  error: string; busy: string; network: boolean; onSubmit: () => void;
}) {
  return <main className="login-shell"><form className="login-card" onSubmit={e => { e.preventDefault(); onSubmit(); }}>
    <div className="brand-icon"><Radio size={27} /></div><h1>校园广播</h1><p className="muted">填写姓名并验证管理员密码，同学们会看到广播由谁发布。</p>
    <label htmlFor="teacher-name">老师姓名</label><Input id="teacher-name" className="login-input" autoComplete="name" maxLength={40} required value={name} onChange={e => setName(e.target.value)} />
    <label htmlFor="password">管理员密码</label><Input id="password" className="login-input" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
    {error && <p className="feedback error" role="alert">{error}</p>}
    <Button className="action primary login-submit" type="submit" disabled={!!busy || !network || !validTeacherName(name)}>{busy ? '正在登录…' : '进入广播'}</Button>
  </form></main>;
}

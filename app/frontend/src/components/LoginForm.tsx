import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { api, errMsg } from '@/lib/s3api';

export const TOKEN_KEY = 'token';

export const LOGOUT_FLAG = 'isLougOutManual';

export const logoutLocal = () => {
  localStorage.removeItem(TOKEN_KEY);
  // Stop the SDK from silently re-exchanging the platform cookie for a new token.
  localStorage.setItem(LOGOUT_FLAG, 'true');
  window.location.href = '/';
};

export default function LoginForm() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) return setError('请输入用户名和密码');
    if (mode === 'register' && password !== confirm) return setError('两次输入的密码不一致');
    setBusy(true);
    try {
      const r = await api<{ token: string }>(`/api/v1/s3/account/${mode}`, { username: username.trim(), password });
      localStorage.setItem(TOKEN_KEY, r.token);
      localStorage.removeItem(LOGOUT_FLAG);
      window.location.reload();
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">{mode === 'login' ? '登录' : '注册账号'}</h2>
        <p className="mt-1 text-sm text-[#5B6B66]">{mode === 'login' ? '使用用户名和密码登录' : '创建账号后即可使用，数据按账号隔离保存'}</p>
      </div>
      <div>
        <Label htmlFor="u" className="text-xs">用户名</Label>
        <Input id="u" autoComplete="username" placeholder="3-32 位字母、数字或 _ . @ -" value={username} onChange={(e) => setUsername(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="p" className="text-xs">密码</Label>
        <Input id="p" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="至少 6 位" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {mode === 'register' && (
        <div>
          <Label htmlFor="c" className="text-xs">确认密码</Label>
          <Input id="c" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
      )}
      {error && <p className="text-sm text-[#B91C1C]">{error}</p>}
      <Button type="submit" size="lg" disabled={busy} className="w-full bg-[#0F766E] text-white hover:bg-[#115E59]">
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{mode === 'login' ? '登录' : '注册并登录'}
      </Button>
      <p className="text-center text-sm text-[#5B6B66]">
        {mode === 'login' ? '还没有账号？' : '已有账号？'}
        <button type="button" className="ml-1 font-medium text-[#0F766E] hover:underline" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
          {mode === 'login' ? '立即注册' : '去登录'}
        </button>
      </p>
      {mode === 'login' && (
        <p className="rounded-md border border-[#99F6E4] bg-[#F0FDFA] px-3 py-2 text-center text-xs text-[#0F766E]">
          演示站点：可使用账号 <span className="mono font-semibold">demo</span> / 密码 <span className="mono font-semibold">demo123</span> 登录体验
        </p>
      )}
    </form>
  );
}

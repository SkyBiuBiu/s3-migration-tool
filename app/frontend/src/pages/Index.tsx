import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { ArrowRightLeft, Database, FolderSearch, KeyRound, Loader2, LogOut, ShieldCheck, Zap } from 'lucide-react';
import { client } from '@/lib/api';
import { Connection, api, errMsg } from '@/lib/s3api';
import Connections from '@/components/Connections';
import Browser from '@/components/Browser';
import Tasks from '@/components/Tasks';
import Admin from '@/components/Admin';
import ChangePassword from '@/components/ChangePassword';
import LoginForm, { TOKEN_KEY, logoutLocal } from '@/components/LoginForm';
import { toast } from 'sonner';

type View = 'tasks' | 'conns' | 'browse' | 'admin';

const NAV: { id: View; label: string; desc: string; icon: typeof Database }[] = [
  { id: 'tasks', label: '迁移任务', desc: '创建、监控和重试迁移', icon: ArrowRightLeft },
  { id: 'conns', label: '存储连接', desc: '管理 S3 兼容存储凭据', icon: Database },
  { id: 'browse', label: '对象浏览', desc: '按目录浏览 Bucket 内容', icon: FolderSearch },
];
const ADMIN_NAV = { id: 'admin' as View, label: '管理后台', desc: '用户管理与全部迁移任务', icon: ShieldCheck };

const FEATURES = [
  { icon: Zap, title: '流式分片复制', text: '大文件自动分片上传，不落盘' },
  { icon: ShieldCheck, title: '断点续传', text: '进度实时持久化，可随时继续' },
  { icon: Database, title: '多云兼容', text: 'AWS S3 / MinIO / OSS / COS' },
];

export default function Index() {
  const [auth, setAuth] = useState<'loading' | 'in' | 'out' | 'disabled'>('loading');
  const [me, setMe] = useState<{ id: string; role: string } | null>(null);
  const [conns, setConns] = useState<Connection[]>([]);
  const [view, setView] = useState<View>('tasks');
  const [pwOpen, setPwOpen] = useState(false);

  useEffect(() => {
    const check = async () => {
      if (!localStorage.getItem(TOKEN_KEY)) return setAuth('out');
      try {
        setMe(await api<{ id: string; role: string }>('/api/v1/s3/me', {}, 'GET'));
        setAuth('in');
      } catch (e) {
        const msg = errMsg(e);
        if (msg.includes('禁用')) setAuth('disabled');
        else {
          localStorage.removeItem(TOKEN_KEY);
          setAuth('out');
        }
      }
    };
    check();
  }, []);

  const nav = me?.role === 'admin' ? [...NAV, ADMIN_NAV] : NAV;

  const loadConns = useCallback(async () => {
    try {
      const r = await api<{ items: Connection[] }>('/api/v1/s3/connections', {}, 'GET');
      setConns(r.items);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, []);

  useEffect(() => { if (auth === 'in') loadConns(); }, [auth, loadConns]);

  const current = nav.find((n) => n.id === view) || NAV[0];

  return (
    <div className="min-h-screen bg-[#F4F6F5] text-[#14201C]" style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono&display=swap');.mono{font-family:'JetBrains Mono',monospace}
.app-bg{background-color:#F4F6F5;background-image:radial-gradient(circle at 100% 0%,rgba(20,184,166,0.08),transparent 40%),radial-gradient(#DDE3E0 1px,transparent 1px);background-size:auto,22px 22px}
main .rounded-lg.border{border-radius:12px;box-shadow:0 1px 2px rgba(18,32,27,0.04)}
main table thead{background:#F7F9F8}
main table tbody tr{transition:background-color .15s}`}</style>

      {auth === 'loading' && <div className="flex h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#0F766E]" /></div>}

      {auth === 'out' && (
        <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
          <div className="relative flex flex-col justify-between overflow-hidden bg-[#12201B] p-8 text-white lg:p-14">
            <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)', backgroundSize: '32px 32px' }} />
            <div className="relative flex items-center gap-3">
              <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#14B8A6] to-[#0F766E] shadow-[0_6px_18px_rgba(20,184,166,0.35)] ring-1 ring-white/15">
                <ArrowRightLeft className="h-5 w-5 text-white" />
              </span>
              <div className="leading-tight">
                <p className="text-[15px] font-semibold tracking-wide text-white">对象存储迁移工具</p>
                <p className="mono mt-0.5 text-[11px] text-[#5EEAD4]/80">S3 Migration Console</p>
              </div>
            </div>
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="relative my-12">
              <h1 className="text-4xl font-bold leading-tight lg:text-5xl">把数据从一朵云<br /><span className="text-[#5EEAD4]">平滑搬到另一朵云</span></h1>
              <p className="mt-4 max-w-md text-[#A7B8B2]">基于 boto3 SDK 的可视化迁移控制台。配置连接、浏览对象、一键迁移并实时监控进度。</p>
            </motion.div>
            <div className="relative grid gap-3 sm:grid-cols-3">
              {FEATURES.map((f, i) => (
                <motion.div key={f.title} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.1 }} className="rounded-lg border border-white/10 bg-white/5 p-4">
                  <f.icon className="h-5 w-5 text-[#5EEAD4]" />
                  <p className="mt-2 text-sm font-semibold">{f.title}</p>
                  <p className="mt-1 text-xs text-[#A7B8B2]">{f.text}</p>
                </motion.div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-center p-8">
            <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-sm"><LoginForm /></motion.div>
          </div>
        </div>
      )}

      {auth === 'disabled' && (
        <div className="flex h-screen items-center justify-center p-6">
          <div className="max-w-sm rounded-xl border border-[#DDE3E0] bg-white p-8 text-center">
            <h2 className="text-xl font-semibold">账号已被禁用</h2>
            <p className="mt-2 text-sm text-[#5B6B66]">请联系管理员恢复使用权限。</p>
            <Button variant="outline" className="mt-6" onClick={() => logoutLocal()}>退出登录</Button>
          </div>
        </div>
      )}

      {auth === 'in' && (
        <div className="flex min-h-screen flex-col lg:flex-row">
          <aside className="bg-gradient-to-b from-[#12201B] to-[#0B1511] text-white shadow-[4px_0_24px_rgba(0,0,0,0.08)] lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:shrink-0">
            <div className="flex items-center justify-between px-5 py-6">
              <div className="flex items-center gap-3">
                <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#14B8A6] to-[#0F766E] shadow-[0_6px_18px_rgba(20,184,166,0.35)] ring-1 ring-white/15">
                  <ArrowRightLeft className="h-5 w-5 text-white" />
                </span>
                <div className="leading-tight">
                  <p className="text-[15px] font-semibold tracking-wide text-white">对象存储迁移工具</p>
                  <p className="mono mt-0.5 text-[11px] text-[#5EEAD4]/80">S3 Migration Console</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" aria-label="修改密码" className="text-white hover:bg-white/10 hover:text-white lg:hidden" onClick={() => setPwOpen(true)}><KeyRound className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" aria-label="退出登录" className="text-white hover:bg-white/10 hover:text-white lg:hidden" onClick={() => logoutLocal()}><LogOut className="h-4 w-4" /></Button>
            </div>
            <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:pb-0">
              {nav.map((n) => (
                <button key={n.id} onClick={() => setView(n.id)} className={`relative flex shrink-0 items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors ${view === n.id ? 'text-white' : 'text-[#A7B8B2] hover:text-white'}`}>
                  {view === n.id && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-md bg-white/10" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
                  <n.icon className="relative h-4 w-4" />
                  <span className="relative">{n.label}</span>
                </button>
              ))}
            </nav>
            <div className="absolute bottom-0 hidden w-64 border-t border-white/10 p-3 lg:block">
              <button onClick={() => setPwOpen(true)} className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm text-[#A7B8B2] hover:bg-white/5 hover:text-white"><KeyRound className="h-4 w-4" />修改密码</button>
              <ChangePassword open={pwOpen} onOpenChange={setPwOpen} />
              <button onClick={() => logoutLocal()} className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm text-[#A7B8B2] hover:bg-white/5 hover:text-white"><LogOut className="h-4 w-4" />退出登录</button>
            </div>
          </aside>

          <main className="app-bg min-w-0 flex-1">
            <div className="mx-auto max-w-[1100px] px-4 py-6 lg:px-10 lg:py-10">
              <AnimatePresence mode="wait">
                <motion.section key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
                  <header className="mb-6 flex items-center gap-4">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#0F766E] to-[#14B8A6] text-white shadow-[0_6px_16px_rgba(15,118,110,0.25)]">
                      <current.icon className="h-5 w-5" />
                    </span>
                    <div>
                      <h1 className="text-2xl font-semibold tracking-tight">{current.label}</h1>
                      <p className="text-sm text-[#5B6B66]">{current.desc}</p>
                    </div>
                  </header>
                  {view === 'tasks' && <Tasks conns={conns} />}
                  {view === 'conns' && <Connections items={conns} reload={loadConns} />}
                  {view === 'browse' && <Browser conns={conns} />}
                  {view === 'admin' && me?.role === 'admin' && <Admin meId={me.id} />}
                </motion.section>
              </AnimatePresence>
            </div>
          </main>
        </div>
      )}
    </div>
  );
}

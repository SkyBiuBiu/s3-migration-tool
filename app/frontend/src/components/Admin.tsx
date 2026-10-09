import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Ban, KeyRound, RefreshCw, Trash2, ShieldCheck, UserCheck, UserMinus } from 'lucide-react';
import { api, errMsg, fmtBytes } from '@/lib/s3api';

interface AdminUser {
  id: string;
  email: string;
  name?: string;
  username?: string | null;
  role: 'user' | 'admin' | 'disabled';
  created_at?: string;
  last_login?: string;
  connections: number;
  tasks: number;
}

interface AdminTask {
  id: number;
  name: string;
  status: string;
  user_email: string;
  source: string;
  target: string;
  source_prefix: string;
  target_prefix: string;
  total_count: number;
  done_count: number;
  skipped_count: number;
  failed_count: number;
  total_bytes: number;
  processed_bytes: number;
  bytes_transferred: number;
  error_message?: string | null;
  created_at?: string;
}

const ROLE: Record<string, [string, string]> = {
  admin: ['管理员', 'bg-[#CCFBF1] text-[#0F766E]'],
  user: ['普通用户', 'bg-[#F4F6F5] text-[#5B6B66]'],
  disabled: ['已禁用', 'bg-[#FEE2E2] text-[#B91C1C]'],
};
const STATUS: Record<string, [string, string]> = {
  pending: ['等待中', 'bg-[#F4F6F5] text-[#5B6B66]'],
  running: ['迁移中', 'bg-[#CCFBF1] text-[#0F766E]'],
  completed: ['已完成', 'bg-[#DCFCE7] text-[#15803D]'],
  failed: ['失败', 'bg-[#FEE2E2] text-[#B91C1C]'],
  cancelled: ['已取消', 'bg-[#FEF3C7] text-[#B45309]'],
};
const fmtTime = (s?: string | null) => (s ? new Date(s).toLocaleString() : '-');
const Badge = ({ map, k }: { map: Record<string, [string, string]>; k: string }) => {
  const [l, c] = map[k] || [k, 'bg-[#F4F6F5] text-[#5B6B66]'];
  return <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${c}`}>{l}</span>;
};

export default function Admin({ meId }: { meId: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [tasks, setTasks] = useState<AdminTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, t] = await Promise.all([
        api<{ items: AdminUser[] }>('/api/v1/s3/admin/users', {}, 'GET'),
        api<{ items: AdminTask[] }>('/api/v1/s3/admin/tasks', {}, 'GET'),
      ]);
      setUsers(u.items);
      setTasks(t.items);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setRole = async (u: AdminUser, role: AdminUser['role']) => {
    const tip = role === 'disabled' ? `禁用 ${u.email}？其进行中的任务会被取消。` : role === 'admin' ? `将 ${u.email} 设为管理员？` : `将 ${u.email} 设为普通用户？`;
    if (!confirm(tip)) return;
    setBusy(u.id);
    try {
      const r = await api<{ cancelled_tasks: number }>(`/api/v1/s3/admin/users/${u.id}/role`, { role });
      toast.success(`已更新${r.cancelled_tasks ? `，取消了 ${r.cancelled_tasks} 个任务` : ''}`);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const resetPw = async (u: AdminUser) => {
    const pw = prompt(`为 ${u.username} 设置新密码（至少 6 位）：`);
    if (pw === null) return;
    if (pw.length < 6) return toast.error('新密码至少 6 位');
    setBusy(u.id);
    try {
      await api(`/api/v1/s3/admin/users/${encodeURIComponent(u.id)}/password`, { new_password: pw });
      toast.success('密码已重置');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const removeUser = async (u: AdminUser) => {
    if (!confirm(`删除用户 ${u.username || u.email || u.id}？其所有连接和迁移任务也会一并删除，且无法恢复。`)) return;
    setBusy(u.id);
    try {
      const r = await api<{ tasks: number; connections: number }>(`/api/v1/s3/admin/users/${encodeURIComponent(u.id)}`, {}, 'DELETE');
      toast.success(`已删除（连接 ${r.connections} 个，任务 ${r.tasks} 个）`);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const running = tasks.filter((t) => t.status === 'running' || t.status === 'pending').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[#5B6B66]">共 {users.length} 位用户 · {tasks.length} 个任务（进行中 {running}）</p>
        <Button size="sm" variant="outline" className="bg-white" disabled={loading} onClick={load}>
          <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新
        </Button>
      </div>
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">用户管理</TabsTrigger>
          <TabsTrigger value="tasks">所有任务</TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <div className="overflow-x-auto rounded-lg border border-[#DDE3E0] bg-white">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-[#5B6B66]">
                <tr><th className="px-4 py-2">用户</th><th className="px-4 py-2">角色</th><th className="px-4 py-2">连接/任务</th><th className="px-4 py-2">最近登录</th><th className="px-4 py-2 text-right">操作</th></tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-[#EEF1EF] hover:bg-[#F7F9F8]">
                    <td className="px-4 py-2"><p className="font-medium">{u.username || u.name || '-'}{u.id === meId && <span className="ml-1 text-xs text-[#0F766E]">（我）</span>}</p><p className="mono text-xs text-[#5B6B66]">{u.email || u.id}</p></td>
                    <td className="px-4 py-2"><Badge map={ROLE} k={u.role || 'user'} /></td>
                    <td className="mono px-4 py-2 text-xs">{u.connections} / {u.tasks}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-[#5B6B66]">{fmtTime(u.last_login)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      {u.id === meId ? <span className="text-xs text-[#5B6B66]">-</span> : (
                        <div className="flex justify-end gap-1">
                          {u.role !== 'admin' && u.role !== 'disabled' && <Button size="sm" variant="ghost" disabled={busy === u.id} onClick={() => setRole(u, 'admin')}><ShieldCheck className="mr-1 h-4 w-4" />设为管理员</Button>}
                          {u.role === 'admin' && <Button size="sm" variant="ghost" disabled={busy === u.id} onClick={() => setRole(u, 'user')}><UserMinus className="mr-1 h-4 w-4" />取消管理员</Button>}
                          {u.role === 'disabled'
                            ? <Button size="sm" variant="ghost" disabled={busy === u.id} onClick={() => setRole(u, 'user')}><UserCheck className="mr-1 h-4 w-4" />启用</Button>
                            : <Button size="sm" variant="ghost" className="text-[#B91C1C] hover:text-[#B91C1C]" disabled={busy === u.id} onClick={() => setRole(u, 'disabled')}><Ban className="mr-1 h-4 w-4" />禁用</Button>}
                          {u.role !== 'admin' && u.username && <Button size="sm" variant="ghost" disabled={busy === u.id} onClick={() => resetPw(u)}><KeyRound className="mr-1 h-4 w-4" />重置密码</Button>}
                          {u.role !== 'admin' && <Button size="sm" variant="ghost" className="text-[#B91C1C] hover:text-[#B91C1C]" disabled={busy === u.id} onClick={() => removeUser(u)}><Trash2 className="mr-1 h-4 w-4" />删除</Button>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {!users.length && <tr><td colSpan={5} className="p-6 text-center text-[#5B6B66]">{loading ? '加载中…' : '暂无用户'}</td></tr>}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="tasks">
          <div className="overflow-x-auto rounded-lg border border-[#DDE3E0] bg-white">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-[#5B6B66]">
                <tr><th className="px-4 py-2">任务</th><th className="px-4 py-2">用户</th><th className="px-4 py-2">状态</th><th className="min-w-[180px] px-4 py-2">进度</th><th className="px-4 py-2">创建时间</th></tr>
              </thead>
              <tbody>
                {tasks.map((t) => {
                  const pct = t.status === 'completed' ? 100 : t.total_bytes ? Math.min(99, (t.processed_bytes / t.total_bytes) * 100) : 0;
                  return (
                    <tr key={t.id} className="border-t border-[#EEF1EF] align-top hover:bg-[#F7F9F8]">
                      <td className="px-4 py-2">
                        <p className="font-medium">#{t.id} {t.name}</p>
                        <p className="mono text-xs text-[#5B6B66]">{t.source}/{t.source_prefix} → {t.target}/{t.target_prefix}</p>
                        {t.error_message && <p className="text-xs text-[#B91C1C]">{t.error_message}</p>}
                      </td>
                      <td className="mono px-4 py-2 text-xs">{t.user_email}</td>
                      <td className="px-4 py-2"><Badge map={STATUS} k={t.status} /></td>
                      <td className="px-4 py-2">
                        <Progress value={pct} className="h-1.5" />
                        <p className="mono mt-1 text-xs text-[#5B6B66]">成功 {t.done_count} · 跳过 {t.skipped_count} · <span className="text-[#B91C1C]">失败 {t.failed_count}</span> · {fmtBytes(t.bytes_transferred)}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-xs text-[#5B6B66]">{fmtTime(t.created_at)}</td>
                    </tr>
                  );
                })}
                {!tasks.length && <tr><td colSpan={5} className="p-6 text-center text-[#5B6B66]">{loading ? '加载中…' : '暂无任务'}</td></tr>}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

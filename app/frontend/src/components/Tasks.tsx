import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Download, Gauge, Plus, RotateCcw, Square, Timer, Trash2 } from 'lucide-react';
import { Connection, Task, api, downloadCsv, errMsg, fmtBytes, fmtDuration } from '@/lib/s3api';
import TaskForm from '@/components/TaskForm';

const STATUS: Record<string, [string, string]> = {
  pending: ['等待中', 'bg-[#F4F6F5] text-[#5B6B66]'],
  running: ['迁移中', 'bg-[#CCFBF1] text-[#0F766E]'],
  completed: ['已完成', 'bg-[#DCFCE7] text-[#15803D]'],
  failed: ['失败', 'bg-[#FEE2E2] text-[#B91C1C]'],
  cancelled: ['已取消', 'bg-[#FEF3C7] text-[#B45309]'],
};
const MODE: Record<string, string> = { full: '全量', skip_existing: '跳过已存在', incremental: '增量' };
const LOG_CLS: Record<string, string> = { info: 'text-[#5B6B66]', warn: 'text-[#B45309]', error: 'text-[#B91C1C]', success: 'text-[#15803D]' };
const ACTIVE = ['pending', 'running'];

type Sample = { t: number; bytes: number; processed: number }[];

export default function Tasks({ conns }: { conns: Connection[] }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<number | null>(null);
  const samples = useRef<Record<number, Sample>>({});
  const stepping = useRef(new Set<number>());
  const connName = (id: number) => conns.find((c) => c.id === id)?.name || `#${id}`;

  const record = (t: Task) => {
    const s = (samples.current[t.id] ||= []);
    s.push({ t: Date.now() / 1000, bytes: t.bytes_transferred, processed: t.processed_bytes });
    const cutoff = Date.now() / 1000 - 30;
    while (s.length > 2 && s[0].t < cutoff) s.shift();
  };

  const reload = useCallback(async () => {
    try {
      const r = await api<{ items: Task[] }>('/api/v1/s3/tasks', {}, 'GET');
      r.items.forEach(record);
      setTasks(r.items);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, []);

  // Poll for progress; background workers on the server do the migration.
  // If no server runner holds the lock, the open page also advances the task (fallback).
  useEffect(() => {
    reload();
    const timer = setInterval(async () => {
      await reload();
    }, 3000);
    return () => clearInterval(timer);
  }, [reload]);

  useEffect(() => {
    tasks.filter((t) => ACTIVE.includes(t.status) && !t.locked).forEach(async (t) => {
      if (stepping.current.has(t.id)) return;
      stepping.current.add(t.id);
      try {
        await api(`/api/v1/s3/tasks/${t.id}/step`);
      } catch {
        /* the next poll will surface errors via task state */
      } finally {
        stepping.current.delete(t.id);
      }
    });
  }, [tasks]);

  const speedOf = (t: Task) => {
    const s = samples.current[t.id];
    if (!s || s.length < 2 || !ACTIVE.includes(t.status)) return { speed: 0, eta: 0 };
    const a = s[0];
    const b = s[s.length - 1];
    const dt = b.t - a.t;
    const speed = dt > 0 ? (b.bytes - a.bytes) / dt : 0;
    const pspeed = dt > 0 ? (b.processed - a.processed) / dt : 0;
    const left = Math.max(0, t.total_bytes - t.processed_bytes);
    return { speed, eta: t.listing_done && pspeed > 0 ? left / pspeed : 0 };
  };

  const act = async (id: number, action: 'cancel' | 'retry') => {
    try {
      await api(`/api/v1/s3/tasks/${id}/${action}`);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const remove = async (t: Task) => {
    if (ACTIVE.includes(t.status)) return toast.error('请先取消任务');
    if (!confirm('删除该任务记录？')) return;
    try {
      await api(`/api/v1/s3/tasks/${t.id}`, {}, 'DELETE');
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const exportFailed = (t: Task) =>
    downloadCsv(`task-${t.id}-failed.csv`, [['key', 'size', 'error'], ...t.failed_items.map((f) => [f.key, f.size, f.error])]);
  const exportLogs = (t: Task) =>
    downloadCsv(`task-${t.id}-logs.csv`, [['time', 'level', 'message'], ...t.logs.map((l) => [new Date(l.t * 1000).toLocaleString(), l.level, l.msg])]);

  const cur = tasks.find((t) => t.id === detail);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button disabled={conns.length === 0} onClick={() => setOpen(true)} className="bg-[#0F766E] text-white hover:bg-[#115E59]"><Plus className="mr-1 h-4 w-4" />新建迁移任务</Button>
      </div>
      {tasks.length === 0 && <div className="rounded-lg border border-dashed border-[#DDE3E0] bg-white p-10 text-center text-sm text-[#5B6B66]">暂无迁移任务{conns.length === 0 ? '，请先添加存储连接' : ''}</div>}
      {tasks.map((t) => {
        const processed = t.done_count + t.skipped_count + t.failed_count;
        const pct = t.status === 'completed' ? 100 : t.total_bytes ? Math.min(99, (t.processed_bytes / t.total_bytes) * 100) : t.total_count ? Math.min(99, (processed / t.total_count) * 100) : 0;
        const [label, cls] = STATUS[t.status] || STATUS.pending;
        const { speed, eta } = speedOf(t);
        return (
          <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} key={t.id} className="rounded-lg border border-[#DDE3E0] bg-white p-4 transition-shadow hover:shadow-[0_4px_16px_rgba(18,32,27,0.06)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button className="min-w-0 text-left" onClick={() => setDetail(t.id)}>
                <h3 className="font-semibold hover:text-[#0F766E]">{t.name}</h3>
                <p className="mono truncate text-xs text-[#5B6B66]">{connName(t.source_id)}/{t.source_prefix || ''} → {connName(t.target_id)}/{t.target_prefix || ''}</p>
              </button>
              <div className="flex items-center gap-1">
                <span className="rounded bg-[#F4F6F5] px-2 py-0.5 text-xs text-[#5B6B66]">{MODE[t.sync_mode || ''] || '跳过已存在'}{t.verify ? ' · 校验' : ''} · {t.concurrency || 4}并发{t.bandwidth_mbps ? ` · ≤${t.bandwidth_mbps}MB/s` : ''}</span>
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
                {ACTIVE.includes(t.status) && <Button size="icon" variant="ghost" aria-label="取消" onClick={() => act(t.id, 'cancel')}><Square className="h-4 w-4" /></Button>}
                {!ACTIVE.includes(t.status) && (t.failed_count > 0 || t.status !== 'completed') && (
                  <Button size="sm" variant="ghost" onClick={() => act(t.id, 'retry')}><RotateCcw className="mr-1 h-4 w-4" />{t.status === 'completed' ? '重试失败项' : '继续/重试'}</Button>
                )}
                <Button size="icon" variant="ghost" aria-label="删除" onClick={() => remove(t)}><Trash2 className="h-4 w-4 text-[#B91C1C]" /></Button>
              </div>
            </div>
            <Progress value={pct} className="mt-3 h-2" />
            <div className="mono mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#5B6B66]">
              <span>{pct.toFixed(1)}%</span>
              <span>已发现 {t.total_count}{t.listing_done ? '' : '+'}（{fmtBytes(t.total_bytes)}）</span>
              <span className="text-[#15803D]">成功 {t.done_count}</span>
              {t.verify && <span className="text-[#0F766E]">已校验 {t.verified_count}</span>}
              <span>跳过 {t.skipped_count}</span>
              <span className="text-[#B91C1C]">失败 {t.failed_count}</span>
              <span>已传输 {fmtBytes(t.bytes_transferred)}</span>
              {ACTIVE.includes(t.status) && (
                <>
                  <span className="flex items-center gap-1 text-[#0F766E]"><Gauge className="h-3 w-3" />{fmtBytes(speed)}/s</span>
                  <span className="flex items-center gap-1"><Timer className="h-3 w-3" />剩余 {t.listing_done ? fmtDuration(eta) : '统计中'}</span>
                </>
              )}
            </div>
            {t.error_message && <p className="mt-2 text-xs text-[#B91C1C]">{t.error_message}</p>}
          </motion.div>
        );
      })}

      <TaskForm open={open} onOpenChange={setOpen} conns={conns} onCreated={reload} />

      <Dialog open={!!cur} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{cur?.name}</DialogTitle></DialogHeader>
          {cur && (
            <Tabs defaultValue="logs">
              <TabsList>
                <TabsTrigger value="logs">运行日志（{cur.logs.length}）</TabsTrigger>
                <TabsTrigger value="failed">失败对象（{cur.failed_items.length}）</TabsTrigger>
              </TabsList>
              <TabsContent value="logs">
                <div className="mb-2 flex justify-end"><Button size="sm" variant="outline" onClick={() => exportLogs(cur)}><Download className="mr-1 h-4 w-4" />导出 CSV</Button></div>
                <div className="mono max-h-96 space-y-0.5 overflow-auto rounded-md bg-[#12201B] p-3 text-xs">
                  {[...cur.logs].reverse().map((l, i) => (
                    <div key={i} className={l.level === 'info' ? 'text-[#A7B8B2]' : l.level === 'success' ? 'text-[#5EEAD4]' : l.level === 'warn' ? 'text-[#FCD34D]' : 'text-[#FCA5A5]'}>
                      <span className="text-[#5B6B66]">{new Date(l.t * 1000).toLocaleTimeString()}</span> {l.msg}
                    </div>
                  ))}
                </div>
              </TabsContent>
              <TabsContent value="failed">
                <div className="mb-2 flex justify-end"><Button size="sm" variant="outline" disabled={!cur.failed_items.length} onClick={() => exportFailed(cur)}><Download className="mr-1 h-4 w-4" />导出 CSV</Button></div>
                <div className="max-h-96 overflow-auto">
                  {cur.failed_items.length === 0 ? <p className="py-6 text-center text-sm text-[#5B6B66]">没有失败对象</p> : (
                    <table className="w-full text-xs">
                      <tbody>{cur.failed_items.map((f, i) => (
                        <tr key={i} className="border-t border-[#EEF1EF]"><td className="mono break-all py-1 pr-2">{f.key}</td><td className="mono whitespace-nowrap py-1 pr-2">{fmtBytes(f.size)}</td><td className={`py-1 ${LOG_CLS.error}`}>{f.error}</td></tr>
                      ))}</tbody>
                    </table>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

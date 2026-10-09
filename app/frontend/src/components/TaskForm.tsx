import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { ChevronDown } from 'lucide-react';
import { Connection, ObjItem, TaskInput, api, errMsg, fmtBytes } from '@/lib/s3api';

export interface Preselect {
  source_id: number;
  source_prefix: string;
  items: ObjItem[];
  prefixes: string[];
}

const MB = 1024 * 1024;
const MODES = [
  { v: 'skip_existing', l: '跳过已存在（同名同大小）' },
  { v: 'incremental', l: '增量同步（ETag / 修改时间变化才复制）' },
  { v: 'full', l: '全量覆盖' },
];

const init = {
  name: '', source_id: '', target_id: '', source_prefix: '', target_prefix: '',
  sync_mode: 'incremental', verify: true, concurrency: '8', bandwidth_mbps: '',
  include_suffixes: '', exclude_suffixes: '', min_mb: '', max_mb: '', modified_after: '', modified_before: '',
};

export default function TaskForm({ open, onOpenChange, conns, preselect, onCreated }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  conns: Connection[];
  preselect?: Preselect | null;
  onCreated: () => void;
}) {
  const [f, setF] = useState(init);
  const [adv, setAdv] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF(preselect ? { ...init, source_id: String(preselect.source_id), source_prefix: preselect.source_prefix, target_prefix: preselect.source_prefix } : init);
    setAdv(false);
  }, [open, preselect]);

  const set = (k: keyof typeof init, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const num = (v: string) => (v.trim() === '' ? null : Number(v));

  const submit = async () => {
    if (!f.source_id || !f.target_id) return toast.error('请选择源和目标');
    const body: TaskInput = {
      name: f.name, source_id: Number(f.source_id), target_id: Number(f.target_id),
      source_prefix: f.source_prefix, target_prefix: f.target_prefix,
      sync_mode: f.sync_mode as TaskInput['sync_mode'], verify: f.verify,
      concurrency: Math.max(1, Math.min(32, Number(f.concurrency) || 4)),
      bandwidth_mbps: num(f.bandwidth_mbps),
      include_suffixes: f.include_suffixes, exclude_suffixes: f.exclude_suffixes,
      min_size: num(f.min_mb) === null ? null : Number(f.min_mb) * MB,
      max_size: num(f.max_mb) === null ? null : Number(f.max_mb) * MB,
      modified_after: f.modified_after || null, modified_before: f.modified_before || null,
      selected_items: preselect?.items, selected_prefixes: preselect?.prefixes,
    };
    setBusy(true);
    try {
      await api('/api/v1/s3/tasks', body);
      toast.success('任务已创建，后台开始迁移');
      onOpenChange(false);
      onCreated();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const sel = (k: 'source_id' | 'target_id', ph: string, disabled = false) => (
    <Select value={f[k]} onValueChange={(v) => set(k, v)} disabled={disabled}>
      <SelectTrigger><SelectValue placeholder={ph} /></SelectTrigger>
      <SelectContent>{conns.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}（{c.bucket}）</SelectItem>)}</SelectContent>
    </Select>
  );
  const inp = (k: keyof typeof init, label: string, ph: string, type = 'text') => (
    <div><Label className="text-xs">{label}</Label><Input type={type} value={f[k] as string} placeholder={ph} onChange={(e) => set(k, e.target.value)} /></div>
  );

  const selCount = (preselect?.items.length || 0) + (preselect?.prefixes.length || 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle>{preselect ? '迁移所选对象' : '新建迁移任务'}</DialogTitle></DialogHeader>
        {preselect && (
          <p className="rounded-md bg-[#CCFBF1] px-3 py-2 text-xs text-[#0F766E]">
            已选 {selCount} 项（{preselect.prefixes.length} 个目录，{preselect.items.length} 个文件，共 {fmtBytes(preselect.items.reduce((a, b) => a + b.size, 0))}+）
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">{inp('name', '任务名称', '可选')}</div>
          <div><Label className="text-xs">源</Label>{sel('source_id', '选择源', !!preselect)}</div>
          <div><Label className="text-xs">目标</Label>{sel('target_id', '选择目标')}</div>
          {inp('source_prefix', preselect ? '源前缀（相对路径基准）' : '源前缀', '如 images/（留空为全部）')}
          {inp('target_prefix', '目标前缀', '如 backup/')}
          <div className="sm:col-span-2">
            <Label className="text-xs">同步模式</Label>
            <Select value={f.sync_mode} onValueChange={(v) => set('sync_mode', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MODES.map((m) => <SelectItem key={m.v} value={m.v}>{m.l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {inp('concurrency', '并发数（1-32）', '8', 'number')}
          {inp('bandwidth_mbps', '限速 MB/s（留空不限）', '如 20', 'number')}
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><Switch checked={f.verify} onCheckedChange={(v) => set('verify', v)} />迁移后校验（比对大小与 ETag/MD5）</label>
        </div>

        <button className="flex items-center gap-1 text-sm font-medium text-[#0F766E]" onClick={() => setAdv(!adv)}>
          <ChevronDown className={`h-4 w-4 transition-transform ${adv ? 'rotate-180' : ''}`} />过滤规则
        </button>
        {adv && (
          <div className="grid gap-3 rounded-md border border-[#DDE3E0] p-3 sm:grid-cols-2">
            {inp('include_suffixes', '仅包含后缀', '.jpg,.png')}
            {inp('exclude_suffixes', '排除后缀', '.tmp,.log')}
            {inp('min_mb', '最小大小 MB', '0', 'number')}
            {inp('max_mb', '最大大小 MB', '不限', 'number')}
            {inp('modified_after', '修改时间晚于', '', 'datetime-local')}
            {inp('modified_before', '修改时间早于', '', 'datetime-local')}
            {preselect && preselect.items.length > 0 && <p className="text-xs text-[#5B6B66] sm:col-span-2">过滤规则仅作用于所选目录内的对象，单独勾选的文件将直接迁移。</p>}
          </div>
        )}
        <Button className="bg-[#0F766E] text-white hover:bg-[#115E59]" disabled={busy} onClick={submit}>{busy ? '创建中…' : '创建并开始'}</Button>
      </DialogContent>
    </Dialog>
  );
}

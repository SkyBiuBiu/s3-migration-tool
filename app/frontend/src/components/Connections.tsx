import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { KeyRound, Pencil, Plug, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { Connection, PRESETS, api, errMsg } from '@/lib/s3api';

const empty = { name: '', endpoint: '', region: '', access_key: '', secret_key: '', bucket: '', path_style: false };
type Form = typeof empty;

export default function Connections({ items, reload }: { items: Connection[]; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Connection | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [preset, setPreset] = useState('');
  const [busy, setBusy] = useState('');
  const p = PRESETS.find((x) => x.id === preset);

  const openEdit = (c?: Connection) => {
    setEdit(c ?? null);
    setPreset('');
    setForm(c ? { ...empty, name: c.name, endpoint: c.endpoint, region: c.region, bucket: c.bucket, path_style: c.path_style } : empty);
    setOpen(true);
  };

  const applyPreset = (id: string, region?: string) => {
    const pr = PRESETS.find((x) => x.id === id);
    if (!pr) return;
    const r = region || pr.regions[0].value;
    setPreset(id);
    setForm((f) => ({ ...f, region: r, endpoint: pr.endpoint(r), path_style: pr.path_style, name: f.name || `${pr.label} ${pr.regions.find((x) => x.value === r)?.label || ''}`.trim() }));
  };

  const test = async (payload: object, tag: string) => {
    setBusy(tag);
    try {
      const r = await api<{ ok: boolean; error?: string }>('/api/v1/s3/test', payload);
      if (r.ok) toast.success('连接成功');
      else toast.error(`连接失败：${r.error}`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const testForm = () => {
    const need: [keyof Form, string][] = [['bucket', 'Bucket']];
    if (!edit) need.push(['access_key', 'AccessKey'], ['secret_key', 'SecretKey']);
    const missing = need.filter(([k]) => !String(form[k]).trim()).map(([, n]) => n);
    if (missing.length) return toast.error(`请填写：${missing.join('、')}`);
    test(edit ? { ...form, connection_id: edit.id } : form, 'form');
  };

  const save = async () => {
    if (!form.name.trim() || !form.bucket.trim()) return toast.error('请填写名称和 Bucket');
    if (!edit && (!form.access_key.trim() || !form.secret_key.trim())) return toast.error('请填写 AccessKey 和 SecretKey');
    setBusy('save');
    try {
      await api('/api/v1/s3/connections', { ...form, id: edit?.id });
      toast.success('已保存（密钥已加密存储）');
      setOpen(false);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const remove = async (c: Connection) => {
    if (!confirm(`确定删除连接「${c.name}」？`)) return;
    try {
      await api(`/api/v1/s3/connections/${c.id}`, {}, 'DELETE');
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const field = (k: keyof Form, label: string, ph: string, extra: { type?: string; span?: boolean } = {}) => (
    <div className={extra.span ? 'sm:col-span-2' : ''}>
      <Label className="text-xs">{label}</Label>
      <Input type={extra.type || 'text'} placeholder={ph} value={form[k] as string} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm text-[#5B6B66]"><ShieldCheck className="h-4 w-4 text-[#0F766E]" />密钥加密存储，页面仅显示脱敏信息</p>
        <Button onClick={() => openEdit()} className="bg-[#0F766E] text-white hover:bg-[#115E59]"><Plus className="mr-1 h-4 w-4" />添加连接</Button>
      </div>
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#DDE3E0] bg-white p-10 text-center text-sm text-[#5B6B66]">还没有存储连接，请先添加源和目标</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((c) => (
            <div key={c.id} className="rounded-lg border border-[#DDE3E0] bg-white p-4 transition-shadow hover:shadow-[0_4px_16px_rgba(18,32,27,0.06)]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold">{c.name}</h3>
                  <p className="mono truncate text-xs text-[#5B6B66]">{c.endpoint || 'AWS S3'} · {c.region || 'us-east-1'}{c.path_style ? ' · Path-Style' : ''}</p>
                  <p className="mono mt-1 text-sm">s3://{c.bucket}</p>
                  <p className="mono mt-1 flex items-center gap-1 text-xs text-[#5B6B66]"><KeyRound className="h-3 w-3" />{c.access_key_masked}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="icon" variant="ghost" aria-label="测试连接" disabled={busy === `t${c.id}`} onClick={() => test({ connection_id: c.id }, `t${c.id}`)}><Plug className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label="编辑" onClick={() => openEdit(c)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label="删除" onClick={() => remove(c)}><Trash2 className="h-4 w-4 text-[#B91C1C]" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader><DialogTitle>{edit ? '编辑连接' : '添加连接'}</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">存储厂商模板</Label>
              <Select value={preset} onValueChange={(v) => applyPreset(v)}>
                <SelectTrigger><SelectValue placeholder="选择后自动填充" /></SelectTrigger>
                <SelectContent>{PRESETS.map((x) => <SelectItem key={x.id} value={x.id}>{x.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">地域</Label>
              {p ? (
                <Select value={form.region} onValueChange={(r) => applyPreset(p.id, r)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{p.regions.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}（{r.value}）</SelectItem>)}</SelectContent>
                </Select>
              ) : (
                <Input placeholder="us-east-1" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
              )}
            </div>
            {p?.hint && <p className="text-xs text-[#B45309] sm:col-span-2">{p.hint}</p>}
            {field('name', '名称', '如：腾讯云 COS 北京', { span: true })}
            {field('endpoint', 'Endpoint（AWS 可留空）', 'https://cos.ap-beijing.myqcloud.com', { span: true })}
            {field('bucket', 'Bucket', 'my-bucket', { span: true })}
            {field('access_key', 'AccessKey / SecretId', edit ? `${edit.access_key_masked}（留空不修改）` : 'AKIA...')}
            {field('secret_key', 'SecretKey', edit ? '留空不修改' : '••••••', { type: 'password' })}
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Switch checked={form.path_style} onCheckedChange={(v) => setForm({ ...form, path_style: v })} />
              Path-Style 访问（MinIO 等自建存储开启；COS / OSS 保持关闭）
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={busy === 'form'} onClick={testForm}>{busy === 'form' ? '测试中…' : '测试连接'}</Button>
            <Button className="bg-[#0F766E] text-white hover:bg-[#115E59]" disabled={busy === 'save'} onClick={save}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

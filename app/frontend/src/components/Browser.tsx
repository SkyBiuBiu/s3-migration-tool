import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { ArrowRightLeft, BarChart3, Download, Eye, File, Folder, FolderPlus, Loader2, RefreshCw, Search, Trash2, Upload, X } from 'lucide-react';
import { Connection, ObjItem, api, errMsg, fileKind, fmtBytes } from '@/lib/s3api';
import TaskForm, { Preselect } from '@/components/TaskForm';
import StatsPanel from '@/components/StatsPanel';

const PROXY_MAX = 5 * 1024 * 1024;

interface Listing {
  folders: string[];
  objects: ObjItem[];
  next_token?: string;
}

interface Preview {
  key: string;
  kind: ReturnType<typeof fileKind>;
  url?: string;
  text?: string;
  truncated?: boolean;
}

export default function Browser({ conns }: { conns: Connection[] }) {
  const [connId, setConnId] = useState('');
  const [prefix, setPrefix] = useState('');
  const [data, setData] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [searchInfo, setSearchInfo] = useState<{ q: string; scanned: number; truncated: boolean } | null>(null);
  const [selFolders, setSelFolders] = useState<Set<string>>(new Set());
  const [selObjs, setSelObjs] = useState<Map<string, ObjItem>>(new Map());
  const [uploads, setUploads] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [migrate, setMigrate] = useState<Preselect | null>(null);
  const [showStats, setShowStats] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cid = Number(connId);

  const clearSel = () => {
    setSelFolders(new Set());
    setSelObjs(new Map());
  };

  const load = useCallback(async (id: string, p: string, token?: string) => {
    setLoading(true);
    setError('');
    setSearchInfo(null);
    if (!token) clearSel();
    try {
      const r = await api<Listing>('/api/v1/s3/browse', { connection_id: Number(id), prefix: p, token });
      setData((prev) => (token && prev ? { ...r, folders: [...prev.folders, ...r.folders], objects: [...prev.objects, ...r.objects] } : r));
    } catch (e) {
      setError(errMsg(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (connId) load(connId, prefix);
  }, [connId, prefix, load]);

  const refresh = () => connId && load(connId, prefix);

  const doSearch = async () => {
    if (!query.trim()) return refresh();
    setLoading(true);
    setError('');
    clearSel();
    try {
      const r = await api<{ objects: ObjItem[]; scanned: number; truncated: boolean }>('/api/v1/s3/search', { connection_id: cid, prefix, query });
      setData({ folders: [], objects: r.objects });
      setSearchInfo({ q: query, scanned: r.scanned, truncated: r.truncated });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  const presign = (key: string, op: 'get' | 'download' | 'put', content_type?: string) =>
    api<{ url: string }>('/api/v1/s3/presign', { connection_id: cid, key, op, content_type }).then((r) => r.url);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    let ok = 0;
    for (const file of Array.from(files)) {
      const key = prefix + file.name;
      try {
        if (file.size <= PROXY_MAX) {
          // Small files go through the backend as base64 JSON: no bucket CORS needed.
          const buf = new Uint8Array(await file.arrayBuffer());
          let bin = '';
          for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          setUploads((u) => ({ ...u, [file.name]: 50 }));
          await api('/api/v1/s3/upload', {
            connection_id: cid,
            key,
            content_type: file.type || 'application/octet-stream',
            data_base64: btoa(bin),
          });
          ok++;
          continue;
        }
        const url = await presign(key, 'put', file.type || 'application/octet-stream');
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', url);
          xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
          xhr.upload.onprogress = (e) => e.lengthComputable && setUploads((u) => ({ ...u, [file.name]: Math.round((e.loaded / e.total) * 100) }));
          xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`)));
          xhr.onerror = () => reject(new Error('大于 5MB 的文件需浏览器直传，请在 Bucket 的 CORS 中允许当前域名的 PUT 请求'));
          xhr.send(file);
        });
        ok++;
      } catch (e) {
        toast.error(`${file.name} 上传失败：${errMsg(e)}`);
      } finally {
        setUploads((u) => {
          const n = { ...u };
          delete n[file.name];
          return n;
        });
      }
    }
    if (ok) toast.success(`已上传 ${ok} 个文件`);
    if (fileRef.current) fileRef.current.value = '';
    refresh();
  };

  const download = async (key: string) => {
    try {
      window.open(await presign(key, 'download'), '_blank');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const openPreview = async (o: ObjItem) => {
    const kind = fileKind(o.key);
    setPreview({ key: o.key, kind });
    try {
      if (kind === 'text') {
        const r = await api<{ text: string; truncated: boolean }>('/api/v1/s3/preview_text', { connection_id: cid, key: o.key });
        setPreview({ key: o.key, kind, text: r.text, truncated: r.truncated });
      } else {
        setPreview({ key: o.key, kind, url: await presign(o.key, 'get') });
      }
    } catch (e) {
      toast.error(errMsg(e));
      setPreview(null);
    }
  };

  const mkdir = async () => {
    const name = prompt('新建文件夹名称');
    if (!name?.trim()) return;
    try {
      await api('/api/v1/s3/mkdir', { connection_id: cid, key: prefix + name.trim().replace(/^\/+|\/+$/g, '') + '/' });
      toast.success('文件夹已创建');
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const removeSel = async () => {
    const n = selFolders.size + selObjs.size;
    if (!n) return;
    const warn = selFolders.size ? `，其中 ${selFolders.size} 个文件夹将删除其下全部对象` : '';
    if (!confirm(`确定删除所选 ${n} 项${warn}？此操作不可恢复。`)) return;
    setLoading(true);
    try {
      const r = await api<{ deleted: number; errors: string[]; truncated: boolean }>('/api/v1/s3/delete', { connection_id: cid, keys: [...selObjs.keys()], prefixes: [...selFolders] });
      if (r.errors.length) toast.error(`部分失败：${r.errors[0]}`);
      toast.success(`已删除 ${r.deleted} 个对象${r.truncated ? '（对象较多，剩余部分请再次删除）' : ''}`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      refresh();
    }
  };

  const toggleFolder = (f: string) => setSelFolders((s) => {
    const n = new Set(s);
    if (n.has(f)) n.delete(f);
    else n.add(f);
    return n;
  });
  const toggleObj = (o: ObjItem) => setSelObjs((s) => {
    const n = new Map(s);
    if (n.has(o.key)) n.delete(o.key);
    else n.set(o.key, o);
    return n;
  });
  const allCount = (data?.folders.length || 0) + (data?.objects.length || 0);
  const selCount = selFolders.size + selObjs.size;
  const toggleAll = () => {
    if (selCount === allCount) return clearSel();
    setSelFolders(new Set(data?.folders));
    setSelObjs(new Map(data?.objects.map((o) => [o.key, o])));
  };

  const parts = prefix.split('/').filter(Boolean);
  const uploading = Object.entries(uploads);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={connId} onValueChange={(v) => { setConnId(v); setPrefix(''); setQuery(''); setShowStats(false); }}>
          <SelectTrigger className="w-full bg-white sm:w-72"><SelectValue placeholder="选择存储连接" /></SelectTrigger>
          <SelectContent>{conns.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}（{c.bucket}）</SelectItem>)}</SelectContent>
        </Select>
        {connId && (
          <form className="flex min-w-0 flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); doSearch(); }}>
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[#5B6B66]" />
              <Input className="bg-white pl-8" placeholder="在当前目录及子目录中按名称搜索" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <Button type="submit" variant="outline" className="bg-white">搜索</Button>
          </form>
        )}
      </div>

      {connId && (
        <>
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
            <Button size="sm" className="bg-[#0F766E] text-white hover:bg-[#115E59]" onClick={() => fileRef.current?.click()}><Upload className="mr-1 h-4 w-4" />上传</Button>
            <Button size="sm" variant="outline" className="bg-white" onClick={mkdir}><FolderPlus className="mr-1 h-4 w-4" />新建文件夹</Button>
            <Button size="sm" variant="outline" className="bg-white" disabled={!selCount} onClick={() => setMigrate({ source_id: cid, source_prefix: prefix, items: [...selObjs.values()], prefixes: [...selFolders] })}>
              <ArrowRightLeft className="mr-1 h-4 w-4" />迁移所选{selCount ? `（${selCount}）` : ''}
            </Button>
            <Button size="sm" variant="outline" className="bg-white text-[#B91C1C] hover:text-[#B91C1C]" disabled={!selCount} onClick={removeSel}><Trash2 className="mr-1 h-4 w-4" />删除所选</Button>
            <Button size="sm" variant="outline" className={`bg-white ${showStats ? 'border-[#0F766E] text-[#0F766E]' : ''}`} onClick={() => setShowStats(!showStats)}><BarChart3 className="mr-1 h-4 w-4" />存储概览</Button>
          </div>

          {showStats && <StatsPanel connectionId={cid} prefix={prefix} />}

          {uploading.length > 0 && (
            <div className="space-y-1 rounded-lg border border-[#DDE3E0] bg-white p-3">
              {uploading.map(([name, pct]) => (
                <div key={name} className="flex items-center gap-2 text-xs">
                  <span className="mono w-48 truncate">{name}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded bg-[#EEF1EF]"><div className="h-full bg-[#0F766E] transition-all" style={{ width: `${pct}%` }} /></div>
                  <span className="mono w-10 text-right">{pct}%</span>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-lg border border-[#DDE3E0] bg-white">
            <div className="mono flex flex-wrap items-center gap-1 border-b border-[#DDE3E0] px-4 py-2 text-sm">
              <button className="text-[#0F766E] hover:underline" onClick={() => setPrefix('')}>根目录</button>
              {parts.map((p, i) => (
                <span key={i}>/ <button className="text-[#0F766E] hover:underline" onClick={() => setPrefix(parts.slice(0, i + 1).join('/') + '/')}>{p}</button></span>
              ))}
              <Button size="sm" variant="outline" className="ml-auto h-8" disabled={loading} onClick={refresh}>
                <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新
              </Button>
            </div>
            {searchInfo && (
              <div className="flex items-center justify-between bg-[#CCFBF1] px-4 py-2 text-xs text-[#0F766E]">
                <span>搜索「{searchInfo.q}」：找到 {data?.objects.length || 0} 个，扫描 {searchInfo.scanned} 个对象{searchInfo.truncated ? '（结果已截断）' : ''}</span>
                <button className="flex items-center gap-1 hover:underline" onClick={() => { setQuery(''); refresh(); }}><X className="h-3 w-3" />清除</button>
              </div>
            )}
            {error && <p className="p-4 text-sm text-[#B91C1C]">{error}</p>}
            {loading && !data && <div className="p-6 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>}
            {data && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#F4F6F5] text-left text-xs text-[#5B6B66]">
                    <tr>
                      <th className="w-10 px-4 py-2"><Checkbox aria-label="全选" checked={allCount > 0 && selCount === allCount} onCheckedChange={toggleAll} /></th>
                      <th className="px-2 py-2">名称</th><th className="px-4 py-2">大小</th><th className="px-4 py-2">存储类型</th><th className="px-4 py-2">修改时间</th><th className="px-4 py-2 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.folders.map((f) => (
                      <tr key={f} className="border-t border-[#EEF1EF] hover:bg-[#F4F6F5]">
                        <td className="px-4 py-2"><Checkbox aria-label="选择文件夹" checked={selFolders.has(f)} onCheckedChange={() => toggleFolder(f)} /></td>
                        <td className="mono cursor-pointer px-2 py-2" onClick={() => setPrefix(f)}><Folder className="mr-2 inline h-4 w-4 text-[#B45309]" />{f.slice(prefix.length)}</td>
                        <td className="px-4 py-2">-</td><td className="px-4 py-2">-</td><td className="px-4 py-2">-</td><td />
                      </tr>
                    ))}
                    {data.objects.map((o) => {
                      const canPreview = fileKind(o.key) !== 'other';
                      return (
                        <tr key={o.key} className="border-t border-[#EEF1EF] hover:bg-[#F4F6F5]">
                          <td className="px-4 py-2"><Checkbox aria-label="选择对象" checked={selObjs.has(o.key)} onCheckedChange={() => toggleObj(o)} /></td>
                          <td className="mono break-all px-2 py-2">
                            <button className={`text-left ${canPreview ? 'hover:text-[#0F766E] hover:underline' : ''}`} onClick={() => canPreview && openPreview(o)}>
                              <File className="mr-2 inline h-4 w-4 text-[#5B6B66]" />{searchInfo ? o.key : o.key.slice(prefix.length)}
                            </button>
                          </td>
                          <td className="mono whitespace-nowrap px-4 py-2">{fmtBytes(o.size)}</td>
                          <td className="whitespace-nowrap px-4 py-2 text-xs text-[#5B6B66]">{o.storage_class}</td>
                          <td className="whitespace-nowrap px-4 py-2 text-[#5B6B66]">{o.mtime ? new Date(o.mtime * 1000).toLocaleString() : '-'}</td>
                          <td className="whitespace-nowrap px-4 py-2 text-right">
                            {canPreview && <Button size="icon" variant="ghost" aria-label="预览" className="h-8 w-8" onClick={() => openPreview(o)}><Eye className="h-4 w-4" /></Button>}
                            <Button size="icon" variant="ghost" aria-label="下载" className="h-8 w-8" onClick={() => download(o.key)}><Download className="h-4 w-4" /></Button>
                          </td>
                        </tr>
                      );
                    })}
                    {!data.folders.length && !data.objects.length && <tr><td colSpan={6} className="p-6 text-center text-[#5B6B66]">{searchInfo ? '没有匹配的对象' : '此目录为空'}</td></tr>}
                  </tbody>
                </table>
                {data.next_token && (
                  <div className="p-3 text-center"><Button variant="outline" disabled={loading} onClick={() => load(connId, prefix, data.next_token)}>加载更多</Button></div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <Dialog open={!!preview} onOpenChange={(v) => !v && setPreview(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle className="mono break-all pr-6 text-sm">{preview?.key}</DialogTitle></DialogHeader>
          {preview && !preview.url && preview.text === undefined && <Loader2 className="mx-auto my-10 h-6 w-6 animate-spin" />}
          {preview?.kind === 'image' && preview.url && <img src={preview.url} alt={preview.key} className="mx-auto max-h-[70vh] object-contain" />}
          {preview?.kind === 'video' && preview.url && <video src={preview.url} controls className="max-h-[70vh] w-full" />}
          {preview?.kind === 'audio' && preview.url && <audio src={preview.url} controls className="w-full" />}
          {preview?.kind === 'pdf' && preview.url && <iframe src={preview.url} title={preview.key} className="h-[70vh] w-full rounded border" />}
          {preview?.text !== undefined && (
            <>
              <pre className="mono max-h-[65vh] overflow-auto whitespace-pre-wrap break-all rounded-md bg-[#F4F6F5] p-3 text-xs">{preview.text}</pre>
              {preview.truncated && <p className="text-xs text-[#B45309]">文件较大，仅显示前 200 KB</p>}
            </>
          )}
          {preview && <div className="flex justify-end"><Button variant="outline" onClick={() => download(preview.key)}><Download className="mr-1 h-4 w-4" />下载</Button></div>}
        </DialogContent>
      </Dialog>

      <TaskForm open={!!migrate} onOpenChange={(v) => !v && setMigrate(null)} conns={conns} preselect={migrate} onCreated={() => { clearSel(); toast.info('可在「迁移任务」中查看进度'); }} />
    </div>
  );
}

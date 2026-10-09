import { useEffect, useState } from 'react';
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Loader2 } from 'lucide-react';
import { api, errMsg, fmtBytes } from '@/lib/s3api';

interface Bucket { name: string; count: number; size: number }
interface Stats {
  count: number;
  total_size: number;
  by_ext: Bucket[];
  by_class: Bucket[];
  largest: { key: string; size: number }[];
  truncated: boolean;
}

const COLORS = ['#0F766E', '#14B8A6', '#5EEAD4', '#B45309', '#F59E0B', '#15803D', '#64748B', '#0E7490', '#A16207', '#334155', '#99F6E4', '#FCD34D'];

export default function StatsPanel({ connectionId, prefix }: { connectionId: number; prefix: string }) {
  const [data, setData] = useState<Stats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    api<Stats>('/api/v1/s3/stats', { connection_id: connectionId, prefix })
      .then((r) => alive && setData(r))
      .catch((e) => alive && setError(errMsg(e)));
    return () => { alive = false; };
  }, [connectionId, prefix]);

  if (error) return <div className="rounded-lg border border-[#DDE3E0] bg-white p-4 text-sm text-[#B91C1C]">{error}</div>;
  if (!data) return <div className="flex items-center justify-center gap-2 rounded-lg border border-[#DDE3E0] bg-white p-8 text-sm text-[#5B6B66]"><Loader2 className="h-4 w-4 animate-spin" />正在统计 {prefix || '整个 Bucket'}…</div>;

  return (
    <div className="space-y-4 rounded-lg border border-[#DDE3E0] bg-white p-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['对象数', data.count.toLocaleString()],
          ['总容量', fmtBytes(data.total_size)],
          ['平均大小', fmtBytes(data.count ? data.total_size / data.count : 0)],
          ['文件类型', String(data.by_ext.length)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-md bg-[#F4F6F5] px-3 py-2">
            <p className="text-xs text-[#5B6B66]">{k}</p>
            <p className="mono text-lg font-semibold text-[#0F766E]">{v}</p>
          </div>
        ))}
      </div>
      {data.truncated && <p className="text-xs text-[#B45309]">对象数量较多，统计已在时间上限处截断，结果为部分数据。</p>}
      {data.count > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-semibold">按文件类型（容量）</p>
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={data.by_ext} layout="vertical" margin={{ left: 10, right: 10 }}>
                  <XAxis type="number" tickFormatter={(v) => fmtBytes(v)} fontSize={11} />
                  <YAxis type="category" dataKey="name" width={70} fontSize={11} />
                  <Tooltip formatter={(v: number, _n, p) => [`${fmtBytes(v)}（${p.payload.count} 个）`, '容量']} />
                  <Bar dataKey="size" radius={[0, 4, 4, 0]}>{data.by_ext.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold">按存储类型</p>
            <div className="h-56">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={data.by_class} dataKey="size" nameKey="name" innerRadius={50} outerRadius={80} label={(e) => e.name}>
                    {data.by_class.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number, n, p) => [`${fmtBytes(v)}（${p.payload.count} 个）`, n]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="lg:col-span-2">
            <p className="mb-2 text-sm font-semibold">最大的 10 个对象</p>
            <table className="w-full text-xs">
              <tbody>{data.largest.map((o) => (
                <tr key={o.key} className="border-t border-[#EEF1EF]"><td className="mono break-all py-1 pr-2">{o.key}</td><td className="mono whitespace-nowrap py-1 text-right">{fmtBytes(o.size)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

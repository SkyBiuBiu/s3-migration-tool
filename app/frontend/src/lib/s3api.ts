import { client } from '@/lib/api';

export interface Connection {
  id: number;
  name: string;
  endpoint: string;
  region: string;
  bucket: string;
  path_style: boolean;
  access_key_masked: string;
  secret_key_masked: string;
}

export interface ObjItem {
  key: string;
  size: number;
  etag?: string;
  mtime?: number;
  storage_class?: string;
}

export interface FailedItem extends ObjItem {
  error: string;
}

export interface LogEntry {
  t: number;
  level: 'info' | 'warn' | 'error' | 'success';
  msg: string;
}

export interface Task {
  id: number;
  name: string;
  status: string;
  busy?: boolean;
  locked?: boolean;
  source_id: number;
  target_id: number;
  source_prefix?: string;
  target_prefix?: string;
  sync_mode?: string;
  verify?: boolean;
  concurrency?: number;
  bandwidth_mbps?: number | null;
  include_suffixes?: string;
  exclude_suffixes?: string;
  total_count: number;
  total_bytes: number;
  done_count: number;
  skipped_count: number;
  failed_count: number;
  verified_count: number;
  bytes_transferred: number;
  processed_bytes: number;
  listing_done: boolean;
  pending: number;
  error_message?: string | null;
  failed_items: FailedItem[];
  logs: LogEntry[];
  last_run_at: number;
}

export interface TaskInput {
  name?: string;
  source_id: number;
  target_id: number;
  source_prefix?: string;
  target_prefix?: string;
  sync_mode: 'full' | 'skip_existing' | 'incremental';
  verify: boolean;
  concurrency: number;
  bandwidth_mbps?: number | null;
  include_suffixes?: string;
  exclude_suffixes?: string;
  min_size?: number | null;
  max_size?: number | null;
  modified_after?: string | null;
  modified_before?: string | null;
  selected_prefixes?: string[];
  selected_items?: ObjItem[];
}

export const errMsg = (e: unknown): string => {
  const x = e as { data?: { detail?: string }; response?: { data?: { detail?: string } }; message?: string };
  return x?.data?.detail || x?.response?.data?.detail || x?.message || '请求失败';
};

export const fmtBytes = (n = 0): string => {
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
};

export const fmtDuration = (sec: number): string => {
  if (!isFinite(sec) || sec <= 0) return '-';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h ? `${h}时${m}分` : m ? `${m}分${s}秒` : `${s}秒`;
};

export const api = async <T,>(url: string, data: object = {}, method: 'GET' | 'POST' | 'DELETE' = 'POST'): Promise<T> => {
  const res = await client.apiCall.invoke({ url, method, data });
  return res.data as T;
};

export const downloadCsv = (filename: string, rows: (string | number)[][]) => {
  const esc = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob(['\ufeff' + rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
};

export const fileKind = (key: string): 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'other' => {
  const ext = key.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (['txt', 'md', 'json', 'csv', 'log', 'xml', 'yaml', 'yml', 'html', 'htm', 'css', 'js', 'ts', 'tsx', 'py', 'java', 'go', 'sh', 'ini', 'conf', 'sql', 'env', 'toml'].includes(ext)) return 'text';
  return 'other';
};

export interface Preset {
  id: string;
  label: string;
  regions: { value: string; label: string }[];
  endpoint: (region: string) => string;
  path_style: boolean;
  hint?: string;
}

export const PRESETS: Preset[] = [
  {
    id: 'aws', label: 'AWS S3', path_style: false,
    regions: [['us-east-1', '美东(弗吉尼亚)'], ['us-west-2', '美西(俄勒冈)'], ['ap-east-1', '香港'], ['ap-southeast-1', '新加坡'], ['ap-northeast-1', '东京'], ['eu-central-1', '法兰克福'], ['cn-north-1', '北京(中国区)'], ['cn-northwest-1', '宁夏(中国区)']].map(([value, label]) => ({ value, label })),
    endpoint: (r) => (r.startsWith('cn-') ? `https://s3.${r}.amazonaws.com.cn` : `https://s3.${r}.amazonaws.com`),
  },
  {
    id: 'aliyun', label: '阿里云 OSS', path_style: false, hint: 'OSS 需使用 V4 签名，部分老 Bucket 可能不支持',
    regions: [['cn-hangzhou', '杭州'], ['cn-shanghai', '上海'], ['cn-beijing', '北京'], ['cn-shenzhen', '深圳'], ['cn-qingdao', '青岛'], ['cn-chengdu', '成都'], ['cn-hongkong', '香港'], ['ap-southeast-1', '新加坡']].map(([value, label]) => ({ value, label })),
    endpoint: (r) => `https://oss-${r}.aliyuncs.com`,
  },
  {
    id: 'tencent', label: '腾讯云 COS', path_style: false, hint: 'Bucket 名需包含 APPID 后缀，如 demo-1250000000',
    regions: [['ap-beijing', '北京'], ['ap-shanghai', '上海'], ['ap-guangzhou', '广州'], ['ap-chengdu', '成都'], ['ap-nanjing', '南京'], ['ap-hongkong', '香港'], ['ap-singapore', '新加坡']].map(([value, label]) => ({ value, label })),
    endpoint: (r) => `https://cos.${r}.myqcloud.com`,
  },
  {
    id: 'huawei', label: '华为云 OBS', path_style: false,
    regions: [['cn-north-4', '北京四'], ['cn-east-3', '上海一'], ['cn-south-1', '广州'], ['ap-southeast-1', '香港']].map(([value, label]) => ({ value, label })),
    endpoint: (r) => `https://obs.${r}.myhuaweicloud.com`,
  },
  {
    id: 'qiniu', label: '七牛云 Kodo', path_style: false,
    regions: [['cn-east-1', '华东-浙江'], ['cn-north-1', '华北-河北'], ['cn-south-1', '华南-广东'], ['us-north-1', '北美']].map(([value, label]) => ({ value, label })),
    endpoint: (r) => `https://s3.${r}.qiniucs.com`,
  },
  {
    id: 'r2', label: 'Cloudflare R2', path_style: true, hint: '将 <ACCOUNT_ID> 替换为你的账户 ID',
    regions: [{ value: 'auto', label: 'auto' }],
    endpoint: () => 'https://<ACCOUNT_ID>.r2.cloudflarestorage.com',
  },
  {
    id: 'minio', label: 'MinIO / 自建', path_style: true, hint: '填写 http(s)://服务器IP:9000，需公网可访问',
    regions: [{ value: 'us-east-1', label: 'us-east-1' }],
    endpoint: () => 'http://your-server:9000',
  },
];

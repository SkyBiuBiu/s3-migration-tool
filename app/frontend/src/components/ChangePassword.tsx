import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { api, errMsg } from '@/lib/s3api';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** When true the dialog cannot be dismissed until the password is changed. */
  forced?: boolean;
  onChanged?: () => void;
}

export default function ChangePassword({ open, onOpenChange, forced, onChanged }: Props) {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPw.length < 6) return toast.error('新密码至少 6 位');
    if (newPw !== confirmPw) return toast.error('两次输入的新密码不一致');
    setBusy(true);
    try {
      await api('/api/v1/s3/account/change_password', { old_password: oldPw, new_password: newPw });
      toast.success('密码已修改');
      setOldPw(''); setNewPw(''); setConfirmPw('');
      onChanged?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !forced && onOpenChange(v)}>
      <DialogContent
        className={`sm:max-w-sm ${forced ? '[&>button:last-child]:hidden' : ''}`}
        onInteractOutside={(e) => forced && e.preventDefault()}
        onEscapeKeyDown={(e) => forced && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{forced ? '请先修改初始密码' : '修改密码'}</DialogTitle>
          {forced && <DialogDescription>当前账号仍在使用初始密码，为保障安全，修改后才能继续使用。</DialogDescription>}
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1"><Label>原密码</Label><Input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} required /></div>
          <div className="space-y-1"><Label>新密码</Label><Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} required /></div>
          <div className="space-y-1"><Label>确认新密码</Label><Input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} required /></div>
          <DialogFooter><Button type="submit" disabled={busy} className="bg-[#0F766E] text-white hover:bg-[#115E59]">{busy ? '提交中…' : '确认修改'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

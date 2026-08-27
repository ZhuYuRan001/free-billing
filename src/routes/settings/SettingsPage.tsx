import { useRef, useState } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { exportBackup, restoreBackup } from '../../application/backup';

function download(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `free-billing-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function SettingsPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function backup() {
    if (password.length < 8) {
      setMessage('备份密码至少需要 8 位。');
      return;
    }
    setBusy(true);
    try {
      download(await exportBackup(password));
      setMessage('加密备份已导出，请妥善保管密码。');
    } catch {
      setMessage('备份导出失败。');
    } finally {
      setBusy(false);
    }
  }
  async function restore(file?: File) {
    if (!file || password.length < 8) {
      setMessage('请先输入至少 8 位备份密码。');
      return;
    }
    setBusy(true);
    try {
      await restoreBackup(file, password);
      setMessage('备份恢复成功，刷新页面后即可查看。');
    } catch {
      setMessage('恢复失败：密码错误或文件已损坏。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="SETTINGS"
        title="掌控你的数据。"
        description="没有账号，没有同步，只有你和这台设备。"
      />
      <section className="settings-grid">
        <div className="panel settings-card">
          <span className="settings-icon">◈</span>
          <h2>加密备份</h2>
          <p>使用 AES-GCM 在本地加密全部账本数据。Free Billing 不会保存你的密码。</p>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="输入备份密码（至少 8 位）"
          />
          <div className="button-row">
            <button className="button primary" disabled={busy} onClick={() => void backup()}>
              导出备份
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              恢复备份
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="application/json"
              hidden
              onChange={(event) => void restore(event.target.files?.[0])}
            />
          </div>
          {message && <div className="inline-message">{message}</div>}
        </div>
        <div className="panel settings-card">
          <span className="settings-icon">⌁</span>
          <h2>隐私边界</h2>
          <ul className="plain-list">
            <li>
              <span>✓</span>账单只处理在当前浏览器
            </li>
            <li>
              <span>✓</span>原始流水不会被删除
            </li>
            <li>
              <span>✓</span>不接入统计 SDK 或远程字体
            </li>
            <li>
              <span>✓</span>Service Worker 不缓存财务数据
            </li>
          </ul>
          <div className="warning-box">
            IndexedDB 不是可靠备份。建议每月导出一次加密备份，并将密码保存在密码管理器中。
          </div>
        </div>
      </section>
    </>
  );
}

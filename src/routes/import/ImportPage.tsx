import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import {
  detectStatementSource,
  IMPORT_SOURCE_LABELS,
  type ImportSource,
} from '../../infrastructure/importers/registry';
import { importStatement } from '../../application/import-statement';

type SourceChoice = ImportSource | 'auto';

export function ImportPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string }>();
  const [warnings, setWarnings] = useState<string[]>([]);
  const [pendingFile, setPendingFile] = useState<File>();
  const [detectedSource, setDetectedSource] = useState<ImportSource>();
  const [sourceChoice, setSourceChoice] = useState<SourceChoice>('auto');

  async function prepareFile(file?: File) {
    if (!file) return;
    setBusy(true);
    setMessage(undefined);
    setWarnings([]);
    try {
      const detected = await detectStatementSource(file);
      setPendingFile(file);
      setDetectedSource(detected);
      setSourceChoice('auto');
      setMessage({
        type: 'success',
        text: detected
          ? `已识别为${IMPORT_SOURCE_LABELS[detected]}，请确认来源后导入。`
          : '无法自动识别来源，请选择正确的导入来源。',
      });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '无法读取账单文件。' });
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    if (!pendingFile) return;
    const source = sourceChoice === 'auto' ? detectedSource : sourceChoice;
    if (!source) {
      setMessage({ type: 'error', text: '请先选择支付宝、微信支付或建设银行。' });
      return;
    }

    setBusy(true);
    setMessage(undefined);
    try {
      const result = await importStatement(pendingFile, source);
      setWarnings(result.warnings);
      setMessage({ type: 'success', text: `成功导入 ${result.batch.importedCount} 笔，跳过重复 ${result.batch.skippedCount} 笔。` });
      setPendingFile(undefined);
      setDetectedSource(undefined);
      setSourceChoice('auto');
      if (inputRef.current) inputRef.current.value = '';
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '导入失败，请检查文件格式。' });
    } finally {
      setBusy(false);
    }
  }

  function cancelPendingImport() {
    setPendingFile(undefined);
    setDetectedSource(undefined);
    setSourceChoice('auto');
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <>
      <PageHeader
        eyebrow="IMPORT"
        title="把账单交给我整理。"
        description="支持支付宝、微信支付和建设银行导出的 CSV / XLSX / XLS 文件。文件只在浏览器内处理，不会上传。"
      />
      <section className="import-layout">
        <div
          className="dropzone"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void prepareFile(event.dataTransfer.files[0]);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            hidden
            onChange={(event) => void prepareFile(event.target.files?.[0])}
          />
          <div className="upload-icon">↥</div>
          <h2>{busy ? '正在读取账单…' : '拖入账单文件'}</h2>
          <p>或点击选择文件 · CSV / XLSX / XLS</p>
          <span className="button primary">选择文件</span>
        </div>
        <div className="panel guide-panel">
          <span className="eyebrow">HOW IT WORKS</span>
          <h2>四步完成整理</h2>
          <div className="guide-step">
            <b>01</b>
            <div>
              <strong>读取账单</strong>
              <p>自动跳过支付宝、微信和银行账单中的说明行，定位真实表头。</p>
            </div>
          </div>
          <div className="guide-step">
            <b>02</b>
            <div>
              <strong>确认来源</strong>
              <p>自动识别失败时，可以手动选择支付宝、微信支付或建设银行。</p>
            </div>
          </div>
          <div className="guide-step">
            <b>03</b>
            <div>
              <strong>标准化</strong>
              <p>金额统一转换为整数分，银行正负金额转换为收入和支出。</p>
            </div>
          </div>
          <div className="guide-step">
            <b>04</b>
            <div>
              <strong>去重匹配</strong>
              <p>相同文件不会重复入账，跨来源流水自动关联。</p>
            </div>
          </div>
        </div>
      </section>
      {pendingFile && (
        <section className="panel source-picker">
          <div>
            <span className="eyebrow">SOURCE</span>
            <h2>{pendingFile.name}</h2>
            <p>
              {detectedSource
                ? `自动识别为${IMPORT_SOURCE_LABELS[detectedSource]}，请确认后继续。`
                : '未能自动识别，请选择该文件的导出来源。'}
            </p>
          </div>
          <label>
            导入来源
            <select value={sourceChoice} onChange={(event) => setSourceChoice(event.target.value as SourceChoice)}>
              <option value="auto">{detectedSource ? `自动识别（${IMPORT_SOURCE_LABELS[detectedSource]}）` : '请选择来源'}</option>
              {(Object.keys(IMPORT_SOURCE_LABELS) as ImportSource[]).map((source) => (
                <option key={source} value={source}>
                  {IMPORT_SOURCE_LABELS[source]}
                </option>
              ))}
            </select>
          </label>
          <div className="button-row">
            <button className="button primary" onClick={() => void confirmImport()} disabled={busy || (!detectedSource && sourceChoice === 'auto')}>
              {busy ? '正在导入…' : '确认导入'}
            </button>
            <button className="button secondary" onClick={cancelPendingImport} disabled={busy}>
              重新选择
            </button>
          </div>
        </section>
      )}
      {message && (
        <div className={`notice ${message.type}`}>
          {message.text}
          {message.type === 'success' && !pendingFile && (
            <button className="text-button" onClick={() => navigate('/transactions')}>
              去看流水 →
            </button>
          )}
        </div>
      )}
      {warnings.length > 0 && (
        <details className="warnings">
          <summary>导入信息（{warnings.length}）</summary>
          {warnings.slice(0, 10).map((warning, index) => (
            <p key={index}>{warning}</p>
          ))}
        </details>
      )}
      <section className="privacy-note">
        <span>✦</span>
        <div>
          <strong>本地优先，财务数据不出设备</strong>
          <p>Free Billing 不使用服务器、统计 SDK 或远程字体。建议定期在设置页导出加密备份。</p>
        </div>
      </section>
    </>
  );
}

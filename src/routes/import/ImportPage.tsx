import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import { formatSignedMoney } from '../../domain/money';
import {
  CMB_PDF_SOURCE_LABEL,
  detectStatementSource,
  IMPORT_SOURCE_LABELS,
  isPdfStatement,
  parseStatement,
  type ImportSource,
} from '../../infrastructure/importers/registry';
import type { ParsedStatement } from '../../infrastructure/importers/types';
import { importStatement, saveParsedStatement } from '../../application/import-statement';

type ImportFile = {
  id: string;
  file: File;
  source?: ImportSource;
  preview?: ParsedStatement;
  readError?: string;
  importError?: string;
  result?: Awaited<ReturnType<typeof importStatement>>;
};

function PdfPreview({ statement }: { statement: ParsedStatement }) {
  return (
    <div className="import-preview" role="region" aria-label="PDF 交易明细预览" tabIndex={0}>
      <table>
        <thead>
          <tr><th scope="col">记账日期</th><th scope="col">交易对方</th><th scope="col">收支</th><th scope="col">交易金额</th></tr>
        </thead>
        <tbody>
          {statement.events.map((event) => (
            <tr key={event.id}>
              <td><time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleDateString('zh-CN')}</time></td>
              <td>{event.merchant}</td>
              <td>{event.direction === 'income' ? '收入' : '支出'}</td>
              <td>{formatSignedMoney(event.amountMinor, event.direction)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ImportPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const processing = useRef(false);
  const navigate = useNavigate();
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [phase, setPhase] = useState<'reading' | 'importing'>();
  const pendingFiles = files.filter((item) => !item.result && !item.readError);
  const readyFiles = pendingFiles.filter((item) => item.source || item.preview);

  async function prepareFiles(selectedFiles: File[]) {
    if (processing.current || !selectedFiles.length) return;
    processing.current = true;
    setPhase('reading');
    try {
      const prepared = await Promise.all(
        selectedFiles.map(async (file): Promise<ImportFile> => {
          const id = crypto.randomUUID();
          try {
            if (isPdfStatement(file)) return { id, file, preview: await parseStatement(file) };
            return { id, file, source: await detectStatementSource(file) };
          } catch (error) {
            return { id, file, readError: error instanceof Error ? error.message : '无法读取账单文件。' };
          }
        }),
      );
      setFiles((current) => [
        ...(current.some((item) => !item.result && !item.readError) ? current : []),
        ...prepared,
      ]);
    } finally {
      processing.current = false;
      setPhase(undefined);
    }
  }

  async function confirmImport() {
    if (processing.current || !readyFiles.length) return;
    processing.current = true;
    setPhase('importing');
    try {
      for (const { id, file, source, preview } of readyFiles) {
        try {
          const result = preview
            ? await saveParsedStatement(file.name, preview)
            : await importStatement(file, source);
          setFiles((current) => current.map((item) =>
            item.id === id ? { ...item, result, preview: undefined, importError: undefined } : item,
          ));
        } catch (error) {
          const importError = error instanceof Error ? error.message : '导入失败，请检查文件格式。';
          setFiles((current) => current.map((item) => item.id === id ? { ...item, importError } : item));
        }
      }
    } finally {
      processing.current = false;
      setPhase(undefined);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="IMPORT"
        title="把账单交给我整理。"
        description="支持支付宝、微信支付和建设银行的表格账单，以及招商银行的文字版 PDF 流水。文件只在浏览器内处理，不会上传。"
      />
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls,.pdf"
        multiple
        hidden
        onChange={(event) => {
          const selectedFiles = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          void prepareFiles(selectedFiles);
        }}
      />
      <section className="import-layout">
        <div
          className="dropzone"
          onClick={() => {
            if (!processing.current) inputRef.current?.click();
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void prepareFiles(Array.from(event.dataTransfer.files));
          }}
        >
          <div className="upload-icon">↥</div>
          <h2 aria-live="polite">
            {phase === 'reading' ? '正在识别账单…' : phase === 'importing' ? '正在导入账单…' : '拖入账单文件'}
          </h2>
          <p>可同时选择或拖入多个 CSV / XLSX / XLS / PDF 文件</p>
          <button className="button primary" type="button" disabled={Boolean(phase)}>选择文件</button>
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
      {files.length > 0 && (
        <section className="panel import-queue" aria-labelledby="import-files-heading">
          <div className="panel-heading">
            <h2 id="import-files-heading">账单文件（{files.length}）</h2>
            {pendingFiles.length > 0 && (
              <button
                className="button primary"
                onClick={() => void confirmImport()}
                disabled={Boolean(phase) || readyFiles.length === 0}
              >
                {phase === 'importing'
                  ? '正在导入…'
                  : files.length === 1 || readyFiles.length === 0
                    ? '确认导入'
                    : `导入 ${readyFiles.length} 个文件`}
              </button>
            )}
          </div>
          <ul className="import-files">
            {files.map(({ id, file, source, preview, readError, importError, result }) => (
              <li className="source-picker" key={id}>
                <div>
                  <h3 title={file.name}>{file.name}</h3>
                  {(readError || importError) && (
                    <p className="import-file-error" role="alert">{readError || importError}</p>
                  )}
                  {!readError && !source && !preview && !result && <p>未能自动识别，请选择来源。</p>}
                  {preview && <p>{CMB_PDF_SOURCE_LABEL} · 识别到 {preview.events.length} 笔交易</p>}
                  {result && (
                    <>
                      <p role="status">
                        成功导入 {result.batch.importedCount} 笔，跳过重复 {result.batch.skippedCount} 笔。
                      </p>
                      {result.warnings.length > 0 && (
                        <details className="warnings">
                          <summary>导入信息（{result.warnings.length}）</summary>
                          {result.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
                        </details>
                      )}
                    </>
                  )}
                </div>
                {!readError && !result && !preview && (
                  <label>
                    导入来源
                    <select
                      aria-label={`${file.name} 的导入来源`}
                      value={source ?? ''}
                      disabled={Boolean(phase)}
                      onChange={(event) => {
                        const nextSource = event.target.value as ImportSource;
                        setFiles((current) => current.map((item) =>
                          item.id === id ? { ...item, source: nextSource, importError: undefined } : item,
                        ));
                      }}
                    >
                      <option value="" disabled>请选择来源</option>
                      {Object.entries(IMPORT_SOURCE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                )}
                {!result && (
                  <button
                    className="button secondary"
                    aria-label={`移除 ${file.name}`}
                    disabled={Boolean(phase)}
                    onClick={() => setFiles((current) => current.filter((item) => item.id !== id))}
                  >
                    移除
                  </button>
                )}
                {preview && <PdfPreview statement={preview} />}
              </li>
            ))}
          </ul>
          {files.some((item) => item.result) && (
            <div className="list-footer">
              <button className="text-button" onClick={() => navigate('/transactions')} disabled={Boolean(phase)}>
                去看流水 →
              </button>
            </div>
          )}
        </section>
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

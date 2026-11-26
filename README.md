# Free Billing

一个 local-first 的自动总结记账 PWA MVP。账单文件在浏览器本地解析，标准化为整数分后保存到 IndexedDB，不需要账号、后端或云同步。

## 已实现

- React + TypeScript + React Router v8 Data Mode
- Dexie / IndexedDB 作为唯一持久化数据源
- CSV、XLSX、XLS 导入；根据列名识别微信、支付宝和建设银行格式
- 招商银行文字版 PDF 流水导入，预览确认后入账
- 同源指纹去重、跨来源一对一匹配、低置信度待确认
- 内置商户分类与自定义分类规则
- 总览、流水、待确认、统计、规则、设置页面
- AES-GCM 密码保护的备份导出与恢复
- 金额统一以整数分存储，领域匹配算法保持纯 TypeScript

## 开发

```bash
pnpm install
pnpm run dev
```

验证命令：

```bash
pnpm run lint
pnpm test
pnpm run build
```

## 文件格式

CSV/XLSX 至少需要包含可识别的列名，例如：

| 日期 | 商户 | 金额 | 收支 |
| --- | --- | ---: | --- |
| 2026-08-24 10:15 | 瑞幸咖啡 | 32.50 | 支出 |

也支持 `交易时间`、`交易对方`、`交易金额`、`交易类型`、`订单号` 等常见列名。

招商银行 PDF 支持带文字层的人民币交易流水。交易金额正数记为收入，负数记为支出。

## 隐私边界

原始流水和标准化账目只保存于当前浏览器的 IndexedDB。Service Worker 只缓存应用资源，不缓存财务数据；云同步和 AI 总结暂未接入。请在设置页定期导出加密备份，IndexedDB 本身不是可靠备份。

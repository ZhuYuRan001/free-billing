import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../infrastructure/database/db";
import { DEFAULT_CATEGORIES } from "../../domain/classification";
import { rebuildStoredLedger } from "../../application/import-statement";
import { PageHeader } from "../../components/PageHeader";

export function RulesPage() {
  const rules = useLiveQuery(
    () => db.merchantRules.orderBy("createdAt").reverse().toArray(),
    [],
    [],
  );
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState(DEFAULT_CATEGORIES[0]);
  async function addRule() {
    if (!keyword.trim()) return;
    await db.merchantRules.add({
      id: `rule_${crypto.randomUUID()}`,
      keyword: keyword.trim(),
      category,
      createdAt: new Date().toISOString(),
    });
    await rebuildStoredLedger();
    setKeyword("");
  }
  async function removeRule(id: string) {
    await db.merchantRules.delete(id);
    await rebuildStoredLedger();
  }
  return (
    <>
      <PageHeader
        eyebrow="RULES"
        title="让分类越来越懂你。"
        description="商户规则优先于内置关键词，规则只保存在当前设备。"
      />
      <section className="panel rule-form">
        <div>
          <label>
            商户关键词
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="例如：Costco"
              onKeyDown={(event) => {
                if (event.key === "Enter") void addRule();
              }}
            />
          </label>
        </div>
        <div>
          <label>
            归类为
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {DEFAULT_CATEGORIES.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        </div>
        <button className="button primary" onClick={() => void addRule()}>
          添加规则
        </button>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">YOUR RULES</span>
            <h2>{rules.length} 条自定义规则</h2>
          </div>
        </div>
        {rules.length ? (
          rules.map((rule) => (
            <div className="rule-row" key={rule.id}>
              <span className="keyword-chip">{rule.keyword}</span>
              <span>→</span>
              <strong>{rule.category}</strong>
              <button
                className="icon-button"
                onClick={() => void removeRule(rule.id)}
                aria-label={`删除 ${rule.keyword}`}
              >
                ×
              </button>
            </div>
          ))
        ) : (
          <div className="empty-state">
            <p>
              还没有自定义规则。添加后，重新导入或自动重建账本时会优先使用。
            </p>
          </div>
        )}
      </section>
    </>
  );
}

type Props = { label: string; value: string; hint?: string; tone?: 'blue' | 'green' | 'orange' };

export function StatCard({ label, value, hint, tone = 'blue' }: Props) {
  return <div className={`stat-card ${tone}`}><span className="stat-label">{label}</span><strong>{value}</strong>{hint && <span className="stat-hint">{hint}</span>}</div>;
}

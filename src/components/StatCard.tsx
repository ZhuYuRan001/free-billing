import type { MouseEventHandler } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type Props = {
  label: string;
  value: string;
  hint?: string;
  tone?: 'blue' | 'green' | 'orange';
  onOpenDetails?: MouseEventHandler<HTMLButtonElement>;
};

export function StatCard({ label, value, hint, tone = 'blue', onOpenDetails }: Props) {
  const className = `stat-card ${tone}`;
  const metric = (
    <>
      <span className="stat-label">{label}</span>
      <strong>{value}</strong>
    </>
  );

  if (onOpenDetails) {
    return (
      <Button
        type="button"
        variant="outline"
        className={`${className} block h-auto font-normal whitespace-normal shadow-none`}
        aria-haspopup="dialog"
        onClick={onOpenDetails}
      >
        {metric}
        <span className="stat-hint">
          查看流水 <span aria-hidden="true">→</span>
        </span>
      </Button>
    );
  }

  return (
    <Card className={`${className} block shadow-none`}>
      {metric}
      {hint && <span className="stat-hint">{hint}</span>}
    </Card>
  );
}

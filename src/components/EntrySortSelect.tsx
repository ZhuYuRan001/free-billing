import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { ledgerSortOrders, type LedgerSortOrder } from '../domain/ledger-sort';

export function EntrySortSelect({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: LedgerSortOrder;
  onChange: (value: LedgerSortOrder) => void;
}) {
  return (
    <NativeSelect
      id={id}
      aria-label="排序"
      className="bg-background"
      value={value}
      onChange={(event) => onChange(event.target.value as LedgerSortOrder)}
    >
      {Object.entries(ledgerSortOrders).map(([key, { label }]) => (
        <NativeSelectOption key={key} value={key}>
          {label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

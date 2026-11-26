import { useId, useState } from 'react';
import { zhCN } from 'date-fns/locale/zh-CN';
import { CalendarIcon } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { dateInputValue, localMidnight, type DateSelection } from '../domain/dates';

const fullDate = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long' });

export function DateRangePicker({
  value,
  onChange,
}: {
  value?: DateSelection;
  onChange: (range: DateSelection) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange>();
  const selected = value && { from: localMidnight(value.start), to: localMidnight(value.end) };
  const display = open ? draft : selected;
  const { from, to } = display ?? {};
  let label = '全部日期';
  if (from) label = to ? fullDate.formatRange(from, to) : fullDate.format(from);

  function changeOpen(nextOpen: boolean) {
    if (nextOpen) setDraft(selected);
    setOpen(nextOpen);
  }

  function selectRange(range: DateRange | undefined) {
    setDraft(range);
    if (!range?.from || !range.to) return;

    const start = dateInputValue(range.from);
    const end = dateInputValue(range.to);
    if (start !== value?.start || end !== value.end) onChange({ start, end });
  }

  return (
    <div className="flex w-60 max-w-full flex-col gap-2" data-slot="field">
      <label className="text-sm font-medium" data-slot="field-label" htmlFor={id}>
        日期范围
      </label>
      <Popover open={open} onOpenChange={changeOpen}>
        <PopoverTrigger
          render={
            <Button
              id={id}
              type="button"
              variant="outline"
              className="justify-start px-2.5 text-left font-normal"
              aria-label={`选择日期范围，${label}`}
            />
          }
        >
          <CalendarIcon data-icon="inline-start" aria-hidden="true" />
          {label}
        </PopoverTrigger>
        <PopoverContent
          align="start"
          collisionPadding={8}
          className="max-h-(--available-height) w-auto gap-0 overflow-auto overscroll-contain p-0"
          aria-label="日期范围"
        >
          <Calendar
            className="shrink-0"
            mode="range"
            locale={zhCN}
            selected={draft}
            onSelect={selectRange}
            defaultMonth={draft?.from}
            numberOfMonths={2}
            labels={{ labelPrevious: () => '上个月', labelNext: () => '下个月' }}
            required
            resetOnSelect
            autoFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

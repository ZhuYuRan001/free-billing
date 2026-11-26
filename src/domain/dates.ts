export type DateSelection = { start: string; end: string };

export function dateInputValue(date: Date) {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function localMidnight(date: string) {
  return new Date(`${date}T00:00:00`);
}

export function addDays(date: Date, count: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  next.setHours(0, 0, 0, 0);
  return next;
}

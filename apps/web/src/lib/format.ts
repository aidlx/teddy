export interface TaskDueLike {
  due_at: string | null | undefined;
  due_kind?: string | null;
  due_tz?: string | null;
}

function partsInTz(input: Date | string, tz?: string) {
  const date = typeof input === 'string' ? new Date(input) : input;
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: tz,
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return {
    year: Number(pick('year')),
    month: Number(pick('month')),
    day: Number(pick('day')),
  };
}

function dayDiff(targetIso: string, tz?: string, now: Date = new Date()): number {
  const target = partsInTz(targetIso, tz);
  const current = partsInTz(now, tz);
  const targetUtc = Date.UTC(target.year, target.month - 1, target.day);
  const currentUtc = Date.UTC(current.year, current.month - 1, current.day);
  return Math.round((targetUtc - currentUtc) / (1000 * 60 * 60 * 24));
}

function formatDateOnly(iso: string, tz?: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: tz,
  });
}

function formatDateTime(iso: string, tz?: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  });
}

export function currentDateKey(tz?: string, now: Date = new Date()): string {
  const parts = partsInTz(now, tz);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function parseDateKey(key: string): Date {
  const [rawYear, rawMonth, rawDay] = key.split('-').map(Number);
  const year = rawYear ?? 1970;
  const month = rawMonth ?? 1;
  const day = rawDay ?? 1;
  return new Date(year, month - 1, day);
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso);
  const now = new Date();
  const diffMs = then.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (Math.abs(diffDays) < 1) {
    const hours = Math.round(diffMs / (1000 * 60 * 60));
    if (hours === 0) return 'now';
    return hours > 0 ? `in ${hours}h` : `${Math.abs(hours)}h ago`;
  }
  if (diffDays === 1) return 'tomorrow';
  if (diffDays === -1) return 'yesterday';
  if (diffDays > 0 && diffDays < 7) return `in ${diffDays} days`;
  if (diffDays < 0 && diffDays > -7) return `${Math.abs(diffDays)} days ago`;

  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function isOverdue(iso: string | null | undefined): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() < Date.now();
}

export function taskDayKey(task: TaskDueLike, viewerTz?: string): string | null {
  if (!task.due_at) return null;
  const tz = task.due_kind === 'date' ? (task.due_tz ?? viewerTz) : viewerTz;
  return currentDateKey(tz, new Date(task.due_at));
}

export function isTaskOverdue(task: TaskDueLike, viewerTz?: string, now: Date = new Date()): boolean {
  if (!task.due_at) return false;
  if (task.due_kind === 'date') {
    return dayDiff(task.due_at, task.due_tz ?? viewerTz, now) < 0;
  }
  return new Date(task.due_at).getTime() < now.getTime();
}

export function formatTaskDue(task: TaskDueLike, viewerTz?: string, now: Date = new Date()): string {
  if (!task.due_at) return '';
  if (task.due_kind === 'date') {
    const tz = task.due_tz ?? viewerTz;
    const diffDays = dayDiff(task.due_at, tz, now);
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'tomorrow';
    if (diffDays === -1) return 'yesterday';
    if (diffDays > 0 && diffDays < 7) return `in ${diffDays} days`;
    if (diffDays < 0 && diffDays > -7) return `${Math.abs(diffDays)} days ago`;
    return formatDateOnly(task.due_at, tz);
  }
  return formatRelative(task.due_at);
}

export function formatTaskDueExact(task: TaskDueLike, viewerTz?: string): string {
  if (!task.due_at) return '';
  if (task.due_kind === 'date') {
    return formatDateOnly(task.due_at, task.due_tz ?? viewerTz);
  }
  return formatDateTime(task.due_at, viewerTz);
}

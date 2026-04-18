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

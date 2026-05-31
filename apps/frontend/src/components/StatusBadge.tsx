import type { PreferenceStatus } from '../types';

const config: Record<PreferenceStatus, { label: string; classes: string; dot: string }> = {
  PENDING: {
    label: 'Pending',
    classes: 'bg-gray-100 text-gray-600',
    dot: 'bg-gray-400',
  },
  IN_PROGRESS: {
    label: 'In progress',
    classes: 'bg-amber-50 text-amber-700',
    dot: 'bg-amber-400 animate-pulse',
  },
  COMPLETE: {
    label: 'Complete',
    classes: 'bg-emerald-50 text-emerald-700',
    dot: 'bg-emerald-500',
  },
};

export function StatusBadge({ status }: { status: PreferenceStatus }) {
  const { label, classes, dot } = config[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${classes}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

import type { StepCoverage } from '../types';

const STEPS: { key: keyof StepCoverage; label: string; icon: string }[] = [
  { key: 'slidersSet',        label: 'Sliders set',    icon: '🎚️' },
  { key: 'constraintsFilled', label: 'Constraints',    icon: '📋' },
  { key: 'chatDone',          label: 'AI chat done',   icon: '💬' },
];

export function StepProgress({ coverage }: { coverage: StepCoverage }) {
  const doneCount = Object.values(coverage).filter(Boolean).length;
  const total = STEPS.length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Your progress
        </p>
        <p className="text-xs text-gray-400">{doneCount}/{total} steps</p>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {STEPS.map(({ key, label, icon }) => {
          const done = coverage[key];
          return (
            <div
              key={key}
              className={`flex flex-col items-center gap-1 rounded-xl p-2 transition-colors
                ${done ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}
            >
              <span className="text-lg leading-none">{icon}</span>
              <span className="text-[10px] font-medium text-center leading-tight">{label}</span>
              {done && (
                <svg className="h-3 w-3 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

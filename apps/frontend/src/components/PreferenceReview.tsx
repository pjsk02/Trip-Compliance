import type { PreferenceProfileData } from '../types';
import { Button } from './Button';

interface Props {
  profile: PreferenceProfileData;
  onConfirm: () => void;
  onEdit: () => void;
  loading: boolean;
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const color =
    score >= 75 ? 'bg-emerald-500' :
    score >= 50 ? 'bg-indigo-400' :
    score >= 25 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 truncate text-xs text-gray-600 capitalize">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="w-6 shrink-0 text-right text-xs tabular-nums text-gray-500">{score}</span>
    </div>
  );
}

function PriorityChip({ label, variant }: { label: string; variant: 'must' | 'nice' | 'neutral' | 'avoid' }) {
  const styles = {
    must:    'bg-emerald-50 text-emerald-700 ring-emerald-200',
    nice:    'bg-indigo-50 text-indigo-700 ring-indigo-200',
    neutral: 'bg-gray-100 text-gray-600 ring-gray-200',
    avoid:   'bg-red-50 text-red-700 ring-red-200',
  };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${styles[variant]}`}>
      {label}
    </span>
  );
}

export function PreferenceReview({ profile, onConfirm, onEdit, loading }: Props) {
  const { scores, priorities } = profile;

  return (
    <div className="space-y-5">
      <div className="text-center space-y-1">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100">
          <svg className="h-6 w-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-gray-900">Review your preferences</h2>
        <p className="text-sm text-gray-500">This is what the AI extracted from your conversation. Confirm or go back to adjust.</p>
      </div>

      {/* Scores */}
      <div className="rounded-2xl bg-white border border-gray-100 p-4 space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Scores</p>

        <div className="space-y-1">
          <p className="text-xs font-medium text-gray-700 mb-1.5">🏄 Activities</p>
          {Object.entries(scores.activities).map(([k, v]) => <ScoreBar key={k} label={k} score={v} />)}
        </div>
        <div className="space-y-1 pt-2 border-t border-gray-50">
          <p className="text-xs font-medium text-gray-700 mb-1.5">🍜 Food</p>
          {Object.entries(scores.food)
            .filter(([k]) => k !== 'dietary')
            .map(([k, v]) => <ScoreBar key={k} label={k} score={v as number} />)}
          {Object.entries(scores.food.dietary).map(([k, v]) => (
            <ScoreBar key={k} label={k} score={v} />
          ))}
        </div>
        <div className="space-y-1 pt-2 border-t border-gray-50">
          <p className="text-xs font-medium text-gray-700 mb-1.5">✈️ Logistics</p>
          <ScoreBar label="flight comfort" score={scores.logistics.flightComfort} />
          <ScoreBar label="pace" score={scores.logistics.pace} />
          <ScoreBar label="budget split" score={scores.logistics.budgetSplit} />
          {Object.entries(scores.logistics.accommodationType).map(([k, v]) => (
            <ScoreBar key={k} label={k} score={v} />
          ))}
        </div>
        <div className="space-y-1 pt-2 border-t border-gray-50">
          <p className="text-xs font-medium text-gray-700 mb-1.5">📋 Constraints</p>
          {Object.entries(scores.constraints).map(([k, v]) => <ScoreBar key={k} label={k} score={v} />)}
        </div>
      </div>

      {/* Priorities */}
      <div className="rounded-2xl bg-white border border-gray-100 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Priorities</p>
        {priorities.mustHave.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-1.5">Must have</p>
            <div className="flex flex-wrap gap-1.5">
              {priorities.mustHave.map(item => <PriorityChip key={item} label={item} variant="must" />)}
            </div>
          </div>
        )}
        {priorities.niceToHave.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-1.5">Nice to have</p>
            <div className="flex flex-wrap gap-1.5">
              {priorities.niceToHave.map(item => <PriorityChip key={item} label={item} variant="nice" />)}
            </div>
          </div>
        )}
        {priorities.avoid.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-1.5">Avoid</p>
            <div className="flex flex-wrap gap-1.5">
              {priorities.avoid.map(item => <PriorityChip key={item} label={item} variant="avoid" />)}
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <Button variant="secondary" className="flex-1" onClick={onEdit} disabled={loading}>
          Go back & edit
        </Button>
        <Button className="flex-1" onClick={onConfirm} loading={loading}>
          Looks good — lock it in
        </Button>
      </div>
    </div>
  );
}

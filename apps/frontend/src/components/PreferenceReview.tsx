import { useState } from 'react';
import type { PreferenceProfileData, PreferencePriorities } from '../types';
import { Button } from './Button';

interface Props {
  profile:   PreferenceProfileData;
  onConfirm: () => void;
  onEdit:    () => void;
  loading:   boolean;
}

// ---------------------------------------------------------------------------
// Small display components
// ---------------------------------------------------------------------------

function ScoreBar({ label, score }: { label: string; score: number }) {
  const color =
    score >= 75 ? 'bg-emerald-500' :
    score >= 50 ? 'bg-indigo-400'  :
    score >= 25 ? 'bg-amber-400'   : 'bg-red-400';
  return (
    <div className="flex items-center gap-2">
      <span className="w-32 shrink-0 truncate text-xs text-gray-600 capitalize">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="w-6 shrink-0 text-right text-xs tabular-nums text-gray-500">{score}</span>
    </div>
  );
}

const PRIORITY_STYLES = {
  must:    'bg-emerald-50 text-emerald-700 ring-emerald-200',
  nice:    'bg-indigo-50 text-indigo-700 ring-indigo-200',
  neutral: 'bg-gray-100 text-gray-600 ring-gray-200',
  avoid:   'bg-red-50 text-red-700 ring-red-200',
};

type PriorityBucket = keyof typeof PRIORITY_STYLES;

function PriorityChip({
  label, variant, onRemove,
}: { label: string; variant: PriorityBucket; onRemove?: () => void }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${PRIORITY_STYLES[variant]}`}>
      {label}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 opacity-50 hover:opacity-100 transition"
          aria-label={`Remove ${label}`}
        >
          ×
        </button>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Editable priorities section
// ---------------------------------------------------------------------------

function PrioritiesEditor({
  priorities,
  onChange,
}: {
  priorities: PreferencePriorities;
  onChange: (p: PreferencePriorities) => void;
}) {
  const [addingTo, setAddingTo] = useState<PriorityBucket | null>(null);
  const [addText, setAddText]   = useState('');

  const sections: Array<{ label: string; bucket: PriorityBucket; field: keyof PreferencePriorities }> = [
    { label: 'Must Have',    bucket: 'must',    field: 'mustHave' },
    { label: 'Nice to Have', bucket: 'nice',    field: 'niceToHave' },
    { label: 'Neutral',      bucket: 'neutral', field: 'neutral' },
    { label: 'Avoid',        bucket: 'avoid',   field: 'avoid' },
  ];

  function removeItem(field: keyof PreferencePriorities, item: string) {
    onChange({ ...priorities, [field]: priorities[field].filter(i => i !== item) });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function addItem(_bucket: PriorityBucket, field: keyof PreferencePriorities, text: string) {
    if (!text.trim()) return;
    onChange({ ...priorities, [field]: [...priorities[field], text.trim()] });
    setAddText('');
    setAddingTo(null);
  }

  return (
    <div className="space-y-4">
      {sections.map(({ label, bucket, field }) => (
        <div key={bucket}>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs text-gray-500 font-medium">{label}</p>
            <button
              type="button"
              onClick={() => { setAddingTo(bucket); setAddText(''); }}
              className="text-[10px] text-indigo-500 hover:text-indigo-700 transition"
            >
              + add
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {priorities[field].map(item => (
              <PriorityChip
                key={item}
                label={item}
                variant={bucket}
                onRemove={() => removeItem(field, item)}
              />
            ))}
            {priorities[field].length === 0 && (
              <span className="text-xs text-gray-300 italic">none</span>
            )}
          </div>
          {addingTo === bucket && (
            <div className="mt-2 flex gap-2">
              <input
                autoFocus
                type="text"
                value={addText}
                onChange={e => setAddText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') addItem(bucket, field, addText);
                  if (e.key === 'Escape') setAddingTo(null);
                }}
                placeholder="Type and press Enter…"
                className="flex-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={() => addItem(bucket, field, addText)}
                className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => setAddingTo(null)}
                className="rounded-lg px-2 py-1.5 text-xs text-gray-400 hover:text-gray-600"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main PreferenceReview
// ---------------------------------------------------------------------------

export function PreferenceReview({ profile, onConfirm, onEdit, loading }: Props) {
  const { scores, chatNuance, sliderValues, constraintFields } = profile;
  const [priorities, setPriorities] = useState<PreferencePriorities>(profile.priorities);

  const hasSliderSource = !!sliderValues;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="text-center space-y-1">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100">
          <svg className="h-6 w-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-gray-900">Review your preferences</h2>
        <p className="text-sm text-gray-500">
          {hasSliderSource
            ? 'Derived from your sliders + AI chat. Edit the priority map if anything looks off.'
            : 'Extracted from your conversation. Confirm or go back to adjust.'}
        </p>
      </div>

      {/* Scores */}
      <div className="rounded-2xl bg-white border border-gray-100 p-4 space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Preference Scores</p>

        <div className="space-y-1">
          <p className="text-xs font-medium text-gray-700 mb-1.5">🏄 Activities</p>
          {Object.entries(scores.activities).map(([k, v]) => (
            <ScoreBar key={k} label={k} score={v} />
          ))}
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
          <ScoreBar label="flight comfort"       score={scores.logistics.flightComfort} />
          <ScoreBar label="pace"                 score={scores.logistics.pace} />
          <ScoreBar label="budget-conscious"     score={scores.logistics.budgetConsciousness} />
        </div>

        <div className="space-y-1 pt-2 border-t border-gray-50">
          <p className="text-xs font-medium text-gray-700 mb-1.5">📋 Constraints</p>
          {Object.entries(scores.constraints).map(([k, v]) => <ScoreBar key={k} label={k} score={v} />)}
        </div>
      </div>

      {/* Constraint fields summary (if present) */}
      {constraintFields && (
        <div className="rounded-2xl bg-white border border-gray-100 p-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Hard Constraints</p>
          <dl className="space-y-1 text-xs text-gray-600">
            {constraintFields.dietaryRestrictions.length > 0 && (
              <div className="flex gap-2">
                <dt className="shrink-0 text-gray-400 w-32">Dietary</dt>
                <dd>{constraintFields.dietaryRestrictions.join(', ')}{constraintFields.dietaryOther ? `, ${constraintFields.dietaryOther}` : ''}</dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="shrink-0 text-gray-400 w-32">Alcohol</dt>
              <dd className="capitalize">{constraintFields.alcoholPreference}</dd>
            </div>
            {constraintFields.hardBudgetCap && (
              <div className="flex gap-2">
                <dt className="shrink-0 text-gray-400 w-32">Hard cap</dt>
                <dd>${constraintFields.hardBudgetCap.toLocaleString()}</dd>
              </div>
            )}
            {constraintFields.mobilityLimitations && (
              <div className="flex gap-2">
                <dt className="shrink-0 text-gray-400 w-32">Mobility</dt>
                <dd>{constraintFields.mobilityLimitations}</dd>
              </div>
            )}
            {constraintFields.scheduleRestrictions && (
              <div className="flex gap-2">
                <dt className="shrink-0 text-gray-400 w-32">Schedule</dt>
                <dd>{constraintFields.scheduleRestrictions}</dd>
              </div>
            )}
            {constraintFields.visaRestrictions && (
              <div className="flex gap-2">
                <dt className="shrink-0 text-gray-400 w-32">Visa</dt>
                <dd>{constraintFields.visaRestrictions}</dd>
              </div>
            )}
            {constraintFields.mustAvoidActivities && (
              <div className="flex gap-2">
                <dt className="shrink-0 text-gray-400 w-32">Must avoid</dt>
                <dd>{constraintFields.mustAvoidActivities}</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {/* Chat nuance (if present) */}
      {chatNuance && (
        <div className="rounded-2xl bg-amber-50 border border-amber-100 p-4 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">AI-captured nuance</p>
          <p className="text-sm text-amber-900">{chatNuance}</p>
        </div>
      )}

      {/* Priority map — editable */}
      <div className="rounded-2xl bg-white border border-gray-100 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Priority Map</p>
          <p className="text-[10px] text-gray-400">Auto-derived — click × to remove, + add to override</p>
        </div>
        <PrioritiesEditor priorities={priorities} onChange={setPriorities} />
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Button variant="secondary" className="flex-1" onClick={onEdit} disabled={loading}>
          Back & adjust
        </Button>
        <Button
          className="flex-1"
          onClick={() => onConfirm()}
          loading={loading}
        >
          Looks good — lock it in
        </Button>
      </div>
    </div>
  );
}

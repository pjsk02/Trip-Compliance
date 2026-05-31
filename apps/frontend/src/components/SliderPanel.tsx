import { useState } from 'react';
import type { SliderValues, ConstraintFields, AlcoholPreference, PreferencePriorities } from '../types';

// ---------------------------------------------------------------------------
// Priority derivation (mirrors backend derivePriorities)
// ---------------------------------------------------------------------------

function derivePriorities(sliders: SliderValues): PreferencePriorities {
  const items = [
    { label: 'Hiking / Outdoors',   score: sliders.activities.hiking },
    { label: 'Nightlife',           score: sliders.activities.nightlife },
    { label: 'Museums / Culture',   score: sliders.activities.museums },
    { label: 'Beaches',             score: sliders.activities.beaches },
    { label: 'Adventure Sports',    score: sliders.activities.adventure },
    { label: 'Street Food',         score: sliders.food.streetFood },
    { label: 'Fine Dining',         score: sliders.food.fineDining },
    { label: 'Local Cuisine',       score: sliders.food.localCuisine },
    { label: 'Relaxed Pace',        score: 100 - sliders.logistics.pace },
    { label: 'Packed Itinerary',    score: sliders.logistics.pace },
    { label: 'Flight Comfort',      score: sliders.logistics.flightComfort },
    { label: 'Budget-Conscious',    score: sliders.logistics.budgetConsciousness },
  ];

  const mustHave: string[] = [], niceToHave: string[] = [], neutral: string[] = [], avoid: string[] = [];
  for (const { label, score } of items) {
    if      (score >= 90) mustHave.push(label);
    else if (score >= 60) niceToHave.push(label);
    else if (score >= 30) neutral.push(label);
    else                  avoid.push(label);
  }
  return { mustHave, niceToHave, neutral, avoid };
}

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------

export const DEFAULT_SLIDERS: SliderValues = {
  activities: { hiking: 50, nightlife: 50, museums: 50, beaches: 50, adventure: 50 },
  food:       { streetFood: 50, fineDining: 50, localCuisine: 50 },
  logistics:  { pace: 50, flightComfort: 50, budgetConsciousness: 50 },
};

export const DEFAULT_CONSTRAINTS: ConstraintFields = {
  dietaryRestrictions: [],
  dietaryOther: '',
  alcoholPreference: 'yes',
  hardBudgetCap: undefined,
  totalBudget: undefined,
  mobilityLimitations: '',
  scheduleRestrictions: '',
  visaRestrictions: '',
  mustAvoidActivities: '',
};

const DIETARY_OPTIONS = [
  'Vegetarian', 'Vegan', 'Gluten-free', 'Halal', 'Kosher', 'Nut allergy', 'Dairy-free', 'Shellfish allergy',
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface SliderRowProps {
  label:     string;
  hint?:     string;
  value:     number; // 0-100
  onChange:  (v: number) => void;
  leftLabel?: string;
  rightLabel?: string;
}

function SliderRow({ label, hint, value, onChange, leftLabel, rightLabel }: SliderRowProps) {
  const display = Math.round(value / 10); // show 1-10 to user
  const color =
    value >= 90 ? 'text-emerald-600' :
    value >= 60 ? 'text-indigo-500'  :
    value >= 30 ? 'text-gray-500'    : 'text-red-400';

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <div>
          <span className="text-sm font-medium text-gray-800">{label}</span>
          {hint && <span className="ml-1.5 text-xs text-gray-400">{hint}</span>}
        </div>
        <span className={`w-6 text-right text-sm font-bold tabular-nums ${color}`}>{display}</span>
      </div>
      {(leftLabel || rightLabel) && (
        <div className="flex justify-between text-[10px] text-gray-400">
          <span>{leftLabel}</span>
          <span>{rightLabel}</span>
        </div>
      )}
      <input
        type="range"
        min={0}
        max={100}
        step={10}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-gray-200
          [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-indigo-600 [&::-webkit-slider-thumb]:shadow-sm
          [&::-webkit-slider-thumb]:cursor-pointer
          [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4
          [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-indigo-600
          [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
        style={{
          background: `linear-gradient(to right, #4f46e5 0%, #4f46e5 ${value}%, #e5e7eb ${value}%, #e5e7eb 100%)`,
        }}
      />
    </div>
  );
}

function SectionHeader({ emoji, title }: { emoji: string; title: string }) {
  return (
    <div className="flex items-center gap-2 pb-1">
      <span className="text-base leading-none">{emoji}</span>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Priority preview chips
// ---------------------------------------------------------------------------

const CHIP_STYLES = {
  must:    'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  nice:    'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200',
  neutral: 'bg-gray-100 text-gray-500 ring-1 ring-gray-200',
  avoid:   'bg-red-50 text-red-600 ring-1 ring-red-200',
};

function PriorityPreview({ priorities }: { priorities: PreferencePriorities }) {
  const sections: Array<{ label: string; variant: keyof typeof CHIP_STYLES; items: string[] }> = [
    { label: 'Must Have',    variant: 'must',    items: priorities.mustHave },
    { label: 'Nice to Have', variant: 'nice',    items: priorities.niceToHave },
    { label: 'Neutral',      variant: 'neutral', items: priorities.neutral },
    { label: 'Avoid',        variant: 'avoid',   items: priorities.avoid },
  ];

  const nonEmpty = sections.filter(s => s.items.length > 0);
  if (nonEmpty.length === 0) return null;

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        Priority preview — live as you drag
      </p>
      {nonEmpty.map(({ label, variant, items }) => (
        <div key={label}>
          <p className="mb-1 text-[10px] font-medium text-gray-400 uppercase tracking-wide">{label}</p>
          <div className="flex flex-wrap gap-1.5">
            {items.map(item => (
              <span
                key={item}
                className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${CHIP_STYLES[variant]}`}
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main SliderPanel
// ---------------------------------------------------------------------------

interface Props {
  sliders:          SliderValues;
  constraints:      ConstraintFields;
  onSliderChange:   (sliders: SliderValues) => void;
  onConstraintChange: (constraints: ConstraintFields) => void;
  onSave:           () => void;
  saving:           boolean;
  saved:            boolean;
}

export function SliderPanel({
  sliders, constraints, onSliderChange, onConstraintChange, onSave, saving, saved,
}: Props) {
  const [showConstraints, setShowConstraints] = useState(false);
  const priorities = derivePriorities(sliders);

  function setActivity(key: keyof SliderValues['activities'], v: number) {
    onSliderChange({ ...sliders, activities: { ...sliders.activities, [key]: v } });
  }
  function setFood(key: keyof SliderValues['food'], v: number) {
    onSliderChange({ ...sliders, food: { ...sliders.food, [key]: v } });
  }
  function setLogistics(key: keyof SliderValues['logistics'], v: number) {
    onSliderChange({ ...sliders, logistics: { ...sliders.logistics, [key]: v } });
  }

  function toggleDietary(option: string) {
    const current = constraints.dietaryRestrictions;
    const next = current.includes(option)
      ? current.filter(d => d !== option)
      : [...current, option];
    onConstraintChange({ ...constraints, dietaryRestrictions: next });
  }

  const constraintsFilled =
    constraints.dietaryRestrictions.length > 0 ||
    constraints.hardBudgetCap !== undefined ||
    constraints.totalBudget !== undefined ||
    !!constraints.mobilityLimitations ||
    !!constraints.scheduleRestrictions ||
    !!constraints.visaRestrictions ||
    !!constraints.mustAvoidActivities;

  return (
    <div className="space-y-5">
      {/* Activities */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 space-y-4">
        <SectionHeader emoji="🏄" title="Activities" />
        <SliderRow label="Hiking / Outdoors"  value={sliders.activities.hiking}    onChange={v => setActivity('hiking', v)} />
        <SliderRow label="Nightlife"           value={sliders.activities.nightlife}  onChange={v => setActivity('nightlife', v)} />
        <SliderRow label="Museums / Culture"  value={sliders.activities.museums}   onChange={v => setActivity('museums', v)} />
        <SliderRow label="Beaches"            value={sliders.activities.beaches}   onChange={v => setActivity('beaches', v)} />
        <SliderRow label="Adventure Sports"   value={sliders.activities.adventure} onChange={v => setActivity('adventure', v)} />
      </div>

      {/* Food */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 space-y-4">
        <SectionHeader emoji="🍜" title="Food" />
        <SliderRow label="Street Food"   value={sliders.food.streetFood}   onChange={v => setFood('streetFood', v)} />
        <SliderRow label="Fine Dining"   value={sliders.food.fineDining}   onChange={v => setFood('fineDining', v)} />
        <SliderRow label="Local Cuisine" value={sliders.food.localCuisine} onChange={v => setFood('localCuisine', v)} />
      </div>

      {/* Logistics */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 space-y-4">
        <SectionHeader emoji="✈️" title="Logistics" />
        <SliderRow
          label="Trip Pace"
          value={sliders.logistics.pace}
          onChange={v => setLogistics('pace', v)}
          leftLabel="Slow & relaxed"
          rightLabel="Packed schedule"
        />
        <SliderRow
          label="Flight Comfort"
          hint="priority"
          value={sliders.logistics.flightComfort}
          onChange={v => setLogistics('flightComfort', v)}
          leftLabel="Budget seats fine"
          rightLabel="Comfort is key"
        />
        <SliderRow
          label="Budget-Consciousness"
          value={sliders.logistics.budgetConsciousness}
          onChange={v => setLogistics('budgetConsciousness', v)}
          leftLabel="Spend freely"
          rightLabel="Watch every dollar"
        />
      </div>

      {/* Dietary + alcohol (always visible) */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 space-y-4">
        <SectionHeader emoji="🥗" title="Food Preferences" />

        <div>
          <p className="mb-2 text-sm font-medium text-gray-800">Dietary restrictions</p>
          <div className="flex flex-wrap gap-2">
            {DIETARY_OPTIONS.map(opt => {
              const selected = constraints.dietaryRestrictions.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggleDietary(opt)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition
                    ${selected
                      ? 'bg-indigo-600 text-white ring-indigo-600'
                      : 'bg-white text-gray-600 ring-gray-300 hover:ring-indigo-300'
                    }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
          <input
            type="text"
            placeholder="Other restrictions (free text)…"
            value={constraints.dietaryOther ?? ''}
            onChange={e => onConstraintChange({ ...constraints, dietaryOther: e.target.value })}
            className="mt-2 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-gray-800">Alcohol</p>
          <div className="flex gap-2">
            {(['yes', 'sometimes', 'no'] as AlcoholPreference[]).map(opt => (
              <button
                key={opt}
                type="button"
                onClick={() => onConstraintChange({ ...constraints, alcoholPreference: opt })}
                className={`flex-1 rounded-xl py-2 text-sm font-medium ring-1 transition capitalize
                  ${constraints.alcoholPreference === opt
                    ? 'bg-indigo-600 text-white ring-indigo-600'
                    : 'bg-white text-gray-600 ring-gray-300 hover:ring-indigo-300'
                  }`}
              >
                {opt === 'yes' ? 'Yes' : opt === 'no' ? 'No' : 'Sometimes'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Hard constraints — collapsible */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 space-y-4">
        <button
          type="button"
          onClick={() => setShowConstraints(v => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-base leading-none">📋</span>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Hard Constraints
            </h3>
            {constraintsFilled && (
              <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">filled</span>
            )}
          </div>
          <svg
            className={`h-4 w-4 text-gray-400 transition-transform ${showConstraints ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showConstraints && (
          <div className="space-y-4 pt-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Hard budget cap (USD)</label>
                <input
                  type="number"
                  min={0}
                  placeholder="e.g. 3000"
                  value={constraints.hardBudgetCap ?? ''}
                  onChange={e => onConstraintChange({ ...constraints, hardBudgetCap: e.target.value ? Number(e.target.value) : undefined })}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Total trip budget (private, USD)</label>
                <input
                  type="number"
                  min={0}
                  placeholder="e.g. 5000"
                  value={constraints.totalBudget ?? ''}
                  onChange={e => onConstraintChange({ ...constraints, totalBudget: e.target.value ? Number(e.target.value) : undefined })}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="mt-0.5 text-[10px] text-gray-400">Only seen by the AI planner, never shown to others</p>
              </div>
            </div>

            {([
              { key: 'mobilityLimitations',  label: 'Mobility limitations',   placeholder: "e.g. can't do stairs, wheelchair user…" },
              { key: 'scheduleRestrictions', label: 'Schedule restrictions',  placeholder: 'e.g. must be back by Sunday night…' },
              { key: 'visaRestrictions',     label: 'Visa restrictions',      placeholder: 'e.g. no passport for certain countries…' },
              { key: 'mustAvoidActivities',  label: 'Must-avoid activities',  placeholder: 'e.g. no bungee jumping, avoid crowded markets…' },
            ] as const).map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="mb-1 block text-xs font-medium text-gray-700">{label}</label>
                <input
                  type="text"
                  placeholder={placeholder}
                  value={(constraints as unknown as Record<string, string | undefined>)[key] ?? ''}
                  onChange={e => onConstraintChange({ ...constraints, [key]: e.target.value || undefined })}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Live priority preview */}
      <PriorityPreview priorities={priorities} />

      {/* Save button */}
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50 disabled:pointer-events-none"
      >
        {saving && (
          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
        )}
        {saved ? '✓ Saved — adjust anytime' : 'Save preferences →'}
      </button>
    </div>
  );
}

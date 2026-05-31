import { useEffect, useState, useCallback, useRef, Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Spinner } from '../components/Spinner';
import type {
  Itinerary, DayPlan, ScheduledBlock, BudgetBreakdownLine,
  PerMemberScore, TimeBlock, AgentTimelineEntry, DecisionAuditEntry,
} from '../types';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const fmt = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const pct = (n: number) => `${Math.round(n)}%`;

const TIME_LABELS: Record<TimeBlock, string> = {
  morning:   'Morning',
  afternoon: 'Afternoon',
  evening:   'Evening',
};

const BLOCK_ICONS: Record<ScheduledBlock['type'], string> = {
  activity: '🎯',
  meal:     '🍽',
  travel:   '🚌',
  free:     '🌿',
};

const CATEGORY_ICONS: Record<string, string> = {
  Flights:          '✈️',
  Accommodation:    '🏨',
  'Food & Drink':   '🍽️',
  Activities:       '🎯',
  'Local Transport':'🚇',
};

// ---------------------------------------------------------------------------
// Shareable header
// ---------------------------------------------------------------------------

function PageHeader({ destination, onBack }: {
  destination: string;
  onBack: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function handleShare() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/90 backdrop-blur-sm">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-600">
            <svg className="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064" />
            </svg>
          </div>
          <span className="font-semibold text-gray-900 text-sm">{destination}</span>
        </div>
        <button
          onClick={handleShare}
          className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors"
        >
          {copied ? (
            <>
              <svg className="h-3.5 w-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-emerald-600">Copied!</span>
            </>
          ) : (
            <>
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              Share
            </>
          )}
        </button>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Section 7.1 — Day-by-day plan
// ---------------------------------------------------------------------------

function PreferenceTags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {tags.slice(0, 4).map(tag => (
        <span
          key={tag}
          className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200"
        >
          {tag}
        </span>
      ))}
      {tags.length > 4 && (
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
          +{tags.length - 4} more
        </span>
      )}
    </div>
  );
}

function BlockCard({ block, myMemberId }: { block: ScheduledBlock; myMemberId: string }) {
  const myTags = block.servesPreferences[myMemberId] ?? [];
  const otherMemberCount = Object.keys(block.servesPreferences).filter(id => id !== myMemberId).length;

  return (
    <div className="flex gap-3 py-3">
      {/* Time icon */}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gray-50 text-base">
        {BLOCK_ICONS[block.type]}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 leading-snug">{block.title}</p>
            <p className="mt-0.5 text-xs text-gray-500 flex items-center gap-1">
              <svg className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              </svg>
              {block.venue}{block.location && block.location !== block.venue ? ` · ${block.location}` : ''}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-semibold text-gray-900">{fmt(block.estimatedCostPerPersonUsd)}</p>
            <p className="text-[10px] text-gray-400">per person</p>
          </div>
        </div>

        {/* Meta row */}
        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-gray-400">
          {block.durationHours && (
            <span className="flex items-center gap-0.5">
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {block.durationHours}h
            </span>
          )}
          {block.travelTimeMinutes != null && block.travelTimeMinutes > 0 && (
            <span className="flex items-center gap-0.5">
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              </svg>
              {block.travelTimeMinutes}min travel
            </span>
          )}
          {otherMemberCount > 0 && (
            <span className="flex items-center gap-0.5 text-emerald-600">
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {otherMemberCount} member{otherMemberCount > 1 ? 's' : ''} love this
            </span>
          )}
        </div>

        {/* My preference tags */}
        <PreferenceTags tags={myTags} />

        {block.notes && (
          <p className="mt-1.5 text-[11px] text-gray-400 italic">{block.notes}</p>
        )}
      </div>
    </div>
  );
}

function TimeSlot({ label, blocks, myMemberId }: {
  label: string;
  blocks: ScheduledBlock[];
  myMemberId: string;
}) {
  if (blocks.length === 0) return null;
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">{label}</p>
      <div className="divide-y divide-gray-50">
        {blocks.map((block, i) => (
          <BlockCard key={i} block={block} myMemberId={myMemberId} />
        ))}
      </div>
    </div>
  );
}

function DayCard({ day, myMemberId }: { day: DayPlan; myMemberId: string }) {
  const [open, setOpen] = useState(day.day === 1);

  const timeGroups = (['morning', 'afternoon', 'evening'] as TimeBlock[]).map(tb => ({
    label: TIME_LABELS[tb],
    blocks: day.blocks.filter(b => b.timeBlock === tb),
  }));

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-gray-50/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50">
            <span className="text-sm font-bold text-indigo-700">D{day.day}</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{day.theme}</p>
            <p className="text-xs text-gray-400">
              {day.date ? new Date(day.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : `Day ${day.day}`}
              {' · '}
              {fmt(day.dayTotalCostPerPersonUsd)} / person
            </p>
          </div>
        </div>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-gray-50 px-5 pb-4 space-y-4">
          {timeGroups.map(({ label, blocks }) => (
            <TimeSlot key={label} label={label} blocks={blocks} myMemberId={myMemberId} />
          ))}
        </div>
      )}
    </div>
  );
}

function DayByDaySection({ dayPlans, myMemberId }: { dayPlans: DayPlan[]; myMemberId: string }) {
  return (
    <section className="space-y-3">
      <SectionHeader
        icon="📅"
        title="Day-by-Day Plan"
        subtitle={`${dayPlans.length} day${dayPlans.length !== 1 ? 's' : ''} · Tap a day to expand`}
      />
      {dayPlans.map(day => (
        <DayCard key={day.day} day={day} myMemberId={myMemberId} />
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section 7.2 — Budget breakdown
// ---------------------------------------------------------------------------

function BudgetSection({ budget }: { budget: Itinerary['budgetBreakdown'] }) {
  const overBudget = (budget.surplus ?? 0) < 0;

  const STANDARD_CATEGORIES = ['Flights', 'Accommodation', 'Food & Drink', 'Activities', 'Local Transport'];

  // Sort: standard categories first in PRD order, then any extras
  const sorted = [...(budget.lines ?? [])].sort((a, b) => {
    const ai = STANDARD_CATEGORIES.indexOf(a.category);
    const bi = STANDARD_CATEGORIES.indexOf(b.category);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return (
    <section className="space-y-3">
      <SectionHeader
        icon="💰"
        title="Budget Breakdown"
        subtitle={`${fmt(budget.totalPerPersonUsd)} / person · ${fmt(budget.totalGroupUsd)} total`}
      />

      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-5 py-2.5 bg-gray-50 border-b border-gray-100">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Category</p>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 text-right">Estimated</p>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 text-right hidden sm:block">% budget</p>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 text-right">/ person</p>
        </div>

        {/* Lines */}
        <div className="divide-y divide-gray-50">
          {sorted.map((line: BudgetBreakdownLine) => (
            <BudgetRow key={line.category} line={line} />
          ))}
        </div>

        {/* Total row */}
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center border-t border-gray-200 bg-gray-50 px-5 py-3">
          <p className="text-sm font-bold text-gray-900">TOTAL</p>
          <p className="text-sm font-bold text-gray-900 text-right">{fmt(budget.totalGroupUsd)}</p>
          <p className="text-sm font-bold text-gray-900 text-right hidden sm:block">100%</p>
          <p className="text-sm font-bold text-gray-900 text-right">{fmt(budget.totalPerPersonUsd)}</p>
        </div>

        {/* Surplus / overrun banner */}
        <div className={`px-5 py-3 ${overBudget ? 'bg-red-50' : 'bg-emerald-50'}`}>
          <p className={`text-xs font-medium ${overBudget ? 'text-red-700' : 'text-emerald-700'}`}>
            {overBudget
              ? `⚠️ ${fmt(Math.abs(budget.surplus))} over the locked budget of ${fmt(budget.lockedBudgetUsd)}`
              : `✓ ${fmt(budget.surplus)} buffer remaining from locked budget of ${fmt(budget.lockedBudgetUsd)}`}
          </p>
          {budget.notes && (
            <p className={`mt-0.5 text-[11px] ${overBudget ? 'text-red-600' : 'text-emerald-600'}`}>
              {budget.notes}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function BudgetRow({ line }: { line: BudgetBreakdownLine }) {
  const icon = CATEGORY_ICONS[line.category] ?? '📦';
  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center px-5 py-3">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-base shrink-0">{icon}</span>
        <span className="text-sm text-gray-700 truncate">{line.category}</span>
      </div>
      <p className="text-sm text-gray-700 text-right tabular-nums">{fmt(line.totalGroupUsd)}</p>
      <p className="text-sm text-gray-500 text-right tabular-nums hidden sm:block">{pct(Math.min(line.pctOfBudget, 999))}</p>
      <p className="text-sm text-gray-700 text-right tabular-nums">{fmt(line.estimatedCostPerPersonUsd)}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 7.3 — Satisfaction summary
// ---------------------------------------------------------------------------

function SatisfactionBar({ value, floor = 70 }: { value: number; floor?: number }) {
  const clamped = Math.min(100, Math.max(0, value));
  const color = clamped >= floor ? 'bg-emerald-500' : 'bg-amber-400';
  return (
    <div className="relative h-2 w-full rounded-full bg-gray-100 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-700 ${color}`}
        style={{ width: `${clamped}%` }}
      />
      {/* Floor marker */}
      <div
        className="absolute top-0 bottom-0 w-px bg-gray-400/60"
        style={{ left: `${floor}%` }}
      />
    </div>
  );
}

function MemberSatisfactionRow({
  score,
  isMe,
  avatarUrl,
}: {
  score: PerMemberScore;
  isMe: boolean;
  avatarUrl?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const belowFloor = score.satisfactionPct < 70;

  return (
    <div className={`py-3 ${belowFloor ? 'bg-amber-50/60 rounded-xl px-3 -mx-3' : ''}`}>
      <div className="flex items-center gap-3">
        {/* Avatar */}
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={score.memberName}
            className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-white"
          />
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700 ring-2 ring-white">
            {score.memberName[0]?.toUpperCase()}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-sm font-medium text-gray-900 truncate">
              {score.memberName}
              {isMe && <span className="ml-1.5 text-xs text-gray-400">(you)</span>}
              {belowFloor && (
                <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                  ⚠ below 70%
                </span>
              )}
            </p>
            <button
              onClick={() => setExpanded(e => !e)}
              className="shrink-0 text-sm font-bold tabular-nums text-gray-900 hover:text-indigo-600 transition-colors"
              aria-label="Show details"
            >
              {pct(score.satisfactionPct)}
            </button>
          </div>
          <SatisfactionBar value={score.satisfactionPct} />
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-3 ml-12 space-y-2">
          {score.mustHaveFulfilled.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 mb-1">Must-haves met</p>
              <div className="flex flex-wrap gap-1">
                {score.mustHaveFulfilled.map(p => (
                  <span key={p} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                    ✓ {p}
                  </span>
                ))}
              </div>
            </div>
          )}
          {score.niceToHaveFulfilled.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-500 mb-1">Nice-to-haves met</p>
              <div className="flex flex-wrap gap-1">
                {score.niceToHaveFulfilled.map(p => (
                  <span key={p} className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 ring-1 ring-inset ring-blue-200">
                    ✓ {p}
                  </span>
                ))}
              </div>
            </div>
          )}
          {score.unmetMustHave.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-red-500 mb-1">Unmet must-haves</p>
              <div className="flex flex-wrap gap-1">
                {score.unmetMustHave.map(p => (
                  <span key={p} className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 ring-1 ring-inset ring-red-200">
                    ✗ {p}
                  </span>
                ))}
              </div>
            </div>
          )}
          {score.mustHaveFulfilled.length === 0 && score.niceToHaveFulfilled.length === 0 && score.unmetMustHave.length === 0 && (
            <p className="text-xs text-gray-400">No detailed preference data available.</p>
          )}
        </div>
      )}
    </div>
  );
}

function SatisfactionSection({
  scores,
  myUserId,
  memberAvatars,
}: {
  scores: Itinerary['satisfactionScores'];
  myUserId: string;
  memberAvatars: Record<string, string | null>;
}) {
  const anyBelowFloor = (scores.perMember ?? []).some(m => m.satisfactionPct < 70);

  return (
    <section className="space-y-3">
      <SectionHeader
        icon="🎯"
        title="Satisfaction Summary"
        subtitle="Tap a score to see preference details"
      />

      {/* Group summary card */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-5 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Group average</p>
            <p className="mt-0.5 text-3xl font-bold text-gray-900">{pct(scores.groupSatisfactionPct)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Fairness</p>
            <p className={`mt-0.5 text-xl font-bold ${scores.fairnessFloorMet ? 'text-emerald-600' : 'text-amber-500'}`}>
              {pct(scores.fairnessScore)}
            </p>
          </div>
        </div>
        <SatisfactionBar value={scores.groupSatisfactionPct} />
        {!scores.fairnessFloorMet && (
          <div className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2.5 flex items-start gap-2">
            <span className="text-base shrink-0">⚠️</span>
            <p className="text-xs text-amber-800">
              <strong>Fairness floor not met.</strong> At least one member is below the 70% satisfaction threshold.
              The organizer may want to review and adjust the plan.
            </p>
          </div>
        )}
      </div>

      {/* Per-member rows */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-5 py-2 divide-y divide-gray-50">
        {(scores.perMember ?? []).map(score => (
          <MemberSatisfactionRow
            key={score.memberId}
            score={score}
            isMe={score.memberId === myUserId}
            avatarUrl={memberAvatars[score.memberId]}
          />
        ))}
      </div>

      {anyBelowFloor && (
        <p className="text-xs text-gray-400 px-1">
          The 70% floor is the minimum satisfaction threshold set by the planning system.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section 7.4 — Tradeoff report
// ---------------------------------------------------------------------------

function TradeoffSection({ report, adminOverride, negotiationRounds }: {
  report: string;
  adminOverride: boolean;
  negotiationRounds: number;
}) {
  const paragraphs = report.split(/\n\n+/).filter(Boolean);

  return (
    <section className="space-y-3">
      <SectionHeader
        icon="⚖️"
        title="Tradeoff Report"
        subtitle="How the AI balanced everyone's preferences"
      />

      {/* Meta pills */}
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {negotiationRounds} negotiation {negotiationRounds === 1 ? 'round' : 'rounds'}
        </span>
        {adminOverride && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
            ⚠ Admin override applied
          </span>
        )}
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-5 py-4 space-y-3">
        {paragraphs.map((para, i) => (
          <p key={i} className="text-sm text-gray-700 leading-relaxed">{para}</p>
        ))}
        {paragraphs.length === 0 && (
          <p className="text-sm text-gray-400 italic">No tradeoff report available.</p>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section 7.5 — Agent Observe (timeline + decision audit + W&B link)
// ---------------------------------------------------------------------------

const WAVE_LABELS: Record<number, string> = { 1: 'Wave 1 · Proposals', 2: 'Wave 2 · Budget', 3: 'Wave 3 · Consensus' };
const AGENT_COLORS: Record<string, string> = {
  activity:      'bg-emerald-100 text-emerald-800',
  food:          'bg-amber-100 text-amber-800',
  accommodation: 'bg-violet-100 text-violet-800',
  transportation:'bg-blue-100 text-blue-800',
  budget:        'bg-rose-100 text-rose-800',
  negotiation:   'bg-orange-100 text-orange-800',
  consensus:     'bg-indigo-100 text-indigo-800',
};
const STATUS_COLORS: Record<string, string> = {
  ok:       'text-emerald-600',
  repaired: 'text-amber-600',
  fallback: 'text-red-500',
};

function TimelineBar({ entries }: { entries: AgentTimelineEntry[] }) {
  if (entries.length === 0) return null;
  const maxMs = Math.max(...entries.map(e => e.completedAt));
  const byWave = entries.reduce<Record<number, AgentTimelineEntry[]>>((acc, e) => {
    (acc[e.wave] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {([1, 2, 3] as const).map(wave => {
        const waveEntries = byWave[wave];
        if (!waveEntries?.length) return null;
        return (
          <div key={wave}>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">{WAVE_LABELS[wave]}</p>
            <div className="space-y-2">
              {waveEntries.map(e => {
                const left  = (e.startedAt  / maxMs) * 100;
                const width = Math.max(((e.durationMs) / maxMs) * 100, 2);
                const color = AGENT_COLORS[e.agent] ?? 'bg-gray-100 text-gray-700';
                return (
                  <div key={e.agent} className="flex items-center gap-2">
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold w-24 text-center truncate ${color}`}>
                      {e.agent}
                    </span>
                    <div className="relative flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`absolute top-0 bottom-0 rounded-full ${color.split(' ')[0]}`}
                        style={{ left: `${left}%`, width: `${width}%` }}
                      />
                    </div>
                    <span className={`shrink-0 text-[10px] font-mono ${STATUS_COLORS[e.status] ?? 'text-gray-500'}`}>
                      {(e.durationMs / 1000).toFixed(1)}s
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AuditEntry({ entry }: { entry: DecisionAuditEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="py-3 border-b border-gray-50 last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-start justify-between gap-2 text-left"
      >
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-700">{entry.decision}</p>
          <p className="mt-0.5 text-[11px] text-emerald-700 truncate">✓ {entry.chosen}</p>
        </div>
        <svg className={`h-4 w-4 shrink-0 text-gray-400 mt-0.5 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="mt-2 space-y-2 pl-1">
          <p className="text-[11px] text-gray-500">{entry.reason}</p>
          {entry.rejected.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-red-500 mb-1">Not selected</p>
              <div className="space-y-0.5">
                {entry.rejected.map((r, i) => (
                  <p key={i} className="text-[11px] text-gray-400">✗ {r}</p>
                ))}
              </div>
            </div>
          )}
          {entry.scores && Object.keys(entry.scores).length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Scores</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(entry.scores).map(([k, v]) => (
                  <span key={k} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                    {k}: {v}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ObserveSection({
  timeline,
  audit,
  weaveUrl,
}: {
  timeline: AgentTimelineEntry[];
  audit: DecisionAuditEntry[];
  weaveUrl?: string;
}) {
  const totalMs = timeline.reduce((s, e) => Math.max(s, e.completedAt), 0);

  return (
    <section className="space-y-4">
      <SectionHeader icon="🔬" title="Agent Observatory" subtitle="Execution timeline, decision audit, and W&B Weave traces" />

      {weaveUrl && (
        <a
          href={weaveUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2.5 rounded-2xl border border-yellow-200 bg-yellow-50 px-4 py-3 hover:bg-yellow-100 transition-colors group"
        >
          <span className="text-xl shrink-0">🏗️</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-yellow-900">View full trace in W&B Weave</p>
            <p className="text-xs text-yellow-700 truncate">{weaveUrl}</p>
          </div>
          <svg className="h-4 w-4 text-yellow-600 shrink-0 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      )}

      {timeline.length > 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-5 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-700">Execution Timeline</p>
            <span className="text-[11px] text-gray-400 font-mono">{(totalMs / 1000).toFixed(1)}s total</span>
          </div>
          <TimelineBar entries={timeline} />
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-5 py-4">
          <p className="text-xs text-gray-400 italic">Timeline data not available — regenerate to capture.</p>
        </div>
      )}

      {audit.length > 0 && (
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-5 py-2">
          <p className="text-xs font-semibold text-gray-700 pt-3 pb-2">Decision Audit Trail</p>
          {audit.map((entry, i) => (
            <AuditEntry key={i} entry={entry} />
          ))}
        </div>
      )}

      {timeline.length === 0 && audit.length === 0 && !weaveUrl && (
        <p className="text-xs text-gray-400 px-1">
          Observability data is captured on generation. Older itinerary versions may not have this data.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shared section header
// ---------------------------------------------------------------------------

function SectionHeader({ icon, title, subtitle }: { icon: string; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-xl">{icon}</span>
      <div>
        <h2 className="text-base font-bold text-gray-900">{title}</h2>
        {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab nav
// ---------------------------------------------------------------------------

const TABS = [
  { id: 'plan',       label: 'Plan',       icon: '📅' },
  { id: 'budget',     label: 'Budget',     icon: '💰' },
  { id: 'scores',     label: 'Scores',     icon: '🎯' },
  { id: 'tradeoffs',  label: 'Tradeoffs',  icon: '⚖️' },
] as const;
type TabId = typeof TABS[number]['id'];

function TabBar({ active, onChange }: { active: TabId; onChange: (t: TabId) => void }) {
  return (
    <nav className="sticky top-[53px] z-10 bg-white/90 backdrop-blur-sm border-b border-gray-100">
      <div className="mx-auto max-w-2xl flex">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold transition-colors border-b-2 ${
              active === tab.id
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            <span className="text-base">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Version switcher
// ---------------------------------------------------------------------------

function VersionSwitcher({
  versions, active, onChange,
}: {
  versions: Itinerary[];
  active: number;
  onChange: (v: number) => void;
}) {
  if (versions.length <= 1) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap px-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 shrink-0">Version</span>
      {versions.map(it => (
        <button
          key={it.version}
          onClick={() => onChange(it.version)}
          className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
            it.version === active
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          v{it.version}
          {it.feedback && it.feedback.length > 0 && it.version !== active && (
            <span className="ml-1 font-normal text-gray-400">
              ({it.feedback[0]?.type.replace(/_/g, ' ').toLowerCase()})
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feedback box
// ---------------------------------------------------------------------------

const FEEDBACK_EXAMPLES = [
  'More nightlife, less museums',
  'Cut $200 per person',
  "I can't do the 6am flight",
  "I'm now vegetarian",
];

function FeedbackBox({
  onSubmit, loading, result,
}: {
  onSubmit: (text: string) => void;
  loading: boolean;
  result: { summary: string; feedbackType: string; version: number } | null;
}) {
  const [text, setText] = useState('');
  const placeholder = useRef(FEEDBACK_EXAMPLES[Math.floor(Math.random() * FEEDBACK_EXAMPLES.length)]).current;

  return (
    <section className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-purple-50 px-5 py-4 space-y-3">
      <div className="flex items-start gap-2.5">
        <span className="text-xl shrink-0 mt-0.5">💬</span>
        <div>
          <h3 className="text-sm font-bold text-indigo-900">Request a change</h3>
          <p className="text-xs text-indigo-700 mt-0.5">
            Any member can propose adjustments — Claude will classify and replan.
          </p>
        </div>
      </div>

      {result && result.version > 0 && (
        <div className="rounded-xl bg-white/80 border border-emerald-100 px-3 py-2.5 flex items-start gap-2">
          <svg className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          <div>
            <p className="text-xs font-semibold text-emerald-800">
              New v{result.version} created — {result.feedbackType.replace(/_/g, ' ').toLowerCase()}
            </p>
            <p className="text-xs text-emerald-700 mt-0.5">{result.summary}</p>
          </div>
        </div>
      )}

      {result && result.version === 0 && (
        <div className="rounded-xl bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">
          {result.summary}
        </div>
      )}

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={`e.g. "${placeholder}"`}
        rows={3}
        disabled={loading}
        className="w-full rounded-xl border border-indigo-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 resize-none disabled:opacity-50"
      />

      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] text-indigo-600/70">Claude routes your request to the right agent.</p>
        <button
          onClick={() => { if (text.trim() && !loading) { onSubmit(text.trim()); setText(''); } }}
          disabled={!text.trim() || loading}
          className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          {loading ? <><Spinner className="h-3.5 w-3.5 text-white" /><span className="ml-1">Replanning…</span></> : 'Send'}
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Feedback history
// ---------------------------------------------------------------------------

const FEEDBACK_TYPE_LABELS: Record<string, string> = {
  ACTIVITY_REWEIGHT: 'Activity reweight',
  BUDGET_CUT:        'Budget cut',
  TRANSPORT_VETO:    'Transport veto',
  PREFERENCE_CHANGE: 'Preference change',
};

function FeedbackHistory({ versions }: { versions: Itinerary[] }) {
  const allFeedback = versions
    .flatMap(it => (it.feedback ?? []).map(f => ({ ...f, producedVersion: it.version + 1 })))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  if (allFeedback.length === 0) return null;

  return (
    <section className="space-y-3">
      <SectionHeader icon="📝" title="Change History" subtitle="Feedback that triggered replanning" />
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm divide-y divide-gray-50 overflow-hidden">
        {allFeedback.map(f => (
          <div key={f.id} className="px-5 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200">
                    {FEEDBACK_TYPE_LABELS[f.type] ?? f.type}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    by {f.member?.name ?? 'Unknown'} → v{f.producedVersion}
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-700 italic">"{f.rawText}"</p>
              </div>
              <p className="shrink-0 text-[10px] text-gray-400 pt-0.5">
                {new Date(f.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Error boundary — catches render crashes so the page never goes blank
// ---------------------------------------------------------------------------

class ItineraryErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ItineraryView] Render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-50 px-4 text-center">
          <div className="rounded-2xl border border-red-100 bg-white shadow-sm px-6 py-6 max-w-sm w-full space-y-3">
            <p className="text-base font-semibold text-red-600">Something went wrong</p>
            <p className="text-xs text-gray-500 font-mono break-all">{this.state.error.message}</p>
            <button
              onClick={() => this.setState({ error: null })}
              className="mt-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function ItineraryViewInner() {
  const { code } = useParams<{ code: string }>();
  const { session, userSession, logout } = useAuth();
  const navigate = useNavigate();

  const [versions, setVersions]           = useState<Itinerary[]>([]);
  const [activeVersion, setActiveVersion] = useState<number>(1);
  const [destination, setDestination]     = useState('Trip Itinerary');
  const [tripDuration, setTripDuration]   = useState(3);
  const [loading, setLoading]             = useState(true);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackResult, setFeedbackResult] = useState<{
    summary: string; feedbackType: string; version: number;
  } | null>(null);
  const [error, setError]         = useState('');
  const [activeTab, setActiveTab] = useState<TabId>('plan');
  const [memberAvatars, setMemberAvatars] = useState<Record<string, string | null>>({});

  const fetchData = useCallback(async () => {
    if (!code) return;
    try {
      const [listRes, group] = await Promise.all([
        api.listItineraries(code),
        api.getGroup(code),
      ]);
      setVersions(listRes.itineraries);
      setDestination(group.destination ?? 'Trip Itinerary');
      if (listRes.itineraries.length > 0) {
        const latest = listRes.itineraries[listRes.itineraries.length - 1];
        setActiveVersion(latest.version);
        if (latest.dayPlans?.length) setTripDuration(latest.dayPlans.length);
      }
      const avatarMap: Record<string, string | null> = {};
      group.members.forEach(m => { avatarMap[m.id] = null; });
      setMemberAvatars(avatarMap);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout(); navigate('/');
      } else if (err instanceof ApiError && err.status === 404) {
        setError('No itinerary has been generated yet.');
      } else {
        setError('Could not load itinerary. Try refreshing.');
      }
    } finally {
      setLoading(false);
    }
  }, [code, logout, navigate]);

  useEffect(() => {
    if (!session) { navigate('/'); return; }
    fetchData();
  }, [session, fetchData, navigate]);

  async function handleFeedback(text: string) {
    if (!code) return;
    setFeedbackLoading(true);
    setFeedbackResult(null);
    try {
      const res = await api.submitFeedback(code, text, tripDuration, activeVersion);
      setFeedbackResult({ summary: res.feedbackSummary, feedbackType: res.feedbackType, version: res.version });
      await fetchData();
      setActiveVersion(res.version);
      setActiveTab('plan');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Replan failed. Try again.';
      setFeedbackResult({ summary: msg, feedbackType: 'ERROR', version: 0 });
    } finally {
      setFeedbackLoading(false);
    }
  }

  const myUserId = userSession?.user.id ?? '';
  const myMemberRecordId = session?.memberId ?? '';
  const itinerary = versions.find(v => v.version === activeVersion) ?? versions[versions.length - 1] ?? null;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (error || !itinerary) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-50 px-4">
        <p className="text-sm text-gray-500">{error || 'No itinerary found.'}</p>
        <button
          onClick={() => navigate(`/group/${code}`)}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
        >
          ← Back to dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader destination={destination} onBack={() => navigate(`/group/${code}`)} />
      <TabBar active={activeTab} onChange={setActiveTab} />

      <main className="mx-auto max-w-2xl px-4 py-6 space-y-6">
        <VersionSwitcher
          versions={versions}
          active={activeVersion}
          onChange={v => { setActiveVersion(v); setActiveTab('plan'); }}
        />

        {activeTab === 'plan' && (
          <div className="grid grid-cols-3 gap-3">
            <StatPill label="Days" value={String(itinerary.dayPlans?.length ?? 0)}
              sub={`${(itinerary.dayPlans ?? []).reduce((s, d) => s + (d.blocks?.length ?? 0), 0)} activities`} />
            <StatPill label="Per person" value={fmt(itinerary.budgetBreakdown?.totalPerPersonUsd ?? 0)} sub="estimated total" />
            <StatPill label="Group score" value={pct(itinerary.satisfactionScores?.groupSatisfactionPct ?? 0)}
              sub={(itinerary.satisfactionScores?.fairnessFloorMet) ? 'fairness ✓' : 'fairness ⚠'}
              highlight={itinerary.satisfactionScores?.fairnessFloorMet ?? false} />
          </div>
        )}

        {activeTab === 'plan'      && <DayByDaySection dayPlans={itinerary.dayPlans ?? []} myMemberId={myMemberRecordId} />}
        {activeTab === 'budget'    && itinerary.budgetBreakdown && <BudgetSection budget={itinerary.budgetBreakdown} />}
        {activeTab === 'scores'    && itinerary.satisfactionScores && <SatisfactionSection scores={itinerary.satisfactionScores} myUserId={myUserId} memberAvatars={memberAvatars} />}
        {activeTab === 'tradeoffs' && (
          <TradeoffSection
            report={itinerary.tradeoffReport}
            adminOverride={itinerary.adminOverrideFlag ?? false}
            negotiationRounds={itinerary.negotiationRounds ?? 0}
          />
        )}

        <FeedbackBox onSubmit={handleFeedback} loading={feedbackLoading} result={feedbackResult} />
        <FeedbackHistory versions={versions} />

        <p className="text-center text-[11px] text-gray-300 pb-4">
          v{itinerary.version} · {new Date(itinerary.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
        </p>
      </main>
    </div>
  );
}

export function ItineraryView() {
  return (
    <ItineraryErrorBoundary>
      <ItineraryViewInner />
    </ItineraryErrorBoundary>
  );
}

// ---------------------------------------------------------------------------
// Stat pill (hero strip)
// ---------------------------------------------------------------------------

function StatPill({ label, value, sub, highlight }: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-2xl border px-3 py-3 text-center ${
      highlight
        ? 'border-emerald-100 bg-emerald-50'
        : 'border-gray-100 bg-white shadow-sm'
    }`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`mt-0.5 text-lg font-bold ${highlight ? 'text-emerald-700' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400">{sub}</p>}
    </div>
  );
}

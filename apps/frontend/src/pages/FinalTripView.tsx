/**
 * FinalTripView — read-only view of the finalized trip for all group members.
 *
 * Route: /group/:code/final
 *
 * - Any authenticated member of the group can access this.
 * - Shows day-by-day plan, budget, scores, and tradeoff report.
 * - No version switcher, no feedback box, no admin controls.
 * - Data comes from GET /groups/:code/final — always the one finalized version.
 * - Numbers: all tabs read from the same itinerary object (cross-tab consistency).
 */

import { useEffect, useState, useCallback, Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Spinner } from '../components/Spinner';
import type { Itinerary, DayPlan, ScheduledBlock, BudgetBreakdownLine, PerMemberScore, TimeBlock } from '../types';

// ---------------------------------------------------------------------------
// Utilities — same as ItineraryView so numbers are identical
// ---------------------------------------------------------------------------

const fmt = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const pct = (n: number) => `${Math.round(n)}%`;

const TIME_LABELS: Record<TimeBlock, string> = {
  morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening',
};
const BLOCK_ICONS: Record<ScheduledBlock['type'], string> = {
  activity: '🎯', meal: '🍽', travel: '🚌', free: '🌿',
};
const CATEGORY_ICONS: Record<string, string> = {
  Flights: '✈️', Accommodation: '🏨', 'Food & Drink': '🍽️',
  Activities: '🎯', 'Local Transport': '🚇',
};

// ---------------------------------------------------------------------------
// Reused display components (stripped down — no admin controls or edit state)
// ---------------------------------------------------------------------------

function BlockCard({ block, myMemberId }: { block: ScheduledBlock; myMemberId: string }) {
  const myTags = block.servesPreferences[myMemberId] ?? [];
  const otherMemberCount = Object.keys(block.servesPreferences).filter(id => id !== myMemberId).length;
  return (
    <div className="flex gap-3 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gray-50 text-base">
        {BLOCK_ICONS[block.type]}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 leading-snug">{block.title}</p>
            <p className="mt-0.5 text-xs text-gray-500">{block.venue}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-semibold text-gray-900">{fmt(block.estimatedCostPerPersonUsd)}</p>
            <p className="text-[10px] text-gray-400">per person</p>
          </div>
        </div>
        {otherMemberCount > 0 && (
          <p className="mt-1 text-[11px] text-emerald-600">
            {otherMemberCount} member{otherMemberCount > 1 ? 's' : ''} love this
          </p>
        )}
        {myTags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {myTags.slice(0, 3).map(tag => (
              <span key={tag} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DayCard({ day, myMemberId }: { day: DayPlan; myMemberId: string }) {
  const [open, setOpen] = useState(day.day === 1);
  const groups = (['morning', 'afternoon', 'evening'] as TimeBlock[]).map(tb => ({
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
              Day {day.day} · {fmt(day.dayTotalCostPerPersonUsd)} / person
            </p>
          </div>
        </div>
        <svg className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-gray-50 px-5 pb-4 space-y-4">
          {groups.map(({ label, blocks }) => blocks.length > 0 && (
            <div key={label}>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">{label}</p>
              <div className="divide-y divide-gray-50">
                {blocks.map((block, i) => <BlockCard key={i} block={block} myMemberId={myMemberId} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
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

function SatisfactionBar({ value }: { value: number }) {
  const clamped = Math.min(100, Math.max(0, value));
  const color = clamped >= 70 ? 'bg-emerald-500' : 'bg-amber-400';
  return (
    <div className="relative h-2 w-full rounded-full bg-gray-100 overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${clamped}%` }} />
      <div className="absolute top-0 bottom-0 w-px bg-gray-400/60" style={{ left: '70%' }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab types
// ---------------------------------------------------------------------------

const FINAL_TABS = [
  { id: 'plan',      label: 'Plan',      icon: '📅' },
  { id: 'budget',    label: 'Budget',    icon: '💰' },
  { id: 'scores',    label: 'Scores',    icon: '🎯' },
  { id: 'tradeoffs', label: 'Tradeoffs', icon: '⚖️' },
] as const;
type FinalTabId = typeof FINAL_TABS[number]['id'];

// ---------------------------------------------------------------------------
// Error boundary
// ---------------------------------------------------------------------------

class FinalTripErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('[FinalTripView]', error, info.componentStack); }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-50 px-4 text-center">
          <div className="rounded-2xl border border-red-100 bg-white shadow-sm px-6 py-6 max-w-sm w-full space-y-3">
            <p className="text-base font-semibold text-red-600">Something went wrong</p>
            <p className="text-xs text-gray-500 font-mono break-all">{this.state.error.message}</p>
            <button onClick={() => this.setState({ error: null })}
              className="mt-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors">
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
// Main inner component
// ---------------------------------------------------------------------------

function FinalTripViewInner() {
  const { code } = useParams<{ code: string }>();
  const { session, userSession, logout } = useAuth();
  const navigate = useNavigate();

  const [itinerary, setItinerary]   = useState<Itinerary | null>(null);
  const [finalizedAt, setFinalizedAt] = useState<string | null>(null);
  const [destination, setDestination] = useState('Final Trip');
  const [loading, setLoading]         = useState(true);
  const [notFinalized, setNotFinalized] = useState(false);
  const [error, setError]             = useState('');
  const [activeTab, setActiveTab]     = useState<FinalTabId>('plan');

  const fetchData = useCallback(async () => {
    if (!code) return;
    try {
      const [finalRes, group] = await Promise.all([
        api.getFinalItinerary(code),
        api.getGroup(code),
      ]);
      setDestination(group.destination ?? 'Final Trip');
      if (!finalRes.finalized) {
        setNotFinalized(true);
        return;
      }
      setItinerary(finalRes.itinerary);
      setFinalizedAt(finalRes.finalizedAt ?? null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { logout(); navigate('/'); }
      else { setError('Could not load the final trip. Try refreshing.'); }
    } finally {
      setLoading(false);
    }
  }, [code, logout, navigate]);

  useEffect(() => {
    if (!session) { navigate('/'); return; }
    fetchData();
  }, [session, fetchData, navigate]);

  const myUserId       = userSession?.user.id ?? '';
  const myMemberRecordId = session?.memberId ?? '';
  const isAdmin        = session?.isAdmin ?? false;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-50 px-4">
        <p className="text-sm text-gray-500">{error}</p>
        <button onClick={fetchData} className="text-sm font-medium text-indigo-600 hover:text-indigo-800">Retry</button>
      </div>
    );
  }

  if (notFinalized) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-5 bg-gray-50 px-4 text-center">
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-6 py-8 max-w-sm w-full space-y-3">
          <p className="text-2xl">🗺️</p>
          <p className="text-sm font-semibold text-gray-800">No finalized trip yet</p>
          <p className="text-xs text-gray-500">
            The organizer hasn't finalized a trip version yet. Check back soon.
          </p>
          {isAdmin && (
            <button
              onClick={() => navigate(`/group/${code}/itinerary`)}
              className="mt-2 w-full rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
            >
              Go to itinerary to finalize →
            </button>
          )}
          <button
            onClick={() => navigate(`/group/${code}`)}
            className="w-full text-xs text-gray-400 hover:text-gray-600"
          >
            ← Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!itinerary) return null;

  const budget = itinerary.budgetBreakdown;
  const scores = itinerary.satisfactionScores;
  const overBudget = (budget?.surplus ?? 0) < 0;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <button onClick={() => navigate(`/group/${code}`)}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-600 text-white text-xs font-bold">✓</span>
            <div className="text-center">
              <p className="text-sm font-semibold text-gray-900">{destination}</p>
              <p className="text-[10px] text-emerald-600 font-medium">
                Final trip{finalizedAt ? ` · finalized ${new Date(finalizedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}` : ''}
              </p>
            </div>
          </div>
          {isAdmin && (
            <button
              onClick={() => navigate(`/group/${code}/itinerary`)}
              className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-200 transition-colors"
            >
              Edit
            </button>
          )}
        </div>
      </header>

      {/* Tab nav */}
      <nav className="sticky top-[53px] z-10 bg-white/90 backdrop-blur-sm border-b border-gray-100">
        <div className="mx-auto max-w-2xl flex">
          {FINAL_TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold transition-colors border-b-2 ${
                activeTab === tab.id
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}>
              <span className="text-base">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-2xl px-4 py-6 space-y-6">
        {/* Hero stats — all from the SAME itinerary object */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-3 py-3 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Days</p>
            <p className="mt-0.5 text-lg font-bold text-gray-900">{itinerary.dayPlans?.length ?? 0}</p>
          </div>
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-3 py-3 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Per person</p>
            <p className={`mt-0.5 text-lg font-bold ${overBudget ? 'text-red-600' : 'text-gray-900'}`}>
              {fmt(budget?.totalPerPersonUsd ?? 0)}
            </p>
          </div>
          <div className={`rounded-2xl border px-3 py-3 text-center ${scores?.fairnessFloorMet ? 'border-emerald-100 bg-emerald-50' : 'border-gray-100 bg-white shadow-sm'}`}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Group score</p>
            <p className={`mt-0.5 text-lg font-bold ${scores?.fairnessFloorMet ? 'text-emerald-700' : 'text-gray-900'}`}>
              {pct(scores?.groupSatisfactionPct ?? 0)}
            </p>
          </div>
        </div>

        {/* Plan tab */}
        {activeTab === 'plan' && (
          <section className="space-y-3">
            <div className="flex items-center gap-2.5">
              <span className="text-xl">📅</span>
              <div>
                <h2 className="text-base font-bold text-gray-900">Day-by-Day Plan</h2>
                <p className="text-xs text-gray-400">Tap a day to expand</p>
              </div>
            </div>
            {(itinerary.dayPlans ?? []).map(day => (
              <DayCard key={day.day} day={day} myMemberId={myMemberRecordId} />
            ))}
          </section>
        )}

        {/* Budget tab */}
        {activeTab === 'budget' && budget && (
          <section className="space-y-3">
            <div className="flex items-center gap-2.5">
              <span className="text-xl">💰</span>
              <div>
                <h2 className="text-base font-bold text-gray-900">Budget Breakdown</h2>
                <p className="text-xs text-gray-400">{fmt(budget.totalPerPersonUsd)} / person · {fmt(budget.totalGroupUsd)} total</p>
              </div>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-5 py-2.5 bg-gray-50 border-b border-gray-100">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Category</p>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 text-right">Estimated</p>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 text-right hidden sm:block">% budget</p>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 text-right">/ person</p>
              </div>
              <div className="divide-y divide-gray-50">
                {(budget.lines ?? []).map((line: BudgetBreakdownLine) => (
                  <BudgetRow key={line.category} line={line} />
                ))}
              </div>
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center border-t border-gray-200 bg-gray-50 px-5 py-3">
                <p className="text-sm font-bold text-gray-900">TOTAL</p>
                <p className="text-sm font-bold text-gray-900 text-right">{fmt(budget.totalGroupUsd)}</p>
                <p className="text-sm font-bold text-gray-900 text-right hidden sm:block">100%</p>
                <p className="text-sm font-bold text-gray-900 text-right">{fmt(budget.totalPerPersonUsd)}</p>
              </div>
              <div className={`px-5 py-3 ${overBudget ? 'bg-red-50' : 'bg-emerald-50'}`}>
                <p className={`text-xs font-medium ${overBudget ? 'text-red-700' : 'text-emerald-700'}`}>
                  {overBudget
                    ? `⚠️ ${fmt(Math.abs(budget.surplus))} over the locked budget of ${fmt(budget.lockedBudgetUsd)}`
                    : `✓ ${fmt(budget.surplus)} buffer from locked budget of ${fmt(budget.lockedBudgetUsd)}`}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Scores tab */}
        {activeTab === 'scores' && scores && (
          <section className="space-y-3">
            <div className="flex items-center gap-2.5">
              <span className="text-xl">🎯</span>
              <div>
                <h2 className="text-base font-bold text-gray-900">Satisfaction Summary</h2>
                <p className="text-xs text-gray-400">Tap a score to see preference details</p>
              </div>
            </div>
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
            </div>
            <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-5 py-2 divide-y divide-gray-50">
              {(scores.perMember ?? []).map((score: PerMemberScore) => (
                <div key={score.memberId} className="py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">
                      {score.memberName[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {score.memberName}
                          {score.memberId === myUserId && <span className="ml-1.5 text-xs text-gray-400">(you)</span>}
                        </p>
                        <p className="text-sm font-bold text-gray-900">{pct(score.satisfactionPct)}</p>
                      </div>
                      <SatisfactionBar value={score.satisfactionPct} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Tradeoffs tab */}
        {activeTab === 'tradeoffs' && (
          <section className="space-y-3">
            <div className="flex items-center gap-2.5">
              <span className="text-xl">⚖️</span>
              <div>
                <h2 className="text-base font-bold text-gray-900">Tradeoff Report</h2>
                <p className="text-xs text-gray-400">How the AI balanced everyone's preferences</p>
              </div>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-5 py-4 space-y-3">
              {(itinerary.tradeoffReport ?? '').split(/\n\n+/).filter(Boolean).map((para, i) => (
                <p key={i} className="text-sm text-gray-700 leading-relaxed">{para}</p>
              ))}
              {!itinerary.tradeoffReport && (
                <p className="text-sm text-gray-400 italic">No tradeoff report available.</p>
              )}
            </div>
          </section>
        )}

        {/* Read-only footer */}
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-5 py-4 text-center space-y-1">
          <p className="text-xs font-semibold text-emerald-700">✓ This is the official final trip</p>
          <p className="text-[11px] text-gray-400">
            v{itinerary.version} · {new Date(itinerary.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
          {isAdmin && (
            <button
              onClick={() => navigate(`/group/${code}/itinerary`)}
              className="mt-2 text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
            >
              Change finalized version →
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

export function FinalTripView() {
  return (
    <FinalTripErrorBoundary>
      <FinalTripViewInner />
    </FinalTripErrorBoundary>
  );
}

/**
 * Evaluation Dashboard — leaderboard, historical trend, and regression report.
 *
 * Route: /eval  (admin-accessible, no group auth required — only user auth)
 *
 * Data sources:
 *   GET /eval/leaderboard  — latest scores per dataset
 *   GET /eval/history      — trend data for sparklines
 *   POST /eval/run         — trigger a new evaluation run
 */

import { useEffect, useState, useCallback } from 'react';
import { BASE_URL } from '../api/client';
import { Spinner } from '../components/Spinner';

// ---------------------------------------------------------------------------
// Types (mirror backend EvalRunResult)
// ---------------------------------------------------------------------------

interface EvalScores {
  satisfaction:          number;
  fairness:              number;
  budgetCompliance:      number;
  diversity:             number;
  constraintSatisfaction: number;
  overall:               number;
}

interface LeaderboardRow {
  datasetId:             string;
  datasetName:           string;
  scores:                EvalScores;
  reasons:               Record<string, string>;
  consensusStatus:       string;
  adminOverride:         boolean;
  totalCostPerPersonUsd: number;
  negotiationRounds:     number;
  timestamp:             string;
  durationMs:            number;
}

interface RegressionEntry {
  dataset: string;
  metric:  string;
  before:  number;
  after:   number;
  delta:   number;
}

interface LeaderboardResponse {
  leaderboard: LeaderboardRow[];
  summary: {
    timestamp:           string | null;
    promptHash:          string | null;
    avgOverall:          number;
    avgBudgetCompliance: number;
    avgSatisfaction:     number;
    totalRuns:           number;
  };
  regression: {
    promptChanged:  boolean;
    previousHash:   string | null;
    currentHash:    string;
    regressions:    RegressionEntry[];
    improvements:   RegressionEntry[];
  };
}

interface TrendPoint {
  timestamp:       string;
  promptHash:      string;
  avgOverall:      number;
  avgSatisfaction: number;
  avgFairness:     number;
  avgBudget:       number;
  avgConstraints:  number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pct = (n: number) => `${Math.round(n * 100)}%`;
const fmt = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

const SCORE_COLORS: Record<string, string> = {
  satisfaction:          'bg-emerald-500',
  fairness:              'bg-blue-500',
  budgetCompliance:      'bg-rose-500',
  diversity:             'bg-amber-500',
  constraintSatisfaction:'bg-violet-500',
  overall:               'bg-indigo-600',
};

const SCORE_LABELS: Record<string, string> = {
  satisfaction:          'Satisfaction',
  fairness:              'Fairness',
  budgetCompliance:      'Budget',
  diversity:             'Diversity',
  constraintSatisfaction:'Constraints',
  overall:               'Overall',
};

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-gray-500 font-medium">{label}</span>
        <span className={`font-bold ${value === 0 && label === 'Budget' ? 'text-red-600' : 'text-gray-800'}`}>
          {value === 0 && label === 'Budget' ? 'FAIL' : pct(value)}
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${clamped * 100}%` }} />
      </div>
    </div>
  );
}

function DatasetCard({ row, rank }: { row: LeaderboardRow; rank: number }) {
  const [expanded, setExpanded] = useState(false);
  const overBudget = row.scores.budgetCompliance === 0;

  return (
    <div className={`rounded-2xl border bg-white shadow-sm overflow-hidden ${overBudget ? 'border-red-200' : 'border-gray-100'}`}>
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-gray-50/50 transition-colors"
      >
        {/* Rank */}
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${
          rank === 1 ? 'bg-yellow-100 text-yellow-700' :
          rank === 2 ? 'bg-gray-100 text-gray-600' :
          rank === 3 ? 'bg-orange-100 text-orange-700' :
          'bg-gray-50 text-gray-500'
        }`}>
          #{rank}
        </div>

        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{row.datasetName}</p>
          <div className="flex flex-wrap gap-2 mt-0.5">
            <span className={`text-[10px] font-medium rounded-full px-2 py-0.5 ${
              row.consensusStatus === 'OK' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
            }`}>{row.consensusStatus}</span>
            {row.adminOverride && (
              <span className="text-[10px] font-medium rounded-full px-2 py-0.5 bg-amber-100 text-amber-700">⚠ Admin override</span>
            )}
            <span className="text-[10px] text-gray-400">{row.negotiationRounds} negotiation rounds</span>
            <span className="text-[10px] text-gray-400">{fmt(row.totalCostPerPersonUsd)}/person</span>
          </div>
        </div>

        {/* Overall score */}
        <div className="text-right shrink-0">
          <p className={`text-2xl font-bold ${overBudget ? 'text-red-600' : 'text-indigo-700'}`}>{pct(row.scores.overall)}</p>
          <p className="text-[10px] text-gray-400">overall</p>
        </div>

        <svg className={`h-4 w-4 text-gray-400 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-50 px-5 py-4 space-y-4">
          <div className="space-y-2">
            {(Object.keys(SCORE_LABELS) as Array<keyof EvalScores>).map(key => (
              <ScoreBar
                key={key}
                label={SCORE_LABELS[key]!}
                value={row.scores[key]}
                color={SCORE_COLORS[key]!}
              />
            ))}
          </div>

          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Score rationale</p>
            {Object.entries(row.reasons).map(([k, reason]) => (
              <div key={k} className="flex gap-2 text-[11px]">
                <span className="shrink-0 text-gray-400 w-20 truncate">{SCORE_LABELS[k] ?? k}</span>
                <span className="text-gray-600">{reason}</span>
              </div>
            ))}
          </div>

          <p className="text-[10px] text-gray-300">
            Ran {new Date(row.timestamp).toLocaleString()} · {(row.durationMs / 1000).toFixed(1)}s
          </p>
        </div>
      )}
    </div>
  );
}

function TrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) {
    return (
      <div className="h-32 flex items-center justify-center rounded-2xl border border-gray-100 bg-white shadow-sm">
        <p className="text-xs text-gray-400">Run at least 2 evaluations to see trend</p>
      </div>
    );
  }

  const h = 80;
  const w = 100;  // viewBox units
  const padY = 4;

  const series = [
    { key: 'avgOverall',      color: '#6366f1', label: 'Overall' },
    { key: 'avgSatisfaction', color: '#10b981', label: 'Satisfaction' },
    { key: 'avgBudget',       color: '#f43f5e', label: 'Budget' },
    { key: 'avgFairness',     color: '#3b82f6', label: 'Fairness' },
  ] as const;

  function toPath(key: string) {
    return points.map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const val = (p as Record<string, number>)[key] ?? 0;
      const y = h - padY - (val * (h - padY * 2));
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-5 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-700">Score trend ({points.length} runs)</p>
        <div className="flex flex-wrap gap-3">
          {series.map(s => (
            <div key={s.key} className="flex items-center gap-1">
              <div className="h-2 w-4 rounded-full" style={{ background: s.color }} />
              <span className="text-[10px] text-gray-500">{s.label}</span>
            </div>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" style={{ height: 120 }}>
        {/* Grid lines at 25%, 50%, 75%, 100% */}
        {[0.25, 0.5, 0.75, 1.0].map(v => {
          const y = h - padY - (v * (h - padY * 2));
          return (
            <line key={v} x1={0} y1={y} x2={w} y2={y}
              stroke="#f3f4f6" strokeWidth={0.5} />
          );
        })}
        {series.map(s => (
          <path key={s.key} d={toPath(s.key)}
            fill="none" stroke={s.color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        ))}
      </svg>
      <div className="flex justify-between text-[9px] text-gray-300">
        <span>{new Date(points[0]!.timestamp).toLocaleDateString()}</span>
        <span>{new Date(points[points.length - 1]!.timestamp).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

function RegressionBanner({ regression }: { regression: LeaderboardResponse['regression'] }) {
  const hasIssues = regression.regressions.length > 0 || regression.improvements.length > 0 || regression.promptChanged;
  if (!hasIssues) return null;

  return (
    <div className="space-y-2">
      {regression.promptChanged && (
        <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-2.5 flex items-center gap-2">
          <span className="text-base shrink-0">🔄</span>
          <p className="text-xs text-amber-800">
            <strong>Prompt changed</strong> — comparing against baseline from hash <code className="font-mono">{regression.previousHash?.slice(0, 8)}</code>.
            New hash: <code className="font-mono">{regression.currentHash.slice(0, 8)}</code>
          </p>
        </div>
      )}
      {regression.regressions.length > 0 && (
        <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-2.5">
          <p className="text-xs font-semibold text-red-700 mb-1.5">⚠ {regression.regressions.length} regression{regression.regressions.length > 1 ? 's' : ''} detected</p>
          {regression.regressions.map((r, i) => (
            <p key={i} className="text-[11px] text-red-600">
              {r.dataset} / {r.metric}: {pct(r.before)} → {pct(r.after)} ({(r.delta * 100).toFixed(1)}%)
            </p>
          ))}
        </div>
      )}
      {regression.improvements.length > 0 && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-2.5">
          <p className="text-xs font-semibold text-emerald-700 mb-1.5">✓ {regression.improvements.length} improvement{regression.improvements.length > 1 ? 's' : ''}</p>
          {regression.improvements.map((r, i) => (
            <p key={i} className="text-[11px] text-emerald-600">
              {r.dataset} / {r.metric}: {pct(r.before)} → {pct(r.after)} (+{(r.delta * 100).toFixed(1)}%)
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function EvalDashboard() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardResponse | null>(null);
  const [trend, setTrend]             = useState<TrendPoint[]>([]);
  const [loading, setLoading]         = useState(true);
  const [triggering, setTriggering]   = useState(false);
  const [triggerMsg, setTriggerMsg]   = useState('');
  const [error, setError]             = useState('');

  const fetchData = useCallback(async () => {
    try {
      const [lbRes, histRes] = await Promise.all([
        fetch(`${BASE_URL}/eval/leaderboard`).then(r => r.json()),
        fetch(`${BASE_URL}/eval/history`).then(r => r.json()),
      ]);
      setLeaderboard(lbRes as LeaderboardResponse);
      setTrend((histRes as { trend: TrendPoint[] }).trend ?? []);
    } catch {
      setError('Could not load evaluation data. Is the backend running?');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function triggerRun(save: boolean) {
    setTriggering(true);
    setTriggerMsg('');
    try {
      const res = await fetch(`${BASE_URL}/eval/${save ? 'run/save' : 'run'}`, { method: 'POST' });
      const data = await res.json() as { message: string };
      setTriggerMsg(data.message ?? 'Evaluation started');
      // Poll for results after a delay
      setTimeout(() => {
        fetchData();
        setTriggering(false);
      }, 5000);
    } catch {
      setTriggerMsg('Failed to trigger evaluation.');
      setTriggering(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-gray-50 px-4">
        <p className="text-sm text-red-600">{error}</p>
        <button onClick={fetchData} className="text-sm font-medium text-indigo-600 hover:text-indigo-800">Retry</button>
      </div>
    );
  }

  const lb = leaderboard;
  const hasData = lb && lb.leaderboard.length > 0;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto max-w-2xl flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">📊</span>
            <div>
              <p className="text-sm font-bold text-gray-900">Evaluation Dashboard</p>
              <p className="text-[10px] text-gray-400">W&B Weave · TripSync quality harness</p>
            </div>
          </div>
          <button
            onClick={fetchData}
            className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors"
          >
            Refresh
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6 space-y-6">

        {/* Summary hero */}
        {hasData && lb.summary && (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Avg overall',      value: pct(lb.summary.avgOverall) },
              { label: 'Avg satisfaction', value: pct(lb.summary.avgSatisfaction) },
              { label: 'Eval runs',        value: String(lb.summary.totalRuns) },
            ].map(s => (
              <div key={s.label} className="rounded-2xl border border-gray-100 bg-white shadow-sm px-3 py-3 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{s.label}</p>
                <p className="mt-0.5 text-lg font-bold text-gray-900">{s.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Regression banner */}
        {hasData && lb.regression && <RegressionBanner regression={lb.regression} />}

        {/* Trigger controls */}
        <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-purple-50 px-5 py-4 space-y-3">
          <div className="flex items-start gap-2.5">
            <span className="text-xl shrink-0 mt-0.5">🧪</span>
            <div>
              <p className="text-sm font-bold text-indigo-900">Run evaluation</p>
              <p className="text-xs text-indigo-700 mt-0.5">
                Generates itineraries for all 5 test groups and scores them across 5 dimensions.
                Takes ~3–8 minutes depending on pipeline speed.
              </p>
            </div>
          </div>
          {triggerMsg && (
            <p className="text-xs text-indigo-700 bg-white/60 rounded-lg px-3 py-2">{triggerMsg}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => triggerRun(false)}
              disabled={triggering}
              className="flex-1 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {triggering ? <><Spinner className="h-3 w-3 text-white inline mr-1" />Running…</> : 'Run eval'}
            </button>
            <button
              onClick={() => triggerRun(true)}
              disabled={triggering}
              className="flex-1 rounded-xl bg-white border border-indigo-200 px-4 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 transition-colors"
            >
              Run + save baseline
            </button>
          </div>
        </div>

        {/* Trend chart */}
        {trend.length > 0 && <TrendChart points={trend} />}

        {/* Leaderboard */}
        {hasData ? (
          <section className="space-y-3">
            <div className="flex items-center gap-2.5">
              <span className="text-xl">🏆</span>
              <div>
                <h2 className="text-base font-bold text-gray-900">Leaderboard</h2>
                <p className="text-xs text-gray-400">
                  Latest run · {lb.summary.timestamp ? new Date(lb.summary.timestamp).toLocaleString() : '—'}
                  {lb.summary.promptHash ? ` · hash ${lb.summary.promptHash.slice(0, 8)}` : ''}
                </p>
              </div>
            </div>
            {lb.leaderboard.map((row, i) => (
              <DatasetCard key={row.datasetId} row={row} rank={i + 1} />
            ))}
          </section>
        ) : (
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-5 py-10 text-center">
            <p className="text-sm text-gray-500">No evaluation runs yet.</p>
            <p className="text-xs text-gray-400 mt-1">Click "Run eval" above to generate the first results.</p>
          </div>
        )}

        {/* W&B link */}
        {process.env.NODE_ENV !== 'production' && (
          <p className="text-center text-[11px] text-gray-300 pb-4">
            Set WANDB_API_KEY on the backend to stream all traces to W&B Weave ·{' '}
            <a href="https://wandb.ai" target="_blank" rel="noopener noreferrer"
              className="text-indigo-400 hover:text-indigo-600 underline">wandb.ai</a>
          </p>
        )}
      </main>
    </div>
  );
}

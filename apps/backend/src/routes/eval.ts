/**
 * Evaluation API routes — leaderboard, history, and on-demand eval trigger.
 *
 * GET  /eval/leaderboard     — latest results per dataset, sorted by overall score
 * GET  /eval/history         — all historical runs (last 20)
 * GET  /eval/baseline        — current baseline snapshot
 * POST /eval/run             — trigger a new eval run (optionally save as baseline)
 * POST /eval/run/save        — trigger + save as new baseline
 */

import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { loadBaseline, diffAgainstBaseline, runEvaluation } from '../eval/harness';
import type { EvalRunResult } from '../eval/scorers';

export const evalRouter = Router();

const HISTORY_PATH = path.resolve(__dirname, '../eval/eval-history.json');

function loadHistory(): EvalRunResult[][] {
  try {
    if (!fs.existsSync(HISTORY_PATH)) return [];
    return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// GET /eval/leaderboard — latest scores per dataset, ranked
// ---------------------------------------------------------------------------

evalRouter.get('/leaderboard', (_req, res) => {
  const history = loadHistory();
  if (history.length === 0) {
    return res.json({ leaderboard: [], message: 'No eval runs yet. POST /eval/run to start.' });
  }

  // Latest run
  const latest = history[history.length - 1]!;

  // Sort by overall score descending
  const leaderboard = [...latest].sort((a, b) => b.scores.overall - a.scores.overall);

  // Compute averages across all datasets in latest run
  const avgOverall = leaderboard.reduce((s, r) => s + r.scores.overall, 0) / leaderboard.length;
  const avgBudget  = leaderboard.reduce((s, r) => s + r.scores.budgetCompliance, 0) / leaderboard.length;
  const avgSat     = leaderboard.reduce((s, r) => s + r.scores.satisfaction, 0) / leaderboard.length;

  // Baseline comparison
  const baseline   = loadBaseline();
  const regression = diffAgainstBaseline(latest, baseline, latest[0]?.promptHash ?? '');

  return res.json({
    leaderboard,
    summary: {
      runId:          latest[0]?.runId ?? null,
      timestamp:      latest[0]?.timestamp ?? null,
      promptHash:     latest[0]?.promptHash ?? null,
      avgOverall:     Math.round(avgOverall * 1000) / 1000,
      avgBudgetCompliance: Math.round(avgBudget * 1000) / 1000,
      avgSatisfaction: Math.round(avgSat * 1000) / 1000,
      totalRuns:      history.length,
    },
    regression,
  });
});

// ---------------------------------------------------------------------------
// GET /eval/history — trend data for the dashboard chart
// ---------------------------------------------------------------------------

evalRouter.get('/history', (_req, res) => {
  const history = loadHistory();

  // Summarise each run as a single row for the trend chart
  const trend = history.map(run => {
    const avg = (key: keyof EvalRunResult['scores']) =>
      run.reduce((s, r) => s + r.scores[key], 0) / run.length;

    return {
      timestamp:       run[0]?.timestamp ?? '',
      promptHash:      run[0]?.promptHash ?? '',
      avgOverall:      Math.round(avg('overall') * 1000) / 1000,
      avgSatisfaction: Math.round(avg('satisfaction') * 1000) / 1000,
      avgFairness:     Math.round(avg('fairness') * 1000) / 1000,
      avgBudget:       Math.round(avg('budgetCompliance') * 1000) / 1000,
      avgDiversity:    Math.round(avg('diversity') * 1000) / 1000,
      avgConstraints:  Math.round(avg('constraintSatisfaction') * 1000) / 1000,
      datasets:        run.map(r => ({ id: r.datasetId, name: r.datasetName, overall: r.scores.overall })),
    };
  });

  return res.json({ trend, totalRuns: history.length });
});

// ---------------------------------------------------------------------------
// GET /eval/baseline
// ---------------------------------------------------------------------------

evalRouter.get('/baseline', (_req, res) => {
  const baseline = loadBaseline();
  if (!baseline) return res.json({ baseline: null, message: 'No baseline saved yet.' });
  return res.json({ baseline });
});

// ---------------------------------------------------------------------------
// POST /eval/run — trigger an evaluation run (slow: ~2-5 min per dataset)
// ---------------------------------------------------------------------------

evalRouter.post('/run', async (req, res) => {
  const doSave  = req.body?.save === true || req.path === '/run/save';
  const datasetId = req.body?.datasetId as string | undefined;

  // Respond immediately — eval is async and slow
  res.status(202).json({ status: 'running', message: 'Evaluation started. Poll /eval/leaderboard for results.' });

  // Run in background (fire-and-forget — SSE would be nicer but overkill for eval)
  runEvaluation({
    datasets:     datasetId
      ? (await import('../eval/datasets')).EVAL_DATASETS.filter(d => d.id === datasetId)
      : undefined,
    saveBaseline: doSave,
    verbose:      true,
  }).then(summary => {
    console.log(`[eval] Run complete. Overall avg: ${(summary.results.reduce((s, r) => s + r.scores.overall, 0) / summary.results.length * 100).toFixed(1)}%`);
    if (summary.regression.regressions.length > 0) {
      console.warn(`[eval] ⚠ ${summary.regression.regressions.length} regressions detected`);
    }
  }).catch(err => {
    console.error('[eval] Run failed:', err);
  });
});

// Alias — POST /eval/run/save auto-saves baseline
evalRouter.post('/run/save', async (req, res) => {
  res.status(202).json({ status: 'running', message: 'Evaluation started with baseline save.' });
  runEvaluation({ saveBaseline: true, verbose: true }).catch(err => {
    console.error('[eval] Run/save failed:', err);
  });
});

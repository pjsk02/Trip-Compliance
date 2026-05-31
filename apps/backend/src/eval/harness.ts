/**
 * Evaluation harness — runs the full planning pipeline against each dataset
 * and logs every score to W&B Weave.
 *
 * Uses weave.Evaluation so each run is:
 *   - fully traced (inputs, outputs, all scorer values)
 *   - visible in the W&B Weave Evaluations UI
 *   - comparable across runs for regression detection
 */

import 'dotenv/config';
import * as weaveSDK from 'weave';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { runOrchestrator } from '../lib/planning/orchestrator';
import { EVAL_DATASETS } from './datasets';
import type { EvalDataset } from './datasets';
import {
  scoreSatisfaction,
  scoreFairness,
  scoreBudgetCompliance,
  scoreDiversity,
  scoreConstraintSatisfaction,
  computeOverall,
} from './scorers';
import type { EvalInput, EvalOutput, EvalRunResult } from './scorers';

export type { EvalInput, EvalOutput, EvalDataset };

// ---------------------------------------------------------------------------
// Prompt hash — detects when system prompts change so we can flag regressions
// ---------------------------------------------------------------------------

function computePromptHash(): string {
  const agentFiles = [
    '../lib/planning/agents/activityAgent.ts',
    '../lib/planning/agents/foodAgent.ts',
    '../lib/planning/agents/accommodationAgent.ts',
    '../lib/planning/agents/transportationAgent.ts',
    '../lib/planning/agents/budgetAgent.ts',
  ].map(f => path.resolve(__dirname, f));

  const content = agentFiles
    .filter(f => fs.existsSync(f))
    .map(f => fs.readFileSync(f, 'utf8'))
    .join('\n');

  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
}

// ---------------------------------------------------------------------------
// Baseline persistence — stored as JSON next to this file
// ---------------------------------------------------------------------------

const BASELINE_PATH = path.resolve(__dirname, 'baseline.json');

export interface BaselineEntry {
  promptHash: string;
  timestamp:  string;
  results:    EvalRunResult[];
}

export function loadBaseline(): BaselineEntry | null {
  try {
    if (!fs.existsSync(BASELINE_PATH)) return null;
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as BaselineEntry;
  } catch {
    return null;
  }
}

export function saveBaseline(entry: BaselineEntry): void {
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(entry, null, 2), 'utf8');
  console.log(`[eval] Baseline saved → ${BASELINE_PATH}`);
}

// ---------------------------------------------------------------------------
// Regression diff — compare new results against baseline
// ---------------------------------------------------------------------------

export interface RegressionReport {
  promptChanged:  boolean;
  previousHash:   string | null;
  currentHash:    string;
  regressions:    Array<{ dataset: string; metric: string; before: number; after: number; delta: number }>;
  improvements:   Array<{ dataset: string; metric: string; before: number; after: number; delta: number }>;
}

export function diffAgainstBaseline(
  current: EvalRunResult[],
  baseline: BaselineEntry | null,
  currentHash: string,
): RegressionReport {
  const report: RegressionReport = {
    promptChanged: baseline ? baseline.promptHash !== currentHash : false,
    previousHash:  baseline?.promptHash ?? null,
    currentHash,
    regressions:   [],
    improvements:  [],
  };

  if (!baseline) return report;

  const THRESHOLD = 0.03;  // 3% change to flag

  for (const cur of current) {
    const prev = baseline.results.find(r => r.datasetId === cur.datasetId);
    if (!prev) continue;

    const metrics: Array<keyof typeof cur.scores> = [
      'satisfaction', 'fairness', 'budgetCompliance', 'diversity',
      'constraintSatisfaction', 'overall',
    ];

    for (const metric of metrics) {
      const delta = cur.scores[metric] - prev.scores[metric];
      if (Math.abs(delta) < THRESHOLD) continue;

      const entry = {
        dataset: cur.datasetName,
        metric,
        before:  prev.scores[metric],
        after:   cur.scores[metric],
        delta:   Math.round(delta * 1000) / 1000,
      };

      if (delta < 0) {
        report.regressions.push(entry);
      } else {
        report.improvements.push(entry);
      }
    }
  }

  return report;
}

// ---------------------------------------------------------------------------
// Model function — Weave passes { datasetRow } as the model input
// ---------------------------------------------------------------------------

async function planningModel(input: { datasetRow: WeaveDatasetRow }): Promise<EvalOutput> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await runOrchestrator(input.datasetRow.dataset.context, 3) as any;
  return { result };
}

// ---------------------------------------------------------------------------
// Individual scorer wrappers
// Weave Evaluation scorers receive { datasetRow, modelOutput } as one arg.
// ---------------------------------------------------------------------------

type WeaveDatasetRow = { dataset: EvalDataset };
type WeaveScorerArg  = { datasetRow: WeaveDatasetRow; modelOutput: EvalOutput };

const weaveSatisfactionScorer = weaveSDK.op(
  ({ datasetRow, modelOutput }: WeaveScorerArg) =>
    scoreSatisfaction({ dataset: datasetRow.dataset }, modelOutput),
  { name: 'scorer:satisfaction' },
);

const weaveFairnessScorer = weaveSDK.op(
  ({ datasetRow, modelOutput }: WeaveScorerArg) =>
    scoreFairness({ dataset: datasetRow.dataset }, modelOutput),
  { name: 'scorer:fairness' },
);

const weaveBudgetScorer = weaveSDK.op(
  ({ datasetRow, modelOutput }: WeaveScorerArg) =>
    scoreBudgetCompliance({ dataset: datasetRow.dataset }, modelOutput),
  { name: 'scorer:budget_compliance' },
);

const weaveDiversityScorer = weaveSDK.op(
  ({ datasetRow, modelOutput }: WeaveScorerArg) =>
    scoreDiversity({ dataset: datasetRow.dataset }, modelOutput),
  { name: 'scorer:diversity' },
);

const weaveConstraintScorer = weaveSDK.op(
  ({ datasetRow, modelOutput }: WeaveScorerArg) =>
    scoreConstraintSatisfaction({ dataset: datasetRow.dataset }, modelOutput),
  { name: 'scorer:constraint_satisfaction' },
);

// ---------------------------------------------------------------------------
// Main eval runner
// ---------------------------------------------------------------------------

export interface EvalRunSummary {
  promptHash:  string;
  results:     EvalRunResult[];
  regression:  RegressionReport;
  weaveRunUrl: string | null;
}

export async function runEvaluation(options: {
  datasets?:    typeof EVAL_DATASETS;
  saveBaseline?: boolean;
  verbose?:     boolean;
}): Promise<EvalRunSummary> {
  const { datasets = EVAL_DATASETS, saveBaseline: doSave = false, verbose = true } = options;

  // Initialise Weave
  const apiKey  = process.env.WANDB_API_KEY;
  const project = process.env.WANDB_PROJECT ?? 'tripsync';
  let weaveReady = false;

  if (apiKey) {
    try {
      await weaveSDK.init(project);
      weaveReady = true;
      if (verbose) console.log(`[eval] Weave initialised — project "${project}"`);
    } catch (err) {
      console.warn('[eval] Weave init failed — results saved locally only:', (err as Error).message);
    }
  } else {
    if (verbose) console.log('[eval] WANDB_API_KEY not set — running without Weave logging');
  }

  const promptHash = computePromptHash();
  const runId      = `eval-${Date.now()}`;
  const results:   EvalRunResult[] = [];

  if (verbose) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`TRIPSYNC EVALUATION HARNESS  promptHash=${promptHash}`);
    console.log(`${'═'.repeat(60)}`);
  }

  for (const dataset of datasets) {
    if (verbose) console.log(`\n▶ Running dataset: "${dataset.name}" (${dataset.id})`);
    const t0 = Date.now();

    try {
      // Build Weave Evaluation for this dataset
      const weaveDataset = new weaveSDK.Dataset({
        name:        dataset.id,
        description: dataset.description,
        rows:        [{ dataset }],  // each row has { dataset } — matches WeaveDatasetRow
      });

      const evaluation = new weaveSDK.Evaluation({
        name:    `tripsync_eval_${dataset.id}`,
        dataset: weaveDataset,
        scorers: [
          weaveSatisfactionScorer as Parameters<typeof weaveSDK.Evaluation['prototype']['evaluate']>[0]['model'],
          weaveFairnessScorer as Parameters<typeof weaveSDK.Evaluation['prototype']['evaluate']>[0]['model'],
          weaveBudgetScorer as Parameters<typeof weaveSDK.Evaluation['prototype']['evaluate']>[0]['model'],
          weaveDiversityScorer as Parameters<typeof weaveSDK.Evaluation['prototype']['evaluate']>[0]['model'],
          weaveConstraintScorer as Parameters<typeof weaveSDK.Evaluation['prototype']['evaluate']>[0]['model'],
        ],
      });

      // Run evaluation — Weave automatically traces model + all scorers
      const model = weaveReady
        ? weaveSDK.op(planningModel, { name: `model:${dataset.id}` })
        : planningModel;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const evalResults = await evaluation.evaluate({ model: model as any });

      // Extract per-scorer means from Weave summary
      const summary = evalResults as Record<string, { mean?: number }>;

      const satisfactionScore = summary['scorer:satisfaction']?.mean    ?? 0;
      const fairnessScore     = summary['scorer:fairness']?.mean        ?? 0;
      const budgetScore       = summary['scorer:budget_compliance']?.mean ?? 0;
      const diversityScore    = summary['scorer:diversity']?.mean       ?? 0;
      const constraintScore   = summary['scorer:constraint_satisfaction']?.mean ?? 0;

      // Also run directly to get reasons and typed metadata
      const output = await planningModel({ datasetRow: { dataset } });
      const satResult   = scoreSatisfaction({ dataset }, output);
      const fairResult  = scoreFairness({ dataset }, output);
      const budResult   = scoreBudgetCompliance({ dataset }, output);
      const divResult   = scoreDiversity({ dataset }, output);
      const conResult   = scoreConstraintSatisfaction({ dataset }, output);

      const scores = {
        satisfaction:          satisfactionScore || satResult.score,
        fairness:              fairnessScore     || fairResult.score,
        budgetCompliance:      budgetScore       || budResult.score,
        diversity:             diversityScore    || divResult.score,
        constraintSatisfaction: constraintScore  || conResult.score,
        overall:               0,
      };
      scores.overall = computeOverall(scores);

      const runResult: EvalRunResult = {
        runId,
        datasetId:    dataset.id,
        datasetName:  dataset.name,
        timestamp:    new Date().toISOString(),
        promptHash,
        durationMs:   Date.now() - t0,
        scores,
        reasons: {
          satisfaction:          satResult.reason,
          fairness:              fairResult.reason,
          budgetCompliance:      budResult.reason,
          diversity:             divResult.reason,
          constraintSatisfaction: conResult.reason,
        },
        consensusStatus:       output.result.consensus?.status ?? 'UNKNOWN',
        adminOverride:         output.result.itinerary?.adminOverrideFlag ?? false,
        totalCostPerPersonUsd: output.result.itinerary?.budgetBreakdown?.totalPerPersonUsd ?? 0,
        negotiationRounds:     output.result.itinerary?.negotiationRounds ?? 0,
      };

      results.push(runResult);

      if (verbose) {
        console.log(`  ✓ Overall: ${(scores.overall * 100).toFixed(1)}%`);
        console.log(`    satisfaction=${(scores.satisfaction * 100).toFixed(0)}%`
          + ` fairness=${(scores.fairness * 100).toFixed(0)}%`
          + ` budget=${(scores.budgetCompliance * 100).toFixed(0)}%`
          + ` diversity=${(scores.diversity * 100).toFixed(0)}%`
          + ` constraints=${(scores.constraintSatisfaction * 100).toFixed(0)}%`);
        console.log(`    consensus=${runResult.consensusStatus} adminOverride=${runResult.adminOverride} (${runResult.durationMs}ms)`);
      }
    } catch (err) {
      console.error(`  ✗ Dataset "${dataset.id}" failed:`, (err as Error).message);
    }
  }

  // Regression diff
  const baseline   = loadBaseline();
  const regression = diffAgainstBaseline(results, baseline, promptHash);

  if (verbose) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log('LEADERBOARD');
    console.log(`${'─'.repeat(60)}`);
    const sorted = [...results].sort((a, b) => b.scores.overall - a.scores.overall);
    for (const r of sorted) {
      console.log(`  ${r.datasetName.padEnd(25)} overall=${(r.scores.overall * 100).toFixed(1)}%  budget=${r.scores.budgetCompliance === 0 ? 'FAIL' : 'OK'}  consensus=${r.consensusStatus}`);
    }

    if (regression.regressions.length > 0) {
      console.log(`\n⚠ REGRESSIONS (${regression.regressions.length}):`);
      for (const r of regression.regressions) {
        console.log(`  ${r.dataset} / ${r.metric}: ${(r.before * 100).toFixed(1)}% → ${(r.after * 100).toFixed(1)}% (${(r.delta * 100).toFixed(1)}%)`);
      }
    }
    if (regression.improvements.length > 0) {
      console.log(`\n✓ IMPROVEMENTS (${regression.improvements.length}):`);
      for (const i of regression.improvements) {
        console.log(`  ${i.dataset} / ${i.metric}: ${(i.before * 100).toFixed(1)}% → ${(i.after * 100).toFixed(1)}% (+${(i.delta * 100).toFixed(1)}%)`);
      }
    }
  }

  if (doSave) {
    saveBaseline({ promptHash, timestamp: new Date().toISOString(), results });
  }

  // Persist results for API/dashboard consumption
  const historyPath = path.resolve(__dirname, 'eval-history.json');
  let history: EvalRunResult[][] = [];
  try { history = JSON.parse(fs.readFileSync(historyPath, 'utf8')); } catch {}
  history.push(results);
  // Keep last 20 runs
  if (history.length > 20) history = history.slice(-20);
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf8');

  const entity  = process.env.WANDB_ENTITY ?? '';
  const weaveRunUrl = weaveReady && entity
    ? `https://wandb.ai/${entity}/${project}/weave/evaluations`
    : weaveReady
    ? `https://wandb.ai/${project}/weave/evaluations`
    : null;

  return { promptHash, results, regression, weaveRunUrl };
}

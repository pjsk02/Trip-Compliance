/**
 * Evaluation CLI — runs the full evaluation harness and prints results.
 *
 * Usage:
 *   npm run eval                   # run all datasets, no baseline save
 *   npm run eval -- --save         # run + save results as new baseline
 *   npm run eval -- --dataset budget-travelers  # run single dataset
 *
 * Environment:
 *   WANDB_API_KEY   Required for Weave logging
 *   WANDB_PROJECT   Optional (default: tripsync)
 *   WANDB_ENTITY    Optional — your W&B username/org for direct trace links
 */
import 'dotenv/config';
import { runEvaluation } from '../src/eval/harness';
import { EVAL_DATASETS } from '../src/eval/datasets';

async function main() {
  const args = process.argv.slice(2);
  const doSave     = args.includes('--save');
  const datasetArg = args.find(a => a.startsWith('--dataset='))?.split('=')[1]
    ?? (args[args.indexOf('--dataset') + 1] !== '--save'
      ? args[args.indexOf('--dataset') + 1]
      : undefined);

  const datasets = datasetArg
    ? EVAL_DATASETS.filter(d => d.id === datasetArg)
    : EVAL_DATASETS;

  if (datasetArg && datasets.length === 0) {
    console.error(`Unknown dataset "${datasetArg}". Available: ${EVAL_DATASETS.map(d => d.id).join(', ')}`);
    process.exit(1);
  }

  const summary = await runEvaluation({ datasets, saveBaseline: doSave, verbose: true });

  console.log('\n');
  if (summary.weaveRunUrl) {
    console.log(`📊 View full evaluation in W&B Weave:\n   ${summary.weaveRunUrl}`);
  } else {
    console.log('ℹ  Set WANDB_API_KEY + WANDB_ENTITY to stream results to W&B Weave');
  }

  if (doSave) {
    console.log(`\n✓ Baseline saved (promptHash=${summary.promptHash})`);
  } else {
    console.log(`\nTip: run with --save to persist as regression baseline`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Eval failed:', err);
  process.exit(1);
});

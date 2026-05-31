/**
 * Prompt regression check — run this in CI or as a pre-commit hook.
 *
 * Computes the SHA of all agent system prompts and compares against the
 * stored baseline. If prompts changed and a baseline exists, reports
 * regressions and exits with code 1 if any score dropped by > 5%.
 *
 * Usage:
 *   npm run eval:check              # compare only (no new run)
 *   npm run eval:check -- --run     # run full eval if prompts changed
 *
 * Intended CI workflow:
 *   1. Developer changes a system prompt
 *   2. Pre-push hook runs this script
 *   3. If prompts changed: runs full eval, diffs against baseline
 *   4. Exits 1 if regressions > 5% — blocks push
 *   5. Developer fixes regression or runs `npm run eval:save` to update baseline
 */
import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { loadBaseline, diffAgainstBaseline, runEvaluation } from '../src/eval/harness';

const AGENT_FILES = [
  '../src/lib/planning/agents/activityAgent.ts',
  '../src/lib/planning/agents/foodAgent.ts',
  '../src/lib/planning/agents/accommodationAgent.ts',
  '../src/lib/planning/agents/transportationAgent.ts',
  '../src/lib/planning/agents/budgetAgent.ts',
].map(f => path.resolve(__dirname, f));

function computeHash(): string {
  const content = AGENT_FILES.filter(f => fs.existsSync(f))
    .map(f => fs.readFileSync(f, 'utf8'))
    .join('\n');
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
}

async function main() {
  const args       = process.argv.slice(2);
  const doRun      = args.includes('--run');
  const threshold  = 0.05;  // 5% regression threshold for CI failure

  const currentHash = computeHash();
  const baseline    = loadBaseline();

  console.log(`\nPrompt hash: ${currentHash}`);

  if (!baseline) {
    console.log('No baseline found. Run `npm run eval:save` to create one.');
    process.exit(0);
  }

  const promptChanged = baseline.promptHash !== currentHash;

  if (!promptChanged) {
    console.log('✓ Prompts unchanged — no regression check needed.');
    process.exit(0);
  }

  console.log(`⚠ Prompt changed (was ${baseline.promptHash})`);

  if (!doRun) {
    console.log('Prompts changed but --run not passed — skipping live eval.');
    console.log('Run with --run to evaluate the new prompts against baseline.');
    process.exit(0);
  }

  console.log('\nRunning evaluation against new prompts…');
  const summary = await runEvaluation({ saveBaseline: false, verbose: true });

  const report = diffAgainstBaseline(summary.results, baseline, currentHash);

  const criticalRegressions = report.regressions.filter(r => r.delta <= -threshold);

  if (criticalRegressions.length > 0) {
    console.error(`\n✗ CRITICAL REGRESSIONS (>${threshold * 100}% drop):`);
    for (const r of criticalRegressions) {
      console.error(`  ${r.dataset} / ${r.metric}: ${(r.before * 100).toFixed(1)}% → ${(r.after * 100).toFixed(1)}% (${(r.delta * 100).toFixed(1)}%)`);
    }
    console.error('\nFix the regression or run `npm run eval:save` to update the baseline.');
    process.exit(1);
  }

  if (report.regressions.length > 0) {
    console.warn(`\n⚠ Minor regressions (< ${threshold * 100}%):`);
    for (const r of report.regressions) {
      console.warn(`  ${r.dataset} / ${r.metric}: ${(r.delta * 100).toFixed(1)}%`);
    }
  }

  if (report.improvements.length > 0) {
    console.log(`\n✓ ${report.improvements.length} improvement(s) vs baseline`);
  }

  console.log('\n✓ No critical regressions. Prompts can be merged.');
  process.exit(0);
}

main().catch(err => {
  console.error('check-prompt-regression failed:', err);
  process.exit(1);
});

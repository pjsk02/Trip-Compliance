/**
 * Weave (W&B) integration — initialise once at server startup and export
 * `wop` (weave op wrapper) for all tracing callsites.
 *
 * If WANDB_API_KEY is not set, tracing is silently skipped — the application
 * functions identically, observability is just disabled.
 */

import * as weave from 'weave';

let initialised = false;

export async function initWeave(): Promise<void> {
  const apiKey = process.env.WANDB_API_KEY;
  if (!apiKey) {
    console.log('[weave] WANDB_API_KEY not set — tracing disabled.');
    return;
  }

  const project = process.env.WANDB_PROJECT ?? 'tripsync';
  try {
    await weave.init(project);
    initialised = true;
    console.log(`[weave] Initialised — project "${project}" at wandb.ai`);
  } catch (err) {
    console.warn('[weave] Init failed (tracing disabled):', (err as Error).message);
  }
}

export function isWeaveEnabled(): boolean {
  return initialised;
}

/**
 * Wrap an async function as a Weave op.
 * Falls back to the original function when Weave is disabled so callsites
 * never need a conditional.
 */
export function wop<TArgs extends unknown[], TReturn>(
  name: string,
  fn: (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn> {
  if (!process.env.WANDB_API_KEY) return fn;
  return weave.op(fn, { name });
}

export { weave };

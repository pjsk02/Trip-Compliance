# W&B Weave Setup Guide

Weights & Biases Weave provides deep observability for TripSync's multi-agent pipeline. Every agent call, negotiation round, consensus decision, and final itinerary generation is automatically traced when Weave is enabled.

## What gets traced

| Op name | What it covers |
|---|---|
| `orchestrator:run` | Full pipeline: inputs, final output, total latency |
| `agent:activity` | Activity Agent — prompt, proposal, token usage |
| `agent:food` | Food Agent — prompt, proposal, token usage |
| `agent:accommodation` | Accommodation Agent — prompt, proposal, token usage |
| `agent:transportation` | Transportation Agent — prompt, proposal, token usage |
| `agent:budget` | Budget Agent — computed breakdown, substitutions |
| `pipeline:negotiate` | Negotiation — rounds, conflicts, resolutions |
| `pipeline:consensus` | Consensus engine — scorecards, winner selection |
| `pipeline:assemble` | Final itinerary assembly |

For every trace, Weave captures: input context, agent name, prompt used, structured output, latency, token usage (where available), and success/failure status.

---

## 1. Create a W&B account

1. Go to [https://wandb.ai/site](https://wandb.ai/site) and click **Sign up**.
2. Create an account (free tier is sufficient).
3. After signing in, go to **Settings → API keys** and copy your API key.

---

## 2. Configure environment variables

Add the following to `apps/backend/.env`:

```env
# Required — your W&B API key
WANDB_API_KEY=your_api_key_here

# Optional — W&B project name (default: "tripsync")
WANDB_PROJECT=tripsync

# Optional — your W&B entity (username or org name, for direct trace URL links)
WANDB_ENTITY=your_username_or_org
```

> **Note:** If `WANDB_API_KEY` is not set, tracing is silently skipped. The application works identically — observability is simply disabled.

---

## 3. Start the backend

```bash
cd apps/backend
npm run dev
```

On startup, you will see:

```
[weave] Initialised — project "tripsync" at wandb.ai
```

---

## 4. Generate an itinerary

Navigate to your group's dashboard and click **Generate itinerary**. The pipeline runs through the negotiation view and produces the final plan.

---

## 5. View traces in W&B Weave

1. Go to [https://wandb.ai](https://wandb.ai) and open your project.
2. Click **Weave** in the left sidebar (or navigate to **Traces**).
3. You will see one root trace per generation run named `orchestrator:run`, with child traces for each agent and pipeline stage.

Each trace shows:
- **Inputs** — the full `PlanningContext` (destination, group size, locked budget, member preferences)
- **Outputs** — the structured proposal or pipeline result
- **Latency** — wall-clock time per agent
- **Token usage** — input/output tokens for each Claude call
- **Status** — success, repair (second attempt needed), or fallback (safe default used)

---

## 6. In-app Observe tab

After generation, open the itinerary and click the **🔬 Observe** tab. It shows:

- **Execution Timeline** — Gantt-style bars showing which agents ran in each wave, their durations, and status
- **Decision Audit Trail** — for each key decision (activity selection, consensus winner, budget compliance), the chosen outcome, rejected alternatives, and the scoring reason
- **View full trace in W&B Weave** — a direct link to the W&B trace dashboard (only shown when `WANDB_API_KEY` is configured and `WANDB_ENTITY` is set)

---

## 7. W&B Dashboard (admin view)

The W&B project dashboard at `https://wandb.ai/<entity>/<project>/weave` provides:

| Metric | Where to find it |
|---|---|
| Total agent runs | Weave → Traces — filter by op name |
| Average negotiation rounds | Weave → Traces → `pipeline:negotiate` → output.rounds.length |
| Agent latency (p50/p95) | Weave → Traces → sort by latency |
| Budget compliance | Weave → Traces → `pipeline:consensus` → output.status |
| Satisfaction metrics | Weave → Traces → `orchestrator:run` → output.itinerary.satisfactionScores |
| Consensus success rate | Weave → Traces → `pipeline:consensus` → filter by status=OK vs ADMIN_OVERRIDE_REQUIRED |

You can build custom W&B Reports to chart these metrics over time as more itineraries are generated.

---

## Troubleshooting

**Weave not initialising:**
- Check `WANDB_API_KEY` is set and correct in `apps/backend/.env`
- Check network access — the backend must reach `api.wandb.ai`

**Traces appear but agent data is missing:**
- Confirm the backend restarted after adding the env var
- Check the backend logs for `[weave]` lines

**`weaveTraceUrl` not showing in the Observe tab:**
- Set `WANDB_ENTITY` in `.env` — without it the URL cannot be constructed

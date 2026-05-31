# TripSync AI — Happy-Path Usage Guide

Full walkthrough of the MVP flow from group creation through itinerary generation.

---

## Prerequisites

- Node 20+, PostgreSQL (or Neon), an Anthropic API key, a Google OAuth client ID.
- Copy `.env.example` → `.env` in both `apps/backend/` and `apps/frontend/` and fill in values.
- Run `npm install` from the repo root, then `npm run prisma:migrate` from `apps/backend/`.

---

## Step 1 — Create a group (organizer)

1. Open the app and sign in with Google.
2. Click **Create group** on the home screen.
3. Fill in:
   - **Trip name** — e.g. "Summer Barcelona Trip"
   - **Destination** — **required for planning** (e.g. "Barcelona, Spain"). Can be updated later but must be set before generating the itinerary.
   - **Group password** — auto-generated; share this with your friends.
4. Click **Create group** → you land on the group dashboard. Copy the **group code** (e.g. `BCNX-7821`) and send it + the password to everyone.

---

## Step 2 — Members join

Each friend:
1. Signs in with Google → **Join group**.
2. Enters the group code and password → lands on the same dashboard.

> **MVP assumption:** destination is set by the organizer at creation time. Members do not vote on destination in v1.

---

## Step 3 — Set preferences (all members)

Each member (including the organizer) completes the 3-step preference flow:

1. **Sliders** — rate activities (hiking, nightlife, museums, beaches, adventure), food style, and logistics (pace, budget-consciousness, flight comfort) on a 1–10 scale.
2. **Constraints** — dietary restrictions, alcohol preference, hard budget cap (private), total budget (private), mobility limitations.
3. **AI chat** — the agent asks 2–4 targeted follow-up questions based on the slider settings to capture qualitative nuance. Tap **Done** or let it reach `[PREFERENCES_COMPLETE]`.

Progress shows on the dashboard. The organizer can see `3/5 ready`.

### Admin: nudge slow members

If someone hasn't finished after a day or two, the organizer can:
- **Set a submission deadline** in the admin panel — a date/time is displayed to all members as a reminder.
- Click **Nudge pending members** — the backend returns the list of pending members (email/push integration is a v1.1 feature; for MVP, share the group code link manually).

> **Minimum group size:** planning requires at least **3 members** with complete preferences (configurable via `MIN_PLANNING_GROUP_SIZE` env var).

---

## Step 4 — Lock preferences (organizer)

Once enough members are done:
1. Click **Lock preferences** on the dashboard.
2. Group status advances to **Budget Negotiation**.

---

## Step 5 — Budget negotiation

All members navigate to the **Budget** screen (or the organizer clicks the budget button):

1. The **Budget Bot** analyzes everyone's private budgets and proposes a group total (strategy: `consensus`, `tiered`, or `scope_reduction`). Individual budgets are never revealed.
2. Each member votes **Approve** or **Reject** (with an optional comment on reject).
3. If all approve → budget is locked automatically.
4. If some reject → the bot reads the pushback comments and re-proposes. Up to 3 rounds.
5. After consensus, the organizer clicks **Lock budget** → status advances to **Planning**.

---

## Step 6 — Generate the itinerary (organizer)

From the dashboard in **Planning** status:

1. Click **✨ Generate itinerary**.
2. The backend runs the full pipeline (~20–40s depending on group size):
   - **Wave 1 (parallel):** Activity, Food, Accommodation, Transportation agents each propose their section.
   - **Wave 2:** Budget agent reconciles costs. A **12% buffer** is applied to give agents headroom for estimate variance — agents plan against the buffered number; the real locked budget is used for compliance scoring.
   - **Wave 3:** Negotiation loop (up to 3 rounds) resolves conflicts (budget overruns, dietary violations, accessibility issues, schedule overruns).
   - **Consensus engine:** Pareto-filters candidate slates → picks the highest weighted-score option → enforces the **70% fairness floor** per member.
3. If consensus succeeds → group advances to **Complete** automatically.
4. If the fairness floor isn't met → the dashboard shows an **admin arbitration banner**. The organizer reviews and can click **Approve as-is** to override.

> **Estimate disclaimer:** all costs are AI estimates, not live pricing. Build in variance before booking.

---

## Step 7 — View the itinerary

All members can view the itinerary at `/group/:code/itinerary`:

| Tab | Contents |
|-----|----------|
| **Plan** | Day-by-day schedule (morning / afternoon / evening blocks), cost per block, which member preferences each block serves |
| **Budget** | Category breakdown (flights, accommodation, food, activities, transport), surplus/overrun vs locked budget |
| **Scores** | Per-member satisfaction % (Must Have + Nice to Have fulfilled), fairness score, floor indicator |
| **Tradeoffs** | Plain-language report: what the plan gets right, key tradeoffs, budget commentary, fairness notes |

Members can tap any score bar to expand and see exactly which must-haves were met or missed.

---

## Step 8 — Replan

If the organizer wants a different itinerary:
1. From the itinerary view, click **Generate a new itinerary (replan)**.
2. This triggers a fresh pipeline run; the result is saved as **Itinerary v2** (previous versions are preserved in the database).

---

## Error states

| Situation | What you see |
|-----------|--------------|
| Destination not set | `409` with clear message before generation starts |
| Fewer than 3 members with complete prefs | `409` with count and required number |
| No locked budget | `409` before generation |
| Agent returns malformed JSON | Automatic repair prompt to Claude; error only surfaces if both attempts fail |
| Consensus fails fairness floor | Admin arbitration banner on itinerary screen |
| Budget overrun after negotiation | Budget surplus shown in red; substitution suggestions listed |
| Group fetch fails | Error banner with retry option |
| 401 / expired session | Auto-redirect to login |

---

## Environment variables (backend)

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_MODEL` | `claude-haiku-4-5-20251001` | Model used for all planning agents |
| `MIN_PLANNING_GROUP_SIZE` | `3` | Minimum members with complete prefs before planning |
| `NEGOTIATION_MAX_ROUNDS` | `3` | Max conflict-resolution rounds before surfacing remaining conflicts |

---

## What's deferred to v1.1 / v2

See the checklist at the end of this document.

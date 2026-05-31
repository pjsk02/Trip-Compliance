# Graph Report - .  (2026-05-31)

## Corpus Check
- 75 files · ~50,000 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 426 nodes · 777 edges · 34 communities (19 shown, 15 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 20 edges (avg confidence: 0.89)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Planning Agents|Planning Agents]]
- [[_COMMUNITY_Backend Infrastructure|Backend Infrastructure]]
- [[_COMMUNITY_Frontend UI Components|Frontend UI Components]]
- [[_COMMUNITY_Preference & Slider Flow|Preference & Slider Flow]]
- [[_COMMUNITY_Itinerary & Feedback Pipeline|Itinerary & Feedback Pipeline]]
- [[_COMMUNITY_Preference Agent & Schema|Preference Agent & Schema]]
- [[_COMMUNITY_Frontend Type Definitions|Frontend Type Definitions]]
- [[_COMMUNITY_API Client Layer|API Client Layer]]
- [[_COMMUNITY_Itinerary Assembler|Itinerary Assembler]]
- [[_COMMUNITY_Consensus & Scoring|Consensus & Scoring]]
- [[_COMMUNITY_Negotiation Engine|Negotiation Engine]]
- [[_COMMUNITY_Group Auth & Identity|Group Auth & Identity]]
- [[_COMMUNITY_Express Router Mounts|Express Router Mounts]]
- [[_COMMUNITY_App Entry Points|App Entry Points]]
- [[_COMMUNITY_Shared Package Types|Shared Package Types]]
- [[_COMMUNITY_Prisma Seed|Prisma Seed]]
- [[_COMMUNITY_Migration Scripts|Migration Scripts]]
- [[_COMMUNITY_ApiError Class|ApiError Class]]
- [[_COMMUNITY_Token Management|Token Management]]
- [[_COMMUNITY_Coverage Type Mirror|Coverage Type Mirror]]
- [[_COMMUNITY_Infrastructure Config|Infrastructure Config]]
- [[_COMMUNITY_ClaudeGraphify Config|Claude/Graphify Config]]
- [[_COMMUNITY_Anthropic SDK|Anthropic SDK]]
- [[_COMMUNITY_Shared API Response|Shared API Response]]
- [[_COMMUNITY_Permissions Allowlist|Permissions Allowlist]]
- [[_COMMUNITY_isComplete Helper|isComplete Helper]]
- [[_COMMUNITY_PreferenceProfileData|PreferenceProfileData]]
- [[_COMMUNITY_Itinerary Type|Itinerary Type]]
- [[_COMMUNITY_BudgetRound Type|BudgetRound Type]]
- [[_COMMUNITY_Shared Package|Shared Package]]

## God Nodes (most connected - your core abstractions)
1. `PlanningContext` - 19 edges
2. `PreferenceChat Page` - 13 edges
3. `BaseAgent` - 12 edges
4. `MemberPreferenceSnapshot` - 12 edges
5. `contextSummary()` - 11 edges
6. `groupMean()` - 11 edges
7. `runOrchestrator()` - 10 edges
8. `ActivityProposal` - 10 edges
9. `Dashboard Page` - 10 edges
10. `API Client (client.ts)` - 10 edges

## Surprising Connections (you probably didn't know these)
- `Shared Trip Type` --semantically_similar_to--> `Group Type`  [INFERRED] [semantically similar]
  packages/shared/src/index.ts → apps/frontend/src/types/index.ts
- `Shared User Type` --semantically_similar_to--> `Member Type`  [INFERRED] [semantically similar]
  packages/shared/src/index.ts → apps/frontend/src/types/index.ts
- `Graphify PreToolUse Hook` --conceptually_related_to--> `Graphify Query Rules (CLAUDE.md)`  [INFERRED]
  .claude/settings.json → CLAUDE.md
- `Frontend Entry HTML` --conceptually_related_to--> `Landing Page`  [INFERRED]
  apps/frontend/index.html → apps/frontend/src/App.tsx
- `main()` --calls--> `runOrchestrator()`  [EXTRACTED]
  apps/backend/scripts/test-itinerary-pipeline.ts → apps/backend/src/lib/planning/orchestrator.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Group Auth Flow (Create/Join → JWT → Authenticate Middleware)** — groups_router, lib_jwt, middleware_auth [EXTRACTED 1.00]
- **Frontend Auth-Gated Routing (App.tsx + AuthContext + RequireAuth guard)** — frontend_app_tsx, context_auth, page_dashboard [EXTRACTED 0.95]
- **Auth Token Lifecycle: client storage, AuthContext state, session rehydration** — client_settoken, context_authcontext, types_session [EXTRACTED 0.95]
- **Group Onboarding Flow: landing, create group, join group, dashboard** — page_landing, page_creategroup, page_joingroup, page_dashboard [INFERRED 0.95]
- **Hybrid Preference Collection Pipeline (Sliders + AI Chat + Review + Finalize)** — sliderpanel_component, preferenceagent_chatTurn, preferencereview_component, members_finalize_endpoint [INFERRED 0.90]
- **Priority Derivation Logic Kept in Sync Across Frontend and Backend** — sliderpanel_derivePriorities, preferenceschema_derivePriorities, frontend_types_PreferenceProfileData [INFERRED 0.85]
- **Shared Preference Schema Contract Between Frontend Types and Backend Zod Schemas** — frontend_types_SliderValues, frontend_types_ConstraintFields, preferenceschema_SliderValuesSchema, preferenceschema_ConstraintFieldsSchema [INFERRED 0.90]
- **Auth Token Lifecycle: client storage, AuthContext state, session rehydration** — client_settoken, context_authcontext, types_session [EXTRACTED 0.95]
- **Preference Collection Flow: chat UI, category tracking, review/confirm** — page_preferencechat, component_categoryprogress, component_preferencereview [EXTRACTED 0.95]
- **Group Onboarding Flow: landing, create group, join group, dashboard** — page_landing, page_creategroup, page_joingroup, page_dashboard [INFERRED 0.95]

## Communities (34 total, 15 thin omitted)

### Community 0 - "Planning Agents"
Cohesion: 0.09
Nodes (32): AccommodationAgent, ActivityAgent, BudgetAgent, BudgetAgentInput, FoodAgent, TransportationAgent, BaseAgent, contextSummary() (+24 more)

### Community 1 - "Backend Infrastructure"
Cohesion: 0.08
Nodes (38): analyzeBudgets(), BudgetAnalysis, BudgetInput, client, model(), parseAnalysisResponse(), reproposeBudget(), ReproposeInput (+30 more)

### Community 2 - "Frontend UI Components"
Cohesion: 0.07
Nodes (45): API Client (client.ts), ApiError Class, getToken Function, setToken Function, Token Storage Strategy (sessionStorage over localStorage), Button Component, CategoryProgress Component, ChatBubble Component (+37 more)

### Community 3 - "Preference & Slider Flow"
Cohesion: 0.07
Nodes (39): api.finalizePreferences Method, api.saveSliders Method, api.sendChat Method, ConstraintFields Type (Frontend), SliderValues Type (Frontend), StepCoverage Type (Frontend), Hybrid Slider + AI Chat Preference Flow, POST /members/:id/chat (+31 more)

### Community 4 - "Itinerary & Feedback Pipeline"
Cohesion: 0.08
Nodes (33): ConstraintFields, PreferencePriorities, PreferenceScores, classifyFeedback(), getClient(), model(), AccommodationOption, AccommodationOptionSchema (+25 more)

### Community 5 - "Preference Agent & Schema"
Cohesion: 0.12
Nodes (22): buildChatSystemPrompt(), chatTurn(), client, COVERAGE_KEYWORDS, detectCoverage(), extractChatNuance(), extractPreferences(), model() (+14 more)

### Community 6 - "Frontend Type Definitions"
Cohesion: 0.07
Nodes (26): AlcoholPreference, BudgetBreakdown, BudgetBreakdownLine, BudgetStrategy, BudgetTierSplit, BudgetVoteRecord, CategoryCoverage, ChatMessageData (+18 more)

### Community 7 - "API Client Layer"
Cohesion: 0.08
Nodes (21): api, _memberToken, _userToken, BudgetRound, BudgetStateResponse, ChatHistoryResponse, ChatResponse, ConstraintFields (+13 more)

### Community 8 - "Itinerary Assembler"
Cohesion: 0.12
Nodes (22): activityToBlock(), anthropic, assembleItinerary(), BudgetBreakdown, BudgetLine, buildBudgetBreakdown(), buildDayTheme(), buildSatisfactionScores() (+14 more)

### Community 9 - "Consensus & Scoring"
Cohesion: 0.14
Nodes (21): buildSummary(), ConsensusInput, ConsensusResult, ConsensusStatus, runConsensus(), ActivityCandidate, CATEGORY_TO_LABELS, ItineraryCandidate (+13 more)

### Community 10 - "Negotiation Engine"
Cohesion: 0.22
Nodes (13): anthropic, Conflict, ConflictType, DEFAULT_MAX_ROUNDS, detectConflicts(), model(), negotiate(), NegotiationRound (+5 more)

### Community 11 - "Group Auth & Identity"
Cohesion: 0.33
Nodes (9): Group Status State Machine (COLLECTING → BUDGET_NEGOTIATION → PLANNING → COMPLETE), JWT-Based Member Identity (memberId, groupId, isAdmin), Groups Router, Groups Integration Tests, Group Code Generator, JWT Sign/Verify Utilities, Prisma Singleton Client, Authentication Middleware (authenticate, requireAdmin) (+1 more)

### Community 12 - "Express Router Mounts"
Cohesion: 0.33
Nodes (6): Express App Entry Point, authRouter Mount, budgetRouter Mount, groupsRouter Mount, itineraryRouter Mount, membersRouter Mount

### Community 13 - "App Entry Points"
Cohesion: 0.50
Nodes (4): Backend Application (@tripsync/backend), Frontend Application (@tripsync/frontend), Vite Config with API Proxy, TripSync AI Monorepo

### Community 14 - "Shared Package Types"
Cohesion: 0.50
Nodes (3): ApiResponse, Trip, User

## Knowledge Gaps
- **133 isolated node(s):** `prisma`, `prisma`, `prisma`, `client`, `BudgetInput` (+128 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ConstraintFields` connect `Itinerary & Feedback Pipeline` to `Backend Infrastructure`, `Preference Agent & Schema`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `PlanningContext` connect `Planning Agents` to `Itinerary Assembler`, `Negotiation Engine`, `Itinerary & Feedback Pipeline`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Why does `MemberPreferenceSnapshot` connect `Itinerary & Feedback Pipeline` to `Planning Agents`, `Consensus & Scoring`, `Backend Infrastructure`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **What connects `prisma`, `prisma`, `prisma` to the rest of the system?**
  _142 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Planning Agents` be split into smaller, more focused modules?**
  _Cohesion score 0.08587570621468926 - nodes in this community are weakly interconnected._
- **Should `Backend Infrastructure` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Frontend UI Components` be split into smaller, more focused modules?**
  _Cohesion score 0.07171717171717172 - nodes in this community are weakly interconnected._
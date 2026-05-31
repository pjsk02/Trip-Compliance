# Graph Report - .  (2026-05-31)

## Corpus Check
- Corpus is ~40,413 words - fits in a single context window. You may not need a graph.

## Summary
- 595 nodes · 1074 edges · 32 communities (26 shown, 6 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Trip Planning Agents|Trip Planning Agents]]
- [[_COMMUNITY_Preference & Itinerary Pipeline|Preference & Itinerary Pipeline]]
- [[_COMMUNITY_Backend Core (AuthBudgetGroups)|Backend Core (Auth/Budget/Groups)]]
- [[_COMMUNITY_Backend Dependencies|Backend Dependencies]]
- [[_COMMUNITY_Consensus & Scoring Engine|Consensus & Scoring Engine]]
- [[_COMMUNITY_Frontend UI Components|Frontend UI Components]]
- [[_COMMUNITY_Itinerary View Page|Itinerary View Page]]
- [[_COMMUNITY_Frontend API Client|Frontend API Client]]
- [[_COMMUNITY_Frontend Package Config|Frontend Package Config]]
- [[_COMMUNITY_Frontend TypeScript Config|Frontend TypeScript Config]]
- [[_COMMUNITY_App Routing & Landing|App Routing & Landing]]
- [[_COMMUNITY_Backend TypeScript Config|Backend TypeScript Config]]
- [[_COMMUNITY_Semantic Preference Layer|Semantic Preference Layer]]
- [[_COMMUNITY_Shared Package Config|Shared Package Config]]
- [[_COMMUNITY_Shared TypeScript Config|Shared TypeScript Config]]
- [[_COMMUNITY_Dashboard & Status UI|Dashboard & Status UI]]
- [[_COMMUNITY_Budget Negotiation UI|Budget Negotiation UI]]
- [[_COMMUNITY_Root Monorepo Config|Root Monorepo Config]]
- [[_COMMUNITY_Group Creation & Auth UI|Group Creation & Auth UI]]
- [[_COMMUNITY_Auth Context|Auth Context]]
- [[_COMMUNITY_Home & Membership Types|Home & Membership Types]]
- [[_COMMUNITY_Shared Type Definitions|Shared Type Definitions]]
- [[_COMMUNITY_Prisma DB Seed|Prisma DB Seed]]
- [[_COMMUNITY_User Backfill Script|User Backfill Script]]
- [[_COMMUNITY_Claude Hooks Config|Claude Hooks Config]]
- [[_COMMUNITY_Claude Local Permissions|Claude Local Permissions]]
- [[_COMMUNITY_GraphifyClaude Docs|Graphify/Claude Docs]]
- [[_COMMUNITY_Local Permissions|Local Permissions]]

## God Nodes (most connected - your core abstractions)
1. `useAuth()` - 21 edges
2. `PlanningContext` - 19 edges
3. `compilerOptions` - 16 edges
4. `BaseAgent` - 12 edges
5. `MemberPreferenceSnapshot` - 12 edges
6. `compilerOptions` - 12 edges
7. `compilerOptions` - 11 edges
8. `contextSummary()` - 11 edges
9. `groupMean()` - 11 edges
10. `runOrchestrator()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `Graphify Project Instructions (CLAUDE.md)` --conceptually_related_to--> `Claude Code Project Settings`  [INFERRED]
  CLAUDE.md → .claude/settings.json
- `Preference Schema (Zod Validators + Derivation)` --conceptually_related_to--> `@tripsync/shared Package`  [INFERRED]
  apps/backend/src/lib/preferenceSchema.ts → packages/shared/package.json
- `Frontend Shared TypeScript Types` --conceptually_related_to--> `@tripsync/shared Package`  [INFERRED]
  apps/frontend/src/types/index.ts → packages/shared/package.json
- `SliderPanel Component` --semantically_similar_to--> `Preference Schema (Zod Validators + Derivation)`  [INFERRED] [semantically similar]
  apps/frontend/src/components/SliderPanel.tsx → apps/backend/src/lib/preferenceSchema.ts
- `Frontend Shared TypeScript Types` --semantically_similar_to--> `Preference Schema (Zod Validators + Derivation)`  [INFERRED] [semantically similar]
  apps/frontend/src/types/index.ts → apps/backend/src/lib/preferenceSchema.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **End-to-End Preference Collection Pipeline** — frontend_sliderPanel, frontend_preferenceChat, frontend_apiClient, backend_membersRouter, backend_preferenceAgent, backend_preferenceSchema [INFERRED 0.95]
- **Hybrid Slider + AI Chat UX Pattern** — frontend_sliderPanel, frontend_stepProgress, frontend_preferenceReview, frontend_preferenceChat [INFERRED 0.95]
- **Frontend/Backend Preference Schema Parity** — frontend_types, backend_preferenceSchema, frontend_sliderPanel [INFERRED 0.85]

## Communities (32 total, 6 thin omitted)

### Community 0 - "Trip Planning Agents"
Cohesion: 0.06
Nodes (59): AccommodationAgent, ActivityAgent, BudgetAgent, BudgetAgentInput, FoodAgent, TransportationAgent, BaseAgent, contextSummary() (+51 more)

### Community 1 - "Preference & Itinerary Pipeline"
Cohesion: 0.06
Nodes (41): buildChatSystemPrompt(), chatTurn(), client, COVERAGE_KEYWORDS, detectCoverage(), extractChatNuance(), extractPreferences(), model() (+33 more)

### Community 2 - "Backend Core (Auth/Budget/Groups)"
Cohesion: 0.08
Nodes (39): analyzeBudgets(), BudgetAnalysis, BudgetInput, client, model(), parseAnalysisResponse(), reproposeBudget(), ReproposeInput (+31 more)

### Community 3 - "Backend Dependencies"
Cohesion: 0.04
Nodes (47): dependencies, @anthropic-ai/sdk, bcrypt, cors, dotenv, express, google-auth-library, jsonwebtoken (+39 more)

### Community 4 - "Consensus & Scoring Engine"
Cohesion: 0.07
Nodes (42): buildSummary(), ConsensusInput, ConsensusResult, ConsensusStatus, runConsensus(), activityToBlock(), anthropic, assembleItinerary() (+34 more)

### Community 5 - "Frontend UI Components"
Cohesion: 0.06
Nodes (32): Button(), Props, Variant, variants, ChatBubble(), Props, TypingBubble(), CopyCard() (+24 more)

### Community 6 - "Itinerary View Page"
Cohesion: 0.07
Nodes (21): BLOCK_ICONS, BlockCard(), BudgetRow(), BudgetSection(), CATEGORY_ICONS, DayCard(), FEEDBACK_EXAMPLES, FEEDBACK_TYPE_LABELS (+13 more)

### Community 7 - "Frontend API Client"
Cohesion: 0.10
Nodes (24): _memberToken, setUserToken(), _userToken, CATEGORIES, BudgetBreakdown, BudgetStrategy, BudgetTierSplit, CategoryCoverage (+16 more)

### Community 8 - "Frontend Package Config"
Cohesion: 0.08
Nodes (23): dependencies, react, react-dom, @react-oauth/google, react-router-dom, @tripsync/shared, devDependencies, autoprefixer (+15 more)

### Community 9 - "Frontend TypeScript Config"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+9 more)

### Community 10 - "App Routing & Landing"
Cohesion: 0.25
Nodes (11): useAuth(), BudgetNegotiation(), Dashboard(), Home(), ItineraryView(), JoinGroup(), Landing(), PreferenceChat() (+3 more)

### Community 11 - "Backend TypeScript Config"
Cohesion: 0.14
Nodes (13): compilerOptions, esModuleInterop, lib, module, outDir, resolveJsonModule, rootDir, skipLibCheck (+5 more)

### Community 12 - "Semantic Preference Layer"
Cohesion: 0.24
Nodes (14): Backend Express Entry Point, Members API Router (Slider/Chat/Finalize), Preference Agent (LLM Chat + Extraction), Preference Schema (Zod Validators + Derivation), Frontend API Client, PreferenceChat Page (Hybrid Slider+Chat), PreferenceReview Component, SliderPanel Component (+6 more)

### Community 13 - "Shared Package Config"
Cohesion: 0.15
Nodes (13): devDependencies, typescript, exports, import, main, name, private, require (+5 more)

### Community 14 - "Shared TypeScript Config"
Cohesion: 0.14
Nodes (13): compilerOptions, declaration, declarationMap, esModuleInterop, lib, module, outDir, rootDir (+5 more)

### Community 15 - "Dashboard & Status UI"
Cohesion: 0.18
Nodes (8): Spinner(), config, StatusBadge(), STATUS_LABELS, STATUS_STEPS, Group, GroupStatus, PreferenceStatus

### Community 16 - "Budget Negotiation UI"
Cohesion: 0.23
Nodes (8): BudgetProposalCard(), fmt(), Props, STRATEGY_LABEL, BudgetRound, BudgetStateResponse, BudgetVoteRecord, VoteChoice

### Community 17 - "Root Monorepo Config"
Cohesion: 0.15
Nodes (12): devDependencies, concurrently, name, private, scripts, build, db:down, db:migrate (+4 more)

### Community 18 - "Group Creation & Auth UI"
Cohesion: 0.27
Nodes (7): api, ApiError, Input, Props, CreateGroup(), randomPassword(), CreateGroupResponse

### Community 19 - "Auth Context"
Cohesion: 0.29
Nodes (8): getToken(), setToken(), AuthContext, AuthContextValue, AuthProvider(), loadGroupSession(), Session, UserSession

### Community 20 - "Home & Membership Types"
Cohesion: 0.40
Nodes (4): PREF_COLOR, PREF_LABEL, STATUS_LABEL, Membership

### Community 21 - "Shared Type Definitions"
Cohesion: 0.50
Nodes (3): ApiResponse, Trip, User

## Knowledge Gaps
- **229 isolated node(s):** `name`, `private`, `workspaces`, `dev`, `build` (+224 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ConstraintFields` connect `Preference & Itinerary Pipeline` to `Trip Planning Agents`, `Backend Core (Auth/Budget/Groups)`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Why does `PlanningContext` connect `Trip Planning Agents` to `Preference & Itinerary Pipeline`, `Consensus & Scoring Engine`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **Why does `useAuth()` connect `App Routing & Landing` to `Frontend UI Components`, `Itinerary View Page`, `Dashboard & Status UI`, `Budget Negotiation UI`, `Group Creation & Auth UI`, `Auth Context`, `Home & Membership Types`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **What connects `name`, `private`, `workspaces` to the rest of the system?**
  _231 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Trip Planning Agents` be split into smaller, more focused modules?**
  _Cohesion score 0.058823529411764705 - nodes in this community are weakly interconnected._
- **Should `Preference & Itinerary Pipeline` be split into smaller, more focused modules?**
  _Cohesion score 0.06219426974143955 - nodes in this community are weakly interconnected._
- **Should `Backend Core (Auth/Budget/Groups)` be split into smaller, more focused modules?**
  _Cohesion score 0.07764705882352942 - nodes in this community are weakly interconnected._
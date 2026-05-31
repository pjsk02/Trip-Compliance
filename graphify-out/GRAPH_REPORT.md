# Graph Report - .  (2026-05-31)

## Corpus Check
- Corpus is ~11,081 words - fits in a single context window. You may not need a graph.

## Summary
- 353 nodes · 484 edges · 22 communities (17 shown, 5 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.78)
- Token cost: 6,800 input · 1,200 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Frontend UI & Types|Frontend UI & Types]]
- [[_COMMUNITY_Backend Package Config|Backend Package Config]]
- [[_COMMUNITY_Frontend Pages & Components|Frontend Pages & Components]]
- [[_COMMUNITY_Frontend Dev Dependencies|Frontend Dev Dependencies]]
- [[_COMMUNITY_Backend Core & Auth|Backend Core & Auth]]
- [[_COMMUNITY_AI Preference Agent|AI Preference Agent]]
- [[_COMMUNITY_Prisma Schema & DB|Prisma Schema & DB]]
- [[_COMMUNITY_Backend Routes|Backend Routes]]
- [[_COMMUNITY_Shared Package|Shared Package]]
- [[_COMMUNITY_Docker & Infra|Docker & Infra]]
- [[_COMMUNITY_Test Suite|Test Suite]]
- [[_COMMUNITY_Monorepo Root Config|Monorepo Root Config]]
- [[_COMMUNITY_JWT & Identity|JWT & Identity]]
- [[_COMMUNITY_Group Code Logic|Group Code Logic]]
- [[_COMMUNITY_Preference Schema|Preference Schema]]
- [[_COMMUNITY_Claude.md & Settings|Claude.md & Settings]]
- [[_COMMUNITY_Frontend Build Config|Frontend Build Config]]
- [[_COMMUNITY_Frontend Vite Proxy|Frontend Vite Proxy]]
- [[_COMMUNITY_Frontend PostCSSTailwind|Frontend PostCSS/Tailwind]]

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 16 edges
2. `PreferenceChat Page` - 13 edges
3. `useAuth()` - 12 edges
4. `compilerOptions` - 12 edges
5. `compilerOptions` - 11 edges
6. `Dashboard Page` - 10 edges
7. `API Client (client.ts)` - 10 edges
8. `scripts` - 8 edges
9. `AI Preference Agent (Claude)` - 8 edges
10. `CreateGroup Page` - 8 edges

## Surprising Connections (you probably didn't know these)
- `Shared Trip Type` --semantically_similar_to--> `Group Type`  [INFERRED] [semantically similar]
  packages/shared/src/index.ts → apps/frontend/src/types/index.ts
- `Shared User Type` --semantically_similar_to--> `Member Type`  [INFERRED] [semantically similar]
  packages/shared/src/index.ts → apps/frontend/src/types/index.ts
- `PreferenceChat Page` --semantically_similar_to--> `AI Preference Collection Flow (Chat → Extract → Profile)`  [INFERRED] [semantically similar]
  apps/frontend/src/App.tsx → apps/backend/src/lib/preferenceAgent.ts
- `Frontend Entry HTML` --conceptually_related_to--> `Landing Page`  [INFERRED]
  apps/frontend/index.html → apps/frontend/src/App.tsx
- `TripSync AI Monorepo` --references--> `Backend Application (@tripsync/backend)`  [EXTRACTED]
  package.json → apps/backend/package.json

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **AI Preference Collection Pipeline (Agent → Chat Route → Finalize → PreferenceProfile)** — lib_preferenceagent, members_router, lib_preferenceschema [EXTRACTED 1.00]
- **Group Auth Flow (Create/Join → JWT → Authenticate Middleware)** — groups_router, lib_jwt, middleware_auth [EXTRACTED 1.00]
- **Frontend Auth-Gated Routing (App.tsx + AuthContext + RequireAuth guard)** — frontend_app_tsx, context_auth, page_dashboard [EXTRACTED 0.95]
- **Auth Token Lifecycle: client storage, AuthContext state, session rehydration** — client_settoken, context_authcontext, types_session [EXTRACTED 0.95]
- **Preference Collection Flow: chat UI, category tracking, review/confirm** — page_preferencechat, component_categoryprogress, component_preferencereview [EXTRACTED 0.95]
- **Group Onboarding Flow: landing, create group, join group, dashboard** — page_landing, page_creategroup, page_joingroup, page_dashboard [INFERRED 0.95]

## Communities (22 total, 5 thin omitted)

### Community 0 - "Frontend UI & Types"
Cohesion: 0.05
Nodes (54): api, ApiError, getToken(), setToken(), _token, Button(), Props, Variant (+46 more)

### Community 1 - "Backend Package Config"
Cohesion: 0.04
Nodes (44): dependencies, @anthropic-ai/sdk, bcrypt, cors, dotenv, express, jsonwebtoken, nanoid (+36 more)

### Community 2 - "Frontend Pages & Components"
Cohesion: 0.07
Nodes (45): API Client (client.ts), ApiError Class, getToken Function, setToken Function, Token Storage Strategy (sessionStorage over localStorage), Button Component, CategoryProgress Component, ChatBubble Component (+37 more)

### Community 3 - "Frontend Dev Dependencies"
Cohesion: 0.09
Nodes (22): dependencies, react, react-dom, react-router-dom, @tripsync/shared, devDependencies, autoprefixer, postcss (+14 more)

### Community 4 - "Backend Core & Auth"
Cohesion: 0.15
Nodes (16): DESTINATIONS, digits, generateUniqueGroupCode(), secret(), signToken(), TokenPayload, verifyToken(), globalForPrisma (+8 more)

### Community 5 - "AI Preference Agent"
Cohesion: 0.13
Nodes (15): chatTurn(), client, COVERAGE_KEYWORDS, detectCoverage(), extractPreferences(), model(), CategoryCoverage, PreferencePriorities (+7 more)

### Community 6 - "Prisma Schema & DB"
Cohesion: 0.14
Nodes (21): Anthropic Claude SDK (@anthropic-ai/sdk), Express Server Entry Point, CategoryCoverage (activities, food, logistics, constraints), Chat System Prompt (4-category preference gathering), Claude Haiku Model (claude-haiku-4-5-20251001), Group Status State Machine (COLLECTING → BUDGET_NEGOTIATION → PLANNING → COMPLETE), JWT-Based Member Identity (memberId, groupId, isAdmin), AI Preference Collection Flow (Chat → Extract → Profile) (+13 more)

### Community 7 - "Backend Routes"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+9 more)

### Community 8 - "Shared Package"
Cohesion: 0.14
Nodes (13): compilerOptions, esModuleInterop, lib, module, outDir, resolveJsonModule, rootDir, skipLibCheck (+5 more)

### Community 9 - "Docker & Infra"
Cohesion: 0.15
Nodes (13): devDependencies, typescript, exports, import, main, name, private, require (+5 more)

### Community 10 - "Test Suite"
Cohesion: 0.14
Nodes (13): compilerOptions, declaration, declarationMap, esModuleInterop, lib, module, outDir, rootDir (+5 more)

### Community 11 - "Monorepo Root Config"
Cohesion: 0.15
Nodes (12): devDependencies, concurrently, name, private, scripts, build, db:down, db:migrate (+4 more)

### Community 12 - "JWT & Identity"
Cohesion: 0.50
Nodes (4): Backend Application (@tripsync/backend), Frontend Application (@tripsync/frontend), Vite Config with API Proxy, TripSync AI Monorepo

### Community 13 - "Group Code Logic"
Cohesion: 0.50
Nodes (3): ApiResponse, Trip, User

## Knowledge Gaps
- **171 isolated node(s):** `name`, `private`, `workspaces`, `dev`, `build` (+166 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What connects `name`, `private`, `workspaces` to the rest of the system?**
  _178 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Frontend UI & Types` be split into smaller, more focused modules?**
  _Cohesion score 0.05322947095098994 - nodes in this community are weakly interconnected._
- **Should `Backend Package Config` be split into smaller, more focused modules?**
  _Cohesion score 0.044444444444444446 - nodes in this community are weakly interconnected._
- **Should `Frontend Pages & Components` be split into smaller, more focused modules?**
  _Cohesion score 0.07171717171717172 - nodes in this community are weakly interconnected._
- **Should `Frontend Dev Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._
- **Should `AI Preference Agent` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._
- **Should `Prisma Schema & DB` be split into smaller, more focused modules?**
  _Cohesion score 0.1380952380952381 - nodes in this community are weakly interconnected._
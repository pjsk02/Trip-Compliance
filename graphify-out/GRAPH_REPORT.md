# Graph Report - d:\vsc\NEU\Trip  (2026-05-31)

## Corpus Check
- Corpus is ~14,985 words - fits in a single context window. You may not need a graph.

## Summary
- 320 nodes · 446 edges · 22 communities (18 shown, 4 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 3 edges (avg confidence: 0.9)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 21|Community 21]]

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 16 edges
2. `useAuth()` - 12 edges
3. `compilerOptions` - 12 edges
4. `compilerOptions` - 11 edges
5. `scripts` - 8 edges
6. `scripts` - 7 edges
7. `Button()` - 7 edges
8. `ApiError` - 6 edges
9. `api` - 5 edges
10. `PreferenceProfileData` - 5 edges

## Surprising Connections (you probably didn't know these)
- `RequireAuth()` --calls--> `useAuth()`  [EXTRACTED]
  apps/frontend/src/App.tsx → apps/frontend/src/context/AuthContext.tsx
- `AppRoutes()` --calls--> `useAuth()`  [EXTRACTED]
  apps/frontend/src/App.tsx → apps/frontend/src/context/AuthContext.tsx
- `Props` --references--> `PreferenceProfileData`  [EXTRACTED]
  apps/frontend/src/components/PreferenceReview.tsx → apps/frontend/src/types/index.ts
- `API Client` --references--> `Members Router`  [INFERRED]
  apps/frontend/src/api/client.ts → apps/backend/src/routes/members.ts
- `Preference Chat UI` --calls--> `API Client`  [INFERRED]
  apps/frontend/src/pages/PreferenceChat.tsx → apps/frontend/src/api/client.ts

## Import Cycles
- None detected.

## Communities (22 total, 4 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (37): _token, CATEGORIES, ChatBubble(), Props, TypingBubble(), PreferenceReview(), PRIORITY_STYLES, PriorityBucket (+29 more)

### Community 1 - "Community 1"
Cohesion: 0.09
Nodes (26): api, ApiError, Button(), Props, Variant, variants, CopyCard(), Props (+18 more)

### Community 2 - "Community 2"
Cohesion: 0.11
Nodes (25): buildChatSystemPrompt(), chatTurn(), client, COVERAGE_KEYWORDS, detectCoverage(), extractChatNuance(), extractPreferences(), model() (+17 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (29): dependencies, @anthropic-ai/sdk, bcrypt, cors, dotenv, express, jsonwebtoken, nanoid (+21 more)

### Community 4 - "Community 4"
Cohesion: 0.09
Nodes (22): dependencies, react, react-dom, react-router-dom, @tripsync/shared, devDependencies, autoprefixer, postcss (+14 more)

### Community 5 - "Community 5"
Cohesion: 0.15
Nodes (16): DESTINATIONS, digits, generateUniqueGroupCode(), secret(), signToken(), TokenPayload, verifyToken(), globalForPrisma (+8 more)

### Community 6 - "Community 6"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+9 more)

### Community 7 - "Community 7"
Cohesion: 0.13
Nodes (15): devDependencies, jest, prisma, supertest, ts-jest, ts-node, ts-node-dev, @types/bcrypt (+7 more)

### Community 8 - "Community 8"
Cohesion: 0.14
Nodes (13): compilerOptions, esModuleInterop, lib, module, outDir, resolveJsonModule, rootDir, skipLibCheck (+5 more)

### Community 9 - "Community 9"
Cohesion: 0.14
Nodes (13): compilerOptions, declaration, declarationMap, esModuleInterop, lib, module, outDir, rootDir (+5 more)

### Community 10 - "Community 10"
Cohesion: 0.15
Nodes (13): devDependencies, typescript, exports, import, main, name, private, require (+5 more)

### Community 11 - "Community 11"
Cohesion: 0.15
Nodes (12): devDependencies, concurrently, name, private, scripts, build, db:down, db:migrate (+4 more)

### Community 12 - "Community 12"
Cohesion: 0.36
Nodes (7): getToken(), setToken(), AuthContext, AuthContextValue, AuthProvider(), loadInitialSession(), Session

### Community 13 - "Community 13"
Cohesion: 0.40
Nodes (6): API Client, Auth Context, Members Router, Preference Agent, Preference Chat UI, Preference Schema

### Community 14 - "Community 14"
Cohesion: 0.50
Nodes (3): ApiResponse, Trip, User

## Knowledge Gaps
- **160 isolated node(s):** `name`, `private`, `workspaces`, `dev`, `build` (+155 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `devDependencies` connect `Community 7` to `Community 3`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `name`, `private`, `workspaces` to the rest of the system?**
  _160 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06313497822931785 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.08658536585365853 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.10752688172043011 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.06666666666666667 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._
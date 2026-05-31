# TripSync AI

Multi-agent group travel planning platform.

## Prerequisites

- Node.js 20+
- npm 10+
- Docker + Docker Compose

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — at minimum set ANTHROPIC_API_KEY
```

### 3. Start Postgres

```bash
npm run db:up
```

### 4. Run migrations

```bash
npm run db:migrate
```

### 5. Start dev servers

```bash
npm run dev
```

This starts both servers concurrently:

| Service  | URL                    |
|----------|------------------------|
| Backend  | http://localhost:3001  |
| Frontend | http://localhost:5173  |

## Other commands

| Command            | Description                        |
|--------------------|------------------------------------|
| `npm run db:down`  | Stop Postgres container            |
| `npm run db:studio`| Open Prisma Studio                 |
| `npm run build`    | Build all packages and apps        |

## Structure

```
apps/
  backend/   Express + TypeScript + Prisma + Anthropic SDK
  frontend/  React + TypeScript + Vite + Tailwind
packages/
  shared/    Shared TypeScript types consumed by both apps
```

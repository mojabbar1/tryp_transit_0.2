## GPT Deployment Plan — Fastest, Cheapest Demo (No Breaking Changes)

Generated: 2025-08-10 23:58:59

Goal: Get a public demo online with minimal work and zero risky code edits.

Tracks:
- Track A (fastest/cheapest): Vercel hosts only Next.js app; use free managed Postgres; skip ML or point to remote ML later.
- Track B (full stack, still cheap): One $5 VPS or Render/Fly.io using docker-compose (web + Postgres + optional ML).

---

### Track A — Vercel (Next.js only) + Free Postgres (Neon or Vercel Postgres)

Feasibility: Yes, with no code changes. Python ML won’t run on Vercel; for demo either disable ML-dependent features or rely on existing fallbacks.

Steps
1) Create a free Postgres
- Neon: create project; copy pooled connection string (SSL required)
- OR Vercel Postgres: add integration; copy `DATABASE_URL`

2) Configure Vercel project
- Import GitHub repo into Vercel
- Build settings: autodetect (Next.js)
- Root directory: repo root

3) Set environment variables (Project Settings → Environment Variables)
- DATABASE_URL: your Neon/Vercel Postgres URL (use pooling; add `?sslmode=require` if Neon)
- NEXT_PUBLIC_TOMTOM_API_KEY: your TomTom key (client-side)
- Optional AI provider keys (only if you want live AI): GOOGLE_GEMINI_API_KEY or OPENAI_API_KEY
- Optional: DEMO_MODE=true (prefer deterministic fallbacks if implemented)
- Optional: RIDERSHIP_API_BASE_URL (only if you later host ML elsewhere)

4) First deploy
- Vercel will build and deploy automatically
- Run DB migrations and seed from your laptop targeting the managed DB:
  - npx prisma migrate deploy
  - node src/prisma/seed.ts (or appropriate seed command)

5) Smoke checks
- Visit /api/test-env to confirm env load
- Verify core demo endpoints: /api/rewards/[userId], /api/complete-trip

Notes / Troubleshooting
- Prisma binary target issue on Vercel: if encountered, add to `generator client` in `schema.prisma`:
  - `binaryTargets = ["native", "debian-openssl-3.0.x"]` and redeploy
- ML service: not supported on Vercel. To include ML, deploy it separately (Track B) and set `RIDERSHIP_API_BASE_URL` to that external URL.

---

### Track B — Full Stack on a $5 VPS (docker-compose)

Overview: Use `deploy/docker-compose.yml` and `deploy/Dockerfile.web` to run web + Postgres (+ optional ML) on a single VM. No code changes to the app.

Prereqs
- A small VPS (Hetzner/DO/Linode) with Docker and Docker Compose v2 installed
- DNS pointing to the VPS (optional, for HTTPS via reverse proxy)

Files created (non-invasive)
- deploy/docker-compose.yml
- deploy/Dockerfile.web
- deploy/.env.example.vercel (for Vercel reference)
- deploy/README.md (step-by-step)
- deploy/vercel.json (template only; not used by Vercel unless placed at repo root)

Steps
1) Copy `deploy/` folder to your VPS alongside the repo
2) Create a `.env` from the example with real values or pass env inline
3) Build and run
   - docker compose -f deploy/docker-compose.yml build
   - docker compose -f deploy/docker-compose.yml up -d
4) Migrate and seed
   - docker compose -f deploy/docker-compose.yml exec web npx prisma migrate deploy
   - docker compose -f deploy/docker-compose.yml exec web node src/prisma/seed.js (or seed.ts if configured)
5) Access the site at http://<server-ip>:3000

Notes / Options
- Reverse proxy (Caddy or Traefik) can sit in front for HTTPS; see deploy/README.md for examples.
- ML service is optional; remove it from compose if not needed. If included, app can call it via `RIDERSHIP_API_BASE_URL=http://ml:5001`.

---

### Track B Alternatives — Managed free/cheap platforms

- Render (free tiers with cold starts)
  - One Web Service for Next.js, one Web Service for Flask ML, free Postgres
  - Cold starts on free tier; simplest DX

- Fly.io (low-cost, often ~$0–$5)
  - Apps per service (web, ML, volume-backed Postgres-lite or external Postgres)
  - Great for global edge, a bit more setup than Render

Recommendation
- Start now with Track A (Vercel + Neon). If you must show ML, deploy only ML to Render/Fly and point `RIDERSHIP_API_BASE_URL` at it. Keep web on Vercel for speed.

---

### Environment Variables Reference (minimal)

- DATABASE_URL: Postgres connection (pooled, SSL for Neon)
- NEXT_PUBLIC_TOMTOM_API_KEY: Client-side TomTom key
- Optional AI: GOOGLE_GEMINI_API_KEY / OPENAI_API_KEY
- Optional: DEMO_MODE=true
- Optional: AI_PROVIDER=gemini|openai|mock
- Optional: RIDERSHIP_API_BASE_URL=http(s)://host:port

---

## Definition of Done

- Vercel deploy published and reachable, or VPS `docker-compose` stack up and serving
- Core demo paths working: rewards fetch, complete trip, transit insights (with deterministic fallback if AI/ML unavailable)
- No edits to application code required




Deploying Tryp Transit — Minimal, Cheap Options (No App Code Changes)

Option A: Vercel (Web only, fastest)
1) Create a free Postgres (Neon or Vercel Postgres) and copy the pooled `DATABASE_URL` (Neon requires `?sslmode=require`).
2) In Vercel, import the GitHub repo. Accept defaults (Next.js autodetect).
3) Set envs in Vercel:
   - DATABASE_URL
   - NEXT_PUBLIC_TOMTOM_API_KEY
   - Optional AI keys: GOOGLE_GEMINI_API_KEY / OPENAI_API_KEY
   - Optional: DEMO_MODE=true, AI_PROVIDER, RIDERSHIP_API_BASE_URL
4) Deploy. Then from your laptop, run migrations and seed against the managed DB:
   - npx prisma migrate deploy
   - node src/prisma/seed.ts (or seed.js)

Option B: $5 VPS with docker-compose (Web + Postgres + optional ML)
Files: docker-compose.yml, Dockerfile.web (this directory)

1) Install Docker and Docker Compose v2 on the VPS.
2) Build and run services:
   - docker compose -f deploy/docker-compose.yml build
   - docker compose -f deploy/docker-compose.yml up -d
3) Migrate and seed the database:
   - docker compose -f deploy/docker-compose.yml exec web npx prisma migrate deploy
   - docker compose -f deploy/docker-compose.yml exec web node src/prisma/seed.js
4) Access the app: http://<server-ip>:3000

Notes
- ML is optional; remove it from compose if not needed.
- For HTTPS, place a reverse proxy in front (e.g., Caddy or Traefik). Example Caddyfile:

  example.com {
    reverse_proxy localhost:3000
  }

Render / Fly.io
- Render: create two Web Services (web, ML) + free Postgres; watch for cold starts on free tier.
- Fly.io: create separate apps per service; attach volume for Postgres or use Neon; low cost but slightly more setup.

Environment Variables
- DATABASE_URL (required)
- NEXT_PUBLIC_TOMTOM_API_KEY (required for maps client)
- Optional: GOOGLE_GEMINI_API_KEY / OPENAI_API_KEY, DEMO_MODE, AI_PROVIDER, RIDERSHIP_API_BASE_URL




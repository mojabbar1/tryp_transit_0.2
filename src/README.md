Tryp Transit v0.2 — Next.js App (App Router) with Prisma, AI providers (Gemini/OpenAI), and ML microservice.

## Getting Started

Quick start:

```bash
# One-click demo (frontend + ML service)
./start-app.sh

# Or run frontend only
npm run dev

# Prepare demo checks and smoke tests
npm run demo:prep
npm run test:smoke
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

Key docs:

- IMPLEMENTATION_STATUS_YYYYMMDD_HHMMSS.md — current execution status
- DEMO_CHECKLIST.md — temporary E2E gating for demo
- CHANGELOG.md — changes across phases

Notable internals:

- `src/lib/prisma.ts` — PrismaClient singleton
- `src/lib/aiClient.ts` — AI provider abstraction (Gemini/OpenAI/Mock)
- `src/lib/config.ts` — centralized env handling + security validation + preflight
- `src/lib/schemas/*` — Zod schemas for AI outputs

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.

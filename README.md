# Insyder

Insyder helps infrastructure sales teams find accounts showing buying signals, build an evidence-backed qualification brief, get it accepted by sales, and follow through with SDR tasks and partner handoffs. This is **Phase 1** of the Insyder specification. Insyder never sends emails or makes calls.

**New to the project? Start with the docs:**

| Document | Read it for |
|---|---|
| [How it works](docs/how-it-works.md) | What the product does, roles, the life of a lead, how the parts connect, folder map |
| [Tech and data](docs/tech-and-data.md) | The stack, how data is stored, security, background jobs, settings, migrations, tests |
| [How research works (Exa)](docs/exa-research.md) | Every research feature, how leads are matched and scored, research units, errors |

## Roles

| Role | What they see |
|---|---|
| Tenant admin | Everything, plus members, settings, suppression list and research kill switch |
| Researcher | Discover, accounts, research, evidence review, qualification, drafts |
| SDR | Their own accounts and task queue, drafts, outcomes |
| Sales reviewer | Sales acceptance, owners, partner handoffs, reports |
| Partner | Only handoffs shared with them, only the permitted fields |
| Analyst | Reports only |

## Run locally

```bash
cd backend
npm install
npm run db:migrate     # applies migrations (0003 drops unused feature tables, 0004 adds review/quota/merge fields)
SEED_ADMIN_EMAIL=you@company.com SEED_ADMIN_PASSWORD='at least 8 characters' npm run db:seed
npm run dev            # API on :4000 + worker (research + import jobs) together
                       # (npm run dev:api / npm run worker run them separately)

cd ../frontend
npm install
npm run dev            # web on :3000
```

The seed creates your company (tenant), its first workspace and its first admin from the values you pass. No login details are stored in the code. Sign in as that admin and add everyone else under **Settings → Members**.

Required backend env: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `AUTH_SECRET` (16+ chars), `EXA_API_KEY`, `FRONTEND_ORIGIN`. Set `NODE_ENV=production` in production for secure cookies.

Optional: `DEMO_INTAKE_KEY`, a shared secret that lets the marketing site (Insyder repo, its /api/demo-requests route) forward "Book a demo" form submissions to `POST /v1/intake/demo-requests`. Set the same value here and in the marketing site's Vercel project. The platform admin sees them under **Platform HQ → Demo requests**.

## Tests

```bash
cd backend
npm test                                              # unit tests
TEST_DATABASE_URL=<disposable db url> npm run test:gates   # the 12 Phase 1 release gates
```

The gate tests refuse to run against the `DATABASE_URL` in `.env`. Use a throwaway Neon branch.

## Not in Phase 1

CRM sync, monitors, email campaigns/sending and score-model optimization (spec Phases 2–4).

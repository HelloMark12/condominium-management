# Condominium Management SaaS

A multi-tenant SaaS platform for condominium administration in Malta. Administrators manage buildings and apartments, invite owners and tenants, and track monthly billing. Owners and tenants access their own portal views. Billing is DB-driven from `pricing_configs` with per-company overrides.

## Run & Operate

### Development servers
```
pnpm --filter @workspace/api-server run dev   # API server (Express 5, port $PORT)
pnpm --filter @workspace/web run dev           # Web app (Vite + React, port $PORT)
```

### Testing
```
# All tests (API + frontend) — recommended entry point:
pnpm test

# API tests only (runs setup-test-db.sh automatically first):
pnpm --filter @workspace/api-server run test

# Frontend tests only:
pnpm --filter @workspace/web run test

# API tests in watch mode (no DB setup; run setup-test-db.sh manually once first):
pnpm --filter @workspace/api-server run test:watch
```

The API test command runs `scripts/setup-test-db.sh` automatically before Vitest.  
No Clerk secrets are needed in test mode — the `x-test-clerk-user-id` header is used instead.

### Database — development vs. production

**Fresh development database** (first-time local setup only):
```
pnpm --filter @workspace/db run push
```
`drizzle-kit push` is intended for fresh development databases. It recreates the schema
from the Drizzle TypeScript definitions and is safe to run against an empty database.
Do **not** use it against a database that already has data — it may prompt destructively.

**Existing staging or production database upgrade**:
```
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrate.sql
```
`migrate.sql` is the supported non-interactive upgrade path. It:
- Runs inside a single transaction (rolls back fully on any error).
- Detects duplicate active/pending owners or tenants and aborts with a diagnostic before touching any indexes.
- Is idempotent — safe to re-run against an already-migrated database.
- Applies the `enforce_unit_building_company` trigger and partial unique indexes that `drizzle-kit push` does not manage.

### Codegen & type checking
```
pnpm --filter @workspace/api-spec run codegen   # Regenerate API hooks and Zod schemas from OpenAPI spec
pnpm run typecheck                               # Full typecheck across all packages
pnpm run build                                   # typecheck + build all packages
```

## Stack

- **Monorepo:** pnpm workspaces, Node.js 24, TypeScript 5.9
- **API:** Express 5, Clerk auth (`@clerk/express`)
- **DB:** PostgreSQL + Drizzle ORM (`drizzle-orm`, `drizzle-kit`)
- **Validation:** Zod v4, `drizzle-zod`
- **API client codegen:** Orval (from OpenAPI spec → React Query hooks + Zod schemas)
- **Frontend:** React 19, Vite, Tailwind CSS, shadcn/ui, TanStack Query
- **Build:** esbuild (API), Vite (web)
- **Testing:** Vitest + Supertest (API integration tests), Vitest + jsdom (web unit tests)

## Where things live

| Path | Purpose |
|------|---------|
| `artifacts/api-server/src/` | Express API — routes, middlewares, billing logic |
| `artifacts/api-server/src/test/` | API integration tests (Supertest against real DB) |
| `artifacts/web/src/` | React web app — pages, components, hooks |
| `artifacts/web/src/test/` | Frontend unit tests |
| `lib/db/src/schema/` | Drizzle schema (source of truth for DB shape) |
| `lib/db/migrate.sql` | Non-interactive upgrade script for existing databases |
| `lib/api-client-react/src/generated/` | Orval-generated API hooks and schemas |
| `lib/api-zod/src/generated/` | Orval-generated Zod request/response validators |
| `scripts/setup-test-db.sh` | Idempotent test database bootstrap (drizzle-kit push + migrate.sql) |
| `artifact.toml` | Artifact service configuration |

## Architecture decisions

- **Billing is DB-driven:** All commercial thresholds come from `pricing_configs`. No hardcoded tier constants. `calculateTier()` and `calculateEstimatedAmountCents()` accept the active config as a parameter.
- **Peak billing:** Monthly usage records track `peak_active_unit_count` using PostgreSQL `GREATEST()`. The tier and estimated amount are always calculated from the peak, not the current count, so archiving an apartment mid-month does not lower the bill.
- **Test auth bypass:** `clerkMiddleware()` is not mounted when `NODE_ENV=test`. The `requireAuth` middleware accepts an `x-test-clerk-user-id` header in test mode, and `resolveUser` auto-creates user rows. No Clerk secrets are needed for the test suite.
- **DB-level integrity:** The `enforce_unit_building_company` trigger prevents `units.company_id` from diverging from the building's `company_id`. Partial unique indexes `um_one_owner_per_unit` and `um_one_tenant_per_unit` are enforced at the DB level, with application routes catching PG error `23505` and returning HTTP 409.
- **Explicit `isCustomPricing` field:** The API returns an explicit `isCustomPricing: boolean` derived from `enterprisePricingBehavior === 'custom'`. The frontend never infers this from `estimatedAmountCents === 0`, which would misidentify enterprise/fixed or enterprise/per_unit plans with a zero rate.

## Product

Condominium management SaaS for Malta:
- **Admin portal:** manage buildings, apartments (archive/restore), invite owners and tenants, view billing and usage history.
- **Owner portal:** view own apartment details.
- **Tenant portal:** view tenancy details.
- **Billing:** tiered monthly billing based on peak active apartment count per company, with optional per-company overrides and enterprise pricing modes (custom, fixed, per-unit).

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Always use `psql ... -f lib/db/migrate.sql` (not `drizzle-kit push`) for staging/production database upgrades.
- `drizzle-kit push` does **not** create the `enforce_unit_building_company` trigger or the partial unique indexes. The test suite requires these, which is why `scripts/setup-test-db.sh` runs `migrate.sql` after `push`.
- Express 5 types: `req.params.xxx` is `string | string[]` — always cast with `as string` before use in queries.
- Orval-generated types: when the API returns new fields not yet in the OpenAPI spec, use a local type extension (`type Foo = GeneratedType & { newField?: boolean }`) rather than `any` casts.
- `pnpm test:watch` (API) does not run DB setup — run `bash scripts/setup-test-db.sh` once manually before starting watch mode on a fresh database.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
- DB schema source of truth: `lib/db/src/schema/`
- API contract source of truth: `lib/api-spec/openapi.yaml` (or equivalent)
- Billing logic: `artifacts/api-server/src/lib/billing.ts`
- Test helpers: `artifacts/api-server/src/test/setup.ts`

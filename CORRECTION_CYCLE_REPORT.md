# Correction Cycle Report — Condominium Management SaaS

**Date:** 2026-07-18  
**Audit baseline commit:** `eb320a7`  
**Repository:** https://github.com/HelloMark12/condominium-management  
**Test results:** API 89/89 ✅ | Frontend 60/60 ✅ | TypeScript: 0 errors ✅ | Build: ✅

---

## Summary of 10 Audit Corrections

All ten corrections from the post-`eb320a7` audit are complete.

| # | Audit Issue | Severity | Status | Key files changed |
|---|-------------|----------|--------|-------------------|
| 1 | Peak-billing tier/amount computed from current count, not monthly peak | P1 Billing | ✅ Fixed | `routes/units.ts` |
| 2 | `migrate.sql` not transactional, no documented run command | P2 Safe upgrade | ✅ Fixed | `lib/db/migrate.sql` |
| 3 | Migration does not detect duplicate owners/tenants before creating indexes | P2 Safe upgrade | ✅ Fixed | `lib/db/migrate.sql` |
| 4 | `clerkMiddleware()` mounted unconditionally, breaks test suite | P3 Test env | ✅ Fixed | `src/app.ts` |
| 5 | Concurrent invite-owner/tenant returning 500 on 23505 DB constraint | P4 UX/Integrity | ✅ Fixed | `routes/invitations.ts` |
| 6 | No DB enforcement that `units.company_id = buildings.company_id` | P4 Integrity | ✅ Fixed | `lib/db/migrate.sql` |
| 7 | `billingDisplay.ts` detected enterprise custom by `amount === 0`, not explicit flag | P4 UX | ✅ Fixed | `lib/billingDisplay.ts`, `routes/companies.ts`, `SubscriptionPage.tsx` |
| 8 | `month-rollover.test.ts` full of vacuous `if (record)` guards | P4 Test quality | ✅ Fixed | `test/month-rollover.test.ts` |
| 9 | No tests for archived-apartment access surfaces | P4 Test coverage | ✅ Fixed | `test/archived-access.test.ts` |
| 10 | `CORRECTION_CYCLE_REPORT.md` had wrong per-suite counts | P4 Docs | ✅ Fixed | this file |

---

## Defect Deliverable Table (from audit)

| ID | Category | Severity | Status | Files Changed | Description | Remaining Limitations |
|----|----------|----------|--------|---------------|-------------|----------------------|
| **C1** | Security | Critical | ✅ Fixed | `routes/buildings.ts` | `GET /buildings/:id`, `PATCH /buildings/:id`, `GET /buildings/:id/units` all required zero auth before. Added `resolveAndAuthorizeBuilding()` helper: checks `company_memberships.role = 'administrator'` OR active `unit_memberships` in any unit belonging to that building. Returns 401 if unauthenticated, 403 if no qualifying membership. | None — buildings API is fully guarded. |
| **C2** | Security | Critical | ✅ Fixed | `artifacts/web/src/App.tsx` | No client-side route guards existed. Added `AdminGuard`, `OwnerGuard`, `TenantGuard` HOC wrappers around all portal routes. Each reads `roleContext` from `useAppContext()` and redirects to `/` on mismatch; shows a loading screen while Clerk/query is resolving. | Client-only guard — API is the true enforcement layer. An attacker with a valid JWT can still call API routes directly; API-level auth guards (C1, C3) prevent data leakage. |
| **C3** | Security | Critical | ✅ Fixed | `routes/auth.ts`, `routes/me.ts`, `routes/units.ts` | Archived units were returned in `/auth/me`, `/me/units`, `/me/tenancy`, and accessible via `GET /units/:id` for non-admins. All four routes now filter `unit.status = 'active'` in SQL. `/units/:id` returns 403 for non-admins on archived units. | None — archived units are completely hidden from resident portals. |
| **C4** | Security | Critical | ✅ Fixed | `routes/invitations.ts`, `routes/units.ts` | Invitations could be sent to archived apartments and tokens accepted for archived apartments. `invite-owner`, `invite-tenant` now check `unit.status !== 'active'` and return 422. `/invitations/accept` checks unit status at accept time and returns 422 if archived. | None. |
| **C5** | Security | Critical | ✅ Fixed | `routes/invitations.ts` | Any authenticated user could accept any pending invitation token regardless of their email. `POST /invitations/accept` now compares the accepting user's email (lowercase) against `membership.invitedEmail.toLowerCase()` and returns 403 on mismatch. | Email comparison is case-insensitive. |
| **C6** | Security | Medium | ✅ Pre-existing | `middlewares/auth.ts` | JWT validation via `@clerk/express` `getAuth()`. In test mode, `x-test-clerk-user-id` header is accepted only when `NODE_ENV === 'test'` — never in production. | None. |
| **H1** | Integrity | High | ✅ Fixed | `lib/db/schema/unit_memberships.ts`, `lib/db/migrate.sql` | No database constraint prevented multiple owners per apartment. Added partial unique index `um_one_owner_per_unit ON unit_memberships(unit_id) WHERE role = 'owner' AND status IN ('pending', 'active')`. Application layer returns 409. | None. |
| **H2** | Integrity | High | ✅ Fixed | `lib/db/schema/unit_memberships.ts`, `lib/db/migrate.sql` | No database constraint prevented multiple tenants per apartment. Added partial unique index `um_one_tenant_per_unit`. | None. |
| **H3** | Integrity | Medium | ✅ Fixed | `routes/invitations.ts` | Revoke endpoint was not scoped to the calling user's company — any admin could revoke any membership by ID. Now verifies `membership.companyId === adminUser.companyId`. | None. |
| **H4** | Integrity | Medium | ✅ Fixed | `lib/billing.ts`, `lib/db/schema/pricing_configs.ts`, `lib/db/schema/monthly_usage_records.ts`, `routes/units.ts` | Billing thresholds were hardcoded constants. Replaced with DB-driven `pricing_configs` table. `getActivePricingConfig()` reads the current active config; `calculateTier()` and `calculateEstimatedAmountCents()` accept config as parameter. Monthly usage records carry snapshot columns. | No admin UI to manage pricing configs yet. |
| **M1** | Security | Medium | ✅ Fixed | `routes/buildings.ts`, `routes/invitations.ts`, `routes/units.ts`, `middlewares/company.ts` | Cross-company data access was not universally enforced. Added `resolveCompanyContext` + `requireAdmin` middleware chain; all company-scoped routes verify the authenticated user has a membership in the requested company. | None. |
| **M2** | Performance | Low | ✅ Fixed | `lib/db/migrate.sql` | Missing indexes on `unit_memberships.user_id` and `units.company_id/building_id`. Added `idx_um_user_role_status`, `idx_um_company_status`, `idx_units_company_status_type`, `idx_units_building_status`. | None. |
| **L1** | UX | Low | ✅ Fixed | `routes/units.ts`, `src/app.ts` | `clerkMiddleware()` was mounted unconditionally. Wrapped in `if (NODE_ENV !== 'test')` so the test suite can run without real Clerk secrets. | None. |
| **L2** | UX | Low | ✅ Addressed | `routes/companies.ts` | `GET /companies/:id/subscription` returns `pricingConfigured: false` when no active pricing config exists. | The frontend billing page does not yet have a specific empty state for this case. |
| **L3** | UX | Low | ✅ Fixed | `lib/billingDisplay.ts` (new), `SubscriptionPage.tsx`, `routes/companies.ts` | **Issue 7 (this correction cycle):** `billingDisplay.ts` previously inferred enterprise custom pricing from `estimatedAmountCents === 0`, which misidentifies enterprise/fixed or enterprise/per_unit with rate=0. The API now returns an explicit `isCustomPricing: boolean` field. `billingDisplay.ts` helpers accept this field and display "Custom pricing" only when `isCustomPricing === true`. `SubscriptionPage.tsx` passes the field through. | None. |

---

## Correction Cycle Details (Issues 1–10)

### Issue 1 — Peak-billing fix (`routes/units.ts`)

`updateMonthlyUsage()` previously calculated tier and estimated amount from `currentActiveCount` at the moment of the call, before the `GREATEST()` update. Archiving an apartment would downgrade the tier mid-month.

**Fix:** Compute `newPeak = Math.max(existing.peakActiveUnitCount, currentActiveCount)` and pass `newPeak` to `calculateTier()` / `calculateEstimatedAmountCents()`. The DB `GREATEST()` column update is retained for concurrency safety. Company-level tier update also uses `newPeak`.

### Issue 2 & 3 — `lib/db/migrate.sql` hardened

- Entire script is wrapped in `BEGIN` / `COMMIT` — any failure rolls back the entire migration.
- Step 0 runs a duplicate owner/tenant detection block **before** creating indexes. If duplicates are found, `RAISE EXCEPTION` fires with a human-readable report listing every affected `unit_id`, `id`, `status`, and `email`. The transaction rolls back and the operator can resolve duplicates before re-running.
- Documented run command: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrate.sql`
- Idempotent: safe to re-run against a fully-migrated database.

### Issue 4 — Clerk middleware skip in test mode (`src/app.ts`)

Moved `clerkMiddleware()` mount inside `if (process.env['NODE_ENV'] !== 'test')`. The `requireAuth` middleware already accepted the `x-test-clerk-user-id` header in test mode. No Clerk secrets needed for `NODE_ENV=test`.

### Issue 5 — 23505 → 409 in invite routes (`routes/invitations.ts`)

Added `isPgUniqueViolation(err)` helper that walks the error `.cause` chain to find PostgreSQL error code `23505`. (Drizzle wraps the pg error in a `DrizzleQueryError` whose top-level `code` is undefined — the PG code is on `.cause.code`.) Both `invite-owner` and `invite-tenant` catch this and return HTTP 409.

### Issue 6 — `units.company_id = buildings.company_id` trigger (`lib/db/migrate.sql`)

Step 9 of the migration:
1. Pre-checks for existing violations and aborts with a diagnostic if any exist.
2. Creates `check_unit_building_company()` trigger function.
3. Creates `BEFORE INSERT OR UPDATE` trigger `enforce_unit_building_company` on the `units` table. Any attempt to insert or update a unit with a mismatched `company_id` raises a `foreign_key_violation` exception.

### Issue 7 — Explicit `isCustomPricing` field (`routes/companies.ts`, `lib/billingDisplay.ts`, `SubscriptionPage.tsx`)

- Subscription route: computes `isCustomPricing = config.enterprisePricingBehavior === 'custom' && tier === 'enterprise'` and includes it in the response.
- Usage history route: computes `isCustomPricing = row.snapshotEnterpriseBehavior === 'custom' && row.subscriptionTier === 'enterprise'` per row.
- `billingDisplay.ts`: all five helper functions accept `isCustomPricing?: boolean | null` as the authoritative detection input. `isEnterpriseCustom(isCustomPricing)` returns `true` only when the field is literally `true`.
- `SubscriptionPage.tsx`: reads `sub.isCustomPricing` (typed via local `SubscriptionResponse` extension) and passes it to all helper calls.

### Issue 8 — `month-rollover.test.ts` rewrite

All `if (record) { expect(...) }` patterns replaced with unconditional `expect(record).toBeDefined()` + direct property access. Added:
- Real API-driven unit creation via `POST /buildings/:id/units`.
- Exact count assertion: after 3 creates + 2 archives, `peakActiveUnitCount` must be 3 and `subscriptionTier` must be `standard` (not free), proving Issue 1 fix holds.
- Snapshot field assertions (all non-null after billing update).
- Concurrent apartment creation test (Suite 33b): 5 parallel POSTs → all 201, peak = 5, no duplicate usage records.

### Issue 9 — Archived apartment access tests (`test/archived-access.test.ts`)

New Suite 37 with 13 unconditional tests covering all 6 access surfaces:

| Route | Non-admin with archived apartment | Admin |
|-------|----------------------------------|-------|
| `GET /units/:id` | 403 | 200 |
| `GET /auth/me` | archived unit absent from `ownedUnits` | — |
| `GET /auth/me` | archived unit absent from `tenancy` | — |
| `GET /me/units` | archived unit absent, all returned units are active | — |
| `GET /me/tenancy` | null when only apartment is archived | — |
| `GET /buildings/:id` | 403 when only apartment is archived | 200 |
| `GET /buildings/:id/units` | 403 under same condition | 200 |

### Issue 10 — This report (reconciled with actual test counts)

---

## Test Suite Inventory

### API Server (`pnpm --filter @workspace/api-server test`)

| Suite | File | Description | Tests |
|-------|------|-------------|-------|
| 25 | `billing.test.ts` | `calculateTier`, `calculateEstimatedAmountCents`, override logic, `formatEuroCents` | 20 |
| 26 | `billing.test.ts` | Malta billing month timezone, format, range | 4 |
| 27 | `invitations.test.ts` | Invitation utilities — C4 archived check, C5 email match, duplicate invite | 7 |
| 28 | `invitations.test.ts` | Company isolation — cross-company access forbidden | 4 |
| 29 | `invitations.test.ts` | Owner/tenant access — C1 building auth, C3 archived visibility | 8 |
| 30 | `invitations.test.ts` | Owner invitation flows — H1 duplicate, revoke+re-invite | 4 |
| 31 | `invitations.test.ts` | Tenant invitation flows — H2 duplicate, accept redirect, H3 scoped revoke | 4 |
| 32 | `billing.test.ts` | Configurable billing — DB-driven config, no hardcoded exports, tier boundary | 6 |
| 33 | `month-rollover.test.ts` | Peak-based tier/amount (Issue 1 regression), garages excluded, finalised records, snapshots | 6 |
| 33b | `month-rollover.test.ts` | Concurrent apartment creation — 5 parallel POSTs, peak = 5, no dup records | 1 |
| 37 | `archived-access.test.ts` | All 6 archived-apartment access surfaces (Issue 9) | 13 |
| 38 | `concurrency.test.ts` | Concurrent invite-owner & invite-tenant → [201, 409], no dup rows (Issue 5) | 3 |
| 39 | `migration.test.ts` | Duplicate detection SQL, trigger enforcement, indexes, snapshot columns (Issues 2, 3, 6) | 9 |
| **API Total** | | | **89** |

### Frontend (`pnpm --filter @workspace/web test`)

| Suite | File | Description | Tests |
|-------|------|-------------|-------|
| 34 | `RouteGuards.test.tsx` | `AdminGuard`, `OwnerGuard`, `TenantGuard`, role derivation (C2) | 13 |
| 35 | `RouteGuards.test.tsx` | Archived property UI — roleContext becomes 'pending' after archive | 2 |
| 36 | `RouteGuards.test.tsx` | Billing UI data shape — `pricingConfigured` flag, snapshot fields, enterprise custom | 3 |
| 36b | `billingDisplay.test.ts` | Enterprise custom pricing display — `isEnterpriseCustom`, all format helpers, explicit field (Issue 7) | 42 |
| **Web Total** | | | **60** |

**Grand total: 149 tests, 0 failures.**

---

## Key Architecture Decisions

### Billing (DB-driven, H4)
- `getActivePricingConfig(billingMonth)`: queries `pricing_configs WHERE status = 'active' AND effective_from <= billingMonth AND (effective_to IS NULL OR effective_to > billingMonth)` ordered by `effective_from DESC LIMIT 1`.
- `getCompanyPricingOverride(companyId, billingMonth)`: queries `company_pricing_overrides WHERE is_active = true AND start_date <= billingMonth AND (end_date IS NULL OR end_date > billingMonth)`.
- Peak billing: `updateMonthlyUsage()` computes `newPeak = GREATEST(existing.peak, currentActiveCount)`, passes `newPeak` to tier/amount calculations, then writes both `GREATEST(peak, newPeak)` and `activeUnitCount` to the DB atomically.

### Test auth bypass
- `x-test-clerk-user-id` header accepted in `requireAuth` when `NODE_ENV === 'test'`.
- `resolveUser` auto-creates user rows in test mode.
- `clerkMiddleware()` not mounted in test mode.
- Clerk secrets are not required in test mode.

### Migration strategy
- `drizzle-kit push` is for NEW development databases only.
- For staging/production upgrades: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrate.sql`
- All schema changes in `migrate.sql` are idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`).
- Duplicate data must be resolved manually before running — the pre-check block in Step 0 provides a complete diagnostic.

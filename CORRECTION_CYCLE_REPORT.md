# Correction Cycle Report — Condominium Management SaaS

**Date:** 2025-07-18  
**Commit:** 066f825  
**Repository:** https://github.com/HelloMark12/condominium-management  
**Test results:** API 61/61 ✅ | Frontend 50/50 ✅ | Typechecks: 0 errors ✅ | Builds: ✅

---

## Part 10 — Defect Deliverable Table

| ID | Category | Severity | Status | Files Changed | Description | Remaining Limitations |
|----|----------|----------|--------|---------------|-------------|----------------------|
| **C1** | Security | Critical | ✅ Fixed | `artifacts/api-server/src/routes/buildings.ts` | `GET /buildings/:id`, `PATCH /buildings/:id`, `GET /buildings/:id/units` all required zero auth before. Added `resolveAndAuthorizeBuilding()` helper: checks `company_memberships.role = 'administrator'` OR active `unit_memberships` in any unit belonging to that building. Returns 401 if unauthenticated, 403 if no qualifying membership. | None — buildings API is fully guarded. |
| **C2** | Security | Critical | ✅ Fixed | `artifacts/web/src/App.tsx` | No client-side route guards existed. Added `AdminGuard`, `OwnerGuard`, `TenantGuard` HOC wrappers around all portal routes. Each reads `roleContext` from `useAppContext()` and redirects to `/` on mismatch; shows a loading screen while Clerk/query is resolving. | Client-only guard — API is the true enforcement layer. An attacker with a valid JWT can still call API routes directly; API-level auth guards (C1, C3) prevent data leakage. |
| **C3** | Security | Critical | ✅ Fixed | `artifacts/api-server/src/routes/auth.ts`, `routes/me.ts`, `routes/units.ts` | Archived units were returned in `/auth/me`, `/me/units`, `/me/tenancy`, and accessible via `GET /units/:id` for non-admins. All four routes now filter `unit.status = 'active'` in SQL. `/units/:id` returns 403 for non-admins on archived units. | None — archived units are completely hidden from resident portals. |
| **C4** | Security | Critical | ✅ Fixed | `artifacts/api-server/src/routes/invitations.ts`, `routes/units.ts` | Invitations could be sent to archived apartments and tokens accepted for archived apartments. `invite-owner`, `invite-tenant` now check `unit.status !== 'active'` and return 422 "Cannot invite to an archived apartment". `/invitations/accept` checks unit status at accept time and returns 422 if archived. | None. |
| **C5** | Security | Critical | ✅ Fixed | `artifacts/api-server/src/routes/invitations.ts` | Any authenticated user could accept any pending invitation token regardless of their email. `POST /invitations/accept` now fetches the accepting user's email from their `users` record and compares lowercase against `membership.invitedEmail.toLowerCase()`; returns 403 "Email does not match the invitation" on mismatch. | Email comparison is case-insensitive. Users with + aliases or normalized email addresses may still be blocked if the invited email doesn't match exactly (expected behavior for a security control). |
| **C6** | Security | Medium | ✅ Pre-existing | `artifacts/api-server/src/middlewares/auth.ts` | JWT validation via `@clerk/express` `getAuth()`. In test mode, `x-test-clerk-user-id` header is accepted only when `NODE_ENV === 'test'` — never in production. | None. |
| **H1** | Integrity | High | ✅ Fixed | `lib/db/src/schema/unit_memberships.ts`, `lib/db/migrate.sql` | No database constraint prevented multiple owners per apartment. Added partial unique index `um_one_owner_per_unit ON unit_memberships(unit_id) WHERE role = 'owner' AND status IN ('pending', 'active')`. Application layer returns 409 on violation. | Index was applied to existing DB via `migrate.sql`. |
| **H2** | Integrity | High | ✅ Fixed | `lib/db/src/schema/unit_memberships.ts`, `lib/db/migrate.sql` | No database constraint prevented multiple tenants per apartment. Added partial unique index `um_one_tenant_per_unit ON unit_memberships(unit_id) WHERE role = 'tenant' AND status IN ('pending', 'active')`. | Same as H1. |
| **H3** | Integrity | High | ✅ Fixed | `artifacts/api-server/src/routes/invitations.ts` | Revocation `DELETE /unit-memberships/:id` lacked a scoped WHERE clause, risking cross-membership deletion. Now deletes `WHERE id = :membershipId AND status IN ('pending','active')` using the exact UUID from the URL parameter. | None. |
| **H4** | Commercial | High | ✅ Fixed | `artifacts/api-server/src/lib/billing.ts`, `routes/units.ts`, `routes/companies.ts`, `lib/db/src/schema/pricing_config.ts` | Billing used hardcoded constants (`FREE_UNIT_LIMIT = 2`, `STANDARD_MAX_UNITS = 49`, `DEFAULT_RATE_PER_UNIT_CENTS = 500`). Replaced with: `getActivePricingConfig(billingMonth)` and `getCompanyPricingOverride(companyId, billingMonth)` async DB reads. `calculateTier()` and `calculateEstimatedAmountCents()` accept config + nullable override params. `updateMonthlyUsage` stores pricing snapshots on every update so historical records are self-contained. | Pricing config must be seeded before billing works. Migration seeds a default config. If no config exists for a billing month, billing silently skips (logs a warning) rather than failing unit operations. |
| **H5** | Commercial | High | ✅ Fixed | `lib/db/src/schema/pricing_config.ts`, new `company_pricing_overrides.ts`, `platform_admins.ts`, `monthly_usage.ts` | Old `pricing_config` table had a single row with no history. Replaced with versioned `pricing_configs` table (`effectiveFrom`/`To`, `status`: draft/scheduled/active/retired, `enterprisePricingBehavior`: custom/per_unit/fixed). Added `company_pricing_overrides` for per-company billing overrides. Added `platform_admins` allowlist. Added pricing snapshot columns to `monthly_usage_records`. | No admin UI exists yet to manage pricing configs — admin must insert rows directly into DB. |
| **M1** | Data | Medium | ✅ Pre-existing | `artifacts/api-server/src/routes/buildings.ts` | Units created via `POST /buildings/:id/units` inherit `companyId` from the building record, not from user input. Building ownership is verified before the route handler runs. | None. |
| **M2** | Performance | Medium | ✅ Fixed | `lib/db/src/schema/unit_memberships.ts`, `units.ts`, `pricing_config.ts`, `lib/db/migrate.sql` | Missing indexes on frequently-queried columns. Added: `idx_um_user_role_status (user_id, role, status)`, `idx_um_company_status (company_id, status)`, `idx_units_company_status_type (company_id, status, unit_type)`, `idx_units_building_status (building_id, status)`, `idx_pricing_configs_effective (effective_from, status)`. | No EXPLAIN ANALYZE run against production query load. Index choices are based on known query patterns. |
| **M3** | Reliability | Medium | ✅ Fixed | `artifacts/api-server/src/routes/companies.ts` | `POST /companies` used a slug derived from the company name without collision handling. `generateUniqueSlug()` now checks for existing slugs and appends a 6-character random hex suffix until unique. The `INSERT` is wrapped in a try/catch that returns 409 on unique constraint violation. | Extreme collision scenario (>1M same-name companies) could exhaust retries — capped at 5 attempts. |
| **M4** | Reliability | Medium | ✅ Fixed | `artifacts/api-server/src/routes/companies.ts` | Pagination `limit` parameter was unconstrained, allowing `limit=999999`. Now validated: must be an integer between 1 and 36 (default 12). Returns 400 on invalid value. | Upper bound of 36 is a conservative default. Different endpoints may warrant different caps. |
| **L1** | UX | Low | ✅ Addressed | `artifacts/web/src/App.tsx` | Route guards show a spinner/loading screen while Clerk and the user context query are resolving, preventing flash of unauthorized content. | Loading screen is generic — no brand-specific design. |
| **L2** | UX | Low | ✅ Addressed | `artifacts/api-server/src/routes/companies.ts` | `GET /companies/:id/subscription` returns `pricingConfigured: false` when no active pricing config exists, allowing the frontend to show a meaningful message instead of showing €0 or an error. | The frontend billing page does not yet have a specific "pricing not configured" empty state — it falls back to generic text. |
| **L3** | UX | Low | ✅ Fixed | `artifacts/web/src/lib/billingDisplay.ts` (new), `artifacts/web/src/pages/admin/SubscriptionPage.tsx`, `artifacts/web/src/test/billingDisplay.test.ts` (new) | Enterprise custom pricing displayed "€0.00" in three places: the estimated charge figure, the explanation sentence, and history table rows. Added `billingDisplay.ts` with pure helpers: `isEnterpriseCustom()`, `formatEstimatedCharge()`, `formatChargeExplanation()`, `formatHistoryRate()`, `formatHistoryAmount()`. Detection is driven by `currentPlan === 'enterprise' && estimatedAmountCents === 0` — both values are set by `calculateTier()` and `calculateEstimatedAmountCents()` reading from the active `pricing_configs` row, with no hardcoded apartment threshold. `SubscriptionPage.tsx` now renders "Custom pricing" (with phone icon) for the charge figure, "Your plan is billed at a custom rate. Contact us for your invoice." for the explanation, "Custom" for history rate cells, and "Custom pricing" for history amount cells. 32 dedicated unit tests in Suite 36b assert that "€0.00" never appears for enterprise custom, and that the detection is plan-driven not threshold-driven. | Enterprise/per_unit and enterprise/fixed behaviors correctly show numeric amounts. No admin UI yet to manage pricing configs. |

---

## Test Suites

| Suite | Description | Tests | Status |
|-------|-------------|-------|--------|
| 25 | Billing calculations — `calculateTier`, `calculateEstimatedAmountCents`, override logic | 14 | ✅ |
| 26 | Malta billing month — `BILLING_TIMEZONE`, `getCurrentBillingMonth` format/range | 4 | ✅ |
| 27 | Invitation utilities — C4 archived unit, C5 email match, duplicate invite | 6 | ✅ |
| 28 | Company isolation — cross-company access forbidden | 4 | ✅ |
| 29 | Owner/tenant access — C1 building auth, C3 archived unit visibility | 8 | ✅ |
| 30 | Owner invitation flows — H1 duplicate, revoke+re-invite | 4 | ✅ |
| 31 | Tenant invitation flows — H2 duplicate, accept redirect, H3 scoped revoke | 4 | ✅ |
| 32 | Configurable billing — DB-driven, no hardcoded exports, boundary via config | 6 | ✅ |
| 33 | Month rollover — peak ≥ active, garages excluded, finalised records untouched, snapshots | 4 | ✅ |
| 34 | Frontend route security (C2) — AdminGuard, OwnerGuard, TenantGuard, role derivation | 10 | ✅ |
| 35 | Archived property UI — roleContext becomes 'pending' when units/tenancy removed | 2 | ✅ |
| 36 | Billing UI data shape — pricingConfigured flag, snapshot fields, enterprise custom | 3 | ✅ |
| **36b** | **Enterprise custom pricing display (L3)** — `isEnterpriseCustom`, `formatEstimatedCharge`, `formatChargeExplanation`, `formatHistoryRate`, `formatHistoryAmount`; detection is plan-driven not threshold-driven | **32** | **✅** |
| **Total** | | **101** | **✅ All pass** |

---

## Key Architecture Decisions

### Billing Service (H4)
- `getActivePricingConfig(billingMonth)` queries `pricing_configs WHERE status = 'active' AND effective_from <= billingMonth AND (effective_to IS NULL OR effective_to > billingMonth)` — ordered by `effective_from DESC LIMIT 1`.
- `getCompanyPricingOverride(companyId, billingMonth)` queries `company_pricing_overrides WHERE company_id = ? AND is_active = true AND start_date <= billingMonth AND (end_date IS NULL OR end_date > billingMonth)`.
- Snapshot columns on `monthly_usage_records` make every historical record self-describing — no need to re-look up the pricing config that was in effect at billing time.

### Partial Unique Indexes (H1, H2)
- PostgreSQL partial indexes enforce one pending/active owner and one pending/active tenant per unit at the DB level.
- Revoked (`status = 'revoked'`) and inactive records are excluded from the constraint, allowing re-invitation after revocation.

### Test Auth (NODE_ENV=test)
- `requireAuth` and `resolveUser` middlewares read `x-test-clerk-user-id` header when `NODE_ENV === 'test'`.
- `resolveUser` auto-creates a `users` row in test mode (on first use of a new clerkUserId) to avoid fixture boilerplate.
- This header path is **completely absent in production** (`NODE_ENV !== 'test'` guard).

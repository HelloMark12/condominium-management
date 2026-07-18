---
name: Billing DB-driven architecture
description: How the billing service reads pricing from DB; no hardcoded constants allowed
---

The billing service (`artifacts/api-server/src/lib/billing.ts`) reads all commercial thresholds from the database — never from hardcoded constants. Any `FREE_UNIT_LIMIT`, `STANDARD_MAX_UNITS`, `DEFAULT_RATE_PER_UNIT_CENTS` exports were removed.

**Why:** Multi-tenant SaaS requires adjustable pricing per tenant and over time. Hardcoded constants would require a code deploy to change pricing.

**How to apply:**
- `getActivePricingConfig(billingMonth: string)` — returns the active `pricing_configs` row effective for that month; throws if none found.
- `getCompanyPricingOverride(companyId, billingMonth)` — returns the company-specific override or null.
- `calculateTier(peakUnits, config, override?)` and `calculateEstimatedAmountCents(peakUnits, config, override?)` accept the config+override objects.
- Every `monthly_usage_records` update writes pricing snapshot columns so historical records are self-describing.
- Finalised records (`invoiceStatus = 'finalised'`) are never updated — checked via `ne(invoiceStatus, 'finalised')` in the WHERE clause.
- If no pricing config exists for a billing month, `updateMonthlyUsage` logs a warning and skips silently (doesn't fail the unit operation).

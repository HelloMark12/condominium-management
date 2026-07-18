-- ============================================================
-- Condominium Management SaaS — Full Schema Migration
-- ============================================================
--
-- PRODUCTION UPGRADE COMMAND (non-interactive, exits non-zero on failure):
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrate.sql
--
-- This script:
--   1. Runs inside a single transaction (COMMIT only on full success).
--   2. Pre-checks for duplicate active/pending owners/tenants and ABORTS
--      with a clear diagnostic if any are found (Issue 3 FIX).
--   3. Is idempotent: safe to re-run against a fully-migrated database.
--   4. Works from a clean database (f41f867 baseline schema).
--   5. Adds a DB-level trigger enforcing unit.company_id = building.company_id
--      (Issue 6 FIX).
--
-- SAFE MIGRATION STRATEGY:
--   - Reserve `drizzle-kit push` for NEW development databases only.
--   - For upgrades (staging / production), always use this script via psql
--     with ON_ERROR_STOP=1 so that partial migrations are rolled back.
--   - Duplicate data must be resolved BEFORE running this script (see pre-check
--     output for affected unit IDs, relationship IDs, roles, statuses, emails).
--
-- ============================================================

BEGIN;

-- ── Step 0: Pre-check — abort if duplicate owners or tenants exist ────────────
--
-- The partial unique indexes (Step 6) cannot be created when duplicate
-- active/pending owners or tenants already exist.  This block runs FIRST,
-- inside the transaction, so the whole migration rolls back on failure.
-- The error message lists affected unit IDs and emails for easy remediation.

DO $$
DECLARE
  owner_dup_count  integer;
  tenant_dup_count integer;
  dup_report       text;
BEGIN
  -- ── Owner duplicates ──
  SELECT COUNT(*) INTO owner_dup_count
  FROM (
    SELECT unit_id
    FROM unit_memberships
    WHERE role = 'owner' AND status IN ('pending', 'active')
    GROUP BY unit_id
    HAVING COUNT(*) > 1
  ) sub;

  IF owner_dup_count > 0 THEN
    SELECT string_agg(
      'unit_id=' || unit_id
      || ' id=' || id
      || ' status=' || status
      || ' email=' || invited_email,
      E'\n  '
      ORDER BY unit_id
    ) INTO dup_report
    FROM unit_memberships
    WHERE role = 'owner'
      AND status IN ('pending', 'active')
      AND unit_id IN (
        SELECT unit_id FROM unit_memberships
        WHERE role = 'owner' AND status IN ('pending', 'active')
        GROUP BY unit_id HAVING COUNT(*) > 1
      );

    RAISE EXCEPTION E'MIGRATION ABORTED: % unit(s) have duplicate active/pending OWNERS.\n\n'
      'Affected records:\n  %\n\n'
      'Resolution: revoke or archive the extra memberships, then re-run this migration.\n'
      'Revoke SQL example:\n'
      '  UPDATE unit_memberships SET status=''revoked'', revoked_at=NOW()\n'
      '  WHERE id = ''<duplicate-id>'' AND role = ''owner'';',
      owner_dup_count, dup_report;
  END IF;

  -- ── Tenant duplicates ──
  SELECT COUNT(*) INTO tenant_dup_count
  FROM (
    SELECT unit_id
    FROM unit_memberships
    WHERE role = 'tenant' AND status IN ('pending', 'active')
    GROUP BY unit_id
    HAVING COUNT(*) > 1
  ) sub;

  IF tenant_dup_count > 0 THEN
    SELECT string_agg(
      'unit_id=' || unit_id
      || ' id=' || id
      || ' status=' || status
      || ' email=' || invited_email,
      E'\n  '
      ORDER BY unit_id
    ) INTO dup_report
    FROM unit_memberships
    WHERE role = 'tenant'
      AND status IN ('pending', 'active')
      AND unit_id IN (
        SELECT unit_id FROM unit_memberships
        WHERE role = 'tenant' AND status IN ('pending', 'active')
        GROUP BY unit_id HAVING COUNT(*) > 1
      );

    RAISE EXCEPTION E'MIGRATION ABORTED: % unit(s) have duplicate active/pending TENANTS.\n\n'
      'Affected records:\n  %\n\n'
      'Resolution: revoke or archive the extra memberships, then re-run this migration.\n'
      'Revoke SQL example:\n'
      '  UPDATE unit_memberships SET status=''revoked'', revoked_at=NOW()\n'
      '  WHERE id = ''<duplicate-id>'' AND role = ''tenant'';',
      tenant_dup_count, dup_report;
  END IF;
END $$;

-- ── Step 1: Enums ─────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE pricing_config_status AS ENUM ('draft','scheduled','active','retired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE enterprise_pricing_behavior AS ENUM ('custom','per_unit','fixed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE platform_admin_level AS ENUM ('owner','admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Step 2: pricing_configs table (replaces old single-row pricing_config) ────

CREATE TABLE IF NOT EXISTS pricing_configs (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                            TEXT NOT NULL,
  free_unit_limit                 INTEGER NOT NULL,
  standard_min                    INTEGER NOT NULL,
  standard_max                    INTEGER NOT NULL,
  enterprise_start                INTEGER NOT NULL,
  rate_per_unit_cents             INTEGER NOT NULL,
  enterprise_pricing_behavior     enterprise_pricing_behavior NOT NULL DEFAULT 'custom',
  enterprise_fixed_rate_cents     INTEGER,
  enterprise_per_unit_rate_cents  INTEGER,
  currency                        TEXT NOT NULL DEFAULT 'EUR',
  effective_from                  DATE NOT NULL,
  effective_to                    DATE,
  status                          pricing_config_status NOT NULL DEFAULT 'draft',
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                      UUID REFERENCES users(id),
  notes                           TEXT
);

CREATE INDEX IF NOT EXISTS idx_pricing_configs_effective
  ON pricing_configs (effective_from, status);

-- Seed the initial pricing configuration (only if no active config exists)
INSERT INTO pricing_configs (
  name, free_unit_limit, standard_min, standard_max,
  enterprise_start, rate_per_unit_cents, enterprise_pricing_behavior,
  currency, effective_from, status, notes
)
SELECT
  'Standard Malta 2025',
  2,        -- free_unit_limit: ≤2 apartments → free
  3,        -- standard_min
  49,       -- standard_max
  50,       -- enterprise_start: ≥50 apartments → enterprise
  500,      -- rate_per_unit_cents: €5.00 per apartment per month
  'custom',
  'EUR',
  '2025-01-01',
  'active',
  'Initial platform pricing configuration seeded during migration'
WHERE NOT EXISTS (SELECT 1 FROM pricing_configs WHERE status = 'active');

-- ── Step 3: company_pricing_overrides table ───────────────────────────────────

CREATE TABLE IF NOT EXISTS company_pricing_overrides (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                    UUID NOT NULL REFERENCES companies(id),
  custom_free_unit_limit        INTEGER,
  custom_standard_min           INTEGER,
  custom_standard_max           INTEGER,
  custom_enterprise_start       INTEGER,
  custom_rate_per_unit_cents    INTEGER,
  fixed_monthly_fee_cents       INTEGER,
  enterprise_custom_rate_cents  INTEGER,
  start_date                    DATE NOT NULL,
  end_date                      DATE,
  is_active                     BOOLEAN NOT NULL DEFAULT TRUE,
  reason                        TEXT,
  notes                         TEXT,
  created_by                    UUID REFERENCES users(id),
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cpo_company_active
  ON company_pricing_overrides (company_id, is_active);

CREATE INDEX IF NOT EXISTS idx_cpo_dates
  ON company_pricing_overrides (start_date, end_date);

-- ── Step 4: platform_admins table ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS platform_admins (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL UNIQUE REFERENCES users(id),
  level       platform_admin_level NOT NULL DEFAULT 'admin',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID REFERENCES users(id),
  notes       TEXT
);

-- ── Step 5: Pricing snapshot columns on monthly_usage_records ─────────────────

ALTER TABLE monthly_usage_records
  ADD COLUMN IF NOT EXISTS pricing_config_id       UUID REFERENCES pricing_configs(id),
  ADD COLUMN IF NOT EXISTS company_override_id     UUID REFERENCES company_pricing_overrides(id),
  ADD COLUMN IF NOT EXISTS snapshot_free_unit_limit      INTEGER,
  ADD COLUMN IF NOT EXISTS snapshot_standard_min         INTEGER,
  ADD COLUMN IF NOT EXISTS snapshot_standard_max         INTEGER,
  ADD COLUMN IF NOT EXISTS snapshot_enterprise_start     INTEGER,
  ADD COLUMN IF NOT EXISTS snapshot_rate_per_unit_cents  INTEGER,
  ADD COLUMN IF NOT EXISTS snapshot_enterprise_behavior  TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_currency             TEXT;

-- ── Step 6: H1/H2 — Partial unique indexes on unit_memberships ───────────────
--
-- These are created AFTER the duplicate pre-check in Step 0 (which aborts if
-- duplicates exist).  This guarantees a clean dataset before index creation.

DROP INDEX IF EXISTS um_one_owner_per_unit;
DROP INDEX IF EXISTS um_one_tenant_per_unit;

CREATE UNIQUE INDEX um_one_owner_per_unit
  ON unit_memberships (unit_id)
  WHERE role = 'owner' AND status IN ('pending', 'active');

CREATE UNIQUE INDEX um_one_tenant_per_unit
  ON unit_memberships (unit_id)
  WHERE role = 'tenant' AND status IN ('pending', 'active');

-- ── Step 7: M2 — Performance indexes ─────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_um_user_role_status
  ON unit_memberships (user_id, role, status);

CREATE INDEX IF NOT EXISTS idx_um_company_status
  ON unit_memberships (company_id, status);

CREATE INDEX IF NOT EXISTS idx_units_company_status_type
  ON units (company_id, status, unit_type);

CREATE INDEX IF NOT EXISTS idx_units_building_status
  ON units (building_id, status);

CREATE INDEX IF NOT EXISTS idx_pricing_configs_effective
  ON pricing_configs (effective_from, status);

-- ── Step 8: Drop old pricing_config table (replaced by pricing_configs) ───────

DROP TABLE IF EXISTS pricing_config CASCADE;

-- ── Step 9: Issue 6 — DB trigger enforcing unit.company_id = building.company_id
--
-- Application code always sets units.company_id = building.company_id, but
-- this trigger provides a final enforcement layer at the database level that
-- cannot be bypassed by application bugs, direct SQL inserts, or migrations.

-- Verify no existing violations before creating the trigger
DO $$
DECLARE
  violation_count integer;
BEGIN
  SELECT COUNT(*) INTO violation_count
  FROM units u
  JOIN buildings b ON b.id = u.building_id
  WHERE u.company_id <> b.company_id;

  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Cannot install unit/building company consistency trigger: '
      '% existing unit(s) have company_id != the building company_id. '
      'Diagnose with: SELECT u.id, u.company_id, b.company_id AS building_company_id '
      'FROM units u JOIN buildings b ON b.id = u.building_id '
      'WHERE u.company_id <> b.company_id;',
      violation_count;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION check_unit_building_company()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  bld_company_id uuid;
BEGIN
  SELECT company_id INTO bld_company_id
  FROM buildings
  WHERE id = NEW.building_id;

  IF bld_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION
      'units.company_id (%) must match the company_id of building % (company_id = %)',
      NEW.company_id, NEW.building_id, bld_company_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_unit_building_company ON units;
CREATE TRIGGER enforce_unit_building_company
  BEFORE INSERT OR UPDATE OF company_id, building_id ON units
  FOR EACH ROW EXECUTE FUNCTION check_unit_building_company();

-- ── Done ──────────────────────────────────────────────────────────────────────

COMMIT;

SELECT 'Migration complete — all steps applied successfully.' AS result;

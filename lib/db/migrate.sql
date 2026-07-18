-- ============================================================
-- Full correction cycle migration
-- Run once against the development database.
-- Idempotent: uses IF NOT EXISTS / IF EXISTS guards.
-- ============================================================

-- 1. New enums
DO $$ BEGIN
  CREATE TYPE pricing_config_status AS ENUM ('draft','scheduled','active','retired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE enterprise_pricing_behavior AS ENUM ('custom','per_unit','fixed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE platform_admin_level AS ENUM ('owner','admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. New table: pricing_configs (replaces old pricing_config)
CREATE TABLE IF NOT EXISTS pricing_configs (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                       TEXT NOT NULL,
  free_unit_limit            INTEGER NOT NULL,
  standard_min               INTEGER NOT NULL,
  standard_max               INTEGER NOT NULL,
  enterprise_start           INTEGER NOT NULL,
  rate_per_unit_cents        INTEGER NOT NULL,
  enterprise_pricing_behavior enterprise_pricing_behavior NOT NULL DEFAULT 'custom',
  enterprise_fixed_rate_cents INTEGER,
  enterprise_per_unit_rate_cents INTEGER,
  currency                   TEXT NOT NULL DEFAULT 'EUR',
  effective_from             DATE NOT NULL,
  effective_to               DATE,
  status                     pricing_config_status NOT NULL DEFAULT 'draft',
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                 UUID REFERENCES users(id),
  notes                      TEXT
);

CREATE INDEX IF NOT EXISTS idx_pricing_configs_effective
  ON pricing_configs (effective_from, status);

-- Seed the initial pricing configuration so billing works immediately
INSERT INTO pricing_configs (name, free_unit_limit, standard_min, standard_max,
  enterprise_start, rate_per_unit_cents, enterprise_pricing_behavior,
  currency, effective_from, status, notes)
SELECT
  'Standard Malta 2025',
  2,    -- free_unit_limit: ≤2 apartments → free
  3,    -- standard_min
  49,   -- standard_max
  50,   -- enterprise_start: ≥50 apartments → enterprise
  500,  -- rate_per_unit_cents: €5.00 per apartment per month
  'custom',
  'EUR',
  '2025-01-01',
  'active',
  'Initial platform pricing configuration seeded during migration'
WHERE NOT EXISTS (SELECT 1 FROM pricing_configs WHERE status = 'active');

-- 3. New table: company_pricing_overrides
CREATE TABLE IF NOT EXISTS company_pricing_overrides (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  UUID NOT NULL REFERENCES companies(id),
  custom_free_unit_limit      INTEGER,
  custom_standard_min         INTEGER,
  custom_standard_max         INTEGER,
  custom_enterprise_start     INTEGER,
  custom_rate_per_unit_cents  INTEGER,
  fixed_monthly_fee_cents     INTEGER,
  enterprise_custom_rate_cents INTEGER,
  start_date                  DATE NOT NULL,
  end_date                    DATE,
  is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
  reason                      TEXT,
  notes                       TEXT,
  created_by                  UUID REFERENCES users(id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cpo_company_active
  ON company_pricing_overrides (company_id, is_active);

CREATE INDEX IF NOT EXISTS idx_cpo_dates
  ON company_pricing_overrides (start_date, end_date);

-- 4. New table: platform_admins
CREATE TABLE IF NOT EXISTS platform_admins (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL UNIQUE REFERENCES users(id),
  level       platform_admin_level NOT NULL DEFAULT 'admin',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID REFERENCES users(id),
  notes       TEXT
);

-- 5. Add pricing snapshot columns to monthly_usage_records
ALTER TABLE monthly_usage_records
  ADD COLUMN IF NOT EXISTS pricing_config_id      UUID REFERENCES pricing_configs(id),
  ADD COLUMN IF NOT EXISTS company_override_id    UUID REFERENCES company_pricing_overrides(id),
  ADD COLUMN IF NOT EXISTS snapshot_free_unit_limit     INTEGER,
  ADD COLUMN IF NOT EXISTS snapshot_standard_min        INTEGER,
  ADD COLUMN IF NOT EXISTS snapshot_standard_max        INTEGER,
  ADD COLUMN IF NOT EXISTS snapshot_enterprise_start    INTEGER,
  ADD COLUMN IF NOT EXISTS snapshot_rate_per_unit_cents INTEGER,
  ADD COLUMN IF NOT EXISTS snapshot_enterprise_behavior TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_currency            TEXT;

-- 6. H1/H2: Partial unique indexes on unit_memberships
-- Drop first if they somehow exist with wrong definition
DROP INDEX IF EXISTS um_one_owner_per_unit;
DROP INDEX IF EXISTS um_one_tenant_per_unit;

CREATE UNIQUE INDEX um_one_owner_per_unit
  ON unit_memberships (unit_id)
  WHERE role = 'owner' AND status IN ('pending', 'active');

CREATE UNIQUE INDEX um_one_tenant_per_unit
  ON unit_memberships (unit_id)
  WHERE role = 'tenant' AND status IN ('pending', 'active');

-- 7. M2: Performance indexes
CREATE INDEX IF NOT EXISTS idx_um_user_role_status
  ON unit_memberships (user_id, role, status);

CREATE INDEX IF NOT EXISTS idx_um_company_status
  ON unit_memberships (company_id, status);

CREATE INDEX IF NOT EXISTS idx_units_company_status_type
  ON units (company_id, status, unit_type);

CREATE INDEX IF NOT EXISTS idx_units_building_status
  ON units (building_id, status);

-- 8. Drop the old pricing_config table (now replaced by pricing_configs)
DROP TABLE IF EXISTS pricing_config CASCADE;

-- Done
SELECT 'Migration complete' AS result;

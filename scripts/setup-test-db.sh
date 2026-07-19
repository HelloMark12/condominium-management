#!/usr/bin/env bash
# ============================================================
# setup-test-db.sh — idempotent test database bootstrap
#
# Run from anywhere; the script finds the workspace root.
#
# What it does:
#   1. Runs drizzle-kit push (--force, non-interactive) to apply
#      the Drizzle schema to the test database.
#   2. Runs lib/db/migrate.sql inside a transaction to add the
#      trigger, partial unique indexes, and other extras that
#      drizzle-kit does not manage.
#
# Requirements:
#   - DATABASE_URL must point to the ISOLATED test database.
#   - psql must be available on PATH.
#   - No Clerk secrets are needed.
#
# Usage (from workspace root):
#   bash scripts/setup-test-db.sh
#
# Usage (via pnpm test in artifacts/api-server/):
#   Invoked automatically — you do not need to run this manually.
# ============================================================

set -euo pipefail

# ── Locate workspace root (one directory above this script) ──────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$WORKSPACE_ROOT"

# ── Require DATABASE_URL ─────────────────────────────────────────────────────
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set. Cannot set up test database." >&2
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Test database setup"
echo "  DATABASE_URL = ${DATABASE_URL//:*@/:<redacted>@}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Step 1: Apply Drizzle schema (non-interactive via --force) ────────────────
echo ""
echo "→ Step 1: drizzle-kit push (base schema)..."
pnpm --filter @workspace/db run push-force
echo "✓ Drizzle schema applied."

# ── Step 2: Apply migrate.sql (trigger, indexes, enums, tables) ───────────────
echo ""
echo "→ Step 2: Applying lib/db/migrate.sql..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrate.sql
echo "✓ migrate.sql applied."

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Test database ready."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

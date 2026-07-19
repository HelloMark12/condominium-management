---
name: Notice module migration quirks
description: Pitfalls encountered adding Step 10 (Notices) to migrate.sql and the test cleanup order
---

## DO block dollar-quoting
PostgreSQL DO blocks require `$$` double-dollar quoting, not `$` single-dollar. Using `DO $ BEGIN ... END $;` causes a syntax error (`ERROR: syntax error at or near "$"`). Always write `DO $$ BEGIN ... END $$;`.

**Why:** The `$` delimiter alone is ambiguous to the parser without the closing tag match.

**How to apply:** Any new DO block added to migrate.sql must use `$$`. Use `grep "DO \$[^$]"` to detect violations.

## Notice table FK cleanup order (tests)
When deleting test notices, the FK graph requires this order:
1. `notice_delivery_contexts` (FK → notice_deliveries.id)
2. `notice_deliveries` (FK → notices.id)
3. `notice_versions` (FK → notices.id)
4. `notice_building_targets` (FK → notices.id)
5. `notice_unit_targets` (FK → notices.id)
6. `building_timeline_events` (FK → notices.id) ← easy to forget
7. `notices` (root)

**Why:** `building_timeline_events` has a nullable FK on `notices.id` and is easy to omit. Missing it causes FK violations on cleanup.

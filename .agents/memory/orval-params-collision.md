---
name: Orval query-params TS2308 collision
description: How to prevent duplicate export errors when using Orval split mode with zod client
---

# Rule
In the Orval zod output config, do NOT include `schemas: { path: "generated/types", type: "typescript" }`.

**Why:** With `mode: "split"` and `client: "zod"`, Orval generates query-param types (e.g. `GetBuildingUnitsParams`) both as Zod schemas in `generated/api.ts` AND as TypeScript types in `generated/types/`. When the barrel (`index.ts`) does `export * from` both, TS2308 fires.

**How to apply:** Remove the `schemas` key from the zod output config (or set `schemas: undefined`). The api-zod index should only export from `"./generated/api"`.

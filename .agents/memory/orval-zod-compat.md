---
name: Orval Zod v3 compatibility
description: Orval emits Zod v4-only syntax for uuid/email formats; how to fix
---

# Rule
Remove `format: uuid` and `format: email` from any OpenAPI schema property before running Orval codegen.

**Why:** Orval v8.21 with `client: "zod"` emits `zod.uuid()` and `zod.email()` as top-level calls for properties with `format: uuid/email`. These are Zod v4 methods that don't exist in Zod v3 (`^3.x`). The workspace uses Zod v3.

**How to apply:** Run `sed -i '/format: uuid/d; /format: email/d' lib/api-spec/openapi.yaml` before codegen, or simply omit those format hints from the spec. Properties remain `type: string` without format — validation is still handled by the application.

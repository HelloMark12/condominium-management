---
name: Test API prefix
description: All supertest route calls in api-server tests must include the /api/ prefix
---

## Rule
All `request(app).get/post/patch/delete(...)` calls in api-server tests must use the `/api/` prefix because `app.ts` mounts the router at `/api`.

**Why:** `app.use("/api", router)` in app.ts means `/companies/:id` in the router is reachable at `/api/companies/:id`. Without the prefix, every route returns 404.

**How to apply:** When bulk-fixing with sed, double-quoted strings (e.g. `.get("/me/notices")`) need a separate pass from backtick strings (e.g. `.get(\`/me/notices/\${id}\``). A sed pattern matching one delimiter won't catch the other.

## Quick audit command
```bash
grep -n '\.get("/\|\.post("/\|\.patch("/\|\.delete("/' artifacts/api-server/src/test/*.test.ts | grep -v '"/api/'
```
Any result that isn't `/api/` prefixed is a bug.

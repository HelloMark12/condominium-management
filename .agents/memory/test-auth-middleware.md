---
name: Test auth middleware pattern
description: How integration tests bypass Clerk JWT validation in NODE_ENV=test
---

**Why:** Clerk JWT validation requires real Clerk tokens; integration tests need to impersonate arbitrary users.

**How to apply:**
- In `requireAuth`: if `NODE_ENV === 'test'` and header `x-test-clerk-user-id` is present, set `req.clerkUserId` directly and call `next()`. Skip Clerk `getAuth()` entirely.
- In `resolveUser`: if `NODE_ENV === 'test'` and no user row found for the clerkUserId, auto-create a `users` row so fixtures don't need to call `db.insert(usersTable)` separately.
- This header path is completely absent in production — `NODE_ENV !== 'test'` guard prevents any exposure.
- In Supertest tests: pass `{ "x-test-clerk-user-id": clerkUserId }` as a header. Use `createTestUser()` from `src/test/setup.ts` to create a user fixture with a known clerkUserId.
- Vitest config sets `env: { NODE_ENV: 'test' }` so the guard activates automatically during `pnpm test`.

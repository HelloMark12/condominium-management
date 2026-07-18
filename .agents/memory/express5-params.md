---
name: Express 5 route params type
description: req.params values are string | string[] in Express 5 — always cast
---

# Rule
Always cast Express route params before using them in Drizzle queries: `const id = req.params.id as string;`

**Why:** In Express 5, `req.params` is typed as `ParamsDictionary` where values are `string | string[]`. Drizzle's `eq()` only accepts `string | SQLWrapper`, so TypeScript errors with "Type 'string[]' is not assignable". Destructuring `const { id } = req.params` inherits the same union type.

**How to apply:** Use `const id = req.params.id as string;` (not destructuring) consistently across all route handlers.

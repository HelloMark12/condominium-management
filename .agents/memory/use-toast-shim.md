---
name: use-toast shim
description: The shadcn scaffold doesn't include use-toast.ts; create a Sonner shim
---

# Rule
When the design subagent imports `@/components/ui/use-toast`, create a Sonner-based shim at `src/components/ui/use-toast.ts`.

**Why:** The scaffold includes `sonner.tsx` (Sonner component) but not a `useToast` hook. The design subagent generates code using the classic shadcn `useToast` pattern. Without the shim, Vite throws `Failed to resolve import`.

**How to apply:** Export `useToast()` returning `{ toast }` where `toast({ title, description, variant })` delegates to `sonnerToast()`, `sonnerToast.error()`, or `sonnerToast.success()` based on `variant`.

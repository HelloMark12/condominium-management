---
name: useAppContext auth guard pattern
description: Gate useGetAuthMe on Clerk loaded + signed-in to prevent 401 loops
---

# Rule
In `AppProvider`, always guard `useGetAuthMe` with `enabled: !!(clerkLoaded && isSignedIn)` and `retry: false`.

```tsx
const { isSignedIn, isLoaded: clerkLoaded } = useAuth();
const { data: userContext, isLoading: queryLoading } = useGetAuthMe({
  query: { enabled: !!(clerkLoaded && isSignedIn), retry: false }
});
const isLoading = !clerkLoaded || (!!isSignedIn && queryLoading);
```

**Why:** Without the guard, the hook fires immediately for unauthenticated users, hitting the API with no session → 401. React Query retries 3× with backoff, keeping `isLoading: true` for several seconds and flooding logs. The `isLoading` derivation treats Clerk-not-yet-loaded as loading, so the UI never flashes incorrectly.

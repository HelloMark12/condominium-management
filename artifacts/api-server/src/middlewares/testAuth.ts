/**
 * Test-only auth middleware.
 * When NODE_ENV=test, accepts x-test-clerk-user-id header as the Clerk user ID.
 * This header is NEVER accepted in production.
 *
 * In production, getAuth() from @clerk/express always validates the real JWT.
 */

import { type Request, type Response, type NextFunction } from "express";

/**
 * Patch app to accept test auth in test environment.
 * Call this from app.ts when NODE_ENV === 'test'.
 */
export function installTestAuthPatch(): void {
  // Monkey-patch getAuth to read from test header when x-test-clerk-user-id is present.
  // We do this by intercepting the clerkMiddleware behavior at the middleware level.
  // The actual patch is applied in requireAuth via a shared flag.
}

/**
 * Middleware that reads x-test-clerk-user-id and attaches it as clerkUserId.
 * Only active in test environment.
 */
export function testAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (process.env["NODE_ENV"] !== "test") {
    next();
    return;
  }
  const testUserId = req.headers["x-test-clerk-user-id"] as string | undefined;
  if (testUserId) {
    // Attach as if Clerk validated it
    (req as Request & { _testClerkUserId: string })._testClerkUserId = testUserId;
  }
  next();
}

import { type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import type { User } from "@workspace/db";

export interface AuthenticatedRequest extends Request {
  clerkUserId: string;
  user: User;
}

/**
 * Require a valid Clerk session. Attaches req.clerkUserId.
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  if (!clerkUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as AuthenticatedRequest).clerkUserId = clerkUserId;
  next();
}

/**
 * Resolve (or JIT-create) the local user record from the Clerk user ID.
 * Must be called after requireAuth.
 */
export async function resolveUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authReq = req as AuthenticatedRequest;
  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, authReq.clerkUserId))
      .limit(1);

    if (!user) {
      res.status(401).json({ error: "User not found. Please sync your account." });
      return;
    }
    authReq.user = user;
    next();
  } catch (err) {
    req.log.error({ err }, "resolveUser error");
    res.status(500).json({ error: "Internal server error" });
  }
}

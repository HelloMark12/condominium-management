import { type Request, type Response, type NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import { db, companiesTable, companyMembershipsTable } from "@workspace/db";
import type { Company, CompanyMembership } from "@workspace/db";
import type { AuthenticatedRequest } from "./auth";

export interface CompanyRequest extends AuthenticatedRequest {
  company: Company;
  companyMembership: CompanyMembership;
}

/**
 * Resolve the company from the X-Company-Id header and verify the user is a member.
 * Attaches req.company and req.companyMembership.
 */
export async function resolveCompanyContext(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authReq = req as AuthenticatedRequest;
  const companyId =
    (req.headers["x-company-id"] as string) ||
    (req.params["companyId"] as string);

  if (!companyId) {
    res.status(400).json({ error: "Company context required (X-Company-Id header or companyId param)" });
    return;
  }

  try {
    const [company] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.id, companyId))
      .limit(1);

    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }

    const [membership] = await db
      .select()
      .from(companyMembershipsTable)
      .where(
        and(
          eq(companyMembershipsTable.companyId, companyId),
          eq(companyMembershipsTable.userId, authReq.user.id),
        ),
      )
      .limit(1);

    if (!membership) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    (req as CompanyRequest).company = company;
    (req as CompanyRequest).companyMembership = membership;
    next();
  } catch (err) {
    req.log.error({ err }, "resolveCompanyContext error");
    res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * Require the current user to be an administrator of the resolved company.
 * Must be called after resolveCompanyContext.
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const companyReq = req as CompanyRequest;
  if (companyReq.companyMembership?.role !== "administrator") {
    res.status(403).json({ error: "Administrator access required" });
    return;
  }
  next();
}

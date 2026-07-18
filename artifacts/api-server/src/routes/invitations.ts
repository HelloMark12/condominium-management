import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import {
  db,
  unitsTable,
  unitMembershipsTable,
  usersTable,
  buildingsTable,
  companyMembershipsTable,
} from "@workspace/db";
import { requireAuth, resolveUser, type AuthenticatedRequest } from "../middlewares/auth";
import {
  resolveCompanyContext,
  requireAdmin,
  type CompanyRequest,
} from "../middlewares/company";

const router = Router();

const INVITATION_EXPIRY_DAYS = 7;

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

function expiryDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() + INVITATION_EXPIRY_DAYS);
  return d;
}

/** PostgreSQL unique-violation error code. */
const PG_UNIQUE_VIOLATION = "23505";

/**
 * Drizzle wraps the underlying pg error in a DrizzleQueryError whose `code`
 * property is undefined at the top level; the PG error code lives on the
 * `.cause` (or `.cause.cause`) of the wrapped error.  Walk the chain so that
 * concurrent requests that bypass the application-level pre-check still get
 * a 409 rather than a 500.
 */
function isPgUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  while (current != null && typeof current === "object") {
    if ((current as Record<string, unknown>)["code"] === PG_UNIQUE_VIOLATION) {
      return true;
    }
    current = (current as Record<string, unknown>)["cause"];
  }
  return false;
}

// ── GET /companies/:companyId/invitations ─────────────────────────────────────

router.get(
  "/companies/:companyId/invitations",
  requireAuth,
  resolveUser,
  resolveCompanyContext,
  requireAdmin,
  async (req, res) => {
    const companyReq = req as CompanyRequest;
    const statusFilter = (req.query["status"] as string) ?? "pending";

    try {
      const memberships = await db
        .select({
          membership: unitMembershipsTable,
          unit: unitsTable,
          building: buildingsTable,
        })
        .from(unitMembershipsTable)
        .innerJoin(unitsTable, eq(unitMembershipsTable.unitId, unitsTable.id))
        .innerJoin(buildingsTable, eq(unitsTable.buildingId, buildingsTable.id))
        .where(eq(unitMembershipsTable.companyId, companyReq.company.id))
        .then((rows) => {
          if (statusFilter === "all") return rows;
          return rows.filter((r) => r.membership.status === statusFilter);
        });

      const result = memberships.map((r) => ({
        ...r.membership,
        unit: r.unit,
        building: r.building,
      }));

      res.json(result);
    } catch (err) {
      req.log.error({ err }, "GET /companies/:id/invitations error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /units/:unitId/invite-owner ──────────────────────────────────────────

router.post(
  "/units/:unitId/invite-owner",
  requireAuth,
  resolveUser,
  async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const unitId = req.params["unitId"] as string;
    const { invitedName, invitedEmail } = req.body as {
      invitedName?: string;
      invitedEmail?: string;
    };

    if (!invitedName?.trim() || !invitedEmail?.trim()) {
      res.status(400).json({ error: "Name and email are required" });
      return;
    }

    try {
      const [unit] = await db
        .select()
        .from(unitsTable)
        .where(eq(unitsTable.id, unitId))
        .limit(1);

      if (!unit) {
        res.status(404).json({ error: "Apartment not found" });
        return;
      }

      // C4 FIX: block invitations to archived apartments
      if (unit.status !== "active") {
        res.status(422).json({
          error: "Cannot send an invitation for an archived apartment",
        });
        return;
      }

      // Must be company administrator
      const [adminMembership] = await db
        .select()
        .from(companyMembershipsTable)
        .where(
          and(
            eq(companyMembershipsTable.companyId, unit.companyId),
            eq(companyMembershipsTable.userId, authReq.user.id),
          ),
        )
        .limit(1);

      if (!adminMembership) {
        res.status(403).json({ error: "Administrator access required" });
        return;
      }

      // Application-level pre-check (H1): block if active or pending owner already exists.
      // The database partial unique index is the final enforcement layer (Issue 5 fix:
      // any race that bypasses this pre-check is caught as PG error 23505 → HTTP 409).
      const existingOwnerRows = await db
        .select()
        .from(unitMembershipsTable)
        .where(
          and(
            eq(unitMembershipsTable.unitId, unitId),
            eq(unitMembershipsTable.role, "owner"),
          ),
        );

      const existingOwner = existingOwnerRows.find(
        (r) => r.status === "active" || r.status === "pending",
      );

      if (existingOwner) {
        res.status(409).json({
          error:
            "This apartment already has an active or pending owner. Revoke the existing one first.",
        });
        return;
      }

      const token = generateToken();

      // Issue 5 FIX: catch PostgreSQL 23505 (unique violation on partial index um_one_owner_per_unit)
      // so that concurrent requests that both pass the application-level pre-check above do not
      // produce a raw 500 — exactly one succeeds, the other gets 409.
      let membership;
      try {
        [membership] = await db
          .insert(unitMembershipsTable)
          .values({
            unitId,
            companyId: unit.companyId,
            role: "owner",
            status: "pending",
            invitedName: invitedName.trim(),
            invitedEmail: invitedEmail.trim().toLowerCase(),
            invitedByUserId: authReq.user.id,
            invitationToken: token,
            invitationExpiresAt: expiryDate(),
          })
          .returning();
      } catch (insertErr: unknown) {
        if (isPgUniqueViolation(insertErr)) {
          res.status(409).json({
            error:
              "This apartment already has an active or pending owner. Revoke the existing one first.",
          });
          return;
        }
        throw insertErr;
      }

      res.status(201).json(membership);
    } catch (err) {
      req.log.error({ err }, "POST /units/:id/invite-owner error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /units/:unitId/invite-tenant ─────────────────────────────────────────

router.post(
  "/units/:unitId/invite-tenant",
  requireAuth,
  resolveUser,
  async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const unitId = req.params["unitId"] as string;
    const { invitedName, invitedEmail } = req.body as {
      invitedName?: string;
      invitedEmail?: string;
    };

    if (!invitedName?.trim() || !invitedEmail?.trim()) {
      res.status(400).json({ error: "Name and email are required" });
      return;
    }

    try {
      const [unit] = await db
        .select()
        .from(unitsTable)
        .where(eq(unitsTable.id, unitId))
        .limit(1);

      if (!unit) {
        res.status(404).json({ error: "Apartment not found" });
        return;
      }

      // C4 FIX: block invitations to archived apartments
      if (unit.status !== "active") {
        res.status(422).json({
          error: "Cannot send an invitation for an archived apartment",
        });
        return;
      }

      // Must be company administrator
      const [adminMembership] = await db
        .select()
        .from(companyMembershipsTable)
        .where(
          and(
            eq(companyMembershipsTable.companyId, unit.companyId),
            eq(companyMembershipsTable.userId, authReq.user.id),
          ),
        )
        .limit(1);

      if (!adminMembership) {
        res.status(403).json({ error: "Administrator access required" });
        return;
      }

      // Application-level pre-check (H2): block if active or pending tenant already exists.
      // The database partial unique index is the final enforcement layer (Issue 5 fix:
      // any race that bypasses this pre-check is caught as PG error 23505 → HTTP 409).
      const existingTenantRows = await db
        .select()
        .from(unitMembershipsTable)
        .where(
          and(
            eq(unitMembershipsTable.unitId, unitId),
            eq(unitMembershipsTable.role, "tenant"),
          ),
        );

      const existingTenant = existingTenantRows.find(
        (r) => r.status === "active" || r.status === "pending",
      );

      if (existingTenant) {
        res.status(409).json({
          error:
            "This apartment already has an active or pending tenant. Revoke the existing one first.",
        });
        return;
      }

      const token = generateToken();

      // Issue 5 FIX: catch PostgreSQL 23505 (unique violation on partial index um_one_tenant_per_unit)
      // so that concurrent requests that both pass the pre-check produce 409, not 500.
      let membership;
      try {
        [membership] = await db
          .insert(unitMembershipsTable)
          .values({
            unitId,
            companyId: unit.companyId,
            role: "tenant",
            status: "pending",
            invitedName: invitedName.trim(),
            invitedEmail: invitedEmail.trim().toLowerCase(),
            invitedByUserId: authReq.user.id,
            invitationToken: token,
            invitationExpiresAt: expiryDate(),
          })
          .returning();
      } catch (insertErr: unknown) {
        if (isPgUniqueViolation(insertErr)) {
          res.status(409).json({
            error:
              "This apartment already has an active or pending tenant. Revoke the existing one first.",
          });
          return;
        }
        throw insertErr;
      }

      res.status(201).json(membership);
    } catch (err) {
      req.log.error({ err }, "POST /units/:id/invite-tenant error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── DELETE /unit-memberships/:membershipId ────────────────────────────────────

router.delete(
  "/unit-memberships/:membershipId",
  requireAuth,
  resolveUser,
  async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const membershipId = req.params["membershipId"] as string;

    try {
      // H3: load exactly the target membership (scoped by ID)
      const [membership] = await db
        .select()
        .from(unitMembershipsTable)
        .where(eq(unitMembershipsTable.id, membershipId))
        .limit(1);

      if (!membership) {
        res.status(404).json({ error: "Membership not found" });
        return;
      }

      if (membership.status === "revoked") {
        res.status(409).json({ error: "Already revoked" });
        return;
      }

      // Must be company admin to revoke
      const [adminMembership] = await db
        .select()
        .from(companyMembershipsTable)
        .where(
          and(
            eq(companyMembershipsTable.companyId, membership.companyId),
            eq(companyMembershipsTable.userId, authReq.user.id),
          ),
        )
        .limit(1);

      if (!adminMembership) {
        res.status(403).json({ error: "Administrator access required" });
        return;
      }

      const now = new Date();
      const [revoked] = await db
        .update(unitMembershipsTable)
        .set({
          status: "revoked",
          revokedAt: now,
          invitationToken: null,
          updatedAt: now,
        })
        .where(eq(unitMembershipsTable.id, membershipId)) // H3: scoped to exact target
        .returning();

      res.json(revoked);
    } catch (err) {
      req.log.error({ err }, "DELETE /unit-memberships/:id error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /unit-memberships/:membershipId/resend ───────────────────────────────

router.post(
  "/unit-memberships/:membershipId/resend",
  requireAuth,
  resolveUser,
  async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const membershipId = req.params["membershipId"] as string;

    try {
      const [membership] = await db
        .select()
        .from(unitMembershipsTable)
        .where(eq(unitMembershipsTable.id, membershipId))
        .limit(1);

      if (!membership) {
        res.status(404).json({ error: "Membership not found" });
        return;
      }

      if (membership.status !== "pending") {
        res.status(409).json({
          error: "Only pending invitations can be resent",
        });
        return;
      }

      const [adminMembership] = await db
        .select()
        .from(companyMembershipsTable)
        .where(
          and(
            eq(companyMembershipsTable.companyId, membership.companyId),
            eq(companyMembershipsTable.userId, authReq.user.id),
          ),
        )
        .limit(1);

      if (!adminMembership) {
        res.status(403).json({ error: "Administrator access required" });
        return;
      }

      const newToken = generateToken();
      const now = new Date();
      const [updated] = await db
        .update(unitMembershipsTable)
        .set({
          invitationToken: newToken,
          invitationExpiresAt: expiryDate(),
          updatedAt: now,
        })
        .where(eq(unitMembershipsTable.id, membershipId))
        .returning();

      res.json(updated);
    } catch (err) {
      req.log.error({ err }, "POST /unit-memberships/:id/resend error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /invitations/accept ──────────────────────────────────────────────────

router.post("/invitations/accept", requireAuth, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const { token } = req.body as { token?: string };

  if (!token?.trim()) {
    res.status(400).json({ error: "Invitation token is required" });
    return;
  }

  try {
    const [membership] = await db
      .select()
      .from(unitMembershipsTable)
      .where(eq(unitMembershipsTable.invitationToken, token.trim()))
      .limit(1);

    if (!membership) {
      res.status(404).json({ error: "Invalid or already used invitation token" });
      return;
    }
    if (membership.status === "revoked") {
      res.status(410).json({ error: "This invitation has been revoked" });
      return;
    }
    if (membership.status === "active") {
      res.status(409).json({ error: "Invitation already accepted" });
      return;
    }
    if (
      membership.invitationExpiresAt &&
      new Date() > membership.invitationExpiresAt
    ) {
      res.status(400).json({
        error: "This invitation has expired. Please ask for a new one.",
      });
      return;
    }

    // C4 FIX: block accepting invitations for archived apartments
    const [unit] = await db
      .select()
      .from(unitsTable)
      .where(eq(unitsTable.id, membership.unitId))
      .limit(1);

    if (!unit || unit.status !== "active") {
      res.status(422).json({
        error: "This apartment has been archived and is no longer accepting invitations",
      });
      return;
    }

    // Resolve local user (must be synced)
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, authReq.clerkUserId))
      .limit(1);

    if (!user) {
      res.status(401).json({
        error: "User not found. Call /auth/sync first.",
      });
      return;
    }

    // C5 FIX: verify that the accepting user's email matches the invited email (case-insensitive)
    const acceptingEmail = user.email.toLowerCase().trim();
    const invitedEmail = membership.invitedEmail.toLowerCase().trim();
    if (acceptingEmail !== invitedEmail) {
      res.status(403).json({
        error:
          "This invitation was sent to a different email address. Please sign in with the invited email.",
      });
      return;
    }

    const now = new Date();
    const [updated] = await db
      .update(unitMembershipsTable)
      .set({
        userId: user.id,
        status: "active",
        activatedAt: now,
        invitationToken: null, // single-use: clear token on acceptance
        updatedAt: now,
      })
      .where(eq(unitMembershipsTable.id, membership.id))
      .returning();

    const redirectTo =
      membership.role === "owner" ? "/owner/home" : "/tenant/home";

    res.json({ membership: updated, role: membership.role, redirectTo });
  } catch (err) {
    req.log.error({ err }, "POST /invitations/accept error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

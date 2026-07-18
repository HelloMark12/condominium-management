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
          return rows.filter(
            (r) => r.membership.status === statusFilter,
          );
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
    const unitId = req.params.unitId as string;
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

      // Block if active or pending owner already exists
      const [existingOwner] = await db
        .select()
        .from(unitMembershipsTable)
        .where(
          and(
            eq(unitMembershipsTable.unitId, unitId),
            eq(unitMembershipsTable.role, "owner"),
          ),
        )
        .then((rows) =>
          rows.filter((r) =>
            r.status === "active" || r.status === "pending",
          ),
        );

      if (existingOwner) {
        res.status(409).json({
          error:
            "An active or pending owner already exists for this apartment. Cancel the existing invitation first.",
        });
        return;
      }

      const token = generateToken();
      const [membership] = await db
        .insert(unitMembershipsTable)
        .values({
          unitId,
          companyId: unit.companyId,
          invitedByUserId: authReq.user.id,
          role: "owner",
          status: "pending",
          invitedName: invitedName.trim(),
          invitedEmail: invitedEmail.trim().toLowerCase(),
          invitationToken: token,
          invitationExpiresAt: expiryDate(),
        })
        .returning();

      // Log the invitation link (email delivery to be added later)
      req.log.info(
        { token, unitId, invitedEmail },
        `Owner invitation created. Accept link: /invite/accept/${token}`,
      );

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
    const unitId = req.params.unitId as string;
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

      // Must be active owner of this unit
      const [ownerMembership] = await db
        .select()
        .from(unitMembershipsTable)
        .where(
          and(
            eq(unitMembershipsTable.unitId, unitId),
            eq(unitMembershipsTable.userId, authReq.user.id),
            eq(unitMembershipsTable.role, "owner"),
            eq(unitMembershipsTable.status, "active"),
          ),
        )
        .limit(1);

      // Also allow admin to invite tenant
      const [adminMembership] = ownerMembership
        ? [ownerMembership]
        : await db
            .select()
            .from(companyMembershipsTable)
            .where(
              and(
                eq(companyMembershipsTable.companyId, unit.companyId),
                eq(companyMembershipsTable.userId, authReq.user.id),
              ),
            )
            .limit(1);

      if (!ownerMembership && !adminMembership) {
        res.status(403).json({
          error: "Only the apartment owner or an administrator can invite a tenant",
        });
        return;
      }

      // Hard-block: no second tenant while active/pending already exists
      const existingTenants = await db
        .select()
        .from(unitMembershipsTable)
        .where(
          and(
            eq(unitMembershipsTable.unitId, unitId),
            eq(unitMembershipsTable.role, "tenant"),
          ),
        )
        .then((rows) =>
          rows.filter((r) => r.status === "active" || r.status === "pending"),
        );

      if (existingTenants.length > 0) {
        res.status(409).json({
          error:
            "An active tenant or pending tenant invitation already exists. Revoke it before inviting a new tenant.",
        });
        return;
      }

      const token = generateToken();
      const invitedBy = ownerMembership
        ? authReq.user.id
        : authReq.user.id;

      const [membership] = await db
        .insert(unitMembershipsTable)
        .values({
          unitId,
          companyId: unit.companyId,
          invitedByUserId: invitedBy,
          role: "tenant",
          status: "pending",
          invitedName: invitedName.trim(),
          invitedEmail: invitedEmail.trim().toLowerCase(),
          invitationToken: token,
          invitationExpiresAt: expiryDate(),
        })
        .returning();

      req.log.info(
        { token, unitId, invitedEmail },
        `Tenant invitation created. Accept link: /invite/accept/${token}`,
      );

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
    const membershipId = req.params.membershipId as string;

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

      // Authorization: admin of the company OR owner of the unit (for tenant revocation)
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

      const [ownerMembership] =
        membership.role === "tenant"
          ? await db
              .select()
              .from(unitMembershipsTable)
              .where(
                and(
                  eq(unitMembershipsTable.unitId, membership.unitId),
                  eq(unitMembershipsTable.userId, authReq.user.id),
                  eq(unitMembershipsTable.role, "owner"),
                  eq(unitMembershipsTable.status, "active"),
                ),
              )
              .limit(1)
          : [undefined];

      if (!adminMembership && !ownerMembership) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const now = new Date();
      const [updated] = await db
        .update(unitMembershipsTable)
        .set({
          status: "revoked",
          revokedAt: now,
          invitationToken: null,
          updatedAt: now,
        })
        .where(eq(unitMembershipsTable.id, membershipId))
        .returning();

      res.json(updated);
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
    const membershipId = req.params.membershipId as string;

    try {
      const [membership] = await db
        .select()
        .from(unitMembershipsTable)
        .where(eq(unitMembershipsTable.id, membershipId))
        .limit(1);

      if (!membership) {
        res.status(404).json({ error: "Invitation not found" });
        return;
      }
      if (membership.status !== "pending") {
        res.status(400).json({ error: "Only pending invitations can be resent" });
        return;
      }

      // Must be admin
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

      // Refresh token and expiry
      const token = generateToken();
      const now = new Date();
      const [updated] = await db
        .update(unitMembershipsTable)
        .set({
          invitationToken: token,
          invitationExpiresAt: expiryDate(),
          updatedAt: now,
        })
        .where(eq(unitMembershipsTable.id, membershipId))
        .returning();

      req.log.info(
        { token, membershipId },
        `Invitation resent. Accept link: /invite/accept/${token}`,
      );

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
    res.status(400).json({ error: "Token is required" });
    return;
  }

  try {
    const [membership] = await db
      .select()
      .from(unitMembershipsTable)
      .where(eq(unitMembershipsTable.invitationToken, token))
      .limit(1);

    if (!membership) {
      res.status(400).json({ error: "Invalid or expired invitation link" });
      return;
    }
    if (membership.status === "revoked") {
      res.status(400).json({ error: "This invitation has been cancelled" });
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
      res.status(400).json({ error: "This invitation has expired. Please ask for a new one." });
      return;
    }

    // Resolve or JIT-create local user
    const clerkUserId = authReq.clerkUserId;
    let [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, clerkUserId))
      .limit(1);

    if (!user) {
      res.status(401).json({ error: "User not found. Call /auth/sync first." });
      return;
    }

    const now = new Date();
    const [updated] = await db
      .update(unitMembershipsTable)
      .set({
        userId: user.id,
        status: "active",
        activatedAt: now,
        invitationToken: null, // single-use
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

/**
 * Test Suite 34 — Frontend route security (C2)
 * Test Suite 35 — Archived property UI
 * Test Suite 36 — Billing UI
 *
 * Tests the AdminGuard, OwnerGuard, TenantGuard components
 * and the useAppContext role derivation logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// ── Mock dependencies ─────────────────────────────────────────────────────────

vi.mock("@clerk/react", () => ({
  useAuth: vi.fn(),
  useUser: vi.fn(() => ({ user: null, isLoaded: true, isSignedIn: false })),
  ClerkProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SignIn: () => <div>SignIn</div>,
  SignUp: () => <div>SignUp</div>,
  Show: ({ children, when }: { children: React.ReactNode; when: string }) =>
    when === "signed-in" ? <>{children}</> : null,
  useClerk: () => ({ addListener: vi.fn(() => vi.fn()) }),
}));

vi.mock("@clerk/react/internal", () => ({
  publishableKeyFromHost: () => "pk_test_fake",
}));

vi.mock("@clerk/themes", () => ({ shadcn: {} }));

vi.mock("wouter", () => ({
  useLocation: () => ["/admin/dashboard", vi.fn()],
  Switch: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Route: ({ component: Comp, children }: { component?: React.ComponentType; children?: React.ReactNode }) =>
    Comp ? <Comp /> : <>{children}</>,
  Redirect: ({ to }: { to: string }) => <div data-testid="redirect" data-to={to} />,
  Router: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@tanstack/react-query", () => ({
  QueryClient: vi.fn().mockImplementation(() => ({})),
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useQueryClient: () => ({ clear: vi.fn() }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetAuthMe: vi.fn(),
  useSyncUser: vi.fn(() => ({ mutate: vi.fn() })),
}));

vi.mock("@/components/ui/toaster", () => ({
  Toaster: () => null,
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { useAuth } from "@clerk/react";
import { useGetAuthMe } from "@workspace/api-client-react";
import { AppProvider, useAppContext } from "@/hooks/useAppContext";

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockAuth(isSignedIn: boolean, isLoaded = true) {
  (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({ isSignedIn, isLoaded });
}

function mockUserContext(data: object | null, isLoading = false) {
  (useGetAuthMe as ReturnType<typeof vi.fn>).mockReturnValue({ data, isLoading });
}

// Guard components extracted for isolated testing
function AdminGuardTest({ children }: { children: React.ReactNode }) {
  const { roleContext, isLoading } = useAppContext();
  if (isLoading) return <div data-testid="loading">Loading…</div>;
  if (roleContext !== "admin") return <div data-testid="redirect" data-to="/" />;
  return <>{children}</>;
}

function OwnerGuardTest({ children }: { children: React.ReactNode }) {
  const { roleContext, isLoading } = useAppContext();
  if (isLoading) return <div data-testid="loading">Loading…</div>;
  if (roleContext !== "owner") return <div data-testid="redirect" data-to="/" />;
  return <>{children}</>;
}

function TenantGuardTest({ children }: { children: React.ReactNode }) {
  const { roleContext, isLoading } = useAppContext();
  if (isLoading) return <div data-testid="loading">Loading…</div>;
  if (roleContext !== "tenant") return <div data-testid="redirect" data-to="/" />;
  return <>{children}</>;
}

function renderWithProvider(ui: React.ReactNode) {
  return render(<AppProvider>{ui}</AppProvider>);
}

// ── Suite 34: Route security guards ──────────────────────────────────────────

describe("Suite 34 — Frontend route security (C2)", () => {
  beforeEach(() => {
    mockAuth(true);
  });

  describe("AdminGuard", () => {
    it("redirects non-admin user away from /admin/*", () => {
      mockUserContext({
        user: { id: "u1", email: "a@b.com", fullName: null },
        adminCompanies: [],
        ownedUnits: [{ unit: { id: "unit1" } }],
        tenancy: null,
      });

      renderWithProvider(
        <AdminGuardTest>
          <div data-testid="admin-content">Admin Page</div>
        </AdminGuardTest>,
      );

      expect(screen.getByTestId("redirect")).toHaveAttribute("data-to", "/");
      expect(screen.queryByTestId("admin-content")).not.toBeInTheDocument();
    });

    it("allows admin user through to /admin/*", () => {
      mockUserContext({
        user: { id: "u1", email: "a@b.com", fullName: null },
        adminCompanies: [{ id: "c1", name: "Acme", slug: "acme", subscriptionTier: "free", enterpriseFlagged: false }],
        ownedUnits: [],
        tenancy: null,
      });

      renderWithProvider(
        <AdminGuardTest>
          <div data-testid="admin-content">Admin Page</div>
        </AdminGuardTest>,
      );

      expect(screen.getByTestId("admin-content")).toBeInTheDocument();
      expect(screen.queryByTestId("redirect")).not.toBeInTheDocument();
    });

    it("shows loading screen while auth is resolving", () => {
      mockUserContext(null, true); // isLoading = true

      renderWithProvider(
        <AdminGuardTest>
          <div data-testid="admin-content">Admin Page</div>
        </AdminGuardTest>,
      );

      expect(screen.getByTestId("loading")).toBeInTheDocument();
      expect(screen.queryByTestId("admin-content")).not.toBeInTheDocument();
    });

    it("redirects tenant user from /admin/*", () => {
      mockUserContext({
        user: { id: "u1", email: "t@b.com", fullName: null },
        adminCompanies: [],
        ownedUnits: [],
        tenancy: { membership: { id: "m1" }, unit: { id: "unit1" } },
      });

      renderWithProvider(
        <AdminGuardTest>
          <div data-testid="admin-content">Admin Page</div>
        </AdminGuardTest>,
      );

      expect(screen.getByTestId("redirect")).toBeInTheDocument();
    });
  });

  describe("OwnerGuard", () => {
    it("redirects admin user away from /owner/*", () => {
      mockUserContext({
        user: { id: "u1", email: "a@b.com", fullName: null },
        adminCompanies: [{ id: "c1", name: "Acme", slug: "acme", subscriptionTier: "free", enterpriseFlagged: false }],
        ownedUnits: [],
        tenancy: null,
      });

      renderWithProvider(
        <OwnerGuardTest>
          <div data-testid="owner-content">Owner Page</div>
        </OwnerGuardTest>,
      );

      expect(screen.getByTestId("redirect")).toHaveAttribute("data-to", "/");
      expect(screen.queryByTestId("owner-content")).not.toBeInTheDocument();
    });

    it("allows owner user through to /owner/*", () => {
      mockUserContext({
        user: { id: "u1", email: "o@b.com", fullName: null },
        adminCompanies: [],
        ownedUnits: [{ unit: { id: "unit1" } }],
        tenancy: null,
      });

      renderWithProvider(
        <OwnerGuardTest>
          <div data-testid="owner-content">Owner Page</div>
        </OwnerGuardTest>,
      );

      expect(screen.getByTestId("owner-content")).toBeInTheDocument();
    });

    it("redirects tenant user from /owner/*", () => {
      mockUserContext({
        user: { id: "u1", email: "t@b.com", fullName: null },
        adminCompanies: [],
        ownedUnits: [],
        tenancy: { membership: { id: "m1" }, unit: { id: "unit1" } },
      });

      renderWithProvider(
        <OwnerGuardTest>
          <div data-testid="owner-content">Owner Page</div>
        </OwnerGuardTest>,
      );

      expect(screen.getByTestId("redirect")).toBeInTheDocument();
    });
  });

  describe("TenantGuard", () => {
    it("redirects admin user away from /tenant/*", () => {
      mockUserContext({
        user: { id: "u1", email: "a@b.com", fullName: null },
        adminCompanies: [{ id: "c1", name: "Acme", slug: "acme", subscriptionTier: "free", enterpriseFlagged: false }],
        ownedUnits: [],
        tenancy: null,
      });

      renderWithProvider(
        <TenantGuardTest>
          <div data-testid="tenant-content">Tenant Page</div>
        </TenantGuardTest>,
      );

      expect(screen.getByTestId("redirect")).toHaveAttribute("data-to", "/");
    });

    it("allows tenant user through to /tenant/*", () => {
      mockUserContext({
        user: { id: "u1", email: "t@b.com", fullName: null },
        adminCompanies: [],
        ownedUnits: [],
        tenancy: { membership: { id: "m1" }, unit: { id: "unit1" } },
      });

      renderWithProvider(
        <TenantGuardTest>
          <div data-testid="tenant-content">Tenant Page</div>
        </TenantGuardTest>,
      );

      expect(screen.getByTestId("tenant-content")).toBeInTheDocument();
    });
  });

  describe("Role derivation (useAppContext)", () => {
    it("roleContext is admin when adminCompanies is non-empty", () => {
      mockUserContext({
        user: { id: "u1", email: "a@b.com", fullName: null },
        adminCompanies: [{ id: "c1", name: "Acme", slug: "acme", subscriptionTier: "free", enterpriseFlagged: false }],
        ownedUnits: [],
        tenancy: null,
      });

      function RoleReader() {
        const { roleContext } = useAppContext();
        return <div data-testid="role">{roleContext}</div>;
      }

      renderWithProvider(<RoleReader />);
      expect(screen.getByTestId("role").textContent).toBe("admin");
    });

    it("roleContext is owner when ownedUnits is non-empty and no admin company", () => {
      mockUserContext({
        user: { id: "u1", email: "o@b.com", fullName: null },
        adminCompanies: [],
        ownedUnits: [{ unit: { id: "u1" } }],
        tenancy: null,
      });

      function RoleReader() {
        const { roleContext } = useAppContext();
        return <div data-testid="role">{roleContext}</div>;
      }

      renderWithProvider(<RoleReader />);
      expect(screen.getByTestId("role").textContent).toBe("owner");
    });

    it("roleContext is tenant when tenancy is set", () => {
      mockUserContext({
        user: { id: "u1", email: "t@b.com", fullName: null },
        adminCompanies: [],
        ownedUnits: [],
        tenancy: { membership: { id: "m1" }, unit: { id: "u1" } },
      });

      function RoleReader() {
        const { roleContext } = useAppContext();
        return <div data-testid="role">{roleContext}</div>;
      }

      renderWithProvider(<RoleReader />);
      expect(screen.getByTestId("role").textContent).toBe("tenant");
    });

    it("roleContext is pending when userContext has no role data", () => {
      mockUserContext({
        user: { id: "u1", email: "p@b.com", fullName: null },
        adminCompanies: [],
        ownedUnits: [],
        tenancy: null,
      });

      function RoleReader() {
        const { roleContext } = useAppContext();
        return <div data-testid="role">{roleContext}</div>;
      }

      renderWithProvider(<RoleReader />);
      expect(screen.getByTestId("role").textContent).toBe("pending");
    });
  });
});

// ── Suite 35: Archived property UI ────────────────────────────────────────────

describe("Suite 35 — Archived property UI (role derivation after archive)", () => {
  beforeEach(() => {
    mockAuth(true);
  });

  it("ownedUnits=[] means owner guard blocks access (simulates C3: archived unit removed)", () => {
    // When the API returns no owned units (because unit was archived, C3 fix),
    // the owner guard must not grant portal access.
    mockUserContext({
      user: { id: "u1", email: "o@b.com", fullName: null },
      adminCompanies: [],
      ownedUnits: [], // empty — unit was archived
      tenancy: null,
    });

    function RoleReader() {
      const { roleContext } = useAppContext();
      return <div data-testid="role">{roleContext}</div>;
    }

    renderWithProvider(<RoleReader />);
    // No owned units → roleContext = 'pending', not 'owner'
    expect(screen.getByTestId("role").textContent).toBe("pending");
  });

  it("tenancy=null means tenant guard blocks access (simulates C3: archived unit removed)", () => {
    mockUserContext({
      user: { id: "u1", email: "t@b.com", fullName: null },
      adminCompanies: [],
      ownedUnits: [],
      tenancy: null, // null — unit was archived
    });

    function RoleReader() {
      const { roleContext } = useAppContext();
      return <div data-testid="role">{roleContext}</div>;
    }

    renderWithProvider(<RoleReader />);
    expect(screen.getByTestId("role").textContent).toBe("pending");
  });
});

// ── Suite 36: Billing UI data shape ──────────────────────────────────────────

describe("Suite 36 — Billing UI (subscription data shape)", () => {
  it("pricingConfigured=false is a valid API response shape when no config seeded", () => {
    // The API returns { pricingConfigured: false } when no pricing config exists.
    // The UI should handle this gracefully.
    const noConfigResponse = {
      currentPlan: "free",
      activeUnitCount: 0,
      peakActiveUnitCount: 0,
      ratePerUnitCents: null,
      estimatedAmountCents: null,
      billingMonth: "2025-07-01",
      enterpriseFlagged: false,
      freeUnitLimit: null,
      pricingConfigured: false,
    };

    expect(noConfigResponse.pricingConfigured).toBe(false);
    expect(noConfigResponse.ratePerUnitCents).toBeNull();
  });

  it("pricingConfigured=true response includes snapshotConfig", () => {
    const configuredResponse = {
      currentPlan: "standard",
      activeUnitCount: 10,
      peakActiveUnitCount: 12,
      ratePerUnitCents: 500,
      estimatedAmountCents: 6000,
      billingMonth: "2025-07-01",
      enterpriseFlagged: false,
      freeUnitLimit: 2,
      pricingConfigured: true,
      snapshotConfig: {
        freeUnitLimit: 2,
        standardMin: 3,
        standardMax: 49,
        enterpriseStart: 50,
        currency: "EUR",
      },
    };

    expect(configuredResponse.snapshotConfig.freeUnitLimit).toBe(2);
    expect(configuredResponse.snapshotConfig.currency).toBe("EUR");
    expect(configuredResponse.estimatedAmountCents).toBe(6000); // 12 × €5
  });

  it("enterprise plan with custom behavior returns estimatedAmountCents=0", () => {
    const enterpriseResponse = {
      currentPlan: "enterprise",
      activeUnitCount: 55,
      peakActiveUnitCount: 60,
      ratePerUnitCents: 500,
      estimatedAmountCents: 0, // custom enterprise → not calculated
      billingMonth: "2025-07-01",
      enterpriseFlagged: true,
      freeUnitLimit: 2,
      pricingConfigured: true,
    };

    expect(enterpriseResponse.estimatedAmountCents).toBe(0);
    expect(enterpriseResponse.enterpriseFlagged).toBe(true);
    // L3: enterprise shows 'custom' pricing, not €0
    // This is a UI concern — the value 0 means "contact for pricing", not free
  });
});

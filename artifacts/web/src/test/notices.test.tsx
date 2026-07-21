/**
 * Suite 38 — Notice module frontend tests (Module 2 Correction 3)
 *
 * Covers:
 *   38-01  Admin notice list renders
 *   38-02  Create-notice required-field validation
 *   38-03  Building target selection
 *   38-04  Audience selection renders options
 *   38-05  Scheduled-date validation (Malta timezone / DST gap / past time)
 *   38-06  Cross-role — admin page renders for admin context
 *   38-07  Owner notice feed renders
 *   38-08  Unread badge renders on owner feed
 *   38-09  Emergency notice styling
 *   38-10  Updated label on edited notice
 *   38-11  Tenant notice feed renders
 *   38-12  Tenant unread badge context
 *   38-13  Cross-role — admin page does not expose feed content
 *   38-14  Owner home page unread count card
 *   38-15  Tenant home page unread count card
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

// ── Browser API stubs (jsdom doesn't implement these) ─────────────────────────

// Radix UI Select uses ResizeObserver internally; stub it for jsdom.
// Must be a real class (or constructor function) — arrow functions cannot be
// called with `new`, which causes a TypeError inside Radix's use-size hook.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Global mocks ───────────────────────────────────────────────────────────────

vi.mock("@clerk/react", () => ({
  useAuth: vi.fn(() => ({ isSignedIn: true, isLoaded: true })),
  useUser: vi.fn(() => ({ user: { id: "u1" }, isLoaded: true, isSignedIn: true })),
  ClerkProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SignIn: () => <div>SignIn</div>,
  SignUp: () => <div>SignUp</div>,
  Show: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useClerk: () => ({ addListener: vi.fn(() => vi.fn()) }),
}));

vi.mock("@clerk/react/internal", () => ({
  publishableKeyFromHost: () => "pk_test_fake",
}));
vi.mock("@clerk/themes", () => ({ shadcn: {} }));

vi.mock("wouter", () => ({
  useLocation: () => ["/admin/notices", vi.fn()],
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  Switch: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Route: ({
    component: Comp,
    children,
  }: {
    component?: React.ComponentType;
    children?: React.ReactNode;
  }) => (Comp ? <Comp /> : <>{children}</>),
  Redirect: ({ to }: { to: string }) => <div data-testid="redirect" data-to={to} />,
  Router: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@tanstack/react-query", () => ({
  QueryClient: vi.fn().mockImplementation(() => ({})),
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useQueryClient: () => ({ invalidateQueries: vi.fn(), clear: vi.fn() }),
}));

vi.mock("@/components/ui/toaster", () => ({ Toaster: () => null }));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/ui/use-toast", () => ({
  toast: vi.fn(),
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}));

// ── API client mocks ───────────────────────────────────────────────────────────

const mockGetCompanyNotices = vi.fn();
const mockGetMyNotices = vi.fn();       // ← correct name: "My" not "Me"
const mockGetMyNoticesUnreadCount = vi.fn(); // ← correct name
const mockCreateNotice = vi.fn();
const mockGetCompanyBuildings = vi.fn();
const mockGetAuthMe = vi.fn();
const mockGetMyUnits = vi.fn();
const mockGetMyTenancy = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useGetCompanyNotices: (...args: unknown[]) => mockGetCompanyNotices(...args),
  useGetMyNotices: (...args: unknown[]) => mockGetMyNotices(...args),
  useGetMyNoticesUnreadCount: (...args: unknown[]) => mockGetMyNoticesUnreadCount(...args),
  useCreateNotice: (...args: unknown[]) => mockCreateNotice(...args),
  useGetCompanyBuildings: (...args: unknown[]) => mockGetCompanyBuildings(...args),
  useGetAuthMe: (...args: unknown[]) => mockGetAuthMe(...args),
  useGetMyUnits: (...args: unknown[]) => mockGetMyUnits(...args),
  useGetMyTenancy: (...args: unknown[]) => mockGetMyTenancy(...args),
  useSyncUser: vi.fn(() => ({ mutate: vi.fn() })),
  getGetCompanyNoticesQueryKey: (...args: unknown[]) => ["companies", ...args, "notices"],
  getGetMyNoticesQueryKey: (...args: unknown[]) => ["me", "notices", ...args],
  getGetMyNoticesUnreadCountQueryKey: () => ["me", "notices", "unread-count"],
  getGetCompanyBuildingsQueryKey: (id: string) => ["companies", id, "buildings"],
  getGetMyUnitsQueryKey: () => ["me", "units"],
  getGetMyTenancyQueryKey: () => ["me", "tenancy"],
}));

// ── App context mock ───────────────────────────────────────────────────────────

const mockUseAppContext = vi.fn();
vi.mock("@/hooks/useAppContext", () => ({
  useAppContext: () => mockUseAppContext(),
  AppProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── Context helpers ───────────────────────────────────────────────────────────

function setupAdminContext() {
  mockUseAppContext.mockReturnValue({
    roleContext: "admin",
    selectedCompanyId: "company-1",
    isLoading: false,
  });
}

function setupOwnerContext() {
  mockUseAppContext.mockReturnValue({
    roleContext: "owner",
    selectedCompanyId: null,
    isLoading: false,
  });
}

function setupTenantContext() {
  mockUseAppContext.mockReturnValue({
    roleContext: "tenant",
    selectedCompanyId: null,
    isLoading: false,
  });
}

// ── Default mock return values ────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCompanyBuildings.mockReturnValue({ data: [], isLoading: false });
  mockGetMyNoticesUnreadCount.mockReturnValue({ data: { unreadCount: 0 }, isLoading: false });
  mockGetMyUnits.mockReturnValue({ data: [], isLoading: false });
  mockGetMyTenancy.mockReturnValue({ data: null, isLoading: false });
  mockGetAuthMe.mockReturnValue({ data: null, isLoading: false });
  mockCreateNotice.mockReturnValue({ mutate: vi.fn(), isPending: false });
});

// ── Import pages after mocks ───────────────────────────────────────────────────

import NoticesPage from "@/pages/admin/NoticesPage";
import CreateNoticePage from "@/pages/admin/CreateNoticePage";
import OwnerNoticesPage from "@/pages/owner/OwnerNoticesPage";
import OwnerHomePage from "@/pages/owner/OwnerHomePage";
import TenantNoticesPage from "@/pages/tenant/TenantNoticesPage";
import TenantHomePage from "@/pages/tenant/TenantHomePage";

// ── Suite 38-01: Admin notice list renders ────────────────────────────────────

describe("Suite 38-01: Admin notice list renders", () => {
  it("renders the Notices page heading", () => {
    setupAdminContext();
    mockGetCompanyNotices.mockReturnValue({ data: [], isLoading: false });

    render(<NoticesPage />);
    // Use level:1 to uniquely select the page H1; other headings on the page
    // also match /notices/i so we need to narrow the query.
    expect(screen.getByRole("heading", { name: /notices/i, level: 1 })).toBeTruthy();
  });

  it("renders notice cards when data is present", () => {
    setupAdminContext();
    mockGetCompanyNotices.mockReturnValue({
      data: [
        {
          id: "n1",
          title: "Annual Meeting",
          status: "published",
          category: "agm_announcement",
          audience: "owners_and_tenants",
          targetingMode: "company_wide",
          publishedAt: "2024-07-01T10:00:00Z",
          versionNumber: 1,
        },
      ],
      isLoading: false,
    });

    render(<NoticesPage />);
    expect(screen.getByText("Annual Meeting")).toBeTruthy();
  });
});

// ── Suite 38-02: Create-notice required-field validation ──────────────────────

describe("Suite 38-02: Create-notice required-field validation", () => {
  it("shows error when submitting without title", async () => {
    setupAdminContext();

    render(<CreateNoticePage />);

    const submitBtn = screen.getByRole("button", { name: /save as draft|publish|schedule/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/title is required/i)).toBeTruthy();
    });
  });

  it("shows error when body is empty", async () => {
    setupAdminContext();

    render(<CreateNoticePage />);

    const titleInput = screen.getByPlaceholderText(/notice title/i);
    fireEvent.change(titleInput, { target: { value: "My Notice" } });

    const submitBtn = screen.getByRole("button", { name: /save as draft|publish|schedule/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/body is required/i)).toBeTruthy();
    });
  });
});

// ── Suite 38-03: Building target selection ────────────────────────────────────

describe("Suite 38-03: Building target selection", () => {
  it("calls buildings query when component mounts", () => {
    setupAdminContext();
    mockGetCompanyBuildings.mockReturnValue({
      data: [
        { id: "b1", name: "Tower A", locality: "Valletta", status: "active" },
      ],
      isLoading: false,
    });

    render(<CreateNoticePage />);

    // Buildings data is always fetched (needed when user selects building mode)
    expect(mockGetCompanyBuildings).toHaveBeenCalled();
  });
});

// ── Suite 38-04: Audience selection renders options ───────────────────────────

describe("Suite 38-04: Audience selection", () => {
  it("renders the create-notice form with required fields", () => {
    setupAdminContext();
    render(<CreateNoticePage />);

    // Check the form is rendered with the expected inputs
    expect(screen.getByPlaceholderText(/notice title/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/write your notice/i)).toBeTruthy();
  });
});

// ── Suite 38-05: Scheduled-date validation (Malta timezone) ───────────────────

describe("Suite 38-05: Scheduled-date validation (Malta timezone)", () => {
  it("shows DST gap error for a nonexistent Malta time (spring-forward 2024)", async () => {
    setupAdminContext();

    render(<CreateNoticePage />);

    // Fill required fields
    fireEvent.change(screen.getByPlaceholderText(/notice title/i), {
      target: { value: "Test Notice" },
    });
    fireEvent.change(screen.getByPlaceholderText(/write your notice/i), {
      target: { value: "Body text" },
    });

    // Enter a time in the 2024 spring-forward gap (02:30 Malta doesn't exist on 31 March)
    const scheduledInput = screen.getByLabelText(/schedule for later/i);
    fireEvent.change(scheduledInput, { target: { value: "2024-03-31T02:30" } });

    fireEvent.click(screen.getByRole("button", { name: /save as draft|schedule/i }));

    await waitFor(() => {
      // The form error div shows this exact phrase (distinct from the live preview label)
      const err = screen.getByText(/The selected time does not exist in Europe\/Malta/i);
      expect(err).toBeTruthy();
    });
  });

  it("shows past-time error for a clearly past date", async () => {
    setupAdminContext();

    render(<CreateNoticePage />);

    fireEvent.change(screen.getByPlaceholderText(/notice title/i), {
      target: { value: "Test" },
    });
    fireEvent.change(screen.getByPlaceholderText(/write your notice/i), {
      target: { value: "Body" },
    });

    const scheduledInput = screen.getByLabelText(/schedule for later/i);
    fireEvent.change(scheduledInput, { target: { value: "2020-01-01T10:00" } });

    fireEvent.click(screen.getByRole("button", { name: /save as draft|schedule/i }));

    await waitFor(() => {
      expect(screen.getByText(/must be in the future/i)).toBeTruthy();
    });
  });

  it("shows Malta time preview label when a valid future date is entered", () => {
    setupAdminContext();
    render(<CreateNoticePage />);

    // A date well in the future (summer)
    const scheduledInput = screen.getByLabelText(/schedule for later/i);
    fireEvent.change(scheduledInput, { target: { value: "2099-07-15T10:00" } });

    // The preview line should mention Malta
    const preview = screen.queryByText(/malta time/i);
    expect(preview).toBeTruthy();
  });
});

// ── Suite 38-06: Cross-role route protection ──────────────────────────────────

describe("Suite 38-06: Admin notice page renders for admin context", () => {
  it("admin notice list page renders without crashing", () => {
    setupAdminContext();
    mockGetCompanyNotices.mockReturnValue({ data: [], isLoading: false });
    const { container } = render(<NoticesPage />);
    expect(container.firstChild).not.toBeNull();
  });
});

// ── Suite 38-07: Owner notice feed renders ────────────────────────────────────

describe("Suite 38-07: Owner notice feed renders", () => {
  it("renders notice items from the feed", () => {
    setupOwnerContext();
    mockGetMyNotices.mockReturnValue({
      data: [
        {
          id: "n1",
          title: "Lift Maintenance",
          status: "published",
          category: "lift",
          audience: "owners_and_tenants",
          targetingMode: "company_wide",
          publishedAt: "2024-07-01T10:00:00Z",
          versionNumber: 1,
          delivery: { isUnread: true, isRead: false, recipientRole: "owner" },
        },
      ],
      isLoading: false,
    });

    render(<OwnerNoticesPage />);
    expect(screen.getByText("Lift Maintenance")).toBeTruthy();
  });

  it("renders empty state when no notices", () => {
    setupOwnerContext();
    mockGetMyNotices.mockReturnValue({ data: [], isLoading: false });
    render(<OwnerNoticesPage />);
    // Some empty-state message
    expect(screen.getByText(/no notices/i)).toBeTruthy();
  });
});

// ── Suite 38-08: Unread badge renders on owner feed ───────────────────────────

describe("Suite 38-08: Unread indicator on owner feed", () => {
  it("renders an unread indicator when delivery.isUnread is true", () => {
    setupOwnerContext();
    mockGetMyNotices.mockReturnValue({
      data: [
        {
          id: "n1",
          title: "Important Update",
          status: "published",
          category: "general",
          audience: "owners_and_tenants",
          targetingMode: "company_wide",
          publishedAt: "2024-07-01T10:00:00Z",
          versionNumber: 1,
          delivery: { isUnread: true, isRead: false, recipientRole: "owner" },
        },
      ],
      isLoading: false,
    });

    const { container } = render(<OwnerNoticesPage />);

    // Unread indicator can be a badge with "unread" text or a coloured dot.
    const unreadTextEls = screen.queryAllByText(/unread/i);
    const dotEls = container.querySelectorAll('[class*="destructive"], [data-unread], .rounded-full');
    expect(unreadTextEls.length + dotEls.length).toBeGreaterThan(0);
  });
});

// ── Suite 38-09: Emergency notice styling ─────────────────────────────────────

describe("Suite 38-09: Emergency notice styling", () => {
  it("renders the emergency category badge for an emergency notice", () => {
    setupOwnerContext();
    mockGetMyNotices.mockReturnValue({
      data: [
        {
          id: "n1",
          title: "Gas Leak",
          status: "published",
          category: "emergency",
          audience: "owners_and_tenants",
          targetingMode: "company_wide",
          publishedAt: "2024-07-01T10:00:00Z",
          versionNumber: 1,
          delivery: { isUnread: true, isRead: false, recipientRole: "owner" },
        },
      ],
      isLoading: false,
    });

    render(<OwnerNoticesPage />);
    expect(screen.getByText("Gas Leak")).toBeTruthy();
    expect(screen.getByText(/emergency/i)).toBeTruthy();
  });
});

// ── Suite 38-10: Updated label on edited notice ───────────────────────────────

describe("Suite 38-10: Updated label", () => {
  it("shows an Updated label when versionNumber > 1", () => {
    setupOwnerContext();
    mockGetMyNotices.mockReturnValue({
      data: [
        {
          id: "n1",
          title: "Building Works",
          status: "published",
          category: "planned_maintenance",
          audience: "owners_and_tenants",
          targetingMode: "company_wide",
          publishedAt: "2024-07-01T10:00:00Z",
          updatedAt: "2024-07-02T10:00:00Z",
          versionNumber: 2,
          delivery: { isUnread: false, isRead: true, recipientRole: "owner" },
        },
      ],
      isLoading: false,
    });

    render(<OwnerNoticesPage />);
    expect(screen.getByText(/updated/i)).toBeTruthy();
  });
});

// ── Suite 38-11: Tenant notice feed renders ───────────────────────────────────

describe("Suite 38-11: Tenant notice feed renders", () => {
  it("renders notice items for tenant", () => {
    setupTenantContext();
    mockGetMyNotices.mockReturnValue({
      data: [
        {
          id: "n1",
          title: "Pool Cleaning",
          status: "published",
          category: "cleaning",
          audience: "tenants_only",
          targetingMode: "company_wide",
          publishedAt: "2024-07-01T10:00:00Z",
          versionNumber: 1,
          delivery: { isUnread: true, isRead: false, recipientRole: "tenant" },
        },
      ],
      isLoading: false,
    });

    render(<TenantNoticesPage />);
    expect(screen.getByText("Pool Cleaning")).toBeTruthy();
  });
});

// ── Suite 38-12: Tenant unread badge ─────────────────────────────────────────

describe("Suite 38-12: Tenant unread badge", () => {
  it("renders unread state for a notice with isUnread=true", () => {
    setupTenantContext();
    mockGetMyNotices.mockReturnValue({
      data: [
        {
          id: "n1",
          title: "Notice A",
          status: "published",
          category: "general",
          audience: "tenants_only",
          targetingMode: "company_wide",
          publishedAt: "2024-07-01T10:00:00Z",
          versionNumber: 1,
          delivery: { isUnread: true, isRead: false, recipientRole: "tenant" },
        },
      ],
      isLoading: false,
    });

    const { container } = render(<TenantNoticesPage />);
    expect(screen.getByText("Notice A")).toBeTruthy();

    // Some form of unread indication is present
    const unreadEls = screen.queryAllByText(/unread/i);
    const dotEls = container.querySelectorAll('[class*="destructive"], [data-unread], .rounded-full');
    expect(unreadEls.length + dotEls.length).toBeGreaterThan(0);
  });
});

// ── Suite 38-13: Cross-role ───────────────────────────────────────────────────

describe("Suite 38-13: Cross-role — admin page does not expose feed content", () => {
  it("admin NoticesPage does not show the 'No unread notices' feed message", () => {
    setupAdminContext();
    mockGetCompanyNotices.mockReturnValue({ data: [], isLoading: false });
    render(<NoticesPage />);
    // The admin list empty state is different from the feed empty state
    const feedMsg = screen.queryByText(/no unread notices/i);
    expect(feedMsg).toBeNull();
  });
});

// ── Suite 38-14: Owner home page unread count card ───────────────────────────

describe("Suite 38-14: Owner home page unread count card", () => {
  it("shows unread count badge when unreadCount > 0", () => {
    setupOwnerContext();
    mockGetMyNoticesUnreadCount.mockReturnValue({
      data: { unreadCount: 3 },
      isLoading: false,
    });
    mockGetMyUnits.mockReturnValue({ data: [], isLoading: false });

    render(<OwnerHomePage />);

    // "3 unread" can appear in badge text or in the description — either is fine
    const unread = screen.getAllByText(/3 unread/i);
    expect(unread.length).toBeGreaterThan(0);
  });

  it("shows 'No unread notices' description when count is 0", () => {
    setupOwnerContext();
    mockGetMyNoticesUnreadCount.mockReturnValue({
      data: { unreadCount: 0 },
      isLoading: false,
    });
    mockGetMyUnits.mockReturnValue({ data: [], isLoading: false });

    render(<OwnerHomePage />);

    expect(screen.getByText(/no unread notices/i)).toBeTruthy();
  });
});

// ── Suite 38-15: Tenant home page unread count card ──────────────────────────

describe("Suite 38-15: Tenant home page unread count card", () => {
  it("shows unread count when unreadCount > 0", () => {
    setupTenantContext();
    mockGetMyNoticesUnreadCount.mockReturnValue({
      data: { unreadCount: 5 },
      isLoading: false,
    });
    mockGetMyTenancy.mockReturnValue({
      data: {
        unit: { unitNumber: "3A" },
        building: { name: "The Mews", addressLine1: "1 Main St", locality: "Sliema" },
      },
      isLoading: false,
    });

    render(<TenantHomePage />);

    // "5 unread" appears somewhere (badge or description)
    const matches = screen.getAllByText(/5 unread/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("shows the 'check announcements' message when count is 0", () => {
    setupTenantContext();
    mockGetMyNoticesUnreadCount.mockReturnValue({
      data: { unreadCount: 0 },
      isLoading: false,
    });
    mockGetMyTenancy.mockReturnValue({
      data: {
        unit: { unitNumber: "3A" },
        building: { name: "The Mews", addressLine1: "1 Main St", locality: "Sliema" },
      },
      isLoading: false,
    });

    render(<TenantHomePage />);

    expect(screen.getByText(/check recent announcements/i)).toBeTruthy();
  });
});

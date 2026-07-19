import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";

import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

import { AppProvider, useAppContext } from '@/hooks/useAppContext';
import { useSyncUser } from "@workspace/api-client-react";

import AdminLayout from '@/components/layout/AdminLayout';
import OwnerLayout from '@/components/layout/OwnerLayout';
import TenantLayout from '@/components/layout/TenantLayout';

import LandingPage from '@/pages/public/LandingPage';
import AcceptInvitationPage from '@/pages/public/AcceptInvitationPage';

import OnboardingPage from '@/pages/admin/OnboardingPage';
import DashboardPage from '@/pages/admin/DashboardPage';
import BuildingsPage from '@/pages/admin/BuildingsPage';
import BuildingDetailPage from '@/pages/admin/BuildingDetailPage';
import CreateBuildingPage from '@/pages/admin/CreateBuildingPage';
import UnitsPage from '@/pages/admin/UnitsPage';
import UnitDetailPage from '@/pages/admin/UnitDetailPage';
import InvitationsPage from '@/pages/admin/InvitationsPage';
import SubscriptionPage from '@/pages/admin/SubscriptionPage';
import SettingsPage from '@/pages/admin/SettingsPage';
import NoticesPage from '@/pages/admin/NoticesPage';
import CreateNoticePage from '@/pages/admin/CreateNoticePage';
import NoticeDetailPage from '@/pages/admin/NoticeDetailPage';

import OwnerHomePage from '@/pages/owner/OwnerHomePage';
import OwnerApartmentsPage from '@/pages/owner/OwnerApartmentsPage';
import OwnerApartmentDetailPage from '@/pages/owner/OwnerApartmentDetailPage';
import OwnerProfilePage from '@/pages/owner/OwnerProfilePage';
import OwnerNoticesPage from '@/pages/owner/OwnerNoticesPage';
import OwnerNoticeDetailPage from '@/pages/owner/OwnerNoticeDetailPage';

import TenantHomePage from '@/pages/tenant/TenantHomePage';
import TenantApartmentPage from '@/pages/tenant/TenantApartmentPage';
import TenantBuildingPage from '@/pages/tenant/TenantBuildingPage';
import TenantNoticesPage from '@/pages/tenant/TenantNoticesPage';
import TenantNoticeDetailPage from '@/pages/tenant/TenantNoticeDetailPage';
import TenantProfilePage from '@/pages/tenant/TenantProfilePage';


// --- CLERK SETUP ---

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(215 50% 23%)",
    colorBackground: "hsl(0 0% 100%)",
    colorInput: "hsl(214 32% 91%)",
    colorNeutral: "hsl(214 32% 91%)",
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white dark:bg-[#0b1120] rounded-2xl w-[440px] max-w-full overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
  },
};

const queryClient = new QueryClient();

// --- LOADING PLACEHOLDER ---

function LoadingScreen() {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center">
      <div className="text-sm text-muted-foreground">Loading…</div>
    </div>
  );
}

// --- ROLE-BASED ROUTE GUARDS (C2 FIX) ---

/**
 * AdminGuard: only users with roleContext === 'admin' may access /admin/* routes.
 * While loading, shows a loading screen to prevent flicker redirects.
 * Non-admins are redirected to '/' which routes them to their correct portal.
 */
function AdminGuard({ children }: { children: React.ReactNode }) {
  const { roleContext, isLoading } = useAppContext();
  if (isLoading) return <LoadingScreen />;
  if (roleContext !== 'admin') return <Redirect to="/" />;
  return <>{children}</>;
}

/**
 * OwnerGuard: only users with roleContext === 'owner' may access /owner/* routes.
 */
function OwnerGuard({ children }: { children: React.ReactNode }) {
  const { roleContext, isLoading } = useAppContext();
  if (isLoading) return <LoadingScreen />;
  if (roleContext !== 'owner') return <Redirect to="/" />;
  return <>{children}</>;
}

/**
 * TenantGuard: only users with roleContext === 'tenant' may access /tenant/* routes.
 */
function TenantGuard({ children }: { children: React.ReactNode }) {
  const { roleContext, isLoading } = useAppContext();
  if (isLoading) return <LoadingScreen />;
  if (roleContext !== 'tenant') return <Redirect to="/" />;
  return <>{children}</>;
}

// --- ROUTING ---

function HomeRedirect() {
  const { roleContext, isLoading, userContext } = useAppContext();
  
  if (isLoading) return <LoadingScreen />;

  return (
    <>
      <Show when="signed-in">
        {roleContext === 'admin' && userContext?.adminCompanies.length === 0 ? <Redirect to="/onboarding" /> : null}
        {roleContext === 'admin' && userContext?.adminCompanies.length! > 0 ? <Redirect to="/admin/dashboard" /> : null}
        {roleContext === 'owner' ? <Redirect to="/owner/home" /> : null}
        {roleContext === 'tenant' ? <Redirect to="/tenant/home" /> : null}
        {roleContext === 'pending' ? (
          <div className="min-h-[100dvh] flex items-center justify-center p-4 text-center">
            Your account is pending invitation.
          </div>
        ) : null}
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </>
  );
}

function SyncUserEffect() {
  const { user, isLoaded, isSignedIn } = useUser();
  const syncUser = useSyncUser();
  const hasSynced = useRef(false);

  useEffect(() => {
    if (isLoaded && isSignedIn && user && !hasSynced.current) {
      hasSynced.current = true;
      syncUser.mutate({
        data: {
          email: user.primaryEmailAddress?.emailAddress || "",
          fullName: user.fullName || null
        }
      });
    }
  }, [isLoaded, isSignedIn, user, syncUser]);

  return null;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function AppRouter() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey!}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <AppProvider>
          <ClerkQueryClientCacheInvalidator />
          <TooltipProvider>
            
            {/* Public Routes */}
            <Switch>
              <Route path="/" component={HomeRedirect} />
              <Route path="/invite/accept/:token" component={AcceptInvitationPage} />
              
              <Route path="/sign-in/*?">
                <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
                  <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
                </div>
              </Route>
              <Route path="/sign-up/*?">
                <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
                  <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
                </div>
              </Route>

              {/* Protected Route Switch Wrapper */}
              <Route>
                <Show when="signed-in">
                  <SyncUserEffect />
                  <Switch>
                    {/* Admin Portal — C2 FIX: AdminGuard enforces role */}
                    <Route path="/onboarding" component={OnboardingPage} />
                    <Route path="/admin/*">
                      <AdminGuard>
                        <AdminLayout>
                          <Switch>
                            <Route path="/admin/dashboard" component={DashboardPage} />
                            <Route path="/admin/buildings" component={BuildingsPage} />
                            <Route path="/admin/buildings/new" component={CreateBuildingPage} />
                            <Route path="/admin/buildings/:buildingId" component={BuildingDetailPage} />
                            <Route path="/admin/units" component={UnitsPage} />
                            <Route path="/admin/units/:unitId" component={UnitDetailPage} />
                            <Route path="/admin/notices/new" component={CreateNoticePage} />
                            <Route path="/admin/notices/:noticeId" component={NoticeDetailPage} />
                            <Route path="/admin/notices" component={NoticesPage} />
                            <Route path="/admin/invitations" component={InvitationsPage} />
                            <Route path="/admin/subscription" component={SubscriptionPage} />
                            <Route path="/admin/settings" component={SettingsPage} />
                            <Route component={NotFound} />
                          </Switch>
                        </AdminLayout>
                      </AdminGuard>
                    </Route>

                    {/* Owner Portal — C2 FIX: OwnerGuard enforces role */}
                    <Route path="/owner/*">
                      <OwnerGuard>
                        <OwnerLayout>
                          <Switch>
                            <Route path="/owner/home" component={OwnerHomePage} />
                            <Route path="/owner/apartments" component={OwnerApartmentsPage} />
                            <Route path="/owner/apartments/:unitId" component={OwnerApartmentDetailPage} />
                            <Route path="/owner/notices/:noticeId" component={OwnerNoticeDetailPage} />
                            <Route path="/owner/notices" component={OwnerNoticesPage} />
                            <Route path="/owner/profile" component={OwnerProfilePage} />
                            <Route component={NotFound} />
                          </Switch>
                        </OwnerLayout>
                      </OwnerGuard>
                    </Route>

                    {/* Tenant Portal — C2 FIX: TenantGuard enforces role */}
                    <Route path="/tenant/*">
                      <TenantGuard>
                        <TenantLayout>
                          <Switch>
                            <Route path="/tenant/home" component={TenantHomePage} />
                            <Route path="/tenant/apartment" component={TenantApartmentPage} />
                            <Route path="/tenant/building" component={TenantBuildingPage} />
                            <Route path="/tenant/notices/:noticeId" component={TenantNoticeDetailPage} />
                            <Route path="/tenant/notices" component={TenantNoticesPage} />
                            <Route path="/tenant/profile" component={TenantProfilePage} />
                            <Route component={NotFound} />
                          </Switch>
                        </TenantLayout>
                      </TenantGuard>
                    </Route>
                    
                    <Route component={NotFound} />
                  </Switch>
                </Show>
                <Show when="signed-out">
                  <Redirect to="/sign-in" />
                </Show>
              </Route>
            </Switch>

            <Toaster />
          </TooltipProvider>
        </AppProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <AppRouter />
    </WouterRouter>
  );
}

export default App;

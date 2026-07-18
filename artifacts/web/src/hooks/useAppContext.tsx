import { createContext, useContext, ReactNode, useMemo } from 'react';
import { useAuth } from '@clerk/react';
import { useGetAuthMe } from '@workspace/api-client-react';

// The API's user context type (from the GET /auth/me response)
interface UserContext {
  user: { id: string; email: string; fullName: string | null };
  adminCompanies: { id: string; name: string; slug: string | null; subscriptionTier: string; enterpriseFlagged: boolean }[];
  ownedUnits: unknown[];
  tenancy: unknown | null;
}

interface AppContextType {
  userContext: UserContext | undefined;
  isLoading: boolean;
  selectedCompanyId: string | null;
  setSelectedCompanyId: (id: string | null) => void;
  roleContext: 'admin' | 'owner' | 'tenant' | 'pending';
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const { isSignedIn, isLoaded: clerkLoaded } = useAuth();
  const { data: userContext, isLoading: queryLoading } = useGetAuthMe({
    query: {
      enabled: !!(clerkLoaded && isSignedIn),
      retry: false,
    }
  });
  const isLoading = !clerkLoaded || (!!isSignedIn && queryLoading);
  
  // We manage the selected company id via local state. Initially defaults to the first company.
  // We'll set this when we know it in the App routing layout.
  // Let's just expose a basic selection state for now.
  const defaultCompanyId = userContext?.adminCompanies?.[0]?.id || null;
  const selectedCompanyId = defaultCompanyId; // we can make this stateful later if we support switching
  
  const roleContext = useMemo(() => {
    if (!userContext) return 'pending';
    if (userContext.adminCompanies.length > 0) return 'admin';
    if (userContext.ownedUnits.length > 0) return 'owner';
    if (userContext.tenancy) return 'tenant';
    return 'pending';
  }, [userContext]);

  return (
    <AppContext.Provider
      value={{
        userContext,
        isLoading,
        selectedCompanyId,
        setSelectedCompanyId: () => {}, // placeholder
        roleContext,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}

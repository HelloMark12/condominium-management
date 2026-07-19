import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useClerk } from "@clerk/react";
import { Home, DoorOpen, Building, Bell, User, LogOut } from "lucide-react";
import { Button } from "../ui/button";
import {
  useGetMyNoticesUnreadCount,
  getGetMyNoticesUnreadCountQueryKey,
} from "@workspace/api-client-react";

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold leading-none">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export default function TenantLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { signOut } = useClerk();

  const { data: unreadData } = useGetMyNoticesUnreadCount({
    query: {
      queryKey: getGetMyNoticesUnreadCountQueryKey(),
      refetchInterval: 60_000,
    },
  });
  const unreadCount = unreadData?.unreadCount ?? 0;

  const navItems = [
    { name: "Home", href: "/tenant/home", icon: Home },
    { name: "Apartment", href: "/tenant/apartment", icon: DoorOpen },
    { name: "Building", href: "/tenant/building", icon: Building },
    { name: "Notices", href: "/tenant/notices", icon: Bell, badge: unreadCount },
    { name: "Profile", href: "/tenant/profile", icon: User },
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background pb-16 md:pb-0">
      {/* Desktop Header */}
      <header className="hidden md:flex items-center justify-between px-8 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 bg-primary text-primary-foreground rounded-lg flex items-center justify-center">
              <DoorOpen className="h-5 w-5" />
            </div>
            <span className="font-semibold text-lg">Tenant Portal</span>
          </div>
          
          <nav className="flex items-center gap-6">
            {navItems.map((item) => {
              const isActive = location === item.href || location.startsWith(item.href + "/");
              return (
                <Link key={item.name} href={item.href}>
                  <div className={`flex items-center gap-1.5 text-sm font-medium transition-colors cursor-pointer ${isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
                    {item.name}
                    {item.badge ? <UnreadBadge count={item.badge} /> : null}
                  </div>
                </Link>
              );
            })}
          </nav>
        </div>

        <Button variant="ghost" size="sm" onClick={() => signOut({ redirectUrl: "/" })}>
          <LogOut className="h-4 w-4 mr-2" />
          Log out
        </Button>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-3xl mx-auto p-4 md:p-8">
        {children}
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border flex items-center justify-around p-2 pb-safe z-50">
        {navItems.map((item) => {
          const isActive = location === item.href || location.startsWith(item.href + "/");
          return (
            <Link key={item.name} href={item.href}>
              <div className={`flex flex-col items-center p-2 rounded-xl transition-colors ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
                <div className="relative">
                  <item.icon className="h-5 w-5 mb-1" />
                  {item.badge ? (
                    <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-primary text-primary-foreground text-[8px] flex items-center justify-center font-bold">
                      {item.badge > 9 ? "9+" : item.badge}
                    </span>
                  ) : null}
                </div>
                <span className="text-[10px] font-medium">{item.name}</span>
              </div>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

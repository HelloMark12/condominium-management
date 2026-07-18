import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useClerk } from "@clerk/react";
import { Building, LayoutDashboard, Grid, Users, CreditCard, Settings, LogOut, Menu } from "lucide-react";
import { useAppContext } from "@/hooks/useAppContext";
import { Button } from "../ui/button";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { signOut } = useClerk();
  const { userContext } = useAppContext();

  const navItems = [
    { name: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
    { name: "Buildings", href: "/admin/buildings", icon: Building },
    { name: "Apartments", href: "/admin/units", icon: Grid },
    { name: "Invitations", href: "/admin/invitations", icon: Users },
    { name: "Subscription", href: "/admin/subscription", icon: CreditCard },
    { name: "Settings", href: "/admin/settings", icon: Settings },
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-background">
      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between p-4 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <Building className="h-6 w-6 text-primary" />
          <span className="font-semibold text-lg">Admin</span>
        </div>
        <Button variant="ghost" size="icon">
          <Menu className="h-5 w-5" />
        </Button>
      </header>

      {/* Sidebar (Desktop) */}
      <aside className="hidden md:flex w-64 flex-col border-r border-border bg-sidebar h-[100dvh] sticky top-0">
        <div className="p-6">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 bg-primary text-primary-foreground rounded-lg flex items-center justify-center">
              <Building className="h-5 w-5" />
            </div>
            <span className="font-semibold text-xl tracking-tight text-sidebar-foreground">
              {userContext?.adminCompanies[0]?.name || "Platform"}
            </span>
          </div>
        </div>

        <nav className="flex-1 px-4 py-2 space-y-1">
          {navItems.map((item) => {
            const isActive = location.startsWith(item.href);
            return (
              <Link key={item.name} href={item.href}>
                <div
                  className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer ${
                    isActive
                      ? "bg-primary text-primary-foreground font-medium"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }`}
                >
                  <item.icon className="h-5 w-5 opacity-80" />
                  {item.name}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-sidebar-border">
          <Button
            variant="ghost"
            className="w-full justify-start text-sidebar-foreground hover:text-destructive hover:bg-destructive/10"
            onClick={() => signOut({ redirectUrl: "/" })}
          >
            <LogOut className="h-5 w-5 mr-2 opacity-80" />
            Log out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {children}
      </main>
    </div>
  );
}

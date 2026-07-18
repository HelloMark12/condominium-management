import { Building, Users, Home, ClipboardList } from "lucide-react";
import { useGetCompanyDashboard, getGetCompanyDashboardQueryKey } from "@workspace/api-client-react";
import { useAppContext } from "@/hooks/useAppContext";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardPage() {
  const { selectedCompanyId } = useAppContext();
  
  const { data, isLoading } = useGetCompanyDashboard(selectedCompanyId!, {
    query: { enabled: !!selectedCompanyId, queryKey: getGetCompanyDashboardQueryKey(selectedCompanyId!) }
  });

  if (isLoading || !data) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-10 w-[200px]" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground mt-1">Here's what's happening across your portfolio.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="Total Buildings" 
          value={data.totalBuildings} 
          icon={<Building className="h-5 w-5 text-muted-foreground" />} 
        />
        <StatCard 
          title="Active Apartments" 
          value={data.totalActiveUnits} 
          icon={<Home className="h-5 w-5 text-muted-foreground" />} 
        />
        <StatCard 
          title="Active Owners" 
          value={data.totalActiveOwners} 
          icon={<Users className="h-5 w-5 text-muted-foreground" />} 
        />
        <StatCard 
          title="Active Tenants" 
          value={data.totalActiveTenants} 
          icon={<Users className="h-5 w-5 text-muted-foreground" />} 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-primary" />
              Pending Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center py-2 border-b border-border">
              <span className="text-muted-foreground">Pending Owner Invitations</span>
              <span className="font-semibold">{data.pendingOwnerInvitations}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border">
              <span className="text-muted-foreground">Pending Tenant Invitations</span>
              <span className="font-semibold">{data.pendingTenantInvitations}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-primary text-primary-foreground border-none">
          <CardHeader>
            <CardTitle className="text-lg text-primary-foreground/90 flex items-center gap-2">
              Plan Usage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold mb-2">
              {data.peakActiveUnitCount} <span className="text-lg font-normal text-primary-foreground/70">peak apartments this month</span>
            </div>
            <p className="text-primary-foreground/80 mb-6">
              Current plan: <span className="capitalize font-semibold">{data.currentPlan}</span>
            </p>
            <div className="bg-black/10 rounded-lg p-4 flex justify-between items-center">
              <span>Estimated monthly charge</span>
              <span className="font-semibold">€{(data.estimatedMonthlyChargeCents / 100).toFixed(2)}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon }: { title: string, value: number | string, icon: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

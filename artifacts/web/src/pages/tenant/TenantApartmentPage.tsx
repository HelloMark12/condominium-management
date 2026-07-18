import { DoorOpen, Building2 } from "lucide-react";
import { useGetMyTenancy, getGetMyTenancyQueryKey } from "@workspace/api-client-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function TenantApartmentPage() {
  const { data: tenancy, isLoading } = useGetMyTenancy({
    query: { queryKey: getGetMyTenancyQueryKey() }
  });

  if (isLoading) return <div className="space-y-6"><Skeleton className="h-32 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (!tenancy?.unit) return <div>Apartment not found</div>;

  const { unit } = tenancy;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">My Apartment</h1>
        <p className="text-muted-foreground mt-1">Details about your current residence.</p>
      </div>

      <div className="flex items-center gap-6 mb-8">
        <div className="bg-primary text-primary-foreground text-5xl font-bold h-24 w-24 rounded-2xl flex items-center justify-center shadow-md shrink-0">
          {unit.unitNumber}
        </div>
        <div>
          <div className="text-2xl font-bold mb-1">Apt {unit.unitNumber}</div>
          <div className="text-muted-foreground font-medium capitalize">{unit.unitType}</div>
        </div>
      </div>

      <Card className="bg-card max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            Unit Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between py-3 border-b border-border">
            <span className="text-muted-foreground">Unit Type</span>
            <span className="font-medium capitalize">{unit.unitType}</span>
          </div>
          <div className="flex justify-between py-3 border-b border-border">
            <span className="text-muted-foreground">Floor</span>
            <span className="font-medium">{unit.floor ?? 'Ground'}</span>
          </div>
          <div className="flex justify-between py-3 border-b border-border">
            <span className="text-muted-foreground">Building</span>
            <span className="font-medium">{tenancy.building?.name}</span>
          </div>
          <div className="flex justify-between py-3 border-b border-border">
            <span className="text-muted-foreground">Administered By</span>
            <span className="font-medium">{tenancy.company?.name}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { Building, MapPin, Building2 } from "lucide-react";
import { useGetMyTenancy, getGetMyTenancyQueryKey } from "@workspace/api-client-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function TenantBuildingPage() {
  const { data: tenancy, isLoading } = useGetMyTenancy({
    query: { queryKey: getGetMyTenancyQueryKey() }
  });

  if (isLoading) return <div className="space-y-6"><Skeleton className="h-64 w-full" /></div>;
  if (!tenancy?.building) return <div>Building not found</div>;

  const { building, company } = tenancy;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">The Building</h1>
        <p className="text-muted-foreground mt-1">Information about your complex.</p>
      </div>

      <Card className="bg-card overflow-hidden border-none shadow-md">
        <div className="h-48 bg-muted flex items-center justify-center relative">
           <Building className="h-24 w-24 text-primary/10 absolute" />
        </div>
        <CardContent className="pt-8 px-8 pb-8 relative">
          <div className="bg-card border border-border p-4 rounded-xl absolute -top-10 shadow-sm flex items-center gap-4">
             <div className="bg-primary/10 p-3 rounded-lg text-primary">
                <Building2 className="h-6 w-6" />
             </div>
             <div>
                <h2 className="text-2xl font-bold">{building.name}</h2>
                <div className="flex items-center text-muted-foreground text-sm mt-1">
                  <MapPin className="h-4 w-4 mr-1 shrink-0" />
                  <span>{building.locality}</span>
                </div>
             </div>
          </div>
          
          <div className="mt-12 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-3">Address</h3>
                <div className="space-y-1 font-medium">
                  {building.addressLine1 && <div>{building.addressLine1}</div>}
                  {building.addressLine2 && <div>{building.addressLine2}</div>}
                  <div>{building.locality}{building.postcode ? `, ${building.postcode}` : ''}</div>
                  <div>Malta</div>
                </div>
              </div>
              
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-3">Administration</h3>
                <div className="bg-muted/50 p-4 rounded-xl border border-border">
                  <div className="font-semibold text-lg">{company?.name}</div>
                  <div className="text-sm text-muted-foreground mt-1">Official Administrator</div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

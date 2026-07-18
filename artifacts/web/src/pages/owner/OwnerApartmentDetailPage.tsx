import { useParams, Link } from "wouter";
import { ArrowLeft, MapPin, Building2, User } from "lucide-react";
import { useGetUnit, getGetUnitQueryKey } from "@workspace/api-client-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export default function OwnerApartmentDetailPage() {
  const { unitId } = useParams();

  // For owner/tenant views we reuse useGetUnit. The backend scoping ensures they only see their own.
  const { data: unit, isLoading } = useGetUnit(unitId!, {
    query: { enabled: !!unitId, queryKey: getGetUnitQueryKey(unitId!) }
  });

  if (isLoading) return <div className="space-y-6"><Skeleton className="h-32 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (!unit) return <div>Apartment not found</div>;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/owner/apartments">
          <Button variant="ghost" size="sm" className="mb-4 -ml-3 text-muted-foreground">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Apartments
          </Button>
        </Link>
        <div className="flex items-end gap-6">
          <div className="bg-primary text-primary-foreground text-4xl font-bold h-20 w-20 rounded-2xl flex items-center justify-center shadow-md shrink-0">
            {unit.unitNumber}
          </div>
          <div className="pb-1">
            <h1 className="text-3xl font-bold tracking-tight mb-2">{unit.building?.name}</h1>
            <div className="flex items-center gap-2 text-muted-foreground text-lg">
              <MapPin className="h-5 w-5" />
              <span>{unit.building?.locality}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Building2 className="h-5 w-5 text-muted-foreground" />
              Property Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted-foreground">Type</span>
              <span className="font-medium capitalize">{unit.unitType}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted-foreground">Floor</span>
              <span className="font-medium">{unit.floor ?? '-'}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted-foreground">Status</span>
              <span className="font-medium capitalize">{unit.status}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <User className="h-5 w-5 text-muted-foreground" />
              Tenancy Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            {unit.tenant ? (
              <div className="bg-muted/30 p-4 rounded-xl border border-border">
                <div className="font-semibold text-lg mb-1">{unit.tenant.invitedName}</div>
                <div className="text-muted-foreground text-sm mb-3">{unit.tenant.invitedEmail}</div>
                <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  Active Tenant
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground border border-dashed border-border rounded-xl">
                No active tenant recorded for this apartment.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

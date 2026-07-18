import { Link } from "wouter";
import { Building, MapPin, ArrowRight } from "lucide-react";
import { useGetMyUnits, getGetMyUnitsQueryKey } from "@workspace/api-client-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function OwnerApartmentsPage() {
  const { data: units, isLoading } = useGetMyUnits({
    query: { queryKey: getGetMyUnitsQueryKey() }
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">My Apartments</h1>
        <p className="text-muted-foreground mt-1">All properties you own across all administration companies.</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : !units?.length ? (
        <div className="text-center py-24 border-2 border-dashed border-border rounded-xl bg-card">
          <Building className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold">No apartments found</h3>
          <p className="text-muted-foreground max-w-sm mx-auto mt-2">
            You don't have any apartments linked to your account yet. Wait for an invitation from your building administrator.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {units.map((summary) => (
            <Link key={summary.unit.id} href={`/owner/apartments/${summary.unit.id}`}>
              <Card className="hover:border-primary/40 transition-colors cursor-pointer group h-full bg-card">
                <CardContent className="p-6 flex flex-col h-full">
                  <div className="flex justify-between items-start mb-6">
                    <div className="bg-primary text-primary-foreground text-2xl font-bold h-14 w-14 rounded-xl flex items-center justify-center shadow-sm">
                      {summary.unit.unitNumber}
                    </div>
                    <div className="text-xs font-medium px-2.5 py-1 bg-secondary text-secondary-foreground rounded-md text-right max-w-[120px] truncate">
                      Admin: {summary.company.name}
                    </div>
                  </div>
                  
                  <div className="mt-auto space-y-2">
                    <div className="font-semibold text-xl">{summary.building.name}</div>
                    <div className="flex items-start text-sm text-muted-foreground">
                      <MapPin className="h-4 w-4 mr-1.5 mt-0.5 shrink-0" />
                      <span className="line-clamp-2">
                        {summary.building.addressLine1 ? `${summary.building.addressLine1}, ` : ''}
                        {summary.building.locality}
                      </span>
                    </div>
                  </div>

                  <div className="mt-6 pt-4 border-t border-border flex items-center justify-between text-sm text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                    View Details
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

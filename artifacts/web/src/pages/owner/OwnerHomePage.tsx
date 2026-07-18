import { Link } from "wouter";
import { Building, MapPin, ArrowRight } from "lucide-react";
import { useGetMyUnits, getGetMyUnitsQueryKey } from "@workspace/api-client-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export default function OwnerHomePage() {
  const { data: units, isLoading } = useGetMyUnits({
    query: { queryKey: getGetMyUnitsQueryKey() }
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Welcome back</h1>
        <p className="text-muted-foreground mt-2">Manage your property portfolio from one place.</p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Your Apartments</h2>
          <Link href="/owner/apartments">
            <Button variant="ghost" size="sm" className="text-primary hover:bg-primary/5">
              View all <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1,2].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}
          </div>
        ) : !units?.length ? (
          <div className="text-center py-16 bg-card border border-border rounded-xl">
            <Building className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">You don't have any apartments linked to your account.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {units.slice(0, 4).map((summary) => (
              <Link key={summary.unit.id} href={`/owner/apartments/${summary.unit.id}`}>
                <Card className="hover:border-primary/40 transition-colors cursor-pointer group bg-card">
                  <CardContent className="p-5 flex flex-col h-full">
                    <div className="flex justify-between items-start mb-3">
                      <div className="bg-primary text-primary-foreground text-xl font-bold h-12 w-12 rounded-xl flex items-center justify-center shadow-sm">
                        {summary.unit.unitNumber}
                      </div>
                      <div className="text-xs font-medium px-2 py-1 bg-secondary text-secondary-foreground rounded-md">
                        {summary.company.name}
                      </div>
                    </div>
                    
                    <div className="mt-auto pt-4 space-y-1">
                      <div className="font-semibold text-lg">{summary.building.name}</div>
                      <div className="flex items-center text-sm text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5 mr-1" />
                        {summary.building.locality}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

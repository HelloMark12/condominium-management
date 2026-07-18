import { Link } from "wouter";
import { Plus, MapPin, Building as BuildingIcon } from "lucide-react";
import { useGetCompanyBuildings, getGetCompanyBuildingsQueryKey } from "@workspace/api-client-react";
import { useAppContext } from "@/hooks/useAppContext";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function BuildingsPage() {
  const { selectedCompanyId } = useAppContext();
  
  const { data: buildings, isLoading } = useGetCompanyBuildings(selectedCompanyId!, {
    query: { enabled: !!selectedCompanyId, queryKey: getGetCompanyBuildingsQueryKey(selectedCompanyId!) }
  });

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Buildings</h1>
          <p className="text-muted-foreground mt-1">Manage the properties in your portfolio.</p>
        </div>
        <Link href="/admin/buildings/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Add Building
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1,2,3].map(i => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : !buildings?.length ? (
        <div className="text-center py-24 border-2 border-dashed border-border rounded-xl bg-card">
          <BuildingIcon className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold">No buildings yet</h3>
          <p className="text-muted-foreground max-w-sm mx-auto mt-2 mb-6">
            Get started by adding your first building to manage its apartments and residents.
          </p>
          <Link href="/admin/buildings/new">
            <Button>Add Building</Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {buildings.map((building) => (
            <Link key={building.id} href={`/admin/buildings/${building.id}`}>
              <Card className="hover:border-primary/50 transition-colors cursor-pointer group h-full">
                <CardContent className="p-6 flex flex-col h-full">
                  <div className="flex justify-between items-start mb-4">
                    <div className="h-10 w-10 bg-primary/10 text-primary rounded-lg flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                      <BuildingIcon className="h-5 w-5" />
                    </div>
                    <Badge variant={building.status === 'active' ? 'default' : 'secondary'} className="capitalize">
                      {building.status}
                    </Badge>
                  </div>
                  
                  <h3 className="text-xl font-semibold mb-1 line-clamp-1">{building.name}</h3>
                  <div className="flex items-start gap-2 text-muted-foreground text-sm mt-auto pt-4">
                    <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
                    <span className="line-clamp-2">
                      {building.addressLine1 ? `${building.addressLine1}, ` : ''}
                      {building.locality}
                    </span>
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

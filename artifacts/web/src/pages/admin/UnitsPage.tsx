import { useState } from "react";
import { Link } from "wouter";
import { Grid, Building as BuildingIcon, Search } from "lucide-react";

import { useGetCompanyBuildings, getGetCompanyBuildingsQueryKey, useGetBuildingUnits } from "@workspace/api-client-react";
import { useAppContext } from "@/hooks/useAppContext";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function UnitsPage() {
  const { selectedCompanyId } = useAppContext();
  const [searchTerm, setSearchTerm] = useState("");

  const { data: buildings, isLoading: buildingsLoading } = useGetCompanyBuildings(selectedCompanyId!, {
    query: { enabled: !!selectedCompanyId, queryKey: getGetCompanyBuildingsQueryKey(selectedCompanyId!) }
  });

  // Since the API only offers fetching units by building, we'd normally aggregate them or 
  // the backend would provide a cross-building endpoint. 
  // For this scaffold, we'll guide the user to select a building first to manage units, 
  // as fetching all units across all buildings client-side isn't ideal.

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Apartments</h1>
        <p className="text-muted-foreground mt-1">Select a building to view its apartments.</p>
      </div>

      <div className="relative max-w-md mb-8">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input 
          placeholder="Filter buildings..." 
          className="pl-9 bg-card"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {buildingsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {buildings?.filter(b => b.name.toLowerCase().includes(searchTerm.toLowerCase())).map((building) => (
            <Link key={building.id} href={`/admin/buildings/${building.id}`}>
              <Card className="hover:border-primary/50 transition-colors cursor-pointer group">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 bg-muted rounded-lg flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                      <BuildingIcon className="h-6 w-6 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">{building.name}</h3>
                      <p className="text-sm text-muted-foreground">{building.locality}</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm">View Apartments</Button>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

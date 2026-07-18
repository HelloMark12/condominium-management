import { useState, useRef } from "react";
import { useParams, Link } from "wouter";
import { ArrowLeft, MapPin, Plus, DoorOpen, Settings2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import { 
  useGetBuilding, getGetBuildingQueryKey,
  useGetBuildingUnits, getGetBuildingUnitsQueryKey,
  useCreateUnit
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";

const unitSchema = z.object({
  unitNumber: z.string().min(1, "Apartment number is required"),
  unitType: z.enum(["apartment", "garage", "commercial", "other"]),
  floor: z.coerce.number().optional(),
});

export default function BuildingDetailPage() {
  const { buildingId } = useParams();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const { data: building, isLoading: buildingLoading } = useGetBuilding(buildingId!, {
    query: { enabled: !!buildingId, queryKey: getGetBuildingQueryKey(buildingId!) }
  });

  const { data: units, isLoading: unitsLoading } = useGetBuildingUnits(buildingId!, {}, {
    query: { enabled: !!buildingId, queryKey: getGetBuildingUnitsQueryKey(buildingId!, {}) }
  });

  const createUnit = useCreateUnit();

  const form = useForm<z.infer<typeof unitSchema>>({
    resolver: zodResolver(unitSchema),
    defaultValues: { unitNumber: "", unitType: "apartment" },
  });

  const onSubmitUnit = (values: z.infer<typeof unitSchema>) => {
    createUnit.mutate(
      { buildingId: buildingId!, data: values },
      {
        onSuccess: () => {
          toast({ title: "Apartment added" });
          setCreateDialogOpen(false);
          form.reset();
          queryClient.invalidateQueries({ queryKey: getGetBuildingUnitsQueryKey(buildingId!, {}) });
        },
        onError: () => {
          toast({ title: "Failed to add apartment", variant: "destructive" });
        }
      }
    );
  };

  if (buildingLoading) {
    return <div className="p-8"><Skeleton className="h-32 w-full" /></div>;
  }

  if (!building) return <div className="p-8">Building not found</div>;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div>
        <Link href="/admin/buildings">
          <Button variant="ghost" size="sm" className="mb-4 -ml-3 text-muted-foreground">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Buildings
          </Button>
        </Link>
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold tracking-tight">{building.name}</h1>
              <Badge variant={building.status === 'active' ? 'default' : 'secondary'} className="capitalize">{building.status}</Badge>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="h-4 w-4" />
              <span>{[building.addressLine1, building.locality, building.postcode].filter(Boolean).join(', ')}</span>
            </div>
          </div>
          <Button variant="outline"><Settings2 className="h-4 w-4 mr-2"/>Edit Building</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="md:col-span-1 bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Quick Stats</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-3xl font-bold">{units?.length || 0}</div>
              <div className="text-sm text-muted-foreground mt-1">Total Apartments</div>
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Apartments</CardTitle>
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Apartment
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Apartment</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmitUnit)} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="unitNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Number / Identifier</FormLabel>
                          <FormControl><Input placeholder="e.g. 4A" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="unitType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Type</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select type" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="apartment">Apartment</SelectItem>
                                <SelectItem value="garage">Garage</SelectItem>
                                <SelectItem value="commercial">Commercial</SelectItem>
                                <SelectItem value="other">Other</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="floor"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Floor</FormLabel>
                            <FormControl><Input type="number" {...field} value={field.value ?? ""} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <DialogFooter className="pt-4">
                      <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                      <Button type="submit" disabled={createUnit.isPending}>Save</Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {unitsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : units?.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <DoorOpen className="mx-auto h-12 w-12 opacity-20 mb-4" />
                No apartments added yet.
              </div>
            ) : (
              <div className="rounded-md border border-border overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/50 border-b border-border">
                    <tr>
                      <th className="px-4 py-3 font-medium">Apartment</th>
                      <th className="px-4 py-3 font-medium">Type</th>
                      <th className="px-4 py-3 font-medium">Floor</th>
                      <th className="px-4 py-3 font-medium">Owner</th>
                      <th className="px-4 py-3 font-medium">Tenant</th>
                      <th className="px-4 py-3 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {units?.map((unit: any) => (
                      <tr key={unit.id} className="hover:bg-muted/50 transition-colors">
                        <td className="px-4 py-3 font-medium">{unit.unitNumber}</td>
                        <td className="px-4 py-3 capitalize text-muted-foreground">{unit.unitType}</td>
                        <td className="px-4 py-3 text-muted-foreground">{unit.floor ?? '-'}</td>
                        <td className="px-4 py-3">
                          {unit.ownerStatus === 'active' ? (
                            <span className="text-foreground">{unit.ownerName}</span>
                          ) : unit.ownerStatus === 'pending' ? (
                            <span className="text-amber-600 text-xs font-medium px-2 py-1 bg-amber-100 rounded-full">Invited</span>
                          ) : (
                            <span className="text-muted-foreground/50">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                           {unit.tenantStatus === 'active' ? (
                            <span className="text-foreground">{unit.tenantName}</span>
                          ) : unit.tenantStatus === 'pending' ? (
                            <span className="text-amber-600 text-xs font-medium px-2 py-1 bg-amber-100 rounded-full">Invited</span>
                          ) : (
                            <span className="text-muted-foreground/50">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link href={`/admin/units/${unit.id}`}>
                            <Button variant="ghost" size="sm">Manage</Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

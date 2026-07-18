import { useState } from "react";
import { useParams, Link } from "wouter";
import { ArrowLeft, UserPlus, UserX, Mail, Building } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import { 
  useGetUnit, getGetUnitQueryKey,
  useInviteOwner, useInviteTenant, useRevokeUnitMembership
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const inviteSchema = z.object({
  invitedName: z.string().min(2, "Name is required"),
  invitedEmail: z.string().email("Valid email is required"),
});

export default function UnitDetailPage() {
  const { unitId } = useParams();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [ownerDialogOpen, setOwnerDialogOpen] = useState(false);
  const [tenantDialogOpen, setTenantDialogOpen] = useState(false);

  const { data: unit, isLoading } = useGetUnit(unitId!, {
    query: { enabled: !!unitId, queryKey: getGetUnitQueryKey(unitId!) }
  });

  const inviteOwner = useInviteOwner();
  const inviteTenant = useInviteTenant();
  const revokeMembership = useRevokeUnitMembership();

  const ownerForm = useForm<z.infer<typeof inviteSchema>>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { invitedName: "", invitedEmail: "" },
  });

  const tenantForm = useForm<z.infer<typeof inviteSchema>>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { invitedName: "", invitedEmail: "" },
  });

  const onSubmitOwner = (values: z.infer<typeof inviteSchema>) => {
    inviteOwner.mutate(
      { unitId: unitId!, data: values },
      {
        onSuccess: () => {
          toast({ title: "Owner invited successfully" });
          setOwnerDialogOpen(false);
          ownerForm.reset();
          queryClient.invalidateQueries({ queryKey: getGetUnitQueryKey(unitId!) });
        },
        onError: () => { toast({ title: "Failed to invite owner", variant: "destructive" }); }
      }
    );
  };

  const onSubmitTenant = (values: z.infer<typeof inviteSchema>) => {
    inviteTenant.mutate(
      { unitId: unitId!, data: values },
      {
        onSuccess: () => {
          toast({ title: "Tenant invited successfully" });
          setTenantDialogOpen(false);
          tenantForm.reset();
          queryClient.invalidateQueries({ queryKey: getGetUnitQueryKey(unitId!) });
        },
        onError: () => { toast({ title: "Failed to invite tenant", variant: "destructive" }); }
      }
    );
  };

  const handleRevoke = (membershipId: string, role: string) => {
    if (confirm(`Are you sure you want to remove this ${role}?`)) {
      revokeMembership.mutate(
        { membershipId },
        {
          onSuccess: () => {
            toast({ title: `${role} removed` });
            queryClient.invalidateQueries({ queryKey: getGetUnitQueryKey(unitId!) });
          },
          onError: () => { toast({ title: "Failed to remove", variant: "destructive" }); }
        }
      );
    }
  };

  if (isLoading) return <div className="p-8"><Skeleton className="h-32 w-full" /></div>;
  if (!unit) return <div className="p-8">Apartment not found</div>;

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div>
        <Link href={`/admin/buildings/${unit.buildingId}`}>
          <Button variant="ghost" size="sm" className="mb-4 -ml-3 text-muted-foreground">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Building
          </Button>
        </Link>
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-2">Apartment {unit.unitNumber}</h1>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Building className="h-4 w-4" />
              <span>{unit.building?.name}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* OWNER SECTION */}
        <Card className="border-border">
          <CardHeader>
            <CardTitle>Owner</CardTitle>
            <CardDescription>The legal owner of this apartment.</CardDescription>
          </CardHeader>
          <CardContent>
            {unit.owner ? (
              <div className="flex items-center justify-between bg-muted/30 p-4 rounded-xl border border-border">
                <div className="flex items-center gap-4">
                  <Avatar>
                    <AvatarFallback>{unit.owner.invitedName.substring(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-semibold flex items-center gap-2">
                      {unit.owner.invitedName}
                      {unit.owner.status === 'pending' && <span className="text-[10px] uppercase tracking-wider bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">Pending</span>}
                    </div>
                    <div className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Mail className="h-3 w-3" /> {unit.owner.invitedEmail}
                    </div>
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleRevoke(unit.owner!.id, 'owner')}>
                  <UserX className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="text-center py-8 bg-muted/20 border border-dashed border-border rounded-xl">
                <UserPlus className="mx-auto h-8 w-8 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground mb-4">No owner assigned.</p>
                <Dialog open={ownerDialogOpen} onOpenChange={setOwnerDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">Invite Owner</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Invite Owner</DialogTitle></DialogHeader>
                    <Form {...ownerForm}>
                      <form onSubmit={ownerForm.handleSubmit(onSubmitOwner)} className="space-y-4">
                        <FormField control={ownerForm.control} name="invitedName" render={({ field }) => (
                          <FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={ownerForm.control} name="invitedEmail" render={({ field }) => (
                          <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <DialogFooter className="pt-4">
                          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                          <Button type="submit" disabled={inviteOwner.isPending}>Send Invitation</Button>
                        </DialogFooter>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </div>
            )}
          </CardContent>
        </Card>

        {/* TENANT SECTION */}
        <Card className="border-border">
          <CardHeader>
            <CardTitle>Tenant</CardTitle>
            <CardDescription>The current resident of this apartment.</CardDescription>
          </CardHeader>
          <CardContent>
            {unit.tenant ? (
              <div className="flex items-center justify-between bg-muted/30 p-4 rounded-xl border border-border">
                <div className="flex items-center gap-4">
                  <Avatar>
                    <AvatarFallback>{unit.tenant.invitedName.substring(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-semibold flex items-center gap-2">
                      {unit.tenant.invitedName}
                      {unit.tenant.status === 'pending' && <span className="text-[10px] uppercase tracking-wider bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">Pending</span>}
                    </div>
                    <div className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Mail className="h-3 w-3" /> {unit.tenant.invitedEmail}
                    </div>
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleRevoke(unit.tenant!.id, 'tenant')}>
                  <UserX className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="text-center py-8 bg-muted/20 border border-dashed border-border rounded-xl">
                <UserPlus className="mx-auto h-8 w-8 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground mb-4">No tenant assigned.</p>
                <Dialog open={tenantDialogOpen} onOpenChange={setTenantDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">Invite Tenant</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Invite Tenant</DialogTitle></DialogHeader>
                    <Form {...tenantForm}>
                      <form onSubmit={tenantForm.handleSubmit(onSubmitTenant)} className="space-y-4">
                        <FormField control={tenantForm.control} name="invitedName" render={({ field }) => (
                          <FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={tenantForm.control} name="invitedEmail" render={({ field }) => (
                          <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <DialogFooter className="pt-4">
                          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                          <Button type="submit" disabled={inviteTenant.isPending}>Send Invitation</Button>
                        </DialogFooter>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

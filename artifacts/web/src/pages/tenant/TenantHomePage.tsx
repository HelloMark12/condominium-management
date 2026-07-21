import { Link } from "wouter";
import { MapPin, Bell, DoorOpen, ArrowRight } from "lucide-react";
import {
  useGetMyTenancy,
  getGetMyTenancyQueryKey,
  useGetMyNoticesUnreadCount,
  getGetMyNoticesUnreadCountQueryKey,
} from "@workspace/api-client-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function TenantHomePage() {
  const { data: tenancy, isLoading } = useGetMyTenancy({
    query: { queryKey: getGetMyTenancyQueryKey() }
  });

  const { data: unreadData } = useGetMyNoticesUnreadCount({
    query: {
      queryKey: getGetMyNoticesUnreadCountQueryKey(),
      refetchInterval: 60_000,
    },
  });

  const unreadCount: number = (unreadData as { unreadCount?: number } | undefined)?.unreadCount ?? 0;

  if (isLoading) {
    return <div className="space-y-8"><Skeleton className="h-40 w-full rounded-2xl" /><Skeleton className="h-64 w-full rounded-2xl" /></div>;
  }

  if (!tenancy) {
    return (
      <div className="text-center py-24">
        <h2 className="text-2xl font-bold mb-2">No active tenancy</h2>
        <p className="text-muted-foreground">You don't have an active apartment assigned to you.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="bg-primary text-primary-foreground rounded-3xl p-8 shadow-lg relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10">
          <DoorOpen className="w-48 h-48 -mr-8 -mt-8" />
        </div>
        <div className="relative z-10">
          <h1 className="text-3xl font-bold tracking-tight mb-2">Welcome Home</h1>
          <p className="text-primary-foreground/80 mb-8 max-w-md">Access building notices and view details about your apartment.</p>
          
          <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-2xl p-6 inline-flex flex-col sm:flex-row gap-6 items-start sm:items-center">
            <div className="bg-white text-primary text-3xl font-bold h-16 w-16 rounded-xl flex items-center justify-center shadow-sm shrink-0">
              {tenancy.unit?.unitNumber}
            </div>
            <div>
              <div className="text-2xl font-bold mb-1">{tenancy.building?.name}</div>
              <div className="flex items-center text-primary-foreground/80 text-sm">
                <MapPin className="h-4 w-4 mr-1.5 shrink-0" />
                <span>{tenancy.building?.addressLine1}, {tenancy.building?.locality}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-card">
          <CardContent className="p-6">
            <div className="h-12 w-12 bg-primary/10 text-primary rounded-xl flex items-center justify-center mb-4">
              <Bell className="h-6 w-6" />
            </div>
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-xl font-semibold">Notice Board</h3>
              {unreadCount > 0 && (
                <Badge variant="destructive" className="text-xs px-2 py-0.5">
                  {unreadCount}
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground mb-6">
              {unreadCount > 0
                ? `${unreadCount} unread notice${unreadCount === 1 ? "" : "s"} from your building administrator.`
                : "Check recent announcements from your building administrator."}
            </p>
            <Link href="/tenant/notices">
              <Button variant="outline" className="w-full">
                View Notices {unreadCount > 0 && <ArrowRight className="ml-1 h-4 w-4" />}
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardContent className="p-6">
            <div className="h-12 w-12 bg-primary/10 text-primary rounded-xl flex items-center justify-center mb-4">
              <DoorOpen className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Apartment Details</h3>
            <p className="text-muted-foreground mb-6">View specific information about your unit.</p>
            <Link href="/tenant/apartment">
              <Button variant="outline" className="w-full">View Details</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

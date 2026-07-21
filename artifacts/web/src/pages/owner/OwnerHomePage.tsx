import { Link } from "wouter";
import { Building, MapPin, ArrowRight, Bell } from "lucide-react";
import {
  useGetMyUnits,
  getGetMyUnitsQueryKey,
  useGetMyNoticesUnreadCount,
  getGetMyNoticesUnreadCountQueryKey,
} from "@workspace/api-client-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function OwnerHomePage() {
  const { data: units, isLoading } = useGetMyUnits({
    query: { queryKey: getGetMyUnitsQueryKey() }
  });

  const { data: unreadData } = useGetMyNoticesUnreadCount({
    query: {
      queryKey: getGetMyNoticesUnreadCountQueryKey(),
      refetchInterval: 60_000, // refresh every minute
    },
  });

  const unreadCount: number = (unreadData as { unreadCount?: number } | undefined)?.unreadCount ?? 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Welcome back</h1>
        <p className="text-muted-foreground mt-2">Manage your property portfolio from one place.</p>
      </div>

      {/* Notices card */}
      <Card className="bg-card">
        <CardContent className="p-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 bg-primary/10 text-primary rounded-xl flex items-center justify-center shrink-0">
              <Bell className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-base">Notices</span>
                {unreadCount > 0 && (
                  <Badge variant="destructive" className="text-xs px-2 py-0.5">
                    {unreadCount} unread
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {unreadCount > 0
                  ? `You have ${unreadCount} unread notice${unreadCount === 1 ? "" : "s"}`
                  : "No unread notices"}
              </p>
            </div>
          </div>
          <Link href="/owner/notices">
            <Button variant="outline" size="sm">
              View notices <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>

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

import { Link, useRoute } from "wouter";
import { ArrowLeft, AlertTriangle, Clock, Users, CheckCircle, XCircle } from "lucide-react";
import {
  useGetMyNotice,
  useGetMyNoticeTenantDelivery,
  getGetMyNoticeQueryKey,
  getGetMyNoticeTenantDeliveryQueryKey,
  getGetMyNoticesUnreadCountQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CategoryBadge, AudienceBadge } from "@/components/notices/NoticeBadges";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

export default function OwnerNoticeDetailPage() {
  const [, params] = useRoute("/owner/notices/:noticeId");
  const noticeId = params?.noticeId ?? "";
  const queryClient = useQueryClient();

  const { data: notice, isLoading } = useGetMyNotice(noticeId, {
    query: {
      queryKey: getGetMyNoticeQueryKey(noticeId),
      enabled: !!noticeId,
    },
  });

  const { data: tenantDeliveries } = useGetMyNoticeTenantDelivery(noticeId, {
    query: {
      queryKey: getGetMyNoticeTenantDeliveryQueryKey(noticeId),
      enabled: !!noticeId && !!notice,
    },
  });

  useEffect(() => {
    if (notice) {
      queryClient.invalidateQueries({ queryKey: getGetMyNoticesUnreadCountQueryKey() });
    }
  }, [notice, queryClient]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!notice) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">Notice not found.</p>
        <Link href="/owner/notices">
          <Button variant="link" className="mt-2">Back to notices</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/owner/notices">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          {notice.category === "emergency" && (
            <AlertTriangle className="h-5 w-5 text-destructive" />
          )}
          <h1 className="text-xl font-bold tracking-tight">{notice.title}</h1>
        </div>
      </div>

      <Tabs defaultValue="content">
        <TabsList>
          <TabsTrigger value="content">Notice</TabsTrigger>
          {tenantDeliveries && tenantDeliveries.length > 0 && (
            <TabsTrigger value="tenants">
              <Users className="h-4 w-4 mr-1" />
              Tenant Status
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="content" className="mt-4">
          <Card className={notice.category === "emergency" ? "border-destructive/30 bg-destructive/5" : ""}>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <CategoryBadge category={notice.category} />
                <AudienceBadge audience={notice.audience} />
                {notice.versionNumber > 1 && (
                  <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5 font-medium">
                    Updated
                  </span>
                )}
              </div>

              <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                {notice.publishedAt && (
                  <div className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {new Date(notice.publishedAt).toLocaleString("en-MT", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                )}
                {notice.versionNumber > 1 && notice.updatedAt && (
                  <span className="text-amber-600 text-xs">
                    Updated {new Date(notice.updatedAt).toLocaleDateString("en-MT")}
                  </span>
                )}
              </div>

              <div className="prose prose-sm max-w-none whitespace-pre-wrap text-foreground leading-relaxed pt-2 border-t border-border">
                {notice.body}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {tenantDeliveries && tenantDeliveries.length > 0 && (
          <TabsContent value="tenants" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Tenant read status — your apartments</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {tenantDeliveries.map((td) => (
                    <div key={td.unitId} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                      <div>
                        <div className="text-sm font-medium">
                          {td.tenantName ?? "Tenant"}
                        </div>
                        <div className="text-xs text-muted-foreground">Apt {td.unitNumber}</div>
                      </div>
                      <div className="text-right">
                        {!td.delivered ? (
                          <span className="text-xs text-muted-foreground">Not delivered</span>
                        ) : td.isRead ? (
                          <div className="flex items-center gap-1 text-green-600 text-xs">
                            <CheckCircle className="h-3.5 w-3.5" />
                            Read
                            {td.firstReadAt && (
                              <span className="text-muted-foreground ml-1">
                                {new Date(td.firstReadAt).toLocaleDateString("en-MT")}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-muted-foreground text-xs">
                            <XCircle className="h-3.5 w-3.5" />
                            Unread
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

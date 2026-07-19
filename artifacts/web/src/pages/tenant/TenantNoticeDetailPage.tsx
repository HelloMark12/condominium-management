import { Link, useRoute } from "wouter";
import { ArrowLeft, AlertTriangle, Clock, Building } from "lucide-react";
import {
  useGetMyNotice,
  getGetMyNoticeQueryKey,
  getGetMyNoticesUnreadCountQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CategoryBadge, AudienceBadge } from "@/components/notices/NoticeBadges";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

export default function TenantNoticeDetailPage() {
  const [, params] = useRoute("/tenant/notices/:noticeId");
  const noticeId = params?.noticeId ?? "";
  const queryClient = useQueryClient();

  const { data: notice, isLoading } = useGetMyNotice(noticeId, {
    query: {
      queryKey: getGetMyNoticeQueryKey(noticeId),
      enabled: !!noticeId,
    },
  });

  // Invalidate unread count after opening a notice
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
        <Link href="/tenant/notices">
          <Button variant="link" className="mt-2">Back to notices</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/tenant/notices">
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
    </div>
  );
}

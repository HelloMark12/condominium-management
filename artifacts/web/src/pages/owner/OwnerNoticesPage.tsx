import { Link } from "wouter";
import { BellRing, AlertTriangle, Clock } from "lucide-react";
import {
  useGetMyNotices,
  useGetMyNoticesUnreadCount,
  getGetMyNoticesQueryKey,
  getGetMyNoticesUnreadCountQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CategoryBadge, UnreadDot, CATEGORY_LABELS } from "@/components/notices/NoticeBadges";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function OwnerNoticesPage() {
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  const { data: notices, isLoading } = useGetMyNotices(
    {
      unreadOnly: showUnreadOnly || undefined,
      category: categoryFilter !== "all" ? categoryFilter as "general" | "emergency" | "planned_maintenance" | "cleaning" | "lift" | "agm_announcement" | "other" : undefined,
    },
    { query: { queryKey: getGetMyNoticesQueryKey({ unreadOnly: showUnreadOnly || undefined }) } }
  );

  const { data: unreadData } = useGetMyNoticesUnreadCount({
    query: { queryKey: getGetMyNoticesUnreadCountQueryKey() },
  });

  const unreadCount = unreadData?.unreadCount ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Notices</h1>
          {unreadCount > 0 && (
            <span className="inline-flex items-center justify-center h-6 min-w-6 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold">
              {unreadCount}
            </span>
          )}
        </div>
        <p className="text-muted-foreground mt-1">Announcements from your building administrator.</p>
      </div>

      <div className="flex gap-3 flex-wrap">
        <button
          onClick={() => setShowUnreadOnly(!showUnreadOnly)}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            showUnreadOnly
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          Unread{unreadCount > 0 ? ` (${unreadCount})` : ""}
        </button>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : !notices?.length ? (
        <Card className="bg-card border-dashed border-2">
          <CardContent className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-14 w-14 bg-muted rounded-full flex items-center justify-center mb-4">
              <BellRing className="h-7 w-7 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">
              {showUnreadOnly ? "No unread notices" : "No notices yet"}
            </h3>
            <p className="text-muted-foreground text-sm max-w-sm">
              {showUnreadOnly
                ? "You've read all your notices."
                : "When your administrator posts an update, it will appear here."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {notices.map((notice) => (
            <Link key={notice.id} href={`/owner/notices/${notice.id}`}>
              <Card
                className={`cursor-pointer transition-colors hover:border-primary/30 ${
                  notice.category === "emergency" && notice.delivery?.isUnread
                    ? "border-destructive/40 bg-destructive/5"
                    : ""
                }`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    {notice.delivery?.isUnread ? (
                      <div className="mt-1.5 shrink-0"><UnreadDot /></div>
                    ) : (
                      <div className="mt-1.5 h-2 w-2 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {notice.category === "emergency" && (
                          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                        )}
                        <span className={`font-medium text-sm truncate ${notice.delivery?.isUnread ? "text-foreground" : "text-muted-foreground"}`}>
                          {notice.title}
                        </span>
                        {notice.versionNumber > 1 && (
                          <span className="text-xs text-amber-600 font-medium shrink-0">Updated</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <CategoryBadge category={notice.category} />
                        <div className="flex items-center text-xs text-muted-foreground gap-1">
                          <Clock className="h-3 w-3" />
                          {notice.publishedAt
                            ? new Date(notice.publishedAt).toLocaleDateString("en-MT", { day: "numeric", month: "short", year: "numeric" })
                            : "—"}
                        </div>
                      </div>
                    </div>
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

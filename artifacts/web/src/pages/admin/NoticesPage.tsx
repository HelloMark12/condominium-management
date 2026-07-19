import { useState } from "react";
import { Link } from "wouter";
import { Plus, BellRing, AlertTriangle, Filter } from "lucide-react";
import { useGetCompanyNotices, getGetCompanyNoticesQueryKey } from "@workspace/api-client-react";
import { useAppContext } from "@/hooks/useAppContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CategoryBadge, StatusBadge, AudienceBadge, CATEGORY_LABELS } from "@/components/notices/NoticeBadges";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STATUS_OPTIONS = ["all", "draft", "scheduled", "published", "archived"] as const;

export default function NoticesPage() {
  const { selectedCompanyId } = useAppContext();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const { data: notices, isLoading } = useGetCompanyNotices(
    selectedCompanyId!,
    statusFilter !== "all" ? { status: statusFilter as "draft" | "scheduled" | "published" | "archived" } : {},
    {
      query: {
        queryKey: getGetCompanyNoticesQueryKey(selectedCompanyId!, { status: statusFilter as "draft" | "scheduled" | "published" | "archived" | "all" }),
        enabled: !!selectedCompanyId,
      },
    }
  );

  const filtered = categoryFilter === "all"
    ? notices
    : notices?.filter((n) => n.category === categoryFilter);

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notices</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Communicate with owners and tenants across your buildings.
          </p>
        </div>
        <Link href="/admin/notices/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Notice
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === "all" ? "All statuses" : s.charAt(0).toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

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
      ) : !filtered?.length ? (
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-14 w-14 bg-muted rounded-full flex items-center justify-center mb-4">
              <BellRing className="h-7 w-7 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-1">No notices found</h3>
            <p className="text-muted-foreground text-sm max-w-sm mb-4">
              {statusFilter === "all" && categoryFilter === "all"
                ? "Create your first notice to communicate with residents."
                : "Try adjusting the filters to see more notices."}
            </p>
            {statusFilter === "all" && categoryFilter === "all" && (
              <Link href="/admin/notices/new">
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  Create notice
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((notice) => (
            <Link key={notice.id} href={`/admin/notices/${notice.id}`}>
              <Card className="hover:border-primary/30 transition-colors cursor-pointer group">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {notice.category === "emergency" && (
                          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                        )}
                        <span className="font-semibold text-sm truncate group-hover:text-primary transition-colors">
                          {notice.title}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap mt-2">
                        <StatusBadge status={notice.status} />
                        <CategoryBadge category={notice.category} />
                        <AudienceBadge audience={notice.audience} />
                      </div>
                    </div>
                    <div className="text-right shrink-0 space-y-1">
                      {notice.publishedAt && (
                        <div className="text-xs text-muted-foreground">
                          {new Date(notice.publishedAt).toLocaleDateString("en-MT")}
                        </div>
                      )}
                      {notice.status === "published" && (
                        <div className="text-xs text-muted-foreground">
                          {notice.deliveryStats?.totalRecipients ?? 0} recipients ·{" "}
                          {notice.deliveryStats?.readPercentage ?? 0}% read
                        </div>
                      )}
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

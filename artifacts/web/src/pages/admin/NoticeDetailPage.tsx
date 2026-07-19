import { useState } from "react";
import { Link, useRoute, useLocation } from "wouter";
import {
  ArrowLeft, Users, Eye, BarChart3, Clock, AlertTriangle,
  History, Send, CalendarClock, Archive, Edit, CheckCircle,
} from "lucide-react";
import {
  useGetCompanyNotice,
  useGetNoticeDelivery,
  useGetNoticeVersions,
  usePublishNotice,
  useArchiveNotice,
  useUpdateNotice,
  getGetCompanyNoticeQueryKey,
  getGetNoticeDeliveryQueryKey,
  getGetNoticeVersionsQueryKey,
} from "@workspace/api-client-react";
import { useAppContext } from "@/hooks/useAppContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CategoryBadge, StatusBadge, AudienceBadge, CATEGORY_LABELS } from "@/components/notices/NoticeBadges";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";

export default function NoticeDetailPage() {
  const [, params] = useRoute("/admin/notices/:noticeId");
  const noticeId = params?.noticeId ?? "";
  const { selectedCompanyId } = useAppContext();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editReason, setEditReason] = useState("");

  const { data: notice, isLoading } = useGetCompanyNotice(
    selectedCompanyId!,
    noticeId,
    { query: { queryKey: getGetCompanyNoticeQueryKey(selectedCompanyId!, noticeId), enabled: !!selectedCompanyId && !!noticeId } }
  );

  const { data: delivery } = useGetNoticeDelivery(
    selectedCompanyId!,
    noticeId,
    { query: { queryKey: getGetNoticeDeliveryQueryKey(selectedCompanyId!, noticeId), enabled: !!selectedCompanyId && !!noticeId && notice?.status === "published" } }
  );

  const { data: versions } = useGetNoticeVersions(
    selectedCompanyId!,
    noticeId,
    { query: { queryKey: getGetNoticeVersionsQueryKey(selectedCompanyId!, noticeId), enabled: !!selectedCompanyId && !!noticeId } }
  );

  const publishNotice = usePublishNotice({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCompanyNoticeQueryKey(selectedCompanyId!, noticeId) });
      },
    },
  });

  const archiveNotice = useArchiveNotice({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCompanyNoticeQueryKey(selectedCompanyId!, noticeId) });
      },
    },
  });

  const updateNotice = useUpdateNotice({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCompanyNoticeQueryKey(selectedCompanyId!, noticeId) });
        setEditMode(false);
      },
    },
  });

  function startEdit() {
    setEditTitle(notice?.title ?? "");
    setEditBody(notice?.body ?? "");
    setEditCategory(notice?.category ?? "general");
    setEditReason("");
    setEditMode(true);
  }

  function saveEdit() {
    updateNotice.mutate({
      companyId: selectedCompanyId!,
      noticeId,
      data: {
        title: editTitle,
        body: editBody,
        category: editCategory as "general" | "emergency" | "planned_maintenance" | "cleaning" | "lift" | "agm_announcement" | "other",
        editReason: editReason || undefined,
      },
    });
  }

  if (isLoading) {
    return (
      <div className="p-6 md:p-8 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (!notice) {
    return (
      <div className="p-6 md:p-8">
        <p className="text-muted-foreground">Notice not found.</p>
      </div>
    );
  }

  const canPublish = notice.status === "draft" || notice.status === "scheduled";
  const canEdit = notice.status !== "archived";
  const canArchive = notice.status !== "archived";
  const isPublished = notice.status === "published";

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/admin/notices">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              {notice.category === "emergency" && (
                <AlertTriangle className="h-5 w-5 text-destructive" />
              )}
              <h1 className="text-2xl font-bold tracking-tight">{notice.title}</h1>
              {notice.versionNumber > 1 && (
                <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5 font-medium">
                  Updated v{notice.versionNumber}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <StatusBadge status={notice.status} />
              <CategoryBadge category={notice.category} />
              <AudienceBadge audience={notice.audience} />
            </div>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {canPublish && (
            <Button
              size="sm"
              onClick={() => publishNotice.mutate({ companyId: selectedCompanyId!, noticeId })}
              disabled={publishNotice.isPending}
            >
              <Send className="h-4 w-4 mr-1" />
              {publishNotice.isPending ? "Publishing…" : "Publish"}
            </Button>
          )}
          {canEdit && (
            <Button size="sm" variant="outline" onClick={startEdit}>
              <Edit className="h-4 w-4 mr-1" />
              Edit
            </Button>
          )}
          {canArchive && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (confirm("Archive this notice?")) {
                  archiveNotice.mutate({ companyId: selectedCompanyId!, noticeId });
                }
              }}
              disabled={archiveNotice.isPending}
            >
              <Archive className="h-4 w-4 mr-1" />
              Archive
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="content">
        <TabsList>
          <TabsTrigger value="content">Content</TabsTrigger>
          {isPublished && <TabsTrigger value="delivery">Delivery</TabsTrigger>}
          <TabsTrigger value="history">Version History</TabsTrigger>
        </TabsList>

        <TabsContent value="content" className="space-y-4 mt-4">
          {editMode ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Edit Notice</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Title</Label>
                  <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Body</Label>
                  <Textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={8} />
                </div>
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <Select value={editCategory} onValueChange={setEditCategory}>
                    <SelectTrigger className="w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {isPublished && (
                  <div className="space-y-1.5">
                    <Label>Edit reason (optional)</Label>
                    <Input
                      value={editReason}
                      onChange={(e) => setEditReason(e.target.value)}
                      placeholder="Briefly describe what changed…"
                    />
                  </div>
                )}
                <div className="flex gap-2">
                  <Button onClick={saveEdit} disabled={updateNotice.isPending} size="sm">
                    {updateNotice.isPending ? "Saving…" : "Save"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setEditMode(false)}>Cancel</Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-6 prose prose-sm max-w-none whitespace-pre-wrap">
                {notice.body}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="pt-6">
              <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Targeting</dt>
                  <dd className="font-medium mt-0.5 capitalize">{notice.targetingMode?.replace(/_/g, " ")}</dd>
                </div>
                {notice.publishedAt && (
                  <div>
                    <dt className="text-muted-foreground">Published</dt>
                    <dd className="font-medium mt-0.5">{new Date(notice.publishedAt).toLocaleString("en-MT")}</dd>
                  </div>
                )}
                {notice.scheduledPublishAt && notice.status === "scheduled" && (
                  <div>
                    <dt className="text-muted-foreground">Scheduled for</dt>
                    <dd className="font-medium mt-0.5">{new Date(notice.scheduledPublishAt).toLocaleString("en-MT")}</dd>
                  </div>
                )}
                {notice.archivedAt && (
                  <div>
                    <dt className="text-muted-foreground">Archived</dt>
                    <dd className="font-medium mt-0.5">{new Date(notice.archivedAt).toLocaleString("en-MT")}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-muted-foreground">Version</dt>
                  <dd className="font-medium mt-0.5">v{notice.versionNumber}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        {isPublished && (
          <TabsContent value="delivery" className="space-y-4 mt-4">
            {delivery && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: "Recipients", value: delivery.summary.totalRecipients, icon: Users },
                    { label: "Read", value: delivery.summary.totalRead, icon: Eye },
                    { label: "Unread", value: delivery.summary.totalUnread, icon: Clock },
                    { label: "Read %", value: `${delivery.summary.readPercentage}%`, icon: BarChart3 },
                  ].map(({ label, value, icon: Icon }) => (
                    <Card key={label}>
                      <CardContent className="pt-4 pb-4">
                        <div className="flex items-center gap-2 text-muted-foreground mb-1">
                          <Icon className="h-4 w-4" />
                          <span className="text-xs">{label}</span>
                        </div>
                        <div className="text-2xl font-bold">{value}</div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Recipients</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {delivery.deliveries.map((d) => (
                        <div key={d.deliveryId} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                          <div>
                            <div className="text-sm font-medium">{d.userName ?? "Unknown"}</div>
                            <div className="text-xs text-muted-foreground capitalize">{d.recipientRole}</div>
                            {d.contexts?.[0] && (
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {d.contexts[0].buildingName}
                                {d.contexts[0].unitNumber && ` · Apt ${d.contexts[0].unitNumber}`}
                              </div>
                            )}
                          </div>
                          <div className="text-right">
                            {d.firstReadAt ? (
                              <div className="flex items-center gap-1 text-green-600 text-xs">
                                <CheckCircle className="h-3.5 w-3.5" />
                                Read
                              </div>
                            ) : (
                              <div className="text-xs text-muted-foreground">Unread</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        )}

        <TabsContent value="history" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              {!versions?.length ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No version history yet. Version history is recorded when a published notice is edited.
                </p>
              ) : (
                <div className="space-y-4">
                  {versions.map((v) => (
                    <div key={v.id} className="border-b border-border pb-4 last:border-0">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <History className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">Version {v.versionNumber}</span>
                          {v.editReason && (
                            <span className="text-xs text-muted-foreground">— {v.editReason}</span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {v.editorName} · {new Date(v.createdAt).toLocaleString("en-MT")}
                        </div>
                      </div>
                      <div className="bg-muted rounded-md p-3 text-sm whitespace-pre-wrap">
                        <div className="font-medium mb-1">{v.title}</div>
                        <div className="text-muted-foreground line-clamp-3">{v.body}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

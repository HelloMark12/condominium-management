import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, AlertCircle, Info } from "lucide-react";
import { Link } from "wouter";
import {
  useCreateNotice,
  useGetCompanyBuildings,
  getGetCompanyBuildingsQueryKey,
} from "@workspace/api-client-react";
import { useAppContext } from "@/hooks/useAppContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useQueryClient } from "@tanstack/react-query";
import { CATEGORY_LABELS, AUDIENCE_LABELS, TARGETING_LABELS } from "@/components/notices/NoticeBadges";
import { toast } from "@/components/ui/use-toast";
import { maltaLocalToUtc, formatMaltaTime } from "@/lib/maltaTime";

type TargetingMode = "company_wide" | "buildings" | "apartments";
type Audience = "owners_only" | "tenants_only" | "owners_and_tenants";
type Category = "general" | "emergency" | "planned_maintenance" | "cleaning" | "lift" | "agm_announcement" | "other";

export default function CreateNoticePage() {
  const [, setLocation] = useLocation();
  const { selectedCompanyId } = useAppContext();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<Category>("general");
  const [audience, setAudience] = useState<Audience>("owners_and_tenants");
  const [targetingMode, setTargetingMode] = useState<TargetingMode>("company_wide");
  const [selectedBuildingIds, setSelectedBuildingIds] = useState<string[]>([]);
  const [publishImmediately, setPublishImmediately] = useState(false);
  const [scheduledDate, setScheduledDate] = useState("");
  const [error, setError] = useState("");

  const { data: buildings } = useGetCompanyBuildings(selectedCompanyId!, {
    query: {
      queryKey: getGetCompanyBuildingsQueryKey(selectedCompanyId!),
      enabled: !!selectedCompanyId,
    },
  });

  const createNotice = useCreateNotice({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: ["companies", selectedCompanyId, "notices"] });
        setLocation(`/admin/notices/${data.id}`);
      },
      onError: (err: unknown) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed to create notice";
        setError(msg);
      },
    },
  });

  const activeBuildings = buildings?.filter((b) => b.status === "active") ?? [];

  function toggleBuilding(id: string) {
    setSelectedBuildingIds((prev) =>
      prev.includes(id) ? prev.filter((bid) => bid !== id) : [...prev, id]
    );
  }

  /**
   * Resolve the scheduling datetime.
   * The datetime-local input is always interpreted as Europe/Malta time,
   * regardless of the administrator's device/browser timezone.
   * Returns the UTC ISO string to send to the API, or null + error on failure.
   */
  function resolveScheduledUtc(): { utcIso: string; displayLabel: string } | null {
    if (!scheduledDate) return null;

    const utc = maltaLocalToUtc(scheduledDate);
    if (!utc) {
      setError(
        "The selected time does not exist in Europe/Malta. " +
        "This can happen during a daylight-saving transition. Please choose a different time."
      );
      return null;
    }

    if (utc <= new Date()) {
      setError("Scheduled time must be in the future (Europe/Malta).");
      return null;
    }

    return { utcIso: utc.toISOString(), displayLabel: formatMaltaTime(utc) };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!title.trim()) { setError("Title is required"); return; }
    if (!body.trim()) { setError("Body is required"); return; }
    if (targetingMode === "buildings" && selectedBuildingIds.length === 0) {
      setError("Select at least one building");
      return;
    }

    let scheduledPublishAt: string | null = null;

    if (!publishImmediately && scheduledDate) {
      const resolved = resolveScheduledUtc();
      if (!resolved) return; // error was set inside resolveScheduledUtc
      scheduledPublishAt = resolved.utcIso;
    }

    createNotice.mutate({
      companyId: selectedCompanyId!,
      data: {
        title: title.trim(),
        body: body.trim(),
        category,
        audience,
        targetingMode,
        buildingIds: targetingMode === "buildings" ? selectedBuildingIds : [],
        unitIds: [],
        publishImmediately,
        scheduledPublishAt,
      },
    });
  }

  // Resolve Malta display label for live preview while the user types
  const maltaPreview = (() => {
    if (!scheduledDate || publishImmediately) return null;
    const utc = maltaLocalToUtc(scheduledDate);
    if (!utc) return "⚠ This time does not exist in Malta (DST gap)";
    return formatMaltaTime(utc);
  })();

  return (
    <div className="p-6 md:p-8 max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/notices">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Notice</h1>
          <p className="text-muted-foreground text-sm">Create and publish a notice to residents.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Content</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                placeholder="Notice title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="body">Message *</Label>
              <Textarea
                id="body"
                placeholder="Write your notice here…"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Category *</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Audience *</Label>
                <Select value={audience} onValueChange={(v) => setAudience(v as Audience)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(AUDIENCE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Targeting</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Send to *</Label>
              <Select value={targetingMode} onValueChange={(v) => { setTargetingMode(v as TargetingMode); setSelectedBuildingIds([]); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TARGETING_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {targetingMode === "buildings" && (
              <div className="space-y-2">
                <Label>Select buildings *</Label>
                {activeBuildings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active buildings found.</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-3">
                    {activeBuildings.map((building) => (
                      <div key={building.id} className="flex items-center gap-2">
                        <Checkbox
                          id={building.id}
                          checked={selectedBuildingIds.includes(building.id)}
                          onCheckedChange={() => toggleBuilding(building.id)}
                        />
                        <label htmlFor={building.id} className="text-sm cursor-pointer">
                          {building.name} <span className="text-muted-foreground">— {building.locality}</span>
                        </label>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Publication</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="publishNow"
                checked={publishImmediately}
                onCheckedChange={(v) => { setPublishImmediately(!!v); if (v) setScheduledDate(""); }}
              />
              <label htmlFor="publishNow" className="text-sm font-medium cursor-pointer">
                Publish immediately
              </label>
            </div>

            {!publishImmediately && (
              <div className="space-y-1.5">
                <Label htmlFor="scheduledDate">Schedule for later (optional)</Label>
                <Input
                  id="scheduledDate"
                  type="datetime-local"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                />
                {/* Live Malta time preview — shown regardless of device timezone */}
                {maltaPreview ? (
                  <div className="flex items-start gap-1.5 text-xs mt-1">
                    <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
                    <span className={maltaPreview.startsWith("⚠") ? "text-destructive" : "text-muted-foreground"}>
                      {maltaPreview}
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Enter date and time — always interpreted as <strong>Europe/Malta</strong> time.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <Button type="submit" disabled={createNotice.isPending}>
            {createNotice.isPending
              ? "Saving…"
              : publishImmediately
              ? "Publish now"
              : scheduledDate
              ? "Schedule"
              : "Save as draft"}
          </Button>
          <Link href="/admin/notices">
            <Button type="button" variant="outline">Cancel</Button>
          </Link>
        </div>
      </form>
    </div>
  );
}

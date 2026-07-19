import { Badge } from "@/components/ui/badge";

export const CATEGORY_LABELS: Record<string, string> = {
  general: "General",
  emergency: "Emergency",
  planned_maintenance: "Planned Maintenance",
  cleaning: "Cleaning",
  lift: "Lift",
  agm_announcement: "AGM",
  other: "Other",
};

export const AUDIENCE_LABELS: Record<string, string> = {
  owners_only: "Owners only",
  tenants_only: "Tenants only",
  owners_and_tenants: "Owners & tenants",
};

export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  published: "Published",
  archived: "Archived",
};

export const TARGETING_LABELS: Record<string, string> = {
  company_wide: "Company-wide",
  buildings: "Selected buildings",
  apartments: "Selected apartments",
};

export function CategoryBadge({ category }: { category: string }) {
  const isEmergency = category === "emergency";
  return (
    <Badge
      variant={isEmergency ? "destructive" : "secondary"}
      className={isEmergency ? "font-semibold" : ""}
    >
      {CATEGORY_LABELS[category] ?? category}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    draft: "bg-muted text-muted-foreground border border-border",
    scheduled: "bg-blue-50 text-blue-700 border border-blue-200",
    published: "bg-green-50 text-green-700 border border-green-200",
    archived: "bg-muted text-muted-foreground border border-border",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${variants[status] ?? ""}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function AudienceBadge({ audience }: { audience: string }) {
  return (
    <Badge variant="outline">
      {AUDIENCE_LABELS[audience] ?? audience}
    </Badge>
  );
}

export function UnreadDot() {
  return <span className="inline-block h-2 w-2 rounded-full bg-primary shrink-0" />;
}

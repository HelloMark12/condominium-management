import { BellRing } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function TenantNoticesPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Notices</h1>
        <p className="text-muted-foreground mt-1">Announcements from your building administrator.</p>
      </div>

      <Card className="bg-card border-dashed border-2">
        <CardContent className="flex flex-col items-center justify-center py-24 text-center">
          <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <BellRing className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-semibold mb-2">No active notices</h3>
          <p className="text-muted-foreground max-w-sm">
            There are no current announcements for your building. When your administrator posts an update, it will appear here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

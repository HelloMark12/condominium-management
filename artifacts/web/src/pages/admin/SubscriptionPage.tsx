import { CreditCard, TrendingUp, AlertCircle, CheckCircle2, PhoneCall } from "lucide-react";
import { 
  useGetCompanySubscription, getGetCompanySubscriptionQueryKey,
  useGetCompanyUsageHistory, getGetCompanyUsageHistoryQueryKey,
  type SubscriptionInfo,
} from "@workspace/api-client-react";
import { useAppContext } from "@/hooks/useAppContext";
import {
  isEnterpriseCustom,
  formatEstimatedCharge,
  formatChargeExplanation,
  formatHistoryRate,
  formatHistoryAmount,
} from "@/lib/billingDisplay";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

// The API response includes `isCustomPricing` and `enterprisePricingBehavior`
// which are not yet in the Orval-generated types (pending schema regeneration).
// We extend the generated type locally until the client is regenerated.
type SubscriptionResponse = SubscriptionInfo & {
  isCustomPricing?: boolean;
  enterprisePricingBehavior?: string;
};

type UsageRecord = {
  id: string;
  billingMonth: string;
  peakActiveUnitCount: number;
  subscriptionTier: string | null;
  ratePerUnitCents: number | null;
  estimatedAmountCents: number | null;
  finalAmountCents: number | null;
  invoiceStatus: string;
  isCustomPricing?: boolean;
};

export default function SubscriptionPage() {
  const { selectedCompanyId } = useAppContext();
  
  const { data: subRaw, isLoading: subLoading, error } = useGetCompanySubscription(selectedCompanyId!, {
    query: { enabled: !!selectedCompanyId, queryKey: getGetCompanySubscriptionQueryKey(selectedCompanyId!) }
  });

  const { data: historyRaw, isLoading: historyLoading } = useGetCompanyUsageHistory(selectedCompanyId!, { limit: 12 }, {
    query: { enabled: !!selectedCompanyId, queryKey: getGetCompanyUsageHistoryQueryKey(selectedCompanyId!, { limit: 12 }) }
  });

  // Cast to extended types that include the new explicit isCustomPricing field
  const sub = subRaw as SubscriptionResponse | undefined;
  const history = historyRaw as UsageRecord[] | undefined;

  // Gated access check based on API spec
  if (error?.status === 403) {
    return <div className="p-8 text-center text-muted-foreground">Access denied. Only administrators can view billing information.</div>;
  }

  if (subLoading) {
    return <div className="p-8 space-y-8"><Skeleton className="h-64 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  if (!sub) return null;

  // Issue 7 FIX: use the explicit isCustomPricing field from the API rather than
  // inferring from plan + amount.  This correctly distinguishes enterprise/custom
  // from enterprise/fixed or enterprise/per_unit when the rate happens to be zero.
  const customPricing = sub.isCustomPricing ?? false;

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Subscription & Billing</h1>
        <p className="text-muted-foreground mt-1">Manage your plan and view usage history.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2 bg-primary text-primary-foreground border-none relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <CreditCard className="w-32 h-32" />
          </div>
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-2xl text-primary-foreground">
              Current Plan
              <Badge variant="secondary" className="uppercase bg-white/20 text-white hover:bg-white/30 border-none">
                {sub.currentPlan}
              </Badge>
            </CardTitle>
            <CardDescription className="text-primary-foreground/70">
              Billing month: {format(new Date(sub.billingMonth), 'MMMM yyyy')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 relative z-10">
            <div className="grid grid-cols-2 gap-8">
              <div>
                <div className="text-primary-foreground/70 text-sm mb-1">Peak Active Apartments</div>
                <div className="text-4xl font-bold flex items-baseline gap-2">
                  {sub.peakActiveUnitCount}
                  <span className="text-sm font-normal text-primary-foreground/60">
                    / {sub.freeUnitLimit ? `${sub.freeUnitLimit} free` : 'no limit'}
                  </span>
                </div>
              </div>
              <div>
                <div className="text-primary-foreground/70 text-sm mb-1">Estimated Charge</div>
                {isEnterpriseCustom(customPricing) ? (
                  <div className="flex items-center gap-2" data-testid="enterprise-custom-charge">
                    <PhoneCall className="h-6 w-6 text-primary-foreground/80" />
                    <span className="text-xl font-semibold text-primary-foreground" data-testid="enterprise-custom-label">
                      Custom pricing
                    </span>
                  </div>
                ) : (
                  <div className="text-4xl font-bold flex items-baseline gap-2" data-testid="standard-charge">
                    {formatEstimatedCharge(sub.currentPlan, sub.estimatedAmountCents, customPricing)}
                    <span className="text-sm font-normal text-primary-foreground/60">this month</span>
                  </div>
                )}
              </div>
            </div>
            
            <div className="bg-black/20 rounded-lg p-4 text-sm leading-relaxed border border-white/10">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-white/70" />
                <p className="text-primary-foreground/90" data-testid="charge-explanation">
                  {formatChargeExplanation(
                    sub.currentPlan,
                    sub.peakActiveUnitCount,
                    sub.ratePerUnitCents,
                    sub.estimatedAmountCents,
                    customPricing,
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader>
            <CardTitle>Plan Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center py-3 border-b border-border">
              <span className="text-muted-foreground">Rate per unit</span>
              <span className="font-semibold" data-testid="rate-per-unit">
                {isEnterpriseCustom(customPricing)
                  ? "Custom"
                  : `€${((sub.ratePerUnitCents ?? 0) / 100).toFixed(2)}`}
              </span>
            </div>
            <div className="flex justify-between items-center py-3 border-b border-border">
              <span className="text-muted-foreground">Current active</span>
              <span className="font-semibold">{sub.activeUnitCount}</span>
            </div>
            <div className="flex justify-between items-center py-3 border-b border-border">
              <span className="text-muted-foreground">Enterprise Flag</span>
              {sub.enterpriseFlagged ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : (
                <span className="text-muted-foreground">-</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-muted-foreground" />
            Usage History
          </CardTitle>
          <CardDescription>Your billing peaks for the last 12 months.</CardDescription>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : !history?.length ? (
            <div className="text-center py-8 text-muted-foreground">No billing history available yet.</div>
          ) : (
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="px-4 py-3 font-medium">Month</th>
                    <th className="px-4 py-3 font-medium">Peak Units</th>
                    <th className="px-4 py-3 font-medium">Rate</th>
                    <th className="px-4 py-3 font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {history.map((record) => (
                    <tr key={record.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3 font-medium">{format(new Date(record.billingMonth), 'MMM yyyy')}</td>
                      <td className="px-4 py-3">{record.peakActiveUnitCount}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatHistoryRate(
                          record.subscriptionTier,
                          record.estimatedAmountCents,
                          record.ratePerUnitCents,
                          record.isCustomPricing,
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold">
                        {formatHistoryAmount(
                          record.subscriptionTier,
                          record.estimatedAmountCents,
                          record.finalAmountCents,
                          record.isCustomPricing,
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Badge variant={record.invoiceStatus === 'finalised' ? 'default' : 'secondary'} className="capitalize">
                          {record.invoiceStatus}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

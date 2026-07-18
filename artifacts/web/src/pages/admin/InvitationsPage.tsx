import { Mail, Clock, Send, Trash2 } from "lucide-react";
import { useGetCompanyInvitations, getGetCompanyInvitationsQueryKey, useResendInvitation, useRevokeUnitMembership } from "@workspace/api-client-react";
import { useAppContext } from "@/hooks/useAppContext";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { format } from "date-fns";

export default function InvitationsPage() {
  const { selectedCompanyId } = useAppContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: invitations, isLoading } = useGetCompanyInvitations(selectedCompanyId!, { status: 'pending' }, {
    query: { enabled: !!selectedCompanyId, queryKey: getGetCompanyInvitationsQueryKey(selectedCompanyId!, { status: 'pending' }) }
  });

  const resendInvite = useResendInvitation();
  const revokeInvite = useRevokeUnitMembership();

  const handleResend = (id: string) => {
    resendInvite.mutate(
      { id },
      {
        onSuccess: () => toast({ title: "Invitation resent successfully" }),
        onError: () => toast({ title: "Failed to resend", variant: "destructive" })
      }
    );
  };

  const handleRevoke = (id: string) => {
    if(confirm("Are you sure you want to cancel this invitation?")) {
      revokeInvite.mutate(
        { id },
        {
          onSuccess: () => {
            toast({ title: "Invitation cancelled" });
            queryClient.invalidateQueries({ queryKey: getGetCompanyInvitationsQueryKey(selectedCompanyId!, { status: 'pending' }) });
          },
          onError: () => toast({ title: "Failed to cancel", variant: "destructive" })
        }
      );
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Pending Invitations</h1>
        <p className="text-muted-foreground mt-1">Owners and tenants who haven't accepted their invites yet.</p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      ) : !invitations?.length ? (
        <div className="text-center py-24 border-2 border-dashed border-border rounded-xl bg-card">
          <Mail className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold">No pending invitations</h3>
          <p className="text-muted-foreground max-w-sm mx-auto mt-2">
            All invited users have joined the platform, or you haven't sent any invitations recently.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {invitations.map((invite) => (
            <Card key={invite.id} className="overflow-hidden">
              <CardContent className="p-0">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-6 gap-4">
                  <div className="flex gap-4">
                    <div className="h-10 w-10 bg-primary/10 text-primary rounded-full flex items-center justify-center shrink-0">
                      <Clock className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold">{invite.invitedName}</span>
                        <Badge variant="outline" className="capitalize text-xs">{invite.role}</Badge>
                      </div>
                      <div className="text-sm text-muted-foreground flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                        <span className="flex items-center gap-1"><Mail className="h-3 w-3"/> {invite.invitedEmail}</span>
                        <span className="hidden sm:inline text-border">•</span>
                        <span>{invite.building.name}, Apt {invite.unit.unitNumber}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-2">
                        Invited {format(new Date(invite.createdAt), 'MMM d, yyyy')}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2 self-end sm:self-auto w-full sm:w-auto">
                    <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => handleResend(invite.id)} disabled={resendInvite.isPending}>
                      <Send className="h-4 w-4 mr-2" />
                      Resend
                    </Button>
                    <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10 shrink-0" onClick={() => handleRevoke(invite.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

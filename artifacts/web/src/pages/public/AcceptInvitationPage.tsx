import { useEffect, useRef } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useClerk, useUser, Show } from "@clerk/react";
import { Building } from "lucide-react";
import { useAcceptInvitation } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";

export default function AcceptInvitationPage() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const { isSignedIn, isLoaded } = useUser();
  const acceptInvitation = useAcceptInvitation();
  const { toast } = useToast();
  
  const token = params.token;
  const hasAttempted = useRef(false);

  useEffect(() => {
    // If they are signed in and haven't tried to accept yet, do it automatically
    if (isLoaded && isSignedIn && token && !hasAttempted.current) {
      hasAttempted.current = true;
      acceptInvitation.mutate(
        { data: { token } },
        {
          onSuccess: (res) => {
            toast({ title: "Invitation accepted!" });
            if (res.redirectTo) {
              setLocation(res.redirectTo);
            } else {
              setLocation(res.role === "owner" ? "/owner/home" : "/tenant/home");
            }
          },
          onError: (err: any) => {
            toast({ 
              title: "Failed to accept invitation", 
              description: err?.message || "This invitation may be invalid or expired.",
              variant: "destructive" 
            });
          }
        }
      );
    }
  }, [isLoaded, isSignedIn, token, acceptInvitation, setLocation, toast]);

  if (!token) {
    return <div className="min-h-screen flex items-center justify-center">Invalid invitation link.</div>;
  }

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center p-4">
      <div className="mb-8 flex items-center gap-2">
        <div className="h-8 w-8 bg-primary text-primary-foreground rounded-lg flex items-center justify-center">
          <Building className="h-5 w-5" />
        </div>
        <span className="font-bold text-xl tracking-tight text-foreground">CondoManager</span>
      </div>

      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">You've been invited!</CardTitle>
          <CardDescription>
            Join your building on CondoManager to access your apartment details.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Show when="signed-out">
            <p className="text-sm text-muted-foreground text-center">
              Please sign in or create an account to accept this invitation. 
              Use the email address the invitation was sent to.
            </p>
            <div className="flex flex-col gap-3 mt-6">
              <Link href={`/sign-up`}>
                <Button className="w-full">Create Account</Button>
              </Link>
              <Link href={`/sign-in`}>
                <Button variant="outline" className="w-full">Sign In</Button>
              </Link>
            </div>
          </Show>
          
          <Show when="signed-in">
            <div className="flex flex-col items-center justify-center py-8">
              {acceptInvitation.isPending ? (
                <p className="animate-pulse">Accepting invitation...</p>
              ) : acceptInvitation.isError ? (
                <div className="text-center space-y-4">
                  <p className="text-destructive font-medium">Failed to process invitation</p>
                  <Button variant="outline" onClick={() => setLocation("/")}>Go to Home</Button>
                </div>
              ) : acceptInvitation.isSuccess ? (
                <p className="text-green-600 font-medium">Redirecting...</p>
              ) : (
                <p>Processing...</p>
              )}
            </div>
          </Show>
        </CardContent>
      </Card>
    </div>
  );
}

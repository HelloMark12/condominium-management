import { useUser } from "@clerk/react";
import { User, Mail, Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { format } from "date-fns";

export default function OwnerProfilePage() {
  const { user, isLoaded } = useUser();

  if (!isLoaded || !user) return null;

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Profile</h1>
        <p className="text-muted-foreground mt-1">Manage your account details.</p>
      </div>

      <Card className="bg-card overflow-hidden">
        <div className="h-32 bg-primary/10"></div>
        <CardContent className="relative pt-0 px-8 pb-8">
          <Avatar className="h-24 w-24 border-4 border-card -mt-12 mb-6 bg-muted">
            <AvatarImage src={user.imageUrl} />
            <AvatarFallback className="text-2xl font-bold">
              {user.firstName?.charAt(0) || user.emailAddresses[0].emailAddress.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold">{user.fullName || "Owner"}</h2>
              <div className="inline-flex items-center px-2.5 py-0.5 mt-2 rounded-full text-xs font-semibold bg-primary/10 text-primary">
                Property Owner
              </div>
            </div>

            <div className="space-y-4 pt-4 border-t border-border">
              <div className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-muted-foreground" />
                <span>{user.primaryEmailAddress?.emailAddress}</span>
              </div>
              <div className="flex items-center gap-3">
                <Calendar className="h-5 w-5 text-muted-foreground" />
                <span>Joined {format(user.createdAt || new Date(), 'MMMM yyyy')}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      
      <p className="text-sm text-muted-foreground text-center">
        To update your email or password, please contact support.
      </p>
    </div>
  );
}

import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useGetCompany, getGetCompanyQueryKey, useUpdateCompany } from "@workspace/api-client-react";
import { useAppContext } from "@/hooks/useAppContext";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";

const settingsSchema = z.object({
  name: z.string().min(2, "Company name is required"),
});

export default function SettingsPage() {
  const { selectedCompanyId } = useAppContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: company, isLoading } = useGetCompany(selectedCompanyId!, {
    query: { enabled: !!selectedCompanyId, queryKey: getGetCompanyQueryKey(selectedCompanyId!) }
  });

  const updateCompany = useUpdateCompany();

  const form = useForm<z.infer<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
    defaultValues: { name: "" },
  });

  const initialized = useRef(false);

  useEffect(() => {
    if (company && !initialized.current) {
      form.reset({ name: company.name });
      initialized.current = true;
    }
  }, [company, form]);

  const onSubmit = (values: z.infer<typeof settingsSchema>) => {
    updateCompany.mutate(
      { companyId: selectedCompanyId!, data: values },
      {
        onSuccess: (data) => {
          toast({ title: "Settings updated" });
          queryClient.setQueryData(getGetCompanyQueryKey(selectedCompanyId!), data);
        },
        onError: () => toast({ title: "Update failed", variant: "destructive" })
      }
    );
  };

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 max-w-2xl" /></div>;

  return (
    <div className="p-8 max-w-3xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your company profile.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Company Profile</CardTitle>
          <CardDescription>Update the name of your administration company.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Company Name</FormLabel>
                    <FormControl>
                      <Input {...field} className="max-w-md" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <Button type="submit" disabled={updateCompany.isPending || !form.formState.isDirty}>
                {updateCompany.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

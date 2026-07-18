import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { ArrowLeft } from "lucide-react";

import { useCreateBuilding } from "@workspace/api-client-react";
import { useAppContext } from "@/hooks/useAppContext";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/components/ui/use-toast";

const formSchema = z.object({
  name: z.string().min(2, "Building name is required"),
  addressLine1: z.string().optional(),
  locality: z.string().min(2, "Locality is required"),
  postcode: z.string().optional(),
});

export default function CreateBuildingPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { selectedCompanyId } = useAppContext();

  const createBuilding = useCreateBuilding();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", addressLine1: "", locality: "", postcode: "" },
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    if (!selectedCompanyId) return;
    
    createBuilding.mutate(
      { companyId: selectedCompanyId, data: { ...values, country: "Malta" } },
      {
        onSuccess: (building) => {
          toast({ title: "Building created successfully" });
          setLocation(`/admin/buildings/${building.id}`);
        },
        onError: () => {
          toast({ title: "Error creating building", variant: "destructive" });
        }
      }
    );
  };

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <div>
        <Button variant="ghost" size="sm" className="mb-4 -ml-3 text-muted-foreground" onClick={() => setLocation("/admin/buildings")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Buildings
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">Add Building</h1>
      </div>

      <Card>
        <CardContent className="p-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Building Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Harbour Court" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="border-t border-border pt-6 mt-6">
                <h3 className="text-lg font-medium mb-4">Location</h3>
                <div className="space-y-4">
                  <FormField
                    control={form.control}
                    name="addressLine1"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Street Address</FormLabel>
                        <FormControl>
                          <Input placeholder="Triq il-Kbira" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="locality"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Locality</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. Sliema" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="postcode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Postcode</FormLabel>
                          <FormControl>
                            <Input placeholder="SLM 1234" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <Button type="button" variant="outline" className="mr-3" onClick={() => setLocation("/admin/buildings")}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createBuilding.isPending}>
                  {createBuilding.isPending ? "Creating..." : "Save Building"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Building, ArrowRight } from "lucide-react";

import { useRegisterCompany, useCreateBuilding } from "@workspace/api-client-react";
import { useAppContext } from "@/hooks/useAppContext";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/components/ui/use-toast";

const step1Schema = z.object({
  name: z.string().min(2, "Company name must be at least 2 characters"),
});

const step2Schema = z.object({
  name: z.string().min(2, "Building name is required"),
  addressLine1: z.string().optional(),
  locality: z.string().min(2, "Locality is required"),
  postcode: z.string().optional(),
});

export default function OnboardingPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2>(1);
  const [createdCompanyId, setCreatedCompanyId] = useState<string | null>(null);

  const registerCompany = useRegisterCompany();
  const createBuilding = useCreateBuilding();

  const form1 = useForm<z.infer<typeof step1Schema>>({
    resolver: zodResolver(step1Schema),
    defaultValues: { name: "" },
  });

  const form2 = useForm<z.infer<typeof step2Schema>>({
    resolver: zodResolver(step2Schema),
    defaultValues: { name: "", addressLine1: "", locality: "", postcode: "" },
  });

  const onSubmitStep1 = (values: z.infer<typeof step1Schema>) => {
    registerCompany.mutate({ data: values }, {
      onSuccess: (company) => {
        setCreatedCompanyId(company.id);
        setStep(2);
      },
      onError: () => {
        toast({ title: "Error creating company", variant: "destructive" });
      }
    });
  };

  const onSubmitStep2 = (values: z.infer<typeof step2Schema>) => {
    if (!createdCompanyId) return;
    
    createBuilding.mutate(
      { companyId: createdCompanyId, data: { ...values, country: "Malta" } },
      {
        onSuccess: () => {
          toast({ title: "Setup complete!" });
          // Force a reload to get the new user context with the company
          window.location.href = "/admin/dashboard"; 
        },
        onError: () => {
          toast({ title: "Error creating building", variant: "destructive" });
        }
      }
    );
  };

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-center justify-center gap-2">
          <div className="h-10 w-10 bg-primary text-primary-foreground rounded-xl flex items-center justify-center">
            <Building className="h-6 w-6" />
          </div>
        </div>

        <Card className="shadow-lg border-border/50">
          <CardHeader>
            <CardTitle className="text-2xl">
              {step === 1 ? "Welcome to CondoManager" : "Add your first building"}
            </CardTitle>
            <CardDescription>
              {step === 1 
                ? "Let's start by setting up your administration company." 
                : "You can add more buildings later from your dashboard."}
            </CardDescription>
          </CardHeader>
          
          <CardContent>
            {step === 1 ? (
              <Form {...form1}>
                <form onSubmit={form1.handleSubmit(onSubmitStep1)} className="space-y-6">
                  <FormField
                    control={form1.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Company Name</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Prestige Properties Ltd" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full" disabled={registerCompany.isPending}>
                    {registerCompany.isPending ? "Creating..." : "Continue"}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </form>
              </Form>
            ) : (
              <Form {...form2}>
                <form onSubmit={form2.handleSubmit(onSubmitStep2)} className="space-y-4">
                  <FormField
                    control={form2.control}
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
                  <FormField
                    control={form2.control}
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
                      control={form2.control}
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
                      control={form2.control}
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
                  <Button type="submit" className="w-full mt-4" disabled={createBuilding.isPending}>
                    {createBuilding.isPending ? "Finishing setup..." : "Go to Dashboard"}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import { Link } from "wouter";
import { motion } from "framer-motion";
import { Building, ShieldCheck, Smartphone, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      {/* Header */}
      <header className="w-full px-6 py-4 flex items-center justify-between bg-background/80 backdrop-blur-md sticky top-0 z-50 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 bg-primary text-primary-foreground rounded-lg flex items-center justify-center">
            <Building className="h-5 w-5" />
          </div>
          <span className="font-bold text-xl tracking-tight text-foreground">CondoManager</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/sign-in" className="text-sm font-medium hover:text-primary transition-colors">Sign in</Link>
          <Link href="/sign-up">
            <Button size="sm">Get Started</Button>
          </Link>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="px-6 py-24 md:py-32 max-w-6xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-foreground mb-6">
              Professional Condominium<br />Management
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
              Institutional-grade property software designed for administrators in Malta. 
              Bring precision to your portfolio, clarity to owners, and ease to tenants.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/sign-up">
                <Button size="lg" className="h-14 px-8 text-lg w-full sm:w-auto">
                  Start Managing Properties
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <Link href="/sign-in">
                <Button size="lg" variant="outline" className="h-14 px-8 text-lg w-full sm:w-auto bg-transparent">
                  Owner or Tenant Login
                </Button>
              </Link>
            </div>
          </motion.div>
        </section>

        {/* Features */}
        <section className="bg-card border-y border-border py-24">
          <div className="max-w-6xl mx-auto px-6 grid md:grid-cols-3 gap-12">
            <FeatureCard 
              icon={<ShieldCheck className="h-8 w-8 text-primary" />}
              title="Calm Authority"
              description="A structured, data-dense dashboard built for administrators handling multiple buildings and hundreds of units."
            />
            <FeatureCard 
              icon={<Building className="h-8 w-8 text-primary" />}
              title="Portfolio Precision"
              description="Track ownership changes, tenancy updates, and unit statuses with a meticulous source of truth."
            />
            <FeatureCard 
              icon={<Smartphone className="h-8 w-8 text-primary" />}
              title="Resident Portals"
              description="Mobile-friendly, approachable interfaces for owners and tenants to view notices and manage their details."
            />
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-8 text-center text-sm text-muted-foreground bg-background">
        <p>&copy; {new Date().getFullYear()} CondoManager Malta. All rights reserved.</p>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="h-16 w-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
        {icon}
      </div>
      <h3 className="text-xl font-semibold mb-3">{title}</h3>
      <p className="text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}

// ============================================================================
// MODE SELECTOR — Step 1 of startup wizard
// User picks: Server Mode (host DB locally) or Client Mode (join remote server)
// ============================================================================

import { Server, Monitor, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

function ModeCard({ onClick, icon: Icon, iconBg, title, description, features, badge, badgeClass, primary }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative w-full text-left rounded-xl border p-5",
        "transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]",
        primary
          ? "border-primary/30 bg-primary/[0.04] hover:border-primary/60 hover:bg-primary/[0.08] hover:shadow-lg hover:shadow-primary/10"
          : "border-border bg-muted/[0.03] hover:border-border/80 hover:bg-muted/[0.07]"
      )}
    >
      {/* Icon */}
      <div className={cn("mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl border", iconBg)}>
        <Icon className="h-4.5 w-4.5" />
      </div>

      {/* Title */}
      <h3 className="text-[13px] font-bold text-foreground tracking-tight mb-1">{title}</h3>
      <p className="text-[11px] text-muted-foreground leading-relaxed mb-4">{description}</p>

      {/* Feature list */}
      <ul className="space-y-1.5 mb-5">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-[11px] text-muted-foreground">
            <span className={cn("mt-[5px] h-1.5 w-1.5 rounded-full shrink-0", primary ? "bg-primary/70" : "bg-muted-foreground/40")} />
            {f}
          </li>
        ))}
      </ul>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-border/40">
        <span className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide border", badgeClass)}>
          {badge}
        </span>
        <ArrowRight className={cn(
          "h-3.5 w-3.5 transition-all group-hover:translate-x-0.5",
          primary ? "text-primary/60 group-hover:text-primary" : "text-muted-foreground/40 group-hover:text-muted-foreground"
        )} />
      </div>
    </button>
  );
}

export default function ModeSelector({ onSelect }) {
  return (
    <div className="flex flex-col gap-6 animate-fade-in">

      {/* Brand */}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/30 bg-primary/[0.08]">
          <span className="text-[18px] font-black text-primary leading-none">Q</span>
        </div>
        <div>
          <h1 className="text-[15px] font-black text-foreground tracking-tight leading-none">Quantum POS</h1>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-1">Initial Setup</p>
        </div>
      </div>

      {/* Prompt */}
      <div>
        <h2 className="text-[20px] font-black text-foreground tracking-tight leading-tight">
          How will this terminal<br />
          <span className="text-primary">operate?</span>
        </h2>
        <p className="text-[12px] text-muted-foreground mt-2 leading-relaxed">
          Choose the role for this machine. This only needs to be set once.
        </p>
      </div>

      {/* Mode cards */}
      <div className="grid grid-cols-2 gap-3">
        <ModeCard
          onClick={() => onSelect("server")}
          icon={Server}
          iconBg="border-primary/25 bg-primary/[0.08] text-primary"
          title="Server Mode"
          description="Runs the database and API. Other terminals connect to this machine."
          features={[
            "Hosts the PostgreSQL database",
            "Exposes API for clients",
            "Main counter / back-office",
          ]}
          badge="Primary"
          badgeClass="bg-primary/10 text-primary border-primary/25"
          primary
        />
        <ModeCard
          onClick={() => onSelect("client")}
          icon={Monitor}
          iconBg="border-border bg-muted/40 text-muted-foreground"
          title="Client Mode"
          description="Connects to an existing server on the network. No local database needed."
          features={[
            "Connects via LAN",
            "Enter server IP and port",
            "Additional checkout counters",
          ]}
          badge="Requires server"
          badgeClass="bg-muted/60 text-muted-foreground border-border"
          primary={false}
        />
      </div>

      <p className="text-[10px] font-semibold text-muted-foreground/50 text-center uppercase tracking-wider">
        Both terminals must be on the same local network
      </p>
    </div>
  );
}

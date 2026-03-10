// ============================================================================
// MODE SELECTOR — Step 1 of startup wizard
// User picks: Server Mode (host DB locally) or Client Mode (join remote server)
// ============================================================================

import { Server, Monitor, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

function ModeCard({ onClick, icon: Icon, iconClass, title, description, features, badge, badgeClass }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative w-full text-left rounded-xl border bg-card p-5",
        "border-border hover:border-primary/50 hover:bg-primary/5",
        "transition-all duration-200 hover:shadow-lg hover:shadow-primary/5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "active:scale-[0.99]"
      )}
    >
      {/* Icon */}
      <div className={cn(
        "mb-4 inline-flex h-11 w-11 items-center justify-center rounded-lg",
        iconClass
      )}>
        <Icon className="h-5 w-5" />
      </div>

      {/* Title + desc */}
      <h3 className="text-sm font-semibold text-foreground mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground leading-relaxed mb-4">{description}</p>

      {/* Feature list */}
      <ul className="space-y-1.5 mb-5">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
            <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-primary/60 shrink-0" />
            {f}
          </li>
        ))}
      </ul>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold border", badgeClass)}>
          {badge}
        </span>
        <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
      </div>
    </button>
  );
}

export default function ModeSelector({ onSelect }) {
  return (
    <div className="flex flex-col items-center gap-7 animate-fade-in">

      {/* Brand */}
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 border border-primary/20">
          <span className="text-2xl font-bold text-primary">Q</span>
        </div>
        <div className="text-center">
          <h1 className="text-xl font-bold text-foreground tracking-tight">Quantum POS</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Point of Sale System</p>
        </div>
      </div>

      {/* Prompt */}
      <div className="text-center">
        <h2 className="text-sm font-semibold text-foreground">How will this terminal operate?</h2>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          Choose the role for this machine on your network. This only needs to be set once.
        </p>
      </div>

      {/* Mode cards */}
      <div className="grid grid-cols-2 gap-3 w-full">
        <ModeCard
          onClick={() => onSelect("server")}
          icon={Server}
          iconClass="bg-primary/15 text-primary border border-primary/20"
          title="Server Mode"
          description="This machine runs the database and API. Other terminals on the network connect to it."
          features={[
            "Hosts the PostgreSQL database",
            "Exposes API for client terminals",
            "Best for main counter / back-office",
          ]}
          badge="Primary machine"
          badgeClass="bg-primary/10 text-primary border-primary/20"
        />
        <ModeCard
          onClick={() => onSelect("client")}
          icon={Monitor}
          iconClass="bg-muted text-muted-foreground border border-border"
          title="Client Mode"
          description="This machine connects to an existing server on the network. No local database needed."
          features={[
            "Connects to a server via LAN",
            "Enter the server IP and port",
            "Best for additional checkout counters",
          ]}
          badge="Requires a server"
          badgeClass="bg-muted text-muted-foreground border-border"
        />
      </div>

      <p className="text-[11px] text-muted-foreground text-center">
        Server and client terminals must be on the same local network.
      </p>
    </div>
  );
}

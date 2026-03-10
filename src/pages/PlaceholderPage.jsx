import { Construction } from "lucide-react";

export default function PlaceholderPage({ title, description }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center overflow-auto">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted border border-border">
        <Construction className="h-8 w-8 text-muted-foreground" />
      </div>
      <div className="max-w-sm">
        <h1 className="text-lg font-bold text-foreground">{title}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
          {description ?? "This screen is being built. The backend API is fully operational."}
        </p>
      </div>
      <span className="rounded-full border border-warning/30 bg-warning/10 px-3 py-1 text-[11px] font-medium text-warning">
        Coming soon
      </span>
    </div>
  );
}

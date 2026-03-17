// ============================================================================
// components/ui/pagination.jsx — shadcn/ui Pagination primitives
// ============================================================================

import * as React from "react";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

// ── Root ──────────────────────────────────────────────────────────────────────
const Pagination = ({ className, ...props }) => (
  <nav
    role="navigation"
    aria-label="pagination"
    className={cn("mx-auto flex w-full justify-center", className)}
    {...props}
  />
);
Pagination.displayName = "Pagination";

// ── Content wrapper ───────────────────────────────────────────────────────────
const PaginationContent = React.forwardRef(({ className, ...props }, ref) => (
  <ul
    ref={ref}
    className={cn("flex flex-row items-center gap-1", className)}
    {...props}
  />
));
PaginationContent.displayName = "PaginationContent";

// ── List item ─────────────────────────────────────────────────────────────────
const PaginationItem = React.forwardRef(({ className, ...props }, ref) => (
  <li ref={ref} className={cn("", className)} {...props} />
));
PaginationItem.displayName = "PaginationItem";

// ── Page link ─────────────────────────────────────────────────────────────────
const PaginationLink = ({ className, isActive, size = "icon", ...props }) => (
  <a
    aria-current={isActive ? "page" : undefined}
    className={cn(
      buttonVariants({ variant: isActive ? "outline" : "ghost", size }),
      "h-8 w-8 cursor-pointer select-none text-xs",
      isActive &&
        "border-primary/40 bg-primary/10 text-primary font-bold pointer-events-none",
      className,
    )}
    {...props}
  />
);
PaginationLink.displayName = "PaginationLink";

// ── Previous ──────────────────────────────────────────────────────────────────
const PaginationPrevious = ({ className, ...props }) => (
  <PaginationLink
    aria-label="Go to previous page"
    size="default"
    className={cn("h-8 gap-1 px-2.5 text-xs", className)}
    {...props}
  >
    <ChevronLeft className="h-4 w-4" />
    <span>Prev</span>
  </PaginationLink>
);
PaginationPrevious.displayName = "PaginationPrevious";

// ── Next ──────────────────────────────────────────────────────────────────────
const PaginationNext = ({ className, ...props }) => (
  <PaginationLink
    aria-label="Go to next page"
    size="default"
    className={cn("h-8 gap-1 px-2.5 text-xs", className)}
    {...props}
  >
    <span>Next</span>
    <ChevronRight className="h-4 w-4" />
  </PaginationLink>
);
PaginationNext.displayName = "PaginationNext";

// ── Ellipsis ──────────────────────────────────────────────────────────────────
const PaginationEllipsis = ({ className, ...props }) => (
  <span
    aria-hidden
    className={cn(
      "flex h-8 w-8 items-center justify-center text-muted-foreground",
      className,
    )}
    {...props}
  >
    <MoreHorizontal className="h-4 w-4" />
    <span className="sr-only">More pages</span>
  </span>
);
PaginationEllipsis.displayName = "PaginationEllipsis";

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
};

"use client";

import { cn } from "@/lib/utils";

interface WorldIdBadgeProps {
  verified: boolean;
  className?: string;
}

export function WorldIdBadge({ verified, className }: WorldIdBadgeProps) {
  if (verified) {
    return (
      <span
        title="Verified via World ID"
        className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 font-mono text-xs tracking-normal leading-none whitespace-nowrap border bg-teal/8 border-teal/30 text-teal",
          className
        )}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0">
          <path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        World ID
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 font-mono text-xs tracking-normal leading-none whitespace-nowrap border bg-gold/8 border-gold-dim text-gold",
        className
      )}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0">
        <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.2"/>
      </svg>
      Pending
    </span>
  );
}

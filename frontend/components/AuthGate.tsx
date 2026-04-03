"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useAppKit } from "@reown/appkit/react";

interface AuthGateProps {
  sectionLabel: string;
  heading: ReactNode;
  body: string;
}

export function AuthGate({ sectionLabel, heading, body }: AuthGateProps) {
  const { open } = useAppKit();

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      {/* Minimal nav — no wallet widget until connected */}
      <nav className="sticky top-0 z-50 border-b border-line px-8 bg-bg/92 backdrop-blur-md">
        <div className="max-w-6xl mx-auto h-14 flex items-center">
          <Link href="/" className="font-heading font-bold text-sm tracking-loose text-gold">
            PAYFLOW
          </Link>
        </div>
      </nav>

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">
          <div className="section-label mb-3">{sectionLabel}</div>
          <h1 className="text-3xl sm:text-4xl font-bold mb-4 font-heading text-ink leading-tight wrap-break-word">
            {heading}
          </h1>
          <p className="mb-10 text-sm text-muted leading-relaxed">{body}</p>

          <button
            onClick={() => open()}
            className="inline-flex items-center gap-3 px-7 py-3.5 font-mono text-sm tracking-widest font-medium bg-gold text-paper transition-all hover:brightness-110"
          >
            Connect wallet →
          </button>
        </div>
      </div>
    </div>
  );
}

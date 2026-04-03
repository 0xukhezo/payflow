"use client";

import Link from "next/link";
import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { useNetworkMode } from "@/lib/network-mode";
import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

// Declare AppKit web component for TypeScript
declare global {
  namespace JSX {
    interface IntrinsicElements {
      "appkit-button": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        balance?: "show" | "hide";
        size?: "sm" | "md";
      };
    }
  }
}

interface AppNavProps {
  label?: string;
  actions?: ReactNode;
}

export function AppNav({ label, actions }: AppNavProps) {
  const { address, isConnected } = useAppKitAccount();
  const { open } = useAppKit();
  const { mode, setMode } = useNetworkMode();

  return (
    <>
      {/* Testnet banner */}
      {mode === "testnet" && (
        <div className="w-full bg-gold/10 border-b border-gold/20 px-8 py-1.5 flex items-center justify-center gap-2">
          <AlertTriangle className="w-3 h-3 text-gold shrink-0" />
          <span className="font-mono text-[10px] text-gold tracking-widest">
            TESTNET MODE — Sepolia · No real funds
          </span>
        </div>
      )}

      <nav className="sticky top-0 z-50 border-b border-line px-8 bg-bg/92 backdrop-blur-md">
        <div className="max-w-6xl mx-auto h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="font-heading font-bold text-sm tracking-loose text-gold">
              PAYFLOW
            </Link>
            {label && (
              <>
                <span className="text-rim">│</span>
                <span className="font-mono text-xs text-muted tracking-widest">{label}</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Network mode toggle */}
            <div className="flex items-center border border-rim overflow-hidden font-mono text-[10px] tracking-widest">
              <button
                onClick={() => setMode("testnet")}
                className={`px-3 py-1.5 transition-colors ${
                  mode === "testnet"
                    ? "bg-gold text-paper font-bold"
                    : "text-muted hover:text-ink"
                }`}
              >
                TESTNET
              </button>
              <button
                onClick={() => setMode("mainnet")}
                className={`px-3 py-1.5 transition-colors ${
                  mode === "mainnet"
                    ? "bg-teal text-paper font-bold"
                    : "text-muted hover:text-ink"
                }`}
              >
                MAINNET
              </button>
            </div>

            {isConnected && address ? (
              <>
                {actions}
                <appkit-button size="sm" balance="hide" />
              </>
            ) : (
              <button
                onClick={() => open()}
                className="px-4 py-1.5 font-mono text-[10px] tracking-widest border border-gold text-gold hover:bg-gold hover:text-paper transition-colors"
              >
                CONNECT
              </button>
            )}
          </div>
        </div>
      </nav>
    </>
  );
}

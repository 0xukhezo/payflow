"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUserRole } from "@/lib/useUserRole";

export function HeroCTAs() {
  const router = useRouter();
  const { isCompany, primaryWallet } = useUserRole();

  // Auto-redirect when we know the user's role
  useEffect(() => {
    if (!primaryWallet || isCompany === null) return;
    if (isCompany) {
      router.replace("/company");
      return;
    }
    router.replace("/employee");
  }, [isCompany, primaryWallet?.address]);

  // Show nothing during hydration / backend lookup
  if (primaryWallet && isCompany === null) return null;

  if (!primaryWallet) {
    return (
      <div className="fade-up fade-up-4 flex items-center gap-4">
        <Link
          href="/company"
          className="inline-flex items-center gap-3 px-7 py-3.5 font-mono text-sm tracking-widest font-medium bg-gold text-paper transition-all hover:brightness-110"
        >
          Set up payroll <span>→</span>
        </Link>
        <Link
          href="/employee"
          className="inline-flex items-center gap-3 px-7 py-3.5 font-mono text-sm tracking-widest font-medium border border-rim text-muted transition-all hover:brightness-110"
        >
          View my earnings <span>→</span>
        </Link>
      </div>
    );
  }

  // Wallet connected — redirect is happening, show nothing
  return null;
}

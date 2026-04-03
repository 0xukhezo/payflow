import { useState, useEffect } from "react";
import { useAppKitAccount } from "@reown/appkit/react";
import { API_URL } from "./contracts";

/**
 * Returns the role of the connected wallet.
 * - Checks localStorage first (fast, no network)
 * - Falls back to a backend lookup so it works across devices
 * - Persists the result in localStorage once found
 */
export function useUserRole() {
  const { address, isConnected } = useAppKitAccount();
  const primaryWallet = isConnected && address ? { address } : null;
  const [isCompany, setIsCompany] = useState<boolean | null>(null);

  useEffect(() => {
    if (!primaryWallet) { setIsCompany(null); return; }
    const addr = primaryWallet.address.toLowerCase();

    // Fast path: localStorage already has the company ID
    if (localStorage.getItem(`payflow_company_id_${addr}`)) {
      setIsCompany(true);
      return;
    }

    // Slow path: ask the backend (handles new device / cleared storage)
    setIsCompany(null);
    fetch(`${API_URL}/api/company/by-wallet/${addr}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.companyId) {
          localStorage.setItem(`payflow_company_id_${addr}`, data.companyId);
          setIsCompany(true);
        } else {
          setIsCompany(false);
        }
      })
      .catch(() => setIsCompany(false));
  }, [primaryWallet?.address]);

  return { isCompany, primaryWallet };
}

"use client";

import { createAppKit } from "@reown/appkit/react";
import { DefaultSIWX } from "@reown/appkit-siwx";
import { EthersAdapter } from "@reown/appkit-adapter-ethers";
import { SolanaAdapter } from "@reown/appkit-adapter-solana";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { sepolia, solana } from "@reown/appkit/networks";
import { ToastProvider } from "@/components/Toast";
import { LogoutRedirect } from "@/components/LogoutRedirect";
import { NetworkModeProvider } from "@/lib/network-mode";

const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID || "";

const solanaAdapter = new SolanaAdapter({
  wallets: [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
});

createAppKit({
  adapters: [new EthersAdapter(), solanaAdapter],
  networks: [sepolia, solana],
  defaultNetwork: sepolia,
  projectId,
  metadata: {
    name: "PayFlow",
    description: "Crypto payroll — pay your team in any token on any chain.",
    url: "https://payflow.app",
    icons: [],
  },
  features: {
    analytics: false,
    email: false,
    socials: [],
  },
  siwx: new DefaultSIWX(),
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <NetworkModeProvider>
        <LogoutRedirect />
        {children}
      </NetworkModeProvider>
    </ToastProvider>
  );
}

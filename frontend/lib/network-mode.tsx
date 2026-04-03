"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { type NetworkMode, type NetworkConfig, NETWORK_MODE_CONFIG, getDefaultNetwork } from "./networks";

interface NetworkModeContextValue {
  mode: NetworkMode;
  setMode: (m: NetworkMode) => void;
  supportedNetworks: NetworkConfig[];
  defaultNetwork: NetworkConfig;
}

const NetworkModeContext = createContext<NetworkModeContextValue>({
  mode:              "testnet",
  setMode:           () => {},
  supportedNetworks: NETWORK_MODE_CONFIG.testnet.networks,
  defaultNetwork:    getDefaultNetwork("testnet"),
});

export function NetworkModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<NetworkMode>("testnet");

  useEffect(() => {
    const saved = localStorage.getItem("payflow_network_mode") as NetworkMode | null;
    if (saved === "mainnet" || saved === "testnet") setModeState(saved);
  }, []);

  const setMode = (m: NetworkMode) => {
    setModeState(m);
    localStorage.setItem("payflow_network_mode", m);
  };

  const cfg = NETWORK_MODE_CONFIG[mode];

  return (
    <NetworkModeContext.Provider value={{
      mode,
      setMode,
      supportedNetworks: cfg.networks,
      defaultNetwork:    cfg.networks[0],
    }}>
      {children}
    </NetworkModeContext.Provider>
  );
}

export function useNetworkMode() {
  return useContext(NetworkModeContext);
}

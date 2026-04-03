"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAppKitAccount } from "@reown/appkit/react";

export function LogoutRedirect() {
  const { address } = useAppKitAccount();
  const router = useRouter();
  const prevAddress = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (prevAddress.current && !address) {
      router.replace("/");
    }
    prevAddress.current = address;
  }, [address]);

  return null;
}

"use client";

import { useAccount } from "wagmi";
import { formatUnits } from "viem";
import { Hooks } from "tempo.ts/wagmi";
import { publicConfig } from "@/lib/config";

export function useAcmeBalance() {
  const { address, isConnected } = useAccount();

  const { data: balance, isLoading, refetch } = Hooks.token.useGetBalance({
    account: address,
    token: publicConfig.acmeUsdAddress,
    query: {
      enabled: isConnected && !!address && !!publicConfig.acmeUsdAddress,
      refetchInterval: 2000,
    },
  });

  // Transform the raw balance to our expected format
  const data = balance !== undefined ? {
    address,
    balance: formatUnits(balance, 6), // AcmeUSD has 6 decimals
    symbol: "AUSD" as const,
  } : undefined;

  return {
    data,
    isLoading,
    refetch,
  };
}

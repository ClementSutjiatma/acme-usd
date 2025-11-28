"use client";

import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { publicConfig } from "@/lib/config";

// balanceOf(address) function selector
const BALANCE_OF_SELECTOR = "0x70a08231";

export function useAcmeBalance() {
  const { address, isConnected } = useAccount();

  // Direct RPC call (tempo.ts hooks don't work with authenticated RPC)
  const { data: balance, isLoading, refetch } = useQuery({
    queryKey: ["acmeBalance", address, publicConfig.acmeUsdAddress],
    queryFn: async () => {
      if (!address || !publicConfig.acmeUsdAddress) return undefined;

      const paddedAddress = address.slice(2).toLowerCase().padStart(64, "0");
      const callData = BALANCE_OF_SELECTOR + paddedAddress;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (publicConfig.tempoRpcAuth) {
        headers["Authorization"] = `Basic ${publicConfig.tempoRpcAuth}`;
      }

      const response = await fetch(publicConfig.tempoRpcBaseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_call",
          params: [{ to: publicConfig.acmeUsdAddress, data: callData }, "latest"],
          id: 1,
        }),
      });

      const result = await response.json();
      if (result.error) throw new Error(result.error.message);

      return BigInt(result.result);
    },
    enabled: isConnected && !!address && !!publicConfig.acmeUsdAddress,
    refetchInterval: 5000,
  });

  const data = balance !== undefined ? {
    address,
    balance: formatUnits(balance, 6),
    symbol: "AUSD" as const,
  } : undefined;

  return { data, isLoading, refetch };
}

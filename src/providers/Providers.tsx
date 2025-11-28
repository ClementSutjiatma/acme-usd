"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { useState, type ReactNode } from "react";
import { tempo } from "tempo.ts/chains";
import { webAuthn, KeyManager } from "tempo.ts/wagmi";
import { withFeePayer } from "tempo.ts/viem";

// Tempo testnet configuration with AlphaUSD as fee token
const ALPHA_USD = "0x20c0000000000000000000000000000000000001" as const;
const tempoChain = tempo({ feeToken: ALPHA_USD });

// RPC configuration
const TEMPO_RPC_BASE_URL = "https://rpc.testnet.tempo.xyz";

// WebAuthn accounts ALWAYS use AA transaction format with fee payer fields
// Using 'sign-and-broadcast': fee payer co-signs AND broadcasts the transaction
// This avoids the client needing to broadcast (which was causing signature issues)
const authenticatedHttp = withFeePayer(
  http(TEMPO_RPC_BASE_URL, {
    fetchOptions: {
      headers: {
        Authorization: `Basic ${btoa("dreamy-northcutt:recursing-payne")}`,
      },
    },
  }),
  http("/api/sponsor"),
  { policy: "sign-and-broadcast" }
);

// Use the standard localStorage KeyManager
// Note: If you had a passkey registered with an older tempo.ts version,
// you may need to register a new passkey after clearing localStorage
const keyManager = KeyManager.localStorage();

// Create wagmi config with webAuthn connector for passkey wallets
// Uses localStorage KeyManager for development.
const config = createConfig({
  chains: [tempoChain],
  connectors: [
    webAuthn({
      keyManager,
    }),
  ],
  multiInjectedProviderDiscovery: false, // Prefer webAuthn connector over injected wallets
  transports: {
    [tempoChain.id]: authenticatedHttp,
  },
  ssr: true,
});

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Disable global staleTime so data is always fresh by default
            staleTime: 0,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

// Export config for use in hooks
export { config as wagmiConfig };

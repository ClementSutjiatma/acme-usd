"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { useState, type ReactNode } from "react";
import { tempo } from "tempo.ts/chains";
import { webAuthn, KeyManager } from "tempo.ts/wagmi";
import { withFeePayer } from "tempo.ts/viem";
import { publicConfig } from "@/lib/config";

// Tempo testnet configuration with AlphaUSD as fee token
const tempoChain = tempo({ feeToken: publicConfig.alphaUsdAddress });

// Build auth header if credentials are configured
const authHeader = publicConfig.tempoRpcAuth 
  ? `Basic ${publicConfig.tempoRpcAuth}` 
  : undefined;

// Authenticated HTTP transport
const authenticatedHttp = http(publicConfig.tempoRpcBaseUrl, {
  fetchOptions: authHeader ? {
    headers: {
      Authorization: authHeader,
    },
  } : undefined,
});

// Transport with fee payer for gas sponsorship
const transport = withFeePayer(
  authenticatedHttp,
  http("/api/sponsor"),
  { policy: "sign-and-broadcast" }
);

// KeyManager for passkey storage
const keyManager = KeyManager.localStorage();

// Wagmi config
const config = createConfig({
  chains: [tempoChain],
  connectors: [
    webAuthn({
      keyManager,
    }),
  ],
  transports: {
    [tempoChain.id]: transport,
  },
  ssr: true,
});

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
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

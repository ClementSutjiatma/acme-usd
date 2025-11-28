"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { createSupabaseBrowserClient, type OfframpRecord } from "@/lib/supabase";

interface OfframpStatusResponse {
  requestId: string;
  memo: string;
  userAddress: string;
  amountUsd: number;
  status: "pending" | "transferred" | "burning" | "burned" | "paying" | "paid_out" | "failed";
  transferTxHash: string | null;
  burnTxHash: string | null;
  payoutId: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export function useOfframpStatus(requestId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!requestId) return;

    const supabase = createSupabaseBrowserClient();
    
    const channel = supabase
      .channel(`offramp:${requestId}`)
      .on<OfframpRecord>(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "offramps",
          filter: `id=eq.${requestId}`,
        },
        (payload) => {
          console.log("[Realtime] Offramp update received:", payload);
          
          // Transform to API response format
          const newStatus = payload.new;
          const newData: OfframpStatusResponse = {
            requestId: newStatus.id,
            memo: newStatus.memo,
            userAddress: newStatus.user_address,
            amountUsd: newStatus.amount_usd / 100,
            status: newStatus.status,
            transferTxHash: newStatus.transfer_tx_hash,
            burnTxHash: newStatus.burn_tx_hash,
            payoutId: newStatus.stripe_payout_id,
            errorMessage: newStatus.error_message,
            createdAt: newStatus.created_at,
          };

          // Update query cache immediately
          queryClient.setQueryData(
            ["offrampStatus", requestId],
            newData
          );
        }
      )
      .subscribe((status) => {
        console.log(`[Realtime] Offramp subscription status for ${requestId}:`, status);
      });

    return () => {
      console.log(`[Realtime] Unsubscribing from offramp ${requestId}`);
      supabase.removeChannel(channel);
    };
  }, [requestId, queryClient]);

  return useQuery<OfframpStatusResponse>({
    queryKey: ["offrampStatus", requestId],
    queryFn: async () => {
      if (!requestId) throw new Error("No request ID");
      
      const response = await fetch(`/api/offramp/status/${requestId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch status");
      }
      return response.json();
    },
    enabled: !!requestId,
    // Use polling as fallback in case realtime doesn't work
    refetchInterval: (query) => {
      const data = query.state.data;
      // Stop polling once paid out or failed
      if (data?.status === "paid_out" || data?.status === "failed") {
        return false;
      }
      return 5000; // Poll every 5 seconds as fallback
    },
  });
}


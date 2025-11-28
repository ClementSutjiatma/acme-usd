"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { createSupabaseBrowserClient, type OnrampRecord } from "@/lib/supabase";

interface OnrampStatusResponse {
  id: string;
  paymentIntentId: string;
  userAddress: string;
  amountUsd: number;
  status: "pending" | "paid" | "minting" | "minted" | "failed";
  mintTxHash: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export function useOnrampStatus(paymentIntentId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!paymentIntentId) return;

    const supabase = createSupabaseBrowserClient();
    
    const channel = supabase
      .channel(`onramp:${paymentIntentId}`)
      .on<OnrampRecord>(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "onramps",
          filter: `payment_intent_id=eq.${paymentIntentId}`,
        },
        (payload) => {
          console.log("[Realtime] Received update:", payload);
          
          // Transform to API response format
          const newStatus = payload.new;
          const newData: OnrampStatusResponse = {
            id: newStatus.id,
            paymentIntentId: newStatus.payment_intent_id,
            userAddress: newStatus.user_address,
            amountUsd: newStatus.amount_usd / 100,
            status: newStatus.status,
            mintTxHash: newStatus.mint_tx_hash,
            errorMessage: newStatus.error_message,
            createdAt: newStatus.created_at,
          };

          // Update query cache immediately
          queryClient.setQueryData(
            ["onrampStatus", paymentIntentId],
            newData
          );
        }
      )
      .subscribe((status) => {
        console.log(`[Realtime] Subscription status for ${paymentIntentId}:`, status);
      });

    return () => {
      console.log(`[Realtime] Unsubscribing from ${paymentIntentId}`);
      supabase.removeChannel(channel);
    };
  }, [paymentIntentId, queryClient]);

  return useQuery<OnrampStatusResponse>({
    queryKey: ["onrampStatus", paymentIntentId],
    queryFn: async () => {
      if (!paymentIntentId) throw new Error("No payment intent ID");
      
      const response = await fetch(`/api/onramp/status/${paymentIntentId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch status");
      }
      return response.json();
    },
    enabled: !!paymentIntentId,
    // Disable polling since we use realtime
    refetchInterval: false, 
    refetchOnWindowFocus: false,
  });
}

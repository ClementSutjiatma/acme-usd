"use client";

import { useQuery } from "@tanstack/react-query";

export interface Transaction {
  id: string;
  type: "buy" | "withdraw";
  amount: number;
  status: "completed" | "pending" | "failed";
  txHash?: string;
  timestamp: string;
  // Audit fields for on-chain verification
  mintTxHash?: string;        // For buy: the mint transaction
  burnTxHash?: string;        // For withdraw: the burn transaction
  transferTxHash?: string;    // For withdraw: user's transfer to treasury
  paymentReference?: string;  // payment_intent_id (buy) or payout_id (withdraw)
  memoHash?: string;          // The on-chain memo (keccak256 of paymentReference)
  transferMemo?: string;      // For withdraw: the memo from user's transfer
}

interface TransactionsResponse {
  transactions: Transaction[];
}

export function useTransactions(address: string | undefined) {
  return useQuery<TransactionsResponse>({
    queryKey: ["transactions", address],
    queryFn: async () => {
      if (!address) throw new Error("No address");
      
      const response = await fetch(`/api/transactions/${address}`);
      if (!response.ok) {
        throw new Error("Failed to fetch transactions");
      }
      return response.json();
    },
    enabled: !!address,
    refetchInterval: 10000, // Refetch every 10 seconds
    staleTime: 5000, // Consider data stale after 5 seconds
  });
}


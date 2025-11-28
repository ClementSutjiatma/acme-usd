"use client";

import { useQuery } from "@tanstack/react-query";

interface Transaction {
  id: string;
  type: "buy" | "withdraw";
  amount: number;
  status: "completed" | "pending" | "failed";
  txHash?: string;
  timestamp: string;
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


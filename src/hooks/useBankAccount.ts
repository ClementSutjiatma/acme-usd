"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface BankAccountDetails {
  bankName: string;
  last4: string;
  accountType: string;
}

interface BankAccountStatusResponse {
  hasBankAccount: boolean;
  bankAccount: BankAccountDetails | null;
}

export function useBankAccount(walletAddress: string | undefined) {
  return useQuery<BankAccountStatusResponse>({
    queryKey: ["bankAccount", walletAddress],
    queryFn: async () => {
      if (!walletAddress) throw new Error("No wallet address");
      
      const response = await fetch(`/api/bank/status?address=${walletAddress}`);
      if (!response.ok) {
        throw new Error("Failed to fetch bank account status");
      }
      return response.json();
    },
    enabled: !!walletAddress,
  });
}

interface CreateSessionResponse {
  clientSecret: string;
  sessionId: string;
}

export function useCreateBankSession() {
  return useMutation<CreateSessionResponse, Error, string>({
    mutationFn: async (walletAddress: string) => {
      const response = await fetch("/api/bank/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create session");
      }
      
      return response.json();
    },
  });
}

interface SaveBankAccountResponse {
  success: boolean;
  paymentMethodId: string;
  bankDetails: BankAccountDetails | null;
}

export function useSaveBankAccount() {
  const queryClient = useQueryClient();
  
  return useMutation<SaveBankAccountResponse, Error, { walletAddress: string; accountId: string }>({
    mutationFn: async ({ walletAddress, accountId }) => {
      const response = await fetch("/api/bank/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, accountId }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save bank account");
      }
      
      return response.json();
    },
    onSuccess: (_, variables) => {
      // Invalidate the bank account query to refresh the UI
      queryClient.invalidateQueries({ queryKey: ["bankAccount", variables.walletAddress] });
    },
  });
}


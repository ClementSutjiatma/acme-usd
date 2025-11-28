"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAccount, useConnect, useConnectors } from "wagmi";
import { parseUnits } from "viem";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import { Hooks } from "tempo.ts/wagmi";
import { useAcmeBalance } from "@/hooks/useAcmeBalance";
import { useOnrampStatus } from "@/hooks/useOnrampStatus";
import { useOfframpStatus } from "@/hooks/useOfframpStatus";
import { useTransactions } from "@/hooks/useTransactions";
import { useBankAccount, useCreateBankSession, useSaveBankAccount } from "@/hooks/useBankAccount";
import { PaymentForm } from "@/components/PaymentForm";
import { OnrampProgress, OfframpProgress } from "@/components/TransactionProgress";
import { publicConfig } from "@/lib/config";

// Initialize Stripe
const stripePromise = publicConfig.stripePublicKey
  ? loadStripe(publicConfig.stripePublicKey)
  : null;

type ActiveFlow = null | "buy" | "withdraw";
type BuyStep = "payment" | "processing" | "success";
type WithdrawStep = "confirm" | "signing" | "processing" | "success";

interface OfframpData {
  requestId: string;
  memo: string;
  treasuryAddress: string;
  amountUsd: number;
}

export function Dashboard() {
  const { address, isConnected } = useAccount();
  const { connect, isPending: isConnecting, error: connectError } = useConnect();
  const [connector] = useConnectors();
  const transfer = Hooks.token.useTransferSync();
  const { data: balanceData, isLoading: isBalanceLoading, refetch: refetchBalance } = useAcmeBalance();
  const { data: transactionsData, refetch: refetchTransactions } = useTransactions(address);
  
  const [amount, setAmount] = useState("");
  const [activeFlow, setActiveFlow] = useState<ActiveFlow>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<"buy" | "withdraw">("buy");
  
  // Buy flow state
  const [buyStep, setBuyStep] = useState<BuyStep>("payment");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  
  // Withdraw flow state
  const [withdrawStep, setWithdrawStep] = useState<WithdrawStep>("confirm");
  const [offrampId, setOfframpId] = useState<string | null>(null);
  const [offrampData, setOfframpData] = useState<OfframpData | null>(null);
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  // Poll for statuses
  const { data: buyStatus } = useOnrampStatus(paymentIntentId);
  const { data: withdrawStatus } = useOfframpStatus(offrampId);
  
  // Bank account for withdrawals
  const { data: bankData, isLoading: isBankLoading } = useBankAccount(address);
  const createBankSession = useCreateBankSession();
  const saveBankAccount = useSaveBankAccount();
  const [isLinkingBank, setIsLinkingBank] = useState(false);
  
  const transactions = transactionsData?.transactions || [];

  // Watch for buy completion
  useEffect(() => {
    if (buyStatus?.status === "minted") {
      setBuyStep("success");
      // Force refetch balance
      refetchBalance();
    }
  }, [buyStatus, refetchBalance]);

  // Watch for withdraw completion
  useEffect(() => {
    if (withdrawStatus?.status === "paid_out") {
      setWithdrawStep("success");
    }
  }, [withdrawStatus]);

  // Trigger offramp processing when entering processing state
  useEffect(() => {
    if (withdrawStep !== "processing" || !offrampId || !offrampData) return;
    
    // Get the txHash from offrampData (set during handleConfirmWithdraw)
    const txHash = (offrampData as OfframpData & { txHash?: string }).txHash;
    
    console.log(`[Dashboard] Triggering offramp processing for ${offrampId} with txHash ${txHash}`);
    fetch(`/api/offramp/process/${offrampId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txHash }),
    })
      .then((res) => res.json())
      .then((data) => console.log("[Dashboard] Process result:", data))
      .catch((err) => console.error("[Dashboard] Process failed:", err));
  }, [withdrawStep, offrampId, offrampData]);

  const amountNum = parseFloat(amount) || 0;
  const maxBalance = parseFloat(balanceData?.balance || "0");

  // Sign up - creates a new passkey account
  const handleSignUp = () => {
    if (connector) {
      connect({
        connector,
        // @ts-expect-error - capabilities is supported by tempo.ts webAuthn connector
        capabilities: { createAccount: true },
      });
    }
  };

  // Sign in - uses existing passkey
  const handleSignIn = () => {
    if (connector) {
      connect({ connector });
    }
  };

  const handleBuy = async () => {
    if (amountNum < 0.01) {
      setError("Minimum amount is $0.01");
      return;
    }
    
    setError(null);
    setActiveFlow("buy");
    setBuyStep("payment");
    
    try {
      const response = await fetch("/api/onramp/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userAddress: address,
          amountUsd: amountNum,
        }),
      });

      if (!response.ok) throw new Error("Failed to create payment");
      
      const data = await response.json();
      setClientSecret(data.clientSecret);
      setPaymentIntentId(data.paymentIntentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setActiveFlow(null);
    }
  };

  const handleWithdraw = async () => {
    if (amountNum < 0.01) {
      setError("Minimum amount is $0.01");
      return;
    }
    if (amountNum > maxBalance) {
      setError("Insufficient balance");
      return;
    }
    
    setError(null);
    setActiveFlow("withdraw");
    setWithdrawStep("confirm");
    // Don't create offramp record yet - wait for user to confirm
  };

  const handleLinkBank = async () => {
    if (!address) return;
    
    setIsLinkingBank(true);
    setError(null);

    try {
      // Create a Financial Connections session
      const { clientSecret } = await createBankSession.mutateAsync(address);

      // Get Stripe instance
      const stripe = await stripePromise;
      if (!stripe) throw new Error("Stripe not loaded");

      // Open the Financial Connections modal
      const result = await stripe.collectFinancialConnectionsAccounts({
        clientSecret,
      });

      if (result.error) {
        throw new Error(result.error.message);
      }

      // Get the first linked account
      const linkedAccount = result.financialConnectionsSession?.accounts?.[0];
      if (!linkedAccount) {
        throw new Error("No account was linked");
      }

      // Save the linked account
      await saveBankAccount.mutateAsync({
        walletAddress: address,
        accountId: linkedAccount.id,
      });
    } catch (err) {
      console.error("Bank linking failed:", err);
      setError(err instanceof Error ? err.message : "Failed to link bank account");
    } finally {
      setIsLinkingBank(false);
    }
  };

  const handlePaymentSuccess = () => {
    setBuyStep("processing");
  };

  const handleConfirmWithdraw = async () => {
    if (!publicConfig.acmeUsdAddress) {
      setError("System configuration error: Missing AcmeUSD address");
      return;
    }

    setIsWithdrawing(true);
    setError(null);

    try {
      // Step 1: Create the offramp record (generates memo)
      const response = await fetch("/api/offramp/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userAddress: address,
          amountUsd: amountNum,
        }),
      });

      if (!response.ok) throw new Error("Failed to create withdrawal request");
      
      const data = await response.json();
      setOfframpData(data);
      setOfframpId(data.requestId);

      // Step 2: Show signing UI
      setWithdrawStep("signing");

      // Step 3: Execute the real transaction with passkey signing
      // Uses tempo.ts Hooks.token.useTransferSync() for proper sponsored transaction format
      console.log(`[Dashboard] Initiating transfer:`, {
        tokenAddress: publicConfig.acmeUsdAddress,
        treasuryAddress: data.treasuryAddress,
        amount: amountNum,
        amountRaw: parseUnits(amountNum.toString(), 6).toString(),
        memo: data.memo,
        feeToken: publicConfig.alphaUsdAddress,
      });
      
      const result = await transfer.mutateAsync({
        amount: parseUnits(amountNum.toString(), 6), // 6 decimals for AcmeUSD
        to: data.treasuryAddress as `0x${string}`,
        token: publicConfig.acmeUsdAddress!,         // AcmeUSD (user's tokens)
        memo: data.memo as `0x${string}`,
        feePayer: true,                              // Route to /api/sponsor relay
        feeToken: publicConfig.alphaUsdAddress,      // Fees paid in AlphaUSD
      });

      const txHash = result.receipt.transactionHash;
      console.log(`[Dashboard] Transfer tx confirmed: ${txHash}`);
      
      // Store txHash in offrampData for the process endpoint
      setOfframpData({ ...data, txHash });

      // Step 4: Move to processing state after successful signing
      setWithdrawStep("processing");
    } catch (err) {
      console.error("Withdraw failed:", err);
      setError(err instanceof Error ? err.message : "Withdrawal failed");
      setWithdrawStep("confirm");
    } finally {
      setIsWithdrawing(false);
    }
  };

  const resetFlow = () => {
    setActiveFlow(null);
    setAmount("");
    setClientSecret(null);
    setPaymentIntentId(null);
    setOfframpId(null);
    setOfframpData(null);
    setBuyStep("payment");
    setWithdrawStep("confirm");
    setError(null);
    setIsWithdrawing(false);
    // Refetch data after transaction completes
    refetchBalance();
    refetchTransactions();
  };

  // Not connected - show sign up / sign in prompt
  if (!isConnected) {
    // Loading state while connecting
    if (isConnecting) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-5rem)] px-4">
          <div className="absolute inset-0 bg-white -z-10" />
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md"
          >
            <div className="bg-white rounded-3xl p-8 border border-dark-200 shadow-xl text-center">
              <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-gold-500 to-gold-600 flex items-center justify-center">
                <div className="w-8 h-8 border-3 border-black border-t-transparent rounded-full animate-spin" />
              </div>
              <h2 className="text-xl font-semibold text-black mb-2">
                Check your device
              </h2>
              <p className="text-dark-500">
                Complete the passkey prompt to continue
              </p>
            </div>
          </motion.div>
        </div>
      );
    }

    // Error state
    if (connectError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-5rem)] px-4">
          <div className="absolute inset-0 bg-white -z-10" />
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md"
          >
            <div className="bg-white rounded-3xl p-8 border border-dark-200 shadow-xl text-center">
              <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-red-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-black mb-2">
                Connection Failed
              </h2>
              <p className="text-dark-500 mb-6 text-sm">
                {connectError.message || "Something went wrong. Please try again."}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleSignUp}
                  className="py-4 rounded-2xl bg-gradient-to-r from-gold-500 to-gold-600 text-black font-semibold shadow-lg shadow-gold-500/25"
                >
                  Sign up
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleSignIn}
                  className="py-4 rounded-2xl bg-black text-white font-semibold hover:bg-dark-800"
                >
                  Sign in
                </motion.button>
              </div>
            </div>
          </motion.div>
        </div>
      );
    }

    // Default state - show sign up / sign in buttons
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-5rem)] px-4">
        <div className="absolute inset-0 bg-white -z-10" />
        
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <div className="bg-white rounded-3xl p-8 border border-dark-200 shadow-xl text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-gold-500 to-gold-600 flex items-center justify-center">
              <span className="text-2xl font-bold text-black">A</span>
            </div>
            <h2 className="text-xl font-semibold text-black mb-2">
              Welcome to AcmeUSD
            </h2>
            <p className="text-dark-500 mb-6">
              Buy and sell AUSD seamlessly and securely
            </p>
            <div className="grid grid-cols-2 gap-3">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleSignUp}
                className="py-4 rounded-2xl bg-gradient-to-r from-gold-500 to-gold-600 text-black font-semibold shadow-lg shadow-gold-500/25"
              >
                Sign up
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleSignIn}
                className="py-4 rounded-2xl bg-black text-white font-semibold hover:bg-dark-800"
              >
                Sign in
              </motion.button>
            </div>
        
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center min-h-[calc(100vh-5rem)] px-4 py-8">
      <div className="absolute inset-0 bg-white -z-10" />
      
      <div className="w-full max-w-md space-y-6">
        {/* Balance Display */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <p className="text-sm text-dark-500 mb-1">Your Balance</p>
          <p className="text-4xl font-bold text-black">
            {isBalanceLoading ? (
              <span className="inline-block w-6 h-6 border-2 border-gold-500 border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                {parseFloat(balanceData?.balance || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                <span className="text-lg text-dark-400 font-medium ml-2">AUSD</span>
              </>
            )}
          </p>
        </motion.div>

        {/* Tab Switcher */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="flex bg-dark-100 rounded-2xl p-1"
        >
          <button
            onClick={() => {
              setSelectedTab("buy");
              setAmount("");
              setError(null);
            }}
            disabled={activeFlow !== null}
            className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all ${
              selectedTab === "buy"
                ? "bg-white text-black shadow-sm"
                : "text-dark-500 hover:text-dark-700"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            Buy
          </button>
          <button
            onClick={() => {
              setSelectedTab("withdraw");
              setAmount("");
              setError(null);
            }}
            disabled={activeFlow !== null}
            className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all ${
              selectedTab === "withdraw"
                ? "bg-white text-black shadow-sm"
                : "text-dark-500 hover:text-dark-700"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            Withdraw
          </button>
        </motion.div>

        {/* Amount Input Card */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-3xl p-6 border border-dark-200 shadow-lg"
        >
          {/* Input */}
          <div className="mb-6">
            <div className="relative">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                min="0.01"
                step="0.01"
                disabled={activeFlow !== null}
                className="w-full py-4 text-3xl font-semibold bg-dark-50 rounded-2xl border border-dark-200 text-black placeholder:text-dark-400 focus:outline-none focus:border-gold-500 disabled:opacity-50 pl-4 pr-20 text-right"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-dark-400">
                {selectedTab === "buy" ? "USD" : "AUSD"}
              </span>
            </div>
          </div>

          {/* Quick amounts */}
          <div className="grid grid-cols-4 gap-2 mb-6">
            {selectedTab === "buy" ? (
              [10, 50, 100, 500].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAmount(preset.toString())}
                  disabled={activeFlow !== null}
                  className="py-2 rounded-xl bg-dark-50 border border-dark-200 text-dark-600 text-sm font-medium hover:border-gold-500 hover:text-gold-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {preset}
                </button>
              ))
            ) : (
              [10, 50, 100, "MAX"].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAmount(preset === "MAX" ? maxBalance.toString() : preset.toString())}
                  disabled={activeFlow !== null}
                  className="py-2 rounded-xl bg-dark-50 border border-dark-200 text-dark-600 text-sm font-medium hover:border-gold-500 hover:text-gold-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {preset === "MAX" ? "MAX" : preset}
                </button>
              ))
            )}
          </div>

          {/* Error */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200"
            >
              <p className="text-sm text-red-600">{error}</p>
            </motion.div>
          )}

          {/* Action Button */}
          {activeFlow === null && (
            selectedTab === "buy" ? (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleBuy}
                disabled={!amount || amountNum <= 0}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-gold-500 to-gold-600 text-black font-semibold shadow-lg shadow-gold-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Buy AUSD
              </motion.button>
            ) : (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleWithdraw}
                disabled={!amount || amountNum <= 0 || amountNum > maxBalance}
                className="w-full py-4 rounded-2xl bg-black text-white font-semibold hover:bg-dark-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Withdraw
              </motion.button>
            )
          )}
        </motion.div>

        {/* Active Flow */}
        <AnimatePresence mode="wait">
          {/* BUY FLOW */}
          {activeFlow === "buy" && (
            <motion.div
              key="buy-flow"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-white rounded-3xl p-6 border border-dark-200 shadow-lg"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-black">
                  Buy ${amountNum.toFixed(2)} AUSD
                </h3>
                {buyStep !== "success" && (
                  <button
                    onClick={resetFlow}
                    className="text-sm text-dark-500 hover:text-black transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>

              {buyStep === "payment" && clientSecret && stripePromise && (
                <Elements
                  stripe={stripePromise}
                  options={{
                    clientSecret,
                    appearance: {
                      theme: "stripe",
                      variables: {
                        colorPrimary: "#ca8a04",
                        colorBackground: "#ffffff",
                        colorText: "#0a0a0a",
                        colorDanger: "#dc2626",
                        borderRadius: "12px",
                        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
                      },
                    },
                  }}
                >
                  <PaymentForm
                    amount={amountNum}
                    onSuccess={handlePaymentSuccess}
                    onError={setError}
                  />
                </Elements>
              )}

              {buyStep === "processing" && (
                <div className="py-6">
                  <OnrampProgress status={buyStatus?.status || "pending"} />
                  <p className="text-center text-sm text-dark-500 mt-4">
                    {buyStatus?.status === "minting" 
                      ? "Minting your AUSD tokens..." 
                      : buyStatus?.status === "paid"
                      ? "Payment confirmed, preparing to mint..."
                      : "Confirming your payment..."}
                  </p>
                </div>
              )}

              {buyStep === "success" && (
                <div className="text-center py-8">
                  <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-gold-100 flex items-center justify-center">
                    <svg className="w-6 h-6 text-gold-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="text-black font-medium mb-1">Purchase Complete!</p>
                  <p className="text-sm text-dark-500 mb-4">
                    ${amountNum.toFixed(2)} AUSD added to your wallet
                  </p>
                  {buyStatus?.mintTxHash && (
                    <a
                      href={`${publicConfig.explorerUrl}/tx/${buyStatus.mintTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-gold-600 hover:underline"
                    >
                      View transaction →
                    </a>
                  )}
                  <button
                    onClick={resetFlow}
                    className="mt-4 w-full py-3 rounded-xl bg-black text-white font-medium"
                  >
                    Done
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {/* WITHDRAW FLOW */}
          {activeFlow === "withdraw" && (
            <motion.div
              key="withdraw-flow"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-white rounded-3xl p-6 border border-dark-200 shadow-lg"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-black">
                  Withdraw ${amountNum.toFixed(2)} AUSD
                </h3>
                {withdrawStep !== "success" && (
                  <button
                    onClick={resetFlow}
                    className="text-sm text-dark-500 hover:text-black transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>

              {withdrawStep === "confirm" && (
                <div>
                  <div className="space-y-3 mb-6 text-sm">
                    <div className="flex justify-between py-2 border-b border-dark-100">
                      <span className="text-dark-500">Amount</span>
                      <span className="text-black font-medium">${amountNum.toFixed(2)} AUSD</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-dark-100">
                      <span className="text-dark-500">Network Fee</span>
                      <span className="text-gold-600">Free (Sponsored)</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-dark-100">
                      <span className="text-dark-500">Payout to</span>
                      {isBankLoading ? (
                        <span className="text-dark-400">Loading...</span>
                      ) : bankData?.hasBankAccount && bankData.bankAccount ? (
                        <span className="text-black font-medium flex items-center gap-2">
                          <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                          </svg>
                          {bankData.bankAccount.bankName} ••••{bankData.bankAccount.last4}
                        </span>
                      ) : (
                        <span className="text-dark-400">No bank account</span>
                      )}
                    </div>
                    <div className="flex justify-between py-2">
                      <span className="text-dark-500">You will receive</span>
                      <span className="text-black font-semibold">${amountNum.toFixed(2)} USD</span>
                    </div>
                  </div>
                  
                  {/* Estimated arrival time */}
                  <div className="mb-4 p-3 rounded-xl bg-blue-50 border border-blue-100">
                    <div className="flex items-center gap-2 text-blue-600 mb-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-sm font-medium">Estimated arrival: 1-3 business days</span>
                    </div>
                    <p className="text-xs text-dark-500">
                      Standard ACH transfer. Weekends and holidays may extend this.
                    </p>
                  </div>
                  
                  {/* Prompt to link bank account if none linked */}
                  {!isBankLoading && !bankData?.hasBankAccount && (
                    <div className="mb-4 p-4 rounded-xl bg-blue-50 border border-blue-200">
                      <p className="text-sm text-blue-700 mb-3">
                        Link your bank account to receive withdrawals.
                      </p>
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={handleLinkBank}
                        disabled={isLinkingBank}
                        className="w-full py-3 rounded-xl bg-blue-500 text-white font-medium hover:bg-blue-600 disabled:opacity-50"
                      >
                        {isLinkingBank ? (
                          <span className="flex items-center justify-center gap-2">
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            Connecting...
                          </span>
                        ) : (
                          "Link Bank Account"
                        )}
                      </motion.button>
                    </div>
                  )}
                  
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleConfirmWithdraw}
                    disabled={isWithdrawing || isBankLoading || !bankData?.hasBankAccount}
                    className="w-full py-4 rounded-2xl bg-gradient-to-r from-gold-500 to-gold-600 text-black font-semibold shadow-lg shadow-gold-500/25 disabled:opacity-50"
                  >
                    {isWithdrawing ? "Processing..." : "Confirm & Sign"}
                  </motion.button>
                </div>
              )}

              {withdrawStep === "signing" && (
                <div className="text-center py-8">
                  <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-gold-100 flex items-center justify-center">
                    <svg className="w-6 h-6 text-gold-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                    </svg>
                  </div>
                  <p className="text-black font-medium mb-1">Sign with Passkey</p>
                  <p className="text-sm text-dark-500">Use your fingerprint or face</p>
                </div>
              )}

              {withdrawStep === "processing" && (
                <div className="py-6">
                  <OfframpProgress status={withdrawStatus?.status || "pending"} />
                  <p className="text-center text-sm text-dark-500 mt-4">
                    {withdrawStatus?.status === "paying" || withdrawStatus?.status === "burned"
                      ? "Initiating bank transfer..."
                      : withdrawStatus?.status === "burning" || withdrawStatus?.status === "transferred"
                      ? "Processing your withdrawal..."
                      : "Submitting transaction..."}
                  </p>
                </div>
              )}

              {withdrawStep === "success" && (
                <div className="text-center py-8">
                  <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-gold-100 flex items-center justify-center">
                    <svg className="w-6 h-6 text-gold-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="text-black font-medium mb-1">Withdrawal Complete!</p>
                  <p className="text-sm text-dark-500 mb-4">
                    ${amountNum.toFixed(2)} USD sent to your bank
                  </p>
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-left mb-4">
                    <p className="text-xs text-blue-600 font-medium mb-1">What happens next?</p>
                    <p className="text-xs text-dark-500">
                      Your bank transfer has been initiated. Funds typically arrive in <span className="text-blue-600 font-medium">1-3 business days</span> via ACH.
                    </p>
                  </div>
                  {withdrawStatus?.burnTxHash && (
                    <a
                      href={`${publicConfig.explorerUrl}/tx/${withdrawStatus.burnTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-gold-600 hover:underline"
                    >
                      View transaction →
                    </a>
                  )}
                  <button
                    onClick={resetFlow}
                    className="mt-4 w-full py-3 rounded-xl bg-black text-white font-medium"
                  >
                    Done
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Transaction History */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-dark-50 rounded-3xl p-6 border border-dark-200"
        >
          <h3 className="text-sm font-medium text-dark-500 mb-4">Recent Transactions</h3>
          
          {transactions.length === 0 ? (
            <p className="text-center text-dark-400 py-8 text-sm">
              No transactions yet
            </p>
          ) : (
            <div className="space-y-3">
              {transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between py-3 border-b border-dark-200 last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      tx.type === "buy" ? "bg-gold-100" : "bg-dark-200"
                    }`}>
                      {tx.type === "buy" ? (
                        <svg className="w-4 h-4 text-gold-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-dark-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                        </svg>
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-black capitalize">{tx.type}</p>
                      <p className="text-xs text-dark-500">
                        {new Date(tx.timestamp).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-medium ${tx.type === "buy" ? "text-gold-600" : "text-black"}`}>
                      {tx.type === "buy" ? "+" : "-"}${tx.amount.toFixed(2)}
                    </p>
                    <p className="text-xs text-dark-500 capitalize">{tx.status}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}

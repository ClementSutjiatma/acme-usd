"use client";

import { motion } from "framer-motion";

interface Step {
  id: string;
  label: string;
}

interface TransactionProgressProps {
  steps: Step[];
  currentStepIndex: number;
  failed?: boolean;
  failedMessage?: string;
}

export function TransactionProgress({ 
  steps, 
  currentStepIndex, 
  failed = false,
  failedMessage = "Processing failed. Please contact support."
}: TransactionProgressProps) {
  return (
    <div className="w-full space-y-6">
      <div className="relative flex justify-between">
        {/* Progress Bar Background */}
        <div className="absolute top-5 left-0 w-full h-1 bg-dark-200 rounded-full -z-10" />
        
        {/* Active Progress Bar */}
        <motion.div 
          className="absolute top-5 left-0 h-1 bg-gold-500 rounded-full -z-10"
          initial={{ width: "0%" }}
          animate={{ width: `${(currentStepIndex / (steps.length - 1)) * 100}%` }}
          transition={{ duration: 0.5 }}
        />

        {steps.map((step, index) => {
          const isCompleted = index < currentStepIndex;
          const isCurrent = index === currentStepIndex;
          const isActive = isCompleted || isCurrent;

          return (
            <div key={step.id} className="flex flex-col items-center gap-2">
              <motion.div
                initial={false}
                animate={{
                  scale: isCurrent ? 1.1 : 1,
                }}
                className={`w-10 h-10 rounded-full border-3 flex items-center justify-center z-0 transition-colors ${
                  failed && isCurrent
                    ? "bg-red-100 border-red-400"
                    : isCompleted 
                    ? "bg-gold-500 border-gold-500" 
                    : isCurrent 
                    ? "bg-gold-100 border-gold-500" 
                    : "bg-dark-100 border-dark-200"
                }`}
              >
                {isCompleted ? (
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : failed && isCurrent ? (
                  <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : isCurrent ? (
                  <div className="w-4 h-4 border-2 border-gold-600 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <div className={`w-3 h-3 rounded-full ${isActive ? "bg-gold-500" : "bg-dark-300"}`} />
                )}
              </motion.div>
              
              <span className={`text-xs font-medium text-center max-w-[80px] ${
                failed && isCurrent
                  ? "text-red-500"
                  : isActive 
                  ? "text-black" 
                  : "text-dark-400"
              }`}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {failed && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 rounded-xl bg-red-50 border border-red-200 text-center"
        >
          <p className="text-sm text-red-600">{failedMessage}</p>
        </motion.div>
      )}
    </div>
  );
}

// Pre-configured for onramp (buy) flow
export function OnrampProgress({ status }: { status: string }) {
  const steps = [
    { id: "payment", label: "Payment" },
    { id: "minting", label: "Minting" },
    { id: "complete", label: "Complete" },
  ];

  const getCurrentStepIndex = () => {
    if (status === "minted") return 2;
    if (status === "minting") return 1;
    if (status === "paid") return 1;
    return 0;
  };

  return (
    <TransactionProgress 
      steps={steps} 
      currentStepIndex={getCurrentStepIndex()} 
      failed={status === "failed"}
    />
  );
}

// Pre-configured for offramp (withdraw) flow
export function OfframpProgress({ status }: { status: string }) {
  const steps = [
    { id: "transfer", label: "Transfer" },
    { id: "burning", label: "Processing" },
    { id: "payout", label: "Bank Payout" },
    { id: "complete", label: "Complete" },
  ];

  const getCurrentStepIndex = () => {
    if (status === "paid_out") return 3;
    if (status === "paying") return 2;
    if (status === "burned") return 2;
    if (status === "burning") return 1;
    if (status === "transferred") return 1;
    return 0; // pending
  };

  return (
    <TransactionProgress 
      steps={steps} 
      currentStepIndex={getCurrentStepIndex()} 
      failed={status === "failed"}
      failedMessage="Withdrawal failed. Please contact support."
    />
  );
}


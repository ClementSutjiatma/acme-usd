"use client";

import { useAccount, useConnect, useConnectors, useDisconnect } from "wagmi";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import { useAcmeBalance } from "@/hooks/useAcmeBalance";
import { publicConfig } from "@/lib/config";

export function Header() {
  const { address, isConnected } = useAccount();
  const { connect, isPending } = useConnect();
  const [connector] = useConnectors();
  const { disconnect } = useDisconnect();
  const { data: balanceData } = useAcmeBalance();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showAuthDropdown, setShowAuthDropdown] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Sign up - creates a new passkey account
  const handleSignUp = () => {
    if (connector) {
      connect({
        connector,
        // @ts-expect-error - capabilities is supported by tempo.ts webAuthn connector
        capabilities: { createAccount: true },
      });
      setShowAuthDropdown(false);
    }
  };

  // Sign in - uses existing passkey
  const handleSignIn = () => {
    if (connector) {
      connect({ connector });
      setShowAuthDropdown(false);
    }
  };

  // Sign out
  const handleSignOut = () => {
    disconnect();
    setShowDropdown(false);
  };

  const truncateAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const explorerUrl = address
    ? `${publicConfig.explorerUrl}/address/${address}`
    : null;

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setShowDropdown(false);
      setShowAuthDropdown(false);
    };
    if (showDropdown || showAuthDropdown) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [showDropdown, showAuthDropdown]);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 px-6 py-4 bg-white/80 backdrop-blur-xl border-b border-dark-200">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-2"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gold-500 to-gold-600 flex items-center justify-center shadow-lg shadow-gold-500/20">
            <span className="text-lg font-bold text-black">A</span>
          </div>
          <span className="text-xl font-semibold tracking-tight text-black">
            Acme<span className="text-gold-600">USD</span>
          </span>
        </motion.div>

        {/* Wallet Button */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="relative"
        >
          {isConnected && address ? (
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDropdown(!showDropdown);
                }}
                className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-white border border-dark-200 hover:border-gold-500 transition-all shadow-sm"
              >
                {/* Balance */}
                <div className="text-right">
                  <div className="text-sm font-semibold text-black">
                    {balanceData?.balance
                      ? `${parseFloat(balanceData.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AUSD`
                      : "0.00 AUSD"}
                  </div>
                  <div className="text-xs text-dark-500">
                    {truncateAddress(address)}
                  </div>
                </div>
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-gold-500 to-gold-600 flex items-center justify-center">
                  <svg
                    className="w-5 h-5 text-black"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                  </svg>
                </div>
              </button>

              {/* Dropdown */}
              <AnimatePresence>
                {showDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 mt-2 w-64 rounded-2xl bg-white border border-dark-200 shadow-xl overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="p-4 border-b border-dark-100">
                      <div className="text-xs text-dark-500 mb-1">
                        Wallet Address
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={copyAddress}
                          className="flex items-center gap-1.5 text-sm font-medium text-black hover:text-gold-600 transition-colors"
                          title="Copy address"
                        >
                          {truncateAddress(address)}
                          {copied ? (
                            <svg
                              className="w-4 h-4 text-green-500"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                          ) : (
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                              />
                            </svg>
                          )}
                        </button>
                        <a
                          href={explorerUrl || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 text-dark-400 hover:text-gold-600 transition-colors"
                          title="View on explorer"
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                            />
                          </svg>
                        </a>
                      </div>
                    </div>
                    <div className="p-2">
                      <button
                        onClick={handleSignOut}
                        className="w-full px-4 py-2.5 text-left text-sm text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                      >
                        Sign out
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <div className="relative">
              {isPending ? (
                <div className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-gradient-to-r from-gold-500 to-gold-600 text-black font-semibold">
                  <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  <span>Connecting...</span>
                </div>
              ) : (
                <>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowAuthDropdown(!showAuthDropdown);
                    }}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-gradient-to-r from-gold-500 to-gold-600 text-black font-semibold shadow-lg shadow-gold-500/25 hover:shadow-xl hover:shadow-gold-500/30 transition-all"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                    <span>Account</span>
                    <svg
                      className={`w-4 h-4 transition-transform ${showAuthDropdown ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </motion.button>

                  {/* Auth Dropdown */}
                  <AnimatePresence>
                    {showAuthDropdown && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 mt-2 w-48 rounded-2xl bg-white border border-dark-200 shadow-xl overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="p-2">
                          <button
                            onClick={handleSignUp}
                            className="w-full px-4 py-2.5 text-left text-sm text-black hover:bg-gold-50 rounded-xl transition-colors flex items-center gap-2"
                          >
                            <svg
                              className="w-4 h-4 text-gold-600"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                              />
                            </svg>
                            Sign up
                          </button>
                          <button
                            onClick={handleSignIn}
                            className="w-full px-4 py-2.5 text-left text-sm text-black hover:bg-dark-50 rounded-xl transition-colors flex items-center gap-2"
                          >
                            <svg
                              className="w-4 h-4 text-dark-500"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"
                              />
                            </svg>
                            Sign in
                          </button>
                        </div>
                        <div className="px-4 py-2 bg-dark-50 border-t border-dark-100">
                          <p className="text-xs text-dark-400">
                            Use Face ID, Touch ID, or passkey
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}
            </div>
          )}
        </motion.div>
      </div>
    </header>
  );
}


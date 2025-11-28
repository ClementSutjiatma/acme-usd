import Stripe from "stripe";
import { config } from "./config";

// Server-side Stripe client
export function createStripeClient() {
  if (!config.stripeSecretKey) {
    throw new Error("Stripe secret key not configured");
  }
  
  return new Stripe(config.stripeSecretKey, {
    apiVersion: "2025-02-24.acacia",
    typescript: true,
  });
}

// Get or create a Stripe Customer for a wallet address
export async function getOrCreateCustomer(
  stripe: Stripe,
  walletAddress: string,
  existingCustomerId?: string | null
): Promise<Stripe.Customer> {
  // If we already have a customer ID, retrieve it
  if (existingCustomerId) {
    try {
      const customer = await stripe.customers.retrieve(existingCustomerId);
      if (!customer.deleted) {
        return customer as Stripe.Customer;
      }
    } catch (error) {
      console.warn(`[STRIPE] Could not retrieve customer ${existingCustomerId}:`, error);
    }
  }

  // Create a new customer
  const customer = await stripe.customers.create({
    metadata: {
      walletAddress: walletAddress.toLowerCase(),
    },
  });

  console.log(`[STRIPE] Created customer ${customer.id} for wallet ${walletAddress}`);
  return customer;
}

// Create a PaymentIntent for onramp with customer attached
export async function createPaymentIntent(
  stripe: Stripe,
  amountCents: number,
  userAddress: string,
  customerId?: string
) {
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    customer: customerId,
    automatic_payment_methods: {
      enabled: true,
    },
    // Save the payment method to the customer for future use
    setup_future_usage: customerId ? "off_session" : undefined,
    metadata: {
      userAddress,
      type: "onramp",
    },
  });

  return paymentIntent;
}

// Verify webhook signature
export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string
): Stripe.Event {
  const stripe = createStripeClient();
  
  if (!config.stripeWebhookSecret) {
    throw new Error("Stripe webhook secret not configured");
  }
  
  return stripe.webhooks.constructEvent(
    payload,
    signature,
    config.stripeWebhookSecret
  );
}

// Create a Financial Connections session for bank account linking
export async function createFinancialConnectionsSession(
  stripe: Stripe,
  customerId: string
): Promise<Stripe.FinancialConnections.Session> {
  const session = await stripe.financialConnections.sessions.create({
    account_holder: {
      type: "customer",
    customer: customerId,
    },
    permissions: ["payment_method"],
    filters: {
      countries: ["US"],
    },
  });

  return session;
}

// Attach a bank account from Financial Connections to a customer
export async function attachBankAccountToCustomer(
  stripe: Stripe,
  customerId: string,
  accountId: string,
  accountHolderName?: string
): Promise<Stripe.PaymentMethod> {
  // Get the account holder name from Financial Connections account if not provided
  let name = accountHolderName;
  if (!name) {
    try {
      const fcAccount = await stripe.financialConnections.accounts.retrieve(accountId);
      // account_holder can be customer or account type - extract name if available
      const holder = fcAccount.account_holder as { name?: string } | undefined;
      name = holder?.name || "Account Holder";
    } catch {
      name = "Account Holder";
    }
  }

  // Create a payment method from the linked account
  const paymentMethod = await stripe.paymentMethods.create({
    type: "us_bank_account",
    us_bank_account: {
      financial_connections_account: accountId,
    },
    billing_details: {
      name,
    },
  });

  // Attach the payment method to the customer
  await stripe.paymentMethods.attach(paymentMethod.id, {
    customer: customerId,
  });

  return paymentMethod;
}

// Get bank account details for a Financial Connections account
export async function getBankAccountDetails(
  stripe: Stripe,
  accountId: string
): Promise<{
  bankName: string;
  last4: string;
  accountType: string;
} | null> {
  try {
    const account = await stripe.financialConnections.accounts.retrieve(accountId);
    return {
      bankName: account.institution_name || "Bank",
      last4: account.last4 || "****",
      accountType: account.subcategory || "checking",
    };
  } catch {
    return null;
  }
}

// Create payout for offramp using bank account (ACH)
export async function createPayout(
  stripe: Stripe,
  amountCents: number,
  offrampId: string,
  customerId?: string,
  bankAccountId?: string
) {
  console.log(`[OFFRAMP] Processing payout of ${amountCents} cents for offramp ${offrampId}`);
  
  // In production with Stripe Connect or Treasury, you would:
  // 1. For ACH to external bank: Use Stripe Treasury or Connect payouts
  // 2. For instant payouts to debit cards: Use Stripe Instant Payouts (requires approval)
  
  // For demo/test mode, we simulate the payout
  // In test mode, Stripe Financial Connections uses sandbox accounts that can't receive real transfers
  
  if (customerId && bankAccountId) {
    console.log(`[OFFRAMP] Payout to customer ${customerId}, bank account ${bankAccountId}`);
    
    // Get bank account details for logging
    try {
      const bankDetails = await getBankAccountDetails(stripe, bankAccountId);
      if (bankDetails) {
        console.log(`[OFFRAMP] Bank: ${bankDetails.bankName} ****${bankDetails.last4}`);
      }
    } catch (e) {
      // Ignore errors fetching details
    }
    
    // In production with proper Stripe setup:
    // Option 1: Stripe Treasury (full control)
    // const transfer = await stripe.treasury.outboundPayments.create({...})
    
    // Option 2: Stripe Connect (if user has connected account)
    // const payout = await stripe.payouts.create({...})
    
    // Option 3: Use Stripe Issuing to fund user's card
  }
  
  // For demo, return a simulated successful payout
  return {
    id: `po_demo_${Date.now()}_${offrampId.slice(0, 8)}`,
    amount: amountCents,
    status: "paid",
    bank_account: bankAccountId,
  };
}

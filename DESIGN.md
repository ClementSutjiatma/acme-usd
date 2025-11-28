# AcmeUSD Onramp/Offramp System - Design Document
---

## Overview

This document outlines the design and implementation plan for building an onramp/offramp system for AcmeUSD, a stablecoin on the Tempo network.

### Requirements

1. A user can pay USD to ACME and get AcmeUSD in their wallet
2. A user can ask ACME to offramp from AcmeUSD, get instructions, and receive USD
3. The supply of AcmeUSD on Tempo is fully backed by user deposits
4. A user can use AcmeUSD to pay fees on Tempo

### Constraints

- All users are using Tempo passkey wallets
- ACME has liquidity to fund linkingUSD purchases
- All users are assumed legitimate (no fraud handling required)

---
## User Flow

### Onramp: USD → AcmeUSD

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ONRAMP USER JOURNEY                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. CONNECT WALLET                                                          │
│     ┌──────────────┐                                                        │
│     │  User visits │──▶ Creates passkey ──▶ Wallet address generated       │
│     │  acme.com    │    (Face ID/Touch ID)   (from P256 public key)        │
│     └──────────────┘                                                        │
│                                                                             │
│  2. INITIATE PURCHASE                                                       │
│     ┌──────────────┐                                                        │
│     │  User enters │──▶ "Buy $100 of AcmeUSD"                              │
│     │  amount      │                                                        │
│     └──────────────┘                                                        │
│                                                                             │
│  3. PAYMENT (embedded, no redirect)                                         │
│     ┌──────────────┐    ┌──────────────┐                                   │
│     │  Payment     │──▶ │  User pays   │  (Link = one-click if returning)  │
│     │  form shows  │    │  in-app      │                                   │
│     │  in-app      │    │              │                                   │
│     └──────────────┘    └──────────────┘                                   │
│                                                                             │
│  4. RECEIVE TOKENS                                                          │
│     ┌──────────────┐    ┌──────────────┐    ┌──────────────┐               │
│     │  Webhook     │──▶ │  Backend     │──▶ │  100 AcmeUSD │               │
│     │  confirms    │    │  mints       │    │  in wallet   │               │
│     └──────────────┘    └──────────────┘    └──────────────┘               │
│                                                                             │
│  5. READY TO USE                                                            │
│     • Send AcmeUSD to anyone                                                │
│     • Pay fees in AcmeUSD (no other token needed)                          │
│     • Gas sponsored by ACME (zero friction)                                 │
│                                                                             │
│  6. (Optional, but available) VERIFY ON EXPLORER                            │
│     ┌──────────────┐                                                        │
│     │  View mint   │──▶ https://explore.tempo.xyz/tx/{txHash}              │
│     │  transaction │    (Verify AcmeUSD minted to your address)            │
│     └──────────────┘                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Offramp: AcmeUSD → USD

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           OFFRAMP USER JOURNEY                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. INITIATE WITHDRAWAL                                                     │
│     ┌──────────────┐                                                        │
│     │  User clicks │──▶ "Withdraw $50"                                     │
│     │  Withdraw    │                                                        │
│     └──────────────┘                                                        │
│                                                                             │
│  2. LINK BANK ACCOUNT (first time only)                                     │
│     ┌──────────────┐    ┌──────────────┐    ┌──────────────┐               │
│     │  No bank     │──▶ │  Stripe      │──▶ │  Bank linked │               │
│     │  linked?     │    │  Financial   │    │  Chase ••••1234              │
│     │  Link now    │    │  Connections │    │              │               │
│     └──────────────┘    └──────────────┘    └──────────────┘               │
│                                                                             │
│  3. REVIEW PAYOUT DESTINATION                                               │
│     ┌──────────────┐                                                        │
│     │  Shows       │──▶ "Payout to Chase ••••1234"                         │
│     │  linked bank │    (Linked via Financial Connections)                 │
│     └──────────────┘                                                        │
│                                                                             │
│  4. CONFIRM & SIGN                                                          │
│     ┌──────────────┐    ┌──────────────┐                                   │
│     │  Review      │──▶ │  Sign with   │  (Gas sponsored by ACME)          │
│     │  details     │    │  passkey     │                                   │
│     └──────────────┘    └──────────────┘                                   │
│                                                                             │
│  5. TRANSFER TOKENS                                                         │
│     ┌──────────────┐    ┌──────────────┐                                   │
│     │  50 AcmeUSD  │──▶ │  With memo   │  (Links to offramp request)       │
│     │  sent to     │    │  for         │                                   │
│     │  treasury    │    │  tracking    │                                   │
│     └──────────────┘    └──────────────┘                                   │
│                                                                             │
│  6. RECEIVE PAYOUT                                                          │
│     ┌──────────────┐    ┌──────────────┐    ┌──────────────┐               │
│     │  Backend     │──▶ │  Tokens      │──▶ │  $50 sent    │               │
│     │  detects     │    │  burned      │    │  to bank     │               │
│     │  transfer    │    │              │    │  (ACH)       │               │
│     └──────────────┘    └──────────────┘    └──────────────┘               │
│                                                                             │
│  7. VERIFY ON EXPLORER                                                      │
│     ┌──────────────┐                                                        │
│     │  View both   │──▶ https://explore.tempo.xyz/tx/{txHash}              │
│     │  transactions│    • Transfer tx (user → treasury with memo)          │
│     └──────────────┘    • Burn tx (treasury burns tokens)                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Bank Account Linking Flow:**
- On first withdrawal, user is prompted to link a bank account
- Stripe Financial Connections opens a secure modal
- User authenticates with their bank (Plaid-powered)
- Bank account is saved to user's profile for future withdrawals
- Payout is sent via ACH to the linked bank account

**Why Bank Accounts (not cards)?**
- Credit cards cannot receive payouts
- Debit card payouts require Stripe Instant Payouts approval
- Bank accounts via ACH are universally supported and reliable

### Key UX Principles

| Principle | Implementation |
|-----------|----------------|
| **Zero token prerequisite** | Gas sponsorship means users need nothing to start |
| **Familiar authentication** | Passkeys use Face ID/Touch ID - no seed phrases |
| **Single token experience** | AcmeUSD pays for everything including fees |
| **Minimal transactions** | Onramp: 0 user txs, Offramp: 1 user tx |
| **Clear status tracking** | Users can verify onramp/ offramp progress in real-time |

---

## Key Design Decisions

### 1. Token Architecture

**Question**: How should AcmeUSD be implemented?

| Option | Pros | Cons |
|--------|------|------|
| **TIP-20 via Factory** ✓ | Native fee payment, memo support, exchange integration | Tied to Tempo's standard |
| Custom ERC-20 | Full control | Won't work as fee token, no exchange pairing |

**Decision**: Deploy AcmeUSD as a TIP-20 token via `TIP20Factory` at `0x20Fc000000000000000000000000000000000000`.

**Rationale**: 
- TIP-20 is required to satisfy requirement #4 ("user can use AcmeUSD to pay fees on Tempo")
- Per Tempo spec: "users can pay gas fees in any TIP-20 token whose currency is USD"
- Provides built-in memo support for offramp tracking
- Enables trading on Tempo's enshrined Stablecoin Exchange

**Configuration**:
```
Name:       "AcmeUSD"
Symbol:     "AUSD"
Currency:   "USD"
QuoteToken: linkingUSD (required for USD-denominated tokens)
Decimals:   6 (TIP-20 default)
```

---

### 2. Mint/Burn Authority Model

**Question**: Who controls token supply?

| Option | Pros | Cons |
|--------|------|------|
| **Single backend wallet with ISSUER_ROLE** ✓ | Simple, fast minting | Single point of failure |
| Multi-sig | More secure | Adds latency, complexity |
| Smart contract escrow | Trustless | Complex, overkill for centralized issuer |

**Decision**: ACME backend holds a single wallet with `ISSUER_ROLE`.

**Rationale**:
- For a centralized fiat-backed stablecoin, users trust ACME regardless of on-chain architecture
- Similar to how Circle operates USDC - centralized issuer with on-chain tokens
- Simplest implementation for demo scope
- Multi-sig or HSM would be recommended for production

**Security Measures**:
- Private key stored as environment variable (not in code)
- In production: Use Hardware Security Module (HSM) or multi-sig

---

### 3. Ensuring 1:1 Backing

**Question**: How do you guarantee supply equals deposits?

**Decision**: Event-driven mint/burn with strict ordering.

**Onramp Flow** (Only mint AFTER payment confirmed):
```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   User      │    │   Stripe    │    │   Webhook   │    │   Mint      │
│   Pays      │───▶│   Processes │───▶│   Confirms  │───▶│   Tokens    │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

**Offramp Flow** (Only payout AFTER tokens received):
```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   User      │    │   Backend   │    │   Burn      │    │   Initiate  │
│   Transfers │───▶│   Detects   │───▶│   Tokens    │───▶│   Payout    │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

**Key Principle**: The order of operations is critical. Never mint speculatively.

**Implementation Details**:
- Stripe webhook must confirm `payment_intent.succeeded` before minting
- Database tracks state machine: `pending → confirmed → minted`
- Idempotency keys prevent double-minting on webhook replay
- Offramp payout only initiated after burn transaction confirmed on-chain

---

### 4. Gas Sponsorship Strategy

**Question**: How do new users pay for gas when they have zero tokens?

| Option | Pros | Cons |
|--------|------|------|
| **ACME sponsors all gas** ✓ | Zero friction onboarding | ACME bears cost |
| Users acquire gas first | No cost to ACME | Terrible UX, blocks adoption |
| Sponsor first tx only | Balanced | Added complexity |

**Decision**: ACME sponsors all user gas fees using Tempo's Native AA `fee_payer_signature`.

**Rationale**:
- Users start with zero tokens after creating a passkey wallet
- Without sponsorship, users cannot transact until they acquire a fee token
- Tempo's Native AA transaction type supports gas sponsorship natively
- Cost is minimal (~$0.001 per transaction)

**Implementation** (using tempo.ts Fee Payer Relay):

tempo.ts provides built-in support for fee sponsorship via the `withFeePayer` transport helper.

**Frontend (Client Setup)**:
```typescript
import { createWalletClient } from 'viem';
import { withFeePayer } from 'tempo.ts/viem';

const client = createWalletClient({
  transport: withFeePayer({
    default: http(TEMPO_RPC_URL),
    feePayer: {
      transport: http('/api/sponsor'),  // Routes to our relay
      policy: 'sponsorAndBroadcast',    // Relay signs AND broadcasts
    },
  }),
});

// When sending a transaction with feePayer: true
// It automatically routes to our /api/sponsor endpoint
```

**Frontend (Sending Sponsored Transaction)**:
```typescript
import { Hooks } from 'tempo.ts/wagmi';

function SendPayment() {
  const sendPayment = Hooks.token.useTransferSync();
  
  const handleSend = () => {
    sendPayment.mutate({
      amount: parseUnits('50', 6),
      to: treasuryAddress,
      token: ACME_USD_ADDRESS,
      feeToken: ALPHA_USD_ADDRESS,  // Fee paid in AlphaUSD
      feePayer: true,               // ← Routes to relay!
    });
  };
}
```

**Backend (Fee Payer Relay - `/api/sponsor/route.ts`)**:
```typescript
import { privateKeyToAccount } from 'viem/accounts';

export async function POST(req: Request) {
  const { transaction } = await req.json();
  
  // Backend sponsor account (secp256k1)
  const sponsorAccount = privateKeyToAccount(
    process.env.BACKEND_PRIVATE_KEY as `0x${string}`
  );
  
  // Sign as fee payer and broadcast
  // tempo.ts handles the fee_payer_signature construction
  const txHash = await walletClient.sendTransaction({
    ...transaction,
    feePayer: sponsorAccount,
  });
  
  return Response.json({ txHash });
}
```

**Cost Considerations**:
- Acceptable as user acquisition cost
- Can add per-user rate limiting if needed, to prevent overuse of onramp/ offramp

---

### 5. Offramp Tracking Mechanism

**Question**: How do you link an on-chain transfer to an off-chain payout?

| Option | Pros | Cons |
|--------|------|------|
| **transferWithMemo** ✓ | Single tx, on-chain proof | 32-byte limit |
| Approval + transferFrom | Standard pattern | 2 transactions |
| User burns directly | Simplest | User can't have ISSUER_ROLE |

**Decision**: Use TIP-20's `transferWithMemo` function with a unique request ID.

**Rationale**:
- TIP-20 provides built-in 32-byte memo support
- Single transaction for better UX
- On-chain proof links transfer to specific offramp request
- No need to grant users any special roles

**Implementation**:
```
1. User requests offramp → Backend generates unique requestId
2. Backend creates memo: keccak256(requestId) → bytes32
3. User calls: transferWithMemo(treasury, amount, memo)
4. Backend monitors TransferWithMemo events
5. Matches memo → Burns tokens → Looks up user's linked bank account
6. Initiates ACH payout to linked bank account
```

**Payout Destination**:
- Uses the bank account linked via Stripe Financial Connections
- Bank accounts receive standard ACH transfers (1-3 business days)
- User must link a bank account before first withdrawal

---

### 6. Payout Method Strategy

**Question**: How do users specify where to receive offramp payouts?

| Option | Pros | Cons |
|--------|------|------|
| Reuse onramp payment method | Zero friction | Credit cards can't receive payouts |
| **Stripe Financial Connections** ✓ | Reliable bank payouts, secure | Extra linking step |
| Stripe Connect | Full control | Complex onboarding, overkill for demo |

**Decision**: Use Stripe Financial Connections to link bank accounts for payouts.

**Rationale**:
- Credit cards (most common onramp method) cannot receive payouts
- Debit card payouts require special Stripe approval (Instant Payouts)
- Bank accounts via ACH are universally supported
- Financial Connections provides secure, Plaid-powered bank linking
- One-time setup, then frictionless for future withdrawals

**How It Works**:
```
First withdrawal (no bank linked):

┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   User      │    │   Financial │    │   Bank      │
│   clicks    │───▶│   Connections───▶│   account   │
│   Withdraw  │    │   modal     │    │   linked    │
└─────────────┘    └─────────────┘    └─────────────┘
       │
       ▼
┌─────────────┐
                                      │   users     │
                                      │   table     │
                                      │   updated   │
└─────────────┘

Subsequent withdrawals:

┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Offramp   │    │   Look up   │    │   ACH       │
│   Request   │───▶│   linked    │───▶│   payout    │
│             │    │   bank      │    │   initiated │
└─────────────┘    └─────────────┘    └─────────────┘
```

**Implementation**:
- `/api/bank/create-session` - Creates Financial Connections session
- `/api/bank/save` - Saves linked bank account to user profile
- `/api/bank/status` - Returns user's linked bank account details
- `stripe_bank_account_id` column in `users` table

**Test Mode**:
- Stripe provides simulated bank selection UI
- Test routing number: `110000000`
- Test account number: `000123456789`

---

### 7. Payment Provider Choice (Onramp)

**Question**: Which payment rails for USD?

| Option | Best For | Redirect? |
|--------|----------|-----------|
| **Stripe Elements + Link** ✓ | Embedded, one-click | No |
| Stripe Checkout | Simple integration | Yes (leaves site) |
| Plaid + ACH | Bank transfers | Yes |

**Decision**: Stripe **Payment Element** (embedded) with **Link** enabled.

**Why Embedded (No Redirect)?**
- User stays on our single-page app
- Works seamlessly with Framer Motion transitions
- Link provides one-click checkout for returning users
- Better UX than redirecting to stripe.com

**How Link Works**:
1. User enters email → Link checks if they have saved payment info
2. If yes → One-click authentication (no card entry needed)
3. If no → Standard card form, option to save to Link

**Backend: Create Payment Intent**

```typescript
// app/api/onramp/create/route.ts
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request) {
  const { amountUsd, userAddress } = await req.json();
  
  // Get or create Stripe Customer for this wallet
  const user = await getOrCreateUser(supabase, userAddress);
  let customerId = user.stripe_customer_id;
  
  if (!customerId) {
    const customer = await stripe.customers.create({
      metadata: { userAddress },
    });
    customerId = customer.id;
    await updateUserStripeCustomer(supabase, userAddress, customerId);
  }
  
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountUsd * 100,  // cents
    currency: 'usd',
    customer: customerId,     // Link to customer for saved payment methods
    metadata: { userAddress },
    automatic_payment_methods: { enabled: true },
    setup_future_usage: 'off_session',  // Save payment method for offramp payouts
  });
  
  return Response.json({ 
    clientSecret: paymentIntent.client_secret 
  });
}
```

**Key Addition**: `setup_future_usage: 'off_session'` saves the payment method to the customer, enabling it to be used for offramp payouts later.

**Frontend: Embedded Payment Form**

```tsx
// components/PaymentForm.tsx
import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';

function PaymentForm({ amount, onSuccess }: Props) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    
    setLoading(true);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: window.location.href,  // Stay on same page
      },
      redirect: 'if_required',  // Only redirect if absolutely necessary
    });
    
    if (error) {
      console.error(error);
    } else {
      onSuccess();  // Transition to success view
    }
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement />
      <button disabled={loading}>
        {loading ? 'Processing...' : `Pay $${amount}`}
      </button>
    </form>
  );
}
```

**App Setup (Stripe Provider)**

```tsx
// app/providers.tsx
import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_KEY!);

function StripeProvider({ clientSecret, children }) {
  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      {children}
    </Elements>
  );
}
```

**Webhook (Same as Before)**

```typescript
// app/api/onramp/webhook/route.ts
export async function POST(req: Request) {
  const event = stripe.webhooks.constructEvent(...);
  
  if (event.type === 'payment_intent.succeeded') {
    const { userAddress } = event.data.object.metadata;
    const amount = event.data.object.amount / 100;
    
    // Mint AcmeUSD to user
    await mintAcmeUSD(userAddress, amount);
  }
}
```

**Test Mode**:
- Test card: `4242 4242 4242 4242`
- Any future expiry, any CVC
- Link: Any email, OTP = any 6 digits

**Flow (No Redirect)**:
```
User enters amount → Payment form appears (in-app) → Pay → Success view
                                   ↓
                     (Link users: one-click, no card entry)
```

---

### 8. Wallet Integration

**Question**: How do users authenticate and sign transactions?

**Decision**: Use `tempo.ts/wagmi` with `webAuthn()` connector for passkey wallets.

**Rationale**:
- Assignment specifies: "All users will be using Tempo passkey wallets"
- Tempo's SDK provides native WebAuthn support
- P256 keypair created via device biometrics (Face ID, Touch ID, etc.)
- Address derived from public key hash

**Benefits**:
- No seed phrases to manage or lose
- No browser extensions required
- No hardware wallets needed
- Familiar authentication UX (biometrics)

**Implementation**:
```typescript
import { webAuthn } from 'tempo.ts/wagmi';

const config = createConfig({
  connectors: [webAuthn()],
  chains: [tempo({ feeToken: ACME_USD_ADDRESS })],
});
```

---

## Architecture

### System Overview

```
┌────────────────────────────────────────────────────────────────┐
│                         FRONTEND                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  Connect     │  │   Onramp     │  │   Offramp    │         │
│  │  Passkey     │  │   Flow       │  │   Flow       │         │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘         │
│         │                 │                 │                  │
│         └─────────────────┼─────────────────┘                  │
│                           │ tempo.ts/wagmi                     │
└───────────────────────────┼────────────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────────┐
│                    NEXT.JS API ROUTES                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐               │
│  │  Stripe    │  │   Mint/    │  │   Event    │               │
│  │  Handler   │  │   Burn     │  │   Monitor  │               │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘               │
│        │               │               │                       │
│        └───────────────┼───────────────┘                       │
│                        │ tempo.ts/viem                         │
└────────────────────────┼───────────────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────────────┐
│                    TEMPO TESTNET                               │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐               │
│  │  AcmeUSD   │  │  Fee       │  │  Stablecoin│               │
│  │  TIP-20    │  │  Manager   │  │  Exchange  │               │
│  └────────────┘  └────────────┘  └────────────┘               │
└────────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Frontend | Next.js 14 + TypeScript | Full-stack framework, API routes built-in |
| Styling | Tailwind CSS | Rapid UI development |
| Wallet | tempo.ts/wagmi + WebAuthn | Official Tempo SDK with passkey support |
| Blockchain | tempo.ts/viem | Tempo extension for viem |
| Payments | Stripe Elements + Link | Embedded payment, one-click for returning users |
| Database | Supabase (PostgreSQL) | Hosted, dashboard UI, production-ready |

---

## API Endpoints

### Onramp Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/onramp/create` | POST | Create Stripe Payment Intent (embedded) |
| `/api/onramp/webhook` | POST | Handle Stripe payment webhook |
| `/api/onramp/status/:id` | GET | Check onramp request status |

**POST `/api/onramp/create`**
```typescript
// Request
{
  "userAddress": "0x...",
  "amountUsd": 100
}

// Response (for embedded Payment Element)
{
  "clientSecret": "pi_xxx_secret_xxx",
  "paymentIntentId": "pi_xxx"
}
```

**POST `/api/onramp/webhook`**
```typescript
// Stripe sends payment_intent.succeeded
// Backend:
// 1. Verify webhook signature
// 2. Check idempotency (already processed?)
// 3. Mint AcmeUSD to user address
// 4. Update database status
```

### Offramp Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/offramp/create` | POST | Create offramp request, return memo |
| `/api/offramp/status/:id` | GET | Check offramp status (polls for transfer) |
| `/api/offramp/process/:id` | POST | Process a specific offramp (burn + payout) |

**POST `/api/offramp/create`**
```typescript
// Request
{
  "userAddress": "0x...",
  "amountUsd": 50
}

// Response
{
  "requestId": "off_abc123",
  "memo": "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
  "treasuryAddress": "0x...",
  "amountUsd": 50
}
```

**GET `/api/offramp/status/:id`**
```typescript
// Response
{
  "requestId": "off_abc123",
  "status": "pending" | "transferred" | "burned" | "paid_out" | "failed",
  "amountUsd": 50,
  "transferTxHash": "0x..." | null,
  "burnTxHash": "0x..." | null,
  "payoutId": "po_..." | null
}
```

### Bank Account Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/bank/create-session` | POST | Create Financial Connections session |
| `/api/bank/save` | POST | Save linked bank account to user profile |
| `/api/bank/status` | GET | Get user's linked bank account details |

**POST `/api/bank/create-session`**
```typescript
// Request
{
  "walletAddress": "0x..."
}

// Response
{
  "clientSecret": "fcsess_xxx_secret_xxx"
}
```

**POST `/api/bank/save`**
```typescript
// Request
{
  "walletAddress": "0x...",
  "accountId": "fca_xxx"  // From Financial Connections
}

// Response
{
  "success": true,
  "paymentMethodId": "pm_xxx",
  "bankDetails": {
    "bankName": "Chase",
    "last4": "1234",
    "accountType": "checking"
  }
}
```

**GET `/api/bank/status?address=0x...`**
```typescript
// Response (when bank linked)
{
  "hasBankAccount": true,
  "bankAccount": {
    "bankName": "Chase",
    "last4": "1234",
    "accountType": "checking"
  }
}

// Response (when no bank linked)
{
  "hasBankAccount": false,
  "bankAccount": null
}
```

### Sponsorship Endpoint (Fee Payer Relay)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sponsor` | POST | Sign as fee payer and broadcast transaction |

This endpoint implements the **Fee Payer Relay** pattern from tempo.ts. The `withFeePayer` transport helper routes transactions here when `feePayer: true` is set.

**POST `/api/sponsor`**
```typescript
// Request (from withFeePayer transport)
{
  "transaction": {
    "to": "0x...",
    "data": "0x...",
    "value": "0x0",
    // ... other tx fields
  }
}

// Response
{
  "txHash": "0x..."  // Transaction hash after broadcast
}
```

**Implementation**:
```typescript
// app/api/sponsor/route.ts
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { tempo } from 'tempo.ts/chains';

const sponsorAccount = privateKeyToAccount(
  process.env.BACKEND_PRIVATE_KEY as `0x${string}`
);

const walletClient = createWalletClient({
  account: sponsorAccount,
  chain: tempo({ feeToken: process.env.ALPHA_USD_ADDRESS }),
  transport: http(process.env.TEMPO_RPC_URL),
});

export async function POST(req: Request) {
  try {
    const { transaction } = await req.json();
    
    // Sign as fee payer and broadcast
    const txHash = await walletClient.sendTransaction({
      ...transaction,
      feePayer: sponsorAccount,
      feeToken: process.env.ALPHA_USD_ADDRESS,  // Pay fees in AlphaUSD
    });
    
    return Response.json({ txHash });
  } catch (error) {
    console.error('Sponsorship failed:', error);
    return Response.json(
      { error: 'Failed to sponsor transaction' },
      { status: 500 }
    );
  }
}
```

### Utility Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/balance/:address` | GET | Get user's AcmeUSD balance |
| `/api/health` | GET | Service health check |

---

## Database Schema

### Purpose

The database serves two critical functions:
1. **Idempotency** - Prevent double-minting on webhook retries
2. **Request Tracking** - Match on-chain transfers to offramp requests via memo

### Schema

```sql
-- Track users, Stripe Customer IDs, and linked bank accounts
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT UNIQUE NOT NULL,
  stripe_customer_id TEXT UNIQUE,
  stripe_bank_account_id TEXT,           -- Linked bank account for withdrawals
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Track onramp payments (prevents double-mint)
CREATE TABLE onramps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_intent_id TEXT UNIQUE NOT NULL, -- Idempotency key (pi_xxx)
  user_address TEXT NOT NULL,
  amount_usd INTEGER NOT NULL,            -- Amount in cents
  status TEXT DEFAULT 'pending',          -- pending, paid, minting, minted, failed
  mint_tx_hash TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Track offramp requests (matches memo to payout)
CREATE TABLE offramps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memo TEXT UNIQUE NOT NULL,              -- 32-byte memo hash (0x...)
  user_address TEXT NOT NULL,
  amount_usd INTEGER NOT NULL,            -- Amount in cents
  status TEXT DEFAULT 'pending',          -- pending, transferred, burning, burned, paying, paid_out, failed
  transfer_tx_hash TEXT,
  burn_tx_hash TEXT,
  stripe_payout_id TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_onramps_user ON onramps(user_address);
CREATE INDEX idx_onramps_status ON onramps(status);
CREATE INDEX idx_offramps_user ON offramps(user_address);
CREATE INDEX idx_offramps_memo ON offramps(memo);
CREATE INDEX idx_offramps_status ON offramps(status);

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER onramps_updated_at
  BEFORE UPDATE ON onramps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER offramps_updated_at
  BEFORE UPDATE ON offramps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Note: Rate limiting table omitted for demo (assumes legitimate users)
-- In production, add sponsored_transactions table to prevent gas drain
```

### Users Table Purpose

The `users` table links wallet addresses to Stripe data, enabling:
1. **Stripe Customer** - Links wallet to Stripe Customer for payment processing
2. **Bank Account Linking** - Stores linked bank account ID for withdrawal payouts
3. **Returning User UX** - Stripe Link provides one-click checkout for known customers

### Supabase Client Usage

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!  // Use service key for backend
);

// Example: Create onramp record
const { data, error } = await supabase
  .from('onramps')
  .insert({
    payment_intent_id: paymentIntent.id,
    user_address: userAddress,
    amount_usd: amountCents,
    status: 'pending'
  })
  .select()
  .single();

// Example: Check idempotency (in webhook handler)
const { data: existing } = await supabase
  .from('onramps')
  .select()
  .eq('payment_intent_id', paymentIntentId)
  .single();

if (existing?.status === 'minted') {
  return; // Already processed, skip
}
```

### State Machines

**Onramp States:**
```
pending → paid → minting → minted
                    ↓
                  failed
```

**Offramp States:**
```
pending → transferred → burning → burned → paying → paid_out
              ↓            ↓                  ↓
           failed       failed             failed
```

---

## Error Handling & Recovery

### Onramp Error Scenarios

| Scenario | Detection | Handling | Recovery |
|----------|-----------|----------|----------|
| Stripe payment fails | Webhook: `payment_intent.failed` | Update status to `failed` | User retries payment |
| Mint transaction fails | `eth_sendTransaction` throws | Update status to `failed`, log error | Manual retry or refund |
| Webhook delivery fails | Stripe retries (up to 3 days) | Idempotency key prevents duplicates | Automatic via retry |
| Duplicate webhook | Check `stripe_session_id` exists | Skip processing, return 200 | Already handled |

**Mint Failure Recovery:**
```typescript
async function handleMintFailure(onrampId: string, error: Error) {
  // 1. Update database
  await db.update('onramps', { 
    id: onrampId, 
    status: 'failed',
    error_message: error.message 
  });
  
  // 2. Log for manual review
  logger.error('Mint failed', { onrampId, error });
  
  // 3. Alert (in production)
  // await alertOps('Mint failure requires review', { onrampId });
  
  // 4. Options: manual retry or Stripe refund
}
```

### Offramp Error Scenarios

| Scenario | Detection | Handling | Recovery |
|----------|-----------|----------|----------|
| No bank account linked | UI check before transfer | Block withdrawal, prompt linking | User links bank account |
| User never transfers | Status stays `pending` | Request expires after 24h | User creates new request |
| Transfer detected, burn fails | `eth_sendTransaction` throws | Status: `failed`, tokens stuck in treasury | Manual burn + retry payout |
| Burn succeeds, payout fails | Stripe API error | Status: `failed`, keep burn tx proof | Manual Stripe payout |
| Wrong memo sent | No matching request found | Ignore transfer | User contacts support |
| Insufficient balance | Transfer reverts on-chain | No status change | User checks balance |
| Bank account disconnected | Stripe API error on payout | Status: `failed` | User re-links bank account |

**Offramp Failure Recovery:**
```typescript
async function handleOfframpFailure(offrampId: string, stage: string, error: Error) {
  await db.update('offramps', {
    id: offrampId,
    status: 'failed',
    error_message: `Failed at ${stage}: ${error.message}`
  });
  
  // If tokens were received but burn/payout failed,
  // we have proof via transfer_tx_hash
  // Manual intervention required
}
```

### Gas Sponsorship Errors

| Scenario | Detection | Handling |
|----------|-----------|----------|
| Backend wallet out of gas | `eth_sendTransaction` fails | Alert ops, refill wallet |
| Invalid user signature | Signature verification fails | Return 400, reject request |
| Malformed transaction | RLP decode fails | Return 400, reject request |

> **Note**: Rate limiting is omitted for the demo given the "all users are legitimate" assumption. In production, implement per-address rate limits (e.g., 10 txs/hour, 100 txs/day) to prevent accidental or intentional gas drain.

### Monitoring (Production)

For the demo, basic console logging is sufficient. In production, monitor:

| Metric | Threshold | Action |
|--------|-----------|--------|
| Failed mints | > 0 in 1 hour | Alert + manual review |
| Failed offramps | > 0 in 1 hour | Alert + manual review |
| Backend wallet balance | < 10 linkingUSD | Alert + refill |

---

## Security Considerations

| Risk | Mitigation |
|------|------------|
| Double-mint on webhook replay | Idempotency key stored in database |
| Unauthorized minting | ISSUER_ROLE restricted to backend wallet |
| Private key exposure | Environment variables, never committed |
| Offramp without payment | Only payout after on-chain burn confirmed |
| Gas drain attack | Out of scope for demo (assumes legitimate users); add rate limiting in production |
| Chargeback fraud | Out of scope (assuming legitimate users) |
| Bank account fraud | Stripe Financial Connections verifies account ownership |

---

## Trade-offs and Limitations

| Trade-off | Choice Made | Impact |
|-----------|-------------|--------|
| Centralization vs. Security | Centralized issuer | Simple but requires trust in ACME |
| UX vs. Decentralization | Full gas sponsorship | Great UX but ACME bears cost |
| Simplicity vs. Control | Supabase (hosted) | Easy setup, less infrastructure control |
| Scope vs. Time | No KYC/AML | Matches "assume legitimate users" |

---

## Future Enhancements (Out of Scope)

- Multi-sig treasury for production security
- KYC/AML integration for regulatory compliance
- Wire transfers for large amounts
- Admin dashboard for ACME operations
- Gas sponsorship rate limiting (per-address limits to prevent drain)
- Proper secrets management (AWS KMS, HashiCorp Vault)
- Chargeback handling and dispute resolution
- Instant payouts to debit cards (requires Stripe approval)

---

## Testnet Configuration

| Resource | Value |
|----------|-------|
| RPC URL | `https://dreamy-northcutt:recursing-payne@rpc.testnet.tempo.xyz` |
| Explorer | `https://explore.tempo.xyz` (credentials: eng:zealous-mayer) |
| TIP20Factory | `0x20Fc000000000000000000000000000000000000` |
| TIP403Registry | `0x403c000000000000000000000000000000000000` |
| StablecoinExchange | `0xdec0000000000000000000000000000000000000` |

### Faucet Tokens

The testnet faucet (`tempo_fundAddress` RPC method) provides:

| Asset | Address | Amount |
|-------|---------|-------:|
| LinkingUSD | `0x20c0000000000000000000000000000000000000` | 1M |
| AlphaUSD | `0x20c0000000000000000000000000000000000001` | 1M |
| BetaUSD | `0x20c0000000000000000000000000000000000002` | 1M |
| ThetaUSD | `0x20c0000000000000000000000000000000000003` | 1M |

**Important**: Validators on testnet expect **AlphaUSD** as their fee token. This affects the Fee AMM liquidity requirements.

---

## Deployment & Setup

### Prerequisites

Before the system can function, the following setup steps must be completed:

### Step 1: Generate Backend Wallet (secp256k1)

The backend wallet is used for:
- Holding `ISSUER_ROLE` (mint/burn AcmeUSD)
- Signing as `fee_payer` for gas sponsorship
- Paying gas fees for mint/burn operations

**Important**: The fee payer signature **must be secp256k1** (not P256/passkey). Generate a standard Ethereum private key.

```typescript
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

// Generate and save securely (do this once, store in env)
const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);
console.log('Backend wallet address:', account.address);
// Store privateKey in BACKEND_PRIVATE_KEY env var
```

### Step 2: Fund Backend Wallet via Faucet

The backend wallet needs tokens to pay for gas when minting/burning.

```typescript
import { createPublicClient, http } from 'viem';

const client = createPublicClient({
  transport: http('https://dreamy-northcutt:recursing-payne@rpc.testnet.tempo.xyz')
});

// Fund the backend wallet with testnet tokens
await client.request({
  method: 'tempo_fundAddress',
  params: [backendWalletAddress]
});

// This gives:
// - 1M LinkingUSD (for quoteToken requirement)
// - 1M AlphaUSD (validator's fee token)
// - 1M BetaUSD, ThetaUSD
```

### Step 3: Deploy AcmeUSD Token

Deploy via TIP20Factory:

```typescript
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount(process.env.BACKEND_PRIVATE_KEY);
const walletClient = createWalletClient({
  account,
  transport: http('https://dreamy-northcutt:recursing-payne@rpc.testnet.tempo.xyz')
});

const TIP20_FACTORY = '0x20Fc000000000000000000000000000000000000';
const LINKING_USD = '0x20c0000000000000000000000000000000000000';

// Deploy AcmeUSD
const txHash = await walletClient.writeContract({
  address: TIP20_FACTORY,
  abi: TIP20_FACTORY_ABI,
  functionName: 'createToken',
  args: [
    'AcmeUSD',           // name
    'AUSD',              // symbol
    'USD',               // currency (required for fee payment)
    LINKING_USD,         // quoteToken (required for USD tokens)
    account.address      // admin (receives DEFAULT_ADMIN_ROLE)
  ]
});

// Get deployed token address from event
const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
// Parse TokenCreated event to get AcmeUSD address
```

**Token Address**: The deployed AcmeUSD will have an address like `0x20c0000000000000000000000000000000000004` (next available TIP-20 ID).

### Step 4: Grant ISSUER_ROLE to Backend

The deployer (admin) already has DEFAULT_ADMIN_ROLE. Grant ISSUER_ROLE:

```typescript
const ISSUER_ROLE = keccak256(toBytes('ISSUER_ROLE'));

await walletClient.writeContract({
  address: ACME_USD_ADDRESS,
  abi: TIP20_ABI,
  functionName: 'grantRole',
  args: [ISSUER_ROLE, account.address]
});
```

### Step 5: Fee AMM Liquidity (CRITICAL)

**Problem**: For users to pay fees in AcmeUSD, there must be liquidity on the Fee AMM to convert AcmeUSD → AlphaUSD (validator's preferred token).

**Current Understanding**: The Fee AMM liquidity provisioning mechanism needs to be verified. Options:
1. The Stablecoin Exchange may automatically provide fee conversion
2. May need to explicitly add liquidity to a Fee AMM pool

**For Demo**: If Fee AMM liquidity is complex, alternative approaches:
- Backend pays fees in AlphaUSD (which it has from faucet) instead of AcmeUSD
- Or use the transaction-level `fee_token` field to specify AlphaUSD

```typescript
// Option: Backend specifies fee_token as AlphaUSD when sponsoring
const tx = {
  // ... transaction fields
  feeToken: ALPHA_USD_ADDRESS,  // Use AlphaUSD for fees
};
```

**TODO**: Verify Fee AMM liquidity requirements with Tempo documentation or testnet experimentation.

### Step 6: (Optional) Create Stablecoin Exchange Pair

If you want AcmeUSD tradeable on the DEX:

```typescript
const EXCHANGE = '0xdec0000000000000000000000000000000000000';

await walletClient.writeContract({
  address: EXCHANGE,
  abi: EXCHANGE_ABI,
  functionName: 'createPair',
  args: [ACME_USD_ADDRESS]  // Creates AcmeUSD/LinkingUSD pair
});
```

### Setup Checklist

```
[ ] 1. Generate backend secp256k1 private key
[ ] 2. Store private key in environment variable
[ ] 3. Fund backend wallet via faucet
[ ] 4. Deploy AcmeUSD token
[ ] 5. Record AcmeUSD contract address
[ ] 6. Grant ISSUER_ROLE to backend wallet
[ ] 7. Verify fee payment works (test transaction)
[ ] 8. (Optional) Create exchange pair
```

### Environment Variables

```env
# Backend Wallet
BACKEND_PRIVATE_KEY=0x...

# Tempo Testnet
TEMPO_RPC_URL=https://dreamy-northcutt:recursing-payne@rpc.testnet.tempo.xyz

# Contract Addresses
ACME_USD_ADDRESS=0x...  # After deployment
TREASURY_ADDRESS=0x...   # Same as backend wallet

# Token Addresses (from faucet)
LINKING_USD_ADDRESS=0x20c0000000000000000000000000000000000000
ALPHA_USD_ADDRESS=0x20c0000000000000000000000000000000000001

# Stripe (test mode)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
```

---

## Fee Payment Flow

Understanding how fees work when users transact with AcmeUSD:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     FEE PAYMENT FLOW (with tempo.ts)                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  USER SENDS AcmeUSD (with gas sponsorship via Fee Payer Relay)              │
│                                                                             │
│  1. Frontend: User initiates transfer with feePayer: true                   │
│     └── Hooks.token.useTransferSync({ ..., feePayer: true })               │
│                                                                             │
│  2. withFeePayer transport routes to /api/sponsor                           │
│     └── User signs with passkey (P256/WebAuthn)                            │
│     └── Transaction sent to relay endpoint                                  │
│                                                                             │
│  3. Backend relay receives transaction                                      │
│     └── Signs as fee_payer (secp256k1)                                     │
│     └── Sets feeToken = AlphaUSD                                           │
│     └── Broadcasts to Tempo network                                         │
│                                                                             │
│  4. Protocol processes transaction:                                         │
│     └── Verifies user signature (P256/WebAuthn) ✓                          │
│     └── Verifies fee_payer signature (secp256k1) ✓                         │
│     └── Deducts fee from fee_payer (backend) in AlphaUSD                   │
│                                                                             │
│  5. Transaction executes                                                    │
│     └── User's transferWithMemo happens                                     │
│     └── AcmeUSD moves from user → treasury                                 │
│                                                                             │
│  6. Unused gas refunded to fee_payer (backend)                              │
│                                                                             │
│  7. Backend returns txHash to frontend                                      │
│     └── User sees confirmation                                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Why Use AlphaUSD for Fees?

Since validators expect AlphaUSD and we get it free from the faucet, it's simplest to:
- Pay all sponsored fees in AlphaUSD (no Fee AMM liquidity needed)
- Backend holds AlphaUSD for fee payments
- AcmeUSD is only for user balances and transfers

### Fee Payer Signature Requirement

From Tempo spec: **"Verify fee payer signature (K1 only initially)"**

This means:
- User wallet: Can be passkey (P256/WebAuthn) ✓
- Fee payer (backend): **Must be secp256k1** ✓

The backend wallet signs using standard Ethereum signing (ecrecover-compatible).

---

## UI Wireframes

Single-page app with Framer Motion transitions. All views rendered in one container.

### View States

```
┌─────────────────────────────────────────────────────────────────┐
│                         SINGLE PAGE                             │
│                                                                 │
│   state: 'landing' | 'dashboard' | 'add' | 'withdraw' | 'success'
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                                                         │   │
│   │              <AnimatePresence mode="wait">              │   │
│   │                                                         │   │
│   │                  { currentView }                        │   │
│   │                                                         │   │
│   │              </AnimatePresence>                         │   │
│   │                                                         │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### States

```
LANDING                 DASHBOARD               ADD / WITHDRAW
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│             │         │    0x1a..4d │         │  ←          │
│    ACME     │         │             │         │             │
│             │  ────▶  │   $150.00   │  ────▶  │  $ [100]    │
│ [Get Started]         │             │         │             │
│             │         │ [Add] [Out] │         │   [Pay]     │
└─────────────┘         └─────────────┘         └─────────────┘
                              ▲                       │
                              │                       │
                              │     SUCCESS           ▼
                              │   ┌─────────────┐
                              │   │             │
                              └───│      ✓      │
                                  │             │
                                  └─────────────┘
```

### Implementation

```tsx
type View = 'landing' | 'dashboard' | 'add' | 'withdraw' | 'success'

function App() {
  const [view, setView] = useState<View>('landing')
  const { isConnected } = useAccount()
  
  // Auto-transition on wallet connect
  useEffect(() => {
    if (isConnected) setView('dashboard')
  }, [isConnected])

  return (
    <div className="h-screen flex items-center justify-center">
      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.2 }}
        >
          {view === 'landing' && <Landing />}
          {view === 'dashboard' && <Dashboard onAdd={() => setView('add')} onWithdraw={() => setView('withdraw')} />}
          {view === 'add' && <AddFunds onBack={() => setView('dashboard')} onSuccess={() => setView('success')} />}
          {view === 'withdraw' && <Withdraw onBack={() => setView('dashboard')} onSuccess={() => setView('success')} />}
          {view === 'success' && <Success onDone={() => setView('dashboard')} />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
```

### Transitions

| From → To | Animation |
|-----------|-----------|
| landing → dashboard | Fade + scale up (wallet connected) |
| dashboard → add/withdraw | Slide right |
| add/withdraw → dashboard | Slide left (back) |
| any → success | Fade + scale |
| success → dashboard | Fade |

---

## Testing Plan

### Key Test Scenarios

#### Onramp

| Scenario | Expected Outcome |
|----------|------------------|
| Happy path: user pays, webhook fires | AcmeUSD minted to user wallet |
| Duplicate webhook (same session_id) | Mint happens only once (idempotency) |
| Payment fails (card declined) | Status set to `failed`, no mint |
| Webhook arrives before DB record | Graceful handling, retry succeeds |

#### Offramp

| Scenario | Expected Outcome |
|----------|------------------|
| Happy path: bank linked, transfer with memo | Tokens burned, ACH payout initiated |
| No bank account linked | UI blocks withdrawal, prompts linking |
| Bank linking succeeds | Account saved, user can proceed |
| Transfer with unknown memo | Ignored (no matching request) |
| User sends wrong amount | Still process (amount from request, not transfer) |
| Request expires (no transfer in 24h) | Status set to `expired` |
| Burn fails after transfer detected | Status `failed`, manual recovery needed |

#### Gas Sponsorship

| Scenario | Expected Outcome |
|----------|------------------|
| User with zero balance sends sponsored tx | Transaction succeeds, fee deducted from backend |
| Invalid user signature | 400 error, transaction rejected |
| Backend wallet out of AlphaUSD | Graceful error, alert ops |

#### Edge Cases

| Scenario | Expected Outcome |
|----------|------------------|
| Concurrent onramps from same user | Both processed independently |
| Concurrent offramps (different memos) | Both tracked separately |
| Very large amount ($999,999) | Handled within limits |
| Negative or zero amount | Validation rejects |
| Invalid wallet address | Validation rejects |
| RPC timeout during mint | Retry logic, eventual consistency |

### Test Types

| Type | Purpose | Tools |
|------|---------|-------|
| Unit | Memo generation, validation | Vitest |
| Integration | API routes + DB + mocks | Vitest |
| Contract | On-chain mint/burn/transfer | Vitest + viem |
| E2E | Full user flows | Playwright |

---

## Monitoring

### Key Metrics

| Metric | Source | Why It Matters |
|--------|--------|----------------|
| Onramp success rate | DB: `onramps` table | Core business health |
| Offramp success rate | DB: `offramps` table | Core business health |
| Avg mint latency | Webhook → mint confirmed | User experience |
| Backend wallet balance | On-chain query | System operability |
| Failed transactions | DB: status = `failed` | Requires intervention |
| Pending requests > 1hr | DB query | Stuck in pipeline |

### Alerts (Production)

| Condition | Severity | Action |
|-----------|----------|--------|
| Any `failed` status | High | Investigate immediately |
| Backend AlphaUSD < 100 | High | Refill wallet |
| Pending onramp > 10 min | Medium | Check Stripe/webhook |
| Pending offramp > 1 hr | Medium | Check event listener |
| Error rate > 5% (1hr window) | High | Investigate root cause |

### Dashboard Queries

```sql
-- Onramp funnel (last 24h)
SELECT status, COUNT(*) 
FROM onramps 
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY status;

-- Offramp funnel (last 24h)
SELECT status, COUNT(*) 
FROM offramps 
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY status;

-- Stuck requests
SELECT * FROM onramps 
WHERE status = 'pending' 
AND created_at < NOW() - INTERVAL '10 minutes';

SELECT * FROM offramps 
WHERE status = 'pending' 
AND created_at < NOW() - INTERVAL '1 hour';
```

### For Demo

Console logging is sufficient. Key logs:

```
[ONRAMP] Created session_id=cs_xxx user=0x... amount=100
[ONRAMP] Webhook received session_id=cs_xxx
[ONRAMP] Minted tx=0x... user=0x... amount=100
[OFFRAMP] Created memo=0x... user=0x... amount=50
[OFFRAMP] Transfer detected memo=0x... tx=0x...
[OFFRAMP] Burned tx=0x... amount=50
[SPONSOR] Sponsored tx=0x... user=0x... fee=0.001
```


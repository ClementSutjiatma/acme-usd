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
## Success Criteria

| Domain      | Success Criteria                                                | Design Decision |
|-------------|----------------------------------------------------------------|-----------------|
| **UX**      | - Zero onboarding friction: no seed phrases, no extensions     | Tempo Passkey Wallet |
|             | - Users start with $0 and can transact immediately             | Gas Sponsorship |
|             | - Embedded payment with one-click for returning users          | Stripe Elements + Link |
|             | - Minimal user actions (onramp: 0 txs, offramp: 1 tx)          | Sponsored mints, transferWithMemo |
|             | - Users can pay fees in AcmeUSD itself                         | TIP-20 Token |
| **Security**| - 1:1 backing: Never mint before payment confirmed                          | Strict Ordering |
|             | - 1:1 backing: Never payout before on-chain transfer confirmed              | Strict Ordering |
|             | - On-chain proof links every mint/burn to fiat provider IDs   | TIP-20 Memo Functions |
|             | - Only ACME has mint/burn ACLs                       | Single Backend Wallet |
| **Reliability** | - Idempotency against webhook retries                     | Database Unique Constraints |
|             | - State machines track progress, enable recovery               | Explicit State Machines |
|             | - All operations traceable via database + on-chain memos       | Event-Driven Architecture |

---
## UX 

### Wallet Setup

**Question**: How do users get started, authenticate and sign transactions?

| Option | Pros | Cons |
|--------|------|------|
| **Tempo Passkey Wallet** ✓ | No extensions, no seed phrases, biometric auth (Face ID/Touch ID), works on any device | Tempo-specific, less portable across chains |
| MetaMask / Browser Extension | Universal, widely adopted, multi-chain | Requires install, seed phrase management, intimidating for non-crypto users |
| WalletConnect | Mobile-first, supports many wallets | Extra step (QR scan), assumes user has a wallet app |
| Custodial (email/password) | Familiar logn | Additional overhead over passkey only method|

**Decision**: Use `tempo.ts/wagmi` with `webAuthn()` connector for passkey wallets.

**Rationale**:
- Assignment specifies: "All users will be using Tempo passkey wallets"
- Tempo's SDK provides native WebAuthn support
- P256 keypair created via device biometrics (Face ID, Touch ID, etc.)
- Address derived from public key hash
- **Accessibility for non-crypto users**: No wallet setup, no seed phrases, no browser extensions—just biometrics they already use

**Benefits**:
- No seed phrases to manage or lose
- No browser extensions required
- No hardware wallets needed
- Familiar authentication UX (biometrics)
- Zero onboarding friction for mainstream users

### Onramp Payment Strategy 

**Question**: How can users easily purchase AcmeUSD with fiat? 

| Option | Pros | Cons |
|--------|------|------|
| **Stripe Elements + Link** ✓ | Embedded in-app, one-click for returning users, no redirect, card + Apple/Google Pay | More integration work than Checkout |
| Stripe Checkout | Simple integration, hosted by Stripe, PCI compliant out of box | Redirects user away from app, less seamless UX |
| Plaid + ACH | Lower fees, direct bank transfers | Slower (1-3 days), redirect required, more complex setup |
| Crypto onramps (MoonPay, Transak) | Crypto-native users familiar with flow | High fees, KYC friction, overkill for fiat stablecoin |

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

### Offramp Payout Strategy

**Question**: How do users easily get paid out during withdrawal? 

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

### Gas Sponsorship

**Question**: How do new users pay for gas when they have zero tokens?

| Option | Pros | Cons |
|--------|------|------|
| **ACME sponsors all gas** ✓ | Zero friction onboarding | ACME bears cost |
| Users acquire gas first | No cost to ACME | Terrible UX, blocks adoption, increases support burden|
| Sponsor first tx only | Balanced | Added complexity |

**Decision**: ACME sponsors all user gas fees using Tempo's Native AA `fee_payer_signature`.

**Rationale**:
- Users start with zero tokens after creating a passkey wallet
- Without sponsorship, users cannot transact until they acquire a fee token
- Tempo's Native AA transaction type supports gas sponsorship natively
- Cost is minimal (<$0.001 per transaction)

**Cost Considerations**:
- Acceptable as user acquisition cost
- Can add per-user rate limiting if needed, to prevent overuse of onramp/ offramp

### Token Architecture

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
## Security

### Ensuring 1:1 Backing

**Question**: How do we guarantee AcmeUSD supply always equals fiat deposits?

| Option | Pros | Cons |
|--------|------|------|
| **Strict ordering with confirmation** ✓ | Guarantees 1:1 backing, no speculative mints, recoverable from failures | Slower (wait for confirmations) |
| Optimistic execution | Faster UX | Risk of double-mint or payout without burn |
| Smart contract escrow | Trustless, automated | Can't hold fiat, overkill for centralized issuer |

**Decision**: Enforce strict ordering—never mint before payment confirmed, never payout before burn confirmed.

**Rationale**:
- Fiat operations (Stripe payments/payouts) are external and async—we must wait for confirmation
- Minting before payment confirmation risks unbacked tokens if payment fails
- Paying out before burn confirmation risks double-spending
- State machines track progress and enable recovery from partial failures

**Implementation**:

**Onramp Flow** (only mint AFTER payment confirmed):
```
User Pays → Stripe Processes → Webhook Confirms → Mint Tokens
```

**Offramp Flow** (only payout AFTER transfer confirmed):
```
User Transfers → Backend Confirms → Initiate Payout → Burn Tokens
```

**Key Principle**: Never mint speculatively. Never payout before transfer is confirmed on-chain.

---

### On-Chain Auditability

**Question**: How do we create a verifiable link between on-chain operations and off-chain payment data?

| Option | Pros | Cons |
|--------|------|------|
| **On-chain memos (TIP-20)** ✓ | Permanent on-chain proof, publicly verifiable, links mint/burn to payment IDs | 32-byte limit |
| Database-only tracking | Simple, flexible | Not publicly verifiable, requires trust in database |
| Event logs without memo | Standard ERC-20 compatible | No semantic link to off-chain data |
| Off-chain attestations | Rich data | Requires separate verification system |

**Decision**: Use TIP-20's memo functions (`mintWithMemo`, `burnWithMemo`, `transferWithMemo`) to store hashed payment references on-chain.

**Rationale**:
- On-chain memos create a permanent, publicly verifiable audit trail
- Anyone can prove: this mint corresponds to Stripe payment `pi_xxx`, this burn corresponds to payout `po_xxx`
- TIP-20 provides native 32-byte memo support—keccak256 hashes fit perfectly
- Enables third-party audits without database access

**Implementation**:

| Operation | Off-Chain Reference | On-Chain Memo |
|-----------|---------------------|---------------|
| Onramp mint | Stripe `payment_intent_id` | `keccak256(payment_intent_id)` |
| Offramp transfer | Generated `request_id` | `keccak256(request_id)` |
| Offramp burn | Stripe `payout_id` | `keccak256(payout_id)` |

**Onramp**: When Stripe webhook confirms payment, mint with memo:
```
mintWithMemo(userAddress, amount, keccak256(payment_intent_id))
```

**Offramp**: User transfers with request memo, backend burns with payout memo:
```
1. User calls: transferWithMemo(treasury, amount, keccak256(request_id))
2. Backend matches memo to offramp request
3. Backend initiates Stripe payout → gets payout_id
4. Backend calls: burnWithMemo(amount, keccak256(payout_id))
```

**Audit Trail**: For any mint or burn transaction, anyone can:
1. Extract the memo from on-chain event logs
2. Verify it matches the hash of the corresponding Stripe payment/payout ID
3. Confirm 1:1 correspondence between token supply changes and fiat movements

### Mint/Burn Authority Model

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
---

## Reliability

**Question**: How do we ensure operations complete reliably across payments, blockchain, and payouts?

| Approach | Pros | Cons |
|----------|------|------|
| **Event-driven + Idempotency + State Machines** ✓ | Handles retries safely, recoverable from any failure point, full audit trail | More complex than fire-and-forget |
| Synchronous request/response | Simple to implement, immediate feedback | No retry safety, partial failures unrecoverable |
| Message queue (Kafka, SQS) | High throughput, guaranteed delivery | Infrastructure overhead, overkill for demo scope |
| No reliability measures | Fastest to build | Double-mints, lost payouts, no debugging capability |

**Decision**: Event-driven architecture with idempotency keys, explicit state machines, and ordered operations.

**Rationale**:
- Webhooks and blockchain events are inherently async—we must handle retries safely
- Partial failures (e.g., burn succeeds, payout fails) need clear recovery paths
- State machines provide audit trail and enable retry from last known good state
- Avoids message queue complexity while maintaining reliability guarantees

### Idempotency

**Question**: How do we prevent duplicate operations (e.g., double-minting) on retries?

| Option | Pros | Cons |
|--------|------|------|
| **Database unique constraints** ✓ | Simple, atomic, leverages existing DB | Requires careful key design |
| Distributed locks (Redis) | Works across services | Additional infrastructure, lock expiry edge cases |
| In-memory deduplication | Fast | Lost on restart, doesn't scale horizontally |

**Decision**: Use unique idempotency keys stored in the database for all critical operations.

| Operation | Idempotency Key | Storage |
|-----------|-----------------|---------|
| Onramp mint | Stripe `payment_intent_id` | `onramps.payment_intent_id` (unique) |
| Offramp request | Generated `request_id` → hashed as `memo` | `offramps.memo` (unique) |

This ensures Stripe can safely retry webhooks (up to 3 days) without causing duplicate mints.

### State Tracking

**Question**: How do we track progress and recover from partial failures?

| Option | Pros | Cons |
|--------|------|------|
| **Explicit state machines** ✓ | Clear transitions, easy to query failed states, debuggable | Must define all states upfront |
| Event sourcing | Full history, replayable | Complex to implement, overkill for this scope |
| Boolean flags (is_paid, is_minted) | Simple | Doesn't capture transitions, hard to debug |

**Decision**: Use explicit state machines with database persistence for all flows.

**Onramp States**: `pending → paid → minting → minted` (or `→ failed`)

**Offramp States**: `pending → transferred → paying → burned → paid_out` (or `→ failed` at any step)

---

## User Flow
Based on the design decisions made above, the ideal user flow looks like the following
### Onramp User Journey: USD → AcmeUSD

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

### Offramp User Journey: AcmeUSD → USD

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

## API Endpoints Design

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

### Cron Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/cron/check-offramps` | GET | Poll for pending offramps and process them |

This endpoint is designed to be called by Vercel Cron (or similar scheduler) to handle the asynchronous offramp flow:

**GET `/api/cron/check-offramps`**
```typescript
// Authorization: Bearer ${CRON_SECRET}

// Flow:
// 1. Query for TransferWithMemo events to treasury
// 2. Match memo to pending offramp requests
// 3. For each match: burn tokens + initiate Stripe payout
// 4. Update offramp status in database

// Response
{
  "processed": 2,
  "errors": []
}
```

**Why a cron job?**
- Users transfer tokens with memo, then the frontend calls `/api/offramp/process/:id`
- However, if the user closes the browser or the request fails, the cron job ensures eventual processing
- Provides reliability for the offramp flow without requiring users to stay on the page

### Utility Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/transactions/:address` | GET | Get transaction history for an address |
| `/api/health` | GET | Service health check |

**GET `/api/transactions/:address`**
```typescript
// Response
{
  "transactions": [
    {
      "id": "uuid",
      "type": "onramp" | "offramp",
      "status": "completed" | "pending" | "failed",
      "amountUsd": 100,
      "createdAt": "2024-01-01T00:00:00Z",
      "txHash": "0x...",
      "memoHash": "0x..."  // For auditability linking
    }
  ]
}
```

---

## Database Schema

### Purpose

The database serves two critical functions:
1. **Idempotency** - Prevent double-minting on webhook retries
2. **Request Tracking** - Match on-chain transfers to offramp requests via memo

### Data Ontology Specification

This section defines the key entities, their properties, and relationships for the AcmeUSD backend system. This is a *conceptual* (not technical or implementation-specific) definition of the data objects and their roles in the product.

#### Entity: User

- **Description**: Represents an individual user of AcmeUSD, uniquely identified by their wallet address. Stores payment and payout linkage.
- **Properties**:
  - *ID*: Unique identifier for the user.
  - *Wallet Address*: Unique wallet address associated with the user (acts as the main user handle).
  - *Stripe Customer ID*: Reference to the corresponding user in the Stripe system.
  - *Linked Bank Account ID*: Reference to the user's bank account for withdrawal payouts (as stored in Stripe).
  - *Created At*: Timestamp when the user record was created.
  - *Updated At*: Timestamp of the last modification to the user record.

#### Entity: Onramp Payment

- **Description**: Captures an inbound payment initiated by a user to purchase AcmeUSD (fiat → token). Each onramp action tracks payment status and minting lifecycle.
- **Properties**:
  - *ID*: Unique identifier for the onramp payment attempt.
  - *Payment Intent ID*: The idempotency key from Stripe (unique per payment attempt).
  - *User Address*: The wallet address corresponding to the user initiating the onramp.
  - *Amount (USD)*: Amount (in cents) being purchased and minted.
  - *Status*: Current stage in onramp process (e.g., pending, paid, minting, minted, failed).
  - *Mint Transaction Hash*: On-chain transaction hash of the mint operation (if completed).
  - *Error Message*: Optional message explaining failure, if applicable.
  - *Created At*: When the payment was initiated.
  - *Updated At*: Last update to the onramp record.

#### Entity: Offramp Request

- **Description**: Represents a user's request to withdraw AcmeUSD to fiat (token → bank transfer). Tracks linkage to on-chain transfer and off-chain payout status.
- **Properties**:
  - *ID*: Unique identifier for the offramp request.
  - *Memo*: Unique memo (32-byte hash, derived from a unique request id) linking the on-chain transfer to the offramp request.
  - *User Address*: The wallet address of the user making the withdrawal.
  - *Amount (USD)*: Amount (in cents) being withdrawn or paid out.
  - *Status*: Current state of the offramp process (e.g., pending, transferred, burning, burned, paying, paid_out, failed).
  - *Transfer Transaction Hash*: Hash of the on-chain transfer transaction (if relevant).
  - *Burn Transaction Hash*: Hash of the on-chain burn transaction (if relevant).
  - *Stripe Payout ID*: Reference to the payout operation in Stripe (if/when payout occurs).
  - *Error Message*: Optional explanation for process failure.
  - *Created At*: When the offramp was initiated.
  - *Updated At*: Last update to the offramp record.

#### Relationships and Indexing

- Each **User** may have multiple **Onramp Payments** and **Offramp Requests** associated by wallet address.
- The **Memo** field in the Offramp Request provides a unique, verifiable mapping between on-chain activity and application-level withdrawal requests.
- The **Stripe Customer ID** and **Stripe Bank Account ID** provide linkage to Stripe's payment and payout systems.


### State Changes

**Onramp States:**
```
pending → paid → minting → minted
                    ↓
                  failed
```

**Offramp States:**
```
pending → transferred → paying → burned → paid_out
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


### Gas Sponsorship Errors

| Scenario | Detection | Handling |
|----------|-----------|----------|
| Backend wallet out of gas | `eth_sendTransaction` fails | Alert ops, refill wallet |
| Invalid user signature | Signature verification fails | Return 400, reject request |
| Malformed transaction | RLP decode fails | Return 400, reject request |

> **Note**: Rate limiting is omitted for the demo given the "all users are legitimate" assumption. In production, implement per-address rate limits (e.g., 10 txs/hour, 100 txs/day) to prevent accidental or intentional gas drain.

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

## Testing Requirements

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

---

## Monitoring

### Key Product Metrics

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

## Appendix

### Deployment & Setup

#### High-Level Steps

1. **Generate Backend Wallet:**  
   Create a backend wallet with a secp256k1 (Ethereum-style) private key. This wallet will mint/burn tokens and sponsor user gas fees.

2. **Fund the Wallet:**  
   Use the testnet faucet to deposit AlphaUSD and other required tokens into the backend wallet so it can pay transaction fees and operate the system.

3. **Deploy AcmeUSD Token:**  
   Deploy the AcmeUSD TIP-20 token contract on Tempo testnet. The backend wallet should be set as the administrator with minting authority.

4. **Assign Roles:**  
   Give the backend wallet the necessary roles (e.g., ISSUER_ROLE) to mint and burn AcmeUSD.

5. **Configure Fee Payment:**  
   Ensure there is sufficient liquidity and fee setup so that user transactions succeed and the backend can sponsor gas for users (using AlphaUSD as the fee token if needed).

These steps must be completed before running the full onramp/offramp demo.

---

### Fee Payment Flow

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

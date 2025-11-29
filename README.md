# AcmeUSD - Onramp/Offramp System

A complete onramp/offramp system for AcmeUSD stablecoin on the Tempo network.

## Quick Links

- **📄 Design Document**: [DESIGN.md](./DESIGN.md)
- **🌐 Deployed Solution**: [https://acme-usd.vercel.app](https://acme-usd.vercel.app)
- **🎥 Video Walkthrough**: [Loom Video](https://www.loom.com/share/899f367a038746f297c7980d2ab03a5f)

## Contract Addresses

- **AcmeUSD Token**: `0x20c0000000000000000000000000000000000427`
- **Treasury Address**: `0x2fab3758A36F7366AF53Ab58a868511a3D348Fb2`

## Patches

This project uses a patched version of `tempo.ts` v0.7.2 released this past thursday. See the [patches](./patches) directory for details.

### Why This Patch Is Critical

**The Bug**: When gas sponsorship is enabled (`feePayer: true`), tempo.ts was incorrectly including the `feeToken` field in the sender's signature domain. According to Tempo's AA Transaction Spec, when a `fee_payer_signature` is present, the sender must sign with `fee_token` set to empty (0x80), not the actual fee token address.

**The Fix**: The patch modifies `serializeAA` to exclude `feeToken` from the sender's signature when `feePayer === true`. This ensures the sender signs the transaction without the fee token field, matching the protocol's expectations.

**Impact on This Demo**: This patch is **essential** for the demo to function correctly. Without it, all sponsored transactions (which is every user transaction in this demo) would fail with "invalid transaction signature" errors because:

- Users sign transactions with `feePayer: true` (see `Dashboard.tsx` line 507)
- Transactions route through `/api/sponsor` via `withFeePayer` transport (see `Providers.tsx` line 29)
- The protocol validates that sender signatures exclude `feeToken` when fee payer signatures are present

The patch ensures gas sponsorship works correctly, enabling the zero-friction UX where users don't need tokens to pay for gas.

## Features

- **Onramp**: Buy AcmeUSD with USD via Stripe
- **Offramp**: Withdraw AcmeUSD to USD
- **Passkey Authentication**: No seed phrases, just Face ID/Touch ID
- **Gas Sponsorship**: Zero gas fees for users
- **Real-time Status**: Track your transactions

## Tech Stack

- **Frontend**: Next.js 14, TypeScript, Tailwind CSS, Framer Motion
- **Wallet**: tempo.ts with WebAuthn passkeys
- **Payments**: Stripe Payment Element with Link
- **Database**: Supabase (PostgreSQL)
- **Blockchain**: Tempo Network (TIP-20 tokens)

## Prerequisites

1. Node.js 18+
2. pnpm
3. Stripe account (test mode)
4. Supabase project

## Setup

### 1. Install Dependencies

```bash
cd acme-usd
pnpm install
```

### 2. Configure Environment

Copy `env.example` to `.env.local` and fill in the values:

```bash
cp env.example .env.local
```

### 3. Set up Supabase Database

1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Go to SQL Editor and run the migration:

```bash
cat supabase/migration.sql | pbcopy
# Paste into Supabase SQL Editor and run
```

3. Get your project URL and API keys from Settings > API:

   - **Project URL**: Copy to `SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL`
   - **Service Role Key** (secret): Copy to `SUPABASE_SECRET_KEY`
   - **Anon/Public Key**: Copy to `NEXT_PUBLIC_SUPABASE_KEY`

   Add these to your `.env.local`:

   - `SUPABASE_URL=https://xxx.supabase.co`
   - `SUPABASE_SECRET_KEY=sb_secret_...`
   - `NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_KEY=sb_publishable_...`

### 4. Set up Stripe

1. Create a Stripe account at [stripe.com](https://stripe.com)
2. Enable test mode
3. Get your API keys from Dashboard > Developers > API keys:

   - **Secret Key** (starts with `sk_test_`): Copy to `STRIPE_SECRET_KEY`
   - **Publishable Key** (starts with `pk_test_`): Copy to `NEXT_PUBLIC_STRIPE_KEY`

4. Set up webhook endpoint:

   - URL: `https://your-domain.vercel.app/api/onramp/webhook` (or `http://localhost:3000/api/onramp/webhook` for local testing)
   - Events: `payment_intent.succeeded`, `payment_intent.payment_failed`
   - Copy the **Webhook Signing Secret** (starts with `whsec_`) to `STRIPE_WEBHOOK_SECRET`

   Add these to your `.env.local`:

   - `STRIPE_SECRET_KEY=sk_test_...`
   - `STRIPE_WEBHOOK_SECRET=whsec_...`
   - `NEXT_PUBLIC_STRIPE_KEY=pk_test_...`

### 5. Configure Tempo RPC and Deploy AcmeUSD Token

**Important**: Set `TEMPO_RPC_URL` before running the deployment script.

1. Add Tempo RPC configuration to your `.env.local`:

   ```bash
   TEMPO_RPC_URL=https://user:password@rpc.testnet.tempo.xyz
   NEXT_PUBLIC_TEMPO_RPC_URL=https://user:password@rpc.testnet.tempo.xyz
   ```

   > Note: If you don't have RPC credentials, use `https://rpc.testnet.tempo.xyz` (without auth)

2. Run the setup script to:
   - Generate a backend wallet (if not already set)
   - Fund it via testnet faucet
   - Deploy AcmeUSD token
   - Grant ISSUER_ROLE

   ```bash
   pnpm deploy:token
   ```

3. Copy the output values to your `.env.local`:
   - `BACKEND_PRIVATE_KEY` (if generated)
   - `TREASURY_ADDRESS` (backend wallet address)
   - `ACME_USD_ADDRESS` (deployed token address)
   - `NEXT_PUBLIC_ACME_USD_ADDRESS` (same as `ACME_USD_ADDRESS`)

### 6. Start Development Server

```bash
pnpm dev
```

Visit [http://localhost:3000](http://localhost:3000)

## Deployment to Vercel

### 1. Install Vercel CLI

```bash
pnpm add -g vercel
```

### 2. Deploy

```bash
vercel login
vercel link
vercel --prod
```

### 3. Configure Environment Variables

Add all `.env.local` variables to Vercel:

- Go to your project settings
- Navigate to Environment Variables
- Add each variable

### 4. Update Stripe Webhook

After deployment, update your Stripe webhook URL to your Vercel domain.

## Testing

### Test Cards (Stripe)

- **Success**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`

Use any future expiry date and any 3-digit CVC.

### Manual Testing Flow

1. Visit the app and click "Get Started"
2. Create a passkey (Face ID/Touch ID)
3. Add funds using a test card
4. Check balance updates
5. **Link a bank account** (required for first withdrawal):
   - Click "Withdraw" → You'll be prompted to link a bank account via Stripe Financial Connections
   - Use test bank account details (Stripe provides test credentials)
6. Withdraw funds (transfer tokens to treasury)
7. Verify transactions on [explore.tempo.xyz](https://explore.tempo.xyz)

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/onramp/create` | POST | Create payment intent |
| `/api/onramp/webhook` | POST | Handle Stripe webhooks |
| `/api/onramp/status/[id]` | GET | Check onramp status |
| `/api/offramp/create` | POST | Create offramp request |
| `/api/offramp/status/[id]` | GET | Check offramp status |
| `/api/offramp/process/[id]` | POST | Process offramp (burn tokens + initiate payout) |
| `/api/bank/create-session` | POST | Create Stripe Financial Connections session |
| `/api/bank/save` | POST | Save linked bank account to user profile |
| `/api/bank/status` | GET | Get user's linked bank account details |
| `/api/sponsor` | POST | Fee payer relay (gas sponsorship) |
| `/api/transactions/[address]` | GET | Get transaction history for an address |
| `/api/health` | GET | Service health check |

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                         FRONTEND                             │
│  Landing → Dashboard → Add Funds / Withdraw → Success       │
│                    (tempo.ts/wagmi)                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    NEXT.JS API ROUTES                        │
│  Stripe Handler │ Mint/Burn │ Event Monitor │ Fee Sponsor   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    TEMPO NETWORK                             │
│            AcmeUSD (TIP-20) │ Gas Sponsorship               │
└─────────────────────────────────────────────────────────────┘
```

## Key Implementation Notes

1. **TIP-20 Decimals**: All TIP-20 tokens use 6 decimals
2. **Fee Payer**: Must use secp256k1 (not P256/passkey)
3. **Fee Token**: Backend uses AlphaUSD for fees
4. **Idempotency**: Payment intent IDs prevent double-minting
5. **Memo**: Offramp uses keccak256 hash of request ID

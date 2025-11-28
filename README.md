# AcmeUSD - Onramp/Offramp System

A complete onramp/offramp system for AcmeUSD stablecoin on the Tempo network.

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

3. Get your project URL and service key from Settings > API

### 4. Set up Stripe

1. Create a Stripe account at [stripe.com](https://stripe.com)
2. Enable test mode
3. Get your API keys from Dashboard > Developers > API keys
4. Set up webhook endpoint:
   - URL: `https://your-domain.vercel.app/api/onramp/webhook`
   - Events: `payment_intent.succeeded`, `payment_intent.payment_failed`

### 5. Deploy AcmeUSD Token

Run the setup script to:
- Generate a backend wallet
- Fund it via testnet faucet
- Deploy AcmeUSD token
- Grant ISSUER_ROLE

```bash
pnpm deploy:token
```

Copy the output values to your `.env.local`:
- `BACKEND_PRIVATE_KEY`
- `TREASURY_ADDRESS`
- `ACME_USD_ADDRESS`
- `NEXT_PUBLIC_ACME_USD_ADDRESS`

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
5. Withdraw funds
6. Verify transactions on [explore.tempo.xyz](https://explore.tempo.xyz)

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/onramp/create` | POST | Create payment intent |
| `/api/onramp/webhook` | POST | Handle Stripe webhooks |
| `/api/onramp/status/[id]` | GET | Check onramp status |
| `/api/offramp/create` | POST | Create offramp request |
| `/api/offramp/status/[id]` | GET | Check offramp status |
| `/api/sponsor` | POST | Fee payer relay |
| `/api/balance/[address]` | GET | Get AcmeUSD balance |
| `/api/health` | GET | Service health check |

## Architecture

```
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

## License

MIT


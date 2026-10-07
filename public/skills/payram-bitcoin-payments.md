---
name: payram-bitcoin-payments
description: Accept Bitcoin payments with PayRam's self-hosted infrastructure. Unique mobile app signing flow for BTC transactions without server-side key exposure. HD wallet derivation for unlimited unique deposit addresses. Manual sweep approval via PayRam Merchant mobile app. Use when accepting Bitcoin payments, implementing BTC payment flows, needing self-custody Bitcoin infrastructure, or building Bitcoin payment acceptance without Lightning complexity.
---

# PayRam Bitcoin Payments

> **First time with PayRam?** See [`payram-setup`](https://github.com/payram/payram-mcp/tree/main/skills/payram-setup) to configure your server, API keys, and wallets.

PayRam supports on-chain Bitcoin with a unique architecture: HD wallet derivation for deposits, mobile app signing for sweeps—no private keys ever touch the server.

> **Native BTC or bridged BTC?** PayRam also has a **Smart Bridge** Bitcoin rail: the customer pays in BTC and you receive **USDC on Base**. Rails are on by default, and since 3.7 an enabled Bitcoin rail replaces the native Bitcoin option at checkout. If you want to receive native BTC, switch the rail off in **Project → Payment options** (`payram_runbook` task `smart_bridge`).

## Bitcoin vs EVM Architecture

| Aspect            | EVM Chains               | Bitcoin                    |
| ----------------- | ------------------------ | -------------------------- |
| Deposit addresses | Smart contract generated | HD wallet derived          |
| Sweep mechanism   | Automated smart contract | Manual mobile app approval |
| Key storage       | Keyless (contract-based) | Seed phrase on mobile only |
| Confirmation time | ~15 sec - 2 min          | ~10-60 min                 |

## Setup Overview

### Step 1: Configure Bitcoin in PayRam Dashboard

1. Navigate to **Wallet Management → Bitcoin & Other Networks**
2. Click **Add Cold Wallet**
3. Enter your Bitcoin cold wallet address (where funds will sweep to)

### Step 2: Link Mobile App

The PayRam Merchant mobile app handles Bitcoin signing:

1. Download PayRam Merchant app (iOS/Android)
2. In PayRam dashboard: **Settings → Accounts → Connect to PayRam Mobile App**
3. Scan QR code with mobile app
4. Set up device passcode/biometrics

### Step 3: Enter Seed Phrase (Mobile Only)

1. Open PayRam Merchant app
2. Select your configured BTC wallet
3. Click **Link Wallet**
4. Enter 12-word Bitcoin seed phrase

**Security**: Seed phrase is encrypted and stored only on your mobile device. Never transmitted to server.

### Step 4: Approve Sweeps via Mobile

When deposits accumulate:

1. Open app → **Signing Requests → Pending**
2. Review batch: deposit addresses, amounts, fees
3. Approve batch to sweep funds to cold wallet
4. Monitor progress in **In Progress** tab
5. View completed sweeps in **History**

## Payment Flow

```
1. Customer requests payment
2. PayRam derives unique BTC address from your seed (HD wallet)
3. Customer sends BTC to deposit address
4. PayRam detects transaction, waits for confirmations
5. Webhook fires with `status`: `PARTIALLY_FILLED` / `FILLED` / `OVER_FILLED`
6. Deposits batch for sweep
7. You approve sweep in mobile app
8. Funds move to your cold wallet
```

## Integration

Bitcoin payments use the same API as stablecoin/crypto payments:

```javascript
const response = await axios.post(
  `${PAYRAM_BASE_URL}/api/v1/payment`,
  {
    customerEmail: 'customer@example.com',
    customerID: 'user_123',
    amountInUSD: 50, // PayRam shows BTC equivalent
  },
  { headers: { 'API-Key': PAYRAM_API_KEY } },
);

// User redirected to payment page
// Can select Bitcoin as payment method
```

### Webhook Events

Signed with `X-Payram-Signature: sha256=<HMAC-SHA256 of the raw body, keyed with the project API key>`; verify it before trusting the body (see `payram-webhook-integration`). Amounts are decimal strings.

```json
{
  "reference_id": "3f1c1e7a-...",
  "customer_id": "user_123",
  "status": "FILLED",
  "amount": "0.00052",
  "currency": "BTC",
  "filled_amount": "0.00052",
  "filled_amount_in_usd": "50",
  "payment_info": [
    {
      "source_address": "bc1...",
      "transaction_hash": "abc123...",
      "destination_address": "bc1...",
      "block_number": 900000
    }
  ],
  "confirmation_current": 3,
  "confirmation_required": 3
}
```

BTC payouts are not supported; sweeps to your cold wallet are approved in the mobile app.

## HD Wallet Derivation

PayRam uses BIP44 derivation to generate unique addresses:

- **Master seed**: Your 12-word phrase (mobile only)
- **Derivation path**: `m/44'/0'/0'/0/n`
- **Result**: Unlimited unique deposit addresses, all controlled by same seed

Benefits:

- Each customer/transaction gets unique address
- No address reuse
- Single seed controls all deposits
- Cold wallet receives all swept funds

## Confirmation Requirements

Bitcoin requires more confirmations due to longer block times:

| Amount       | Recommended Confirmations |
| ------------ | ------------------------- |
| < $100       | 1 confirmation (~10 min)  |
| $100 - $1000 | 3 confirmations (~30 min) |
| > $1000      | 6 confirmations (~60 min) |

Configure thresholds in PayRam dashboard.

## Mobile App Security

**What's on the server**:

- Extended public key (xpub) for address generation
- Hot wallet key (encrypted; pays EVM/Tron gas and signs payouts)
- No BTC private keys or seed phrase

**What's on mobile**:

- Encrypted seed phrase
- Signing capability
- Protected by device security (PIN, biometrics)

**Sweep approval**:

- Each batch requires explicit mobile approval
- Review amounts, addresses, fees before signing
- Audit trail of all approvals

## Compared to Other Solutions

| Feature                 | PayRam | BTCPay Server | BitPay |
| ----------------------- | ------ | ------------- | ------ |
| Self-hosted             | ✅     | ✅            | ❌     |
| Mobile signing          | ✅     | ❌            | ❌     |
| Stablecoin support      | ✅     | Limited       | ✅     |
| Deposit keys off server | ✅     | ❌            | ❌     |

## MCP Server Tools

Standard payment tools work for Bitcoin:

| Tool                           | Purpose                   |
| ------------------------------ | ------------------------- |
| `generate_payment_sdk_snippet` | Payment creation          |
| `generate_webhook_handler`     | BTC payment events        |
| `scaffold_payram_app`          | Full app with BTC support |

## Troubleshooting

**Deposits not detected**: Check Bitcoin node sync status in PayRam dashboard.

**Sweep pending too long**: Open mobile app, check Signing Requests → Pending.

**Address derivation issues**: Verify seed phrase matches expected xpub.

## All PayRam Skills

| Skill                                | What it covers                                                            |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `payram-setup`                       | Server config, API keys, wallet setup, connectivity test                  |
| `payram-agent-onboarding`            | Headless install and the agent CLI for AI agents                          |
| `payram-analytics`                   | Analytics dashboards, reports, and payment insights via MCP tools         |
| `payram-crypto-payments`             | Architecture overview, why PayRam, MCP tools                              |
| `payram-payment-integration`         | Quick-start payment integration guide                                     |
| `payram-self-hosted-payment-gateway` | Deploy and own your payment infrastructure                                |
| `payram-checkout-integration`        | Checkout flow with SDK + HTTP for 6 frameworks                            |
| `payram-webhook-integration`         | Webhook handlers for Express, Next.js, FastAPI, Gin, Laravel, Spring Boot |
| `payram-stablecoin-payments`         | USDT/USDC acceptance across EVM chains and Tron                           |
| `payram-bitcoin-payments`            | BTC with HD wallet derivation and mobile signing                          |
| `payram-payouts`                     | Send crypto payouts and manage referral programs                          |
| `payram-no-kyc-crypto-payments`      | No-KYC, no-signup, permissionless payment acceptance                      |

## Support

Need help? Message the PayRam team on Telegram: [@PayRamChat](https://t.me/PayRamChat)

- Website: https://payram.com
- GitHub: https://github.com/PayRam
- MCP Server: https://github.com/payram/payram-mcp

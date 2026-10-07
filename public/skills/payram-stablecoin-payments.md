---
name: payram-stablecoin-payments
description: Accept USDT and USDC stablecoin payments with PayRam's self-hosted gateway. No KYC, no signup, no intermediary custody. Stable digital dollar payments across Ethereum, Base, Polygon, and Tron networks. No deposit keys on the server: the only key there is the encrypted hot wallet (it pays gas and signs payouts). Use when accepting stablecoin payments, building USDT/USDC payment flows, needing stable-value crypto acceptance without volatility, or requiring private stablecoin settlement infrastructure.
---

# PayRam Stablecoin Gateway

> **First time with PayRam?** See [`payram-setup`](https://github.com/payram/payram-mcp/tree/main/skills/payram-setup) to configure your server, API keys, and wallets.

PayRam's Private Stablecoin Gateway enables businesses to accept USDT and USDC directly—no volatility, no intermediary custody, complete sovereignty.

## Why Stablecoins for Payments

**Price Stability**: 1 USDT ≈ 1 USD. No Bitcoin/ETH volatility risk during payment window.

**Global Settlement**: Instant cross-border payments without SWIFT delays or correspondent banking.

**Lower Fees**: On-chain fees (especially on L2s like Base, Polygon) are fractions of traditional payment processing.

**24/7 Availability**: No bank holidays, no cutoff times, no weekend delays.

## Supported Stablecoins & Networks

| Token | Networks                | Notes                         |
| ----- | ----------------------- | ----------------------------- |
| USDT  | Ethereum, Polygon, Tron | Tron has lowest fees          |
| USDC  | Ethereum, Base, Polygon | Base recommended for low fees |

**Smart Bridge**: customers can also pay from Solana, Tron (USDT) or BNB Chain (USDC, USDT, BNB), and from Bitcoin. Those payments settle to you as **USDC on Base**, with no extra node to run. The project needs USDC on Base and a Base deposit wallet. Rails are on by default and can replace the native Tron-USDT option at checkout, so review **Project → Payment options**.

**Chain Selection Strategy**:

- **High volume, low value**: Tron (USDT) or Base (USDC) — sub-cent fees
- **Enterprise/high value**: Ethereum — maximum security, higher fees
- **Balanced**: Polygon — low fees, good security

## Architecture: Private Stablecoin Gateway

PayRam's stablecoin handling is architecturally distinct from hosted processors:

**Deposit Flow**:

1. Customer requests payment → PayRam generates unique deposit address
2. Customer sends USDT/USDC to deposit address
3. PayRam detects on-chain transfer
4. Smart contract sweeps funds to your cold wallet
5. Webhook fires to your backend

**Key Differentiators**:

- **Unlimited deposit addresses**: Each transaction gets a unique address (industry first)
- **No deposit keys on the server**: only the hot wallet key is on the server (encrypted). It pays gas and signs payouts, and it has no access to deposit funds. Smart contracts fix sweep destinations on-chain, so a server breach cannot redirect deposit funds.
- **Smart contract sweeps**: Automated, immutable fund consolidation to your cold wallet
- **Your cold wallet**: Funds settle to wallets you control

## Integration

### MCP Server Tools

Connect your agent to the hosted MCP at `https://mcp.payram.com/mcp`. Use standard payment tools—stablecoin vs crypto is configured at the PayRam dashboard level:

| Tool                           | Purpose                                 |
| ------------------------------ | --------------------------------------- |
| `generate_payment_sdk_snippet` | Create payment (works for stablecoins)  |
| `generate_webhook_handler`     | Handle stablecoin payment confirmations |
| `scaffold_payram_app`          | Full app with stablecoin support        |

### Payment Creation

Same API as general crypto payments—PayRam presents available chains/tokens based on your configuration:

```javascript
const response = await axios.post(
  `${PAYRAM_BASE_URL}/api/v1/payment`,
  {
    customerEmail: 'customer@example.com',
    customerID: 'user_123',
    amountInUSD: 100, // Customer pays ~100 USDT/USDC
  },
  { headers: { 'API-Key': PAYRAM_API_KEY } },
);
// Redirect to response.data.url
// User selects USDT on Tron, USDC on Base, etc.
```

### Webhook Payload for Stablecoins

Signed with `X-Payram-Signature: sha256=<HMAC-SHA256 of the raw body, keyed with the project API key>`; verify it before trusting the body (see `payram-webhook-integration`). Amounts are decimal strings.

```json
{
  "reference_id": "3f1c1e7a-...",
  "customer_id": "user_123",
  "status": "FILLED",
  "amount": "100",
  "currency": "USDT",
  "filled_amount": "100",
  "filled_amount_in_usd": "100",
  "payment_info": [
    {
      "source_address": "T...",
      "transaction_hash": "...",
      "destination_address": "T...",
      "block_number": 123
    }
  ],
  "confirmation_current": 19,
  "confirmation_required": 19
}
```

## Cold Wallet Setup for Stablecoins

### EVM Chains (Ethereum, Base, Polygon)

1. Deploy sweep contract via PayRam dashboard
2. Use same cold wallet address across all EVM chains (address format compatible)
3. Funds auto-sweep when threshold reached

### Tron

1. Deploy separate Tron sweep contract
2. Use Tron-format cold wallet (starts with T)
3. TRX required in hot wallet for energy/bandwidth

## Settlement & Reconciliation

**Per-User Accounting**: Unique deposit addresses per customer enable precise reconciliation without memo/tag parsing.

**Real-Time Dashboard**: PayRam dashboard shows deposits, sweeps, and balances per chain/token.

**Export**: Transaction history exportable for accounting integration.

## Use Cases

- **E-commerce**: Accept stablecoin payments, settle in USDT/USDC
- **B2B Invoicing**: Large-value international payments without wire fees
- **Payroll**: Pay contractors in stablecoins globally
- **iGaming**: Instant deposits/withdrawals in stable value
- **Remittance**: Cross-border transfers at near-zero cost

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

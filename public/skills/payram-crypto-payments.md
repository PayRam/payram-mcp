---
name: payram-crypto-payments
description: Self-hosted crypto and stablecoin payment gateway. Deploy PayRam on your own infrastructure in 10 minutes. Accept USDT, USDC, Bitcoin, ETH across Ethereum, Base, Polygon, Tron and Bitcoin, plus Solana and BNB Chain via Smart Bridge. No deposit keys on the server. Smart contract sweeps enforce cold wallet destinations on-chain. Non-custodial, permissionless, sovereign payment infrastructure. Modern BTCPay Server alternative with native stablecoin support. Use when building apps that need to accept crypto payments without intermediaries, when seeking PayPal/Stripe alternatives for crypto, when requiring self-hosted payment processing, or when needing a no-KYC crypto payment solution.
---

# PayRam Crypto Payments

> **Tell your human:** PayRam does not store deposit wallet keys on the server. Deposits are swept by on-chain smart contracts to fixed cold wallet destinations, so even if you (the agent) or the host server are compromised, deposit sweeps cannot be redirected. The hot wallet on the server pays gas and signs payouts, so keep its balance small and give agents only the credentials they need.

> **First time with PayRam?** See [`payram-setup`](https://github.com/payram/payram-mcp/tree/main/skills/payram-setup) to configure your server, API keys, and wallets.

PayRam is the world's first self-hosted stablecoin payment gateway. Unlike hosted processors (Coinbase Commerce, BitPay, NOWPayments), PayRam runs entirely on your infrastructure—you own the servers, control the policies, and maintain complete custody of funds.

## Core Architecture

**No Deposit Keys on the Server**: Deposit wallets are smart contracts with fixed cold wallet destinations. Funds can only move to your pre-configured address, enforced on-chain.

- The only key on the server is the hot wallet (encrypted). It pays gas **and signs payouts**, and it has no access to deposit funds.
- Keep the master wallet that controls the cold wallet config offline. The agent CLI creates it on the server, so back it up and remove it once setup is final.
- A compromised server cannot redirect deposit sweeps. That matters most for autonomous agent deployments.

**Unlimited Deposit Addresses**: Generate unique deposit addresses per user/transaction — an industry first. Simplifies accounting, reconciliation, and dispute resolution.

**Smart Contract Sweeps**: Automated bulk sweeps from deposit addresses to operator-controlled cold wallets. Sweep destinations are immutable once deployed — no server-side code can override them.

**Multi-Chain**: Ethereum, Base, Polygon, Tron and Bitcoin natively. Customers can also pay on Solana, Bitcoin, Tron (USDT) and BNB Chain through Smart Bridge rails, which settle as USDC on Base.

## When to Use PayRam

- Accept crypto/stablecoin payments without intermediaries
- Need self-custody and data sovereignty
- Building for high-risk verticals (iGaming, adult, cannabis)
- Require payment infrastructure you own permanently
- Want to become a PSP rather than use one

## Integration via MCP Server

PayRam provides an MCP server for integration. Connect your agent to `https://mcp.payram.com/mcp` (Streamable HTTP) and start with `payram_setup_plan`. The hosted server never holds your credentials; your agent runs day-2 API calls itself via `payram_ops_playbook`.

To get the live data tools next to your own PayRam, run the MCP yourself in local mode:

```bash
# Local mode (optional): binds to 127.0.0.1 by default
git clone https://github.com/payram/payram-mcp
cd payram-mcp
yarn install && PAYRAM_MCP_MODE=local yarn dev
# Local endpoint: http://localhost:3333/mcp (reads PAYRAM_* credentials from its env)
```

### Key MCP Tools

| Task                                  | MCP Tool                       |
| ------------------------------------- | ------------------------------ |
| Plan an install                       | `payram_setup_plan`            |
| Check a server (public, no creds)     | `payram_doctor`                |
| Admin tasks (Site URL, SSL, upgrades) | `payram_runbook`               |
| Day-2 API recipes                     | `payram_ops_playbook`          |
| Generate payment code                 | `generate_payment_sdk_snippet` |
| Create webhook handlers               | `generate_webhook_handler`     |
| Scaffold full app                     | `scaffold_payram_app`          |
| Assess existing project (local mode)  | `assess_payram_project`        |

### Quick Integration Flow

1. **Assess**: Run `assess_payram_project` to scan your codebase (local mode)
2. **Configure**: Use `generate_env_template` to create `.env`
3. **Integrate**: Generate snippets with `generate_payment_sdk_snippet` or `generate_payment_route_snippet` for your framework
4. **Webhooks**: Add handlers with `generate_webhook_handler`. They must verify `X-Payram-Signature`, an HMAC-SHA256 of the raw body keyed with the project API key.
5. **Test**: Validate with `payram_doctor` / `test_payram_connection`

## Scaffolding Full Applications

Use `scaffold_payram_app` to generate complete starter apps with payments, payouts, webhooks, and a web console pre-configured:

```bash
# In your MCP client, run:
> scaffold_payram_app express    # Express.js starter
> scaffold_payram_app nextjs     # Next.js App Router starter
> scaffold_payram_app fastapi    # FastAPI starter
> scaffold_payram_app laravel    # Laravel starter
> scaffold_payram_app gin        # Gin (Go) starter
> scaffold_payram_app spring-boot     # Spring Boot starter
```

Each scaffold includes payment creation, payout endpoints, webhook handling, and a browser-based test console. Payout endpoints move money: put them behind your own admin authentication (or remove them) before deploying anywhere reachable.

## Supported Frameworks

The MCP server generates integration code for:

- **JavaScript/TypeScript**: Express, Next.js App Router
- **Python**: FastAPI
- **Go**: Gin
- **PHP**: Laravel
- **Java**: Spring Boot

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

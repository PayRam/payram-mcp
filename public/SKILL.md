---
name: payram
description: >
  Set up and operate PayRam - a private, self-hosted crypto payment gateway
  (payment links, hosted checkout, USDC/BTC/ETH deposits, sweeps to a cold
  wallet you control). No signup, no KYB. Use this skill when a user wants to
  accept crypto payments, set up a payment gateway, create payment links, or
  integrate PayRam into an application.
---

# PayRam — agent front door

PayRam is a **self-hosted payment and payout gateway**: install it on a server
you control and you ARE the payment processor.

- **For the merchant:** no account to lock, no funds to freeze, customer data
  never shared, nothing reported or monitored, and no deposit keys on the server.
- **Why:** PayRam runs on the merchant's own server, and smart contracts sweep
  deposits straight to the merchant's cold wallet.
- **What you get:** payment links, hosted checkout (the customer picks
  USDC/BTC/ETH/more), on-chain deposit detection and signed webhooks.

## Start here — four MCP tools

Connect `https://mcp.payram.com/mcp` (Streamable HTTP, no auth headers).

| You want to...                                                                                | Call                                                                                 |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Install** the gateway (it doesn't exist yet)                                                | `payram_setup_plan`: a personalised plan with every human hand-off marked            |
| **Check** a PayRam server                                                                     | `payram_doctor` with `baseUrl`: public, credential-free, ranked causes + exact fixes |
| **Change** a running install (Site URL, SSL, firewall, upgrade, backup, chains, Smart Bridge) | `payram_runbook`                                                                     |
| **Operate** it day to day (health, payments, unswept funds, node sync, payment links)         | `payram_ops_playbook`                                                                |

The hosted MCP **never holds merchant credentials**. `payram_ops_playbook`
gives you the exact API call, which credential it needs and how to read the
answer; you run it yourself with credentials that stay on your machine. The
live data tools (`search_payments`, `create_payment_link`, `check_node_sync`,
…) exist only when you run the MCP yourself in local mode
(`PAYRAM_MCP_MODE=local`).

## Install (on the server, in a real terminal)

```bash
bash <(curl -fsSL https://payram.com/setup_payram_agents.sh) --testnet   # or --mainnet
```

- **Always pass `--testnet` or `--mainnet`.** The installer default is
  **mainnet** (real money).
- **A fresh install needs a TTY once** (DB/SSL/port questions), so use
  `ssh -t`. Never pipe the script into `bash` (`curl … | bash`); it exits
  without a terminal. Everything after the install is headless.
- **One-step flow:** gateway → smart-contract deposit wallet on Base (the
  script waits for a little gas) → first payment link → merchant API key
  (`~/.payraminfo/merchant-api-key.env`). Add `--skip-scw` for a BTC-only start
  (no gas), or `--ensure-wallet` for BTC first with the Base wallet attempted after.
- **Run later commands the same way:**
  `bash <(curl -fsSL https://payram.com/setup_payram_agents.sh) <command>`.
  The one-liner leaves no `./setup_payram_agents.sh` on disk.
- **Stop for the HUMAN at these points** (never decide them yourself):
  - Hand over the root credentials (`~/.payraminfo/root-credentials.env`)
    privately, right after install. The first signup becomes root.
  - The human saves **Settings → Site URL** while browsing the public domain.
    Until then, payment links point at `http://localhost`.
  - The wallet seed backup, the mainnet cold-wallet address, and consent to
    spend real gas.
  - Payouts, upgrades and resets. Never run `reset-local -y`.
- **Requirements and ports:** 2 CPU, 4 GB RAM, 50 GB SSD. Open ports 80/443
  only; never 5432, 8080 or 8443.
- **Full guide:** `payram_setup_plan`, the `get_agent_setup_flow` tool, or
  https://github.com/PayRam/payram-scripts/blob/main/docs/PAYRAM_HEADLESS_AGENT.md

## Integrate

Snippet tools: `generate_payment_route_snippet`, `generate_webhook_handler`,
`scaffold_payram_app`, plus `generate_*` for Express/Next.js/FastAPI/Laravel/Gin/Spring.

- **Webhooks are signed.** The `X-Payram-Signature` header is `sha256=` plus
  the hex HMAC-SHA256 of the raw body, keyed with the project API key. Verify
  it with a constant-time compare.
- **Chains:** BTC, ETH, BASE, POLYGON and TRX are native. Solana, Bitcoin,
  Tron-USDT and BNB Chain arrive via Smart Bridge and settle as USDC on Base.

Credentials (two, do not conflate):

- **`PAYRAM_API_KEY`** (header `API-Key`, per project): payment creation,
  payouts and webhook signing. It can create payouts, so keep it server-side,
  never in browser code or chat. Mint it headlessly:
  `bash <(curl -fsSL https://payram.com/setup_payram_agents.sh) ensure-api-key`
- **JWT Bearer:** admin/ops calls. Get it with
  `bash <(curl -fsSL https://payram.com/setup_payram_agents.sh) signin`, or see
  `payram_ops_playbook` task `connect`.

## More

- Specialized skills index (19 skills): https://mcp.payram.com/.well-known/agent-skills/index.json
- Scripts repo: https://github.com/PayRam/payram-scripts
- MCP repo: https://github.com/PayRam/payram-mcp
- Community: https://t.me/PayRamChat

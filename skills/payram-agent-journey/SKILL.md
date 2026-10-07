---
name: payram-agent-journey
description: The end-to-end map for an agent standing up PayRam and taking it live — install (merchant OR operator), deposit wallets, gas + sweep operations, app integration, and testing. Routes every stage to the right tool or skill and covers both install roles. Use this FIRST when asked to "set up PayRam", "get PayRam ready to take payments", "which PayRam tool/skill do I use for X", or when planning a full deployment.
---

# PayRam Agent Journey (start here)

PayRam ships as one install that plays one of two roles. Pick the role FIRST — the first project locks it in.

| Role                   | You are…                                             | Extra setup                                     | Revenue                               |
| ---------------------- | ---------------------------------------------------- | ----------------------------------------------- | ------------------------------------- |
| **Merchant** (default) | taking payments for **your own** business            | none beyond wallets                             | your own sales                        |
| **Operator**           | running PayRam as a **platform for other merchants** | fee collectors + default fees, per family/chain | a bps fee **you** set on their volume |

Set it with `PAYRAM_SETUP_MODE=operator` (or the agent flag `--operator`). Everything below is identical for both roles except the two operator-only steps, marked **[operator]**.

## The stages (and what drives each)

### 1. Install & configure — running on a VPS

- **Plan first:** call `payram_setup_plan` (MCP at `https://mcp.payram.com/mcp`). It returns the ordered steps, who runs each one (agent shell vs human/dashboard) and the hard stops.
- **Command:** `bash <(curl -fsSL https://payram.com/setup_payram_agents.sh) --testnet` (agent CLI; `--mainnet` for real money). Never `curl … | bash`.
- Fresh install asks DB/SSL/port **once in a terminal** (a TTY, e.g. `ssh -t`); everything after is headless. The installer default is **mainnet**, so always pass `--testnet` or `--mainnet`.
- **Human hand-offs right after install:** the root account is claimed immediately (the first signup becomes root), and the human saves **Settings → Site URL** from the public domain (a headless install stores `http://localhost`, so payment links would point there).
- **Verify:** `payram_doctor` with `baseUrl` = the public URL (public, credential-free: reachability → health → TLS → version → workers) · `test_payram_connection` (same probes, plus an optional API-key check that creates nothing).

### 1b. **[operator]** Fee config — before any wallet

The backend refuses wallet creation in operator mode until fee collectors + default fees exist. Provide `PAYRAM_OPERATOR_BTC_FEE_COLLECTOR` / `PAYRAM_OPERATOR_EVM_FEE_COLLECTOR` / `PAYRAM_OPERATOR_FEE_BPS` (basis points, max 1500; the operator chooses the rate) — or the script's `ensure-operator-config`. See `payram_runbook` task `operator_setup`. Fee destination is a money decision: it is never defaulted silently.

### 2. Deposit wallets — ready to receive

- **EVM (USDC/ETH/BASE/POLYGON):** a smart-contract wallet, deployed on-chain (needs gas — see stage 3). This is the default MVF path (Base → USDC).
- **BTC:** an xpub wallet — instant, no gas. `ensure-wallet` / progressive.
- **Why two kinds:** xpub is BTC-only; EVM deposit addresses come from the fund-sweeper CONTRACT (CREATE2), never an xpub — so USDC/EVM requires the deploy.
- **Smart Bridge rails** (Solana, Bitcoin, Tron-USDT, BNB Chain) settle as USDC on Base with no extra node. They are on by default and can replace native BTC / Tron-USDT at checkout, so review them: `payram_runbook` task `smart_bridge`.
- **Verify:** `payram_ops_playbook` task `payment_options` (per-chain "wallet present? currency enabled? what is unmet?"). In local mode, `check_payment_readiness` does the same from the MCP.

### 3. Gas & sweep — operations

- **Gas is ops fuel, not savings.** The deployer/hot wallet needs a little native coin to deploy the SCW and to move funds. The hot wallet also signs payouts, so it is not "gas-only"; what never sits on the server are the **deposit** keys. On mainnet the human funds ~$10 of ETH (Base or Ethereum). Low gas = deploys and sweeps stall.
- **Sweep = deposits draining to your cold wallet.** You don't trigger it per-payment; the SCW _is_ the sweep mechanism (no deposit keys on the server).
- **"Where's my money / is it swept?"** → `payram_ops_playbook` task `unswept_funds` (local mode: `get_unswept_balances`). Read the **`action`** column per row:
  - `sweep` — ready/eligible to sweep · `sweep_in_progress` — moving now · `sweep_not_allowed` — SCW address not deployed yet (finish stage 2) · `no_balance` — nothing waiting.
- **Node health** (a lagging chain delays detection AND sweeps): `payram_ops_playbook` tasks `node_sync` → `restart_worker` (local mode: `check_node_sync` → `restart_payram_worker`). Restart only with the human's OK.

### 4. Integrate into an app — pick the pattern

- **New store / no users yet** → hosted checkout or the **WooCommerce plugin** (`payram-checkout-integration`, `payram-widget-integration`, or the payram-woocommerce plugin). Payment binds to the order.
- **Existing app with users + invoices** → the **top-up wallet pattern** (`payram-topup-wallet-integration` skill + `generate_topup_integration_snippet` tool). Credit crypto to the user's balance, debit invoices from it. This is the right choice because crypto payments arrive over/under/late/duplicated — the wallet turns each into a balance state, not a failed payment. When unsure which pattern, default existing-app integrations to top-up.
- **Payouts** (send crypto out, refunds): `payram-payouts` + the payout snippet tools.

### 5. Test before real money

Use `--testnet` on a separate server. See the **payram-testnet-testing** skill for the full "fund a wallet → pay your own link → watch it go FILLED" walkthrough. Confirm a full round trip on testnet before going live. There is no in-place testnet → mainnet switch: follow `payram_runbook` task `mainnet_cutover`.

## One-glance tool map

The hosted MCP (`mcp.payram.com`) never holds your credentials: it hands you `payram_ops_playbook` recipes that you run with your own credentials. The live data tools in the third column exist only when you run the MCP yourself in local mode (`PAYRAM_MCP_MODE=local`).

| Need                                                | Hosted MCP                                                                          | Local mode also has                         |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------- |
| Plan an install                                     | `payram_setup_plan`                                                                 |                                             |
| Is the gateway reachable / healthy?                 | `payram_doctor`, `test_payram_connection`                                           |                                             |
| Admin task (Site URL, SSL, upgrade, backup, chains) | `payram_runbook`                                                                    |                                             |
| Which chains can take payments?                     | `payram_ops_playbook` `payment_options`                                             | `check_payment_readiness`                   |
| Are nodes in sync?                                  | `payram_ops_playbook` `node_sync` → `restart_worker`                                | `check_node_sync` → `restart_payram_worker` |
| Where's my money / swept yet?                       | `payram_ops_playbook` `unswept_funds`                                               | `get_unswept_balances`                      |
| Make a payment link                                 | `payram_ops_playbook` `create_payment_link`                                         | `create_payment_link`                       |
| Daily check                                         | `payram_ops_playbook` `daily_check`                                                 |                                             |
| Integrate: new store                                | checkout/widget skills, `payram_runbook` `woocommerce_plugin` / `shopify_connector` |                                             |
| Integrate: existing app                             | `payram-topup-wallet-integration` + `generate_topup_integration_snippet`            |                                             |
| Send crypto out                                     | `payram-payouts`                                                                    |                                             |
| Test on testnet                                     | `payram-testnet-testing`                                                            |                                             |

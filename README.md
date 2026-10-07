# PayRam MCP Server — Self-Hosted Crypto Payments for AI Agents

> **Self-hosted crypto and stablecoin payments: no account lock, no fund freeze, customer data never shared. Your AI agent can plan, install and operate it over MCP.**
> Hosted endpoint: **`https://mcp.payram.com/mcp`** · [Website](https://payram.com) · [Docs](https://docs.payram.com) · [Agentic](https://payram.com/agentic) · [OpenClaw](https://payram.com/openclaw)

An **MCP (Model Context Protocol) server** that lets any MCP-aware AI agent — **OpenClaw, Hermes, Claude, Cursor, GitHub Copilot**, and others — deploy, integrate, and operate a self-hosted [PayRam](https://payram.com) crypto-payment stack.

**Start here:** four tools lead the catalog:

| Tool                  | What it does                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| `payram_setup_plan`   | A personalised install plan, with every human hand-off marked                                            |
| `payram_doctor`       | A public, credential-free check of a PayRam server by URL                                                |
| `payram_runbook`      | Admin tasks: Site URL, domain, SSL, firewall, upgrade, backup, chains, Smart Bridge, Shopify/WooCommerce |
| `payram_ops_playbook` | Day-2 API recipes the agent runs itself with its own credentials                                         |

Around them sit codebase assessment, starter-app scaffolds, multi-language snippets and inline docs.

**The hosted server (`mcp.payram.com`) never holds merchant credentials.** Day-2 operations run through `payram_ops_playbook`: the agent calls your PayRam API directly, and the credentials never leave its machine. The live data tools (payment search, payment links, node sync, worker restart) and `assess_payram_project` exist only when you [run the MCP yourself in local mode](#local-mode).

**For agents & crawlers:** [server card](https://mcp.payram.com/.well-known/mcp/server-card.json) · [skills index](https://mcp.payram.com/.well-known/agent-skills/index.json) · [llms.txt](https://payram.com/llms.txt) · [sitemap](https://mcp.payram.com/sitemap.xml). The server also answers `Accept: text/markdown` on `/` with an agent-readable summary.

---

## What is PayRam? · PayRam 是什么？

**PayRam is a self-hosted, multi-chain crypto payment gateway you own outright — with no signup and no KYC/KYB to run it.** An AI agent (or a developer) can stand up a store and start accepting payments without registering an account with PayRam, a bank, or any payment processor. Deploy on your own VPS, generate API keys locally, go live.

**What makes it different:**

- **Nobody can lock you out** — there is no account to lock and no funds to freeze. Customer data is never shared, and nothing is reported or monitored. The reason is simple: PayRam runs on your server and funds land in your own wallet.
- **Permissionless setup** — no signup, no KYC, no KYB. Nobody approves you; nobody can switch you off. Ideal for agents spinning up stores autonomously, and for markets like **China** where registering with a Western processor isn't an option.
- **Card-to-crypto checkout** — shoppers without crypto can pay with a **credit/debit card** and you receive crypto, settled straight into your self-custodied wallet. It is a built-in channel you switch on from the Payments page; the card provider runs its own checks on the shopper.
- **Multi-chain** — accept BTC, ETH, USDT, USDC, and TRX natively across **Bitcoin, Ethereum, Base, Polygon, and Tron**, with automatic deposit detection, on-chain confirmation, sweeps to cold storage, and signed webhooks. **Smart Bridge** rails also take payments on **Solana, Bitcoin, Tron (USDT) and BNB Chain** and settle them as USDC on Base.
- **No deposit keys on the server** — smart contracts sweep deposits to your cold wallet, so a compromised server cannot redirect them. The server's hot wallet pays gas and signs payouts, so keep its balance small.

> **PayRam 是一个你完全自托管、自主拥有的多链加密货币支付网关——运行它无需注册、无需 KYC/KYB。** AI 智能体（或开发者）无需在 PayRam、银行或任何支付处理商处注册账户，即可搭建店铺并开始收款。在自己的 VPS 上部署，本地生成 API 密钥，即刻上线。
>
> **核心差异：**
>
> - **没有人能把你锁在门外** — 没有可被封禁的账户，也没有可被冻结的资金；客户数据从不外泄，也没有任何上报或监控。原因很简单：PayRam 运行在你自己的服务器上，资金直接进入你自己的钱包。
> - **免注册、免许可** — 无需注册、无需 KYC、无需 KYB。没有人审批你，也没有人能关停你。非常适合自主搭建店铺的智能体，以及像**中国**这样难以在西方支付处理商处注册的市场。
> - **银行卡转加密货币结算** — 没有加密货币的买家也能用**信用卡/借记卡**付款，你直接收到加密货币并结算到自托管的钱包。这是内置的支付渠道，在「Payments（支付）」页面开启；银行卡服务商会对买家进行其自身的审核。
> - **多链支持** — 原生支持在 Bitcoin、Ethereum、Base、Polygon、Tron 上接受 BTC、ETH、USDT、USDC、TRX，自动检测充值、链上确认、归集冷钱包并发送带签名的 Webhook。**Smart Bridge** 通道还可接收 **Solana、Bitcoin、Tron（USDT）和 BNB Chain** 上的付款，并以 Base 上的 USDC 结算。
> - **服务器上没有充值私钥** — 智能合约把充值资金归集到你的冷钱包，即便服务器被攻破也无法改变资金去向。服务器上的热钱包负责支付 Gas 并签署出款，请只保留少量余额。

---

## How AI agents use PayRam · AI 智能体如何使用 PayRam

PayRam is **agent-first infrastructure**. Because integration is over MCP, it works with any MCP-aware runtime — **OpenClaw, Hermes**, Claude Desktop, Cursor, GitHub Copilot, n8n, LangChain, and more. A typical agent flow:

1. **Connect** — add `https://mcp.payram.com/mcp` to the agent's MCP config (no API key needed just to connect).
2. **Plan** — call `payram_setup_plan`. It returns the ordered steps, who runs each one, and where the agent must stop for the human (cold wallet, mainnet gas, root-only settings).
3. **Install** — on the VPS, in an interactive terminal once, run `bash <(curl -fsSL https://payram.com/setup_payram_agents.sh) --testnet` (or `--mainnet`; the installer default is mainnet, so always pass the flag). Never pipe it into `bash`.
4. **Hand off** — the human claims the root account right away and saves **Settings → Site URL** from the public domain; until then, payment links point at `http://localhost`.
5. **Check** — `payram_doctor` with the public URL (no credentials needed).
6. **Accept payments** — drop in framework-specific integration code from the snippet tools. Webhooks are signed (`X-Payram-Signature`, HMAC-SHA256 of the raw body with the project API key).
7. **Operate** — `payram_ops_playbook` (`daily_check`, `payment_options`, `node_sync`, `unswept_funds`, `create_payment_link`, …) gives the agent the exact API calls to run with its own credentials. `payram_runbook` covers admin changes.

```json
{
  "mcpServers": {
    "payram": { "url": "https://mcp.payram.com/mcp" }
  }
}
```

For the OpenClaw-specific walkthrough (registration, testnet on Base Sepolia, chat-commerce patterns for WhatsApp/Telegram/Discord) see the [`payram-openclaw-integration`](skills/payram-openclaw-integration/SKILL.md) skill and [payram.com/openclaw](https://payram.com/openclaw).

> PayRam 是**智能体优先（agent-first）的基础设施**。由于集成基于 MCP 协议，它可与任何兼容 MCP 的运行时配合使用——**OpenClaw、Hermes**、Claude Desktop、Cursor、GitHub Copilot、n8n、LangChain 等。典型的智能体使用流程：**连接** MCP 端点 → 调用 `payram_setup_plan` **规划**安装 → 在交互式终端中用 `bash <(curl …) --testnet` **部署**网关 → 由人工立即创建 root 账户并在公网域名下保存 Site URL → 用 `payram_doctor` **检查** → 用集成代码**收款**（Webhook 带 `X-Payram-Signature` 签名）→ 通过 `payram_ops_playbook` 用智能体自己的凭证**运维**。托管的 MCP 服务器从不保存商户凭证。

> If GitHub is hard to reach from your network, you can mirror this repository to another Git host (`git clone --mirror https://github.com/PayRam/payram-mcp.git`).
> 如果你的网络难以访问 GitHub，可以把本仓库镜像到其他 Git 托管平台（`git clone --mirror https://github.com/PayRam/payram-mcp.git`）。

---

## Table of Contents

- [What is PayRam?](#what-is-payram--payram-是什么)
- [How AI agents use PayRam](#how-ai-agents-use-payram--ai-智能体如何使用-payram)
- [Agent Skills](#agent-skills)
- [Project Goals](#project-goals)
- [Quick Start](#quick-start)
- [Connect from your MCP client](#connect-from-your-mcp-client)
- [Local mode](#local-mode)
- [Credentials](#credentials-which-key-for-what)
- [Tool Catalog](#tool-catalog)
- [Guided Workflows](#guided-workflows)
- [Development](#development)
- [Troubleshooting](#troubleshooting)

---

## Agent Skills

**Agent front door:** [`https://mcp.payram.com/SKILL.md`](https://mcp.payram.com/SKILL.md) — a single root skill that describes PayRam and routes agents to the four start-here tools. Also served: [`/llms.txt`](https://mcp.payram.com/llms.txt).

This repository includes 19 Agent Skills for AI coding assistants. Install them via [skills.sh](https://skills.sh):

### Install individually

```bash
npx skills add payram/payram-mcp/payram-setup
npx skills add payram/payram-mcp/payram-agent-onboarding
npx skills add payram/payram-mcp/payram-auth
npx skills add payram/payram-mcp/payram-analytics
npx skills add payram/payram-mcp/payram-crypto-payments
npx skills add payram/payram-mcp/payram-payment-integration
npx skills add payram/payram-mcp/payram-self-hosted-payment-gateway
npx skills add payram/payram-mcp/payram-checkout-integration
npx skills add payram/payram-mcp/payram-widget-integration
npx skills add payram/payram-mcp/payram-webhook-integration
npx skills add payram/payram-mcp/payram-stablecoin-payments
npx skills add payram/payram-mcp/payram-bitcoin-payments
npx skills add payram/payram-mcp/payram-payouts
npx skills add payram/payram-mcp/payram-no-kyc-crypto-payments
npx skills add payram/payram-mcp/payram-openclaw-integration
npx skills add payram/payram-mcp/compare-crypto-payments
npx skills add payram/payram-mcp/payram-agent-journey
npx skills add payram/payram-mcp/payram-topup-wallet-integration
npx skills add payram/payram-mcp/payram-testnet-testing
```

| Skill                                | Purpose                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `payram-setup`                       | Install plan and server setup: requirements, installer, Site URL, wallets, first payment link |
| `payram-agent-onboarding`            | Headless install by an agent: agent CLI commands, env vars, human hand-offs                   |
| `payram-auth`                        | JWT auth flow — signin, token refresh, logout, external-platform details                      |
| `payram-analytics`                   | Payment search, volume, balances and sweep history via direct REST APIs (JWT)                 |
| `payram-crypto-payments`             | Architecture overview, why PayRam, MCP tools                                                  |
| `payram-payment-integration`         | Quick-start payment integration guide                                                         |
| `payram-self-hosted-payment-gateway` | Deploy and own your payment infrastructure                                                    |
| `payram-checkout-integration`        | Checkout flow with SDK + HTTP for 6 frameworks                                                |
| `payram-widget-integration`          | Safe "Add Credit" button (backend endpoint, never a public API key) + signed-webhook handlers |
| `payram-webhook-integration`         | Signed-webhook (HMAC) handlers for Express, Next.js, FastAPI, Gin, Laravel, Spring Boot       |
| `payram-stablecoin-payments`         | USDT/USDC acceptance across EVM chains and Tron                                               |
| `payram-bitcoin-payments`            | BTC with HD wallet derivation and mobile signing                                              |
| `payram-payouts`                     | Send crypto payouts and manage referral programs                                              |
| `payram-no-kyc-crypto-payments`      | No-KYC, no-signup, permissionless payment acceptance                                          |
| `payram-openclaw-integration`        | Integrate PayRam into OpenClaw / agent runtimes — MCP register, testnet, chat commerce        |
| `compare-crypto-payments`            | Compare gateways: Stripe, BitPay, Coinbase, NOWPayments, BTCPay, PayRam, x402                 |
| `payram-agent-journey`               | Start-here map: install (merchant or operator) → wallets → gas/sweep → integrate → test       |
| `payram-topup-wallet-integration`    | Existing apps: credit crypto to a user balance, debit invoices from it — ledger + flows       |
| `payram-testnet-testing`             | Pay your own payment link on testnet end-to-end before mainnet                                |

---

## Project Goals

- **Accelerate onboarding** with a personalised setup plan, runbooks, env templates and per-framework playbooks.
- **Operate without holding credentials**: the hosted server checks a PayRam by URL (`payram_doctor`) and hands agents exact API recipes (`payram_ops_playbook`) to run with their own credentials.
- **Retrofit existing repos** via the project assessment tool (local mode), which scans package manifests and `.env` files, then recommends the right integration snippets.
- **Provide copy/paste snippets** spanning Payments, Payouts, Referrals, Webhooks, and multi-language backends (Express, Next.js, FastAPI, Laravel, Gin, Spring Boot, etc.).
- **Keep docs local** so Copilot can explain PayRam concepts, flows, and referral dashboards without leaving the editor.
- **Validate connectivity** with read-only probes that never create payments (`payram_doctor`, `test_payram_connection`).

---

## Quick Start

Most agents only need the hosted endpoint, `https://mcp.payram.com/mcp` (see [Connect from your MCP client](#connect-from-your-mcp-client)). To run the server yourself:

1. **Install dependencies**
   ```bash
   yarn install
   ```
2. **Configure environment** (only needed for the local-mode data tools)
   - Copy `.env.example` to `.env`.
   - Set `PAYRAM_BASE_URL` to your PayRam URL, the same origin as the dashboard (e.g. `https://pay.example.com`).
   - Set `PAYRAM_API_KEY`, plus the JWT variables for the data tools. See [Local mode](#local-mode).
3. **Run the server**
   ```bash
   yarn dev
   # Streamable HTTP on http://127.0.0.1:3333/mcp (local mode; there is no SSE transport)
   ```
4. **Add the MCP server to your client**: see [Connect from your MCP client](#connect-from-your-mcp-client). The local-mode URL is `http://localhost:3333/mcp`.
5. **Health check**
   ```bash
   curl http://localhost:3333/healthz
   ```

> **Tip:** When you tell Copilot "test payram" it will automatically run the readiness checklist, ensure `.env` exists, and only then call `test_payram_connection` with your real credentials. The behavior is defined by the [Copilot automation prompt](#copilot-automation-prompt)—no manual prompting required.

---

## Connect from your MCP client

**Endpoint:** `https://mcp.payram.com/mcp` (Streamable HTTP, JSON-RPC over POST). There is no SSE endpoint, and `/mcp/sse` returns 410. No auth headers: the hosted server never holds merchant credentials, so yours stay on your machine and never go into chat.

| Client                 | Where                                                        | Settings                                |
| ---------------------- | ------------------------------------------------------------ | --------------------------------------- |
| VS Code (Copilot Chat) | Settings → Copilot: Model Context Protocol → Add HTTP server | Name `payram`, URL above, headers empty |
| Cursor                 | Settings → MCP Servers → Add → HTTP                          | Name `payram`, URL above                |
| Claude Desktop / Code  | Settings → MCP Servers → Add HTTP server                     | Name `payram`, URL above                |
| Any MCP client         | Register an HTTP endpoint                                    | URL above, no headers                   |

**Verify:** the tool list should start with `payram_setup_plan`, `payram_doctor`, `payram_runbook` and `payram_ops_playbook`, followed by `test_payram_connection`, `scaffold_payram_app` and the `generate_*` snippet tools. Then try: "plan a PayRam install on pay.example.com", "check https://pay.example.com", "generate a FastAPI create-payment route", "give me a Next.js webhook handler".

**Prompts:** `setup-payram`, `setup-payram-agent`, `integrate-payment`, `troubleshoot-payment`, `daily-ops`.
**Resources:** `payram://docs/setup-guide`, `payram://docs/api-reference`, and the templates `payram://ops/playbook/{task}` and `payram://runbooks/{task}`.

### Copilot automation prompt

Paste this once into a fresh workspace to make "test payram" run the full readiness flow automatically:

```
You have access to the `payram` MCP server in this workspace.

Whenever I ask you to "test my Payram connection" (or I type "test payram"), follow this order:

1. Call `prepare_payram_test` (no inputs) and share the checklist verbatim.
2. Look for a `.env` in the workspace root; create one if missing.
3. Ensure `.env` defines `PAYRAM_BASE_URL` and `PAYRAM_API_KEY`. If either is
   missing, call `generate_env_template` and append it (with TODOs) to `.env`.
   Do NOT call `test_payram_connection` until real values are provided.
4. Once real values exist, call `test_payram_connection` with baseUrl/apiKey
   from `.env`, show the structured result, and explain whether the
   connection is healthy. If anything fails, run `payram_doctor` and follow
   its ranked fixes.
```

---

## Local mode

Run the MCP next to your own PayRam to get the live data tools:

- `list_platforms`, `search_payments`, `lookup_payment`, `get_payment_summary`, `get_daily_volume`, `get_unswept_balances`, `list_currencies`, `list_recipients`
- `create_payment_link`, `check_payment_readiness`, `check_node_sync`, `restart_payram_worker`
- `assess_payram_project`

```bash
PAYRAM_MCP_MODE=local yarn dev        # or: yarn build && PAYRAM_MCP_MODE=local yarn start
```

- **Mode:** `PAYRAM_MCP_MODE=local` selects local mode. It is also the default whenever the server is not running on Vercel. `PAYRAM_MCP_MODE=hosted` never reads credentials.
- **Binding:** local mode binds to **`127.0.0.1`** by default (port `PORT`, default 3333).
- **Non-loopback binds:** set `HOST` (e.g. `HOST=0.0.0.0`), then:
  - Set `MCP_ALLOWED_HOSTS` (comma-separated hostnames accepted in the `Host` header).
  - Set `MCP_SERVER_TOKEN`; clients then send `Authorization: Bearer <token>`.
  - If `PAYRAM_*` credentials are set, the server refuses to start on a non-loopback `HOST` without `MCP_SERVER_TOKEN`. Prefer loopback plus an SSH tunnel.
- **Credentials:** the data tools read `PAYRAM_*` from the environment (or `.env`):
  - `PAYRAM_BASE_URL`
  - `PAYRAM_API_KEY` (payment links)
  - `PAYRAM_ACCESS_TOKEN` / `PAYRAM_REFRESH_TOKEN` (JWT, data tools)
  - `PAYRAM_EXTERNAL_PLATFORM_ID` (optional default project)

Example client config for a local server (local mode only):

```json
{
  "mcpServers": {
    "payram-local": { "url": "http://localhost:3333/mcp" }
  }
}
```

---

## Credentials: which key for what

PayRam has **two credentials** — agents stall when they conflate them:

| Credential                                                | Looks like                       | Used for                                                                                                                                    | How an agent gets it (no dashboard needed)                                                                                                                                                                             |
| --------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Merchant API key** (`PAYRAM_API_KEY`, header `API-Key`) | per-**project** key              | `POST /api/v1/payment` (payment links), merchant payouts, all merchant server-to-server calls, and it signs webhooks (`X-Payram-Signature`) | `bash <(curl -fsSL https://payram.com/setup_payram_agents.sh) ensure-api-key` — reuses or mints the project key via `POST /api/v1/external-platform/{id}/api-key` and saves it to `~/.payraminfo/merchant-api-key.env` |
| **JWT** (`Authorization: Bearer`)                         | access+refresh token from signin | admin/setup APIs (projects, wallets, analytics) — `payram_ops_playbook` recipes and the local-mode data tools                               | `bash <(curl -fsSL https://payram.com/setup_payram_agents.sh) signin` (env `PAYRAM_EMAIL`/`PAYRAM_PASSWORD`); saved to `~/.payraminfo/headless-tokens.env`                                                             |

The one-step setup flow (`bash <(curl -fsSL https://payram.com/setup_payram_agents.sh) --testnet`) produces **both** automatically and prints where they live. The API is same-origin with the dashboard, on **port 80/443** (`https://<your-domain>/api/v1/...`, or `http://localhost` on the server, never `:8080`). The API key can create payouts, so keep it server-side and never put it in browser code or chat. Use `payram_ops_playbook` task `connect` to set both up for direct API calls.

---

## Tool Catalog

| Category                                          | Tool                                                                                                                                                                                                                      | Purpose                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Start here – Install**                          | `payram_setup_plan`                                                                                                                                                                                                       | Personalised, ordered install plan (prepare → install → claim root + Site URL → wallets + Smart Bridge → API key + first link → harden → integrate) with agent vs human steps and hard stops.                                                                                                                                              |
| **Start here – Diagnostics**                      | `payram_doctor`                                                                                                                                                                                                           | Public, credential-free staged check by URL (reachability → health → TLS → version → workers) with ranked likely causes + exact fixes. Optional API-key validity check that creates nothing. Run this FIRST when anything fails.                                                                                                           |
| **Start here – Admin**                            | `payram_runbook`                                                                                                                                                                                                          | Step-by-step admin tasks with human gates: `set_site_url`, `change_domain`, `ssl_setup`, `ssl_renewal_fix`, `firewall_ports`, `upgrade`, `backup`, `restore`, `add_chain`, `smart_bridge`, `mainnet_cutover`, `operator_setup`, `rotate_api_key`, `reset_test_install`, `shopify_connector`, `woocommerce_plugin`, `secure_analytics_mcp`. |
| **Start here – Operations**                       | `payram_ops_playbook`                                                                                                                                                                                                     | Direct-API recipes the agent runs itself: `connect`, `health`, `version_check`, `workers`, `restart_worker`, `node_sync`, `site_url`, `payment_options`, `unswept_funds`, `payments_today`, `payment_lookup`, `stuck_payment`, `create_payment_link`, `payouts`, `webhooks`, `logs`, `daily_check`.                                        |
| **Connectivity**                                  | `test_payram_connection`                                                                                                                                                                                                  | Read-only reachability/health check plus optional API-key validation. Never creates payments.                                                                                                                                                                                                                                              |
| **Setup**                                         | `generate_env_template`, `generate_setup_checklist`, `suggest_file_structure`, `get_agent_setup_flow`, `onboard_agent_setup`                                                                                              | Ship env boilerplate, merchant checklists, recommended project layouts, and the headless agent onboarding guide.                                                                                                                                                                                                                           |
| **Context / Docs**                                | `explain_payram_basics`, `explain_payram_concepts`, `explain_payment_flow`, `get_payram_links`, `prepare_payram_test`, `get_payram_doc_by_id`, `list_payram_docs`, etc.                                                   | Provide inline Markdown knowledge sourced from `docs/` so Copilot can answer conceptual questions. Some tools append “say `test payram`” reminders automatically.                                                                                                                                                                          |
| **Integration – Payments**                        | `generate_payment_sdk_snippet`, `generate_payment_http_snippet`, `generate_payment_status_snippet`, `generate_payment_route_snippet`                                                                                      | Emit SDK, raw HTTP, or Express/Next.js route code for create + status flows.                                                                                                                                                                                                                                                               |
| **Integration – Payouts**                         | `generate_payout_sdk_snippet`, `generate_payout_recipient_flow_snippet`, `generate_payout_status_snippet`                                                                                                                 | Direct (no-OTP) payout, the 3-step saved-recipient flow (create recipient → validate OTP → pay out), and status polling.                                                                                                                                                                                                                   |
| **Integration – Referrals**                       | `generate_referral_sdk_snippet`, `generate_referral_validation_snippet`, `generate_referral_status_snippet`, `generate_referral_route_snippet`                                                                            | Cover referral auth, linking, validation, status, and express/next routes.                                                                                                                                                                                                                                                                 |
| **Integration – Webhooks**                        | `generate_webhook_handler`, `generate_webhook_event_router`, `generate_mock_webhook_event`                                                                                                                                | Produce handlers for Express/Next/FastAPI/Gin/Laravel/Spring Boot, fan-out routers, and cURL/Python/Go/PHP/Java webhook testers.                                                                                                                                                                                                           |
| **Integration – Multi-language Payments**         | `snippet_*` family (`snippet_express_payment_route`, `snippet_nextjs_payment_route`, `snippet_fastapi_payment_route`, `snippet_laravel_payment_route`, `snippet_go_payment_handler`, `snippet_spring_payment_controller`) | Prebuilt route handlers for Express, Next.js App Router, FastAPI, Gin, Laravel, and Spring Boot.                                                                                                                                                                                                                                           |
| **Integration – Top-Up Wallet**                   | `generate_topup_integration_snippet`                                                                                                                                                                                      | For EXISTING apps: ledger schema + cumulative-credit webhook + atomic invoice settle, so over/under/late/duplicate crypto payments become balance states instead of payment exceptions. Pairs with the `payram-topup-wallet-integration` skill.                                                                                            |
| **Integration – Project Assessment** (local mode) | `assess_payram_project`                                                                                                                                                                                                   | Scans `package.json`, `requirements.txt`, `composer.json`, `go.mod`, `pom.xml`, `.env`, etc. Reports detected frameworks, env status, PayRam dependencies, and prioritized next steps with tool suggestions.                                                                                                                               |
| **Scaffolding**                                   | `scaffold_payram_app`                                                                                                                                                                                                     | Generates full starter apps (Express, Next.js, FastAPI, Laravel, Gin, Spring Boot) with payments, payouts, webhooks, and a browser console. Put the payout endpoints behind your own admin auth before deploying.                                                                                                                          |
| **Live Data (read-only, local mode)**             | `list_platforms`, `search_payments`, `lookup_payment`, `get_payment_summary`, `get_daily_volume`, `get_unswept_balances`, `list_currencies`, `list_recipients`                                                            | Query live PayRam data. `list_currencies` is public (no key); the rest use the JWT tokens in `.env`. `list_recipients` pairs with the payout recipient flow.                                                                                                                                                                               |
| **Live Operations (local mode)**                  | `create_payment_link` (write), `check_payment_readiness`, `check_node_sync`, `restart_payram_worker` (write)                                                                                                              | `create_payment_link` creates a real checkout link via `API-Key`. `check_payment_readiness` reports per-chain gaps (missing wallet / currency / listener) to accept payments. `check_node_sync` reports listener-worker + RPC node health and block staleness. On the hosted server, use the matching `payram_ops_playbook` tasks.         |

> Tool registrations live in `src/tools/index.ts`; individual implementations sit in `src/tools/**` with language-specific templates under `templates/` folders.

---

## Guided Workflows

### 0. Install PayRam

1. Ask: "Set up PayRam on pay.example.com" (or use the `setup-payram` / `setup-payram-agent` prompts).
2. The assistant calls `payram_setup_plan` and walks the phases, stopping at every human step (root account, Site URL, cold wallet, mainnet gas).
3. It finishes with `payram_doctor`, backups (`payram_runbook` `backup`) and the daily check (`payram_ops_playbook` `daily_check`).

### 1. Assess and Retrofit an Existing Project

1. Ask Copilot: "Can you integrate PayRam into this project?"
2. The assistant runs `assess_payram_project` (local mode), reviewing dependency manifests and `.env`.
3. Follow the recommended steps (install `payram`, request Express/FastAPI/Spring route snippets, add webhooks, etc.).
4. Use `test_payram_connection` once credentials are real to ensure the backend can reach your self-hosted server.

### 2. Scaffold a Fresh Sample

1. "Create a PayRam Express demo" → `scaffold_payram_app` builds an Express project with payments, payouts, webhooks, and a UI console.
2. Drop the generated files into an empty repo or compare against your existing directory for reference wiring.

### 3. Run the "Test PayRam" Readiness Flow

1. Say "test payram". The assistant automatically:
   - Calls `prepare_payram_test` to share the readiness checklist.
   - Ensures `.env` exists (creating it if missing) using `generate_env_template`.
   - Waits for real credentials before invoking `test_payram_connection`.
2. Review the structured JSON result to confirm the PayRam API is reachable.

### 4. Wire Payments, Payouts, Referrals, and Webhooks

- Payments: `generate_payment_sdk_snippet` (JS SDK) or `generate_payment_http_snippet` (Python/Go/PHP/Java).
- Multi-language routes: `snippet_nextjs_payment_route`, `snippet_fastapi_payment_route`, etc.
- Payouts: `generate_payout_sdk_snippet` for create + `generate_payout_status_snippet` for polling.
- Referrals: `generate_referral_route_snippet`, `generate_referral_validation_snippet`.
- Webhooks: `generate_webhook_handler` plus `generate_webhook_event_router` for fan-out + `generate_mock_webhook_event` to test each status.

---

## Development

| Command                     | Description                                     |
| --------------------------- | ----------------------------------------------- |
| `yarn dev`                  | Run the MCP server with hot reload via `tsx`.   |
| `yarn build`                | Compile TypeScript to `dist/`.                  |
| `yarn lint` / `yarn format` | ESLint + Prettier across the repo.              |
| `yarn test`                 | Executes the Vitest suite (`tests/`).           |
| `make precommit-test`       | Runs format → lint → test → build sequentially. |

Project is TypeScript-first (ESM). Prettier config lives in `.prettierrc.json`; ESLint is configured via `eslint.config.mjs`. Smooth contributions follow the commit helper in `Makefile` → `make commit`.

---

## Troubleshooting

> **Start with `payram_doctor`** — one read-only call that walks reachability → health → TLS → version → workers and returns ranked causes with exact fixes. For deeper checks, follow `payram_ops_playbook` (`stuck_payment`, `node_sync`, `webhooks`, `logs`).

- **Copilot doesn’t call the right tool:** Check the [Copilot automation prompt](#copilot-automation-prompt) is installed and your MCP client loaded the server. Re-run "test payram" or "assess my project" to trigger the expected automation.
- **`test_payram_connection` fails with 401:** Confirm the key is an active project API key (sent as the `API-Key` header, not `Authorization`).
- **A data tool says credentials are unavailable:** the hosted server never holds merchant credentials. Use the matching `payram_ops_playbook` task, or run the MCP in [local mode](#local-mode).
- **Payment links show `http://localhost`:** the human must save Settings → Site URL from the public domain (`payram_runbook` task `set_site_url`).
- **Docs tool says a file is missing:** Verify your local `docs/payram-docs-live/` tree contains the requested markdown (`get_payram_doc_by_id` rejects paths with `..`).
- **Server won’t start:** Ensure Node 20+ and run `yarn install`. In local mode with a non-loopback `HOST` and `PAYRAM_*` credentials set, the server refuses to start until `MCP_SERVER_TOKEN` is set (see [Local mode](#local-mode)).

For anything else, inspect the structured logs emitted from `src/utils/logger.ts` (set `LOG_LEVEL=debug`) and open an issue/PR with reproduction details.

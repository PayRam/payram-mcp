---
name: payram-openclaw-integration
description: Functional how-to for integrating PayRam into an OpenClaw (or NemoClaw, Claude Desktop, Copilot, n8n, LangChain, Cursor, Windsurf) agent. Register the PayRam MCP server, list discovered tools, walk through a full payment flow from payment creation → signed webhook → fulfilment, and debug common issues. Includes a testnet walkthrough on Base Sepolia, agent configuration for WhatsApp/Telegram/Discord bot runtimes, and patterns for subscription access grants, pay-per-request API monetization (an HTTP 402 pattern built on payment links), and agent-to-agent commerce. Use when building an OpenClaw skill that needs to accept or send money, connecting an existing bot to PayRam, or troubleshooting an MCP registration that's not picking up tools.
---

# PayRam + OpenClaw: Functional Integration Guide

> You've decided to use PayRam with OpenClaw. This skill is the mechanical how-to — config lines, tool signatures, testnet walkthrough, and debugging. For the positioning / use-cases narrative see the marketing companion at https://payram.com/skills/payram-openclaw-integration.md.

## 1. Register the MCP server

Add to your OpenClaw (or any MCP-compatible client) configuration:

```json
{
  "mcpServers": {
    "payram": {
      "url": "https://mcp.payram.com/mcp"
    }
  }
}
```

File location by client:

| Client                   | Config path                                                       |
| ------------------------ | ----------------------------------------------------------------- |
| Claude Desktop (macOS)   | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json`                     |
| Cursor                   | `~/.cursor/mcp.json`                                              |
| Copilot                  | project `.vscode/mcp.json` or user settings                       |
| OpenClaw                 | agent's `agent_config.json` or `mcp.json`                         |
| n8n                      | MCP node → HTTP endpoint field                                    |

No API key is required to **connect** to the MCP server. The hosted server **never holds your PayRam credentials**: your agent runs day-2 API calls itself via `payram_ops_playbook`, with credentials that stay on its own machine. Dashboard APIs (for analytics, auth) require JWT Bearer — see the `payram-auth` skill.

## 2. Tools the agent will discover

After registering, the agent auto-discovers the PayRam MCP tools. Note these are **integration-assistant** tools, such as plans, runbooks, API recipes and code-snippet generators. None of them moves money. The hosted MCP holds no keys; payment creation happens in _your_ backend via the code these tools generate.

| Tool                                                                                                        | Purpose                                                                                                            |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `payram_setup_plan`                                                                                         | Start here: personalised install plan with human hand-offs                                                         |
| `payram_doctor` / `test_payram_connection`                                                                  | Public, credential-free check of your PayRam URL (optional API-key check that creates nothing)                     |
| `payram_runbook`                                                                                            | Admin tasks: Site URL, SSL, firewall, upgrade, backup, chains, Smart Bridge                                        |
| `payram_ops_playbook`                                                                                       | Day-2 API recipes your agent runs itself (health, payments, unswept funds, webhooks, daily check)                  |
| `generate_payment_sdk_snippet` / `generate_payment_http_snippet` / `generate_payment_route_snippet`         | Backend code to create a payment via `POST /api/v1/payment` (fields: `customerEmail`, `customerID`, `amountInUSD`) |
| `generate_payment_status_snippet`                                                                           | Code to poll payment status by `reference_id`                                                                      |
| `generate_webhook_handler` / `generate_webhook_event_router` / `generate_mock_webhook_event`                | Webhook receiver code + a mock event for testing                                                                   |
| `generate_payout_sdk_snippet` / `generate_payout_recipient_flow_snippet` / `generate_payout_status_snippet` | Outbound payout code (direct or 3-step recipient flow)                                                             |
| `generate_referral_*`                                                                                       | Referral link / validation / status / route snippets                                                               |
| `scaffold_payram_app` / `generate_env_template` / `generate_setup_checklist`                                | Project scaffolding and setup helpers                                                                              |

**Local mode only:** the live data tools (`search_payments`, `lookup_payment`, `get_payment_summary`, `get_daily_volume`, `get_unswept_balances`, `list_platforms`, `create_payment_link`, `check_node_sync`, `restart_payram_worker`, …) and `assess_payram_project` exist only when you run the MCP yourself next to your PayRam (`PAYRAM_MCP_MODE=local`, credentials in its `PAYRAM_*` env).

Supported currencies: `USDC`, `USDT`, `BTC`, `ETH`, `TRX`, `POL`, `CBBTC`, `PYUSD` (per chain). Native chains (codes are uppercase in the API): `BASE`, `ETH`, `POLYGON`, `TRX`, `BTC`. Customers can also pay on Solana, Bitcoin, Tron-USDT and BNB Chain via **Smart Bridge**, and you settle as USDC on Base.

## 3. Full payment flow

The agent generates integration code with the snippet tools; your backend runs it. The actual create-payment call is `POST /api/v1/payment` with the `API-Key` header (never `Authorization: Bearer`).

```
Agent → generate_payment_sdk_snippet → drop the code into your backend

Your backend → POST {payram}/api/v1/payment
               Headers: API-Key: <merchant key>
               Body: { customerEmail, customerID, amountInUSD: 25.00 }
            ← { url: 'https://pay.example.com/payments?reference_id=…', reference_id: '…', host: '…' }

Agent → [sends url (or QR) to the customer in-chat]

[Customer pays — crypto directly OR card-to-crypto]

PayRam → POST https://your-webhook.example.com/
         Headers: X-Payram-Signature: sha256=<HMAC-SHA256(raw body, project API key)>
                  API-KEY: <project API key>   (legacy)
         Body: { reference_id: '…', status: 'FILLED', amount: '25.00',
                 filled_amount_in_usd: '25.00', currency: 'USD' }

Your webhook handler → [verifies the signature over the raw body]
                     → [fulfils: grants access / ships / etc]
                     → responds 2xx (acknowledges webhook)
```

Webhook retry schedule if you don't 2xx: **30m, 1h, 2h, 4h, 8h, 24h, 48h**.

Webhook `status` values: `OPEN`, `PARTIALLY_FILLED`, `FILLED`, `OVER_FILLED`, `CANCELLED`, `UNDEFINED`. Fulfil on `FILLED` (and decide a policy for `OVER_FILLED`/`PARTIALLY_FILLED`).

- **Signing:** every webhook is signed. `X-Payram-Signature` is `sha256=` plus the hex HMAC-SHA256 of the raw body, keyed with the project API key (the newest active one). There is no separate webhook secret.
- **Verify:** compute the HMAC over the raw body and compare in constant time.
- **Amounts:** they are decimal strings.
- **Payout ping:** answer the unsigned ping (`X-Webhook-Test: true`) with 200.

See `payram-webhook-integration` for handler code.

## 4. Testnet walkthrough (Base Sepolia)

The hosted MCP (`mcp.payram.com/mcp`) has no PayRam instance or test network behind it. You run your own testnet node (call `payram_setup_plan` with `network: "testnet"` for the full plan):

1. **Deploy PayRam in agent mode** (the first install needs an interactive terminal, e.g. `ssh -t`; the installer default is mainnet, so pass the flag):

   ```
   bash <(curl -fsSL https://payram.com/setup_payram_agents.sh) --testnet --skip-mcp-server
   ```

   The default flow deploys the smart-contract deposit wallet on Base (Base Sepolia on testnet).

2. **Fund the deployer wallet:** PayRam shows an address and waits. Fund it with Base Sepolia ETH from:
   - https://www.alchemy.com/faucets/base-sepolia
   - https://faucet.quicknode.com/base/sepolia

   The flow then deploys the contract. If you stopped it, re-run the same command; the step is resumable. (Run standalone, `deploy-scw-flow` defaults to Ethereum, so set `PAYRAM_BLOCKCHAIN_CODE=BASE` if you use it directly.)

3. **Human hand-off:** hand the root credentials (`~/.payraminfo/root-credentials.env`) to the human. They save **Settings → Site URL** from the public domain; until then, links point at `http://localhost`.

4. **Create a test payment link:**

   ```
   bash <(curl -fsSL https://payram.com/setup_payram_agents.sh) create-payment-link
   ```

   Produces a URL you can open in a browser and pay from a Base Sepolia wallet (MetaMask configured for the network).

5. **Watch logs:** tail `~/.payram-core/log/` (e.g. `deposit_processor.log`, `webhook_processor.log`); `docker logs payram` shows only startup output. You should see the listener detect the deposit, move through `Confirming → Confirmed`, and fire the webhook.

## 5. Agent-runtime integration patterns

### WhatsApp (via Twilio or Cloud API)

Agent sees an inbound message → parses intent → your backend creates the payment (`POST /api/v1/payment`) → replies with the checkout URL. On the `FILLED` status webhook, send the fulfilment message via the platform's outbound API.

### Telegram

Same as WhatsApp but via the Telegram Bot API. For subscription bots: store `reference_id → telegram_user_id` so the webhook can grant channel access via `inviteChatMember` / set up auto-revoke.

### Discord

Use `discord.js`. On the `FILLED` webhook, call `GuildMember.roles.add(premiumRoleId)`. Schedule a `setTimeout` or persist to a DB for the expiry revocation.

### n8n

Use the MCP node → point at `https://mcp.payram.com/mcp` → call tools as actions. Wire the webhook to an HTTP trigger node.

### Agent-to-agent (HTTP 402 pattern on payment links)

PayRam does not implement the x402 protocol. You can still build a pay-per-request flow on ordinary PayRam payment links:

```python
# Seller backend: answer 402 with a PayRam payment link, serve once it is FILLED
import os, httpx
from fastapi import Request
from fastapi.responses import JSONResponse

PAYRAM = os.environ['PAYRAM_BASE_URL']
HEADERS = {'API-Key': os.environ['PAYRAM_API_KEY']}  # server-side only

@app.get('/data/{query}')
async def data(query: str, request: Request):
    ref = request.headers.get('x-payram-reference')
    if ref:
        async with httpx.AsyncClient() as c:
            r = await c.get(f'{PAYRAM}/api/v1/payment/reference/{ref}', headers=HEADERS)
        if r.status_code == 200 and r.json().get('paymentState') == 'FILLED' and not already_used(ref):
            mark_used(ref)  # one reference buys one response
            return await fetch_data(query)

    buyer_id = request.headers.get('x-buyer-id', 'anonymous-agent')
    async with httpx.AsyncClient() as c:
        r = await c.post(f'{PAYRAM}/api/v1/payment', headers=HEADERS,
                         json={'customerID': buyer_id, 'customerEmail': 'agent@example.com', 'amountInUSD': 1})
    link = r.json()
    return JSONResponse(status_code=402, content={'payment_url': link['url'], 'reference_id': link['reference_id']})
```

The buyer agent receives the 402, pays the `payment_url`, then retries with `x-payram-reference: <reference_id>`. Creating a payment cancels that customer's other open payments, so give each buyer its own customer id.

## 6. Debugging

**Agent doesn't see the PayRam tools**

- Verify MCP config path is correct for your client
- Restart the client (Claude Desktop needs full restart after config changes)
- Check the MCP server is reachable: `curl https://mcp.payram.com/healthz` → `{ ok: true }`
- Use `https://mcp.payram.com/mcp` (Streamable HTTP). There is no SSE endpoint, and `/mcp/sse` returns 410. The client handles the protocol.

**Payment is created but the webhook never fires**

- Check the webhook URL in your PayRam dashboard — must be reachable from the internet (not `localhost`)
- Use `ngrok http 3000` for local dev, set the ngrok URL as webhook
- Check the webhook handler returns 2xx; non-2xx triggers the retry schedule
- Check your handler verifies `X-Payram-Signature` with the project's **newest active** API key; a different key rejects every delivery
- Test manually: in PayRam dashboard, use "Resend webhook" on a confirmed payment

**Payment shown as Confirming forever**

- Confirmation threshold configured too high for the chain
- Chain listener worker not running — `docker exec payram supervisorctl status`, or `payram_ops_playbook` tasks `workers` / `node_sync`
- RPC provider down — check the node settings for that chain

**Payouts: who can send money**

- EVM and Tron payouts are signed by the project **hot wallet** on the server, not by the cold wallet. Any holder of the project API key can request one, and payouts under the project's auto-approve limit go out without a human.
- Keep the hot wallet balance small, review the payout approval settings, and never give an autonomous agent a key it doesn't need.
- BTC payouts are not supported. Creating or approving payouts is a human decision.

## 7. See also

- Marketing framing (website-hosted): https://payram.com/skills/payram-openclaw-integration.md
- Chat commerce patterns (website): https://payram.com/skills/payram-for-whatsapp-telegram.md
- Deploy: `payram-agent-onboarding` skill
- Dashboard auth: `payram-auth` skill
- Analytics: `payram-analytics` skill

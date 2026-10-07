---
name: payram-setup
description: Install and configure a self-hosted PayRam payment gateway on your own VPS. Start by calling the payram_setup_plan MCP tool for a personalised, ordered plan. Covers server requirements, the installer, testnet vs mainnet, claiming the root account, setting the public Site URL, HTTPS, deposit wallets, Smart Bridge rails, the project API key, the first payment link and hardening, with every human hand-off called out. Use when deploying PayRam on a server, whether a human uses the web dashboard or an agent drives the headless CLI.
---

# PayRam Setup

> **Start here:** call `payram_setup_plan` on the PayRam MCP (`https://mcp.payram.com/mcp`). It returns a personalised, ordered plan with who runs each step (agent shell, human, or dashboard), the exact command, what success looks like, and the hard stops that need a human. This skill summarises that flow.

PayRam runs on your own server. There is no account to lock, no funds to freeze, customer data is never shared, and nothing is reported or monitored. No deposit keys sit on the server either. All of this holds because you run the gateway and deposits move through on-chain smart contracts to your own cold wallet.

> **Headless install by an agent?** See [`payram-agent-onboarding`](https://github.com/payram/payram-mcp/tree/main/skills/payram-agent-onboarding). Both paths install the same product: the web dashboard is always there, and the agent path drives it through the API after a one-time interactive install.

---

## 1. Plan the install

```text
payram_setup_plan { "path": "human", "network": "testnet", "domain": "pay.example.com" }
```

| Input         | Values                                                      |
| ------------- | ----------------------------------------------------------- |
| `path`        | `human` (installer + dashboard) or `agent` (headless CLI)   |
| `network`     | `testnet` (free test coins, recommended first) or `mainnet` |
| `domain`      | Public hostname, e.g. `pay.example.com` (omit if IP-only)   |
| `ssl`         | `letsencrypt`, `own_certificate`, `proxy`, `none`           |
| `role`        | `merchant` (your own business) or `operator` (a platform)   |
| `wallet`      | `usdc_base` (default), `btc`, `both`                        |
| `stage`       | Resume point: `fresh`, `installed`, `account_created`, …    |
| `integration` | `none`, `website`, `shopify`, `woocommerce`                 |

---

## 2. Prepare the server (human)

- **Server:** 2 CPU cores, 4 GB RAM, 50 GB SSD. Ubuntu 22.04+ is recommended. Debian, the RHEL family, Fedora, Arch and Alpine also work, and macOS is for testing only. The installer refuses to run with less than 5 GB free and recommends 10 GB or more.
- **Access:** SSH as root or a sudo user.
- **Database:** the installer's containerized Postgres is the default. An external Postgres is optional (1 vCPU, 1 GB RAM, 50 GB SSD).
- **Domain:** point an A (and AAAA) record at the server. `dig +short pay.example.com` must print the server IP before Let's Encrypt can work.
- **Firewall:** open inbound **22, 80 and 443 only**. Never open 5432 (Postgres), 8080 or 8443. The dashboard, checkout and API share one origin on 80/443. Docker-published ports bypass `ufw`, so set the same rule in the cloud provider firewall.

```bash
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw --force enable
```

---

## 3. Install

```bash
ssh -t root@<server>
bash <(curl -fsSL https://payram.com/setup_payram.sh) --testnet     # or --mainnet
```

- **Always pass `--testnet` or `--mainnet`.** Without a flag, the installer defaults to **mainnet**.
- **A fresh install needs an interactive terminal once.** It asks one-time questions about the database, SSL and port, so never pipe it (`curl … | bash`); a piped script has no terminal and exits.
- **Answers:**
  - Database: keep the containerized default unless you run your own Postgres.
  - SSL: Let's Encrypt (needs the domain and ports 80/443 free), your own certificate, an external proxy that terminates TLS, or none for now.
  - Port: 80.
- **The network is fixed at install time.** There is no in-place testnet → mainnet switch. Use a new server for mainnet (`payram_runbook` task `mainnet_cutover`).

**Verify:**

```bash
curl -s http://localhost/api/v1/health | jq '{status, version}'            # on the server
curl -s https://pay.example.com/api/v1/health | jq '{status, version}'     # from outside
docker port payram                                                        # expect only 80 (and 443)
```

Or call `payram_doctor { "baseUrl": "https://pay.example.com" }`. It is a public check that needs no credentials. If an older install still publishes 5432, 8080 or 8443, run `payram_runbook` task `firewall_ports`.

---

## 4. Claim root and set the Site URL (human)

1. **Create the root account immediately.** Open `https://pay.example.com` (or `http://<server-ip>`) and sign up. The first person to sign up becomes root, so do this before the server is advertised anywhere.
2. **Set the public URL.** While browsing the **public domain**, sign in as root, open **Settings → Site URL** and save.
   - Payment links, emails and the webhook origin all use this URL.
   - The URL is taken from the page you save it on. A headless install stores `http://localhost`, which customers cannot open.
   - To confirm the saved value, use `payram_ops_playbook` task `site_url`; `payram_runbook` task `set_site_url` has the full procedure.

---

## 5. HTTPS

If you skipped SSL, follow `payram_runbook` task `ssl_setup` (installer menu → _Update SSL Configuration_), then save the Site URL again from `https://`. If you use Let's Encrypt, apply `payram_runbook` task `ssl_renewal_fix` right away; otherwise renewal cannot bind port 80 and the certificate lapses after about 90 days.

---

## 6. Deposit wallets

| Chain    | Code      | Tokens                        | Deposit wallet                    |
| -------- | --------- | ----------------------------- | --------------------------------- |
| Base     | `BASE`    | ETH, USDC, CBBTC              | smart-contract wallet (needs gas) |
| Ethereum | `ETH`     | ETH, USDC, USDT, CBBTC, PYUSD | smart-contract wallet (needs gas) |
| Polygon  | `POLYGON` | POL, USDC, USDT               | smart-contract wallet (needs gas) |
| Tron     | `TRX`     | TRX, USDT                     | smart-contract wallet (needs gas) |
| Bitcoin  | `BTC`     | BTC                           | xpub wallet (no gas)              |

- **USDC on Base (default first wallet):** add a Base deposit wallet in the dashboard (**Wallets**). The deployer needs a little gas: about $10 of ETH on Base or Ethereum on mainnet, or Base Sepolia ETH from a faucet on testnet.
- **Bitcoin:** an xpub wallet is created instantly with no gas. Keep its secret offline; BTC sweeps are signed in the PayRam Connect mobile app.
- **Cold wallet:** the sweep destination for your funds is the human's decision. Never let an agent pick it.
- **Hot wallet:** it pays gas **and signs payouts**, so keep only a working balance in it. What never sits on the server are the deposit keys, because deposits are swept by the smart contract.
- **More chains:** see `payram_runbook` task `add_chain`.
- **Smart Bridge rails:** customers can also pay on Solana, Bitcoin, Tron (USDT) or BNB Chain, and you settle as USDC on Base with no extra node.
  - The project must accept USDC on Base and have a Base deposit wallet.
  - Rails are on by default. Since 3.7 an enabled rail replaces the native Bitcoin and native Tron-USDT options at checkout.
  - Review **Project → Payment options**, or follow `payram_runbook` task `smart_bridge`.

---

## 7. API key and first payment link

1. **Project → API keys → create a key.** The key can create payments **and payouts**, so keep it server-side only. Never put it in browser code or paste it into a chat.
2. Create a test payment:

```bash
curl -s -X POST https://pay.example.com/api/v1/payment \
  -H "API-Key: $PAYRAM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"customerID":"cust-123","customerEmail":"buyer@example.com","amountInUSD":1}' | jq .
```

Expected response:

```json
{
  "url": "https://pay.example.com/payments?reference_id=...",
  "reference_id": "...",
  "host": "https://pay.example.com"
}
```

- Send `url` to the customer as-is. If it starts with `http://localhost`, fix the Site URL (step 4).
- Append `&test=true` to preview the checkout without paying. Test mode is on by default on testnet.
- Creating a payment **cancels that customer's other open payments** in the project, so use the real, unique customer id.

---

## 8. Harden and operate

| Task                               | How                                        |
| ---------------------------------- | ------------------------------------------ |
| Public health check                | `payram_doctor { "baseUrl": "https://…" }` |
| Backups (database **and** AES key) | `payram_runbook` task `backup`             |
| Daily check                        | `payram_ops_playbook` task `daily_check`   |
| Upgrades (human decision)          | `payram_runbook` task `upgrade`            |
| Close legacy ports                 | `payram_runbook` task `firewall_ports`     |

Back up `~/.payraminfo/aes/` together with the database. Without the AES key, the encrypted hot-wallet key cannot be recovered.

---

## Troubleshooting

| Issue                               | Likely cause                                              | Fix                                                                  |
| ----------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| Installer exits right away          | No terminal (piped or non-interactive)                    | Run `bash <(curl -fsSL …)` inside `ssh -t`                           |
| Can't reach the dashboard           | 80/443 closed at the host or cloud firewall               | Open 80 and 443 (never 5432/8080/8443); `docker port payram`         |
| Payment links show `localhost`      | Site URL not set from the public domain                   | Settings → Site URL from `https://<domain>` (`set_site_url` runbook) |
| Let's Encrypt fails                 | DNS not pointing here, or port 80 busy                    | `dig +short <domain>`; `sudo ss -ltnp \| grep ':80'`                 |
| Certificate expired after ~90 days  | Renewal cannot bind port 80                               | `payram_runbook` task `ssl_renewal_fix`                              |
| `POST /api/v1/payment` → 500 code 5 | No (or several) linked deposit wallets, or Site URL unset | Link exactly one deposit wallet; check the Site URL                  |
| API 401                             | Wrong or inactive API key                                 | Project → API keys                                                   |
| Deposits not swept                  | Hot wallet low on gas                                     | `payram_ops_playbook` task `unswept_funds`                           |

Backend errors are in `~/.payram-core/log/`, not in `docker logs payram` (`payram_ops_playbook` task `logs`).

---

## Next steps

- **Integrate payments into your app** → `payram-payment-integration`
- **Complete checkout implementation** → `payram-checkout-integration`
- **Handle webhooks** → `payram-webhook-integration`
- **Existing app with user balances** → `payram-topup-wallet-integration`
- **Send payouts** → `payram-payouts`
- **Test end to end on testnet** → `payram-testnet-testing`

---

## MCP tools for setup

| Tool                    | Purpose                                                                     |
| ----------------------- | --------------------------------------------------------------------------- |
| `payram_setup_plan`     | Personalised install plan with human hand-offs                              |
| `payram_doctor`         | Public, credential-free server check by URL                                 |
| `payram_runbook`        | Admin tasks: Site URL, domain, SSL, firewall, upgrade, backup, chains, etc. |
| `payram_ops_playbook`   | API recipes you run yourself with your own credentials                      |
| `generate_env_template` | `.env` template for your app                                                |

The hosted MCP never holds your credentials. The live data tools (payment search, node sync, payment links) exist only when you run the MCP yourself in local mode.

---

## Related skills

| Skill                                | What it covers                                   |
| ------------------------------------ | ------------------------------------------------ |
| `payram-agent-journey`               | End-to-end map for agents (merchant or operator) |
| `payram-agent-onboarding`            | Headless install and the agent CLI               |
| `payram-self-hosted-payment-gateway` | Architecture and deployment deep dive            |
| `payram-payment-integration`         | Integrate payments into your application code    |
| `payram-webhook-integration`         | Verify and handle signed webhooks                |
| `payram-testnet-testing`             | Full testnet round trip                          |

---

Need help? Message the PayRam team on Telegram: [@PayRamChat](https://t.me/PayRamChat)

- Website: https://payram.com
- Docs: https://docs.payram.com
- MCP Server: https://github.com/payram/payram-mcp

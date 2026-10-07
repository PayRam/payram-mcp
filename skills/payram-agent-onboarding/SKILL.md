---
name: payram-agent-onboarding
description: Headless PayRam install and setup driven by an AI agent over SSH. One interactive install, then the setup_payram_agents.sh CLI runs everything else through the API - root account, config, smart-contract or BTC deposit wallet, API key and first payment link. Covers the real subcommands and environment variables, testnet vs mainnet flags, the human hand-offs (root credentials, Site URL, cold wallet, mainnet gas), and where payram_setup_plan, payram_doctor, payram_ops_playbook and payram_runbook fit. Use when an agent is installing or operating PayRam on a server.
---

# PayRam Agent Onboarding

> **Tell your human:** PayRam keeps no deposit keys on the server. Smart contracts sweep deposits to your cold wallet. The hot wallet on the server pays gas **and signs payouts**, so it should only ever hold a working balance. The deployer mnemonic that this flow creates can change the cold-wallet config on-chain. Back it up offline and remove it from the server once every chain is deployed and the cold-wallet config is final.

> **Start with the MCP:** call `payram_setup_plan` with `path: "agent"` (MCP at `https://mcp.payram.com/mcp`). It returns the ordered plan for your domain, network and wallet choice, with every human stop marked. This skill is the CLI reference behind that plan.

The agent CLI (`setup_payram_agents.sh`) installs PayRam and then drives setup through the API, so you don't need to click through the dashboard. The web dashboard is still installed; the human uses it for the hand-offs listed below.

> **Human doing the install?** See [`payram-setup`](https://github.com/payram/payram-mcp/tree/main/skills/payram-setup).

## When to Use Agent Mode

- **AI agent operators**: Claude, Copilot or a custom MCP client that has SSH access to the merchant's server
- **Headless commerce**: backend-only payment processing for APIs and microservices
- **Repeatable test installs**: disposable testnet servers stood up by script

---

## Prerequisites

- A VPS with **2 CPU cores, 4 GB RAM, 50 GB SSD**. Ubuntu 22.04+ is recommended.
- SSH as root or a sudo user. The **first install needs an interactive terminal once** (`ssh -t`).
- Inbound ports **22, 80 and 443 only**. Never open 5432, 8080 or 8443.
- A domain pointing at the server if customers will use it (payment links need a public URL).

**How to run the CLI:** always run it straight from the URL. Never pipe it (`curl … | bash`); a piped script has no terminal, so a fresh install exits.

```bash
bash <(curl -fsSL https://payram.com/setup_payram_agents.sh) [options | command]

# Optional shorthand for this shell session:
payram_agent() { bash <(curl -fsSL https://payram.com/setup_payram_agents.sh) "$@"; }
```

The script downloads its helper assets into a temporary directory that is deleted on exit. After the one-liner there is **no** `./setup_payram_agents.sh` on disk, so always use the `bash <(curl …)` form (or the shorthand above).

---

## Quick Start

### One-Step Flow

```bash
ssh -t root@<server>
bash <(curl -fsSL https://payram.com/setup_payram_agents.sh) --testnet --skip-mcp-server
```

**Always pass `--testnet` or `--mainnet`.** The default is **mainnet**: an interactive run preselects it, and a non-interactive run uses it silently.

The flow:

1. Installs PayRam through `setup_payram.sh` if it is not running. This is the **one interactive step**: database, SSL and port questions.
2. Waits for the API to become ready.
3. Creates the root account and default project (`setup`), or signs in if root exists.
   - If `PAYRAM_EMAIL`/`PAYRAM_PASSWORD` are unset, it generates credentials and saves them to `~/.payraminfo/root-credentials.env` (mode 600).
4. Configures the server URL (`ensure-config`).
5. **[operator]** Applies fee collectors and default fees (`ensure-operator-config`).
6. Sets up the deposit wallet. By default it deploys a **smart-contract wallet on BASE** (USDC-ready) and waits until the printed deployer address holds gas. Other lanes:
   - `--ensure-wallet`: BTC xpub first (no gas), then the smart-contract wallet.
   - `--skip-scw`: BTC only.
7. Creates a first payment link.
8. Mints the project API key into `~/.payraminfo/merchant-api-key.env`.
9. Starts the Analytics MCP server unless `--skip-mcp-server` is passed.
   - Pass the flag: that server logs in as root and has no authentication of its own.
   - If one is already running, follow `payram_runbook` task `secure_analytics_mcp`.

### One-step options

| Option                     | Effect                                                    |
| -------------------------- | --------------------------------------------------------- |
| `--testnet`/`--mainnet`    | Network (fixed at install time; default mainnet)          |
| `--deploy-scw`             | Smart-contract wallet first on BASE (default, needs gas)  |
| `--ensure-wallet`          | BTC xpub first (no gas); smart-contract wallet afterwards |
| `--skip-scw`               | BTC only, no gas                                          |
| `--merchant`/`--operator`  | Install role (default merchant)                           |
| `--wallet-choice=1\|2\|3`  | Wallet flow choice (1 create, 2 link, 3 skip)             |
| `--skip-payment-link`      | Do not create a payment link                              |
| `--skip-mcp-server`        | Do not start the Analytics MCP server (recommended)       |
| `--restart`                | Restart the PayRam container before the headless steps    |
| `--node-mode=docker\|host` | Runtime for the JS helper scripts (default docker)        |

### Headless Re-runs (after the install)

Once PayRam is installed, every step is non-interactive:

```bash
export PAYRAM_NETWORK="testnet"
export PAYRAM_EMAIL="admin@example.com"        # optional: generated if unset
export PAYRAM_PASSWORD="a-long-random-password" # optional: generated if unset
export PAYRAM_WALLET_CHOICE="1"                 # create a wallet without prompting
export PAYRAM_WALLET_QUIET="1"

bash <(curl -fsSL https://payram.com/setup_payram_agents.sh) --testnet --skip-scw --skip-mcp-server   # BTC-only, no gas
```

---

## Human hand-offs (stop and ask)

| When                      | What the human does                                                                                                                                                                                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Right after install       | **Claim root immediately.** The first signup becomes root, and the flow already created it. Hand over `~/.payraminfo/root-credentials.env` privately (never in a chat log); the human signs in and changes the password.                                                                                    |
| After install             | **Set the Site URL.** Open the dashboard on the **public domain**, then **Settings → Site URL → Save**. A headless install stores `http://localhost`, so payment links point there until this is done. It is root-only and taken from the browser's origin, so the agent cannot fix it through `localhost`. |
| Mainnet wallet deploy     | Provide the **cold wallet** (`PAYRAM_FUND_COLLECTOR`) and approve about $10 of gas (`PAYRAM_ACCEPT_MAINNET_COSTS=1`).                                                                                                                                                                                       |
| Operator mode             | Choose fee collector addresses and the fee rate.                                                                                                                                                                                                                                                            |
| Payouts, upgrades, resets | Always the human's decision.                                                                                                                                                                                                                                                                                |

Check the Site URL with `payram_ops_playbook` task `site_url`. The full procedure is `payram_runbook` task `set_site_url`.

---

## Commands Reference

Run any command as `bash <(curl -fsSL https://payram.com/setup_payram_agents.sh) <command>`.

| Command                                               | Purpose                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| `status`                                              | API reachability and authentication status                               |
| `setup`                                               | First time: register the root user and create the default project        |
| `signin`                                              | Authenticate; saves tokens to `~/.payraminfo/headless-tokens.env`        |
| `ensure-config`                                       | Configure the server URL (required for payment links)                    |
| `setup-mode [merchant\|operator]`                     | Show or set the install role (locks once role data exists)               |
| `ensure-operator-config`                              | Operator fee collectors and default fees                                 |
| `ensure-api-key`                                      | Mint or reuse the project API key → `~/.payraminfo/merchant-api-key.env` |
| `ensure-wallet`                                       | Create or link a BTC xpub deposit wallet (no gas)                        |
| `deploy-scw`                                          | Deploy an EVM smart-contract wallet and link it to the project           |
| `deploy-scw-flow`                                     | Mnemonic → fund deployer → balance watch → deploy → link                 |
| `create-payment-link [projectId] [email] [amountUSD]` | Create a payment link and print its URL                                  |
| `reset-local`                                         | **Destroys the install.** Test servers only; see below                   |
| `menu`                                                | Interactive step menu                                                    |
| `run`                                                 | Run the headless steps in sequence                                       |

There are **no** `setup-eth` or `setup-base` commands and no `PAYRAM_BLOCKCHAIN_SETUP` variable. To choose the chain, set `PAYRAM_BLOCKCHAIN_CODE` (see below). The script's `node-status` and `node-restart` do not work as standalone commands. Use `payram_ops_playbook` tasks `node_sync` and `restart_worker` instead.

---

## Environment Variables

### Authentication & API

| Variable              | Default                                                                                  | Description                    |
| --------------------- | ---------------------------------------------------------------------------------------- | ------------------------------ |
| `PAYRAM_API_URL`      | derived from the install (`~/.payraminfo/config.env`); else `http://localhost` (port 80) | Backend API base URL           |
| `PAYRAM_EMAIL`        | generated if unset                                                                       | Root user email (setup/signin) |
| `PAYRAM_PASSWORD`     | generated if unset                                                                       | Root user password             |
| `PAYRAM_CUSTOMER_ID`  | from token file                                                                          | Filled in after signin         |
| `PAYRAM_FRONTEND_URL` | `http://localhost`                                                                       | Used by `ensure-config`        |

### Project, Role & Payment

| Variable                                                                 | Default           | Description                                  |
| ------------------------------------------------------------------------ | ----------------- | -------------------------------------------- |
| `PAYRAM_NETWORK`                                                         | from the install  | `testnet` or `mainnet` (prefer the CLI flag) |
| `PAYRAM_SETUP_MODE`                                                      | `merchant`        | `merchant` or `operator`                     |
| `PAYRAM_OPERATOR_EVM_FEE_COLLECTOR`, `PAYRAM_OPERATOR_BTC_FEE_COLLECTOR` | —                 | Operator fee collectors (human decision)     |
| `PAYRAM_OPERATOR_FEE_BPS`                                                | set it explicitly | Operator's fee in basis points (max 1500)    |
| `PAYRAM_PROJECT_NAME`                                                    | `Default Project` | Project name during setup                    |
| `PAYRAM_PAYMENT_EMAIL`                                                   | —                 | Customer email for payment links             |
| `PAYRAM_PAYMENT_AMOUNT`                                                  | `10`              | Payment amount in USD                        |

### Wallet & Node Runtime

| Variable                   | Default                 | Description                                    |
| -------------------------- | ----------------------- | ---------------------------------------------- |
| `PAYRAM_WALLET_CHOICE`     | —                       | `1` create, `2` link, `3` skip                 |
| `PAYRAM_WALLET_QUIET`      | —                       | If set, suppress wallet prompt text            |
| `PAYRAM_NODE_MODE`         | `docker`                | Runtime for the JS helpers: `docker` or `host` |
| `PAYRAM_NODE_DOCKER_IMAGE` | `node:20-bullseye-slim` | Docker image for the JS helpers                |

### Smart Contract Wallet (SCW) Deployment

| Variable                        | Default                                                                            | Description                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `PAYRAM_BLOCKCHAIN_CODE`        | `BASE` in the one-step flow; `ETH` for standalone `deploy-scw` / `deploy-scw-flow` | `ETH`, `BASE` or `POLYGON`                                       |
| `PAYRAM_ETH_RPC_URL`            | keyless PublicNode RPC for the chain and network                                   | RPC endpoint                                                     |
| `PAYRAM_FUND_COLLECTOR`         | testnet: deployer address; mainnet: **required**                                   | Cold wallet (sweep destination), a human decision                |
| `PAYRAM_ACCEPT_MAINNET_COSTS`   | —                                                                                  | `1` is required for a non-interactive mainnet deploy             |
| `PAYRAM_SCW_NAME`               | —                                                                                  | Name for the SCW wallet                                          |
| `PAYRAM_MNEMONIC`               | —                                                                                  | BIP39 mnemonic (else `~/.payraminfo/headless-wallet-secret.txt`) |
| `PAYRAM_SCW_MIN_BALANCE_ETH`    | unset (any balance lets the deploy try)                                            | Optional hard minimum before deploying                           |
| `PAYRAM_SCW_SKIP_BALANCE_CHECK` | —                                                                                  | Skip balance polling (not recommended)                           |
| `PAYRAM_FORCE_DEPLOY`           | —                                                                                  | `1` deploys another SCW even if one is linked                    |

---

## Typical Agent Workflow

### 1. Install on testnet (USDC on Base)

```bash
ssh -t root@<server>
bash <(curl -fsSL https://payram.com/setup_payram_agents.sh) --testnet --skip-mcp-server
```

The flow prints a deployer address and waits for gas. Relay the address to the human and ask them to fund it with Base Sepolia ETH:

- https://www.alchemy.com/faucets/base-sepolia
- https://faucet.quicknode.com/base/sepolia

Faucets are free but often gated (an account, a mainnet balance or a social post). The step is resumable: re-running continues the wait.

### 2. Verify from outside

```text
payram_doctor { "baseUrl": "https://pay.example.com" }
```

This is a public check that needs no credentials: reachability, health, TLS, version and workers.

### 3. Human hand-offs

Hand over the root credentials privately, and have the human save **Settings → Site URL** from the public domain (see the table above).

### 4. Create a payment link

```bash
export PAYRAM_PAYMENT_EMAIL="customer@example.com"
export PAYRAM_PAYMENT_AMOUNT="49.99"
bash <(curl -fsSL https://payram.com/setup_payram_agents.sh) create-payment-link
```

**Payment URL format:**

```
https://pay.example.com/payments?reference_id=<reference-id>
```

Use the exact URL printed. If it starts with `http://localhost`, the Site URL has not been set from the public domain yet. Creating a payment cancels that customer's other open payments.

### 5. Add chains

```bash
# More EVM chains (the deployer needs gas on that chain)
PAYRAM_BLOCKCHAIN_CODE=ETH     bash <(curl -fsSL https://payram.com/setup_payram_agents.sh) deploy-scw
PAYRAM_BLOCKCHAIN_CODE=POLYGON bash <(curl -fsSL https://payram.com/setup_payram_agents.sh) deploy-scw

# Bitcoin (xpub, no gas)
bash <(curl -fsSL https://payram.com/setup_payram_agents.sh) ensure-wallet
```

Tron wallets are added in the dashboard. You can also skip running a node: **Smart Bridge** rails (Solana, Bitcoin, Tron-USDT, BNB Chain) settle as USDC on Base. See `payram_runbook` tasks `add_chain` and `smart_bridge`.

---

## Smart Contract Wallet (SCW) Deployment

`deploy-scw-flow`:

1. **Mnemonic:** creates a BIP39 seed at `~/.payraminfo/headless-wallet-secret.txt`, or reuses the existing one.
2. **Deployer:** derives the EVM address to fund.
3. **Balance watch:** polls the RPC until the deployer holds gas. On mainnet with the default chain, it accepts ETH on Base **or** Ethereum (same address).
4. **Deploy:** runs `scripts/deploy-scw-eth.js`.
5. **Register & link:** adds the SCW to the backend and links it to the project.

### Mainnet

Mainnet deploys stop unless both of these are set. Both are human decisions:

```bash
export PAYRAM_FUND_COLLECTOR="0x..."       # the human's COLD wallet (sweep destination)
export PAYRAM_ACCEPT_MAINNET_COSTS=1       # only after the human approved ~$10 of gas
```

Going live means a **new mainnet server**. Do not re-run `--mainnet` on a testnet install: it does not reinstall, and a contract deploy can target the wrong network. See `payram_runbook` task `mainnet_cutover`.

---

## Files and Secrets

| Path                                       | Contents                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| `~/.payraminfo/root-credentials.env`       | Root email/password (mode 600)                                               |
| `~/.payraminfo/headless-tokens.env`        | JWT access/refresh tokens (refresh with `signin`)                            |
| `~/.payraminfo/merchant-api-key.env`       | Project API key (records a localhost base URL; use the public URL elsewhere) |
| `~/.payraminfo/headless-wallet-secret.txt` | Deployer mnemonic: back it up offline                                        |
| `~/.payraminfo/aes/`                       | AES key: back it up **with** the database                                    |
| `~/.payraminfo/config.env`                 | Image tag, network, DB, SSL, ports                                           |

The project API key can create payments **and payouts**. Keep it server-side, and never put it in browser code or a chat. Never commit `~/.payraminfo/`.

---

## Troubleshooting

| Issue                                     | Solution                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Install exits immediately**             | No TTY. Run it inside `ssh -t`, and never through `curl … \| bash`.                                                            |
| **`./setup_payram_agents.sh`: not found** | The one-liner leaves no file on disk. Use `bash <(curl -fsSL https://payram.com/setup_payram_agents.sh) <command>`.            |
| **API unreachable**                       | `curl -s http://localhost/api/v1/health` on the server; `docker ps \| grep payram`; `payram_doctor`.                           |
| **401 Unauthorized**                      | Token expired: run the `signin` command.                                                                                       |
| **Payment creation returns 500**          | The project needs exactly one linked deposit wallet, and the server URL must be set. Run `ensure-config` and check the wallet. |
| **Payment links show `localhost`**        | The human must save Settings → Site URL from the public domain.                                                                |
| **deploy-scw RPC 401**                    | Don't use placeholder RPC URLs; unset `PAYRAM_ETH_RPC_URL` to use the keyless default.                                         |
| **INSUFFICIENT_FUNDS during deploy**      | Fund the printed deployer address, then re-run (resumable).                                                                    |
| **Backend errors**                        | See `~/.payram-core/log/` (`docker logs payram` shows only startup output) or `payram_ops_playbook` task `logs`.               |
| **Docker can't reach the localhost API**  | Use `--node-mode=host` or `PAYRAM_API_URL=http://host.docker.internal`.                                                        |

### Reset a test install

`reset-local` **destroys** the install: it deletes the container, the database, the AES key (the hot-wallet key becomes unrecoverable), the wallet mnemonic and the root credentials.

- Use it **only on a disposable testnet server**, never on mainnet or anywhere with real funds or data.
- **Back up first** (`payram_runbook` task `backup`) and get the human's explicit OK.
- **Never add `-y`.** Let it ask for confirmation.

```bash
bash <(curl -fsSL https://payram.com/setup_payram_agents.sh) reset-local
```

The full procedure is `payram_runbook` task `reset_test_install`.

---

## Integration with MCP Clients

```json
{
  "mcpServers": {
    "payram": {
      "url": "https://mcp.payram.com/mcp"
    }
  }
}
```

The hosted MCP **never holds your credentials**. Use it like this:

| Tool                  | Use it for                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `payram_setup_plan`   | The install plan (`path: "agent"`)                                                                                                     |
| `payram_doctor`       | Public, credential-free server check by URL                                                                                            |
| `payram_ops_playbook` | Day-2 API recipes you run yourself with the credentials in `~/.payraminfo` (`connect`, `daily_check`, `node_sync`, `unswept_funds`, …) |
| `payram_runbook`      | Admin tasks: `set_site_url`, `ssl_setup`, `firewall_ports`, `upgrade`, `backup`, `add_chain`, `mainnet_cutover`, …                     |

Live data tools (`search_payments`, `create_payment_link`, `check_node_sync`, …) exist only when you run the MCP yourself in local mode (`PAYRAM_MCP_MODE=local`, with `PAYRAM_*` credentials in its environment).

---

## Related Skills

| Skill                                                                                                            | Purpose                               |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| [`payram-agent-journey`](https://github.com/payram/payram-mcp/tree/main/skills/payram-agent-journey)             | End-to-end map (merchant or operator) |
| [`payram-setup`](https://github.com/payram/payram-mcp/tree/main/skills/payram-setup)                             | Install flow with the web dashboard   |
| [`payram-testnet-testing`](https://github.com/payram/payram-mcp/tree/main/skills/payram-testnet-testing)         | Full testnet round trip               |
| [`payram-payment-integration`](https://github.com/payram/payram-mcp/tree/main/skills/payram-payment-integration) | Integrate payments into applications  |
| [`payram-webhook-integration`](https://github.com/payram/payram-mcp/tree/main/skills/payram-webhook-integration) | Verify and handle signed webhooks     |

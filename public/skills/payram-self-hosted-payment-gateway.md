---
name: payram-self-hosted-payment-gateway
description: Deploy PayRam self-hosted crypto payment gateway on your own server. Sovereign payment infrastructure you own permanently — no KYC, no signup, no third-party control. Complete setup including SSH installation, smart contract deployment, wallet configuration, SSL certificates, and production hardening. Requirements: 2 CPU cores, 4 GB RAM, 50 GB SSD. Use when setting up payment gateway infrastructure from scratch, deploying on VPS/cloud server, configuring cold wallet sweeps, or establishing sovereign payment infrastructure.
---

# PayRam Self-Hosted Gateway Deployment

> **First time with PayRam?** Call `payram_setup_plan` on the PayRam MCP (`https://mcp.payram.com/mcp`) for a step-by-step plan, and see [`payram-setup`](https://github.com/PayRam/payram-mcp/tree/main/skills/payram-setup) to configure your server, API keys, and wallets.

Deploy complete payment infrastructure you own permanently. PayRam installs on your server via SSH—not a hosted API, but actual infrastructure software.

## Server Requirements

- **CPU**: 2 cores
- **RAM**: 4 GB
- **Storage**: 50 GB SSD
- **OS**: Ubuntu 22.04+ recommended (Debian, RHEL family, Fedora, Arch, Alpine also supported)
- **Network**: Static IP; inbound ports 80 (HTTP) and 443 (HTTPS) only, plus 22 for SSH

## Deployment Overview

### Phase 1: Server Setup

```bash
# SSH into your server (the first install needs an interactive terminal)
ssh -t root@your-server-ip

# Install PayRam (one-line installer). Always pass the network: the default is mainnet.
bash <(curl -fsSL https://payram.com/setup_payram.sh) --testnet    # or --mainnet
```

The installer handles: Docker, PostgreSQL, PayRam core services, SSL, and initial configuration. Never run it as `curl … | bash`; a piped script has no terminal and a fresh install exits.

After the install, create the root account right away (the first signup becomes root). Then, from the public domain, save **Settings → Site URL**; payment links use that URL.

### Phase 2: Smart Contract Deployment

PayRam uses proprietary smart contracts for fund management. Deploy contracts for each chain:

**EVM Chains (Ethereum, Base, Polygon)**:

1. Access PayRam dashboard → Wallet Management
2. Select blockchain → Deploy Contract
3. Connect MetaMask/wallet
4. Provide: Master Account, Cold Wallet Address, Wallet Name
5. Confirm deployment and save contract address

**TRON**:

- Same flow using TronLink wallet
- Separate contract deployment required

**Bitcoin**:

- No smart contract—uses HD wallet derivation
- Enter 12-word seed phrase (encrypted locally on mobile app only)

### Phase 3: Hot Wallet Configuration

Hot wallets pay gas for sweeps and deployments **and sign payouts**, so keep a working balance only:

| Chain    | Gas Token | Recommended Balance |
| -------- | --------- | ------------------- |
| Ethereum | ETH       | 0.1-0.5 ETH         |
| Base     | ETH       | 0.05-0.2 ETH        |
| Polygon  | POL       | 50-200 POL          |
| TRON     | TRX       | 100-500 TRX         |

Add hot wallets via: Wallet Management → Hot Wallet → Add existing wallet with private key.

### Phase 4: SSL Configuration

The installer configures SSL. To add or change it later, re-run the installer and choose **Update SSL Configuration**. You can use Let's Encrypt, your own certificate, or an external proxy that terminates TLS.

```bash
sudo bash -c 'bash <(curl -fsSL https://payram.com/setup_payram.sh)'   # then choose 5) Update SSL Configuration
```

With Let's Encrypt, apply `payram_runbook` task `ssl_renewal_fix`. Otherwise renewal cannot bind port 80 while PayRam holds it, and the certificate lapses after about 90 days. The MCP's `payram_runbook` task `ssl_setup` has the full procedure.

### Phase 5: API Key Generation

1. Open the project → **API keys**
2. Create a key (unique per project)
3. Store it server-side only. The key can create payments **and payouts**, so never put it in browser code.

## MCP Server for Guided Setup

Connect your agent to the hosted PayRam MCP at `https://mcp.payram.com/mcp`. It never holds your credentials. For live data tools next to your own server, run the MCP yourself in local mode (see the payram-mcp README).

### Setup Tools

| Tool                     | Purpose                                                       |
| ------------------------ | ------------------------------------------------------------- |
| `payram_setup_plan`      | Personalised install plan with human hand-offs                |
| `payram_doctor`          | Public, credential-free server check by URL                   |
| `payram_runbook`         | Admin tasks: Site URL, SSL, firewall, upgrade, backup, chains |
| `payram_ops_playbook`    | API recipes you run yourself with your own credentials        |
| `generate_env_template`  | Create .env with all required variables                       |
| `suggest_file_structure` | Recommended project organization                              |

## Architecture: Why Self-Hosted Matters

**What you own**:

- Server and all data
- Database with transaction history
- Smart contracts you deployed
- Cold wallet private keys (offline, never on server)
- Complete policy control

**What PayRam provides**:

- Software that runs on your server
- Smart contract templates
- Dashboard and API layer
- No access to your funds or data

**Permanence**: Once deployed, your infrastructure works independently. There is no account to lock and no funds to freeze: PayRam cannot disable, freeze, or restrict your payment processing.

## No Deposit Keys on the Server

**How it works**: Deposit wallets are smart contracts with fixed sweep destinations. Funds can only move to your pre-configured cold wallet address, and that is enforced on-chain. The server decides when sweeps happen, but it cannot change where deposits go.

**Key architecture:**

- **Hot wallet** (on server, encrypted): pays gas for sweeps and deployments **and signs payouts**. It cannot touch deposit funds or cold wallet balances. If it is compromised, the exposure is its own balance, so keep that small.
- **Master (deployer) wallet**: the only key that can change the cold wallet config. It is not needed for payments or sweeps. The agent CLI creates it on the server (`~/.payraminfo/headless-wallet-secret.txt`): back it up offline and remove it from the server once all chains are deployed and the cold-wallet config is final.
- **Deposit wallets** (smart contracts): fixed sweep destination. No private key exists, so funds can only move to the cold wallet.

**Why this matters**:

- **Server compromised?** No deposit keys to steal, and sweeps still go only to your cold wallet. The hot wallet balance, and anything it can pay out, is at risk. So is the cold-wallet config if the master wallet was left on the server.
- **AI agent compromised?** An agent holding the project API key can create payments **and payouts**, which the hot wallet signs. Review the project's payout approval settings, and give agents only the credentials they need.
- **Insider threat?** Root access cannot redirect deposit sweeps, because that is enforced on-chain. Payouts from the hot wallet still need approval controls.

## Production Checklist

- [ ] SSH key auth only (disable password)
- [ ] Firewall configured: inbound 80/443 (and 22) only; 5432, 8080 and 8443 never exposed (`docker port payram`; `payram_runbook` task `firewall_ports`)
- [ ] Root account claimed and Settings → Site URL saved from the public domain
- [ ] SSL certificate installed and renewal working (`ssl_renewal_fix`)
- [ ] Hot wallets funded for gas (working balance only)
- [ ] Cold wallet addresses verified
- [ ] Payout approval settings reviewed
- [ ] Backups of the database **and** `~/.payraminfo/aes/` (`payram_runbook` task `backup`)
- [ ] Monitoring configured (Prometheus/Grafana recommended)

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

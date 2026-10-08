import {
  CONTAINER,
  INSTALL,
  LINKS,
  NETWORK,
  SMART_BRIDGE,
  SWEEP_STATUS,
  WEBHOOK,
} from '../facts/payram.js';

/**
 * The troubleshooting bank: known PayRam problems in the words people use,
 * with how to confirm each one and what to do. It points people at the next
 * step; it deliberately does not explain how PayRam works inside.
 *
 * Add an entry here (not in prose elsewhere) when a new problem shows up.
 * `signs` are lowercase fragments of what people type or paste; `see` names
 * real payram_runbook / payram_ops_playbook tasks (tests check they exist).
 */

export const AREAS = [
  'install',
  'network',
  'ssl',
  'config',
  'payments',
  'deposits',
  'sweeps',
  'webhooks',
  'api',
  'operations',
  'apps',
] as const;
export type Area = (typeof AREAS)[number];

export interface Issue {
  id: string;
  area: Area;
  /** The problem in a user's words. */
  title: string;
  /** Lowercase fragments of the error text or description that point here. */
  signs: readonly string[];
  /** Stronger matches for pasted output. */
  patterns?: readonly RegExp[];
  /** What it usually means, in plain words. */
  meaning: string;
  /** How to confirm it: commands on the server or dashboard clicks. */
  confirm: readonly string[];
  fix: readonly string[];
  /** Why a human must decide or act, when they must. */
  needsHuman?: string;
  see?: readonly {
    tool: 'payram_runbook' | 'payram_ops_playbook' | 'payram_doctor' | 'payram_setup_plan';
    task?: string;
  }[];
  /** What to paste back if this does not resolve it. */
  paste?: string;
}

const sweepFixes = Object.entries(SWEEP_STATUS).map(([code, text]) => `${code}: ${text}`);

export const ISSUES: readonly Issue[] = [
  // ── install ──────────────────────────────────────────────────────
  {
    id: 'installer-no-terminal',
    area: 'install',
    title: 'The installer exits straight away or never asks its questions',
    signs: [
      'not a tty',
      'no tty',
      'stdin is not a terminal',
      '/dev/tty',
      'curl | bash',
      'exits immediately',
      'installer exits',
      'does not ask',
    ],
    meaning:
      'The installer asks a few one-time questions (database, SSL, port) and needs a real terminal. A piped script (curl … | bash) or a non-interactive session has none.',
    confirm: ['Did you run it as `curl … | bash` or from an automation without a terminal?'],
    fix: [
      'Open an interactive SSH session (`ssh -t user@server`) and run the installer with process substitution, not a pipe:',
      INSTALL.installer,
      'After that first run everything else is headless.',
    ],
    see: [{ tool: 'payram_runbook', task: 'install_failed' }, { tool: 'payram_setup_plan' }],
  },
  {
    id: 'installer-script-error',
    area: 'install',
    title: 'The installer script stops with a shell syntax error',
    signs: [
      'declare: -g',
      'invalid option',
      'declare: usage',
      'syntax error near',
      'unexpected token',
      'bad substitution',
      'bash: line',
    ],
    patterns: [/declare:\s*-g/i, /bad substitution/i],
    meaning:
      'Usually an old or unusual shell (macOS default bash 3.2, nix-shell, busybox) running a script written for a standard Linux bash. Current scripts avoid the old-bash problem, so re-fetching is the first thing to try.',
    confirm: [
      '`bash --version` and `uname -a`',
      'Are you on a Linux server (Ubuntu or Debian) or on a laptop/dev shell?',
    ],
    fix: [
      'Re-run the current one-liner (it always downloads the latest script).',
      'If it still fails, run it on a normal Ubuntu 22.04+ or Debian VPS instead of a laptop or nix shell. macOS is for testing only.',
    ],
    paste:
      'The first 5 lines of the error plus the output of `bash --version` and `cat /etc/os-release`.',
    see: [{ tool: 'payram_runbook', task: 'install_failed' }],
  },
  {
    id: 'unsupported-os',
    area: 'install',
    title: 'The installer says the operating system is unsupported',
    signs: [
      'unsupported os',
      'unsupported operating system',
      'unable to detect',
      'could not detect os',
      'package manager not found',
      'unknown distro',
    ],
    meaning: 'The installer could not match the system to a supported Linux family.',
    confirm: ['`cat /etc/os-release`'],
    fix: [
      'Use Ubuntu 22.04+ (recommended). Debian, RHEL family, Fedora, Arch and Alpine are also supported; macOS is for testing only.',
    ],
    paste: 'The output of `cat /etc/os-release` and `uname -m`.',
    see: [{ tool: 'payram_runbook', task: 'install_failed' }],
  },
  {
    id: 'docker-problem',
    area: 'install',
    title: 'Docker is missing, not running, or refuses access',
    signs: [
      'docker: command not found',
      'cannot connect to the docker daemon',
      'permission denied while trying to connect',
      'is the docker daemon running',
      'docker.sock',
      'docker daemon',
    ],
    meaning:
      'Docker is not installed, the service is stopped, or the current user may not talk to it.',
    confirm: [
      '`docker --version`',
      '`sudo systemctl status docker`',
      '`docker ps` (does it need sudo?)',
    ],
    fix: [
      'Run the installer as root or via sudo: ' + INSTALL.installerAsRoot,
      'If Docker is installed but stopped: `sudo systemctl enable --now docker`.',
    ],
    see: [{ tool: 'payram_runbook', task: 'install_failed' }],
  },
  {
    id: 'port-in-use',
    area: 'install',
    title: 'Port 80 or 443 is already in use',
    signs: [
      'address already in use',
      'port is already allocated',
      'bind: address already in use',
      'port 80 is in use',
      'port 443 is in use',
      'ports are not available',
    ],
    meaning:
      'Another program (Apache, nginx, Caddy, another container) is listening on a port PayRam needs.',
    confirm: ["`sudo ss -ltnp | grep -E ':(80|443)\\b'` shows what holds the port."],
    fix: [
      'Stop or reconfigure that program, then re-run the installer.',
      "If it must stay, choose another port at the installer's port question, but then Let's Encrypt (needs 80) will not work and every URL (site URL, webhook URL) needs the port. Prefer a dedicated server or a reverse proxy in front.",
    ],
    see: [{ tool: 'payram_runbook', task: 'custom_port_or_proxy' }],
  },
  {
    id: 'low-disk-or-memory',
    area: 'install',
    title: 'Out of disk space or memory during install or later',
    signs: [
      'no space left on device',
      'less than 5 gb',
      'insufficient disk',
      'out of memory',
      'oom-kill',
      'oom killed',
      'cannot allocate memory',
      'disk full',
    ],
    meaning:
      'The server is smaller than the minimum or the disk filled up (logs, Docker images, database).',
    confirm: ['`df -h /` and `docker system df`', '`free -m`'],
    fix: [
      'Minimum is 2 CPU cores, 4 GB RAM and 50 GB SSD; the installer refuses with under 5 GB free.',
      'Free space: `docker image prune` for unused images; archive old logs under ~/.payram-core/log/. Resize the server if it is simply too small.',
    ],
    needsHuman:
      'Resizing or deleting data is the owner’s call; take a backup first (payram_runbook "backup").',
    see: [
      { tool: 'payram_runbook', task: 'install_failed' },
      { tool: 'payram_runbook', task: 'backup' },
    ],
  },
  {
    id: 'install-download-failed',
    area: 'install',
    title: 'The installer or the Docker image cannot be downloaded',
    signs: [
      'could not resolve host',
      'curl: (6)',
      'curl: (7)',
      'curl: (35)',
      'failed to connect',
      'toomanyrequests',
      'rate limit',
      'pull access denied',
      'tls handshake timeout',
      'network is unreachable',
    ],
    meaning:
      'The server cannot reach payram.com or the image registry (DNS, outbound firewall, proxy) or the registry is rate limiting.',
    confirm: [
      '`curl -I https://payram.com/setup_payram.sh`',
      '`getent hosts registry-1.docker.io`',
    ],
    fix: [
      'Fix DNS or the outbound firewall (HTTPS/443 out must work). For a registry rate limit, wait and retry or sign in to Docker Hub (`docker login`).',
    ],
    see: [{ tool: 'payram_runbook', task: 'install_failed' }],
  },
  {
    id: 'wallet-deploy-needs-gas',
    area: 'install',
    title: 'The wallet step pauses or fails with insufficient funds',
    signs: [
      'insufficient funds',
      'insufficient_funds',
      'deployer address',
      'out of gas',
      'fund the deployer',
      'needs gas',
      'gas required',
    ],
    meaning:
      'Deploying the smart-contract deposit wallet costs a little gas, paid from a deployer address the installer prints. It waits until that address holds funds.',
    confirm: ['Look for the deployer address in the installer output.'],
    fix: [
      'Testnet: send Base Sepolia ETH from a faucet to the printed address. Mainnet: send about $10 of ETH on the chain being deployed.',
      'Then re-run the wallet step: ' + INSTALL.agentCmd('deploy-scw-flow'),
    ],
    needsHuman: 'Mainnet gas is real money: the owner must approve and send it.',
    see: [{ tool: 'payram_setup_plan' }],
  },
  {
    id: 'rpc-unauthorized',
    area: 'install',
    title: 'The wallet step fails with an RPC 401/403',
    signs: ['rpc url', 'placeholder', 'rpc 401', '401 unauthorized rpc', 'rpc error', 'json-rpc'],
    meaning: 'A placeholder or invalid RPC URL was supplied to the wallet step.',
    confirm: ['Check whether you set an RPC URL environment variable for the deploy.'],
    fix: [
      'Unset any placeholder RPC URL so the built-in default is used, or set a real provider URL, then re-run the wallet step.',
    ],
    see: [{ tool: 'payram_runbook', task: 'install_failed' }],
  },
  // ── network and SSL ──────────────────────────────────────────────
  {
    id: 'dashboard-unreachable',
    area: 'network',
    title: 'The dashboard or checkout page does not open',
    signs: [
      "this site can't be reached",
      'err_connection_timed_out',
      'err_connection_refused',
      'connection timed out',
      'connection refused',
      "can't reach",
      'cannot reach the dashboard',
      'site not loading',
      'ssh works but',
    ],
    meaning:
      'Nothing answers on the public ports: a cloud or server firewall is blocking them, the container is down, or the address is wrong.',
    confirm: [
      'On the server: `curl -s http://localhost/api/v1/health` (does it answer?)',
      `On the server: \`docker ps --filter name=${CONTAINER.name}\` and \`docker port ${CONTAINER.name}\``,
      'From another machine: `curl -I http://<server-ip>`',
    ],
    fix: [
      'Answers on the server but not outside: open inbound 80 and 443 in the cloud provider firewall (security group) and in ufw.',
      `No container or not answering: ${INSTALL.restart}`,
      'Do not use :8080/:8443; current installs serve everything on 80/443.',
    ],
    see: [{ tool: 'payram_doctor' }, { tool: 'payram_runbook', task: 'firewall_ports' }],
    paste: 'The output of the three commands above.',
  },
  {
    id: 'dns-not-pointing',
    area: 'network',
    title: 'The domain does not resolve to the server',
    signs: [
      'dns_probe_finished_nxdomain',
      'nxdomain',
      'name not resolved',
      'no such host',
      'could not resolve',
      'server dns address could not be found',
      'enotfound',
    ],
    meaning:
      'The domain has no A record, or it points somewhere else, or DNS has not propagated yet.',
    confirm: ['`dig +short <domain>` must print the server’s public IP.'],
    fix: [
      'Create or correct the A record (and AAAA if the server has IPv6). Wait for propagation; Let’s Encrypt fails until it resolves.',
    ],
    see: [{ tool: 'payram_runbook', task: 'change_domain' }],
  },
  {
    id: 'letsencrypt-failed',
    area: 'ssl',
    title: "Let's Encrypt cannot issue a certificate",
    signs: [
      'acme',
      "let's encrypt",
      'letsencrypt',
      'challenge failed',
      'too many certificates',
      'failed authorization',
      'timeout during connect',
      'certbot',
      'unauthorized :: invalid response',
    ],
    meaning:
      'The challenge needs the domain to reach this server on port 80. Common blockers: DNS not pointing here, port 80 closed or busy, a proxy in front, or issuance rate limits.',
    confirm: [
      '`dig +short <domain>`',
      "`sudo ss -ltnp | grep ':80'`",
      'From outside: `curl -I http://<domain>`',
    ],
    fix: [
      'Fix DNS first, free port 80, open 80 in the cloud firewall, then retry through the installer menu: ' +
        INSTALL.sslMenu,
      "Behind Cloudflare or another proxy, use the 'proxy' SSL option instead (the proxy terminates TLS).",
      'A rate-limit message means wait (usually a week for duplicates) or use a different hostname.',
    ],
    see: [{ tool: 'payram_runbook', task: 'ssl_setup' }],
  },
  {
    id: 'certificate-expired',
    area: 'ssl',
    title: 'The certificate expired or the browser warns about it',
    signs: [
      'certificate has expired',
      'err_cert_date_invalid',
      'ssl certificate problem',
      'certificate expired',
      'your connection is not private',
      'cert_has_expired',
      'certificate verify failed',
    ],
    meaning:
      "Let's Encrypt certificates last about 90 days; renewal fails when it cannot use port 80.",
    confirm: ['`payram_doctor` shows the days remaining.'],
    fix: [
      'Follow the renewal-fix runbook, then check that port 80 stays reachable for future renewals.',
    ],
    see: [{ tool: 'payram_runbook', task: 'ssl_renewal_fix' }, { tool: 'payram_doctor' }],
  },
  {
    id: 'cloudflare-or-proxy-errors',
    area: 'ssl',
    title: 'Cloudflare or another proxy shows 52x errors or a redirect loop',
    signs: [
      'error 521',
      'error 522',
      'error 523',
      'error 524',
      'error 525',
      'error 526',
      'web server is down',
      'connection timed out cloudflare',
      'too many redirects',
      'err_too_many_redirects',
      'cloudflare',
    ],
    meaning:
      'The proxy cannot reach or trust the origin: 521/522/523/524 = origin down, blocked or slow; 525/526 = TLS mismatch between the proxy and the server; redirect loop = the proxy speaks HTTP to an origin that redirects to HTTPS.',
    confirm: [
      'On the server: `curl -s http://localhost/api/v1/health`',
      'In the proxy dashboard: the SSL/TLS mode',
    ],
    fix: [
      '52x: make sure the container is up and the proxy’s IPs can reach 80/443 (cloud firewall).',
      "525/526 and loops: use SSL mode 'Full' (or 'Full (strict)' with a valid origin certificate), never 'Flexible', and install with the proxy SSL option so the proxy forwards to http://<server>:80 with X-Forwarded-Proto: https.",
    ],
    see: [{ tool: 'payram_runbook', task: 'custom_port_or_proxy' }],
  },
  {
    id: 'gateway-5xx',
    area: 'network',
    title: '502, 503 or 504 from the server',
    signs: [
      '502 bad gateway',
      '503 service unavailable',
      '504 gateway time-out',
      'bad gateway',
      'gateway timeout',
      'service temporarily unavailable',
    ],
    meaning:
      'The front web server is up but PayRam behind it is starting, crashed or overloaded. Right after a restart or upgrade this clears in a minute or two.',
    confirm: [
      `\`${CONTAINER.supervisorctl}\` (all should be RUNNING; ${'redis-server FATAL is a known false alarm'})`,
      `\`docker logs --tail 50 ${CONTAINER.name}\``,
    ],
    fix: [
      'Wait 2 minutes after a restart. If it persists, restart the container (see below) and read the backend logs.',
      INSTALL.restart,
      `Backend errors are in ${CONTAINER.logs.app}, not in docker logs.`,
    ],
    see: [
      { tool: 'payram_ops_playbook', task: 'workers' },
      { tool: 'payram_ops_playbook', task: 'logs' },
    ],
    paste:
      'The supervisorctl status output and the last 30 lines of ~/.payram-core/log/payram.log.',
  },
  // ── config ───────────────────────────────────────────────────────
  {
    id: 'links-show-localhost',
    area: 'config',
    title: 'Payment links or emails point to localhost',
    signs: [
      'http://localhost',
      'link opens localhost',
      'payment link localhost',
      'localhost in the link',
      'site url',
      'links are wrong',
    ],
    meaning:
      'The public site URL is not set. A headless install stores http://localhost, which customers cannot open.',
    confirm: [
      'Create a test payment link; does it start with your domain?',
      'payram_ops_playbook "site_url"',
    ],
    fix: [
      'A human saves Settings → Site URL while browsing the public domain (the URL is taken from the page you save it on).',
    ],
    needsHuman: 'Root-only, and it must be done in a browser on the public address.',
    see: [{ tool: 'payram_runbook', task: 'set_site_url' }],
  },
  {
    id: 'payment-create-code-5',
    area: 'config',
    title:
      'Creating a payment fails with code 5 ("error occurred while creating the payment request")',
    signs: [
      '"code":5',
      'code: 5',
      'code 5',
      'error occurred while creating the payment request',
      'payment creation fails',
      'cannot create payment',
      'failed to create payment',
    ],
    patterns: [/"code"\s*:\s*5\b/],
    meaning:
      'Setup is incomplete: the project needs exactly one linked deposit wallet, and the site URL must be set. The error can come back with HTTP 200 or 500, so look at the body, not only the status.',
    confirm: [
      'Dashboard: Project → Wallet shows one linked deposit wallet?',
      'payram_ops_playbook "site_url" and "payment_options"',
    ],
    fix: [
      'Link exactly one deposit wallet (none or several both fail).',
      'Set the site URL.',
      'If you use Smart Bridge, check Payment options.',
    ],
    see: [
      { tool: 'payram_ops_playbook', task: 'site_url' },
      { tool: 'payram_ops_playbook', task: 'payment_options' },
      { tool: 'payram_doctor' },
    ],
    paste: 'The full response body of the failing call (without the API key).',
  },
  {
    id: 'testnet-mainnet-mixup',
    area: 'config',
    title: 'Testnet vs mainnet: I need to switch',
    signs: [
      'switch to mainnet',
      'change network',
      'testnet to mainnet',
      'move to mainnet',
      'went live',
      'wrong network install',
    ],
    meaning: NETWORK.switchRule,
    confirm: ['Your installer flag was --testnet or --mainnet; the dashboard shows the network.'],
    fix: ['Install a fresh server for mainnet (recommended); follow the mainnet cut-over runbook.'],
    needsHuman: 'Mainnet spends real money and chooses the cold wallet.',
    see: [{ tool: 'payram_runbook', task: 'mainnet_cutover' }],
  },
  {
    id: 'external-database',
    area: 'config',
    title: 'I want my own Postgres / managed database, or a production-style layout',
    signs: [
      'external postgres',
      'own postgres',
      'managed database',
      'supabase',
      'rds',
      'external redis',
      'separate redis',
      'single container',
      'production deployment',
    ],
    meaning:
      'PayRam ships as one container with a bundled database by default. The installer’s database question also accepts your own Postgres. Redis is bundled; there is no documented external Redis option.',
    confirm: [
      'Which database did you pick at the installer prompt? (`~/.payraminfo/config.env` records it)',
    ],
    fix: [
      'Choose “your own Postgres” at the installer’s database question and give it a reachable host, a database and credentials. Keep the database off the public internet.',
      'For production resilience, back up the database together with ~/.payraminfo/aes/, and monitor with payram_doctor and the daily check.',
      'Ask the PayRam team before attempting external Redis or multi-node layouts: ' +
        LINKS.community,
    ],
    needsHuman: 'Database choice and credentials are the owner’s decision.',
    see: [
      { tool: 'payram_runbook', task: 'external_database' },
      { tool: 'payram_runbook', task: 'backup' },
    ],
  },
  {
    id: 'custom-port-or-proxy',
    area: 'config',
    title: 'PayRam must run on another port or behind my own reverse proxy',
    signs: [
      'custom port',
      'different port',
      'port 8080',
      'port 8098',
      'behind nginx',
      'reverse proxy',
      'traefik',
      'caddy',
      'not on port 80',
      'another web server',
    ],
    meaning:
      'The installer assumes port 80 (and 443 with SSL). Other layouts work only if every URL PayRam hands out includes the right port or the proxy forwards correctly.',
    confirm: [
      `\`docker port ${CONTAINER.name}\``,
      'What does the proxy forward to, and does it send X-Forwarded-Proto?',
    ],
    fix: [
      'Preferred: keep PayRam on 80/443 on its own server and put the proxy elsewhere.',
      'With a proxy: forward all paths to http://<server>:80, send X-Forwarded-Proto: https, install with the proxy SSL option, and set the site URL to the public address.',
      'A non-80 port also needs that port in the site URL and webhook URLs; Let’s Encrypt cannot validate without port 80.',
    ],
    see: [{ tool: 'payram_runbook', task: 'custom_port_or_proxy' }],
  },
  // ── API ──────────────────────────────────────────────────────────
  {
    id: 'api-unauthorized',
    area: 'api',
    title: 'API calls return 401 Unauthorized',
    signs: [
      '401',
      'unauthorized',
      'invalid api key',
      'invalid-api-key',
      'token expired',
      'jwt expired',
      'invalid token',
      'not authorized',
    ],
    meaning:
      'Wrong or missing credential for the endpoint: payment APIs want the project API key (API-Key header); admin APIs want the dashboard login token (Authorization: Bearer). Sending both, or an expired or rotated one, fails.',
    confirm: ['payram_ops_playbook "connect" mints and tests both credentials.'],
    fix: [
      'Use only the header the endpoint needs.',
      'Expired login token: sign in again. Rotated or deactivated key: create a new one.',
    ],
    see: [
      { tool: 'payram_ops_playbook', task: 'connect' },
      { tool: 'payram_runbook', task: 'rotate_api_key' },
    ],
  },
  {
    id: 'api-not-found',
    area: 'api',
    title: 'An API route returns 404',
    signs: [
      '404 not found',
      'page not found',
      '404 page not found',
      'cannot get /api',
      'route not found',
      '/api/v1/wallets',
    ],
    meaning:
      'The path is wrong (a stale doc, or the server version predates or has since replaced the route). The API is same-origin with the dashboard on 80/443.',
    confirm: [
      '`curl -s <url>/api/v1/version`',
      'Compare with the version your docs or app target.',
    ],
    fix: [
      'Use the route from current docs/playbook for your server version; upgrade the server if it is very old.',
    ],
    see: [{ tool: 'payram_ops_playbook', task: 'version_check' }],
  },
  {
    id: 'mobile-app-wallet-load',
    area: 'apps',
    title: 'The PayRam Business mobile app says “unable to load wallet”',
    signs: [
      'unable to load wallet',
      'payram business',
      'mobile app',
      'pair',
      'qr code pairing',
      'business app',
    ],
    meaning:
      'Pairing and sign-in worked but the app asks for a wallet route that newer servers (3.x) no longer provide. This is an app/server version mismatch, not something wrong with your install.',
    confirm: ['Server version via payram_doctor; app version in the store.'],
    fix: [
      'Use the web dashboard for wallet views for now, and ask the PayRam team whether an app update for your server version is out: ' +
        LINKS.community,
    ],
    paste: 'Server version and app version.',
  },
  // ── payments and deposits ────────────────────────────────────────
  {
    id: 'payment-open-no-address',
    area: 'payments',
    title: 'A payment stays OPEN with empty chain, currency and deposit address',
    signs: [
      'stays open',
      'stuck open',
      'still open',
      'depositaddress": null',
      'depositaddress null',
      'currencysymbol null',
      'filledamount null',
      'never changes from open',
      'payment not filling',
      'session never fills',
    ],
    meaning:
      'A payment created through the API starts OPEN with no network, token or deposit address. Those are filled in once the customer picks a network and currency on the checkout page. If they are still empty, the customer has not got that far, so no deposit can be matched to this payment.',
    confirm: [
      'Fetch the payment (payram_ops_playbook "payment_lookup"): are currency, blockchain and deposit address empty?',
      'Open the payment link yourself and see whether the picker appears.',
    ],
    fix: [
      'Ask the customer to open the link and choose network and currency, then pay the address shown.',
      'If they already paid somewhere else, see the “paid but not credited” entry.',
      'Do not create a new link for the same customer meanwhile: it cancels their open payments.',
    ],
    see: [{ tool: 'payram_ops_playbook', task: 'stuck_payment' }],
    paste: 'The payment JSON (state, amounts, currency, blockchain, deposit address; no keys).',
  },
  {
    id: 'deposit-not-credited',
    area: 'deposits',
    title: 'A customer paid on-chain but the payment is not credited',
    signs: [
      'paid but not',
      'not credited',
      'deposit not detected',
      'funds not received',
      'transaction not showing',
      'missed deposit',
      'tx not found',
      'payment not detected',
      'customer paid',
      'money sent but',
    ],
    meaning:
      'Either the money went to a different address, network or token than the payment expects, PayRam has not seen the block yet, or it needs more confirmations. Funds sent to a deposit address are not lost; they show up as unswept or missed deposits.',
    confirm: [
      'Block explorer: right network, right token, right address (each payment has its own)?',
      'payram_ops_playbook "node_sync": is that chain’s listener caught up?',
      'payram_ops_playbook "stuck_payment": is the deposit listed as missed?',
      'Confirmations: payments wait for the chain’s required confirmations before they count.',
    ],
    fix: [
      'Wait for confirmations and a caught-up listener.',
      'Smart Bridge payments settle as Base USDC: look under BASE.',
      'Reporting a transaction as a missed deposit records it, but in reports it did not always fill the original payment. Credit it manually and send the support team the transaction hash.',
    ],
    needsHuman: 'Crediting or refunding is a business decision.',
    see: [
      { tool: 'payram_ops_playbook', task: 'stuck_payment' },
      { tool: 'payram_ops_playbook', task: 'node_sync' },
    ],
    paste: 'Network, token, amount, transaction hash, and the payment reference id (no keys).',
  },
  {
    id: 'payment-partial-or-over',
    area: 'payments',
    title: 'Payment is PARTIALLY_FILLED or OVER_FILLED',
    signs: [
      'partially_filled',
      'partially filled',
      'over_filled',
      'overfilled',
      'underpaid',
      'overpaid',
      'paid too little',
      'paid too much',
    ],
    meaning:
      'The customer sent less or more than requested (exchange fees are a common cause of short payments).',
    confirm: ['Compare filled and requested amounts (payment_lookup).'],
    fix: [
      'Short: the customer tops up the same address. Over: refund or credit the difference. Decide your policy before fulfilling.',
    ],
    needsHuman: 'Whether to fulfil, refund or credit is a business decision.',
    see: [{ tool: 'payram_ops_playbook', task: 'payment_lookup' }],
  },
  // ── webhooks ─────────────────────────────────────────────────────
  {
    id: 'webhook-not-arriving',
    area: 'webhooks',
    title: 'My server never receives webhooks',
    signs: [
      'webhook not received',
      'no webhook',
      'webhook not firing',
      'not receiving webhooks',
      'webhook delivery failed',
      'webhooks not working',
      'webhook never arrives',
    ],
    meaning:
      'Common causes: no webhook URL saved, the URL is not reachable from the internet (PayRam refuses private/internal addresses), your endpoint answers slowly or with an error (PayRam retries on a schedule), or the webhook worker is down.',
    confirm: [
      'Is a webhook URL saved for the project, and is it a public https URL?',
      'payram_ops_playbook "webhooks": delivery state and the worker.',
      'Your endpoint logs: did a request arrive and what did you answer?',
    ],
    fix: [
      'Use a public URL (for local development use a tunnel such as ngrok).',
      `Answer 2xx quickly. Retries: ${WEBHOOK.retries}. ${WEBHOOK.cancelled}`,
      'If the worker is down, restart it with the human’s OK.',
    ],
    see: [
      { tool: 'payram_ops_playbook', task: 'webhooks' },
      { tool: 'payram_ops_playbook', task: 'workers' },
    ],
  },
  {
    id: 'webhook-signature-mismatch',
    area: 'webhooks',
    title: 'My webhook handler rejects PayRam’s request (401 / invalid signature)',
    signs: [
      'invalid-webhook-signature',
      'invalid-webhook-key',
      'signature mismatch',
      'invalid signature',
      'x-payram-signature',
      'webhook 401',
      'webhook unauthorized',
      'hmac',
    ],
    meaning: `${WEBHOOK.signature}. Mismatches come from verifying re-serialised JSON instead of the raw bytes, using the wrong key (the project’s newest active API key; a rotated key changes it), or an old handler that still checks the legacy API-KEY header.`,
    confirm: [
      'Is the handler reading the raw request body before parsing?',
      'Is the key the same project’s newest active API key?',
    ],
    fix: [
      'Regenerate the handler with generate_webhook_handler, which verifies the signature over the raw body.',
      WEBHOOK.verify,
    ],
    see: [{ tool: 'payram_ops_playbook', task: 'webhooks' }],
  },
  {
    id: 'webhook-test-button',
    area: 'webhooks',
    title: 'The dashboard “Test connection” sends an empty API-KEY header',
    signs: [
      'test connection',
      'empty api-key',
      'webhook test',
      'test webhook',
      'x-webhook-test',
      'payout.ping',
      'ping',
    ],
    meaning:
      'The test is a signed ping (header X-Webhook-Test: true, no reference_id). Do not authenticate it by the API-KEY header: verify X-Payram-Signature like any webhook. An empty legacy header can also mean the project has no active API key.',
    confirm: ['Does the project have an active API key?'],
    fix: [
      'Verify the signature header; answer 2xx for the ping without treating it as a payment.',
      'Create an API key if none is active.',
    ],
    see: [{ tool: 'payram_ops_playbook', task: 'webhooks' }],
  },
  // ── sweeps ───────────────────────────────────────────────────────
  {
    id: 'sweep-not-happening',
    area: 'sweeps',
    title: 'Funds are not being swept to my cold wallet',
    signs: [
      'not swept',
      'unswept',
      'sweep stuck',
      'sweep loading',
      'sweep not working',
      'funds not moving',
      'consolidation',
      'cold wallet not receiving',
      'sweep error',
    ],
    meaning:
      'Automatic sweeps are batched to save gas. By the maintainers’ published answer they run when the last sweep was over 24 hours ago, or the total value is large (around 50k USD), or many addresses (around 75) are waiting; the thresholds are defaults and may differ on your version. The hot wallet also needs native gas on that chain.',
    confirm: [
      'payram_ops_playbook "unswept_funds": status per row.',
      'Dashboard → Funds Consolidation.',
    ],
    fix: [
      'Top up the hot wallet’s native gas where the status says so.',
      'Small balances simply wait for the next batch; use the manual sweep in Funds Consolidation if you need it sooner.',
    ],
    needsHuman: 'Sending gas and triggering sweeps moves money.',
    see: [{ tool: 'payram_ops_playbook', task: 'unswept_funds' }],
  },
  {
    id: 'sweep-status-codes',
    area: 'sweeps',
    title: 'A sweep row shows LOW_NATIVE_BALANCE, HOT_WALLET_MISSING or similar',
    signs: [
      'low_native_balance',
      'deposit_not_deployed_low_gas',
      'gas_too_high',
      'hot_wallet_missing',
      'fund_sweeper_not_deployed',
      'deposit_not_deployed_fund_sweeper_missing',
      'lastsweeperror',
      'actionhint',
    ],
    meaning: 'Each status says what is missing:\n' + sweepFixes.join('\n'),
    confirm: ['payram_ops_playbook "unswept_funds" lists the status and any action hint.'],
    fix: ['Do what the status says (gas, hot wallet, or deploying the chain’s wallet).'],
    needsHuman: 'Funding or deploying on-chain needs the owner.',
    see: [
      { tool: 'payram_ops_playbook', task: 'unswept_funds' },
      { tool: 'payram_runbook', task: 'add_chain' },
    ],
  },
  {
    id: 'smart-bridge-checkout-change',
    area: 'payments',
    title: 'Native Bitcoin or Tron USDT disappeared from my checkout',
    signs: [
      'bitcoin option missing',
      'native btc missing',
      'usdt tron missing',
      'tron usdt missing',
      'bridge',
      'rail',
      'checkout options changed',
      'payment options',
    ],
    meaning: SMART_BRIDGE.defaults,
    confirm: ['Dashboard → Project → Payment options.'],
    fix: [SMART_BRIDGE.merchantImpact],
    needsHuman: 'Which rails to accept is a business choice.',
    see: [{ tool: 'payram_runbook', task: 'smart_bridge' }],
  },
  // ── operations ───────────────────────────────────────────────────
  {
    id: 'worker-down',
    area: 'operations',
    title: 'A worker shows FATAL, BACKOFF or STOPPED',
    signs: [
      'fatal',
      'backoff',
      'stopped',
      'supervisorctl',
      'worker not running',
      'worker down',
      'exited too quickly',
    ],
    meaning:
      'A background process is not running, so that part (deposit detection, webhooks, sweeps, one chain) stalls. redis-server FATAL is a known harmless report.',
    confirm: [`\`${CONTAINER.supervisorctl}\``, 'payram_doctor lists non-running programs.'],
    fix: [
      'Restart only that worker (with the human’s OK), then read its log.',
      'If many are down, restart the container.',
    ],
    needsHuman: 'Restarting affects live payments.',
    see: [
      { tool: 'payram_ops_playbook', task: 'workers' },
      { tool: 'payram_ops_playbook', task: 'restart_worker' },
    ],
  },
  {
    id: 'node-out-of-sync',
    area: 'operations',
    title: 'A chain is behind or “node out of sync”',
    signs: [
      'node out of sync',
      'block lag',
      'listener behind',
      'blocks behind',
      'rpc down',
      'rpc timeout',
      'node not syncing',
      'node_sync',
    ],
    meaning:
      'PayRam is not reading new blocks for that chain (RPC provider issue, quota, or a stopped listener), so deposits there are not detected yet.',
    confirm: ['payram_ops_playbook "node_sync"'],
    fix: [
      'Check the RPC provider status and quota; restart that chain’s listener if it is stopped.',
    ],
    see: [{ tool: 'payram_ops_playbook', task: 'node_sync' }],
  },
  {
    id: 'version-unknown',
    area: 'operations',
    title: 'The server reports version “main” so I cannot tell if it is current',
    signs: [
      'version main',
      'reports main',
      'cannot compare versions',
      'version unknown',
      'which version',
    ],
    meaning: 'Some images (for example arm64 builds) report “main” instead of a version number.',
    confirm: [
      `\`docker inspect ${CONTAINER.name} --format '{{.Config.Image}}'\` shows the image tag.`,
    ],
    fix: ['Compare that tag with the releases page: ' + LINKS.releases],
    see: [{ tool: 'payram_ops_playbook', task: 'version_check' }],
  },
  {
    id: 'upgrade-problem',
    area: 'operations',
    title: 'Something broke after an upgrade',
    signs: [
      'after upgrade',
      'after update',
      'upgrade failed',
      'update failed',
      'update broke',
      'broke after',
      'rollback',
    ],
    meaning:
      'A restart after an upgrade can take a couple of minutes; a failed one needs the logs and possibly a restore.',
    confirm: ['payram_doctor', `\`${CONTAINER.supervisorctl}\``, 'Backend logs.'],
    fix: [
      'Wait 2 minutes, then check health and workers.',
      'If it will not recover, restore from the backup taken before the upgrade.',
    ],
    needsHuman: 'Rolling back or restoring is the owner’s decision.',
    see: [
      { tool: 'payram_runbook', task: 'upgrade' },
      { tool: 'payram_runbook', task: 'restore' },
    ],
    paste: 'payram_doctor output and the last 40 lines of ~/.payram-core/log/payram.log.',
  },
  {
    id: 'payout-stuck',
    area: 'operations',
    title: 'A payout is pending or never arrives',
    signs: [
      'payout pending',
      'pending-approval',
      'payout not sent',
      'payout stuck',
      'withdrawal pending',
      'otp not',
      'payout failed',
    ],
    meaning:
      'Payouts may wait for approval, an emailed one-time code, or enough gas in the hot wallet.',
    confirm: ['payram_ops_playbook "payouts": status filter pending-approval.'],
    fix: ['A human approves the payout, enters the OTP, or tops up gas as the status says.'],
    needsHuman: 'Approving and sending payouts moves money.',
    see: [{ tool: 'payram_ops_playbook', task: 'payouts' }],
  },
  {
    id: 'email-not-arriving',
    area: 'operations',
    title: 'Emails, OTP codes or password resets do not arrive',
    signs: [
      'smtp',
      'otp not received',
      'email not sent',
      'password reset email',
      'no email',
      'emails not arriving',
      'verification code',
    ],
    meaning: 'SMTP is not configured (it is optional) or the mail worker is down.',
    confirm: ['Dashboard SMTP settings; the email worker state (payram_doctor).'],
    fix: ['Configure SMTP in the dashboard; restart the email worker if it is down.'],
    see: [{ tool: 'payram_ops_playbook', task: 'workers' }],
  },
  {
    id: 'forgot-root-password',
    area: 'operations',
    title: 'I cannot sign in or forgot the root password',
    signs: [
      'forgot password',
      "can't sign in",
      'cannot log in',
      'locked out',
      'reset root password',
      'lost root',
      'forgot the root',
    ],
    meaning:
      'PayRam has no account lock, but the password is yours to recover. SMTP enables the reset email. Agent-CLI installs also store the credentials the installer created.',
    confirm: [
      'Agent-CLI install: ~/.payraminfo/root-credentials.env on the server (chmod 600).',
      'Is SMTP configured?',
    ],
    fix: [
      'Use the reset email if SMTP is set up; otherwise read the credentials file on the server.',
      'Never run a reset-local or reinstall to recover a password: it deletes the database and wallet secrets.',
    ],
    needsHuman: 'Credentials go to the owner privately, never into a chat.',
    see: [{ tool: 'payram_runbook', task: 'forgot_root_password' }],
  },
  {
    id: 'lost-backups',
    area: 'operations',
    title: 'I lost the AES key, mnemonic or backup',
    signs: [
      'lost aes',
      'aes key lost',
      'lost mnemonic',
      'lost the mnemonic',
      'headless-wallet-secret',
      'no backup',
      'lost backup',
    ],
    meaning:
      'The AES key (~/.payraminfo/aes/) decrypts the hot-wallet key and the deployer mnemonic lets you deploy and change on-chain config. Without them those parts cannot be recovered.',
    confirm: ['Does ~/.payraminfo/aes/ still exist on the server? Is there a copy elsewhere?'],
    fix: [
      'If the server still has them, back them up now together with the database (payram_runbook "backup").',
      'If they are gone, contact the PayRam team before changing anything: ' + LINKS.community,
    ],
    needsHuman: 'Only the owner can decide how to proceed.',
    see: [{ tool: 'payram_runbook', task: 'backup' }],
  },
];

export const ISSUE_BY_ID: ReadonlyMap<string, Issue> = new Map(ISSUES.map((i) => [i.id, i]));

copyCopychevron-down

1.  [FAQs](/faqs)

# General FAQ's

-   [What is PayRam?](/faqs/general-faqs#what-is-payram)
    
-   [How do I get started, and how fast can I go live?](/faqs/general-faqs#how-do-i-get-started-and-how-fast-can-i-go-live)
    
-   [What are the minimum server requirements to run PayRam?](/faqs/general-faqs#what-are-the-minimum-server-requirements-to-run-payram)
    
-   [Which cryptocurrencies and blockchains does PayRam support?](/faqs/general-faqs#which-cryptocurrencies-and-blockchains-does-payram-support)
    
-   [Does PayRam handle fiat currencies (USD, EUR, etc.)?](/faqs/general-faqs#does-payram-handle-fiat-currencies-usd-eur-etc)
    
-   [What fees does PayRam charge?](/faqs/general-faqs#what-fees-does-payram-charge)
    
-   [Are there any transaction limits?](/faqs/general-faqs#are-there-any-transaction-limits)
    
-   [How do I integrate PayRam with my platform?](/faqs/general-faqs#how-do-i-integrate-payram-with-my-platform)
    
-   [Is there a sandbox or test mode?](/faqs/general-faqs#is-there-a-sandbox-or-test-mode)
    
-   [How secure is PayRam?](/faqs/general-faqs#how-secure-is-payram)
    
-   [Does PayRam require KYC/AML?](/faqs/general-faqs#does-payram-require-kyc-aml)
    
-   [How are refunds and chargebacks handled?](/faqs/general-faqs#how-are-refunds-and-chargebacks-handled)
    
-   [What happens if a customer underpays or overpays?](/faqs/general-faqs#what-happens-if-a-customer-underpays-or-overpays)
    
-   [Can I set up recurring subscriptions or billing?](/faqs/general-faqs#can-i-set-up-recurring-subscriptions-or-billing)
    
-   [Which industries benefit most from PayRam?](/faqs/general-faqs#which-industries-benefit-most-from-payram)
    
-   [How do I migrate from testnet to mainnet?](/faqs/general-faqs#how-do-i-migrate-from-testnet-to-mainnet)
    
-   [What support options are available?](/faqs/general-faqs#what-support-options-are-available)
    

#### 

[hashtag](#what-is-payram)

What is PayRam?

PayRam is a **self-hosted** cryptocurrency payment processor that you deploy and run on your own servers—no middlemen, no censorship, or any limitations. You retain **full custody** of your funds and infrastructure, gaining total control over your payments flow and data.

* * *

#### 

[hashtag](#how-do-i-get-started-and-how-fast-can-i-go-live)

How do I get started, and how fast can I go live?

Getting started is quick and code-light. After installing PayRam via our install script, you simply embed a few lines of API code into your application. You can be **accepting live crypto payments in under an hour**, with no account activation or KYC delays on PayRam’s side.

* * *

#### 

[hashtag](#what-are-the-minimum-server-requirements-to-run-payram)

What are the minimum server requirements to run PayRam?

For smooth production performance, we **recommend**:

-   **4 CPU cores**
    
-   **4 GB RAM**
    
-   **15 GB+ disk**
    
    For very high-volume use cases, scale CPU, memory, and disk accordingly.
    

* * *

#### 

[hashtag](#which-cryptocurrencies-and-blockchains-does-payram-support)

Which cryptocurrencies and blockchains does PayRam support?

PayRam natively supports major cryptos, including Bitcoin (BTC), Ethereum (ETH), Tron (TRX), Tether (USDT), USD Coin (USDC), Polygon (POL), Coinbase Wrapped Bitcoin (cbBTC) and other EVM-compatible tokens. PayRam currently supports payments on networks, including Ethereum, Base, Polygon, Tron, and Bitcoin. PayRam is actively adding support for new cryptos and networks.

* * *

#### 

[hashtag](#does-payram-handle-fiat-currencies-usd-eur-etc)

Does PayRam handle fiat currencies (USD, EUR, etc.)?

_Not yet._ PayRam currently processes **crypto-only** transactions. Automated crypto-to-fiat on-ramp and direct fiat off-ramp settlement are part of the roadmap.

* * *

#### 

[hashtag](#what-fees-does-payram-charge)

What fees does PayRam charge?

<!-- Local patch (payram-mcp, 2026-09-16): fee answer replaced per the PayRam fee rule. This mirror is vendored by scripts/fetchDocs.ts; fix docs.payram.com upstream too or a refetch restores the old text. -->
Commercial terms are discussed directly with the PayRam team.

* * *

#### 

[hashtag](#are-there-any-transaction-limits)

Are there any transaction limits?

No, PayRam does not have any transaction limits. The platform supports **unlimited** transactions and scales with your business. Whether you process 10 transactions or 10,000+ per day, PayRam handles it seamlessly.

* * *

#### 

[hashtag](#how-do-i-integrate-payram-with-my-platform)

How do I integrate PayRam with my platform?

After installation, you have access to a **RESTful API**, plus SDKs and pre-built connectors. You can integrate via:

-   **Payment form embeddables**
    
-   **Payment links & invoices**
    
-   **Webhook callbacks**
    
    Our docs include sample code for **Shopify**, **WooCommerce**, or any custom web/mobile app.
    

* * *

#### 

[hashtag](#is-there-a-sandbox-or-test-mode)

Is there a sandbox or test mode?

Yes, a complete **testnet environment for PayRam** is available. Configure PayRam to point at testnet RPC URLs and use our test wallets/faucets to validate your integration before going live.

* * *

#### 

[hashtag](#how-secure-is-payram)

How secure is PayRam?

-   Self‑custodial control: You maintain exclusive ownership of your private keys at all times.
    
-   On‑premises deployment: All data and funds reside on your infrastructure—never with a third party—dramatically lowering breach risk.
    
-   Automated, trustless consolidation: Intelligent on‑chain sweeps, powered by smart contracts, replace manual fund transfers and slash operational risk.
    
-   Reduced human error: Fully automated workflows streamline processes and eliminate manual intervention.
    
-   Granular access management: Role‑based permissions let you define precisely who can execute sensitive operations.
    
-   Minimized attack surface: A purpose‑built design limits external dependencies and potential vulnerabilities.
    
-   Enterprise‑grade security: From key custody to access controls, PayRam delivers a hardened platform for crypto payment management.
    

* * *

#### 

[hashtag](#does-payram-require-kyc-aml)

Does PayRam require KYC/AML?

As a self-hosted solution, PayRam does not impose mandatory KYC requirements by default. However, users have the flexibility to implement their own KYC/AML workflows in accordance with their jurisdictional regulations or customer due diligence policies.

* * *

#### 

[hashtag](#how-are-refunds-and-chargebacks-handled)

How are refunds and chargebacks handled?

As there is no automatic on-chain chargeback mechanism, refunds on PayRam must be processed manually through the dashboard or API. The specified crypto amount is returned directly to the customer’s wallet address by the merchant.

* * *

#### 

[hashtag](#what-happens-if-a-customer-underpays-or-overpays)

What happens if a customer underpays or overpays?

If a customer underpays, the payment status remains marked as “pending” until the full amount is received. In the case of an overpayment, the excess amount is clearly displayed in the PayRam dashboard, allowing the merchant to either issue a refund or apply the surplus to future invoices, depending on the preferred workflow.

* * *

#### 

[hashtag](#can-i-set-up-recurring-subscriptions-or-billing)

Can I set up recurring subscriptions or billing?

PayRam natively supports one-off payments and invoices. Subscription functionality is not included by default and would need to be implemented at the application layer or through custom scripting using the available APIs.

* * *

#### 

[hashtag](#which-industries-benefit-most-from-payram)

Which industries benefit most from PayRam?

PayRam is suitable for a wide range of industries, with particular relevance for:

-   **High-risk** and **censorship-sensitive** sectors such as iGaming, adult services, and gambling
    
-   **Marketplaces** and **e-commerce platforms** aiming for global reach and crypto acceptance
    
-   **Charities** and **NGOs** seeking transparent, on-chain donation tracking
    
-   **Fintech companies** or **payment service providers (PSPs)** looking to offer crypto payments as a white-label solution
    

* * *

#### 

[hashtag](#how-do-i-migrate-from-testnet-to-mainnet)

How do I migrate from testnet to mainnet?

1.  Update your `config.yaml` from `DEVELOPMENT` to `PRODUCTION`.
    
2.  Swap all testnet RPC URLs and xpubs for their mainnet counterparts.
    
3.  Increase confirmation thresholds (e.g., BTC → 6, ETH → 12).
    
4.  Test on a staging instance, then restart PayRam with new configs.
    

* * *

#### 

[hashtag](#what-support-options-are-available)

What support options are available?

PayRam offers several support options to assist users. For critical issues, 24/7 support is available via email and chat. Comprehensive documentation and code samples can be found at [docs.payram.comarrow-up-right](https://docs.payram.com/), providing guidance for setup and integration. Additionally, users can access community forums and GitHub issue tracking for self-service support and peer assistance.

* * *

[PreviousIntroductionchevron-left](/faqs/introduction)[NextFund Management FAQ'schevron-right](/faqs/fund-management-faqs)

Last updated 1 day ago
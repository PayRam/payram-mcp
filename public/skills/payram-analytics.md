---
name: payram-analytics
description: Query PayRam dashboard data directly via REST APIs using JWT Bearer authentication. Search payments by tx hash or email, get daily volume breakdowns, check unswept balances, view sweep history, and pull on-ramp metrics. No MCP server needed — the agent calls PayRam APIs directly with a Bearer token. Use when querying payment data, generating reports, monitoring deposits, checking sweep status, or answering questions like "how much did I receive yesterday" or "find payment with tx hash 0xabc".
---

# PayRam Analytics — Direct API Access

> **Need authentication first?** See [`payram-auth`](https://github.com/payram/payram-mcp/tree/main/skills/payram-auth) to get your Bearer token.

This skill teaches you to call PayRam dashboard APIs directly — no MCP server required. Just a `BASE_URL` and a `Bearer` token.

## Prerequisites

Before using these APIs, you need:

1. **`BASE_URL`** — Your PayRam server URL, the same origin as the dashboard (e.g., `https://pay.example.com`; no `:8080`/`:8443`)
2. **`ACCESS_TOKEN`** — JWT Bearer token (see [`payram-auth`](https://github.com/payram/payram-mcp/tree/main/skills/payram-auth))
3. **`PROJECT_ID`** — Auto-discovered (see below)

Every request below uses this header:

```
Authorization: Bearer <ACCESS_TOKEN>
```

> **Token expired?** If you get a 401, refresh using `POST /api/v1/refresh` — see [`payram-auth`](https://github.com/payram/payram-mcp/tree/main/skills/payram-auth) for the full refresh flow.

### Auto-Discover PROJECT_ID

**Do not ask the user for a project ID.** Discover it automatically:

```
GET {BASE_URL}/api/v1/external-platform/details
Authorization: Bearer <ACCESS_TOKEN>
```

Returns an array of platforms. Use `id` from the first entry. Most merchants have a single platform.

---

## Common Questions & Which API to Call

| Question                                  | API to call                                                 |
| ----------------------------------------- | ----------------------------------------------------------- |
| "How much did I receive today/yesterday?" | [Daily Volume](#get-daily-volume-via-payment-search)        |
| "Find a payment by tx hash"               | [Payment Search](#search-payments) with `query`             |
| "Show me all payments this week"          | [Payment Search](#search-payments) with `dateFrom`/`dateTo` |
| "How many payments are open vs closed?"   | [Payment Summary](#payment-summary-counts)                  |
| "What funds haven't been swept yet?"      | [Unswept Balances](#unswept-balances)                       |
| "Show sweep history"                      | [Sweep Transactions](#sweep-transaction-history)            |
| "What's my on-ramp volume?"               | [On-Ramp Metrics](#on-ramp-metrics)                         |
| "Show dashboard charts"                   | [Analytics Graph Data](#analytics-charts)                   |

---

## Payment Summary (Counts)

Get a quick overview of payment statuses.

```
POST {BASE_URL}/api/v1/external-platform/{PROJECT_ID}/payment/summary
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json

{}
```

**Response:**

```json
{
  "totalCount": 1450,
  "closedCount": 1320,
  "openCount": 85,
  "cancelledCount": 45
}
```

**Permission required:** `read_payment_request`

---

## Search Payments

The most versatile endpoint — search by tx hash, email, customer ID, date range, status, network, and currency.

```
POST {BASE_URL}/api/v1/external-platform/{PROJECT_ID}/payment/search
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json

{
  "query": "0xabc123...",
  "paymentStatus": ["Filled", "Partial filled"],
  "currency": ["USDC", "USDT"],
  "network": ["ethereum", "base"],
  "dateFrom": "2026-03-01T00:00:00Z",
  "dateTo": "2026-03-21T23:59:59Z",
  "sortBy": "createdAt",
  "sortDirection": "DESC",
  "limit": 25,
  "offset": 0
}
```

All filter fields are optional. Send `{}` to get the latest payments with defaults.

### Filter Reference

| Field                 | Type     | Description                                                 |
| --------------------- | -------- | ----------------------------------------------------------- |
| `query`               | string   | Free-text search: tx hash, customer ID, email, reference ID |
| `paymentStatus`       | string[] | `Filled`, `Partial filled`, `Pending`, `Cancelled`          |
| `webhookStatus`       | string[] | `Success`, `Failed`, `Pending`                              |
| `currency`            | string[] | `BTC`, `ETH`, `USDC`, `USDT`, `MATIC`, `TRX`                |
| `network`             | string[] | `bitcoin`, `ethereum`, `polygon`, `base`, `tron`            |
| `dateFrom`            | string   | ISO 8601 start date                                         |
| `dateTo`              | string   | ISO 8601 end date                                           |
| `createdBy`           | string[] | `user` or `system`                                          |
| `externalPlatformIds` | uint[]   | Filter by platform/project IDs                              |
| `sortBy`              | string   | Field to sort by (e.g., `createdAt`, `amountInUSD`)         |
| `sortDirection`       | string   | `ASC` or `DESC`                                             |
| `limit`               | int      | Results per page (default varies)                           |
| `offset`              | int      | Pagination offset                                           |

### Response

```json
{
  "data": [
    {
      "projectName": "My Store",
      "referenceId": "ref_abc123",
      "txHash": "0xabc123...",
      "fromAddress": "0xsender...",
      "toAddress": "0xreceiver...",
      "paymentStatus": "Filled",
      "currency": "USDC",
      "network": "base",
      "amountInUSD": 49.99,
      "amount": 49.99,
      "filledAmountInUSD": 49.99,
      "filledAmount": 49.99,
      "customerId": "user_456",
      "email": "customer@example.com",
      "webhookStatus": "Success",
      "createdBy": "user",
      "createdAt": "2026-03-20T14:30:00Z",
      "trxTimestamp": "2026-03-20T14:32:15Z"
    }
  ],
  "totalCount": 1450
}
```

**Permission required:** `read_payment_request`

### Common Recipes

**Find payment by tx hash:**

```json
{ "query": "0xabc123def456..." }
```

**Find payment by customer email:**

```json
{ "query": "customer@example.com" }
```

**All completed payments today:**

```json
{
  "paymentStatus": ["Filled"],
  "dateFrom": "2026-03-21T00:00:00Z",
  "dateTo": "2026-03-21T23:59:59Z"
}
```

**All USDC payments on Base this week:**

```json
{
  "currency": ["USDC"],
  "network": ["base"],
  "dateFrom": "2026-03-15T00:00:00Z",
  "dateTo": "2026-03-21T23:59:59Z"
}
```

---

## Get Daily Volume (via Payment Search)

To calculate daily volume with breakdowns, use Payment Search with date filters and aggregate the results.

### Step 1: Fetch today's completed payments

```
POST {BASE_URL}/api/v1/external-platform/{PROJECT_ID}/payment/search
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json

{
  "paymentStatus": ["Filled", "Partial filled"],
  "dateFrom": "2026-03-21T00:00:00Z",
  "dateTo": "2026-03-21T23:59:59Z",
  "limit": 500,
  "offset": 0
}
```

### Step 2: Aggregate client-side

Group the returned `data[]` array by `network` and `currency` to build the breakdown:

```
Total today: $12,450.00

By Network:
  ethereum  $5,200.00  (3 payments)
  base      $4,100.00  (7 payments)
  bitcoin   $2,150.00  (1 payment)
  tron      $1,000.00  (2 payments)

By Currency:
  USDC      $8,300.00
  BTC       $2,150.00
  USDT      $1,000.00
  ETH       $1,000.00
```

> **Tip**: For "yesterday vs today" comparison, run two searches with different date ranges and compare totals.

---

## Unswept Balances

Check how much crypto is sitting in deposit addresses that hasn't been swept to your cold wallet yet.

```
GET {BASE_URL}/api/v1/addresses/balance
Authorization: Bearer <ACCESS_TOKEN>
```

**Response:**

```json
[
  {
    "blockchainCode": "ETH",
    "blockchainFamily": "ethereum",
    "blockchainID": 1,
    "currencyCode": "USDC",
    "currencyID": 2,
    "amount": "1523.45",
    "count": 12
  },
  {
    "blockchainCode": "BASE",
    "blockchainFamily": "ethereum",
    "blockchainID": 5,
    "currencyCode": "USDC",
    "currencyID": 2,
    "amount": "890.00",
    "count": 8
  },
  {
    "blockchainCode": "BTC",
    "blockchainFamily": "bitcoin",
    "blockchainID": 3,
    "currencyCode": "BTC",
    "currencyID": 1,
    "amount": "0.05200000",
    "count": 3
  }
]
```

Each entry = one blockchain + currency combination. `count` = number of deposit addresses holding funds. `amount` = total unswept balance in that currency.

**Permission required:** `read_addresses_summary`

---

## Sweep Transaction History

View past sweep operations — how much was swept, and when.

### List All Sweeps

```
GET {BASE_URL}/api/v1/sweep-transactions?limit=20&offset=0
Authorization: Bearer <ACCESS_TOKEN>
```

**Response:**

```json
{
  "sweepTransactionInfo": [
    {
      "numberOfUTXOs": 5,
      "total": "0.15000000"
    }
  ]
}
```

### Get Sweep Details

```
GET {BASE_URL}/api/v1/sweep-transactions/{sweepId}
Authorization: Bearer <ACCESS_TOKEN>
```

**Response:**

```json
{
  "blockchainType": "ETH",
  "sweepTransactions": [...]
}
```

**Permission required:** `read_sweep_transaction`

---

## On-Ramp Metrics

If you use on-ramp integrations (fiat-to-crypto), get aggregate metrics:

### Metrics Summary

```
GET {BASE_URL}/api/v1/onramper-payments/metrics?startDate=2026-03-01&endDate=2026-03-21
Authorization: Bearer <ACCESS_TOKEN>
```

**Response:**

```json
{
  "totalOnrampValue": "45230.50",
  "totalFeeExpense": "452.30",
  "onrampContributionPercent": "15.2",
  "uniqueOnrampUsers": 89
}
```

**Permission required:** `read_onramper_payments_metrics`

### On-Ramp Payment List

```
GET {BASE_URL}/api/v1/onramper-payments?startDate=2026-03-20&endDate=2026-03-21&limit=50&offset=0
Authorization: Bearer <ACCESS_TOKEN>
```

**Query Parameters:**

| Param                 | Type     | Description       |
| --------------------- | -------- | ----------------- |
| `startDate`           | string   | ISO date          |
| `endDate`             | string   | ISO date          |
| `externalPlatformIDs` | number[] | Platform filter   |
| `blockchainCodes`     | string[] | Blockchain filter |
| `currencyCodes`       | string[] | Currency filter   |
| `limit`               | number   | Pagination limit  |
| `offset`              | number   | Pagination offset |
| `sortBy`              | string   | Sort field        |
| `order`               | string   | `ASC` or `DESC`   |

**Response:**

```json
{
  "data": [
    {
      "dateOfPayment": "2026-03-20",
      "project": "My Store",
      "referenceID": "ref_onramp_123",
      "userEmail": "buyer@example.com",
      "token": "USDC",
      "network": "base",
      "amountInUSD": "100.00",
      "amountToken": "100.00",
      "txnHash": "0xdef456...",
      "blockNumber": 12345678
    }
  ],
  "totalCount": 89,
  "limit": 50,
  "offset": 0
}
```

**Permission required:** `read_onramper_payments`

---

## Analytics Charts

The dashboard uses a config-driven analytics system. First discover available chart groups, then fetch data.

### Step 1: Discover Available Groups

```
GET {BASE_URL}/api/v1/external-platform/{PROJECT_ID}/analytics/groups
Authorization: Bearer <ACCESS_TOKEN>
```

Returns the list of analytics groups and their graphs (charts). Each group has an ID and contains graphs with IDs.

### Step 2: Fetch Graph Data

```
POST {BASE_URL}/api/v1/external-platform/{PROJECT_ID}/analytics/groups/{groupId}/graph/{graphId}/data
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json

{
  "date_filter": "last_30_days"
}
```

**Common date filters:** `today`, `yesterday`, `last_7_days`, `last_14_days`, `last_30_days`, `this_month`, `last_month`

For custom ranges:

```json
{
  "date_filter": "custom",
  "custom_start_date": "2026-03-01T00:00:00Z",
  "custom_end_date": "2026-03-21T23:59:59Z"
}
```

**Permission required:** `read_analytics`

---

## Deposits

### List Deposits

```
GET {BASE_URL}/api/v1/deposits?limit=20&offset=0
Authorization: Bearer <ACCESS_TOKEN>
```

**Permission required:** `read_deposits`

### Missed Deposits

```
GET {BASE_URL}/api/v1/missed-deposit
Authorization: Bearer <ACCESS_TOKEN>
```

Returns deposits that were detected but couldn't be matched to a payment request.

---

## Referral Analytics

If you have referral campaigns configured:

| Endpoint                                                                   | Method | Description                |
| -------------------------------------------------------------------------- | ------ | -------------------------- |
| `/api/v1/external-platform/{pid}/referral/campaigns`                       | GET    | List campaigns             |
| `/api/v1/external-platform/{pid}/referral/campaigns/{cid}/rewards/total`   | GET    | Total rewards for campaign |
| `/api/v1/external-platform/{pid}/referral/referrers/{refId}`               | GET    | Referrer profile           |
| `/api/v1/external-platform/{pid}/referral/referrers/{refId}/referee/total` | GET    | Count of referred users    |
| `/api/v1/external-platform/{pid}/referral/referrers/{refId}/rewards/total` | GET    | Total rewards earned       |
| `/api/v1/external-platform/{pid}/referral/referrers/{refId}/rewards`       | GET    | Reward event history       |
| `/api/v1/external-platform/{pid}/referral/referrers/{refId}/withdrawals`   | GET    | Withdrawal history         |
| `/api/v1/external-platform/{pid}/referral/payouts`                         | GET    | Payout batches             |

**Permission required:** `read_referral`

---

## Recommended Workflow for Agents

When a user asks about their PayRam data, follow this sequence:

1. **Ensure you have auth** — check for `BASE_URL` and `ACCESS_TOKEN` (or `REFRESH_TOKEN`). If you have a refresh token but no access token, call `POST /api/v1/refresh` first. See [`payram-auth`](https://github.com/payram/payram-mcp/tree/main/skills/payram-auth).

2. **Discover PROJECT_ID** — call `GET /api/v1/external-platform/details` and use the `id` from the first platform. Do not ask the user for this.

3. **Identify the question type** — use the [Common Questions table](#common-questions--which-api-to-call) above.

4. **Make the API call** — use `curl`, `fetch`, or any HTTP client with `Authorization: Bearer <token>`.

5. **Handle 401** — if you get a 401, refresh the token using `POST /api/v1/refresh` and retry.

6. **Format the response** — present data in a readable format (tables, summaries, breakdowns).

### Example Agent Conversation

**User:** "How much did I receive yesterday on Base?"

**Agent:**

1. Calls Payment Search with `dateFrom` = yesterday 00:00, `dateTo` = yesterday 23:59, `network` = ["base"], `paymentStatus` = ["Filled"]
2. Sums `amountInUSD` from all results
3. Groups by `currency` for breakdown
4. Responds: "You received $4,100.00 on Base yesterday — $3,500 in USDC and $600 in ETH across 7 payments."

---

## Related Skills

| Skill                                                                                                            | Purpose                                                    |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [`payram-auth`](https://github.com/payram/payram-mcp/tree/main/skills/payram-auth)                               | Get your Bearer token (login, refresh, browser extraction) |
| [`payram-setup`](https://github.com/payram/payram-mcp/tree/main/skills/payram-setup)                             | Deploy and configure a PayRam server                       |
| [`payram-payment-integration`](https://github.com/payram/payram-mcp/tree/main/skills/payram-payment-integration) | Integrate payments into your app                           |
| [`payram-webhook-integration`](https://github.com/payram/payram-mcp/tree/main/skills/payram-webhook-integration) | Receive payment events in real time                        |

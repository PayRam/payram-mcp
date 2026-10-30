---
name: payram-auth
description: Authenticate with a PayRam instance to access merchant dashboard APIs. Covers login with email/password, JWT Bearer token usage, automatic token refresh, and extracting tokens from a browser session. Use when connecting to PayRam APIs, troubleshooting authentication, or building integrations that need merchant-level access to payment data, analytics, and sweep management.
---

# PayRam Authentication

> **First time with PayRam?** See [`payram-setup`](https://github.com/payram/payram-mcp/tree/main/skills/payram-setup) to deploy your server.

PayRam uses **JWT Bearer tokens** for dashboard/merchant API access and **API keys** for external platform integrations. This skill covers the JWT flow — the one you need for querying payments, analytics, sweeps, and all dashboard data.

## When to Use

- Authenticate before calling any PayRam dashboard API
- Refresh an expired access token without re-entering credentials
- Extract tokens from a browser session for agent use
- Troubleshoot 401/403 errors on PayRam API calls

---

## Quick Reference

| Item | Value |
|------|-------|
| **Access token lifetime** | 15 minutes (900 seconds) |
| **Refresh token lifetime** | 7 days |
| **Refresh sliding window** | New refresh token issued when < 48 hours remain |
| **Auth header** | `Authorization: Bearer <accessToken>` |
| **Algorithm** | HS256 (HMAC-SHA256) |

---

## Option A: Login with Email & Password

If you have the merchant's email and password, call the signin endpoint directly.

### Request

```
POST {BASE_URL}/api/v1/signin
Content-Type: application/json

{
  "email": "merchant@example.com",
  "password": "YourPassword123!"
}
```

### Response (200 OK)

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": 900,
  "tokenType": "Bearer",
  "member": {
    "id": 1,
    "email": "merchant@example.com",
    "name": "Merchant Name",
    "memberType": "internal"
  },
  "role": {
    "name": "root",
    "displayName": "Root Administrator"
  },
  "resetPasswordRequired": false
}
```

### Error Responses

| Status | Meaning | What to do |
|--------|---------|------------|
| 400 | Malformed JSON | Check request body format |
| 401 | Wrong email or password | Verify credentials |
| 429 | Too many wrong passwords from this network | Wait the minutes the message names (also in `Retry-After`), or reset the password |

### Example (curl)

```bash
curl -s -X POST "${BASE_URL}/api/v1/signin" \
  -H "Content-Type: application/json" \
  -d '{"email":"merchant@example.com","password":"YourPassword123!"}' \
  | jq '{accessToken, refreshToken, expiresIn}'
```

### When two-factor sign-in is on

A member with two-factor sign-in on gets no tokens from signin. The answer is a
short-lived step token instead (5 minutes):

```json
{
  "status": "two_factor_required",
  "twoFactorToken": "eyJhbGciOiJIUzI1NiIs...",
  "methods": ["authenticator", "recovery_code"],
  "expiresIn": 300
}
```

Finish with the 6-digit code from the member's authenticator app (or one of
their recovery codes as `recoveryCode`). The answer is the same as signin's:

```bash
curl -s -X POST "${BASE_URL}/api/v1/signin/two-factor" \
  -H "Content-Type: application/json" \
  -d '{"twoFactorToken":"<from signin>","otpCode":"123456"}' \
  | jq '{accessToken, refreshToken, expiresIn}'
```

Only the member can read the code from their phone, so ask them for it, and
only for a code: never ask for their authenticator secret, its QR code or their
recovery codes. A wrong
code answers 400 with the tries left; five wrong codes from one network start a
wait (429): 15 minutes, doubling up to an hour. The message and `Retry-After`
say how long. On an agent-CLI install, `./setup_payram_agents.sh signin` asks for the
code in the terminal. After that, refresh keeps the agent running without asking
again.

### Changes that need the code

For a member with two-factor sign-in on, every change to who holds power on
the server or where its money goes needs their current app code as well as the
session: adding or changing members and roles, projects and their members,
wallets and where funds land, API keys, the mail server, resetting another
member's two-factor sign-in, and payout limits
(`PUT` or `DELETE /api/v1/project/<id>/payout-config`, or a payout-limit
setting). Reads never need it; payments and payouts made with a project API
key never do.

Send the code as the `Two-Factor-Code` header. Without it the answer is 403
`TWO_FACTOR_CODE_REQUIRED` and nothing changes. A confirmed code's response
carries a `Two-Factor-Grant` header: send it back as `Two-Factor-Grant` with
the next such changes, and they go through without a code for 10 minutes, with
the same access token only. When it runs out, or after a token refresh, the
answer is `TWO_FACTOR_CODE_REQUIRED` again: ask the member for a fresh code.

```bash
curl -s -D headers.txt -X PUT "${BASE_URL}/api/v1/project/1/payout-config" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Two-Factor-Code: 123456" \
  -H "Content-Type: application/json" -d '{"dailyLimit":"5000"}'
GRANT=$(grep -i '^two-factor-grant:' headers.txt | cut -d' ' -f2 | tr -d '\r')
```

---

## Option B: Extract Tokens from Browser

If you're already logged into the PayRam dashboard in a browser, you can grab the tokens without re-entering credentials.

### Steps

1. Open the PayRam dashboard in your browser
2. Open **DevTools** (F12 or Cmd+Shift+I)
3. Go to **Application** tab (Chrome) or **Storage** tab (Firefox)
4. Look in **Local Storage** for your PayRam domain
5. Copy the `payram_access_token` and `payram_refresh_token` values

Alternatively, from the **Network** tab:
1. Refresh the page
2. Click any API request to your PayRam server
3. Look at the `Authorization: Bearer ...` header — that's your access token

> **Tip**: The access token expires in 15 minutes. Always grab the refresh token too so the agent can auto-renew.

---

## Token Refresh

Access tokens expire every 15 minutes. Use the refresh token to get a new one — no password needed.

### Request

```
POST {BASE_URL}/api/v1/refresh
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

### Response (201 Created)

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...(new)...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...(may be new)...",
  "expiresIn": 900,
  "tokenType": "Bearer"
}
```

### Sliding Window Behavior

- If the refresh token has **more than 48 hours** remaining: same refresh token is returned, only the access token is new.
- If the refresh token has **less than 48 hours** remaining: a **new refresh token** is also returned, and the old one is revoked.

> **Important**: Always store the refresh token from the response — it may be different from the one you sent.

### Example (curl)

```bash
curl -s -X POST "${BASE_URL}/api/v1/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"${REFRESH_TOKEN}\"}" \
  | jq '{accessToken, refreshToken, expiresIn}'
```

---

## Using the Access Token

Once you have an access token, include it in every API request:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### Discovering Your Project ID

Most PayRam data APIs require a `PROJECT_ID` (external platform ID). **You do not need to ask the user for this** — discover it automatically:

```
GET {BASE_URL}/api/v1/external-platform/details
Authorization: Bearer <ACCESS_TOKEN>
```

**Response:**

```json
[
  {
    "id": 1,
    "name": "My Store",
    "referenceId": "ref_abc",
    "createdAt": "2025-01-15T10:00:00Z"
  }
]
```

Use the `id` from the first platform (most merchants have one). If multiple platforms exist, pick the one matching the user's context or list them and ask.

### Example: Call Payment Summary

```bash
curl -s -X POST "${BASE_URL}/api/v1/external-platform/${PROJECT_ID}/payment/summary" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## Auto-Refresh Pattern for Agents

When building an agent that calls PayRam APIs, use this pattern:

1. **Try the API call** with the current access token
2. **If 401 is returned**: call `/api/v1/refresh` with the refresh token
3. **Store the new tokens** (both access AND refresh — refresh may change)
4. **Retry the original API call** with the new access token
5. **If refresh also fails (401)**: the session has ended — it expired, or the member was signed out everywhere (two-factor sign-in turned on, a reset, or the server's recovery command). Ask the user to sign in again, including the code from their app if two-factor sign-in is on, or to provide a new token from the browser

### Pseudocode

```
function callPayramAPI(method, url, body):
    response = httpRequest(method, url, body, headers: {Authorization: Bearer ACCESS_TOKEN})

    if response.status == 401:
        refreshResponse = POST /api/v1/refresh {refreshToken: REFRESH_TOKEN}

        if refreshResponse.status == 201:
            ACCESS_TOKEN = refreshResponse.accessToken
            REFRESH_TOKEN = refreshResponse.refreshToken  // may be new!
            return httpRequest(method, url, body, headers: {Authorization: Bearer ACCESS_TOKEN})
        else:
            raise "Session expired — please provide a new token"

    return response
```

---

## JWT Token Structure

### Access Token Claims

```json
{
  "mid": 1,
  "email": "merchant@example.com",
  "roles": ["root"],
  "perms": ["read_payment_request", "read_analytics", "..."],
  "typ": "access",
  "exp": 1711009500,
  "iss": "payram-core"
}
```

### Refresh Token Claims

```json
{
  "mid": 1,
  "typ": "refresh",
  "jti": "1-1711008600000000000",
  "exp": 1711613400,
  "iss": "payram-core"
}
```

---

## JWT vs API Key — When to Use Which

| | JWT Bearer Token | API Key |
|---|---|---|
| **Header** | `Authorization: Bearer <token>` | `API-Key: <key>` |
| **Who uses it** | Merchants (dashboard users) | External platforms (integrations) |
| **Lifetime** | 15 min access + 7 day refresh | Permanent until revoked |
| **Scope** | Full dashboard access (based on role) | Scoped to specific platform + permissions |
| **Use for** | Analytics, payments, sweeps, settings | Creating payments, webhooks, SDK calls |

**For querying dashboard data (payments, volume, sweeps, analytics) — use JWT Bearer tokens.**

---

## Logout

### Single Session

```
POST {BASE_URL}/api/v1/logout
Authorization: Bearer <accessToken>
Content-Type: application/json

{"refreshToken": "eyJ..."}
```

### All Sessions

```
POST {BASE_URL}/api/v1/logout-all
Authorization: Bearer <accessToken>
```

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| 401 on API call | Access token expired | Refresh using `/api/v1/refresh` |
| 401 on refresh | Session expired, or the member was signed out everywhere | Sign in again (with the app code if two-factor sign-in is on), or get a new token from the browser |
| 403 Insufficient permissions | User role lacks required permission | Check role assignments in dashboard |
| `resetPasswordRequired: true` | Password reset forced by admin | Call change-password endpoint first |

---

## Related Skills

| Skill | Purpose |
|-------|---------|
| [`payram-analytics`](https://github.com/payram/payram-mcp/tree/main/skills/payram-analytics) | Query payment data, volume, and charts using authenticated APIs |
| [`payram-setup`](https://github.com/payram/payram-mcp/tree/main/skills/payram-setup) | Deploy and configure a PayRam server |
| [`payram-payment-integration`](https://github.com/payram/payram-mcp/tree/main/skills/payram-payment-integration) | Integrate payments using API keys |

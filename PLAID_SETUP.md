# Plaid setup

Steward implements the standard Link and Transactions Sync architecture:

1. The browser requests `/api/plaid/link-token`.
2. The server calls `/link/token/create` with Transactions enabled.
3. Plaid Link returns a short-lived `public_token`.
4. The browser sends it to `/api/plaid/exchange`.
5. The server exchanges it at `/item/public_token/exchange`.
6. The access token is encrypted with AES-GCM and stored in D1.
7. `/api/plaid/sync` uses `/transactions/sync` and persists the cursor.

The access token never enters the client response.

## Sandbox configuration

Set:

```text
PLAID_CLIENT_ID=...
PLAID_SECRET=...
PLAID_ENV=sandbox
PLAID_WEBHOOK_URL=https://your-domain/api/plaid/webhook
APP_ENCRYPTION_KEY=<long-random-secret>
```

Open Accounts and choose **Connect bank**.

## Current limitation

The sync endpoint returns added, modified, and removed updates and advances the
cursor. A background/webhook consumer still needs to normalize those updates
into the transaction table and regenerate recommendations. Reauthorization UI
is represented by account attention states but is not connected to Plaid update
mode yet.

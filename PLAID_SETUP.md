# Plaid setup

Steward implements the standard Link and Transactions Sync architecture:

1. The browser requests `/api/plaid/link-token`.
2. The server calls `/link/token/create` with Transactions enabled.
3. Plaid Link returns a short-lived `public_token`.
4. The browser sends it to `/api/plaid/exchange`.
5. The server exchanges it at `/item/public_token/exchange`.
6. The access token is encrypted with AES-GCM and stored in D1.
7. `/api/plaid/sync` uses `/transactions/sync`, merges additions,
   modifications, and removals into the workspace, refreshes balances, and
   persists each Item cursor.
8. When Plaid Recurring Transactions is available, Steward derives predicted
   bills and recurring income without blocking core transaction sync.

The access token never enters the client response.

## Sandbox configuration

Set:

```text
PLAID_CLIENT_ID=...
PLAID_SECRET=...
PLAID_ENV=sandbox
APP_ENCRYPTION_KEY=<long-random-secret>
```

Open Accounts and choose **Connect bank**.

## Operational notes

Plaid can return empty transaction arrays immediately after a new Item is
created while history is prepared. Steward keeps the connected accounts visible
and a later **Sync now** imports the available history.

Recurring Transactions is a separate Plaid add-on. Without it, the app still
imports and categorizes transactions, while predicted bills and payday details
remain empty until the connection supplies those insights or the user enters
them.

Verified webhook ingestion and Plaid update-mode reauthorization are the next
production-hardening steps.

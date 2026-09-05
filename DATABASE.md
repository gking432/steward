# Database

`db/schema.ts` defines the first normalized Steward model:

- profiles
- financial accounts
- transactions
- bills
- goals
- projects
- wishlist items
- recommendations
- reviews
- notifications
- structured memories
- Plaid items
- audit logs
- workspace snapshots

Every user-owned table carries `user_id`. The active adapter stores a versioned
canonical `Workspace` and storage revision in `steward_snapshots`. Existing legacy
snapshots migrate at the read/import boundary without resets or read-side writes.
Only the explicitly configured trusted Sites gateway supplies private identity.
Writes compare the expected revision and exact previous JSON before updating.

Bank sync stages all pages, restarts on pagination mutation, and commits the
workspace plus item cursors in a conditional D1 batch. Integration testing on D1
is still required; local domain tests do not establish deployed rollback behavior.

## Migration

Generate SQL after schema changes:

```bash
npm run db:generate
```

Inspect the generated SQL in `drizzle/` before deploying. Sites applies packaged
migrations to its managed D1 database.

## Next data-layer step

Move each UI mutation to entity-specific server actions or API routes, then
remove sensitive fields from the client snapshot. Add foreign keys, indexes on
`user_id/date/status`, durable idempotency keys and provider replay auditing for
Plaid synchronization.

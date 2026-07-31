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

Every user-owned table carries `user_id`. The active snapshot adapter stores the
cohesive `StewardState` JSON in `steward_snapshots`, keyed by the authenticated
email supplied by the hosting platform. This makes the current multi-surface
demo atomic and resilient while the normalized schema establishes the migration
target.

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
`user_id/date/status`, optimistic concurrency, and durable idempotency keys for
Plaid synchronization.

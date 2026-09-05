# Security

## Implemented

- Private routes fail closed unless an explicit deployment identity adapter is configured
- Sites forwarded identity is accepted only behind a verified trusted gateway
- User-keyed durable state; client user IDs are ignored
- Nested Zod validation and financial-reference invariants at workspace writes
- D1 prepared statements
- Plaid access tokens encrypted with AES-GCM
- Plaid and OpenAI secrets remain server-side
- OpenAI prompt-injection boundary for financial record text
- `store: false` for OpenAI requests
- Conditional revisioned snapshot writes; audit coverage still needs production review
- Confirmation before account-data deletion
- Clear fallback errors without secret details
- No financial tokens written to logs

## Required before public production

- Formal threat model and independent security review
- Rate limiting backed by a durable edge service
- Plaid webhook verification and replay protection
- CSRF and origin checks for every state-changing route
- Entity-level authorization tests after normalized writes land
- Key rotation and re-encryption procedure
- Secret-manager-backed encryption key versioning
- Data retention, backup, recovery, and breach-response policies
- Dependency vulnerability review and remediation
- Privacy policy and terms appropriate to financial data
- Regulated-advice review for every future investment or credit feature

This application provides organizational budgeting guidance, not professional
investment, tax, legal, or credit advice.

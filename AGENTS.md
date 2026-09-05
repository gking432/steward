# Steward release workflow

After each completed update, run the relevant checks, commit the intended changes,
push to the existing GitHub repository, and deploy to the existing production
Vercel project (`steward-financial-os`). Verify the deployed result before reporting
completion. The user has authorized this workflow; do not ask for deployment
confirmation again for routine updates to this project and audience.

Preserve unrelated user work. Do not include untracked review documents, secrets,
or local evidence directories in a release unless explicitly requested.

Vercel is the requested deployment target. Do not substitute a Sites deployment.
Report any failed push or deployment honestly and resolve it where possible.

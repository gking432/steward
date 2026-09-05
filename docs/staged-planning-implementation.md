# Staged planning implementation

## Implementation plan

Retain the canonical Workspace, financial engine, purchase checks, recurring reserves, revision-aware approvals, persistence queue, and server-side OpenAI connection.

Add a versioned planning session with six pre-approval stages and Home as the continuation. Keep source context, user-confirmed groups, candidate interpretation, accepted intent, scenario baseline, and review identity separate. Validate every transition and final approval in application code. Persist the draft in the current browser tab.

Expose narrow Responses function tools for context, candidate updates, calculations, comparisons, and review preparation. Tools cannot write the canonical workspace. Keep manual controls available on provider failure.

Replace transcript-led onboarding with a central decision canvas, compact stage navigation, editable facts, priority cards, allocation visuals, before/after comparisons, and a quiet evolving summary. Use actual state changes for motion and respect reduced motion.

Verify one complete sample-to-approval path first, then contextual Home sessions, desktop/mobile behavior, financial regressions, tool failure modes, and live model extraction. Push and deploy the verified result to the existing Vercel project.

## Implemented boundaries

- `lib/model/planning-session.ts`: session schema, guarded transitions, assumptions, comparison, and approval validation.
- `lib/model/chat-plan.ts`: evidence-backed candidate interpretation and deterministic workspace preview.
- `lib/ai-tool-loop.ts`: bounded, transport-injected Responses tool protocol.
- `app/api/steward-chat/route.ts`: allowed tools, validation, compact data context, and provider metadata.
- `app/steward/conversation-setup.tsx`: stage canvas and manual recovery controls.
- Home opens priority, paycheck, or purchase sessions with the current workspace.

The final approval checks source revision, planning date, exact reviewed content, unresolved facts, assumptions acknowledgment, and engine shortfalls. Only then does it call the existing `confirmProposal` command. No planning action transfers money or pays a bill.

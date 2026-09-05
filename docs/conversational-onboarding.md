# Guided demo and goal chat

The sample flow is now Get started → Connect sample accounts → Checking your accounts / findings ready → current checking/cash balance → paycheck amount and rhythm → observed weekly spending → spending breakdown introduction → five-category weekly breakdown → projected paycheck room → “Now, let’s talk about your goals. Why did you download Steward?”

Each finding fills the viewport with Next and Back controls. Account connection is explicitly a simulation with fictional accounts; no credentials or bank authorization are requested. The initial analysis is deterministic. Live OpenAI conversation begins with the user’s goals, using the existing validated tool loop and financial engine. Manual entry remains available at /manual.

The chat has a fixed composer and presents one exchange at a time. Earlier messages remain in validated session storage and can be revisited with previous/next message arrows. Long replies, financial cards, and review assumptions use detail pages instead of scrolling or clipping. Final acceptance is available only after paging through the review and acknowledging its assumptions. Edits still invalidate the prior approval.

Observed weekly spending uses complete calendar weeks, excluding partial first/current weeks, income, pending, and excluded records. It is labeled with the date range and week count. The sample has $1,840 checking/cash available now, $2,150 biweekly take-home, and $564.09 observed weekly expenses across 11 complete weeks. Projected paycheck capacity is separately calculated from planned reserves and allowances: $375.26. Account cash is never increased by a forecast paycheck.

Validation: 251 deterministic/state/protocol tests and six local production HTTP checks pass. Lint has no errors and two existing warnings. Local browser verification covers the complete guided sequence, sample connection, mobile fit, and unavailable-AI recovery. Public live-chat and final review verification are recorded locally under ignored outputs after deployment. Earlier live-model evidence remains in outputs/evaluations/conversational-onboarding.json; this redesign reuses that server-side model workflow.

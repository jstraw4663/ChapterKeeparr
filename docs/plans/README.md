# Implementation plans

Current priority: [Library health redirection](library-health.md) — user-approved phased audit, review, staged conversion and hardlink-safe cleanup. The initial read-only scan/review UI milestone is implemented; earlier alignment optimization proposals below are historical context.

1. [UI/UX optimization](ui-ux-optimization.md) — implement first; responsive review workspace, consent/save behavior, accessibility, workflow clarity, and Settings version/build details.
2. [Backend optimization](backend-optimization.md) — agreed direction for metadata matching, preservation, resource scheduling, SSD staging, and Intel iGPU evaluation; implement after UI validation.

[UI audit evidence](ui-ux-audit-2026-10-19.json) records the source revision, fixture preview scope, observations, and limitations. The UI plan is being implemented on `feat/responsive-review-workspace`; see `VALIDATION.md` for completed checks and remaining release/device validation. The backend plan remains a proposal. Neither plan establishes a production deployment or hardware performance result.


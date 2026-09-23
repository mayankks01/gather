# Validation

Validated locally on Windows with .NET 10 and Node.js 22.

## Vercel / Docker deployment preparation — 23 September 2026

- Release backend build passes with zero warnings/errors; frontend TypeScript/Vite build passes (approximately 128 KB gzip JavaScript).
- All 31 existing feature tests pass against a new isolated SQLite database. Existing local user databases were not changed.
- Eight deployment regression tests pass: authenticated proxy metadata, distinct client rate limits, CORS, two passive sockets revoked after password reset, delivery to a newly authenticated socket, single-use reset links, failed-upload cleanup, concurrent user/global quotas, cleanup across restart while retaining sent attachments, Production cookie/HSTS/origin controls and rejection of an SMTP server without mandatory TLS. The SMTP test uses a local sink and sends no external mail.
- Two Vercel configuration checks pass: invalid/missing deployment values fail clearly, and API routing references the server-only secret without embedding its value. Configured CSP allows the existing Google Fonts CSS/font hosts, API HTTPS and WebSocket origins.
- The Vercel helper's routing dependency is overridden to patched `path-to-regexp` 6.3.x; npm audit reports zero known vulnerabilities after installation.
- The NuGet vulnerability scan also reports no known vulnerable packages, including transitive SMTP dependencies. Docker Desktop's Linux engine remains unavailable locally, so no container runtime verification is claimed.
- New deployment/config tests are included in GitHub Actions. The live Vercel rewrite, public cookie refresh, real SMTP delivery, Linux container/volume behavior, PostgreSQL/Redis and backup restoration still require environment-specific acceptance checks. See [VERCEL-DEPLOYMENT.md](VERCEL-DEPLOYMENT.md).

## Earlier local verification

- Backend: `dotnet build backend/Gather.Api --no-restore` succeeds.
- Frontend: `npm run build` succeeds, including strict TypeScript checking. The initial production JavaScript bundle is approximately 126 KB gzip; the PRD’s 250 KB proposal is met by the current build output, excluding externally loaded fonts and user media.
- Integration suite: `node --test tests/api.test.mjs` passes 31 checks against an isolated SQLite database on port 5081.

- Connection removal: verifies participant-only access, room rejection, repeat removal, live events for both participants, removal from both inboxes and connection search, denial of history/subscriptions/sending, stale acceptance rejection, new request IDs and recipient approval, and preserved history after reconnection.

- People search: verified accepted connections appear before entering a query, case-insensitive name matching, separate new-person results, short queries showing connections only, hidden conversations remaining searchable, and blocking in either direction excluding a user.

- Conversation deletion: verified per-account inbox removal, repeat deletion, room/outsider rejection, preservation of the other participant's inbox and history, explicit reopening, restoration after a new message, and deleting a blocked conversation without unblocking it. The additive upgrade creates only inbox visibility records and backs up SQLite first.
- Browser: signed in using a test account, created a private room, and sent a message through the UI. Inspected the chat at 360×800 and 1440×900. The composer, navigation, and message content fit without visible overlap.
- Authentication and chat are backed by the running .NET service; no sample-data mode is used.

The integration checks exercise unauthorized reads, private discoverability, membership enforcement, invite limits, role restrictions, two-user SignalR delivery, retry deduplication, edits, unread clearing, unique DM pairs, blocking, disguised executable rejection, revoked invites, bans, refresh-family reuse revocation, valid image re-encoding, private attachment authorization, and revoked media access after message deletion.

Not verified: Docker/PostgreSQL/Redis execution (Docker Desktop’s engine was unavailable), real email delivery, load/latency targets, cloud media, all video codecs, browser matrix, formal accessibility compliance, or public production deployment. A clean local build is not evidence for these targets.

## Chat tools validation — 22 September 2026

- Tested the additive upgrade against a consistent copy of the existing database: all 10 accounts, 3 rooms, 5 messages, 4 memberships and 1 attachment were preserved. Verified the backup and version marker; restarting skipped the upgrade.
- Added integration checks for reply persistence/edit propagation/deduplication/cross-channel rejection; real-time reactions/idempotency/removal ownership; pin permissions and privacy; search filters and context access; and deletion cleanup/sanitized quoted content. All 22 checks passed, including timed-mute hierarchy/write restrictions/read access/unmute and deletion clearing unread badges.
- Backend builds with zero warnings/errors. Frontend production build passes TypeScript and Vite, at approximately 126 KB gzip JavaScript.

- Browser follow-up: verified filtered search against existing chat content and jump-to-context; inspected mobile context at 360×800 and enlarged message-action touch targets. Restored the normal viewport after inspection. Final mute controls are covered by the build and API tests; manual browser verification of mute UI and draft recovery remains outstanding.

## Profile and room pictures — 22 September 2026

- All 24 integration tests pass against an isolated database. New checks verify authenticated avatar reads, live notifications, upload/replacement/removal, 256×256 WebP output, block privacy, invalid or mismatched formats, 5 MB limit, private room icon access and owner/admin management.
- Upgraded a copy of the existing database and verified every original row in users, rooms, messages, memberships, attachments, replies, reactions and pins against its pre-upgrade backup.
- Browser: signed into an isolated test account and verified saved avatars and room icons in profile settings, room navigation and public discovery. Mobile picture-editor behavior and the native file-picker workflow still require broader browser coverage.

## DM requests — 22 September 2026

- All 28 integration checks pass. Requests stay pending when both users initiate; only the recipient can accept or decline and only the sender can cancel. Pending requests deny messages, history, search, pins, uploads, subscriptions and typing. Acceptance delivers a live event and unlocks chat. Tests also cover stale request IDs, retry cooldowns, decline/cancel behavior and blocking/unblocking without automatic acceptance.
- The upgrade was applied to a consistent copy of the existing database. Every original row in users, rooms, channels, messages, memberships, attachments, replies, reactions, pins and pictures was preserved. All three existing direct channels remain accepted; the backup and version marker were verified.
- Browser: the isolated recipient account displayed its incoming request and Accept/Decline/Block controls. The accepted conversation subsequently displayed its message composer. Backend and frontend builds pass; a wider browser/device matrix and concurrent multi-node load testing remain outstanding.
- The live local database was upgraded with its automatic backup. Original records and all three existing DMs were preserved. The API health endpoint and frontend proxy both return healthy responses on ports 5080 and 5173.

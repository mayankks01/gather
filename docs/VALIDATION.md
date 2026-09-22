# Validation

Validated locally on Windows with .NET 10 and Node.js 22.

- Backend: `dotnet build backend/Gather.Api --no-restore` succeeds.
- Frontend: `npm run build` succeeds, including strict TypeScript checking. The initial production JavaScript bundle is approximately 126 KB gzip; the PRD’s 250 KB proposal is met by the current build output, excluding externally loaded fonts and user media.
- Integration suite: `node --test tests/api.test.mjs` passes 24 checks against an isolated SQLite database on port 5081.
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

# PRD implementation status

Source: Gather_PRD_v1.0.pdf, version 1.0, dated 21 September 2026.

This is a functional development baseline of the PRD’s core flows. Selected P1 chat features are implemented; later-release and production gaps remain explicitly listed below. “Implemented” means code is present; validation evidence is recorded separately in VALIDATION.md.

| Area | Implemented | Remaining / qualifications |
|---|---|---|
| AUTH-01–05 | Email/username registration, password hashing, basic common-password denylist, age acknowledgement, login, 15-minute JWT, rotating cookie refresh, reuse detection, single-use verification/reset, lockout, profile/bio, 30-day username change | Complete common-password corpus; profile avatar upload; old-username reservation; email provider delivery; verification enforcement policy; sustained account/IP abuse tests |
| ROOM-01–07 | Public/private creation, explicit general channel, discover, join/leave, owner/admin/moderator/member roles, role updates, ownership transfer, typed deletion, invite expiry/use limits/revocation, ban/unban, 1,000-member check, member search in sidebar/settings | Custom image room icons (color/initials used); member pagination UI; richer role-specific moderation UI; concurrency stress testing of joins |
| MSG-01–07 | Real-time text, server validation, persisted UUIDv7 IDs, unique sender/client IDs, retry, edits/deletes, cursor history, virtualized list, typing expiry, unread counts, monotonic read markers, reconnect gap filling, viewport-based read advancement, tab-scoped draft text | Read state tracks the visible virtualized range while the page is visible; full cross-browser viewport certification remains; history uses a Load earlier control rather than automatic upward loading; presence is polled online/offline, not idle/heartbeats; full offline queue durability and multi-node tests |
| P1 chat tools | Same-channel quoted replies with jump to context; emoji reactions and participant names; moderator-managed room pins and DM pins; paginated conversation search with sender/date/media filters | Search uses substring matching rather than a production full-text index; up to 100 pins per conversation and 8 reactions per user/message; large-history performance unverified |
| MEDIA-01–06 | Images ≤10 MB, videos ≤100 MB, up to ten attachments, progress/cancel, paste/drop, caption, magic/header checks, image decode validation, metadata removal, authenticated previews/lightbox | Local API-proxied storage replaces pre-signed object storage; no CDN; image processing is synchronous; no video poster/thumbnail worker; video container header validation is not a full codec/malware scan; videos are fetched as blobs rather than efficient authenticated streaming; upload quota/retention cleanup; orphan cleanup; cloud storage adapter |
| DM-01–04 | Prefix search with minimum length and rate limit, unique sorted pair, inbox, text/media, blocking and search/presence hiding | Default privacy/message requests are v1.1; inbox sorts server-side by last send activity |
| NOTIF-01 | Unread badges and in-app notification toasts | Mentions and persistent notification preferences are deferred |
| MOD-01–03 | Kick, ban/unban, timed mute/unmute with expiry and hierarchy enforcement, server role checks, rate limiting, age acknowledgement | Final legal ToS/community guidelines and regional age policy; per-connection and distributed abuse controls; moderation audit log |
| UX-01–03 | Mobile navigation, themes following initial system preference, native modal focus containment/Escape, labeled controls, empty/loading/error/offline states | Formal WCAG AA contrast, axe and screen-reader certification; exact 200% text layout audit; presence and new-message announcement refinements |
| Architecture | React 19 + TypeScript + Vite, .NET 10 API, SignalR, EF Core, PostgreSQL option, SQLite local mode, optional Redis backplane, JSON console logging, versioned additive chat-tools upgrade with automatic SQLite backup | Provider-specific migrations, OpenAPI, distributed ephemeral state and limits, background workers, tracing/metrics, backup/restore practice, cloud deployment |

## Release boundaries

The following are not implemented: multi-channel room UI, Markdown rendering, mentions, push/email digests, friends/message requests, PWA/offline shell, voice messages/calls, group DMs, bots, E2EE, reporting/review queue, platform administration, session listing, data export/deletion, i18n, custom roles, and transcoding. Several belong to later releases in the PRD; production P0 gaps are listed above explicitly.

## Security model

- Every channel read, write, subscription, and media request checks current membership or the DM pair. Messages are delivered to authorized users’ personal SignalR groups, not stale room memberships.
- User-supplied message text is rendered by React as text. No raw HTML or unsafe Markdown renderer is used.
- Room role hierarchy is checked server-side. A moderator cannot remove an admin or owner.
- Password reset increments the account token version and revokes refresh sessions. Hub invocations also re-check this version; immediate removal of revoked connections from all receive groups remains a production hardening task.
- Deleted messages expose neither their original text nor attachments; attachment downloads also check message deletion.
- All cloud-scale/performance targets in the PRD remain unproven until load testing; no 10,000-user or 300 ms guarantee is claimed.

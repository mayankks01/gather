# Architecture

Replies reference an original message in the same channel. Message views batch-load reply previews, grouped reactions and pins, including on history reload. Edits and deletion update quoted previews in connected clients; deleted content is hidden in history, search, pins and replies. Reaction writes are idempotent per message/user/emoji, with up to eight different reactions per user. Room pin management requires Owner/Admin/Moderator; either participant may pin a DM. A conversation permits 100 pins.

Search applies channel authorization before filtering text, exact sender username, dates and attachment presence. Results use stable ID cursors. It currently uses database substring matching, not a full-text search index; large-history latency remains unverified. Selecting a result opens its surrounding context with a return-to-latest control. Browser-tab session storage saves draft text separately for each account and conversation. Files and failed sends are not durably queued.

`SchemaUpgrades` applies a recorded additive upgrade to existing EnsureCreated databases. SQLite backups use its consistent backup API; no original message or account tables are rebuilt. Subsequent starts skip the recorded version. PostgreSQL backups and controlled single-process upgrade execution remain operator responsibilities.

Gather is a modular monolith. The browser connects to `/api/v1` for resource operations and `/hubs/chat` for message lifecycle/typing events. The Vite development proxy (or Nginx in Docker) keeps these on one origin.

Room and Direct conversations share the `Channel` entity. Every room receives one `general` channel; a direct channel has an ordered, uniquely indexed user pair. Messages use UUIDv7 IDs plus a unique `(SenderId, ClientMessageId)` constraint. EF Core indexes `(ChannelId, Id)` for cursor history.

JWT access tokens remain in browser memory. A same-site httpOnly cookie supplies the rotating refresh token. Cookie-authenticated routes require the custom `X-Gather-Client: web` header, and there is no cross-origin credential policy. User data and media requests use bearer authentication. Verification/recovery tokens are cryptographically random, hashed at rest, single-use and expiring.

The hub delegates authorization and persistence to scoped services. Successful writes broadcast to personal user groups selected from current room membership or the direct pair. History queries are the source of truth; reconnect fetches newer messages in ascending pages until caught up. Pending messages retain their client ID when retried.

Local media files receive random storage keys outside the web root. Files cannot be downloaded by guessing a filename: the API resolves an attachment ID and checks channel membership and message deletion. ImageSharp decodes/re-encodes images and strips metadata. The storage path is intentionally an isolated development adapter pending object-store upload handshakes, a processing worker and signed delivery.

Current single-process constraints: online presence and rate limits are in memory; members are polled every 15 seconds. Redis configuration enables SignalR fan-out only. Database operations protect message and DM uniqueness; join and attachment ownership races still require concurrency/load tests before deployment.

For production, split out media storage/processing and email delivery, introduce migration history, use Redis for ephemeral state and distributed rate limits, instrument latency/queue depth, and verify TLS/CSP/backups against the deployment environment. The source code and coverage checklist intentionally distinguish these tasks from the working local flows.

Profile avatars and room icons are bounded 256×256 WebP thumbnails stored in separate UserPictures/RoomPictures tables with cascading foreign keys. This keeps replacements atomic and includes thumbnails in database backups. Reads use authenticated blob requests; visible components share a short-lived bounded cache. Authorized audiences receive PictureChanged events, and reconnect clears cached pictures. SQLite applies the additive pictures upgrade after the chat-tools upgrade with a separate consistent backup; production object-storage migration remains a future step.

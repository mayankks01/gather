# Gather

**Live demo:** [https://gather-nine-nu.vercel.app/](https://gather-nine-nu.vercel.app/)

A real-time community chat application based on **Gather PRD v1.0 (21 September 2026)**. This repository contains a working development implementation, not a production-certified v1.0 release.

## Start locally

**Free demo deployment:** follow [Vercel + Render Free + Neon + Cloudinary + Brevo](docs/FREE-DEPLOYMENT.md). The repository includes a Render Free Blueprint and environment template. For a paid backend with a persistent disk, use [the earlier Docker guide](docs/VERCEL-DEPLOYMENT.md).

Requirements: **.NET 10 SDK**, **Node.js 22.12+**, and npm.

From the repository root, open two terminals:

```powershell
# Terminal 1 — API, SQLite database, and SignalR
 dotnet restore backend/Gather.Api
 dotnet run --project backend/Gather.Api
```

```powershell
# Terminal 2 — React application
 cd frontend
 npm ci
 npm run dev
```

Open **http://localhost:5173**. Create an account, create a room, and invite another account. There are no preloaded users, passwords, or simulated messages. To test with two people locally, use a second browser profile or private window.

The API listens on port **5080**. Vite proxies `/api` and `/hubs`, so the browser uses one origin. Both ports are bound locally by default.

### Email in development

Without email settings in Development, verification and password-reset messages are written to `backend/Gather.Api/App_Data/mail/`. Open the newest `.txt` file and follow its link. Tokens are single-use and expire; they are not returned from public account endpoints. Production requires either Brevo's HTTPS API (`Email__Provider=Brevo`) or SMTP over TLS; it never uses the development file outbox.

Local uploads and the SQLite database live in ignored `backend/Gather.Api/App_Data/`. Refresh tokens are stored as hashes in the database and sent in an httpOnly, SameSite=Strict cookie. The cookie is Secure outside Development. Access tokens last 15 minutes and are kept in memory. Without a configured signing key, Development generates a new key per API restart; refresh restores sessions after a restart.

## What works

- Registration, login, account lockout, profile editing, avatar upload/removal, username rules and 30-day change limit.
- Password recovery and email verification using a development mail outbox.
- JWT access tokens, rotating refresh cookies, refresh reuse detection, logout.
- Public/private rooms, discovery, membership, custom room icons, an explicit default `general` channel.
- Discover shows your joined public/private rooms first, with Open room buttons and unread counts, followed by other public rooms. Room search filters both sections without duplicate cards.
- Owner/Admin/Moderator/Member permissions, role changes, ownership transfer, kick, ban/unban, leave, and confirmed deletion.
- Timed room mutes with automatic expiry, role-hierarchy checks and a muted-composer notice.
- Expiring and usage-limited invite links, preview, copy, revoke, and acceptance after signing in.
- SignalR text chat, optimistic sending, retry/idempotency, edits, soft deletion, typing, persistent cursor history and reconnect gap filling.
- Virtualized message lists, unread counts and read markers.
- Quoted replies, emoji reactions with participant names, and moderated pinned messages.
- Conversation search by text, sender, dates, and attachments; jump to matching messages.
- Searchable emoji picker, room member filtering, and draft text saved per conversation in the current browser tab.
- Username search, incoming/sent DM requests, accept/decline/cancel/block controls, and one conversation per user pair. New conversations unlock after acceptance; existing chats stay available.
- Delete conversation removes a DM from your own inbox after confirmation. Message history and the other person's inbox are preserved; opening it again or a new message restores it. Use blocking to prevent further contact.
- Remove connection on the Direct messages page disconnects both accounts after confirmation. Neither participant can chat or access the old history until a new request is accepted. Existing messages are retained for reconnecting; removing a connection does not block future requests.
- People search separates accepted connections from new people, matches display names and usernames, and offers Open chat or Request. Connections appear before typing; new-person searches require three characters. Each group shows up to 20 matches, so narrow the search for larger lists.
- Images and videos with upload progress/cancellation, drag/drop, clipboard paste, captions, inline previews and image lightbox.
- Extension/content checks, size limits, image re-encoding/metadata stripping, membership-checked media downloads.
- Responsive layout, light/dark appearance, keyboard-operable dialogs, loading/error/offline/empty states.

Read [`docs/PRD-status.md`](docs/PRD-status.md) for precise limitations and remaining launch requirements.

## Project structure

```text
backend/Gather.Api/
  Auth/           Session lifecycle, credentials, verification/recovery
  Data/           EF Core schema and indexes
  Domain/         Users, rooms, channels, messages, media and membership
  Features/       Room, DM, history and media endpoints; authorization
  Realtime/       SignalR hub and chat service
frontend/src/
  components/     Chat, accessible dialogs, room/member management
  pages/          Account entry and recovery
  lib/            Typed API client, uploads and shared contracts
  App.tsx         App shell, navigation and connection lifecycle
tests/            API and real-time integration checks
docs/             Architecture and PRD coverage
```

## Validation

```powershell
dotnet build backend/Gather.Api
cd frontend
npm run build
# While the API is running:
npm run test:api
```

The integration suite creates uniquely named test accounts and a temporary room in the current database. It deletes its room afterward; test accounts remain. Run it against a disposable database for CI. Override the API URL with `GATHER_TEST_URL`.

## PostgreSQL and Redis

SQLite is the default single-machine development provider. To use PostgreSQL, set:

```text
Database__Provider=Postgres
ConnectionStrings__Gather=Host=localhost;Port=5432;Database=gather;Username=gather;Password=<password>
```

Optional `ConnectionStrings__Redis` enables the SignalR backplane. Presence tracking and fixed-window rate limits are currently per API process; a Redis backplane alone does not make all application state distributed.

`docker compose up --build` provides a local PostgreSQL, Redis, API, and web stack at **http://localhost:5173**. Copy `.env.example` to `.env` and replace the placeholders first. Docker is configured as a development environment; it is not an internet deployment recipe.

Fresh databases use EF Core `EnsureCreated`. Existing installations receive versioned, additive upgrades for replies, reactions, pins, profile/room pictures, and DM requests. Before each upgrade, SQLite creates a consistent backup in `App_Data/backups/` (or `backups/` beside a custom database). Existing direct conversations are marked accepted and preserved. Back up PostgreSQL separately and apply upgrades from a single process. Adopt reviewed provider-specific migrations for subsequent production changes; do not combine EnsureCreated and EF migrations on an existing database without a migration baseline.

## Production configuration and remaining work

Set a persistent random `Jwt__Key` (at least 32 characters), public URL, database credentials, TLS termination, backups and secrets management. Local media and mail are development adapters. Cloud object storage with pre-signed upload URLs, processing workers, malware scanning, SMTP/provider delivery, distributed presence/rate limits, migrations, observability, load testing, and an accessibility/security review remain before a public launch. See the coverage checklist for all gaps.

Image processing uses **SixLabors.ImageSharp 3.1.12**, which has a tiered license. Review its bundled license and your organization’s eligibility before commercial use; substitute an appropriately licensed processor if needed.

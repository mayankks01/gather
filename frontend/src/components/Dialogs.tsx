import { useEffect, useState, type FormEvent } from "react";
import {
  Copy,
  Hash,
  Link2,
  Plus,
  Search,
  Shield,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import type { Invite, Room, User } from "../lib/types";
import { Avatar, Modal } from "./Common";
import { PictureEditor } from "./Pictures";
type Shared = { onClose: () => void; onError: (error: unknown) => void };
export function RoomForm({
  onClose,
  onError,
  onCreated,
}: Shared & { onCreated: (channel: string) => void }) {
  const [busy, setBusy] = useState(false),
    [color, setColor] = useState("#6554c0");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      const r = await api<{ channelId: string }>("/rooms", "POST", {
        name: f.get("name"),
        description: f.get("description"),
        isPrivate: f.get("visibility") === "private",
        color,
      });
      onCreated(r.channelId);
      onClose();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Make room for your people." onClose={onClose}>
      <p className="modal-description">
        A study group, a side project, or just good company.
      </p>
      <form onSubmit={submit}>
        <label>
          Room name
          <input
            name="name"
            placeholder="e.g. The Design Collective"
            required
            maxLength={80}
            autoFocus
          />
        </label>
        <label>
          Description
          <textarea
            name="description"
            placeholder="What brings you together?"
            maxLength={500}
          />
        </label>
        <label>
          Visibility
          <select name="visibility">
            <option value="public">Public — discoverable by everyone</option>
            <option value="private">Private — invitation only</option>
          </select>
        </label>
        <label>Room color</label>
        <div className="color-picker">
          {["#6554c0", "#337a70", "#b36938", "#b2527e", "#446ba5"].map((c) => (
            <button
              type="button"
              key={c}
              aria-label={"Choose " + c}
              aria-pressed={c === color}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <button className="primary full" disabled={busy}>
          {busy ? "Creating…" : "Create room"}
          <Plus size={17} />
        </button>
      </form>
    </Modal>
  );
}
export function NewMessage({
  me,
  onClose,
  onError,
  onStart,
}: Shared & { me: User; onStart: (user: User) => Promise<void> }) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<User[]>([]),
    [sending, setSending] = useState(false),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    if (query.length < 3) {
      setResults([]);
      return;
    }
    let active = true;
    setLoading(true);
    const timeout = setTimeout(
      () =>
        api<User[]>("/users/search?q=" + encodeURIComponent(query))
          .then((users) => {
            if (active) setResults(users);
          })
          .catch(onError)
          .finally(() => {
            if (active) setLoading(false);
          }),
      300,
    );
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [query]);
  return (
    <Modal title="Send a message request." onClose={onClose}>
      <p className="modal-description">
        Find someone by username and send a request. You can chat once they
        accept.
      </p>
      <div className="search-field">
        <Search size={18} />
        <input
          autoFocus
          aria-label="Search usernames"
          placeholder="At least 3 characters…"
          maxLength={20}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="search-results">
        {loading ? (
          <p className="muted">Looking for your people…</p>
        ) : results.length ? (
          results
            .filter((u) => u.id !== me.id)
            .map((u) => (
              <button
                className="person-row"
                key={u.id}
                disabled={sending}
                onClick={async () => {
                  setSending(true);
                  try {
                    await onStart(u);
                    onClose();
                  } catch (error) {
                    onError(error);
                  } finally {
                    setSending(false);
                  }
                }}
              >
                <Avatar user={u} />
                <div>
                  <strong>{u.displayName}</strong>
                  <small>@{u.username}</small>
                </div>
                <UserPlus size={18} />
                <span className="request-label">
                  {sending ? "Sending…" : "Request"}
                </span>
              </button>
            ))
        ) : (
          <p className="muted">
            {query.length >= 3
              ? "No matching usernames found."
              : "A good conversation is one search away."}
          </p>
        )}
      </div>
    </Modal>
  );
}
export function JoinInvite({
  onClose,
  onError,
  onJoined,
}: Shared & { onJoined: (channel: string) => void }) {
  const [code, setCode] = useState(
      new URLSearchParams(location.search).get("invite") || "",
    ),
    [preview, setPreview] = useState<{
      name: string;
      description: string;
    } | null>(null);
  function normalized() {
    try {
      return new URL(code).searchParams.get("invite") || code.trim();
    } catch {
      return code.trim();
    }
  }
  return (
    <Modal title="You’re invited." onClose={onClose}>
      <p className="modal-description">
        Paste an invite link or code to find your room.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            if (!preview)
              setPreview(
                await api("/invites/" + encodeURIComponent(normalized())),
              );
            else {
              const result = await api<{ channelId: string }>(
                "/invites/" + encodeURIComponent(normalized()) + "/accept",
                "POST",
              );
              history.replaceState(null, "", "/");
              onJoined(result.channelId);
              onClose();
            }
          } catch (error) {
            onError(error);
          }
        }}
      >
        <label>
          Invite link or code
          <input
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setPreview(null);
            }}
            required
            autoFocus
          />
        </label>
        {preview && (
          <div className="invite-preview">
            <Hash />
            <h3>{preview.name}</h3>
            <p>{preview.description}</p>
          </div>
        )}
        <button className="primary full">
          {preview ? "Join room" : "Preview invitation"}
          <Link2 size={17} />
        </button>
      </form>
    </Modal>
  );
}
export function RoomSettings({
  room,
  me,
  onClose,
  onError,
  onChanged,
}: Shared & { room: Room; me: User; onChanged: () => void }) {
  const [tab, setTab] = useState("overview"),
    [memberQuery, setMemberQuery] = useState(""),
    [members, setMembers] = useState<User[]>([]),
    [invites, setInvites] = useState<Invite[]>([]),
    [bans, setBans] = useState<User[]>([]);
  const manage = ["Owner", "Admin"].includes(room.role),
    owner = room.role === "Owner";
  async function load() {
    try {
      setMembers(await api(`/rooms/${room.id}/members`));
      if (manage) {
        setInvites(await api(`/rooms/${room.id}/invites`));
        setBans(await api(`/rooms/${room.id}/bans`));
      }
    } catch (error) {
      onError(error);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function action(path: string, method: string, body?: unknown) {
    try {
      await api(`/rooms/${room.id}` + path, method, body);
      await load();
      onChanged();
    } catch (error) {
      onError(error);
    }
  }
  return (
    <Modal title={room.name} onClose={onClose} wide>
      <div className="tabs">
        {["overview", "members", ...(manage ? ["invites", "bans"] : [])].map(
          (t) => (
            <button
              key={t}
              className={tab === t ? "active" : ""}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ),
        )}
      </div>
      {tab === "overview" && (
        <>
          {manage && (
            <PictureEditor
              kind="icon"
              id={room.id}
              label={room.name}
              onError={onError}
            />
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              await action("", "PATCH", {
                name: f.get("name"),
                description: f.get("description"),
                isPrivate: f.get("visibility") === "private",
                color: room.color,
              });
            }}
          >
            <label>
              Room name
              <input
                name="name"
                defaultValue={room.name}
                required
                maxLength={80}
                disabled={!manage}
              />
            </label>
            <label>
              Description
              <textarea
                name="description"
                defaultValue={room.description}
                maxLength={500}
                disabled={!manage}
              />
            </label>
            <label>
              Visibility
              <select
                name="visibility"
                defaultValue={room.isPrivate ? "private" : "public"}
                disabled={!manage}
              >
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
            </label>
            {manage && <button className="primary full">Save changes</button>}
          </form>
          <div className="danger-zone">
            <button
              className="danger"
              onClick={async () => {
                if (owner) {
                  const name = prompt(
                    "Type the room name to permanently delete it.",
                  );
                  if (name !== room.name) return;
                  try {
                    await api(
                      `/rooms/${room.id}?confirmation=${encodeURIComponent(name)}`,
                      "DELETE",
                    );
                    onChanged();
                    onClose();
                  } catch (error) {
                    onError(error);
                  }
                } else if (confirm("Leave this room?")) {
                  await action("/leave", "POST");
                  onClose();
                }
              }}
            >
              {owner ? "Delete room" : "Leave room"}
            </button>
            <small>
              {owner
                ? "This permanently deletes the room and its conversations."
                : "You can rejoin a public room or use a new invitation."}
            </small>
          </div>
        </>
      )}
      {tab === "members" && (
        <div className="manage-list">
          <input
            className="member-search"
            aria-label="Search members"
            placeholder="Search name or username…"
            value={memberQuery}
            onChange={(e) => setMemberQuery(e.target.value)}
          />
          {!members.some((u) =>
            `${u.displayName} ${u.username}`
              .toLowerCase()
              .includes(memberQuery.toLowerCase()),
          ) && <p className="muted">No members found.</p>}
          {members
            .filter((u) =>
              `${u.displayName} ${u.username}`
                .toLowerCase()
                .includes(memberQuery.toLowerCase()),
            )
            .map((u) => (
              <div className="manage-member" key={u.id}>
                <Avatar user={u} />
                <div>
                  <strong>{u.displayName}</strong>
                  <small>
                    @{u.username} · {u.role}
                  </small>
                  {(u.mutedUntil ?? 0) > Date.now() && (
                    <small className="mute-status">
                      Muted until {new Date(u.mutedUntil!).toLocaleString()}
                    </small>
                  )}
                </div>
                {u.id !== me.id &&
                  u.role !== "Owner" &&
                  (owner ||
                    (room.role === "Admin" && u.role !== "Admin") ||
                    (room.role === "Moderator" && u.role === "Member")) && (
                    <select
                      aria-label={"Mute " + u.displayName}
                      value=""
                      onChange={(e) => {
                        if (e.target.value !== "")
                          void action(`/members/${u.id}/mute`, "PUT", {
                            minutes: Number(e.target.value),
                          });
                      }}
                    >
                      <option value="" disabled>
                        {(u.mutedUntil ?? 0) > Date.now()
                          ? "Change mute…"
                          : "Mute…"}
                      </option>
                      <option value="5">5 minutes</option>
                      <option value="60">1 hour</option>
                      <option value="1440">1 day</option>
                      <option value="10080">1 week</option>
                      {(u.mutedUntil ?? 0) > Date.now() && (
                        <option value="0">Remove mute</option>
                      )}
                    </select>
                  )}
                {u.id !== me.id && u.role !== "Owner" && manage && (
                  <>
                    <select
                      aria-label={"Role for " + u.displayName}
                      value={u.role}
                      disabled={!owner && u.role === "Admin"}
                      onChange={(e) =>
                        action("/members/" + u.id, "PATCH", {
                          role: e.target.value,
                        })
                      }
                    >
                      {(owner
                        ? ["Admin", "Moderator", "Member"]
                        : ["Moderator", "Member"]
                      ).map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                    <button
                      className="icon-button danger"
                      aria-label={"Kick " + u.displayName}
                      onClick={() => {
                        if (
                          confirm(
                            "Remove " + u.displayName + " from this room?",
                          )
                        )
                          void action("/members/" + u.id, "DELETE");
                      }}
                    >
                      <X size={17} />
                    </button>
                    <button
                      className="icon-button danger"
                      aria-label={"Ban " + u.displayName}
                      onClick={() => {
                        const reason = prompt(
                          "Ban reason (optional). Cancel to keep this member.",
                        );
                        if (reason !== null)
                          void action("/bans/" + u.id, "POST", { reason });
                      }}
                    >
                      <Shield size={17} />
                    </button>
                    {owner && (
                      <button
                        className="text-button"
                        onClick={async () => {
                          if (
                            confirm(
                              "Transfer ownership to " +
                                u.displayName +
                                "? You will become an admin.",
                            )
                          ) {
                            await action("/transfer/" + u.id, "POST");
                            onClose();
                          }
                        }}
                      >
                        Make owner
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
        </div>
      )}
      {tab === "invites" && (
        <>
          <form
            className="invite-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              await action("/invites", "POST", {
                hours: f.get("hours") === "" ? null : Number(f.get("hours")),
                maxUses:
                  f.get("maxUses") === "" ? null : Number(f.get("maxUses")),
              });
            }}
          >
            <label>
              Expires after
              <select name="hours" defaultValue="168">
                <option value="1">1 hour</option>
                <option value="24">1 day</option>
                <option value="168">7 days</option>
                <option value="">Never</option>
              </select>
            </label>
            <label>
              Maximum uses
              <input
                name="maxUses"
                type="number"
                min={1}
                max={1000}
                placeholder="Unlimited"
              />
            </label>
            <button className="primary full">Create invite link</button>
          </form>
          <div className="invite-list">
            {invites.map((i) => (
              <div key={i.code}>
                <div>
                  <strong>
                    {i.uses}
                    {i.maxUses ? "/" + i.maxUses : ""} uses
                  </strong>
                  <small>
                    {i.expiresAt
                      ? "Expires " + new Date(i.expiresAt).toLocaleString()
                      : "Does not expire"}
                  </small>
                </div>
                <button
                  className="icon-button"
                  aria-label="Copy invite link"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(location.origin + "/?invite=" + i.code)
                      .then(() => onError(new Error("Invite link copied.")))
                      .catch(onError)
                  }
                >
                  <Copy size={17} />
                </button>
                <button
                  className="icon-button danger"
                  aria-label="Revoke invite"
                  onClick={() => action("/invites/" + i.code, "DELETE")}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {tab === "bans" && (
        <div className="manage-list">
          {!bans.length && <p className="muted">No banned members.</p>}
          {bans.map((u) => (
            <div className="person-row" key={u.id}>
              <Avatar user={u} />
              <div>
                <strong>{u.displayName}</strong>
                <small>@{u.username}</small>
              </div>
              <button
                className="text-button"
                onClick={() => action("/bans/" + u.id, "DELETE")}
              >
                Unban
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
export function UserSettings({
  me,
  onClose,
  onError,
  onUpdate,
  dark,
  setDark,
  onLogout,
}: Shared & {
  me: User;
  onUpdate: (u: User) => void;
  dark: boolean;
  setDark: (d: boolean) => void;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState("profile"),
    [blocks, setBlocks] = useState<User[]>([]);
  useEffect(() => {
    if (tab === "blocked")
      api<User[]>("/blocks").then(setBlocks).catch(onError);
  }, [tab]);
  return (
    <Modal title="Your Gather" onClose={onClose}>
      <div className="tabs">
        {["profile", "appearance", "blocked"].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "profile" && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const user = await api<User>(
                "/users/me",
                "PATCH",
                Object.fromEntries(new FormData(e.currentTarget)),
              );
              onUpdate(user);
              onError(new Error("Profile saved."));
            } catch (error) {
              onError(error);
            }
          }}
        >
          <PictureEditor
            kind="avatar"
            id={me.id}
            label={me.displayName}
            onError={onError}
          />
          <label>
            Display name
            <input
              name="displayName"
              defaultValue={me.displayName}
              required
              maxLength={60}
            />
          </label>
          <label>
            Username
            <input
              name="username"
              defaultValue={me.username}
              required
              minLength={3}
              maxLength={20}
            />
            <small>Can be changed once every 30 days.</small>
          </label>
          <label>
            About you
            <textarea
              name="bio"
              defaultValue={me.bio}
              maxLength={300}
              placeholder="A little about you…"
            />
          </label>
          <button className="primary full">Save profile</button>
          <div className="verification">
            {me.emailVerified ? (
              "Email verified"
            ) : (
              <>
                <span>Email verification pending.</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    api("/auth/resend-verification", "POST")
                      .then(() =>
                        onError(new Error("Verification link requested.")),
                      )
                      .catch(onError)
                  }
                >
                  Resend link
                </button>
              </>
            )}
          </div>
        </form>
      )}
      {tab === "appearance" && (
        <div className="theme-options">
          <button
            className={!dark ? "selected" : ""}
            onClick={() => setDark(false)}
          >
            <div className="theme-preview light" />
            Light
          </button>
          <button
            className={dark ? "selected" : ""}
            onClick={() => setDark(true)}
          >
            <div className="theme-preview dark" />
            Dark
          </button>
        </div>
      )}
      {tab === "blocked" && (
        <div className="manage-list">
          {!blocks.length && (
            <p className="muted">You haven’t blocked anyone.</p>
          )}
          {blocks.map((u) => (
            <div className="person-row" key={u.id}>
              <Avatar user={u} />
              <div>
                <strong>{u.displayName}</strong>
                <small>@{u.username}</small>
              </div>
              <button
                className="text-button"
                onClick={() =>
                  api("/blocks/" + u.id, "DELETE")
                    .then(() =>
                      setBlocks((previous) =>
                        previous.filter((b) => b.id !== u.id),
                      ),
                    )
                    .catch(onError)
                }
              >
                Unblock
              </button>
            </div>
          ))}
        </div>
      )}
      <button className="secondary full" onClick={onLogout}>
        Sign out
      </button>
    </Modal>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import {
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
  type HubConnection,
} from "@microsoft/signalr";
import {
  ArrowUpRight,
  Compass,
  Hash,
  Link2,
  LockKeyhole,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { api, restoreSession, setToken, token } from "./lib/api";
import { refreshPicture } from "./lib/pictures";
import { Picture } from "./components/Pictures";
import type { Direct, DirectRequest, Message, Room, User } from "./lib/types";
import { DirectRequests } from "./components/DirectRequests";
import { DiscoverRooms } from "./components/DiscoverRooms";
import { Avatar, Brand, Empty, Modal } from "./components/Common";
import { Chat } from "./components/Chat";
import {
  JoinInvite,
  NewMessage,
  RoomForm,
  RoomSettings,
  UserSettings,
} from "./components/Dialogs";
import { AuthPage } from "./pages/AuthPage";
export default function App() {
  const [me, setMe] = useState<User | null>(null),
    [booting, setBooting] = useState(true),
    [rooms, setRooms] = useState<Room[]>([]),
    [directs, setDirects] = useState<Direct[]>([]),
    [blockedUsers, setBlockedUsers] = useState<User[]>([]),
    [blockBusy, setBlockBusy] = useState(false),
    [deleteBusy, setDeleteBusy] = useState(false),
    [removingConnection, setRemovingConnection] = useState(""),
    [requests, setRequests] = useState<DirectRequest[]>([]),
    [requestTab, setRequestTab] = useState<"incoming" | "sent">("incoming"),
    [active, setActive] = useState(""),
    [view, setView] = useState("discover"),
    [modal, setModal] = useState(""),
    [members, setMembers] = useState<User[]>([]),
    [memberQuery, setMemberQuery] = useState(""),
    [discovery, setDiscovery] = useState<Room[]>([]),
    [query, setQuery] = useState(""),
    [membersOpen, setMembersOpen] = useState(true),
    [navOpen, setNavOpen] = useState(false),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(false),
    [reconnect, setReconnect] = useState(0),
    [hub, setHub] = useState<HubConnection | null>(null),
    [dark, setDark] = useState(() =>
      localStorage.getItem("gather.theme")
        ? localStorage.getItem("gather.theme") === "dark"
        : matchMedia("(prefers-color-scheme: dark)").matches,
    ),
    [profile, setProfile] = useState<User | null>(null),
    [discoverLoading, setDiscoverLoading] = useState(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const errorHandler = useCallback(
    (value: unknown) =>
      setError(
        value instanceof Error
          ? value.message
          : "Something went wrong. Please try again.",
      ),
    [],
  );
  const refresh = useCallback(async () => {
    const [r, d, requests, blocks] = await Promise.all([
      api<Room[]>("/rooms"),
      api<Direct[]>("/dm"),
      api<DirectRequest[]>("/dm/requests"),
      api<User[]>("/blocks"),
    ]);
    setRooms(r);
    setDirects(d);
    setRequests(requests);
    setBlockedUsers(blocks);
  }, []);
  const profileBlocked = blockedUsers.some((user) => user.id === profile?.id);
  const profileDirect = directs.find(
    (direct) => direct.user.id === profile?.id,
  );
  const open = (channel: string) => {
    setActive(channel);
    setView("chat");
    setNavOpen(false);
  };
  const refreshAndOpen = (channel: string) => {
    void refresh()
      .then(() => open(channel))
      .catch(errorHandler);
  };
  async function startDirect(user: User) {
    const result = await api<Omit<DirectRequest, "createdAt">>(
      "/dm/" + encodeURIComponent(user.username),
      "POST",
    );
    await refresh();
    if (result.state === "Accepted") open(result.channelId);
    else {
      setRequestTab(result.incoming ? "incoming" : "sent");
      setView("inbox");
      setActive("");
      setNavOpen(false);
      setError(
        result.incoming
          ? "This person already requested to chat. Review their request below."
          : "Request sent. You can chat once they accept.",
      );
    }
  }
  async function removeConnection(direct: Direct) {
    if (
      !confirm(
        `Remove ${direct.user.displayName} from your connections? This disconnects both accounts. A new request must be accepted before you can chat again. Your existing messages will be available if you reconnect.`,
      )
    )
      return;
    setRemovingConnection(direct.channelId);
    try {
      await api(`/dm/${direct.channelId}/connection`, "DELETE");
      setDirects((items) =>
        items.filter((item) => item.channelId !== direct.channelId),
      );
      setProfile(null);
      if (activeRef.current === direct.channelId) {
        setActive("");
        setView("inbox");
      }
      await refresh();
    } catch (error) {
      errorHandler(error);
    } finally {
      setRemovingConnection("");
    }
  }
  useEffect(() => {
    if (new URLSearchParams(location.search).has("action")) {
      setBooting(false);
      return;
    }
    restoreSession().then((session) => {
      if (session) setMe(session.user);
      setBooting(false);
    });
    const logout = () => setMe(null);
    window.addEventListener("gather:signout", logout);
    return () => window.removeEventListener("gather:signout", logout);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("gather.theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    if (!me) return;
    refreshPicture();
    void refresh().catch(errorHandler);
    if (new URLSearchParams(location.search).get("invite")) setModal("join");
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const connection = new HubConnectionBuilder()
      .withUrl("/hubs/chat", {
        accessTokenFactory: async () => {
          try {
            const payload = JSON.parse(atob(token().split(".")[1]));
            if (payload.exp * 1000 - Date.now() < 30_000)
              await restoreSession();
          } catch {
            await restoreSession();
          }
          return token();
        },
      })
      .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
      .configureLogging(LogLevel.Error)
      .build();
    setHub(connection);
    const start = () => {
      if (disposed) return;
      connection
        .start()
        .then(() => {
          if (!disposed) {
            setConnected(true);
            setReconnect((n) => n + 1);
            refreshPicture();
            void refresh().catch(() => {});
          }
        })
        .catch(() => {
          if (!disposed) timer = setTimeout(start, 5000);
        });
    };
    connection.on("MessageCreated", (message: Message) => {
      void refresh().catch(() => {});
      if (message.channelId !== activeRef.current && message.senderId !== me.id)
        setError(`New message from ${message.sender.displayName}`);
    });
    connection.on("UnreadUpdated", () => void refresh().catch(() => {}));
    connection.on(
      "DirectRequestsChanged",
      () => void refresh().catch(() => {}),
    );
    connection.on("PictureChanged", (event: { path: string }) =>
      refreshPicture(event.path),
    );
    connection.on("MessageUpdated", (message: Message) => {
      if (message.deleted) void refresh().catch(() => {});
    });
    connection.on("RoomsChanged", () => void refresh().catch(() => {}));
    connection.onreconnecting(() => setConnected(false));
    connection.onreconnected(() => {
      setConnected(true);
      setReconnect((n) => n + 1);
      refreshPicture();
      void refresh().catch(() => {});
    });
    connection.onclose(() => {
      if (!disposed) {
        setConnected(false);
        timer = setTimeout(start, 5000);
      }
    });
    start();
    return () => {
      disposed = true;
      clearTimeout(timer);
      void connection.stop();
      setHub(null);
      setConnected(false);
    };
  }, [me?.id]);
  useEffect(() => {
    if (!me || view !== "discover") return;
    let live = true;
    setDiscoverLoading(true);
    const timeout = setTimeout(
      () =>
        api<Room[]>("/rooms/discover?q=" + encodeURIComponent(query))
          .then((data) => {
            if (live) setDiscovery(data);
          })
          .catch(errorHandler)
          .finally(() => {
            if (live) setDiscoverLoading(false);
          }),
      200,
    );
    return () => {
      live = false;
      clearTimeout(timeout);
    };
  }, [me?.id, view, query, rooms.length]);
  const room = rooms.find((r) => r.channelId === active),
    direct = directs.find((d) => d.channelId === active);
  useEffect(() => {
    if (!me || !active) return;
    if (room) {
      let live = true;
      const update = () =>
        api<User[]>(`/rooms/${room.id}/members`)
          .then((data) => {
            if (live) setMembers(data);
          })
          .catch(errorHandler);
      void update();
      const interval = setInterval(update, 15000);
      return () => {
        live = false;
        clearInterval(interval);
      };
    } else if (direct) setMembers([me, direct.user]);
    else {
      setActive("");
      setView("discover");
    }
  }, [active, room?.id, direct?.channelId, me?.id, rooms]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "k" && me) {
        event.preventDefault();
        setModal("dm");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [me]);
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(""), 6000);
    return () => clearTimeout(timer);
  }, [error]);
  async function logout() {
    try {
      await api("/auth/logout", "POST");
    } catch (e) {
      errorHandler(e);
      return;
    }
    setToken("");
    setMe(null);
    setRooms([]);
    setDirects([]);
    setActive("");
    setModal("");
    setView("discover");
  }
  if (booting)
    return (
      <div className="boot">
        <Brand />
        <p>Finding your corner…</p>
      </div>
    );
  if (!me) return <AuthPage onLogin={setMe} />;
  const name = room?.name || direct?.user.displayName || "";
  const navTo = (next: string) => {
    setView(next);
    setNavOpen(false);
  };
  return (
    <div className="app-shell">
      <aside className="rail">
        <button
          className="rail-brand"
          aria-label="Gather home"
          onClick={() => navTo("discover")}
        >
          <Brand />
        </button>
        <div className="rail-rule" />
        <button
          className={"rail-button " + (view === "inbox" ? "selected" : "")}
          aria-label="Direct messages"
          onClick={() => navTo("inbox")}
        >
          <MessageCircle size={23} />
          {(directs.some((d) => d.unread > 0) ||
            requests.some((r) => r.incoming)) && <i className="unread-dot" />}
        </button>
        {rooms.map((r) => (
          <button
            className={
              "room-icon " +
              (active === r.channelId && view === "chat" ? "selected" : "")
            }
            key={r.id}
            style={{ "--room-color": r.color } as React.CSSProperties}
            title={r.name}
            onClick={() => open(r.channelId)}
          >
            <Picture
              path={`/rooms/${r.id}/icon`}
              fallback={r.name
                .split(" ")
                .map((s) => s[0])
                .slice(0, 2)
                .join("")}
            />
            {r.unread > 0 && <i className="unread-dot" />}
          </button>
        ))}
        <button
          className="rail-button add"
          aria-label="Create room"
          onClick={() => setModal("create")}
        >
          <Plus size={22} />
        </button>
        <button
          className={"rail-button " + (view === "discover" ? "selected" : "")}
          aria-label="Discover rooms"
          onClick={() => navTo("discover")}
        >
          <Compass size={23} />
        </button>
      </aside>
      {navOpen && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      )}
      <aside className={"sidebar " + (navOpen ? "open" : "")}>
        <div className="sidebar-heading">
          <span>YOUR CORNER OF THE INTERNET</span>
          <h2>
            Let’s gather<span>.</span>
          </h2>
        </div>
        <button className="quick-search" onClick={() => setModal("dm")}>
          <Search size={16} />
          <span>Find your people</span>
          <kbd>⌘ K</kbd>
        </button>
        <nav className="main-nav">
          <button
            className={view === "discover" ? "active" : ""}
            onClick={() => navTo("discover")}
          >
            <Compass size={18} />
            Discover rooms
            <ArrowUpRight size={15} />
          </button>
          <button
            className={view === "inbox" ? "active" : ""}
            onClick={() => navTo("inbox")}
          >
            <MessageCircle size={18} />
            Direct messages
            {requests.some((r) => r.incoming) && (
              <span className="badge" aria-label="Incoming message requests">
                {requests.filter((r) => r.incoming).length}
              </span>
            )}
          </button>
        </nav>
        <div className="section-label">
          <span>YOUR ROOMS</span>
          <button aria-label="Create room" onClick={() => setModal("create")}>
            <Plus size={16} />
          </button>
        </div>
        <div className="sidebar-rooms">
          {rooms.map((r) => (
            <button
              className={
                "sidebar-room " +
                (active === r.channelId && view === "chat" ? "active" : "")
              }
              key={r.id}
              onClick={() => open(r.channelId)}
            >
              {r.isPrivate ? <LockKeyhole size={17} /> : <Hash size={18} />}
              <span>{r.name}</span>
              {r.unread > 0 && (
                <b className="badge">{Math.min(r.unread, 99)}</b>
              )}
            </button>
          ))}
          {!rooms.length && (
            <p className="sidebar-empty">Your next community is waiting.</p>
          )}
        </div>
        <div className="section-label dm-label">
          <span>DIRECT MESSAGES</span>
          <button
            aria-label="New direct message"
            onClick={() => setModal("dm")}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="sidebar-directs">
          {directs.map((d) => (
            <button
              className={
                "sidebar-dm " +
                (active === d.channelId && view === "chat" ? "active" : "")
              }
              key={d.channelId}
              onClick={() => open(d.channelId)}
            >
              <Avatar user={d.user} size="small" />
              <span>{d.user.displayName}</span>
              {d.unread > 0 && (
                <b className="badge">{Math.min(d.unread, 99)}</b>
              )}
            </button>
          ))}
          {!directs.length && (
            <p className="sidebar-empty">Say hello to someone new.</p>
          )}
        </div>
        <div className="sidebar-invite">
          <Sparkles size={22} />
          <h3>Better, together.</h3>
          <p>Make a little space for your people.</p>
          <button onClick={() => setModal("create")}>
            Create a room
            <Plus size={16} />
          </button>
        </div>
        <button
          className="user-panel"
          title="Profile and settings"
          onClick={() => setModal("settings")}
        >
          <Avatar user={me} size="small" online={connected} />
          <div>
            <strong>{me.displayName}</strong>
            <span>@{me.username}</span>
          </div>
          <Settings size={18} />
        </button>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <button
            className="icon-button mobile-nav"
            aria-label="Open navigation"
            onClick={() => setNavOpen(true)}
          >
            <Menu size={21} />
          </button>
          <div className="header-symbol">
            {view === "discover" ? (
              <Compass size={24} />
            ) : view === "inbox" ? (
              <MessageCircle size={23} />
            ) : room ? (
              <Hash size={25} />
            ) : (
              <MessageCircle size={23} />
            )}
          </div>
          <div className="header-title">
            <h1>
              {view === "discover"
                ? "Discover rooms"
                : view === "inbox"
                  ? "Direct messages"
                  : name}
            </h1>
            <p>
              {view === "chat"
                ? room
                  ? room.description || "A space for your people."
                  : "A conversation, just between you two."
                : "Find your people. Make yourself at home."}
            </p>
          </div>
          <div className="header-actions">
            {view === "chat" && room ? (
              <>
                {["Owner", "Admin"].includes(room.role) && (
                  <button
                    className="secondary invite-button"
                    onClick={() => setModal("room")}
                  >
                    <UserPlusIcon />
                    Invite people
                  </button>
                )}
                <button
                  className="icon-button member-toggle"
                  aria-label="Toggle members"
                  onClick={() => setMembersOpen(!membersOpen)}
                >
                  <Users size={20} />
                  <span>{room.memberCount}</span>
                </button>
                <button
                  className="icon-button"
                  aria-label="Room settings"
                  onClick={() => setModal("room")}
                >
                  <MoreHorizontal size={21} />
                </button>
              </>
            ) : view === "chat" && direct ? (
              <button
                className="icon-button"
                aria-label="View profile"
                onClick={() => setProfile(direct.user)}
              >
                <MoreHorizontal size={21} />
              </button>
            ) : (
              <button
                className="primary compact"
                onClick={() => setModal(view === "inbox" ? "dm" : "create")}
              >
                <Plus size={16} />
                {view === "inbox" ? "New request" : "Create room"}
              </button>
            )}
          </div>
        </header>
        {!connected && (
          <div className="connection-bar" role="status">
            Connecting to Gather… Messages will be ready to send when you’re
            back online.
          </div>
        )}
        {view === "chat" && (room || direct) ? (
          <div className="chat-layout">
            {direct?.blocked ? (
              <Empty
                icon={<LockKeyhole size={28} />}
                title="This conversation is unavailable."
              >
                <p>
                  Blocked conversations cannot send or receive messages.
                  <br />
                  Manage your blocked list in Settings.
                </p>
              </Empty>
            ) : (
              <Chat
                key={active}
                channelId={active}
                name={name}
                description={room?.description || ""}
                room={!!room}
                me={me}
                members={members}
                hub={hub}
                connected={connected}
                reconnect={reconnect}
                canModerate={
                  !!room && ["Owner", "Admin", "Moderator"].includes(room.role)
                }
                onRead={() => void refresh().catch(() => {})}
                onError={errorHandler}
              />
            )}
            {membersOpen && room && (
              <aside className="member-panel">
                <div className="member-panel-title">
                  IN THIS SPACE <span>{members.length}</span>
                </div>
                <input
                  className="member-search"
                  aria-label="Search room members"
                  placeholder="Find a member…"
                  value={memberQuery}
                  onChange={(e) => setMemberQuery(e.target.value)}
                />
                {!members.some((u) =>
                  `${u.displayName} ${u.username}`
                    .toLowerCase()
                    .includes(memberQuery.toLowerCase()),
                ) && <p className="muted">No members found.</p>}
                {["Owner", "Admin", "Moderator", "Member"].map((role) => {
                  const list = members.filter(
                    (u) =>
                      u.role === role &&
                      `${u.displayName} ${u.username}`
                        .toLowerCase()
                        .includes(memberQuery.toLowerCase()),
                  );
                  return (
                    list.length > 0 && (
                      <section key={role}>
                        <h3>
                          {role === "Owner"
                            ? "ROOM OWNER"
                            : role.toUpperCase() + "S"}{" "}
                          — {list.length}
                        </h3>
                        {list.map((u) => (
                          <button
                            className="member-row"
                            key={u.id}
                            onClick={() => setProfile(u)}
                          >
                            <Avatar user={u} size="small" online={u.online} />
                            <div>
                              <strong>
                                {u.displayName}
                                {u.id === me.id && <small> (you)</small>}
                              </strong>
                              <span>@{u.username}</span>
                            </div>
                            {role === "Owner" && (
                              <span className="owner-star">♔</span>
                            )}
                          </button>
                        ))}
                      </section>
                    )
                  );
                })}
                <div className="belong-note">
                  <span>✳</span>
                  <h3>A space to belong.</h3>
                  <p>
                    Different perspectives.
                    <br />
                    Shared curiosity.
                  </p>
                </div>
              </aside>
            )}
          </div>
        ) : (
          <section className="browse">
            <div className="browse-intro">
              <span className="eyebrow">
                {view === "inbox"
                  ? "YOUR PEOPLE, A MESSAGE AWAY"
                  : "FIND YOUR NEXT LITTLE CORNER"}
              </span>
              <h2>
                {view === "inbox"
                  ? "Keep the conversation going."
                  : "There’s a space for you here."}
              </h2>
              <p>
                {view === "inbox"
                  ? "Good conversations don’t have to happen in a crowd."
                  : "Find a shared interest. Meet a new perspective. Make yourself at home."}
              </p>
            </div>
            {view === "inbox" ? (
              <>
                <DirectRequests
                  requests={requests}
                  tab={requestTab}
                  setTab={setRequestTab}
                  onChanged={refresh}
                  onOpen={open}
                  onError={errorHandler}
                />
                {directs.length ? (
                  <div className="direct-grid">
                    {directs.map((d) => (
                      <article className="direct-connection" key={d.channelId}>
                        <button
                          className="direct-card"
                          onClick={() => open(d.channelId)}
                          aria-label={`Open conversation with ${d.user.displayName}`}
                        >
                          <Avatar user={d.user} />
                          <div>
                            <h3>{d.user.displayName}</h3>
                            <p>@{d.user.username}</p>
                          </div>
                          {d.unread > 0 ? (
                            <span className="badge">{d.unread}</span>
                          ) : (
                            <ArrowUpRight size={20} />
                          )}
                        </button>
                        <button
                          className="text-button remove-connection"
                          aria-label={`Remove connection with ${d.user.displayName}`}
                          disabled={!!removingConnection}
                          onClick={() => void removeConnection(d)}
                        >
                          {removingConnection === d.channelId
                            ? "Removing…"
                            : "Remove connection"}
                        </button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <Empty
                    icon={<MessageCircle size={32} />}
                    title="Good conversations start small."
                  >
                    <p>
                      Send a request to connect. Accepted conversations appear
                      here.
                    </p>
                    <button className="primary" onClick={() => setModal("dm")}>
                      Find your people
                      <ArrowUpRight size={17} />
                    </button>
                  </Empty>
                )}
              </>
            ) : (
              <>
                <div className="discover-toolbar">
                  <div className="search-field">
                    <Search size={18} />
                    <input
                      aria-label="Search rooms"
                      placeholder="Search for a community…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                  <button
                    className="secondary"
                    onClick={() => setModal("join")}
                  >
                    <Link2 size={16} />
                    Join with an invite
                  </button>
                </div>
                <DiscoverRooms
                  rooms={rooms}
                  discovery={discovery}
                  query={query}
                  loading={discoverLoading}
                  onOpen={open}
                  onJoin={async (room) => {
                    try {
                      const result = await api<{ channelId: string }>(
                        `/rooms/${room.id}/join`,
                        "POST",
                      );
                      refreshAndOpen(result.channelId);
                    } catch (error) {
                      errorHandler(error);
                    }
                  }}
                />
                <div className="discover-bottom">
                  <Sparkles size={18} />
                  <span>Every community starts with someone saying hello.</span>
                </div>
              </>
            )}
          </section>
        )}
      </main>
      {error && (
        <div className="toast" role="status">
          <span>{error}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setError("")}
          >
            <X size={18} />
          </button>
        </div>
      )}
      {modal === "create" && (
        <RoomForm
          onClose={() => setModal("")}
          onError={errorHandler}
          onCreated={refreshAndOpen}
        />
      )}
      {modal === "dm" && (
        <NewMessage
          me={me}
          onClose={() => setModal("")}
          onError={errorHandler}
          onStart={startDirect}
        />
      )}
      {modal === "join" && (
        <JoinInvite
          onClose={() => setModal("")}
          onError={errorHandler}
          onJoined={refreshAndOpen}
        />
      )}
      {modal === "room" && room && (
        <RoomSettings
          room={room}
          me={me}
          onClose={() => setModal("")}
          onError={errorHandler}
          onChanged={() => void refresh().catch(errorHandler)}
        />
      )}
      {modal === "settings" && (
        <UserSettings
          me={me}
          dark={dark}
          setDark={setDark}
          onClose={() => setModal("")}
          onError={errorHandler}
          onUpdate={setMe}
          onLogout={logout}
        />
      )}
      {profile && (
        <Modal title={profile.displayName} onClose={() => setProfile(null)}>
          <div className="profile-card">
            <Avatar user={profile} />
            <p>@{profile.username}</p>
            <p className="muted">{profile.bio || ""}</p>
          </div>
          {profile.id !== me.id && (
            <>
              <button
                className="primary full"
                onClick={async () => {
                  try {
                    await startDirect(profile);
                    setProfile(null);
                  } catch (error) {
                    errorHandler(error);
                  }
                }}
              >
                <MessageCircle size={17} />
                {directs.some((d) => d.user.id === profile.id)
                  ? "Open conversation"
                  : "Send message request"}
              </button>
              <button
                className="danger full"
                disabled={blockBusy || deleteBusy}
                onClick={async () => {
                  if (
                    !profileBlocked &&
                    !confirm(
                      "Block " +
                        profile.displayName +
                        "? They will not be able to DM you.",
                    )
                  )
                    return;
                  setBlockBusy(true);
                  try {
                    await api(
                      "/blocks/" + profile.id,
                      profileBlocked ? "DELETE" : "POST",
                    );
                    setBlockedUsers((users) =>
                      profileBlocked
                        ? users.filter((user) => user.id !== profile.id)
                        : [
                            ...users.filter((user) => user.id !== profile.id),
                            profile,
                          ],
                    );
                    await refresh();
                  } catch (error) {
                    errorHandler(error);
                  } finally {
                    setBlockBusy(false);
                  }
                }}
              >
                {blockBusy
                  ? "Updating…"
                  : profileBlocked
                    ? "Unblock user"
                    : "Block user"}
              </button>
              {profileDirect && (
                <button
                  className="danger full"
                  disabled={deleteBusy || blockBusy}
                  onClick={async () => {
                    if (
                      !confirm(
                        "Delete this conversation from your inbox? Message history and the other person's copy are kept. Opening the conversation again or a new message will restore it.",
                      )
                    )
                      return;
                    setDeleteBusy(true);
                    try {
                      await api("/dm/" + profileDirect.channelId, "DELETE");
                      setDirects((items) =>
                        items.filter(
                          (item) => item.channelId !== profileDirect.channelId,
                        ),
                      );
                      if (activeRef.current === profileDirect.channelId) {
                        setActive("");
                        setView("inbox");
                      }
                      setProfile(null);
                      await refresh();
                    } catch (error) {
                      errorHandler(error);
                    } finally {
                      setDeleteBusy(false);
                    }
                  }}
                >
                  {deleteBusy ? "Deleting…" : "Delete conversation"}
                </button>
              )}
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
function UserPlusIcon() {
  return <Plus size={16} />;
}

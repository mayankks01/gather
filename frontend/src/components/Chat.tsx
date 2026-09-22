import { useEffect, useRef, useState } from "react";
import type { HubConnection } from "@microsoft/signalr";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
  ArrowDown,
  Check,
  Edit3,
  FileImage,
  Hash,
  ImagePlus,
  LoaderCircle,
  MessageCircle,
  Paperclip,
  Send,
  Smile,
  Search,
  Pin,
  Reply,
  Trash2,
  X,
} from "lucide-react";
import { api, mediaBlob, upload } from "../lib/api";
import type { Attachment, History, Message, User } from "../lib/types";
import { Avatar, Empty, Modal } from "./Common";
import { EmojiPicker } from "./EmojiPicker";
import { MessageBrowser } from "./MessageBrowser";
export function combineMessages(previous: Message[], incoming: Message[]) {
  const map = new Map(previous.map((m) => [m.clientMessageId, m]));
  for (const m of incoming) map.set(m.clientMessageId, m);
  return Array.from(map.values()).sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
}
function Media({ file }: { file: Attachment }) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState(false),
    [lightbox, setLightbox] = useState(false);
  useEffect(() => {
    let disposed = false;
    let local = "";
    mediaBlob(file.id)
      .then((value) => {
        local = value;
        if (disposed) URL.revokeObjectURL(value);
        else setUrl(value);
      })
      .catch(() => setError(true));
    return () => {
      disposed = true;
      if (local) URL.revokeObjectURL(local);
    };
  }, [file.id]);
  if (error) return <p className="muted">This media is unavailable.</p>;
  if (!url)
    return (
      <div className="media-loading">
        <FileImage size={24} />
        Loading {file.fileName}…
      </div>
    );
  return (
    <>
      <div className="media-item">
        {file.contentType.startsWith("image/") ? (
          <button
            onClick={() => setLightbox(true)}
            aria-label={"View " + file.fileName}
          >
            <img src={url} alt={file.fileName} loading="lazy" />
          </button>
        ) : (
          <video
            src={url}
            controls
            preload="metadata"
            aria-label={file.fileName}
          />
        )}
        <span>{file.fileName}</span>
      </div>
      {lightbox && (
        <Modal title={file.fileName} onClose={() => setLightbox(false)} wide>
          <img className="lightbox" src={url} alt={file.fileName} />
        </Modal>
      )}
    </>
  );
}
type DraftFile = {
  key: string;
  name: string;
  percent: number;
  result?: Attachment;
  controller: AbortController;
};
export function Chat({
  channelId,
  name,
  description,
  room,
  me,
  members,
  hub,
  connected,
  reconnect,
  canModerate,
  onRead,
  onError,
}: {
  channelId: string;
  name: string;
  description: string;
  room: boolean;
  me: User;
  members: User[];
  hub: HubConnection | null;
  connected: boolean;
  reconnect: number;
  canModerate: boolean;
  onRead: () => void;
  onError: (error: unknown) => void;
}) {
  const [announcement, setAnnouncement] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [browser, setBrowser] = useState<"search" | "pins" | null>(null);
  const [reply, setReply] = useState<Message | null>(null);
  const [reacting, setReacting] = useState<Message | null>(null);
  const [highlight, setHighlight] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const inContext = useRef(false);
  inContext.current = contextOpen;
  const visibleEnd = useRef(-1);
  const draftKey = `gather:draft:${me.id}:${channelId}`;
  const mutedUntil = room
    ? (members.find((member) => member.id === me.id)?.mutedUntil ?? 0)
    : 0;
  const muted = mutedUntil > Date.now();
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const emojiSelection = useRef({ start: 0, end: 0 });
  const [messages, setMessages] = useState<Message[]>([]),
    [text, setText] = useState(() => {
      try {
        return sessionStorage.getItem(draftKey) || "";
      } catch {
        return "";
      }
    }),
    [files, setFiles] = useState<DraftFile[]>([]),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(""),
    [hasMore, setHasMore] = useState(false),
    [typing, setTyping] = useState(""),
    [editing, setEditing] = useState<Message | null>(null),
    [editText, setEditText] = useState(""),
    [firstUnread, setFirstUnread] = useState<string | null>(null);
  const list = useRef<VirtuosoHandle>(null),
    picker = useRef<HTMLInputElement>(null),
    typingClock = useRef(0),
    typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    loadedMessages = useRef<Message[]>([]),
    draftFiles = useRef<DraftFile[]>([]),
    readMarker = useRef("");
  loadedMessages.current = messages;
  draftFiles.current = files;
  useEffect(() => {
    try {
      if (text) sessionStorage.setItem(draftKey, text);
      else sessionStorage.removeItem(draftKey);
    } catch {
      /* Storage may be disabled. */
    }
  }, [text, draftKey]);
  const mark = async (id: string) => {
    if (document.visibilityState !== "visible" || id <= readMarker.current)
      return;
    readMarker.current = id;
    try {
      await api(`/channels/${channelId}/read/${id}`, "POST");
      onRead();
    } catch {
      readMarker.current = "";
    }
  };
  useEffect(() => {
    let live = true;
    setLoading(true);
    setLoadError("");
    setMessages([]);
    readMarker.current = "";
    api<History>(`/channels/${channelId}/messages`)
      .then((data) => {
        if (!live) return;
        setMessages((previous) => combineMessages(previous, data.messages));
        setHasMore(data.hasMore);
        setFirstUnread(
          data.lastRead &&
            data.messages.some(
              (m) => m.senderId !== me.id && m.id > data.lastRead!,
            )
            ? data.lastRead
            : null,
        );
      })
      .catch((e) => {
        if (live) setLoadError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      for (const f of draftFiles.current) f.controller.abort();
      clearTimeout(typingTimer.current);
    };
  }, [channelId]);
  useEffect(() => {
    if (!hub) return;
    const receive = (message: Message) => {
      if (message.channelId !== channelId) return;
      if (inContext.current) return;
      setAnnouncement(
        message.sender.displayName +
          ": " +
          (message.deleted
            ? "Message deleted"
            : message.content || "Shared an attachment"),
      );
      setMessages((previous) => combineMessages(previous, [message]));
    };
    const update = (message: Message) => {
      if (message.channelId !== channelId) return;
      setMessages((previous) =>
        previous.map((m) => (m.id === message.id ? message : m)),
      );
    };
    const sourceUpdated = (source: {
      channelId: string;
      id: string;
      content: string;
      deleted: boolean;
    }) => {
      if (source.channelId !== channelId) return;
      setMessages((previous) =>
        previous.map((m) =>
          m.replyTo?.id === source.id
            ? {
                ...m,
                replyTo: {
                  ...m.replyTo,
                  content: source.deleted
                    ? "This message was deleted."
                    : source.content,
                  deleted: source.deleted,
                },
              }
            : m,
        ),
      );
      setReply((previous) =>
        previous?.id === source.id
          ? source.deleted
            ? null
            : { ...previous, content: source.content }
          : previous,
      );
    };
    const changedTyping = (event: { channelId: string; userId: string }) => {
      if (event.channelId !== channelId) return;
      setTyping(event.userId);
      clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTyping(""), 4500);
    };
    hub.on("MessageCreated", receive);
    hub.on("MessageUpdated", update);
    hub.on("ReplySourceUpdated", sourceUpdated);
    hub.on("TypingChanged", changedTyping);
    return () => {
      hub.off("MessageCreated", receive);
      hub.off("MessageUpdated", update);
      hub.off("ReplySourceUpdated", sourceUpdated);
      hub.off("TypingChanged", changedTyping);
    };
  }, [hub, channelId]);
  useEffect(() => {
    if (!connected || !hub) return;
    void hub.invoke("SubscribeChannel", channelId).catch(onError);
    let live = true;
    async function fillGap() {
      if (inContext.current) return;
      let cursor = loadedMessages.current.filter((m) => !m.status).at(-1)?.id;
      if (!cursor) return;
      for (;;) {
        const page: History = await api(
          `/channels/${channelId}/messages?after=${cursor}`,
        );
        if (!live || inContext.current) return;
        setMessages((previous) => combineMessages(previous, page.messages));
        if (!page.hasMore || !page.messages.length) break;
        cursor = page.messages.at(-1)!.id;
      }
    }
    void fillGap().catch(onError);
    return () => {
      live = false;
    };
  }, [connected, reconnect, channelId, hub]);
  useEffect(() => {
    const visible = () => {
      const visibleMessage = loadedMessages.current[visibleEnd.current];
      if (visibleMessage && !visibleMessage.status)
        void mark(visibleMessage.id);
    };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, [channelId]);
  async function send(retry?: Message) {
    if (muted) {
      onError(new Error("You are temporarily muted in this room."));
      return;
    }
    if (
      (!text.trim() && !files.length && !retry) ||
      files.some((f) => !f.result)
    )
      return;
    if (inContext.current) {
      try {
        await latest();
      } catch {
        return;
      }
    }
    const pending: Message = retry ?? {
      id: crypto.randomUUID(),
      clientMessageId: crypto.randomUUID(),
      channelId,
      senderId: me.id,
      sender: me,
      content: text.trim(),
      createdAt: Date.now(),
      deleted: false,
      attachments: files.map((f) => f.result!),
      replyTo: reply
        ? {
            id: reply.id,
            senderName: reply.sender.displayName,
            content: reply.content,
            deleted: false,
          }
        : null,
      status: "pending",
    };
    setMessages((previous) =>
      combineMessages(previous, [{ ...pending, status: "pending" }]),
    );
    if (!retry) {
      setText("");
      setReply(null);
      setFiles([]);
    }
    try {
      if (!connected || !hub)
        throw new Error("You’re offline. Reconnect, then retry your message.");
      const saved = await hub.invoke<Message>("SendMessage", {
        channelId,
        content: pending.content,
        clientMessageId: pending.clientMessageId,
        attachmentIds: pending.attachments.map((a) => a.id),
        replyToId: pending.replyTo?.id ?? null,
      });
      setMessages((previous) => combineMessages(previous, [saved]));
      list.current?.scrollToIndex({ index: "LAST", align: "end" });
    } catch (error) {
      setMessages((previous) =>
        combineMessages(previous, [{ ...pending, status: "failed" }]),
      );
      onError(error);
    }
  }
  async function addFiles(incoming: File[]) {
    if (files.length + incoming.length > 10) {
      onError(new Error("Attach up to 10 files per message."));
      return;
    }
    for (const file of incoming) {
      const controller = new AbortController();
      const key = crypto.randomUUID();
      setFiles((previous) => [
        ...previous,
        { key, name: file.name, percent: 0, controller },
      ]);
      try {
        const result = await upload(
          channelId,
          file,
          (percent) =>
            setFiles((previous) =>
              previous.map((f) => (f.key === key ? { ...f, percent } : f)),
            ),
          controller.signal,
        );
        setFiles((previous) =>
          previous.map((f) =>
            f.key === key ? { ...f, result, percent: 100 } : f,
          ),
        );
      } catch (error) {
        setFiles((previous) => previous.filter((f) => f.key !== key));
        if (!controller.signal.aborted) onError(error);
      }
    }
  }
  async function earlier() {
    try {
      const page = await api<History>(
        `/channels/${channelId}/messages?before=${messages[0].id}`,
      );
      setMessages((previous) => combineMessages(page.messages, previous));
      setHasMore(page.hasMore);
    } catch (error) {
      onError(error);
    }
  }
  async function jumpUnread() {
    if (!firstUnread) return;
    try {
      const page = await api<History>(
        `/channels/${channelId}/messages?after=${firstUnread}`,
      );
      setMessages((previous) => combineMessages(previous, page.messages));
      const id = page.messages[0]?.id;
      setTimeout(() => {
        const index = loadedMessages.current.findIndex((m) => m.id === id);
        if (index >= 0) list.current?.scrollToIndex({ index, align: "start" });
      }, 0);
      setFirstUnread(null);
    } catch (error) {
      onError(error);
    }
  }
  async function jumpTo(id: string) {
    try {
      const page = await api<{ messages: Message[] }>(
        `/channels/${channelId}/messages/${id}/context`,
      );
      inContext.current = true;
      setContextOpen(true);
      setMessages(page.messages);
      setHasMore(true);
      setBrowser(null);
      setHighlight(id);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const index = loadedMessages.current.findIndex((m) => m.id === id);
          if (index >= 0)
            list.current?.scrollToIndex({ index, align: "center" });
        }),
      );
    } catch (error) {
      onError(error);
    }
  }
  async function latest() {
    try {
      const page = await api<History>(`/channels/${channelId}/messages`);
      setMessages(page.messages);
      setHasMore(page.hasMore);
      setContextOpen(false);
      inContext.current = false;
      setHighlight("");
      requestAnimationFrame(() =>
        list.current?.scrollToIndex({ index: "LAST", align: "end" }),
      );
    } catch (error) {
      onError(error);
      throw error;
    }
  }
  async function react(message: Message, emoji: string) {
    const mine = message.reactions
      ?.find((r) => r.emoji === emoji)
      ?.users.some((u) => u.id === me.id);
    try {
      const updated = await api<Message>(
        `/messages/${message.id}/reactions${mine ? `?emoji=${encodeURIComponent(emoji)}` : ""}`,
        mine ? "DELETE" : "PUT",
        mine ? undefined : { emoji },
      );
      setMessages((previous) =>
        previous.map((m) => (m.id === updated.id ? updated : m)),
      );
      setReacting(null);
    } catch (error) {
      onError(error);
    }
  }
  async function pin(message: Message) {
    try {
      const updated = await api<Message>(
        `/messages/${message.id}/pin`,
        message.pinned ? "DELETE" : "PUT",
      );
      setMessages((previous) =>
        previous.map((m) => (m.id === updated.id ? updated : m)),
      );
    } catch (error) {
      onError(error);
    }
  }
  return (
    <section
      className="conversation"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="chat-welcome">
        <div className="welcome-symbol">
          {room ? <Hash size={30} /> : <MessageCircle size={29} />}
        </div>
        <div>
          <span className="eyebrow">
            {room
              ? "GOOD PEOPLE. GREAT CONVERSATIONS."
              : "JUST BETWEEN YOU TWO."}
          </span>
          <h2>
            {room ? "Welcome to " : "Say hello to "}
            <span>{name}</span>
          </h2>
          <p>
            {description || "This is the beginning of a good conversation."}
          </p>
        </div>
      </div>
      <div className="conversation-tools">
        <button onClick={() => setBrowser("search")}>
          <Search size={16} /> Search messages
        </button>
        <button onClick={() => setBrowser("pins")}>
          <Pin size={16} /> Pinned messages
        </button>
      </div>
      {contextOpen && (
        <button
          className="unread-banner"
          onClick={() => void latest().catch(() => {})}
        >
          <ArrowDown size={14} /> Viewing message context · Back to latest
        </button>
      )}
      {firstUnread && (
        <button className="unread-banner" onClick={jumpUnread}>
          <ArrowDown size={14} />
          Jump to first unread
        </button>
      )}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      <div className="timeline" aria-label="Conversation messages">
        {loading ? (
          <div className="skeletons">
            {[1, 2, 3, 4].map((i) => (
              <div className="skeleton" key={i} />
            ))}
          </div>
        ) : loadError ? (
          <Empty
            icon={<MessageCircle />}
            title="Couldn’t open this conversation"
          >
            <p>{loadError}</p>
          </Empty>
        ) : !messages.length ? (
          <Empty
            icon={<MessageCircle size={30} />}
            title="It starts with a hello."
          >
            <p>
              Share an idea, ask a question, or just say hi.
              <br />
              This space is yours.
            </p>
          </Empty>
        ) : (
          <Virtuoso
            ref={list}
            style={{ height: "100%" }}
            data={messages}
            followOutput="smooth"
            rangeChanged={({ endIndex }) => {
              visibleEnd.current = endIndex;
              const visibleMessage = loadedMessages.current[endIndex];
              if (visibleMessage && !visibleMessage.status)
                void mark(visibleMessage.id);
            }}
            initialTopMostItemIndex={messages.length - 1}
            components={{
              Header: () =>
                hasMore ? (
                  <button className="earlier text-button" onClick={earlier}>
                    Load earlier messages
                  </button>
                ) : null,
            }}
            itemContent={(index, message) => {
              const previous = messages[index - 1];
              const date = new Date(message.createdAt).toLocaleDateString();
              const divider =
                !previous ||
                new Date(previous.createdAt).toLocaleDateString() !== date;
              return (
                <>
                  <div className={divider ? "date-divider" : "hidden"}>
                    <span>
                      {new Date(message.createdAt).toLocaleDateString(
                        undefined,
                        { weekday: "long", month: "long", day: "numeric" },
                      )}
                    </span>
                  </div>
                  <article
                    className={`message${highlight === message.id ? " message-highlight" : ""}`}
                  >
                    <Avatar user={message.sender} />
                    <div className="message-body">
                      <div className="message-meta">
                        {message.pinned && (
                          <Pin size={13} aria-label="Pinned" />
                        )}
                        <strong>{message.sender.displayName}</strong>
                        {message.senderId === me.id && (
                          <span className="you-label">you</span>
                        )}
                        <time>
                          {new Date(message.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      </div>
                      {message.replyTo && !message.deleted && (
                        <button
                          className="reply-preview"
                          onClick={() => void jumpTo(message.replyTo!.id)}
                        >
                          <Reply size={14} />
                          <strong>{message.replyTo.senderName}</strong>
                          <span>{message.replyTo.content || "Attachment"}</span>
                        </button>
                      )}
                      <p className={message.deleted ? "deleted" : ""}>
                        {message.deleted
                          ? "This message was deleted."
                          : message.content}
                        {message.editedAt && <small> (edited)</small>}
                      </p>
                      {!message.deleted &&
                        message.attachments.map((file) => (
                          <Media file={file} key={file.id} />
                        ))}
                      {message.status === "pending" && (
                        <small className="pending">Sending…</small>
                      )}
                      {!message.deleted && !!message.reactions?.length && (
                        <div className="reaction-list">
                          {message.reactions.map((reaction) => (
                            <button
                              key={reaction.emoji}
                              aria-pressed={reaction.users.some(
                                (u) => u.id === me.id,
                              )}
                              title={reaction.users
                                .map((u) => u.displayName)
                                .join(", ")}
                              aria-label={`${reaction.emoji}, ${reaction.count} reactions`}
                              onClick={() =>
                                void react(message, reaction.emoji)
                              }
                            >
                              {reaction.emoji} <span>{reaction.count}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {message.status === "failed" && (
                        <button className="retry" onClick={() => send(message)}>
                          Not sent · Retry
                        </button>
                      )}
                    </div>
                    {!message.deleted && !message.status && (
                      <div className="message-actions">
                        <button
                          aria-label="Reply to message"
                          onClick={() => {
                            setReply(message);
                            composerInput.current?.focus();
                          }}
                        >
                          <Reply size={15} />
                        </button>
                        <button
                          aria-label="React to message"
                          onClick={() => setReacting(message)}
                        >
                          <Smile size={15} />
                        </button>
                        {(!room || canModerate) && (
                          <button
                            aria-label={
                              message.pinned ? "Unpin message" : "Pin message"
                            }
                            onClick={() => void pin(message)}
                          >
                            <Pin size={15} />
                          </button>
                        )}
                        {message.senderId === me.id && (
                          <button
                            aria-label="Edit message"
                            onClick={() => {
                              setEditing(message);
                              setEditText(message.content);
                            }}
                          >
                            <Edit3 size={15} />
                          </button>
                        )}
                        {(message.senderId === me.id || canModerate) && (
                          <button
                            aria-label="Delete message"
                            onClick={async () => {
                              if (confirm("Delete this message?"))
                                try {
                                  await hub?.invoke(
                                    "DeleteMessage",
                                    message.id,
                                  );
                                } catch (error) {
                                  onError(error);
                                }
                            }}
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                </>
              );
            }}
          />
        )}
      </div>
      <div className="composer-area">
        {muted && (
          <p className="mute-notice" role="status">
            You’re muted until {new Date(mutedUntil).toLocaleString()}. You can
            still read and save a draft.
          </p>
        )}
        {reply && (
          <div className="reply-composer">
            <Reply size={17} />
            <span>
              Replying to <strong>{reply.sender.displayName}</strong>
              <small>{reply.content || "Attachment"}</small>
            </span>
            <button aria-label="Cancel reply" onClick={() => setReply(null)}>
              <X size={16} />
            </button>
          </div>
        )}
        <div className="typing" role="status">
          {typing
            ? `${members.find((m) => m.id === typing)?.displayName || "Someone"} is typing…`
            : ""}
        </div>
        {files.length > 0 && (
          <div className="upload-tray">
            {files.map((f) => (
              <div className="upload-chip" key={f.key}>
                <ImagePlus size={16} />
                <span>
                  {f.name}
                  <small>
                    {f.result
                      ? "Ready to send"
                      : f.percent === 100
                        ? "Processing…"
                        : `${f.percent}% uploaded`}
                  </small>
                </span>
                <button
                  aria-label={"Remove " + f.name}
                  onClick={() => {
                    f.controller.abort();
                    setFiles((previous) =>
                      previous.filter((x) => x.key !== f.key),
                    );
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={composerInput}
            aria-label="Message"
            placeholder={"Message " + name + "…"}
            value={text}
            maxLength={4000}
            onChange={(e) => {
              setText(e.target.value);
              if (connected && Date.now() - typingClock.current > 1800) {
                typingClock.current = Date.now();
                void hub?.invoke("StartTyping", channelId).catch(() => {});
              }
            }}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send();
              }
            }}
            onPaste={(e) => {
              if (e.clipboardData.files.length) {
                e.preventDefault();
                void addFiles(Array.from(e.clipboardData.files));
              }
            }}
          />
          <div className="composer-bottom">
            <div>
              <button
                type="button"
                aria-label="Attach images or videos"
                onClick={() => picker.current?.click()}
              >
                <Paperclip size={19} />
              </button>
              <button
                type="button"
                aria-label="Choose emoji"
                aria-haspopup="dialog"
                aria-expanded={emojiOpen}
                onClick={() => {
                  emojiSelection.current = {
                    start: composerInput.current?.selectionStart ?? text.length,
                    end: composerInput.current?.selectionEnd ?? text.length,
                  };
                  setEmojiOpen(true);
                }}
              >
                <Smile size={20} />
              </button>
              <span className="composer-divider" />
              <span className="kindness">
                A little kindness goes a long way.
              </span>
            </div>
            <button
              className="send-button"
              aria-label="Send message"
              disabled={
                muted ||
                (!text.trim() && !files.length) ||
                files.some((f) => !f.result)
              }
            >
              <Send size={18} />
            </button>
          </div>
        </form>
        <input
          className="hidden"
          ref={picker}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime"
          onChange={(e) => {
            void addFiles(Array.from(e.target.files || []));
            e.target.value = "";
          }}
        />
        <div className="composer-help">
          <span>
            <strong>Enter</strong> to send · <strong>Shift + Enter</strong> for
            a new line
          </span>
          <span>
            {text.length ? text.length + "/4000" : "Made for connection ♡"}
          </span>
        </div>
      </div>
      {browser && (
        <MessageBrowser
          channelId={channelId}
          mode={browser}
          onClose={() => setBrowser(null)}
          onJump={(id) => void jumpTo(id)}
        />
      )}
      {reacting && (
        <EmojiPicker
          onClose={() => setReacting(null)}
          onSelect={(emoji) => void react(reacting, emoji)}
        />
      )}
      {emojiOpen && (
        <EmojiPicker
          onClose={() => setEmojiOpen(false)}
          onSelect={(emoji) => {
            const { start, end } = emojiSelection.current;
            const next = text.slice(0, start) + emoji + text.slice(end);
            if (next.length > 4000) {
              onError(
                new Error("Messages can contain up to 4,000 characters."),
              );
              return;
            }
            setText(next);
            setEmojiOpen(false);
            requestAnimationFrame(() => {
              composerInput.current?.focus();
              composerInput.current?.setSelectionRange(
                start + emoji.length,
                start + emoji.length,
              );
            });
          }}
        />
      )}
      {editing && (
        <Modal title="Edit message" onClose={() => setEditing(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await hub?.invoke("EditMessage", editing.id, editText);
                setEditing(null);
              } catch (error) {
                onError(error);
              }
            }}
          >
            <label>
              Message
              <textarea
                autoFocus
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                required
                maxLength={4000}
              />
            </label>
            <button className="primary full">Save changes</button>
          </form>
        </Modal>
      )}
    </section>
  );
}

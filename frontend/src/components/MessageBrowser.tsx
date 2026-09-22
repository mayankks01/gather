import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Message } from "../lib/types";
import { Modal } from "./Common";

export function MessageBrowser({
  channelId,
  mode,
  onClose,
  onJump,
}: {
  channelId: string;
  mode: "search" | "pins";
  onClose: () => void;
  onJump: (id: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [sender, setSender] = useState(""),
    [from, setFrom] = useState(""),
    [until, setUntil] = useState(""),
    [media, setMedia] = useState(false),
    [messages, setMessages] = useState<Message[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [searched, setSearched] = useState(false),
    [more, setMore] = useState(false);
  const submitted = useRef("");
  async function search(older = false) {
    setBusy(true);
    setError("");
    try {
      if (!older) {
        const params = new URLSearchParams({ q: query, sender });
        if (from)
          params.set("from", String(new Date(from + "T00:00:00").getTime()));
        if (until) {
          const end = new Date(until + "T00:00:00");
          end.setDate(end.getDate() + 1);
          params.set("until", String(end.getTime()));
        }
        if (media) params.set("hasMedia", "true");
        submitted.current = params.toString();
      }
      const params = new URLSearchParams(submitted.current);
      if (older) params.set("before", messages.at(-1)!.id);
      const result =
        mode === "pins"
          ? {
              messages: await api<Message[]>(`/channels/${channelId}/pins`),
              hasMore: false,
            }
          : await api<{ messages: Message[]; hasMore: boolean }>(
              `/channels/${channelId}/messages/search?${params}`,
            );
      setMessages((previous) =>
        older ? [...previous, ...result.messages] : result.messages,
      );
      setMore(result.hasMore);
      setSearched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load messages.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (mode === "pins") void search();
  }, []);
  return (
    <Modal
      title={mode === "pins" ? "Pinned messages" : "Search this conversation"}
      onClose={onClose}
      wide
    >
      {mode === "search" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <label>
            Search messages
            <input
              autoFocus
              value={query}
              maxLength={200}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a word or phrase…"
            />
          </label>
          <div className="message-search-filters">
            <label>
              From username
              <input
                value={sender}
                onChange={(e) => setSender(e.target.value)}
                placeholder="@username"
              />
            </label>
            <label>
              Since
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              Through
              <input
                type="date"
                value={until}
                min={from}
                onChange={(e) => setUntil(e.target.value)}
              />
            </label>
          </div>
          <label className="media-filter">
            <input
              type="checkbox"
              checked={media}
              onChange={(e) => setMedia(e.target.checked)}
            />{" "}
            With attachments
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Searching…" : "Search"}
          </button>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="message-results" aria-live="polite">
        {busy && !messages.length && <p className="muted">Loading…</p>}
        {searched && !messages.length && (
          <p className="muted">
            {mode === "pins"
              ? "No pinned messages yet."
              : "No matching messages. Try different filters."}
          </p>
        )}
        {messages.map((message) => (
          <button
            className="message-result"
            key={message.id}
            onClick={() => onJump(message.id)}
          >
            <strong>{message.sender.displayName}</strong>
            <time>{new Date(message.createdAt).toLocaleString()}</time>
            <span>{message.content || "Shared an attachment"}</span>
            {!!message.attachments.length && (
              <small>{message.attachments.length} attachment(s)</small>
            )}
          </button>
        ))}
      </div>
      {more && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void search(true)}
        >
          Load more results
        </button>
      )}
    </Modal>
  );
}

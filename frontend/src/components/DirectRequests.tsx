import { useState } from "react";
import { api } from "../lib/api";
import type { DirectRequest } from "../lib/types";
import { Avatar } from "./Common";

export function DirectRequests({
  requests,
  tab,
  setTab,
  onChanged,
  onOpen,
  onError,
}: {
  requests: DirectRequest[];
  tab: "incoming" | "sent";
  setTab: (tab: "incoming" | "sent") => void;
  onChanged: () => Promise<void>;
  onOpen: (channel: string) => void;
  onError: (error: unknown) => void;
}) {
  const [busy, setBusy] = useState("");
  const incoming = requests.filter((r) => r.incoming),
    sent = requests.filter((r) => !r.incoming);
  async function action(
    request: DirectRequest,
    action: "accept" | "decline" | "cancel" | "block",
  ) {
    setBusy(request.requestId);
    try {
      if (action === "block") await api(`/blocks/${request.user.id}`, "POST");
      else await api(`/dm/requests/${request.requestId}/${action}`, "POST");
      await onChanged();
      if (action === "accept") onOpen(request.channelId);
    } catch (error) {
      onError(error);
      await onChanged().catch(() => {});
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="dm-requests" aria-label="Message requests">
      <h3>Message requests</h3>
      <p className="muted">
        Accept a request to start chatting. Messages and attachments stay locked
        until then.
      </p>
      <div className="tabs" role="group" aria-label="Request list">
        <button
          aria-pressed={tab === "incoming"}
          className={tab === "incoming" ? "active" : ""}
          onClick={() => setTab("incoming")}
        >
          Incoming ({incoming.length})
        </button>
        <button
          aria-pressed={tab === "sent"}
          className={tab === "sent" ? "active" : ""}
          onClick={() => setTab("sent")}
        >
          Sent ({sent.length})
        </button>
      </div>
      {(tab === "incoming" ? incoming : sent).length === 0 && (
        <p className="request-empty">
          {tab === "incoming"
            ? "No incoming requests."
            : "No sent requests waiting for a reply."}
        </p>
      )}
      {(tab === "incoming" ? incoming : sent).map((request) => (
        <div className="request-card" key={request.requestId}>
          <Avatar user={request.user} />
          <div className="request-person">
            <strong>{request.user.displayName}</strong>
            <small>@{request.user.username}</small>
            <span>
              {request.incoming
                ? "Wants to chat with you"
                : "Waiting for approval"}
            </span>
          </div>
          <div className="request-actions">
            {request.incoming ? (
              <>
                <button
                  className="primary"
                  disabled={!!busy}
                  onClick={() => void action(request, "accept")}
                >
                  Accept
                </button>
                <button
                  className="secondary"
                  disabled={!!busy}
                  onClick={() => void action(request, "decline")}
                >
                  Decline
                </button>
                <button
                  className="text-button"
                  disabled={!!busy}
                  onClick={() => void action(request, "block")}
                >
                  Block
                </button>
              </>
            ) : (
              <button
                className="secondary"
                disabled={!!busy}
                onClick={() => void action(request, "cancel")}
              >
                Cancel request
              </button>
            )}
            {busy === request.requestId && <span role="status">Updating…</span>}
          </div>
        </div>
      ))}
    </section>
  );
}

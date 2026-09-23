import { ArrowUpRight, Hash, LockKeyhole } from "lucide-react";
import type { Room } from "../lib/types";
import { Picture } from "./Pictures";

export function DiscoverRooms({
  rooms,
  discovery,
  query,
  loading,
  onOpen,
  onJoin,
}: {
  rooms: Room[];
  discovery: Room[];
  query: string;
  loading: boolean;
  onOpen: (channel: string) => void;
  onJoin: (room: Room) => void;
}) {
  const term = query.trim().toLowerCase();
  const joined = rooms.filter((room) => room.name.toLowerCase().includes(term));
  const joinedIds = new Set(rooms.map((room) => room.id));
  const available = discovery.filter((room) => !joinedIds.has(room.id));
  const card = (room: Room, isJoined: boolean) => (
    <article className="room-card" key={room.id}>
      <div
        className="room-card-banner"
        style={{ "--room-color": room.color } as React.CSSProperties}
      >
        <Picture
          className="discovery-icon"
          path={`/rooms/${room.id}/icon`}
          fallback={
            room.isPrivate ? <LockKeyhole size={44} /> : <Hash size={44} />
          }
        />
        <span>
          {room.memberCount} {room.memberCount === 1 ? "member" : "members"}
        </span>
      </div>
      <div className="room-card-body">
        <span className="eyebrow">
          {room.isPrivate ? "PRIVATE ROOM" : "PUBLIC ROOM"}
          {isJoined ? " · JOINED" : ""}
        </span>
        <h3>{room.name}</h3>
        <p>{room.description || "A little space for good conversations."}</p>
        <button
          onClick={() => (isJoined ? onOpen(room.channelId) : onJoin(room))}
        >
          {isJoined ? "Open room" : "Join the conversation"}
          {isJoined && room.unread > 0 && (
            <span
              className="badge"
              aria-label={`${room.unread} unread messages`}
            >
              {Math.min(room.unread, 99)}
            </span>
          )}
          <ArrowUpRight size={18} />
        </button>
      </div>
    </article>
  );
  return (
    <>
      <section
        className="discover-room-section"
        aria-labelledby="joined-rooms-title"
      >
        <h3 id="joined-rooms-title">
          Your joined rooms <span className="muted">({joined.length})</span>
        </h3>
        {joined.length ? (
          <div className="card-grid">
            {joined.map((room) => card(room, true))}
          </div>
        ) : (
          <p className="muted">
            {term
              ? "None of your joined rooms match this search."
              : "Rooms you create or join will appear here, including private rooms."}
          </p>
        )}
      </section>
      <section
        className="discover-room-section"
        aria-labelledby="more-rooms-title"
      >
        <h3 id="more-rooms-title">Discover more rooms</h3>
        {loading ? (
          <div className="card-grid">
            {[1, 2, 3].map((i) => (
              <div className="room-card skeleton-card" key={i} />
            ))}
          </div>
        ) : available.length ? (
          <div className="card-grid">
            {available.map((room) => card(room, false))}
          </div>
        ) : (
          <p className="muted">
            {term
              ? "No other public rooms match this search."
              : "You’re all caught up. Create a room or join a private one with an invite."}
          </p>
        )}
      </section>
    </>
  );
}

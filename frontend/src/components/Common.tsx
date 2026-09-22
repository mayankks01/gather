import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import type { User } from "../lib/types";
import { Picture } from "./Pictures";
export function Avatar({
  user,
  size = "",
  online = false,
}: {
  user: Pick<User, "displayName"> & Partial<Pick<User, "id">>;
  size?: string;
  online?: boolean;
}) {
  const colors = ["#ebe2f4", "#dcece5", "#f5e4db", "#dde5f5", "#f4e8ca"];
  return (
    <span
      className={"avatar " + size}
      style={{
        background:
          colors[(user.displayName.charCodeAt(0) || 0) % colors.length],
      }}
    >
      <Picture
        path={user.id ? `/users/${user.id}/avatar` : undefined}
        fallback={user.displayName
          .split(" ")
          .map((x) => x[0])
          .slice(0, 2)
          .join("")
          .toUpperCase()}
      />
      {online && <i className="online-dot" />}
    </span>
  );
}
export function Brand() {
  return (
    <span className="brand-mark" aria-label="Gather">
      g<span>•</span>
    </span>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={"modal " + (wide ? "wide" : "")}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-content">
        <button
          className="icon-button modal-close"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <h2>{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
export function Empty({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      <div className="muted">{children}</div>
    </div>
  );
}

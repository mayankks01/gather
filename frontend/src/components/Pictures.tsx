import { useEffect, useRef, useState, type ReactNode } from "react";
import { getPicture, savePicture } from "../lib/pictures";

export function Picture({
  path,
  fallback,
  className = "",
}: {
  path?: string;
  fallback: ReactNode;
  className?: string;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false),
    [url, setUrl] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "150px" },
    );
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const refresh = (event: Event) => {
      const changed = (event as CustomEvent<string | undefined>).detail;
      if (!changed || changed === path) setRevision((previous) => previous + 1);
    };
    window.addEventListener("gather:picture", refresh);
    return () => window.removeEventListener("gather:picture", refresh);
  }, [path]);
  useEffect(() => {
    let live = true,
      local = "";
    setUrl("");
    if (visible && path)
      void getPicture(path)
        .then((blob) => {
          if (!live || !blob) return;
          local = URL.createObjectURL(blob);
          setUrl(local);
        })
        .catch(() => {});
    return () => {
      live = false;
      if (local) URL.revokeObjectURL(local);
    };
  }, [path, visible, revision]);
  return (
    <span ref={root} className={`identity-picture ${className}`}>
      {url ? <img src={url} alt="" /> : fallback}
    </span>
  );
}

export function PictureEditor({
  kind,
  id,
  label,
  onError,
}: {
  kind: "avatar" | "icon";
  id: string;
  label: string;
  onError: (error: unknown) => void;
}) {
  const readPath =
    kind === "avatar" ? `/users/${id}/avatar` : `/rooms/${id}/icon`;
  const writePath = kind === "avatar" ? "/users/me/avatar" : readPath;
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(""),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function save(remove = false) {
    if (!remove && !file) return;
    setBusy(true);
    setStatus("");
    try {
      await savePicture(writePath, readPath, remove ? undefined : file!);
      setFile(null);
      setStatus(remove ? "Picture removed." : "Picture saved.");
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="picture-editor">
      <div className="picture-editor-preview">
        {preview ? (
          <img src={preview} alt="Selected picture preview" />
        ) : (
          <Picture path={readPath} fallback={label.slice(0, 2).toUpperCase()} />
        )}
      </div>
      <div className="picture-editor-controls">
        <strong>{kind === "avatar" ? "Profile picture" : "Room icon"}</strong>
        <small>JPEG, PNG or WebP · up to 5 MB · cropped to a square</small>
        <div className="picture-editor-buttons">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {file ? "Choose another" : "Choose image"}
          </button>
          {file ? (
            <>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void save()}
              >
                {busy ? "Saving…" : "Save picture"}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => setFile(null)}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => void save(true)}
            >
              {busy ? "Removing…" : "Remove picture"}
            </button>
          )}
        </div>
        <span role="status" className="picture-status">
          {status}
        </span>
      </div>
      <input
        ref={input}
        type="file"
        className="hidden"
        accept="image/jpeg,image/png,image/webp"
        aria-label={
          kind === "avatar" ? "Choose profile picture" : "Choose room icon"
        }
        onChange={(event) => {
          const next = event.target.files?.[0];
          event.target.value = "";
          if (!next) return;
          if (
            !/\.(jpe?g|png|webp)$/i.test(next.name) ||
            next.size > 5 * 1024 * 1024 ||
            next.size === 0
          ) {
            onError(new Error("Choose a JPEG, PNG or WebP image up to 5 MB."));
            return;
          }
          setFile(next);
          setStatus("");
        }}
      />
    </div>
  );
}

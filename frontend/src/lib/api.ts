import type { User, Attachment } from "./types";
import { backendOrigin } from "./backend";
let accessToken = "";
let refreshPromise: Promise<{ accessToken: string; user: User } | null> | null =
  null;
export function setToken(token: string) {
  accessToken = token;
}
export function token() {
  return accessToken;
}
export async function restoreSession() {
  if (!refreshPromise)
    refreshPromise = fetch("/api/v1/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-Gather-Client": "web" },
    })
      .then(async (r) => {
        if (!r.ok) {
          accessToken = "";
          return null;
        }
        const session = await r.json();
        accessToken = session.accessToken;
        return session;
      })
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  return refreshPromise;
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  retry = true,
): Promise<T> {
  const response = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Gather-Client": "web",
      ...(accessToken ? { Authorization: "Bearer " + accessToken } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401 && retry && !path.startsWith("/auth/")) {
    if (await restoreSession()) return api(path, method, body, false);
    window.dispatchEvent(new Event("gather:signout"));
  }
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    throw new Error(
      problem.detail ||
        (response.status === 429
          ? "Too many requests. Please wait a moment."
          : [502, 503, 504].includes(response.status)
            ? "The server may be waking up or temporarily unavailable. Wait about a minute and try again."
            : "The request could not be completed."),
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export function upload(
  channel: string,
  file: File,
  progress: (percent: number) => void,
  signal: AbortSignal,
): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", backendOrigin + "/api/v1/media/" + channel);
    xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        progress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let body;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body.detail || "Upload failed. Try again."));
    };
    xhr.onerror = () =>
      reject(new Error("Upload interrupted. Check your connection."));
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}
export async function mediaBlob(id: string) {
  let r = await fetch(backendOrigin + "/api/v1/media/" + id + "/content", {
    headers: { Authorization: "Bearer " + accessToken },
  });
  if (r.status === 401 && (await restoreSession()))
    r = await fetch(backendOrigin + "/api/v1/media/" + id + "/content", {
      headers: { Authorization: "Bearer " + accessToken },
    });
  if (!r.ok) throw new Error("Media is unavailable.");
  return URL.createObjectURL(await r.blob());
}

import { restoreSession, token } from "./api";

const pictures = new Map<string, { at: number; blob: Promise<Blob | null> }>();
export function refreshPicture(path?: string) {
  if (path) pictures.delete(path);
  else pictures.clear();
  window.dispatchEvent(new CustomEvent("gather:picture", { detail: path }));
}
export function getPicture(path: string) {
  const cached = pictures.get(path);
  if (cached && Date.now() - cached.at < 60000) return cached.blob;
  const blob = pictureRequest(path).then(async (response) =>
    response.status === 204 ? null : response.blob(),
  );
  if (pictures.size >= 200) pictures.delete(pictures.keys().next().value!);
  pictures.set(path, { at: Date.now(), blob });
  void blob.catch(() => {
    if (pictures.get(path)?.blob === blob) pictures.delete(path);
  });
  return blob;
}
async function pictureRequest(path: string, method = "GET", file?: File) {
  const form = file ? new FormData() : undefined;
  if (file) form!.append("file", file);
  const request = () =>
    fetch("/api/v1" + path, {
      method,
      headers: { Authorization: "Bearer " + token() },
      body: form,
    });
  let response = await request();
  if (response.status === 401 && (await restoreSession()))
    response = await request();
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    throw new Error(
      problem.detail ||
        (response.status === 429
          ? "Too many uploads. Please wait a moment."
          : "This picture is unavailable."),
    );
  }
  return response;
}
export async function savePicture(
  writePath: string,
  readPath: string,
  file?: File,
) {
  await pictureRequest(writePath, file ? "PUT" : "DELETE", file);
  refreshPicture(readPath);
}

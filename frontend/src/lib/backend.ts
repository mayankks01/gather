// Auth stays on the frontend origin so refresh cookies work without third-party cookies.
// Chat and file transfers connect directly to the long-running API host.
export const backendOrigin = (
  import.meta.env.VITE_BACKEND_ORIGIN || ""
).replace(/\/$/, "");

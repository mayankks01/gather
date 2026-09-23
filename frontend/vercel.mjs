import { routes, deploymentEnv } from "@vercel/config/v1";

const raw = process.env.VITE_BACKEND_ORIGIN;
if (!raw)
  throw new Error(
    "Set VITE_BACKEND_ORIGIN to your Docker API's public HTTPS origin.",
  );
const origin = new URL(raw);
if (
  origin.protocol !== "https:" ||
  origin.username ||
  origin.password ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash ||
  origin.hostname === "localhost"
) {
  throw new Error(
    "VITE_BACKEND_ORIGIN must be an HTTPS origin with no path, query or credentials.",
  );
}
if (
  !process.env.GATHER_PROXY_SECRET ||
  process.env.GATHER_PROXY_SECRET.length < 32
) {
  throw new Error(
    "Set GATHER_PROXY_SECRET to the same random secret as Proxy__VercelSecret on the API (32+ characters).",
  );
}
const backend = origin.origin;
const socket = backend.replace("https:", "wss:");

export const config = {
  framework: "vite",
  buildCommand: "npm run build",
  outputDirectory: "dist",
  rewrites: [
    routes.rewrite("/api/(.*)", `${backend}/api/$1`, {
      requestHeaders: {
        "x-gather-proxy-secret": deploymentEnv("GATHER_PROXY_SECRET"),
      },
    }),
    routes.rewrite("/(.*)", "/index.html"),
  ],
  headers: [
    routes.header("/(.*)", [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=()",
        },
        {
          key: "Content-Security-Policy",
          value: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ${backend} ${socket}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`,
        },
      ]),
    routes.header("/api/(.*)", [
      { key: "Cache-Control", value: "private, no-store" },
    ]),
  ],
};

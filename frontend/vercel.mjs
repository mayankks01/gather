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
const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ${backend} ${socket}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`,
};

const apiRoute = routes.rewrite("/api/(.*)", `${backend}/api/$1`, {
  requestHeaders: {
    "x-gather-proxy-secret": deploymentEnv("GATHER_PROXY_SECRET"),
  },
  responseHeaders: {
    ...securityHeaders,
    "Cache-Control": "private, no-store",
  },
});

const spaRoute = routes.rewrite("/(.*)", "/index.html", {
  responseHeaders: securityHeaders,
});

export const config = {
  framework: "vite",
  buildCommand: "npm run build",
  outputDirectory: "dist",
  routes: [apiRoute, spaRoute],
};

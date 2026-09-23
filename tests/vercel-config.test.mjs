import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const { validateStaticFields } = require("@vercel/config/v1");
const load = () => import(`../frontend/vercel.mjs?test=${crypto.randomUUID()}`);
test("Vercel configuration fails without a public backend and server-only secret", async () => {
  delete process.env.VITE_BACKEND_ORIGIN;
  await assert.rejects(load(), /VITE_BACKEND_ORIGIN/);
  for (const url of [
    "http://localhost:5080",
    "https://api.example.test/api",
    "https://user:pass@api.example.test",
  ]) {
    process.env.VITE_BACKEND_ORIGIN = url;
    await assert.rejects(load(), /HTTPS origin/);
  }
  process.env.VITE_BACKEND_ORIGIN = "https://api.example.test";
  delete process.env.GATHER_PROXY_SECRET;
  await assert.rejects(load(), /GATHER_PROXY_SECRET/);
});
test("Vercel proxy targets the API and references the secret without embedding its value", async () => {
  process.env.VITE_BACKEND_ORIGIN = "https://api.example.test";
  process.env.GATHER_PROXY_SECRET = "test-only-secret-at-least-32-characters";
  const { config } = await load();
  validateStaticFields(config);
  const [api, filesystem, spa] = config.routes;
  assert.equal(api.dest, "https://api.example.test/api/$1");
  assert.equal(
    "/api/v1/auth/refresh".replace(new RegExp(api.src), api.dest),
    "https://api.example.test/api/v1/auth/refresh",
  );
  const proxyTransform = api.transforms.find(
    (transform) => transform.target?.key === "x-gather-proxy-secret",
  );
  assert.equal(proxyTransform.target.key, "x-gather-proxy-secret");
  assert.deepEqual(proxyTransform.env, ["GATHER_PROXY_SECRET"]);
  assert.ok(!JSON.stringify(config).includes(process.env.GATHER_PROXY_SECRET));
  assert.deepEqual(filesystem, { handle: "filesystem" });
  assert.equal(spa.dest, "/index.html");
  const csp = api.transforms.find(
    (transform) => transform.target?.key === "Content-Security-Policy",
  ).args;
  assert.match(
    csp,
    /connect-src 'self' https:\/\/api.example.test wss:\/\/api.example.test/,
  );
});

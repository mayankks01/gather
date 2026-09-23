import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { once } from "node:events";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile,
  utimes,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import net from "node:net";
import http from "node:http";
const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const { HubConnectionBuilder, LogLevel } = require("@microsoft/signalr");
const assembly = resolve(
  process.env.GATHER_TEST_ASSEMBLY || "artifacts/deploy-build/Gather.Api.dll",
);
const secret = "deployment-tests-proxy-secret-32-characters";
const publicUrl = "https://gather.example.test";
const password = "Deployment-tests.long123!";
const children = [],
  hubs = [];
let server, owner, member, room, attached, pending;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  await exited;
}
async function start(extra = {}, directory) {
  await mkdir("artifacts", { recursive: true });
  directory ||= await mkdtemp(resolve("artifacts/deployment-test-"));
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((r) => listener.close(r));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn("dotnet", [assembly], {
    cwd: directory,
    windowsHide: true,
    env: {
      ...process.env,
      ASPNETCORE_ENVIRONMENT: "Development",
      ASPNETCORE_URLS: base,
      Jwt__Key: "deployment-tests-signing-key-at-least-32-chars",
      App__PublicUrl: publicUrl,
      Proxy__VercelSecret: secret,
      Storage__UserQuotaBytes: "3072",
      Storage__TotalQuotaBytes: "4096",
      Storage__MinimumFreeBytes: "1",
      Storage__UnattachedHours: "1",
      ...extra,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let logs = "";
  child.stdout.on("data", (x) => (logs += x));
  child.stderr.on("data", (x) => (logs += x));
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`API exited: ${logs}`);
    if (
      await fetch(base + "/api/v1/health")
        .then((r) => r.ok)
        .catch(() => false)
    )
      return { child, base, directory };
    await sleep(100);
  }
  throw new Error(`API startup timeout: ${logs}`);
}
async function request(
  path,
  {
    user,
    method = "GET",
    body,
    headers = {},
    signed = true,
    target = server,
  } = {},
) {
  const response = await fetch(target.base + "/api/v1" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Gather-Client": "web",
      ...(signed
        ? {
            "X-Gather-Proxy-Secret": secret,
            "X-Vercel-Forwarded-For": "198.51.100.10",
          }
        : {}),
      ...(user ? { Authorization: "Bearer " + user.accessToken } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    response,
    status: response.status,
    body: await response.json().catch(() => null),
  };
}
async function register(name) {
  const r = await request("/auth/register", {
    method: "POST",
    body: {
      username: name,
      displayName: name,
      email: name + "@example.test",
      password,
      ageConfirmed: true,
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
async function connect(user) {
  const hub = new HubConnectionBuilder()
    .withUrl(server.base + "/hubs/chat", {
      accessTokenFactory: () => user.accessToken,
      withCredentials: false,
    })
    .configureLogging(LogLevel.None)
    .build();
  hubs.push(hub);
  await hub.start();
  return hub;
}
async function upload(user, bytes = 1024, filename = "test.mp4") {
  const content = Buffer.alloc(bytes);
  content.write("ftypisom", 4);
  const form = new FormData();
  form.append("file", new Blob([content]), filename);
  const response = await fetch(
    server.base + "/api/v1/media/" + room.channelId,
    {
      method: "POST",
      headers: { Authorization: "Bearer " + user.accessToken },
      body: form,
    },
  );
  return { status: response.status, body: await response.json() };
}
before(async () => {
  server = await start();
  owner = await register("deployowner");
  member = await register("deploymember");
  const r = await request("/rooms", {
    user: owner,
    method: "POST",
    body: {
      name: "Deployment tests",
      description: "isolated",
      color: "#6554c0",
      isPrivate: false,
    },
  });
  assert.equal(r.status, 200);
  room = r.body;
  assert.equal(
    (await request(`/rooms/${room.id}/join`, { user: member, method: "POST" }))
      .status,
    200,
  );
});
after(async () => {
  await Promise.all(hubs.map((h) => h.stop()));
  await Promise.all(children.map(stop));
});

test("auth rewrite requires secret and a valid Vercel client address", async () => {
  assert.equal(
    (
      await request("/auth/refresh", {
        method: "POST",
        signed: false,
        headers: { "X-Vercel-Forwarded-For": "198.51.100.11" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/auth/refresh", {
        method: "POST",
        headers: { "X-Gather-Proxy-Secret": "forged" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/auth/refresh", {
        method: "POST",
        headers: { "X-Vercel-Forwarded-For": "fake" },
      })
    ).status,
    400,
  );
});
test("proxy auth rate limits distinguish clients and ignore forwarded-for spoofing", async () => {
  for (let n = 0; n < 20; n++)
    assert.equal(
      (
        await request("/auth/refresh", {
          method: "POST",
          headers: { "X-Vercel-Forwarded-For": "198.51.100.20" },
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await request("/auth/refresh", {
        method: "POST",
        headers: {
          "X-Vercel-Forwarded-For": "198.51.100.20",
          "X-Forwarded-For": "198.51.100.99",
        },
      })
    ).status,
    429,
  );
  assert.equal(
    (
      await request("/auth/refresh", {
        method: "POST",
        headers: { "X-Vercel-Forwarded-For": "198.51.100.21" },
      })
    ).status,
    401,
  );
});
test("CORS permits the frontend's bearer requests without credentialed cross-site cookies", async () => {
  const r = await fetch(
    server.base + "/hubs/chat/negotiate?negotiateVersion=1",
    {
      method: "OPTIONS",
      headers: {
        Origin: publicUrl,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers":
          "authorization,x-signalr-user-agent,x-requested-with",
      },
    },
  );
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), publicUrl);
  assert.equal(r.headers.get("access-control-allow-credentials"), null);
  assert.match(
    r.headers.get("access-control-allow-headers"),
    /x-requested-with/i,
  );
});
test("password reset closes passive sessions and only new sessions receive subsequent messages", async () => {
  const old1 = await connect(owner),
    old2 = await connect(owner),
    sender = await connect(member);
  let closed = 0;
  old1.onclose(() => closed++);
  old2.onclose(() => closed++);
  const received = [];
  old1.on("MessageCreated", (m) => received.push(m));
  old2.on("MessageCreated", (m) => received.push(m));
  assert.equal(
    (
      await request("/auth/forgot-password", {
        method: "POST",
        body: { email: "deployowner@example.test" },
      })
    ).status,
    200,
  );
  const mailDir = join(server.directory, "App_Data/mail");
  const mails = await Promise.all(
    (await readdir(mailDir)).map((f) => readFile(join(mailDir, f), "utf8")),
  );
  const mail = mails.find((s) => s.includes("action=reset"));
  assert.ok(mail);
  const token = mail.match(/token=([A-F0-9]+)/)[1];
  assert.equal(
    (
      await request("/auth/reset-password", {
        method: "POST",
        body: { token, password },
      })
    ).status,
    204,
  );
  for (let i = 0; i < 30 && closed < 2; i++) await sleep(100);
  assert.equal(closed, 2);
  assert.equal((await request("/users/me", { user: owner })).status, 401);
  assert.equal(
    (
      await request("/auth/reset-password", {
        method: "POST",
        body: { token, password },
      })
    ).status,
    400,
  );
  const login = await request("/auth/login", {
    method: "POST",
    body: { login: "deployowner", password },
  });
  assert.equal(login.status, 200);
  owner = login.body;
  const fresh = await connect(owner);
  const delivery = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("No new-session delivery")),
      3000,
    );
    fresh.on("MessageCreated", (m) => {
      clearTimeout(timer);
      resolve(m);
    });
  });
  await sender.invoke("SendMessage", {
    channelId: room.channelId,
    content: "After reset",
    clientMessageId: crypto.randomUUID(),
    attachmentIds: [],
  });
  assert.equal((await delivery).content, "After reset");
  assert.equal(received.length, 0);
});
test("failed image decoding does not leave a file behind", async () => {
  const before = await readdir(join(server.directory, "App_Data/media"));
  assert.equal((await upload(owner, 64, "broken.png")).status, 400);
  assert.deepEqual(
    await readdir(join(server.directory, "App_Data/media")),
    before,
  );
});
test("concurrent uploads enforce user and global storage budgets", async () => {
  const first = await upload(owner);
  assert.equal(first.status, 200);
  attached = first.body;
  const sender = await connect(owner);
  await sender.invoke("SendMessage", {
    channelId: room.channelId,
    content: "Keep this file",
    clientMessageId: crypto.randomUUID(),
    attachmentIds: [attached.id],
  });
  const results = await Promise.all([
    upload(owner),
    upload(owner),
    upload(owner),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 200, 413]);
  pending = results.find((r) => r.status === 200).body;
  assert.equal((await upload(member)).status, 200);
  assert.equal((await upload(member)).status, 507);
});
test("restart cleanup removes expired unclaimed uploads and orphans, retaining sent attachments", async () => {
  await Promise.all(hubs.map((h) => h.stop()));
  await stop(server.child);
  const media = join(server.directory, "App_Data/media"),
    old = new Date(Date.now() - 2 * 3600_000);
  await writeFile(join(media, "untracked.mp4"), "orphan");
  for (const name of await readdir(media))
    await utimes(join(media, name), old, old);
  server = await start({}, server.directory);
  for (let i = 0; i < 30 && (await readdir(media)).length !== 1; i++)
    await sleep(100);
  assert.equal((await readdir(media)).length, 1);
  const content = (id) =>
    fetch(`${server.base}/api/v1/media/${id}/content`, {
      headers: { Authorization: "Bearer " + owner.accessToken },
    });
  assert.equal((await content(attached.id)).status, 200);
  assert.equal((await content(pending.id)).status, 404);
  assert.equal((await request("/ready")).status, 200);
});
test("Production sets Secure cookies, restricts origins and requires SMTP TLS", async () => {
  let transmitted = "";
  const smtp = net.createServer((socket) => {
    socket.write("220 test SMTP\r\n");
    socket.on("data", (data) => {
      transmitted += data;
      socket.write("250 localhost\r\n");
    });
  });
  smtp.listen(0, "127.0.0.1");
  await once(smtp, "listening");
  const production = await start({
    ASPNETCORE_ENVIRONMENT: "Production",
    Email__Host: "127.0.0.1",
    Email__Port: String(smtp.address().port),
    Email__From: "noreply@example.test",
  });
  try {
    assert.equal(
      (
        await request("/health", {
          target: production,
          headers: { Origin: "https://untrusted.example" },
        })
      ).status,
      403,
    );
    const register = await request("/auth/register", {
      target: production,
      method: "POST",
      body: {
        username: "tlscheck",
        email: "tlscheck@example.test",
        displayName: "TLS test",
        password,
        ageConfirmed: true,
      },
    });
    assert.equal(register.status, 503);
    assert.ok(!transmitted.includes("MAIL FROM"));
    assert.ok(!transmitted.includes("token="));
    const login = await request("/auth/login", {
      target: production,
      method: "POST",
      headers: { Host: "api.example.test" },
      body: { login: "tlscheck", password },
    });
    assert.equal(login.status, 200);
    assert.match(login.response.headers.get("set-cookie"), /secure/i);
    assert.match(login.response.headers.get("set-cookie"), /samesite=strict/i);
    // Node fetch normalizes Host; use a raw HTTP client to exercise HSTS with a non-loopback host.
    const headers = await new Promise((resolve, reject) => {
      const req = http.get(
        production.base + "/api/v1/health",
        {
          headers: {
            Host: "api.example.test",
            "X-Gather-Proxy-Secret": secret,
            "X-Vercel-Forwarded-For": "198.51.100.10",
          },
        },
        (res) => {
          res.resume();
          resolve(res.headers);
        },
      );
      req.on("error", reject);
    });
    assert.ok(headers["strict-transport-security"]);
    await assert.rejects(readdir(join(production.directory, "App_Data/mail")), {
      code: "ENOENT",
    });
  } finally {
    await stop(production.child);
    await new Promise((r) => smtp.close(r));
  }
});

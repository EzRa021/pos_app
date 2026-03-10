#!/usr/bin/env node
// ============================================================================
// scripts/seed_users.js
// ============================================================================
// Creates demo users for every built-in role by calling the live HTTP API.
//
// Prerequisites:
//   1. PostgreSQL is running and the app DB exists (migrations applied).
//   2. The Quantum POS app is running (npm run tauri dev OR the built binary).
//      The HTTP API must be reachable on port 4000 (or the port you specify).
//
// Usage:
//   node scripts/seed_users.js
//   node scripts/seed_users.js --port 4000
//   node scripts/seed_users.js --port 4000 --admin admin --password Admin@123
//
// The script logs in as the existing super_admin (default: admin / Admin@123),
// fetches the first active store, then creates (or reports if already exists)
// one user per role.
// ============================================================================

import http from "http";
import https from "https";
import { parseArgs } from "util";

// ── CLI args ──────────────────────────────────────────────────────────────────
const { values: args } = parseArgs({
  options: {
    port:     { type: "string",  default: "4000"      },
    host:     { type: "string",  default: "localhost"  },
    admin:    { type: "string",  default: "admin"      },
    password: { type: "string",  default: "Admin@123"  },
    "seed-pw":{ type: "string",  default: "Admin@123"  },
  },
  strict: false,
});

const BASE_URL   = `http://${args.host}:${args.port}`;
const SEED_PW    = args["seed-pw"];

// ── Users to create ───────────────────────────────────────────────────────────
// store_id is filled in at runtime after we fetch the first active store.
const SEED_USERS = [
  {
    username:   "store_admin",
    email:      "store.admin@quantumpos.app",
    first_name: "Store",
    last_name:  "Admin",
    role_slug:  "admin",
    is_global:  false,
    pin_to_store: true,
  },
  {
    username:   "manager1",
    email:      "manager1@quantumpos.app",
    first_name: "Ahmed",
    last_name:  "Musa",
    role_slug:  "manager",
    is_global:  false,
    pin_to_store: true,
  },
  {
    username:   "cashier1",
    email:      "cashier1@quantumpos.app",
    first_name: "Ngozi",
    last_name:  "Okafor",
    role_slug:  "cashier",
    is_global:  false,
    pin_to_store: true,
  },
  {
    username:   "cashier2",
    email:      "cashier2@quantumpos.app",
    first_name: "Emeka",
    last_name:  "Eze",
    role_slug:  "cashier",
    is_global:  false,
    pin_to_store: true,
  },
  {
    username:   "stockkeeper1",
    email:      "stock1@quantumpos.app",
    first_name: "Bola",
    last_name:  "Adeyemi",
    role_slug:  "stock_keeper",
    is_global:  false,
    pin_to_store: true,
  },
];

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const lib     = BASE_URL.startsWith("https") ? https : http;
    const url     = new URL(path, BASE_URL);

    const options = {
      hostname: url.hostname,
      port:     parseInt(url.port, 10),
      path:     url.pathname + url.search,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(payload  ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        ...(token    ? { Authorization: `Bearer ${token}` }            : {}),
      },
    };

    const req = lib.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function rpc(method, params, token) {
  return request("POST", "/api/rpc", { method, params }, token);
}

// ── Colours ───────────────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  bold:  "\x1b[1m",
  green: "\x1b[32m",
  red:   "\x1b[31m",
  yellow:"\x1b[33m",
  cyan:  "\x1b[36m",
  grey:  "\x1b[90m",
};
const ok   = (s) => `${C.green}✔${C.reset} ${s}`;
const fail = (s) => `${C.red}✘${C.reset} ${s}`;
const warn = (s) => `${C.yellow}⚠${C.reset} ${s}`;
const info = (s) => `${C.cyan}ℹ${C.reset} ${s}`;

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}Quantum POS — User Seeder${C.reset}`);
  console.log(`${C.grey}API: ${BASE_URL}${C.reset}\n`);

  // 1. Health check
  console.log(info("Checking API health…"));
  try {
    const health = await request("GET", "/health");
    if (health.status !== 200) throw new Error(`HTTP ${health.status}`);
    console.log(ok(`API healthy — version: ${health.body.version ?? "?"}`));
  } catch (err) {
    console.error(fail(`Cannot reach API at ${BASE_URL}.`));
    console.error(`   Make sure the app is running first.\n   Error: ${err.message}`);
    process.exit(1);
  }

  // 2. Login as super_admin
  console.log(info(`Logging in as ${C.bold}${args.admin}${C.reset}…`));
  const loginRes = await rpc("login", { username: args.admin, password: args.password });
  if (loginRes.status !== 200 || loginRes.body?.error) {
    console.error(fail(`Login failed: ${loginRes.body?.error ?? JSON.stringify(loginRes.body)}`));
    process.exit(1);
  }
  const token = loginRes.body.access_token;
  console.log(ok(`Logged in. Token acquired.`));

  // 3. Fetch first active store
  console.log(info("Fetching first active store…"));
  const storesRes = await rpc("get_stores", { is_active: true }, token);
  const stores    = storesRes.body?.data ?? storesRes.body ?? [];
  if (!Array.isArray(stores) || stores.length === 0) {
    console.error(fail("No stores found. Create a store in the app first."));
    process.exit(1);
  }
  const store = stores[0];
  console.log(ok(`Using store: ${C.bold}${store.store_name}${C.reset} (id=${store.id})`));

  // 4. Fetch roles to map slug → id
  const rolesRes = await rpc("get_roles", {}, token);
  const roles    = rolesRes.body?.data ?? rolesRes.body ?? [];
  const roleMap  = Object.fromEntries(
    (Array.isArray(roles) ? roles : []).map((r) => [r.role_slug, r.id])
  );

  if (Object.keys(roleMap).length === 0) {
    console.error(fail("Could not fetch roles. Check that get_roles is exposed on the HTTP API."));
    // Fall back: map from common slugs — the create_user endpoint accepts role_slug too
    console.warn(warn("Falling back to role_slug-based creation (may fail if backend requires role_id)."));
  } else {
    console.log(ok(`Roles loaded: ${Object.keys(roleMap).join(", ")}`));
  }

  // 5. Create each seed user
  console.log(`\n${C.bold}Creating users…${C.reset}\n`);

  const results = [];

  for (const u of SEED_USERS) {
    const roleId = roleMap[u.role_slug];

    const payload = {
      username:    u.username,
      email:       u.email,
      password:    SEED_PW,
      first_name:  u.first_name,
      last_name:   u.last_name,
      role_id:     roleId ?? undefined,
      role_slug:   roleId ? undefined : u.role_slug, // fallback
      store_id:    u.pin_to_store ? store.id : undefined,
      is_active:   true,
    };

    const res = await rpc("create_user", payload, token);
    const err = res.body?.error;

    if (err) {
      // Already exists is not fatal
      if (err.toLowerCase().includes("already exists") ||
          err.toLowerCase().includes("duplicate")       ||
          err.toLowerCase().includes("unique")) {
        console.log(warn(`${u.username.padEnd(16)} already exists — skipped`));
        results.push({ username: u.username, status: "skipped" });
      } else {
        console.log(fail(`${u.username.padEnd(16)} ${C.red}${err}${C.reset}`));
        results.push({ username: u.username, status: "failed", error: err });
      }
    } else {
      console.log(ok(
        `${u.username.padEnd(16)} ${C.grey}${u.role_slug}${C.reset}` +
        (u.pin_to_store ? ` → ${store.store_name}` : " (global)")
      ));
      results.push({ username: u.username, status: "created" });
    }
  }

  // 6. Summary table
  console.log(`\n${"─".repeat(62)}`);
  console.log(`${C.bold}Summary${C.reset}\n`);

  const pad = (s, n) => String(s).padEnd(n);
  console.log(
    C.grey +
    pad("USERNAME", 16) + pad("ROLE", 16) + pad("PASSWORD", 14) + "STATUS" +
    C.reset
  );
  console.log(C.grey + "─".repeat(62) + C.reset);

  // Include existing admin in summary
  const allUsers = [
    { username: "admin", role_slug: "super_admin", pin_to_store: false, status: "pre-existing" },
    ...SEED_USERS.map((u) => ({
      ...u,
      status: results.find((r) => r.username === u.username)?.status ?? "?",
    })),
  ];

  for (const u of allUsers) {
    const statusColour =
      u.status === "created"      ? C.green  :
      u.status === "pre-existing" ? C.grey   :
      u.status === "skipped"      ? C.yellow :
      C.red;

    console.log(
      pad(u.username,   16) +
      pad(u.role_slug,  16) +
      pad(SEED_PW,      14) +
      statusColour + u.status + C.reset
    );
  }

  console.log(`\n${C.bold}${C.green}Done.${C.reset} Login at the app with any username above.\n`);
}

main().catch((err) => {
  console.error(fail(`Unexpected error: ${err.message}`));
  process.exit(1);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { Seal0, Seal0Error, ErrorCode, isSeal0Error, limit, isUnlimited, VERSION, EntitlementSource } from "../src/index.js";

// A fake fetch that records requests and replies from a queue.
type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | Error;
interface Recorded { url: string; method: string; headers: Record<string, string>; body: string | undefined }

function fakeFetch(replies: Reply[]) {
  const calls: Recorded[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: { ...(init?.headers as Record<string, string>) },
      body: init?.body as string | undefined,
    });
    const r = replies.shift() ?? { status: 500 };
    if (r instanceof Error) throw r;
    const text = r.body === undefined ? "" : typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return new Response(text || null, { status: r.status, headers: { "Content-Type": "application/json", ...r.headers } });
  };
  return { fn: fn as typeof fetch, calls };
}

const key = "s0_dev_TESTKEY00000_0000000000000000000000000000000000000000000";
const plan = { id: "p1", key: "pro", name: "Pro", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
const errorBody = (code: string, field: string | null = null) => ({ error: { code, message: "x", field, request_id: "req_1" } });
const client = (f: typeof fetch, extra: Partial<ConstructorParameters<typeof Seal0>[0]> = {}) =>
  new Seal0({ apiKey: key, baseURL: "http://api.test/", fetch: f, backoffMs: 1, ...extra });

test("evaluate sends the right request and decodes values", async () => {
  const f = fakeFetch([{ status: 200, body: {
    customer_id: "cus_1", evaluated_at: "2026-01-01T00:00:00Z", subscription: null,
    entitlement: { feature_key: "max_projects", feature_type: "number", granted: true, value: "unlimited",
      source: "override", reason: "customer_override", override_id: "o1", valid_until: null, future_field: 1 },
  } }]);
  const ev = await client(f.fn).evaluate("cus_1", "max_projects");
  const call = f.calls[0]!;
  assert.equal(call.url, "http://api.test/v1/entitlements/evaluate");
  assert.equal(call.method, "POST");
  assert.equal(call.body, '{"customer_id":"cus_1","feature_key":"max_projects"}');
  assert.equal(call.headers.Authorization, `Bearer ${key}`);
  assert.equal(call.headers["Content-Type"], "application/json");
  assert.equal(call.headers["X-Seal0-SDK"], `seal0-ts/${VERSION}`);
  assert.equal(call.headers["Idempotency-Key"], undefined, "evaluation must not send an Idempotency-Key");
  assert.equal(ev.entitlement.source, EntitlementSource.Override);
  assert.deepEqual(limit(ev.entitlement.value), { unlimited: true });
  assert.ok(isUnlimited(ev.entitlement.value));
});

test("path parameters are escaped and query strings built", async () => {
  const f = fakeFetch([{ status: 200, body: { data: [], next_cursor: null } }]);
  await client(f.fn).listOverrides("org:42/x", { limit: 5, cursor: "abc" });
  assert.equal(f.calls[0]!.url, "http://api.test/v1/customers/org%3A42%2Fx/overrides?limit=5&cursor=abc");
});

test("API errors become Seal0Error with code, field and request ID", async () => {
  const f = fakeFetch([{ status: 404, body: errorBody("customer_not_found") }, { status: 418, body: "teapot", headers: { "X-Request-Id": "req_h" } }]);
  const c = client(f.fn);
  await assert.rejects(c.getCustomer("missing"), (err: unknown) => {
    assert.ok(isSeal0Error(err, ErrorCode.CustomerNotFound));
    assert.ok(!isSeal0Error(err, ErrorCode.FeatureNotFound));
    assert.equal((err as Seal0Error).requestId, "req_1");
    assert.equal((err as Seal0Error).status, 404);
    return true;
  });
  await assert.rejects(c.getCustomer("teapot"), (err: unknown) =>
    isSeal0Error(err, "http_418") && (err as Seal0Error).requestId === "req_h");
});

test("retries reuse one idempotency key", async () => {
  const f = fakeFetch([
    new TypeError("fetch failed"),
    { status: 503, body: errorBody("not_ready") },
    { status: 409, body: errorBody("idempotency_in_progress") },
    { status: 201, body: plan },
  ]);
  const p = await client(f.fn, { maxRetries: 3 }).createPlan({ key: "pro", name: "Pro" });
  assert.equal(p.key, "pro");
  const keys = f.calls.map((c) => c.headers["Idempotency-Key"]);
  assert.equal(keys.length, 4);
  assert.ok(keys[0]);
  assert.ok(keys.every((k) => k === keys[0]), `keys differ: ${keys.join(",")}`);
});

test("an explicit idempotency key is used", async () => {
  const f = fakeFetch([{ status: 201, body: plan }]);
  await client(f.fn).createPlan({ key: "pro", name: "Pro" }, { idempotencyKey: "mine-1" });
  assert.equal(f.calls[0]!.headers["Idempotency-Key"], "mine-1");
});

test("client errors are not retried; retries give up after maxRetries", async () => {
  const f = fakeFetch([{ status: 422, body: errorBody("invalid_key", "key") }]);
  await assert.rejects(client(f.fn).createPlan({ key: "Bad", name: "x" }), (err: unknown) =>
    isSeal0Error(err, "invalid_key") && (err as Seal0Error).field === "key");
  assert.equal(f.calls.length, 1);

  const g = fakeFetch([{ status: 502 }, { status: 502 }, { status: 502 }, { status: 200, body: plan }]);
  await assert.rejects(client(g.fn).getPlan("pro"), (err: unknown) => isSeal0Error(err, "http_502"));
  assert.equal(g.calls.length, 3, "1 attempt + 2 retries");
});

test("usage_limit_exceeded is not retried; other 429s are", async () => {
  const f = fakeFetch([{ status: 429, body: errorBody("usage_limit_exceeded") }]);
  await assert.rejects(client(f.fn).getPlan("pro"), (err: unknown) => isSeal0Error(err, "usage_limit_exceeded"));
  assert.equal(f.calls.length, 1);

  const g = fakeFetch([{ status: 429, body: errorBody("rate_limited") }, { status: 200, body: plan }]);
  await client(g.fn).getPlan("pro");
  assert.equal(g.calls.length, 2);
});

test("Retry-After is honoured", async () => {
  const f = fakeFetch([{ status: 429, body: errorBody("rate_limited"), headers: { "Retry-After": "1" } }, { status: 200, body: plan }]);
  const start = Date.now();
  await client(f.fn).getPlan("pro");
  assert.ok(Date.now() - start >= 900, "waited for Retry-After");
});

test("cancellation stops retries", async () => {
  const f = fakeFetch(Array.from({ length: 10 }, () => ({ status: 503 })));
  const ac = new AbortController();
  setTimeout(() => ac.abort(new Error("cancelled by caller")), 50);
  const start = Date.now();
  await assert.rejects(client(f.fn, { backoffMs: 60_000, maxRetries: 5 }).getPlan("pro", { signal: ac.signal }), /cancelled by caller/);
  assert.ok(Date.now() - start < 2000, "backoff ignored the abort signal");
});

test("PATCH sends null to clear and omits undefined", async () => {
  const f = fakeFetch([{ status: 200, body: {} }]);
  await client(f.fn).updateFeature("max_projects", { name: "Renamed", description: null, default_value: 3 });
  assert.equal(f.calls[0]!.body, '{"name":"Renamed","description":null,"default_value":3}');
  const g = fakeFetch([{ status: 200, body: {} }]);
  await client(g.fn).updateSubscription("sub_1", { status: "active", cancel_at: null });
  assert.equal(g.calls[0]!.body, '{"status":"active","cancel_at":null}');
});

test("upsertCustomer reports whether it created the customer", async () => {
  const customer = { id: "1", external_customer_id: "cus_1", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
  const f = fakeFetch([{ status: 201, body: customer }, { status: 200, body: customer }]);
  const c = client(f.fn);
  assert.equal((await c.upsertCustomer("cus_1")).created, true);
  assert.equal((await c.upsertCustomer("cus_1")).created, false);
});

test("iterators follow cursors across pages", async () => {
  const feature = (k: string) => ({ id: k, key: k, name: "x", description: null, value_type: "boolean", enum_options: null,
    default_value: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" });
  const f = fakeFetch([
    { status: 200, body: { data: [feature("a"), feature("b")], next_cursor: "c1" } },
    { status: 200, body: { data: [feature("c")], next_cursor: null } },
  ]);
  const keys: string[] = [];
  for await (const ft of client(f.fn).features()) keys.push(ft.key);
  assert.deepEqual(keys, ["a", "b", "c"]);
  assert.match(f.calls[1]!.url, /cursor=c1/);
});

test("value helpers", () => {
  assert.deepEqual(limit(20), { unlimited: false, n: 20 });
  assert.equal(limit(true), undefined);
  assert.equal(limit("csv"), undefined);
  assert.equal(limit(null), undefined);
});

test("refuses to run in a browser unless explicitly allowed", () => {
  const g = globalThis as { window?: unknown; document?: unknown };
  g.window = {};
  g.document = {};
  try {
    assert.throws(() => new Seal0({ apiKey: key }), /refusing to run in a browser/);
    assert.doesNotThrow(() => new Seal0({ apiKey: key, dangerouslyAllowBrowser: true }));
  } finally {
    delete g.window;
    delete g.document;
  }
  assert.throws(() => new Seal0({ apiKey: "" }), /apiKey is required/);
});

test("VERSION matches package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
  assert.equal(VERSION, pkg.version);
});

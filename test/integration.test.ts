import { test } from "node:test";
import assert from "node:assert/strict";

import { Seal0, ErrorCode, isSeal0Error, limit, isUnlimited, SubscriptionStatus, FeatureType, EntitlementSource, PlanVersionStatus } from "../src/index.js";

// Runs against a real API (scripts/sdk-ts-integration.sh starts one with a
// fresh project and keys). Skipped when the environment is not set.
const baseURL = process.env.SEAL0_BASE_URL;
const fullKey = process.env.SEAL0_FULL_KEY;
const evalKey = process.env.SEAL0_EVAL_KEY;
const skip = !baseURL || !fullKey || !evalKey ? "SEAL0_BASE_URL / SEAL0_FULL_KEY / SEAL0_EVAL_KEY not set" : false;

const sdk = (key = fullKey!, extra: Partial<ConstructorParameters<typeof Seal0>[0]> = {}) =>
  new Seal0({ apiKey: key, baseURL: baseURL!, ...extra });

test("full flow through the SDK", { skip }, async () => {
  const c = sdk();
  await c.createFeature({ key: "max_projects", name: "Max projects", value_type: FeatureType.Number });
  await c.createFeature({ key: "export_format", name: "Export", value_type: FeatureType.Enum, enum_options: ["csv", "json"], default_value: "csv" });
  await c.createPlan({ key: "pro", name: "Pro" });
  await c.putDraft("pro", { max_projects: 5 });
  const v1 = await c.publishPlan("pro");
  assert.equal(v1.version, 1);
  assert.equal(v1.status, PlanVersionStatus.Published);
  await assert.rejects(c.getDraft("pro"), (e: unknown) => isSeal0Error(e, ErrorCode.DraftNotFound));

  assert.equal((await c.upsertCustomer("cus_ts_demo")).created, true);
  assert.equal((await c.upsertCustomer("cus_ts_demo")).created, false);
  const sub = await c.assignSubscription("cus_ts_demo", {
    plan: { key: "pro" }, status: SubscriptionStatus.Active, current_period_start: "2025-12-01T00:00:00Z",
  });
  assert.equal(sub.plan.version, 1);
  assert.equal(sub.customer_id, "cus_ts_demo");

  let ev = await c.evaluate("cus_ts_demo", "max_projects");
  assert.deepEqual(limit(ev.entitlement.value), { unlimited: false, n: 5 });
  assert.equal(ev.entitlement.source, EntitlementSource.Plan);
  assert.equal(ev.subscription?.plan.key, "pro");

  const expires = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const o = await c.createOverride("cus_ts_demo", { feature_key: "max_projects", value: "unlimited", expires_at: expires });
  ev = await c.evaluate("cus_ts_demo", "max_projects");
  assert.ok(isUnlimited(ev.entitlement.value));
  assert.equal(ev.entitlement.override_id, o.id);
  assert.ok(ev.entitlement.valid_until);
  const overrides = [];
  for await (const ov of c.overrides("cus_ts_demo")) overrides.push(ov.id);
  assert.deepEqual(overrides, [o.id]);
  await c.revokeOverride(o.id);

  const all = await c.evaluateAll("cus_ts_demo");
  assert.deepEqual(all.entitlements.map((e) => [e.feature_key, e.source]), [["export_format", "default"], ["max_projects", "plan"]]);

  // PATCH: undefined leaves a field alone, null clears it.
  let f = await c.updateFeature("max_projects", { description: "Projects", default_value: 1 });
  assert.equal(f.description, "Projects");
  f = await c.updateFeature("max_projects", { default_value: null });
  assert.equal(f.default_value, null);
  assert.equal(f.description, "Projects");

  let s = await c.updateSubscription(sub.id, { status: SubscriptionStatus.Canceled, cancel_at: "2099-01-15T00:00:00Z" });
  assert.equal(s.cancel_at, "2099-01-15T00:00:00Z");
  s = await c.updateSubscription(sub.id, { status: SubscriptionStatus.Active, cancel_at: null });
  assert.equal(s.cancel_at, null);

  await c.putDraft("pro", { max_projects: 20 });
  await c.publishPlan("pro");
  s = await c.changePlanVersion(sub.id, { key: "pro" });
  assert.equal(s.plan.version, 2);
  const v2 = await c.getPlanVersion("pro", 2);
  assert.equal(v2.values.max_projects, 20);
  const versions = [];
  for await (const pv of c.planVersions("pro")) versions.push(pv.version);
  assert.deepEqual(versions, [1, 2]);
  const keys = [];
  for await (const ft of c.features()) keys.push(ft.key);
  assert.deepEqual(keys, ["export_format", "max_projects"]);
});

test("typed errors", { skip }, async () => {
  const c = sdk();
  await c.upsertCustomer("cus_ts_errors");
  const cases: [string, () => Promise<unknown>, string][] = [
    ["unknown customer", () => c.evaluate("cus_missing", "max_projects"), ErrorCode.CustomerNotFound],
    ["unknown feature", () => c.evaluate("cus_ts_errors", "nope"), ErrorCode.FeatureNotFound],
    ["evaluate key on management", () => sdk(evalKey!).getFeature("max_projects"), ErrorCode.InsufficientScope],
    ["bad key", () => sdk("s0_dev_000000000000_0000000000000000000000000000000000000000000").evaluate("cus_ts_errors", "max_projects"), ErrorCode.InvalidApiKey],
    ["no draft", () => c.publishPlan("pro"), ErrorCode.NoDraft],
  ];
  for (const [name, call, code] of cases) {
    await assert.rejects(call(), (e: unknown) => {
      assert.ok(isSeal0Error(e, code), `${name}: ${String(e)}`);
      assert.ok(e.requestId, `${name}: no request ID`);
      return true;
    });
  }
  // An evaluate-scope key can evaluate.
  const ev = await sdk(evalKey!).evaluate("cus_ts_errors", "max_projects");
  assert.equal(ev.entitlement.reason, "no_subscription");
});

// A retried mutation must be replayed, not executed twice (ADR-0019).
test("a retry after a lost response is replayed", { skip }, async () => {
  await sdk().upsertCustomer("cus_ts_retry");
  let dropped: { id: string } | undefined;
  const lossyFetch: typeof fetch = async (input, init) => {
    const res = await fetch(input, init);
    if (!dropped && String(input).endsWith("/v1/customers/cus_ts_retry/subscriptions")) {
      dropped = (await res.json()) as { id: string };
      throw new TypeError("connection reset after the server responded");
    }
    return res;
  };
  const sub = await sdk(fullKey!, { fetch: lossyFetch }).assignSubscription("cus_ts_retry", {
    plan: { key: "pro" }, status: SubscriptionStatus.Trialing, trial_ends_at: "2099-03-01T00:00:00Z",
  });
  assert.ok(dropped, "first response was not captured");
  assert.equal(sub.id, dropped.id, "the retry executed the assignment again");
  const cur = await sdk().getCurrentSubscription("cus_ts_retry");
  assert.equal(cur.id, dropped.id);
});

test("metered usage: record, evaluate, block", { skip }, async () => {
  const c = sdk();
  await c.createFeature({ key: "api_calls", name: "API calls", value_type: FeatureType.Metered, grace_percent: 0 });
  await c.createPlan({ key: "metered", name: "Metered" });
  await c.putDraft("metered", { api_calls: 3 });
  await c.publishPlan("metered");
  await c.upsertCustomer("cus_ts_metered");
  await c.assignSubscription("cus_ts_metered", { plan: { key: "metered" }, status: SubscriptionStatus.Active, current_period_start: "2025-12-01T00:00:00Z" });

  let ev = await sdk(evalKey!).evaluate("cus_ts_metered", "api_calls");
  assert.equal(ev.entitlement.feature_type, FeatureType.Metered);
  assert.equal(ev.entitlement.usage?.used, 0);
  assert.equal(ev.entitlement.usage?.limit, 3);

  assert.equal((await c.recordUsage("cus_ts_metered", "api_calls", 2)).used, 2);
  const u = await c.recordUsage("cus_ts_metered", "api_calls");
  assert.equal(u.used, 3);
  ev = await sdk(evalKey!).evaluate("cus_ts_metered", "api_calls");
  assert.equal(ev.entitlement.granted, false);
  assert.equal(ev.entitlement.reason, "usage_limit_exceeded");
  assert.equal(ev.entitlement.usage?.remaining, 0);

  await assert.rejects(c.recordUsage("cus_ts_metered", "max_projects"), (e: unknown) => isSeal0Error(e, ErrorCode.FeatureNotMetered));
  // Evaluate-scoped keys cannot record usage.
  await assert.rejects(sdk(evalKey!).recordUsage("cus_ts_metered", "api_calls"), (e: unknown) => isSeal0Error(e, ErrorCode.InsufficientScope));
});

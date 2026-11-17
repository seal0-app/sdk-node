import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";

import { SubscriptionStatus, FeatureType, EntitlementSource, PlanVersionStatus } from "../src/index.js";

// Known-value constants must match x-known-values in the SDK view (ADR-0023).
// The spec lives in the Seal0 monorepo, so the test skips in the public
// repository (ADR-0038), where releases have already passed it.
const specURL = new URL("../../../../api/bundled/openapi.sdk.yaml", import.meta.url);
const skip = existsSync(specURL) ? false : "api/bundled/openapi.sdk.yaml is only in the Seal0 monorepo";

test("constants match x-known-values in api/bundled/openapi.sdk.yaml", { skip }, () => {
  const spec = parse(readFileSync(specURL, "utf8")) as {
    components: { schemas: Record<string, { "x-known-values"?: string[]; properties?: Record<string, { "x-known-values"?: string[] }> }> };
  };
  const s = spec.components.schemas;
  const cases: [string, string[] | undefined, Record<string, string>][] = [
    ["SubscriptionStatus", s.SubscriptionStatus?.["x-known-values"], SubscriptionStatus],
    ["FeatureType", s.FeatureType?.["x-known-values"], FeatureType],
    ["Entitlement.source", s.Entitlement?.properties?.source?.["x-known-values"], EntitlementSource],
    ["PlanVersion.status", s.PlanVersion?.properties?.status?.["x-known-values"], PlanVersionStatus],
    ["PlanVersionSummary.status", s.PlanVersionSummary?.properties?.status?.["x-known-values"], PlanVersionStatus],
  ];
  for (const [name, known, constants] of cases) {
    assert.ok(known && known.length > 0, `${name}: no x-known-values in the contract`);
    assert.deepEqual(Object.values(constants).sort(), [...known].sort(), name);
  }
});

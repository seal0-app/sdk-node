// Evaluates one feature, then every feature, for one Customer with the Seal0
// TypeScript SDK (Node.js >= 20.3).
//
//   npm install @seal0/sdk
//   export SEAL0_API_KEY=<API_KEY>   # an evaluate-scope key from the Console
//   node examples/quickstart/index.mjs cus_test_0001 max_projects
//
// It prints whether the feature is granted, its value, why, and until when
// the result can be cached (valid_until).
import { ErrorCode, Seal0, isSeal0Error } from "@seal0/sdk";

const [customerId, featureKey] = process.argv.slice(2);
if (!customerId || !featureKey) {
  console.error("usage: node examples/quickstart/index.mjs <customer_id> <feature_key>");
  process.exit(1);
}

const seal0 = new Seal0({
  apiKey: process.env.SEAL0_API_KEY ?? "",
  ...(process.env.SEAL0_BASE_URL ? { baseURL: process.env.SEAL0_BASE_URL } : {}), // defaults to https://api.seal0.app
});

function print(e) {
  const value = e.value === null ? "none" : String(e.value);
  console.log(
    `${e.feature_key.padEnd(24)} granted=${String(e.granted).padEnd(5)} value=${value.padEnd(10)} reason=${e.reason} valid_until=${e.valid_until ?? "no known change"}`,
  );
}

try {
  const { entitlement } = await seal0.evaluate(customerId, featureKey);
  print(entitlement);

  const all = await seal0.evaluateAll(customerId);
  console.log(`\nAll ${all.entitlements.length} features for ${customerId}:`);
  all.entitlements.forEach(print);
} catch (err) {
  // In an application, fail closed: treat any error as not granted.
  if (isSeal0Error(err, ErrorCode.CustomerNotFound)) {
    console.error(`No Customer "${customerId}" in this environment: create one in the Console first.`);
  } else if (isSeal0Error(err, ErrorCode.FeatureNotFound)) {
    console.error(`No feature "${featureKey}" in this environment.`);
  } else {
    console.error(err);
  }
  process.exit(1);
}

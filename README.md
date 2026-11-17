# @seal0/sdk

TypeScript client for the Seal0 entitlement API. **Server-side**, zero runtime
dependencies, ESM only. Node.js ≥ 20.3, Bun, Deno and edge runtimes with a
standard `fetch`.

```sh
npm install @seal0/sdk
```

```ts
import { Seal0, isSeal0Error, limit } from "@seal0/sdk";

const seal0 = new Seal0({ apiKey: process.env.SEAL0_API_KEY! }); // s0_prod_… — keep it on the server

try {
  const { entitlement } = await seal0.evaluate("cus_123", "max_projects");
  const l = limit(entitlement.value);
  if (l && (l.unlimited || projects < l.n)) allow();
} catch (err) {
  // Unknown customer/feature, auth or network failure: fail closed.
  deny();
}
```

- **Typed against the contract:** method parameters and results come from types generated from the API's OpenAPI contract (`src/types.gen.ts`, never edited by hand).
- **Errors:** `Seal0Error` carries `status`, `code`, `field` and `requestId`; `isSeal0Error(err, ErrorCode.CustomerNotFound)` narrows it.
- **Metered usage:** `seal0.recordUsage("cus_123", "api_calls", 1)` adds to the current period (full-scope key); results of metered features carry `entitlement.usage` (used, limit, remaining, over_limit, period). The API decides `granted` from usage and the grace margin.
- **Safe retries:** network errors, 429 (except `usage_limit_exceeded`, which lasts until the usage period resets) and 5xx gateway errors are retried (2 by default). Every mutation sends an `Idempotency-Key`, reused across retries, so a retry never applies a change twice. Pass `{ idempotencyKey }` to choose your own. Pass `{ signal }` to cancel.
- **PATCH:** omit a field to leave it unchanged, set it to `null` to clear it.
- **Pagination:** `for await (const f of seal0.features()) { … }`.
- **Values:** feature values are `boolean | number | string`; `limit(value)` and `isUnlimited(value)` read number features.
- **Browsers:** the constructor refuses to run in a browser, because API keys are secrets. `dangerouslyAllowBrowser: true` overrides this for trusted internal tools only.

The SDK makes no entitlement decisions: the API does. Use evaluate-scope keys
in application servers and full-scope keys only where you manage plans and
customers.

## Getting started

1. Sign in to the [Seal0 Console](https://console.seal0.app) and create a project.
2. Create an **evaluate**-scope API key for your application servers (a **full**-scope key only where you manage plans and Customers). Keep keys on the server.
3. Define features and a plan, give a Customer a subscription, then evaluate it from your code.

The [documentation](https://docs.seal0.app) has the concepts (eligibility, precedence, `valid_until` caching), guides and the API reference.

## Example

[`examples/quickstart`](examples/quickstart/index.mjs) evaluates a feature for a Customer:

```sh
export SEAL0_API_KEY=<API_KEY>
node examples/quickstart/index.mjs cus_test_0001 max_projects
```

In a clone of this repository, run `npm install && npm run build` first; the example imports the package by its name.

## Versioning

Semantic versioning. Before 1.0.0, a minor version may include breaking changes; see [CHANGELOG.md](CHANGELOG.md).

## Contributing

This repository is published from Seal0's main repository on each release. Issues are welcome here. Pull requests are reviewed here and ported by hand, then arrive with the next release.

## License

[Apache-2.0](LICENSE).

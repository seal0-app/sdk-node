import type { operations, paths } from "./types.gen.js";
import type {
  AssignSubscriptionRequest, CreateFeatureRequest, CreateOverrideRequest, CreatePlanRequest, Customer,
  Evaluation, EvaluationAll, Feature, FeatureList, FeatureValue, Override, OverrideList, Plan, PlanList,
  PlanSelector, PlanVersion, PlanVersionList, PlanVersionSummary, RecordedUsage, Subscription, UpdateFeatureRequest,
  UpdateSubscriptionRequest,
} from "./types.js";
import { Seal0Error } from "./errors.js";
import { VERSION } from "./version.js";

export const DEFAULT_BASE_URL = "https://api.seal0.app";

export interface Seal0Options {
  /** API key: s0_dev_… or s0_prod_…. Keep it on the server. */
  apiKey: string;
  /** API endpoint; defaults to production. */
  baseURL?: string;
  /** fetch implementation; defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  /** Retries after a failed attempt (default 2). Only safe failures are retried. */
  maxRetries?: number;
  /** Per-attempt timeout in milliseconds (default 10000). */
  timeoutMs?: number;
  /** Allow use in a browser. API keys are secrets; only do this for trusted, internal tools. */
  dangerouslyAllowBrowser?: boolean;
}

export interface RequestOptions {
  /** Cancels the call, including pending retries. */
  signal?: AbortSignal;
  /** Idempotency-Key for a mutation; by default one is generated per call and reused across retries. */
  idempotencyKey?: string;
}

export interface ListOptions {
  /** 1-200; the API defaults to 50. */
  limit?: number;
  /** next_cursor from the previous page. */
  cursor?: string;
}

// ---------------------------------------------------------------- routes
//
// One entry per operation in the contract. `satisfies` fails compilation if
// the contract gains or loses an operation; _routesMatchContract fails it if
// a path/method pair does not resolve to the operation it is listed under.

type Method = "get" | "post" | "put" | "patch" | "delete";
type OperationId = keyof operations;
interface Route { method: Method; path: keyof paths; mutation: boolean }

const routes = {
  evaluateEntitlement: { method: "post", path: "/v1/entitlements/evaluate", mutation: false },
  evaluateAllEntitlements: { method: "post", path: "/v1/entitlements/evaluate-all", mutation: false },
  recordUsage: { method: "post", path: "/v1/usage", mutation: true },
  createFeature: { method: "post", path: "/v1/features", mutation: true },
  listFeatures: { method: "get", path: "/v1/features", mutation: false },
  getFeature: { method: "get", path: "/v1/features/{feature_key}", mutation: false },
  updateFeature: { method: "patch", path: "/v1/features/{feature_key}", mutation: true },
  createPlan: { method: "post", path: "/v1/plans", mutation: true },
  listPlans: { method: "get", path: "/v1/plans", mutation: false },
  getPlan: { method: "get", path: "/v1/plans/{plan_key}", mutation: false },
  getDraft: { method: "get", path: "/v1/plans/{plan_key}/draft", mutation: false },
  putDraft: { method: "put", path: "/v1/plans/{plan_key}/draft", mutation: true },
  publishPlan: { method: "post", path: "/v1/plans/{plan_key}/publish", mutation: true },
  listPlanVersions: { method: "get", path: "/v1/plans/{plan_key}/versions", mutation: false },
  getPlanVersion: { method: "get", path: "/v1/plans/{plan_key}/versions/{version}", mutation: false },
  upsertCustomer: { method: "put", path: "/v1/customers/{external_customer_id}", mutation: true },
  getCustomer: { method: "get", path: "/v1/customers/{external_customer_id}", mutation: false },
  assignSubscription: { method: "post", path: "/v1/customers/{external_customer_id}/subscriptions", mutation: true },
  getCurrentSubscription: { method: "get", path: "/v1/customers/{external_customer_id}/subscriptions/current", mutation: false },
  updateSubscription: { method: "patch", path: "/v1/subscriptions/{subscription_id}", mutation: true },
  changePlanVersion: { method: "post", path: "/v1/subscriptions/{subscription_id}/change-plan-version", mutation: true },
  createOverride: { method: "post", path: "/v1/customers/{external_customer_id}/overrides", mutation: true },
  listOverrides: { method: "get", path: "/v1/customers/{external_customer_id}/overrides", mutation: false },
  revokeOverride: { method: "delete", path: "/v1/overrides/{override_id}", mutation: true },
} as const satisfies Record<OperationId, Route>;

type Routes = typeof routes;
type RouteOp<O extends OperationId> = paths[Routes[O]["path"]][Routes[O]["method"]];
type RouteMismatch = {
  [O in OperationId]: RouteOp<O> extends operations[O] ? (operations[O] extends RouteOp<O> ? never : O) : O;
}[OperationId];
export const _routesMatchContract: [RouteMismatch] extends [never] ? true : RouteMismatch = true;

// --------------------------------------------------------- typed requests

type Params<O extends OperationId> = operations[O]["parameters"];
type PathParams<O extends OperationId> = Params<O> extends { path: infer P } ? P : never;
type QueryParams<O extends OperationId> = Params<O> extends { query?: infer Q } ? Q : never;
type Body<O extends OperationId> = operations[O] extends { requestBody: { content: { "application/json": infer B } } } ? B : never;
type Responses<O extends OperationId> = operations[O]["responses"];
type JSONOf<R> = R extends { content: { "application/json": infer T } } ? T : never;
type Success<O extends OperationId> = JSONOf<Responses<O>[Extract<keyof Responses<O>, 200 | 201>]>;

type CallArgs<O extends OperationId> =
  & ([PathParams<O>] extends [never] ? { path?: undefined } : { path: PathParams<O> })
  & ([Body<O>] extends [never] ? { body?: undefined } : { body: Body<O> })
  & ([QueryParams<O>] extends [never] ? { query?: undefined } : { query?: QueryParams<O> | undefined });

const retryAfterMs = Symbol("retryAfterMs");

/** A failed attempt with no HTTP response (network error or attempt timeout). */
class NetworkError extends Error {
  override readonly name = "Seal0NetworkError";
}

// ---------------------------------------------------------------- client

/**
 * Client for the Seal0 API. It makes no entitlement decisions: the API does.
 * Every method throws Seal0Error for API errors; treat any error as "not
 * granted" unless you have a reason not to.
 */
export class Seal0 {
  readonly #apiKey: string;
  readonly #baseURL: string;
  readonly #fetch: typeof fetch;
  readonly #maxRetries: number;
  readonly #timeoutMs: number;
  /** Base backoff in milliseconds; exposed to tests through the constructor only. */
  #backoffMs = 200;

  constructor(options: Seal0Options & { backoffMs?: number }) {
    if (!options.apiKey) throw new Error("seal0: apiKey is required");
    const g = globalThis as { window?: unknown; document?: unknown };
    if (g.window !== undefined && g.document !== undefined && !options.dangerouslyAllowBrowser) {
      throw new Error(
        "seal0: refusing to run in a browser: API keys are secrets. Call Seal0 from your server, " +
          "or pass dangerouslyAllowBrowser: true for trusted internal tools.",
      );
    }
    this.#apiKey = options.apiKey;
    this.#baseURL = (options.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#maxRetries = Math.max(0, options.maxRetries ?? 2);
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    if (options.backoffMs !== undefined) this.#backoffMs = options.backoffMs;
  }

  // ------------------------------------------------------------ evaluation

  /**
   * One feature's entitlement for a customer now. A missing entitlement is a
   * result with granted=false; an unknown customer or feature key throws
   * Seal0Error (customer_not_found / feature_not_found).
   */
  async evaluate(customerId: string, featureKey: string, opts?: RequestOptions): Promise<Evaluation> {
    return this.#data("evaluateEntitlement", { body: { customer_id: customerId, feature_key: featureKey } }, opts);
  }

  /** Every feature's entitlement for a customer now. */
  async evaluateAll(customerId: string, opts?: RequestOptions): Promise<EvaluationAll> {
    return this.#data("evaluateAllEntitlements", { body: { customer_id: customerId } }, opts);
  }

  // ----------------------------------------------------------------- usage

  /**
   * Adds quantity (default 1) to a customer's usage of a metered feature in
   * the current period and returns the new total. Each call is one exact
   * write; retries reuse the request's idempotency key, so a retried call is
   * not counted twice.
   */
  async recordUsage(customerId: string, featureKey: string, quantity = 1, opts?: RequestOptions): Promise<RecordedUsage> {
    return this.#data("recordUsage", { body: { customer_id: customerId, feature_key: featureKey, quantity } }, opts);
  }

  // -------------------------------------------------------------- features

  /** Defines a feature. Its key and type cannot change later. */
  async createFeature(body: CreateFeatureRequest, opts?: RequestOptions): Promise<Feature> {
    return this.#data("createFeature", { body }, opts);
  }

  async getFeature(key: string, opts?: RequestOptions): Promise<Feature> {
    return this.#data("getFeature", { path: { feature_key: key } }, opts);
  }

  /** Changes a feature. Omit a field to leave it unchanged; null clears it. */
  async updateFeature(key: string, patch: UpdateFeatureRequest, opts?: RequestOptions): Promise<Feature> {
    return this.#data("updateFeature", { path: { feature_key: key }, body: patch }, opts);
  }

  /** One page of features, ordered by key. See features() for all pages. */
  async listFeatures(page?: ListOptions, opts?: RequestOptions): Promise<FeatureList> {
    return this.#data("listFeatures", { query: page }, opts);
  }

  /** Iterates over every feature: `for await (const f of client.features())`. */
  features(opts?: RequestOptions): AsyncGenerator<Feature> {
    return paginate((page) => this.listFeatures(page, opts));
  }

  // ----------------------------------------------------------------- plans

  /** Creates a plan with no draft. */
  async createPlan(body: CreatePlanRequest, opts?: RequestOptions): Promise<Plan> {
    return this.#data("createPlan", { body }, opts);
  }

  async getPlan(key: string, opts?: RequestOptions): Promise<Plan> {
    return this.#data("getPlan", { path: { plan_key: key } }, opts);
  }

  async listPlans(page?: ListOptions, opts?: RequestOptions): Promise<PlanList> {
    return this.#data("listPlans", { query: page }, opts);
  }

  plans(opts?: RequestOptions): AsyncGenerator<Plan> {
    return paginate((page) => this.listPlans(page, opts));
  }

  async getDraft(planKey: string, opts?: RequestOptions): Promise<PlanVersion> {
    return this.#data("getDraft", { path: { plan_key: planKey } }, opts);
  }

  /** Creates or fully replaces the plan's draft; unlisted features are omitted. */
  async putDraft(planKey: string, values: Record<string, FeatureValue>, opts?: RequestOptions): Promise<PlanVersion> {
    return this.#data("putDraft", { path: { plan_key: planKey }, body: { values } }, opts);
  }

  /** Publishes the draft as the next immutable version (no_draft if there is none). */
  async publishPlan(planKey: string, opts?: RequestOptions): Promise<PlanVersion> {
    return this.#data("publishPlan", { path: { plan_key: planKey } }, opts);
  }

  async listPlanVersions(planKey: string, page?: ListOptions, opts?: RequestOptions): Promise<PlanVersionList> {
    return this.#data("listPlanVersions", { path: { plan_key: planKey }, query: page }, opts);
  }

  planVersions(planKey: string, opts?: RequestOptions): AsyncGenerator<PlanVersionSummary> {
    return paginate((page) => this.listPlanVersions(planKey, page, opts));
  }

  async getPlanVersion(planKey: string, version: number, opts?: RequestOptions): Promise<PlanVersion> {
    return this.#data("getPlanVersion", { path: { plan_key: planKey, version } }, opts);
  }

  // ------------------------------------------------ customers and subscriptions

  /** Registers a customer by your own opaque ID (not an email or name). Idempotent. */
  async upsertCustomer(customerId: string, opts?: RequestOptions): Promise<{ customer: Customer; created: boolean }> {
    const res = await this.#call("upsertCustomer", { path: { external_customer_id: customerId } }, opts);
    return { customer: res.data, created: res.status === 201 };
  }

  async getCustomer(customerId: string, opts?: RequestOptions): Promise<Customer> {
    return this.#data("getCustomer", { path: { external_customer_id: customerId } }, opts);
  }

  /** Gives the customer a new current subscription, replacing any existing one. */
  async assignSubscription(customerId: string, body: AssignSubscriptionRequest, opts?: RequestOptions): Promise<Subscription> {
    return this.#data("assignSubscription", { path: { external_customer_id: customerId }, body }, opts);
  }

  async getCurrentSubscription(customerId: string, opts?: RequestOptions): Promise<Subscription> {
    return this.#data("getCurrentSubscription", { path: { external_customer_id: customerId } }, opts);
  }

  /** Changes status and timestamps. Omit a field to leave it unchanged; null clears it. */
  async updateSubscription(subscriptionId: string, patch: UpdateSubscriptionRequest, opts?: RequestOptions): Promise<Subscription> {
    return this.#data("updateSubscription", { path: { subscription_id: subscriptionId }, body: patch }, opts);
  }

  /** Moves the current subscription to another published version; omit plan.version for the latest. */
  async changePlanVersion(subscriptionId: string, plan: PlanSelector, opts?: RequestOptions): Promise<Subscription> {
    return this.#data("changePlanVersion", { path: { subscription_id: subscriptionId }, body: { plan } }, opts);
  }

  // ------------------------------------------------------------- overrides

  /** Adds a customer-specific value (override_overlap if it overlaps another). */
  async createOverride(customerId: string, body: CreateOverrideRequest, opts?: RequestOptions): Promise<Override> {
    return this.#data("createOverride", { path: { external_customer_id: customerId }, body }, opts);
  }

  async listOverrides(customerId: string, page?: ListOptions, opts?: RequestOptions): Promise<OverrideList> {
    return this.#data("listOverrides", { path: { external_customer_id: customerId }, query: page }, opts);
  }

  overrides(customerId: string, opts?: RequestOptions): AsyncGenerator<Override> {
    return paginate((page) => this.listOverrides(customerId, page, opts));
  }

  /** Revokes an override, keeping its history; revoking twice is a no-op. */
  async revokeOverride(overrideId: string, opts?: RequestOptions): Promise<Override> {
    return this.#data("revokeOverride", { path: { override_id: overrideId } }, opts);
  }

  // ------------------------------------------------------------- transport

  async #data<O extends OperationId>(op: O, args: CallArgs<O>, opts?: RequestOptions): Promise<Success<O>> {
    return (await this.#call(op, args, opts)).data;
  }

  async #call<O extends OperationId>(op: O, args: CallArgs<O>, opts: RequestOptions = {}): Promise<{ status: number; data: Success<O> }> {
    const route: Route = routes[op];
    const url = this.#url(route.path, args.path as Record<string, string | number> | undefined, args.query as Record<string, unknown> | undefined);
    const body = args.body === undefined ? undefined : JSON.stringify(args.body);
    const key = route.mutation ? (opts.idempotencyKey ?? crypto.randomUUID()) : undefined;

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.#send<O>(route.method, url, body, key, opts.signal);
      } catch (err) {
        if (attempt >= this.#maxRetries || !retryable(err) || opts.signal?.aborted) throw err;
        await sleep(this.#delay(attempt, err), opts.signal);
      }
    }
  }

  #url(template: string, path?: Record<string, string | number>, query?: Record<string, unknown>): string {
    const p = template.replace(/\{(\w+)\}/g, (_, name: string) => {
      const v = path?.[name];
      if (v === undefined) throw new Error(`seal0: missing path parameter ${name}`);
      return encodeURIComponent(String(v));
    });
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
    }
    const qs = q.toString();
    return this.#baseURL + p + (qs ? `?${qs}` : "");
  }

  async #send<O extends OperationId>(method: Method, url: string, body: string | undefined, key: string | undefined,
    signal: AbortSignal | undefined): Promise<{ status: number; data: Success<O> }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      Accept: "application/json",
      "User-Agent": `seal0-ts/${VERSION}`,
      "X-Seal0-SDK": `seal0-ts/${VERSION}`,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (key !== undefined) headers["Idempotency-Key"] = key;

    const attemptSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(this.#timeoutMs)])
      : AbortSignal.timeout(this.#timeoutMs);
    let res: Response;
    let text: string;
    try {
      const init: RequestInit = { method: method.toUpperCase(), headers, signal: attemptSignal };
      if (body !== undefined) init.body = body;
      res = await this.#fetch(url, init);
      text = await res.text();
    } catch (err) {
      if (signal?.aborted) throw signal.reason ?? err; // the caller cancelled: never retried
      throw new NetworkError(`seal0: request failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    if (res.ok) {
      return { status: res.status, data: (text ? JSON.parse(text) : undefined) as Success<O> };
    }
    throw decodeError(res, text);
  }

  #delay(attempt: number, err: unknown): number {
    const after = (err as { [retryAfterMs]?: number } | null)?.[retryAfterMs];
    if (after !== undefined && after > 0) return Math.min(after, 30_000);
    const ceiling = Math.min(this.#backoffMs * 2 ** attempt, 5_000);
    return Math.random() * ceiling;
  }
}

function decodeError(res: Response, text: string): Seal0Error {
  let err: Seal0Error;
  const headerId = res.headers.get("X-Request-Id") ?? undefined;
  try {
    const env = JSON.parse(text) as { error?: { code?: string; message?: string; field?: string | null; request_id?: string } };
    if (!env.error?.code) throw new Error("not an error envelope");
    err = new Seal0Error({
      status: res.status, code: env.error.code, message: env.error.message ?? "",
      field: env.error.field ?? undefined, requestId: env.error.request_id ?? headerId,
    });
  } catch {
    err = new Seal0Error({ status: res.status, code: `http_${res.status}`, message: res.statusText, requestId: headerId });
  }
  const seconds = Number(res.headers.get("Retry-After"));
  if (Number.isFinite(seconds) && seconds > 0) {
    Object.defineProperty(err, retryAfterMs, { value: seconds * 1000, enumerable: false });
  }
  return err;
}

/**
 * Every request the SDK sends is safe to repeat: reads and evaluation are
 * read-only, and mutations carry an idempotency key.
 */
function retryable(err: unknown): boolean {
  if (err instanceof NetworkError) return true;
  if (!(err instanceof Seal0Error)) return false;
  // usage_limit_exceeded lasts until the usage period resets (ADR-0029).
  if (err.status === 429) return err.code !== "usage_limit_exceeded";
  if ([502, 503, 504].includes(err.status)) return true;
  return err.status === 409 && err.code === "idempotency_in_progress";
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function* paginate<T>(fetchPage: (page: ListOptions) => Promise<{ data: T[]; next_cursor: string | null }>): AsyncGenerator<T> {
  let page: ListOptions = { limit: 200 };
  for (;;) {
    const res = await fetchPage(page);
    yield* res.data;
    if (!res.next_cursor) return;
    page = { limit: 200, cursor: res.next_cursor };
  }
}

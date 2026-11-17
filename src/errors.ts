/** Error codes callers commonly handle. Any other code is still on Seal0Error.code. */
export const ErrorCode = {
  InvalidApiKey: "invalid_api_key",
  InsufficientScope: "insufficient_scope",
  CustomerNotFound: "customer_not_found",
  FeatureNotFound: "feature_not_found",
  PlanNotFound: "plan_not_found",
  PlanVersionNotFound: "plan_version_not_found",
  DraftNotFound: "draft_not_found",
  SubscriptionNotFound: "subscription_not_found",
  OverrideNotFound: "override_not_found",
  FeatureKeyTaken: "feature_key_taken",
  PlanKeyTaken: "plan_key_taken",
  OverrideOverlap: "override_overlap",
  NoDraft: "no_draft",
  SubscriptionReplaced: "subscription_not_current",
  InvalidSubscription: "invalid_subscription_state",
  IdempotencyKeyReused: "idempotency_key_reused",
  FeatureNotMetered: "feature_not_metered",
  /** The Account is over its Seal0 evaluation limit (429); never retried. */
  UsageLimitExceeded: "usage_limit_exceeded",
} as const;

/**
 * A non-2xx response from the API, decoded from the error envelope.
 *
 * Unknown customers and feature keys are errors, while a missing entitlement
 * is a normal result with granted=false. Treat any error as "not granted"
 * (fail closed) unless you have a reason not to.
 */
export class Seal0Error extends Error {
  override readonly name = "Seal0Error";
  readonly status: number;
  readonly code: string;
  readonly field: string | undefined;
  readonly requestId: string | undefined;

  constructor(init: { status: number; code: string; message: string; field?: string | undefined; requestId?: string | undefined }) {
    super(`seal0: ${init.status} ${init.code}: ${init.message}${init.field ? ` (field ${init.field})` : ""}`);
    this.status = init.status;
    this.code = init.code;
    this.field = init.field;
    this.requestId = init.requestId;
  }
}

/** Reports whether err is a Seal0Error, optionally with a specific code. */
export function isSeal0Error(err: unknown, code?: string): err is Seal0Error {
  return err instanceof Seal0Error && (code === undefined || err.code === code);
}

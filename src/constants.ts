// Known values of string fields (x-known-values in the API contract). The API
// may add values later, so fields stay typed as string and callers must
// handle unknown values. A test checks these against api/bundled/openapi.sdk.yaml.

export const SubscriptionStatus = {
  Trialing: "trialing",
  Active: "active",
  PastDue: "past_due",
  Paused: "paused",
  Canceled: "canceled",
  Expired: "expired",
} as const;

export const FeatureType = {
  Boolean: "boolean",
  Number: "number",
  Enum: "enum",
  /** A limit per usage period (ADR-0029). */
  Metered: "metered",
} as const;

/** Where an entitlement's value came from (Entitlement.source). */
export const EntitlementSource = {
  Override: "override",
  Plan: "plan",
  Default: "default",
  None: "none",
} as const;

/** PlanVersion.status and PlanVersionSummary.status. */
export const PlanVersionStatus = {
  Draft: "draft",
  Published: "published",
} as const;

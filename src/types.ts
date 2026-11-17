// Public names for the contract's schemas (generated in types.gen.ts from
// api/bundled/openapi.sdk.yaml; ADR-0023).
import type { components } from "./types.gen.js";

type S = components["schemas"];

export type AssignSubscriptionRequest = S["AssignSubscriptionRequest"];
export type ChangePlanVersionRequest = S["ChangePlanVersionRequest"];
export type CreateFeatureRequest = S["CreateFeatureRequest"];
export type CreateOverrideRequest = S["CreateOverrideRequest"];
export type CreatePlanRequest = S["CreatePlanRequest"];
export type Customer = S["Customer"];
export type Entitlement = S["Entitlement"];
export type ErrorBody = S["ErrorBody"];
export type EvaluateAllRequest = S["EvaluateAllRequest"];
export type EvaluateRequest = S["EvaluateRequest"];
export type Evaluation = S["Evaluation"];
export type EvaluationAll = S["EvaluationAll"];
export type ExternalCustomerId = S["ExternalCustomerId"];
export type Feature = S["Feature"];
export type FeatureList = S["FeatureList"];
export type FeatureType = S["FeatureType"];
/** A feature value: boolean, whole number (0..2^53-1), "unlimited" or an enum option. */
export type FeatureValue = S["FeatureValue"];
export type Key = S["Key"];
export type Override = S["Override"];
export type OverrideList = S["OverrideList"];
export type Plan = S["Plan"];
export type PlanList = S["PlanList"];
export type PlanRef = S["PlanRef"];
export type PlanSelector = S["PlanSelector"];
export type PlanVersion = S["PlanVersion"];
export type PlanVersionList = S["PlanVersionList"];
export type PlanVersionSummary = S["PlanVersionSummary"];
export type PutDraftRequest = S["PutDraftRequest"];
export type RecordedUsage = S["RecordedUsage"];
export type RecordUsageRequest = S["RecordUsageRequest"];
export type Subscription = S["Subscription"];
export type SubscriptionContext = S["SubscriptionContext"];
export type SubscriptionStatus = S["SubscriptionStatus"];
export type Timestamp = S["Timestamp"];
/** PATCH body: omit a field to leave it unchanged, set it to null to clear it. */
export type UpdateFeatureRequest = S["UpdateFeatureRequest"];
/** PATCH body: omit a field to leave it unchanged, set it to null to clear it. */
export type UpdateSubscriptionRequest = S["UpdateSubscriptionRequest"];
/** A metered entitlement's usage in the current period (Entitlement.usage). */
export type Usage = S["Usage"];

// Compile-time completeness check: a schema added to the contract must get
// an alias above, or this line fails to type-check.
type Aliased =
  | "AssignSubscriptionRequest" | "ChangePlanVersionRequest" | "CreateFeatureRequest" | "CreateOverrideRequest"
  | "CreatePlanRequest" | "Customer" | "Entitlement" | "ErrorBody" | "EvaluateAllRequest" | "EvaluateRequest"
  | "Evaluation" | "EvaluationAll" | "ExternalCustomerId" | "Feature" | "FeatureList" | "FeatureType"
  | "FeatureValue" | "Key" | "Override" | "OverrideList" | "Plan" | "PlanList" | "PlanRef" | "PlanSelector"
  | "PlanVersion" | "PlanVersionList" | "PlanVersionSummary" | "PutDraftRequest" | "RecordedUsage"
  | "RecordUsageRequest" | "Subscription" | "SubscriptionContext" | "SubscriptionStatus" | "Timestamp"
  | "UpdateFeatureRequest" | "UpdateSubscriptionRequest" | "Usage";
type Unaliased = Exclude<keyof S, Aliased>;
export const _everySchemaAliased: [Unaliased] extends [never] ? true : Unaliased = true;

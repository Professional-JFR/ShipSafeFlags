import { createHash } from "node:crypto";
import { EvalContext, FlagConfig } from "./types.js";

export type MatchedRule = "deny" | "allow" | "rollout" | "none";

export interface EvaluationResult {
  enabled: boolean;
  reason: string;
  ruleMatches: string[];
  matchedRule: MatchedRule;
  identifierType: "userId" | "email" | "anonymousId" | null;
  /** Identifier used for bucketing, masked for logging when it is an email. */
  identifier: string | null;
}

function stableBucket(flagKey: string, environment: string, userId: string, salt: string): number {
  const hash = createHash("sha256").update(`${flagKey}:${environment}:${salt}:${userId}`).digest("hex");
  return parseInt(hash.slice(0, 8), 16) % 100;
}

export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

/** Stable bucketing key: userId, then email (case-insensitive), then anonymousId. */
export function resolveIdentifier(context: EvalContext): { type: "userId" | "email" | "anonymousId"; value: string } | null {
  if (context.userId) return { type: "userId", value: context.userId };
  const email = context.email?.trim().toLowerCase();
  if (email) return { type: "email", value: email };
  if (context.anonymousId) return { type: "anonymousId", value: context.anonymousId };
  return null;
}

/**
 * Evaluation flow and precedence:
 *  1. killSwitch / environment disabled (`enabled=false`) => off
 *  2. deny rules (userId, email, emailDomain)            => off (hard off)
 *  3. allow rules (userId, email, emailDomain)           => on  (hard on, environment still respected)
 *  4. attribute rules (all must match)
 *  5. percentage rollout (deterministic bucket; missing => 100%)
 * Legacy configs without the optional email/domain lists or rollout behave as empty lists / 100%.
 */
export function evaluateFlag(config: FlagConfig, flagKey: string, environment: string, context: EvalContext): EvaluationResult {
  const matches: string[] = [];
  const id = resolveIdentifier(context);
  const email = context.email?.trim().toLowerCase() ?? "";
  const domain = email.includes("@") ? email.slice(email.lastIndexOf("@") + 1) : "";
  const meta = {
    identifierType: id?.type ?? null,
    identifier: id ? (id.type === "email" ? maskEmail(id.value) : id.value) : null
  };
  const done = (enabled: boolean, reason: string, matchedRule: MatchedRule, ruleMatches = matches): EvaluationResult => ({
    enabled,
    reason,
    ruleMatches,
    matchedRule,
    ...meta
  });

  if (config.killSwitch) return done(false, "kill_switch", "none");
  if (!config.enabled) return done(false, "environment_disabled", "none");

  const userId = context.userId ?? "";
  const rolloutPct = config.percentageRollout ?? 100;
  const targets = (users: string[] | undefined, emails: string[] | undefined, domains: string[] | undefined): string | null => {
    if (userId && users?.includes(userId)) return "userId";
    if (email && emails?.includes(email)) return "email";
    if (domain && domains?.includes(domain)) return "emailDomain";
    return null;
  };

  const denied = targets(config.denylist, config.denyEmails, config.denyEmailDomains);
  if (denied) return done(false, "denylist", "deny", [`denylist:${denied}`]);
  const allowed = targets(config.allowlist, config.allowEmails, config.allowEmailDomains);
  if (allowed) return done(true, "allowlist", "allow", [`allowlist:${allowed}`]);

  const attrs = context.attributes ?? {};
  for (const rule of config.attributeRules ?? []) {
    const value = attrs[rule.attribute];
    if (rule.operator === "equals") {
      if (value !== rule.value) return done(false, `attribute_miss:${rule.attribute}`, "none");
      matches.push(`attribute_equals:${rule.attribute}`);
    }
    if (rule.operator === "in") {
      if (!rule.values?.includes(value as never)) return done(false, `attribute_miss:${rule.attribute}`, "none");
      matches.push(`attribute_in:${rule.attribute}`);
    }
  }

  if (rolloutPct < 100) {
    if (!id) return done(false, "missing_user_id_for_percentage", "rollout");
    const bucket = stableBucket(flagKey, environment, id.value, config.salt);
    const hit = bucket < rolloutPct;
    return done(hit, hit ? "percentage_rollout_match" : "percentage_rollout_miss", "rollout", [...matches, `bucket:${bucket}`]);
  }

  return done(true, matches.length ? "target_rules_match" : "enabled", "none");
}

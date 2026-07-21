import { createHash } from "node:crypto";
import { EvalContext, FlagConfig } from "./types.js";

export interface EvaluationResult {
  enabled: boolean;
  reason: string;
  ruleMatches: string[];
}

function stableBucket(flagKey: string, environment: string, userId: string, salt: string): number {
  const hash = createHash("sha256").update(`${flagKey}:${environment}:${salt}:${userId}`).digest("hex");
  return parseInt(hash.slice(0, 8), 16) % 100;
}

export function evaluateFlag(config: FlagConfig, flagKey: string, environment: string, context: EvalContext): EvaluationResult {
  const matches: string[] = [];
  if (config.killSwitch) return { enabled: false, reason: "kill_switch", ruleMatches: matches };
  if (!config.enabled) return { enabled: false, reason: "environment_disabled", ruleMatches: matches };

  const userId = context.userId ?? "";
  if (userId && config.denylist.includes(userId)) return { enabled: false, reason: "denylist", ruleMatches: ["denylist"] };
  if (userId && config.allowlist.includes(userId)) return { enabled: true, reason: "allowlist", ruleMatches: ["allowlist"] };

  const attrs = context.attributes ?? {};
  for (const rule of config.attributeRules) {
    const value = attrs[rule.attribute];
    if (rule.operator === "equals") {
      if (value !== rule.value) return { enabled: false, reason: `attribute_miss:${rule.attribute}`, ruleMatches: matches };
      matches.push(`attribute_equals:${rule.attribute}`);
    }
    if (rule.operator === "in") {
      if (!rule.values?.includes(value as never)) return { enabled: false, reason: `attribute_miss:${rule.attribute}`, ruleMatches: matches };
      matches.push(`attribute_in:${rule.attribute}`);
    }
  }

  if (config.percentageRollout < 100) {
    if (!userId) return { enabled: false, reason: "missing_user_id_for_percentage", ruleMatches: matches };
    const bucket = stableBucket(flagKey, environment, userId, config.salt);
    if (bucket >= config.percentageRollout) return { enabled: false, reason: "percentage_rollout_miss", ruleMatches: [...matches, `bucket:${bucket}`] };
    return { enabled: true, reason: "percentage_rollout_match", ruleMatches: [...matches, `bucket:${bucket}`] };
  }

  return { enabled: true, reason: matches.length ? "target_rules_match" : "enabled", ruleMatches: matches };
}

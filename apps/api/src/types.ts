export const environments = ["dev", "staging", "prod"] as const;
export type Environment = (typeof environments)[number];
export const roles = ["admin", "developer", "viewer"] as const;
export type Role = (typeof roles)[number];

export type RuleOperator = "equals" | "in";

export interface AttributeRule {
  attribute: string;
  operator: RuleOperator;
  value?: string | number | boolean;
  values?: Array<string | number | boolean>;
}

export interface FlagConfig {
  enabled: boolean;
  killSwitch: boolean;
  allowlist: string[];
  denylist: string[];
  attributeRules: AttributeRule[];
  percentageRollout: number;
  salt: string;
  // Optional for backward compatibility with records created before targeting v1.
  allowEmails?: string[];
  denyEmails?: string[];
  allowEmailDomains?: string[];
  denyEmailDomains?: string[];
}

export interface FlagEnvironmentState {
  environment: Environment;
  version: number;
  updatedAt: string;
  updatedBy: string;
  config: FlagConfig;
}

export interface FlagRecord {
  key: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  environments: Record<Environment, FlagEnvironmentState>;
}

export interface AuditRecord {
  id: number;
  flagKey: string;
  environment: Environment;
  version: number;
  actor: string;
  action: "create" | "update";
  reason: string;
  beforeConfig: FlagConfig | null;
  afterConfig: FlagConfig;
  createdAt: string;
}

export interface EvalContext {
  userId?: string;
  email?: string;
  anonymousId?: string;
  attributes?: Record<string, string | number | boolean | Array<string | number | boolean>>;
}

import { z } from "zod";
import { environments, roles } from "./types.js";

const attributeRuleSchema = z
  .object({
    attribute: z.string().min(1),
    operator: z.enum(["equals", "in"]),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
    values: z.array(z.union([z.string(), z.number(), z.boolean()])).optional()
  })
  .superRefine((rule, ctx) => {
    if (rule.operator === "equals" && rule.value === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "equals requires value" });
    }
    if (rule.operator === "in" && (!rule.values || rule.values.length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "in requires values" });
    }
  });

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[^\s@]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, "must be a valid email address");
const emailDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, "must be a valid email domain (e.g. example.com)");

const overlap = (a: string[], b: string[]) => a.filter((x) => b.includes(x));

export const configSchema = z
  .object({
    enabled: z.boolean(),
    killSwitch: z.boolean(),
    allowlist: z.array(z.string()).default([]),
    denylist: z.array(z.string()).default([]),
    attributeRules: z.array(attributeRuleSchema).default([]),
    percentageRollout: z
      .number("percentageRollout must be a number")
      .int("percentageRollout must be an integer")
      .min(0, "percentageRollout must be between 0 and 100")
      .max(100, "percentageRollout must be between 0 and 100")
      .default(100),
    salt: z.string().min(1),
    allowEmails: z.array(emailSchema).default([]),
    denyEmails: z.array(emailSchema).default([]),
    allowEmailDomains: z.array(emailDomainSchema).default([]),
    denyEmailDomains: z.array(emailDomainSchema).default([])
  })
  .superRefine((config, ctx) => {
    const pairs: Array<[string, string[], string[]]> = [
      ["allowlist/denylist userIds", config.allowlist, config.denylist],
      ["allowEmails/denyEmails", config.allowEmails, config.denyEmails],
      ["allowEmailDomains/denyEmailDomains", config.allowEmailDomains, config.denyEmailDomains]
    ];
    for (const [label, allow, deny] of pairs) {
      const both = overlap(allow, deny);
      if (both.length) ctx.addIssue({ code: "custom", message: `Entries cannot be in both allow and deny (${label}): ${both.join(",")}` });
    }
  });

export const createFlagSchema = z.object({
  key: z.string().min(2).regex(/^[a-z0-9-]+$/),
  name: z.string().min(2),
  description: z.string().default(""),
  actor: z.string().min(1),
  environments: z
    .object({
      dev: configSchema.optional(),
      staging: configSchema.optional(),
      prod: configSchema.optional()
    })
    .default({})
});

export const updateEnvironmentSchema = z.object({
  actor: z.string().min(1),
  reason: z.string().min(1).default("configuration update"),
  expectedVersion: z.number().int().positive(),
  config: configSchema
});

export const evaluateSchema = z.object({
  flagKey: z.string().min(1),
  environment: z.enum(environments),
  context: z
    .object({
      userId: z.string().optional(),
      email: z.string().optional(),
      anonymousId: z.string().optional(),
      attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number(), z.boolean()]))])).default({})
    })
    .default({ attributes: {} })
});

export const authHeaderSchema = z.object({
  role: z.enum(roles).default("viewer"),
  user: z.string().min(1).default("system")
});

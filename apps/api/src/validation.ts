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

export const configSchema = z
  .object({
    enabled: z.boolean(),
    killSwitch: z.boolean(),
    allowlist: z.array(z.string()).default([]),
    denylist: z.array(z.string()).default([]),
    attributeRules: z.array(attributeRuleSchema).default([]),
    percentageRollout: z.number().int().min(0).max(100),
    salt: z.string().min(1)
  })
  .superRefine((config, ctx) => {
    const overlap = config.allowlist.filter((u) => config.denylist.includes(u));
    if (overlap.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Users cannot be in both allowlist and denylist: ${overlap.join(",")}` });
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
      attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number(), z.boolean()]))])).default({})
    })
    .default({ attributes: {} })
});

export const authHeaderSchema = z.object({
  role: z.enum(roles).default("viewer"),
  user: z.string().min(1).default("system")
});

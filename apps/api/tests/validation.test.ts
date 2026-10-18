import { describe, expect, it } from "vitest";
import { configSchema, createFlagSchema, evaluateSchema, updateEnvironmentSchema } from "../src/validation.js";

const valid = { enabled: true, killSwitch: false, salt: "s" };

describe("configSchema", () => {
  it("applies defaults", () => {
    const parsed = configSchema.parse(valid);
    expect(parsed.percentageRollout).toBe(100);
    expect(parsed.allowlist).toEqual([]);
  });

  it.each([-1, 101, 12.5])("rejects rollout %s", (percentageRollout) => {
    expect(configSchema.safeParse({ ...valid, percentageRollout }).success).toBe(false);
  });

  it("rejects entries in both allow and deny lists", () => {
    expect(configSchema.safeParse({ ...valid, allowlist: ["u"], denylist: ["u"] }).success).toBe(false);
    expect(configSchema.safeParse({ ...valid, allowEmails: ["A@x.com"], denyEmails: ["a@x.com"] }).success).toBe(false);
  });

  it("rejects malformed emails and domains, normalizes case", () => {
    expect(configSchema.safeParse({ ...valid, allowEmails: ["nope"] }).success).toBe(false);
    expect(configSchema.safeParse({ ...valid, denyEmailDomains: ["localhost"] }).success).toBe(false);
    expect(configSchema.parse({ ...valid, allowEmailDomains: ["Example.COM"] }).allowEmailDomains).toEqual(["example.com"]);
  });

  it("requires operands for attribute rules", () => {
    expect(configSchema.safeParse({ ...valid, attributeRules: [{ attribute: "a", operator: "equals" }] }).success).toBe(false);
    expect(configSchema.safeParse({ ...valid, attributeRules: [{ attribute: "a", operator: "in", values: [] }] }).success).toBe(false);
  });
});

describe("request schemas", () => {
  it("rejects invalid flag keys", () => {
    expect(createFlagSchema.safeParse({ key: "Bad Key", name: "Name", actor: "a" }).success).toBe(false);
  });

  it("requires a positive expectedVersion", () => {
    expect(updateEnvironmentSchema.safeParse({ actor: "a", expectedVersion: 0, config: valid }).success).toBe(false);
  });

  it("rejects unknown environments on evaluate", () => {
    expect(evaluateSchema.safeParse({ flagKey: "f", environment: "qa" }).success).toBe(false);
  });
});

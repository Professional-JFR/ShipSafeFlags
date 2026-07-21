import { describe, expect, it } from "vitest";
import { evaluateFlag } from "../src/evaluator.js";

const base = {
  enabled: true,
  killSwitch: false,
  allowlist: [],
  denylist: [],
  attributeRules: [],
  percentageRollout: 100,
  salt: "test"
};

describe("evaluateFlag", () => {
  it("applies denylist before allowlist", () => {
    const result = evaluateFlag({ ...base, allowlist: ["u1"], denylist: ["u1"] }, "flag", "prod", { userId: "u1" });
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe("denylist");
  });

  it("is deterministic for percentage rollout", () => {
    const cfg = { ...base, percentageRollout: 25 };
    const a = evaluateFlag(cfg, "flag-a", "prod", { userId: "user-42" });
    const b = evaluateFlag(cfg, "flag-a", "prod", { userId: "user-42" });
    expect(a.enabled).toBe(b.enabled);
    expect(a.reason).toBe(b.reason);
  });

  it("requires attributes rules to match", () => {
    const cfg = {
      ...base,
      attributeRules: [{ attribute: "country", operator: "in" as const, values: ["US", "CA"] }]
    };
    const miss = evaluateFlag(cfg, "flag", "prod", { userId: "u2", attributes: { country: "FR" } });
    const hit = evaluateFlag(cfg, "flag", "prod", { userId: "u2", attributes: { country: "US" } });
    expect(miss.enabled).toBe(false);
    expect(hit.enabled).toBe(true);
  });
});

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

  const users = Array.from({ length: 1000 }, (_, i) => `user-${i}`);
  const countOn = (pct: number) => users.filter((u) => evaluateFlag({ ...base, percentageRollout: pct }, "flag", "prod", { userId: u }).enabled).length;

  it("honors rollout boundaries 0, 1, 50, 100", () => {
    expect(countOn(0)).toBe(0);
    expect(countOn(100)).toBe(1000);
    const one = countOn(1);
    expect(one).toBeGreaterThan(0);
    expect(one).toBeLessThan(40);
    const half = countOn(50);
    expect(half).toBeGreaterThan(400);
    expect(half).toBeLessThan(600);
  });

  it("buckets consistently and falls back userId -> email -> anonymousId", () => {
    const cfg = { ...base, percentageRollout: 50 };
    const byUser = evaluateFlag(cfg, "f", "prod", { userId: "u9", email: "a@b.com", anonymousId: "x" });
    expect(byUser.identifierType).toBe("userId");
    const byEmail = evaluateFlag(cfg, "f", "prod", { email: "A@B.com", anonymousId: "x" });
    expect(byEmail.identifierType).toBe("email");
    expect(byEmail.identifier).toBe("a***@b.com");
    expect(evaluateFlag(cfg, "f", "prod", { email: "a@b.com" }).enabled).toBe(byEmail.enabled);
    expect(evaluateFlag(cfg, "f", "prod", { anonymousId: "x" }).identifierType).toBe("anonymousId");
  });

  it("is disabled without identifier unless rollout is 100", () => {
    expect(evaluateFlag({ ...base, percentageRollout: 99 }, "f", "prod", {}).enabled).toBe(false);
    expect(evaluateFlag({ ...base, percentageRollout: 100 }, "f", "prod", {}).enabled).toBe(true);
  });

  it("is disabled when environment config is disabled", () => {
    const r = evaluateFlag({ ...base, enabled: false }, "f", "staging", { userId: "u1" });
    expect(r.enabled).toBe(false);
    expect(r.reason).toBe("environment_disabled");
  });

  it("deny overrides allow across userId, email and domain", () => {
    const cfg = { ...base, allowEmailDomains: ["acme.com"], denyEmails: ["bad@acme.com"] };
    const r = evaluateFlag(cfg, "f", "prod", { email: "bad@acme.com" });
    expect(r.enabled).toBe(false);
    expect(r.matchedRule).toBe("deny");
    const d = evaluateFlag({ ...base, allowlist: ["u1"], denyEmailDomains: ["evil.com"] }, "f", "prod", { userId: "u1", email: "x@evil.com" });
    expect(d.enabled).toBe(false);
  });

  it("allow overrides rollout but still respects environment", () => {
    const cfg = { ...base, percentageRollout: 0, allowEmailDomains: ["acme.com"] };
    const r = evaluateFlag(cfg, "f", "prod", { email: "Jane@Acme.com" });
    expect(r.enabled).toBe(true);
    expect(r.matchedRule).toBe("allow");
    expect(evaluateFlag({ ...cfg, enabled: false }, "f", "prod", { email: "jane@acme.com" }).enabled).toBe(false);
  });

  it("treats legacy configs without new fields as 100% rollout with no email rules", () => {
    const legacy = { enabled: true, killSwitch: false, allowlist: [], denylist: [], attributeRules: [], salt: "s" } as any;
    const r = evaluateFlag(legacy, "f", "prod", { email: "a@b.com" });
    expect(r.enabled).toBe(true);
  });
});

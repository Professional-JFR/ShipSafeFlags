import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { MemoryRepository } from "../src/repository.js";

describe("admin and evaluation APIs", () => {
  it("creates, updates, audits, and evaluates a flag", async () => {
    const app = createApp({ repository: new MemoryRepository() });

    const createRes = await request(app)
      .post("/api/admin/flags")
      .set("x-role", "developer")
      .send({
        key: "new-checkout",
        name: "New Checkout",
        description: "roll out checkout",
        actor: "alice",
        environments: {
          prod: {
            enabled: true,
            killSwitch: false,
            allowlist: ["user_123"],
            denylist: [],
            attributeRules: [{ attribute: "country", operator: "in", values: ["US", "CA"] }],
            percentageRollout: 20,
            salt: "new-checkout-prod"
          }
        }
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.key).toBe("new-checkout");

    const updateRes = await request(app)
      .put("/api/admin/flags/new-checkout/environments/prod")
      .set("x-role", "admin")
      .send({
        actor: "bob",
        reason: "increase rollout",
        expectedVersion: 1,
        config: {
          enabled: true,
          killSwitch: false,
          allowlist: ["user_123"],
          denylist: [],
          attributeRules: [{ attribute: "country", operator: "in", values: ["US", "CA"] }],
          percentageRollout: 40,
          salt: "new-checkout-prod"
        }
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.version).toBe(2);

    const evalRes = await request(app)
      .post("/api/evaluate")
      .send({
        flagKey: "new-checkout",
        environment: "prod",
        context: { userId: "user_123", attributes: { country: "US" } }
      });

    expect(evalRes.status).toBe(200);
    expect(evalRes.body.enabled).toBe(true);

    const auditRes = await request(app).get("/api/admin/flags/new-checkout/audit");
    expect(auditRes.status).toBe(200);
    expect(auditRes.body[0].version).toBe(2);
  });

  it("returns 409 on optimistic concurrency conflict", async () => {
    const app = createApp({ repository: new MemoryRepository() });
    await request(app)
      .post("/api/admin/flags")
      .set("x-role", "developer")
      .send({
        key: "search-v2",
        name: "Search v2",
        description: "",
        actor: "alice"
      });

    const conflict = await request(app)
      .put("/api/admin/flags/search-v2/environments/dev")
      .set("x-role", "developer")
      .send({
        actor: "alice",
        reason: "stale editor",
        expectedVersion: 999,
        config: {
          enabled: true,
          killSwitch: false,
          allowlist: [],
          denylist: [],
          attributeRules: [],
          percentageRollout: 100,
          salt: "search-v2-dev"
        }
      });

    expect(conflict.status).toBe(409);
  });

  const validConfig = {
    enabled: true,
    killSwitch: false,
    allowlist: [],
    denylist: [],
    attributeRules: [],
    percentageRollout: 50,
    salt: "s"
  };

  it("rejects malformed rollout, email and domain inputs with clear errors", async () => {
    const app = createApp({ repository: new MemoryRepository() });
    const post = (config: object) =>
      request(app)
        .post("/api/admin/flags")
        .set("x-role", "developer")
        .send({ key: "bad-input", name: "Bad", actor: "a", environments: { dev: config } });

    const rollout = await post({ ...validConfig, percentageRollout: 101 });
    expect(rollout.status).toBe(400);
    expect(rollout.body.error).toBe("validation_error");
    expect(JSON.stringify(rollout.body.details)).toContain("between 0 and 100");

    const email = await post({ ...validConfig, allowEmails: ["not-an-email"] });
    expect(email.status).toBe(400);
    expect(JSON.stringify(email.body.details)).toContain("valid email");

    const domain = await post({ ...validConfig, denyEmailDomains: ["bad domain"] });
    expect(domain.status).toBe(400);

    const env = await request(app)
      .put("/api/admin/flags/x/environments/qa")
      .set("x-role", "developer")
      .send({});
    expect(env.status).toBe(400);
    expect(env.body.error).toBe("invalid_environment");

    const evalEnv = await request(app).post("/api/evaluate").send({ flagKey: "x", environment: "qa" });
    expect(evalEnv.status).toBe(400);
    expect(evalEnv.body.error).toBe("validation_error");
  });

  it("evaluates with email targeting, logs structured masked entries", async () => {
    const logs: Record<string, unknown>[] = [];
    const app = createApp({ repository: new MemoryRepository(), evaluationLogger: (e) => logs.push(e) });
    const created = await request(app)
      .post("/api/admin/flags")
      .set("x-role", "developer")
      .send({
        key: "email-flag",
        name: "Email",
        actor: "a",
        environments: { dev: { ...validConfig, percentageRollout: 0, allowEmailDomains: ["Acme.com"] } }
      });
    expect(created.status).toBe(201);
    expect(created.body.environments.dev.config.allowEmailDomains).toEqual(["acme.com"]);

    const res = await request(app)
      .post("/api/evaluate")
      .send({ flagKey: "email-flag", environment: "dev", context: { email: "jane@acme.com" } });
    expect(res.body.enabled).toBe(true);
    expect(res.body.matchedRule).toBe("allow");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ flagKey: "email-flag", environment: "dev", identifier: "j***@acme.com", matchedRule: "allow", decision: true });
    expect(typeof logs[0].timestamp).toBe("string");
    expect(JSON.stringify(logs[0])).not.toContain("jane@acme.com");

    const miss = await request(app)
      .post("/api/evaluate")
      .send({ flagKey: "email-flag", environment: "prod", context: { email: "jane@acme.com" } });
    expect(miss.body.enabled).toBe(false);
  });

  it("accepts legacy payloads without rollout or new fields", async () => {
    const app = createApp({ repository: new MemoryRepository(), evaluationLogger: () => {} });
    const { percentageRollout: _p, ...legacy } = validConfig;
    const created = await request(app)
      .post("/api/admin/flags")
      .set("x-role", "developer")
      .send({ key: "legacy", name: "Legacy", actor: "a", environments: { dev: legacy } });
    expect(created.status).toBe(201);
    const res = await request(app).post("/api/evaluate").send({ flagKey: "legacy", environment: "dev" });
    expect(res.body.enabled).toBe(true);
  });
});

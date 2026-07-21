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
});

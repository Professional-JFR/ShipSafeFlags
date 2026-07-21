import cors from "cors";
import express from "express";
import { evaluateFlag } from "./evaluator.js";
import { Repository } from "./repository.js";
import { authHeaderSchema, createFlagSchema, evaluateSchema, updateEnvironmentSchema } from "./validation.js";
import { Environment, environments } from "./types.js";
import { FlagCache } from "./cache.js";

interface AppDeps {
  repository: Repository;
  cache?: FlagCache;
}

export function createApp({ repository, cache = new FlagCache() }: AppDeps) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const clients = new Set<express.Response>();
  const broadcast = (event: string, payload: unknown) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of clients) client.write(msg);
  };

  const readRole = (req: express.Request) =>
    authHeaderSchema.parse({
      role: req.header("x-role") ?? "viewer",
      user: req.header("x-user") ?? "system"
    });

  app.get("/health", (_, res) => res.json({ ok: true }));

  app.get("/api/admin/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write(`event: connected\ndata: {}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
  });

  app.get("/api/admin/flags", async (_req, res) => {
    const flags = await repository.listFlags();
    res.json(flags);
  });

  app.post("/api/admin/flags", async (req, res) => {
    try {
      const auth = readRole(req);
      if (auth.role === "viewer") return res.status(403).json({ error: "insufficient_role" });
      const input = createFlagSchema.parse(req.body);
      const created = await repository.createFlag({
        key: input.key,
        name: input.name,
        description: input.description,
        actor: input.actor,
        envConfigs: input.environments
      });
      cache.invalidate(input.key);
      broadcast("flag_changed", { flagKey: input.key, action: "create" });
      res.status(201).json(created);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/admin/flags/:key", async (req, res) => {
    const flag = await repository.getFlag(req.params.key);
    if (!flag) return res.status(404).json({ error: "not_found" });
    res.json(flag);
  });

  app.put("/api/admin/flags/:key/environments/:environment", async (req, res) => {
    try {
      const auth = readRole(req);
      const environment = req.params.environment as Environment;
      if (!environments.includes(environment)) return res.status(400).json({ error: "invalid_environment" });
      if (environment === "prod" && auth.role !== "admin") return res.status(403).json({ error: "prod_requires_admin" });
      if (auth.role === "viewer") return res.status(403).json({ error: "insufficient_role" });
      const input = updateEnvironmentSchema.parse(req.body);
      const updated = await repository.updateFlagEnvironment({ key: req.params.key, environment, ...input });
      cache.invalidate(req.params.key, environment);
      broadcast("flag_changed", { flagKey: req.params.key, environment, version: updated.version, action: "update" });
      res.json(updated);
    } catch (error: any) {
      if (error.message === "not_found") return res.status(404).json({ error: "not_found" });
      if (String(error.message).startsWith("version_conflict")) {
        return res.status(409).json({ error: "version_conflict", currentVersion: Number(String(error.message).split(":")[1]) });
      }
      return res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/admin/flags/:key/audit", async (req, res) => {
    const items = await repository.getAudit(req.params.key);
    res.json(items);
  });

  app.post("/api/evaluate", async (req, res) => {
    try {
      const input = evaluateSchema.parse(req.body);
      const cached = cache.get(input.flagKey, input.environment);
      let environmentState = cached;
      if (!environmentState) {
        const flag = await repository.getFlag(input.flagKey);
        if (!flag) return res.status(404).json({ error: "flag_not_found" });
        environmentState = flag.environments[input.environment];
        cache.set(input.flagKey, input.environment, environmentState);
      }
      const result = evaluateFlag(environmentState.config, input.flagKey, input.environment, input.context as any);
      return res.json({
        flagKey: input.flagKey,
        environment: input.environment,
        enabled: result.enabled,
        reason: result.reason,
        ruleMatches: result.ruleMatches,
        configVersion: environmentState.version,
        evaluatedAt: new Date().toISOString()
      });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  });

  return app;
}

import { Environment, FlagEnvironmentState } from "./types.js";

const TTL_MS = 30_000;

export class FlagCache {
  private cache = new Map<string, { expiresAt: number; data: FlagEnvironmentState }>();

  private key(flagKey: string, env: Environment) {
    return `${flagKey}:${env}`;
  }

  get(flagKey: string, env: Environment): FlagEnvironmentState | null {
    const entry = this.cache.get(this.key(flagKey, env));
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(this.key(flagKey, env));
      return null;
    }
    return entry.data;
  }

  set(flagKey: string, env: Environment, data: FlagEnvironmentState): void {
    this.cache.set(this.key(flagKey, env), { data, expiresAt: Date.now() + TTL_MS });
  }

  invalidate(flagKey: string, env?: Environment): void {
    if (env) {
      this.cache.delete(this.key(flagKey, env));
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${flagKey}:`)) this.cache.delete(key);
    }
  }
}

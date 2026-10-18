import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlagCache } from "../src/cache.js";
import type { FlagEnvironmentState } from "../src/types.js";

const state = (version: number) => ({ version }) as unknown as FlagEnvironmentState;

describe("FlagCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns cached values until the TTL expires", () => {
    const cache = new FlagCache();
    cache.set("f", "prod", state(1));
    expect(cache.get("f", "prod")).toEqual(state(1));
    vi.advanceTimersByTime(30_001);
    expect(cache.get("f", "prod")).toBeNull();
  });

  it("invalidates a single environment", () => {
    const cache = new FlagCache();
    cache.set("f", "dev", state(1));
    cache.set("f", "prod", state(2));
    cache.invalidate("f", "dev");
    expect(cache.get("f", "dev")).toBeNull();
    expect(cache.get("f", "prod")).toEqual(state(2));
  });

  it("invalidates all environments of a flag without touching other flags", () => {
    const cache = new FlagCache();
    cache.set("f", "dev", state(1));
    cache.set("f", "prod", state(2));
    cache.set("g", "dev", state(3));
    cache.invalidate("f");
    expect(cache.get("f", "dev")).toBeNull();
    expect(cache.get("f", "prod")).toBeNull();
    expect(cache.get("g", "dev")).toEqual(state(3));
  });
});

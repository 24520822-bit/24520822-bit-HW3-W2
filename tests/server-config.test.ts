import { afterEach, expect, it, vi } from "vitest";
import { createDefaultService } from "../src/server";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it("uses the five-minute reservation TTL by default", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  const previousSetting = process.env.RESERVATION_TTL_MS;
  delete process.env.RESERVATION_TTL_MS;
  try {
    const service = createDefaultService();
    expect(service.reserve("wireless-earbuds", 1, 0).expiresAt).toBe(301_000);
  } finally {
    if (previousSetting !== undefined) {
      process.env.RESERVATION_TTL_MS = previousSetting;
    }
  }
});

it("accepts a configured reservation TTL from the environment", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  vi.stubEnv("RESERVATION_TTL_MS", "750");
  const service = createDefaultService();

  expect(service.reserve("wireless-earbuds", 1, 0).expiresAt).toBe(1_750);
});

it("rejects an invalid environment TTL rather than silently using the default", () => {
  vi.stubEnv("RESERVATION_TTL_MS", "not-a-number");

  expect(() => createDefaultService()).toThrow(RangeError);
});

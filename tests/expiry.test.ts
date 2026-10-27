import { afterEach, expect, it, vi } from "vitest";
import { createFlashSaleService, DEFAULT_RESERVATION_TTL_MS } from "../src/flash-sale-service";

afterEach(() => {
  vi.useRealTimers();
});

it("uses the default five-minute TTL and calculates an absolute expiry", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  const service = createFlashSaleService();
  const reservation = service.reserve("wireless-earbuds", 1, 0);

  expect(DEFAULT_RESERVATION_TTL_MS).toBe(300_000);
  expect(reservation.expiresAt).toBe(301_000);
});

it("rejects TTL values that cannot be represented by a timer", () => {
  expect(() => createFlashSaleService({ ttlMs: 0 })).toThrow(RangeError);
  expect(() => createFlashSaleService({ ttlMs: 2_147_483_648 })).toThrow(RangeError);
});

it("expires a reservation at its deadline and releases its stock once", () => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  const service = createFlashSaleService({ ttlMs: 1_000 });
  const reservation = service.reserve("wireless-earbuds", 2, 0);

  vi.advanceTimersByTime(999);
  expect(service.getReservation(reservation.id)?.status).toBe("RESERVED");
  vi.advanceTimersByTime(1);

  expect(service.getReservation(reservation.id)?.status).toBe("EXPIRED");
  expect(service.getReservation(reservation.id)?.status).toBe("EXPIRED");
  const [product] = service.getProducts();
  expect(product.available).toBe(8);
  expect(product.reserved).toBe(0);
  expect(product.version).toBe(2);
});

it("sweeps overdue locks before a new reservation even if the timer callback is late", () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const service = createFlashSaleService({ ttlMs: 500 });
  const reservation = service.reserve("wireless-earbuds", 1, 0);
  const [beforeExpiry] = service.getProducts();

  vi.setSystemTime(reservation.expiresAt);
  expect(() => service.reserve("wireless-earbuds", 1, beforeExpiry.version))
    .toThrow(expect.objectContaining({ code: "VERSION_CONFLICT" }));

  const [afterExpiry] = service.getProducts();
  expect(service.getReservation(reservation.id)?.status).toBe("EXPIRED");
  expect(afterExpiry.available).toBe(8);
  expect(afterExpiry.reserved).toBe(0);

  const replacement = service.reserve("wireless-earbuds", 1, afterExpiry.version);
  expect(replacement.status).toBe("RESERVED");
});

import { afterEach, expect, it, vi } from "vitest";
import { hasValidInventory } from "../src/domain";
import { createFlashSaleService } from "../src/flash-sale-service";

afterEach(() => {
  vi.useRealTimers();
});

it("moves an unexpired reservation from reserved to sold and cancels its expiry timer", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  const service = createFlashSaleService({ ttlMs: 10_000 });
  const reservation = service.reserve("wireless-earbuds", 2, 0);

  expect(vi.getTimerCount()).toBe(1);
  const checkedOut = service.checkout(reservation.id);
  const [product] = service.getProducts();

  expect(checkedOut.status).toBe("CHECKED_OUT");
  expect(product.available).toBe(6);
  expect(product.reserved).toBe(0);
  expect(product.sold).toBe(2);
  expect(product.version).toBe(2);
  expect(hasValidInventory(product)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("rejects checkout after expiry without restoring inventory twice", () => {
  vi.useFakeTimers();
  const service = createFlashSaleService({ ttlMs: 100 });
  const reservation = service.reserve("wireless-earbuds", 1, 0);

  vi.advanceTimersByTime(100);
  expect(() => service.checkout(reservation.id))
    .toThrow(expect.objectContaining({ code: "RESERVATION_EXPIRED" }));

  const [product] = service.getProducts();
  expect(product.available).toBe(8);
  expect(product.reserved).toBe(0);
  expect(product.sold).toBe(0);
  expect(product.version).toBe(2);
});

it("rejects repeated checkout of a terminal reservation", () => {
  const service = createFlashSaleService();
  const reservation = service.reserve("wireless-earbuds", 1, 0);

  service.checkout(reservation.id);
  expect(() => service.checkout(reservation.id))
    .toThrow(expect.objectContaining({ code: "RESERVATION_ALREADY_FINALIZED" }));
});

it("sweeps an overdue reservation before checkout when its timer callback is late", () => {
  vi.useFakeTimers();
  vi.setSystemTime(50_000);
  const service = createFlashSaleService({ ttlMs: 100 });
  const reservation = service.reserve("wireless-earbuds", 1, 0);

  vi.setSystemTime(reservation.expiresAt);
  expect(() => service.checkout(reservation.id))
    .toThrow(expect.objectContaining({ code: "RESERVATION_EXPIRED" }));
  expect(service.getReservation(reservation.id)?.status).toBe("EXPIRED");
});

it("rejects checkout for an unknown reservation", () => {
  const service = createFlashSaleService();

  expect(() => service.checkout("missing-reservation"))
    .toThrow(expect.objectContaining({ code: "RESERVATION_NOT_FOUND" }));
});

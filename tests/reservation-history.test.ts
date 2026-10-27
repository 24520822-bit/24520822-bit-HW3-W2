import { expect, it } from "vitest";
import { createSampleProducts, hasValidInventory } from "../src/domain";
import { createFlashSaleService } from "../src/flash-sale-service";

it("bounds terminal reservation history while preserving recent reservations", () => {
  const [sampleProduct] = createSampleProducts();
  const product = { ...sampleProduct, totalStock: 10_001, available: 10_001 };
  const service = createFlashSaleService({ products: [product], ttlMs: 120_000 });
  let version = 0;
  let oldestReservationId = "";
  let newestReservationId = "";

  for (let index = 0; index < 10_001; index += 1) {
    const reservation = service.reserve(product.id, 1, version);
    version += 1;
    service.checkout(reservation.id);
    version += 1;
    if (index === 0) {
      oldestReservationId = reservation.id;
    }
    newestReservationId = reservation.id;
  }

  expect(service.getReservation(oldestReservationId)).toBeUndefined();
  expect(service.getReservation(newestReservationId)?.status).toBe("CHECKED_OUT");
  const [finalProduct] = service.getProducts();
  expect(finalProduct.sold).toBe(10_001);
  expect(finalProduct.available).toBe(0);
  expect(finalProduct.reserved).toBe(0);
  expect(hasValidInventory(finalProduct)).toBe(true);
}, 30_000);

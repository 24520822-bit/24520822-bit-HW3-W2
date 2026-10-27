import { expect, it } from "vitest";
import { createSampleProducts, hasValidInventory } from "../src/domain";
import { createFlashSaleService, FlashSaleError } from "../src/flash-sale-service";

it.each([0, -1, 1.5, Number.NaN])("rejects invalid reservation quantity %s", (quantity) => {
  const service = createFlashSaleService();

  expect(() => service.reserve("wireless-earbuds", quantity, 0))
    .toThrow(expect.objectContaining({ code: "INVALID_QUANTITY" }));
});

it("rejects reservation requests for unknown products", () => {
  const service = createFlashSaleService();

  expect(() => service.reserve("missing-product", 1, 0))
    .toThrow(expect.objectContaining({ code: "PRODUCT_NOT_FOUND" }));
});

it("rejects stale versions and never oversells in a buyer race", async () => {
  const [sampleProduct] = createSampleProducts();
  const product = { ...sampleProduct, totalStock: 1, available: 1 };
  const service = createFlashSaleService({ products: [product] });
  const attempts = await Promise.allSettled(
    Array.from({ length: 20 }, () => Promise.resolve().then(() => service.reserve(product.id, 1, 0)))
  );
  const winners = attempts.filter((attempt) => attempt.status === "fulfilled");
  const losers = attempts.filter((attempt) => attempt.status === "rejected");
  const [resultingProduct] = service.getProducts();

  expect(winners).toHaveLength(1);
  expect(losers).toHaveLength(19);
  expect(losers.every((attempt) => attempt.status === "rejected"
    && attempt.reason instanceof FlashSaleError
    && attempt.reason.code === "VERSION_CONFLICT")).toBe(true);
  expect(resultingProduct.available).toBe(0);
  expect(resultingProduct.reserved).toBe(1);
  expect(hasValidInventory(resultingProduct)).toBe(true);
});

it("rejects reservations larger than available stock", () => {
  const [sampleProduct] = createSampleProducts();
  const product = { ...sampleProduct, totalStock: 1, available: 1 };
  const service = createFlashSaleService({ products: [product] });

  expect(() => service.reserve(product.id, 2, 0))
    .toThrow(expect.objectContaining({ code: "OUT_OF_STOCK" }));
});

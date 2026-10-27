import { expect, it } from "vitest";
import { createSampleProducts, hasValidInventory } from "../src/domain";

it("creates sample products with inventory totals matching their stock", () => {
  const products = createSampleProducts();

  expect(products).toHaveLength(3);
  expect(products.every(hasValidInventory)).toBe(true);

  const invalidProduct = { ...products[0], available: products[0].available + 1 };
  expect(hasValidInventory(invalidProduct)).toBe(false);
});

import { randomUUID } from "node:crypto";
import {
  createSampleProducts,
  type FlashSaleService,
  type Product,
  type Reservation
} from "./domain";

export const DEFAULT_RESERVATION_TTL_MS = 300_000;

export type FlashSaleErrorCode =
  | "INVALID_QUANTITY"
  | "PRODUCT_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "OUT_OF_STOCK";

export class FlashSaleError extends Error {
  constructor(
    public readonly code: FlashSaleErrorCode,
    message: string
  ) {
    super(message);
    this.name = "FlashSaleError";
  }
}

export interface FlashSaleServiceOptions {
  products?: Product[];
}

export function createFlashSaleService(
  options: FlashSaleServiceOptions = {}
): FlashSaleService {
  const products = new Map(
    (options.products ?? createSampleProducts()).map((product) => [product.id, { ...product }])
  );
  const reservations = new Map<string, Reservation>();

  return {
    getProducts() {
      return [...products.values()].map((product) => ({ ...product }));
    },

    reserve(productId, quantity, expectedVersion) {
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new FlashSaleError("INVALID_QUANTITY", "Quantity must be a positive integer");
      }

      const product = products.get(productId);
      if (!product) {
        throw new FlashSaleError("PRODUCT_NOT_FOUND", "Product was not found");
      }
      if (product.version !== expectedVersion) {
        throw new FlashSaleError("VERSION_CONFLICT", "Inventory changed; refresh and try again");
      }
      if (product.available < quantity) {
        throw new FlashSaleError("OUT_OF_STOCK", "Not enough inventory is available");
      }

      const createdAt = Date.now();
      const reservation: Reservation = {
        id: randomUUID(),
        productId,
        quantity,
        status: "RESERVED",
        createdAt,
        expiresAt: createdAt + DEFAULT_RESERVATION_TTL_MS
      };

      product.available -= quantity;
      product.reserved += quantity;
      product.version += 1;
      reservations.set(reservation.id, reservation);
      return { ...reservation };
    },

    getReservation(reservationId) {
      const reservation = reservations.get(reservationId);
      return reservation ? { ...reservation } : undefined;
    }
  };
}

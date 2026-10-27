import { randomUUID } from "node:crypto";
import {
  createSampleProducts,
  type FlashSaleService,
  type Product,
  type Reservation
} from "./domain";

export const DEFAULT_RESERVATION_TTL_MS = 300_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export type FlashSaleErrorCode =
  | "INVALID_QUANTITY"
  | "PRODUCT_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "OUT_OF_STOCK"
  | "RESERVATION_NOT_FOUND"
  | "RESERVATION_EXPIRED"
  | "RESERVATION_ALREADY_FINALIZED";

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
  ttlMs?: number;
}

export function createFlashSaleService(
  options: FlashSaleServiceOptions = {}
): FlashSaleService {
  const ttlMs = options.ttlMs ?? DEFAULT_RESERVATION_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TIMER_DELAY_MS) {
    throw new RangeError(`ttlMs must be an integer between 1 and ${MAX_TIMER_DELAY_MS}`);
  }

  const products = new Map(
    (options.products ?? createSampleProducts()).map((product) => [product.id, { ...product }])
  );
  const reservations = new Map<string, Reservation>();
  const reservationTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function expireReservation(reservation: Reservation): void {
    if (reservation.status !== "RESERVED" || Date.now() < reservation.expiresAt) {
      return;
    }

    const product = products.get(reservation.productId);
    if (!product) {
      return;
    }

    const timer = reservationTimers.get(reservation.id);
    if (timer) {
      clearTimeout(timer);
      reservationTimers.delete(reservation.id);
    }
    product.reserved -= reservation.quantity;
    product.available += reservation.quantity;
    product.version += 1;
    reservation.status = "EXPIRED";
  }

  function sweepDueReservations(): void {
    for (const reservation of reservations.values()) {
      expireReservation(reservation);
    }
  }

  return {
    getProducts() {
      sweepDueReservations();
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
      sweepDueReservations();
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
        expiresAt: createdAt + ttlMs
      };

      product.available -= quantity;
      product.reserved += quantity;
      product.version += 1;
      reservations.set(reservation.id, reservation);
      const timer = setTimeout(() => {
        reservationTimers.delete(reservation.id);
        expireReservation(reservation);
      }, ttlMs);
      timer.unref();
      reservationTimers.set(reservation.id, timer);
      return { ...reservation };
    },

    getReservation(reservationId) {
      sweepDueReservations();
      const reservation = reservations.get(reservationId);
      return reservation ? { ...reservation } : undefined;
    },

    checkout(reservationId) {
      sweepDueReservations();
      const reservation = reservations.get(reservationId);
      if (!reservation) {
        throw new FlashSaleError("RESERVATION_NOT_FOUND", "Reservation was not found");
      }
      if (reservation.status === "EXPIRED") {
        throw new FlashSaleError("RESERVATION_EXPIRED", "Reservation has expired");
      }
      if (reservation.status !== "RESERVED") {
        throw new FlashSaleError(
          "RESERVATION_ALREADY_FINALIZED",
          "Reservation has already been finalized"
        );
      }

      const product = products.get(reservation.productId);
      if (!product) {
        throw new FlashSaleError("PRODUCT_NOT_FOUND", "Product was not found");
      }
      const timer = reservationTimers.get(reservation.id);
      if (timer) {
        clearTimeout(timer);
        reservationTimers.delete(reservation.id);
      }
      product.reserved -= reservation.quantity;
      product.sold += reservation.quantity;
      product.version += 1;
      reservation.status = "CHECKED_OUT";
      return { ...reservation };
    }
  };
}

import type { Product, Reservation, ReservationStatus } from "../../src/domain";

export class FlashSaleApiError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "FlashSaleApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProduct(value: unknown): value is Product {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.priceVnd === "number"
    && typeof value.totalStock === "number"
    && typeof value.available === "number"
    && typeof value.reserved === "number"
    && typeof value.sold === "number"
    && typeof value.version === "number";
}

function isReservationStatus(value: unknown): value is ReservationStatus {
  return value === "RESERVED" || value === "CHECKED_OUT" || value === "EXPIRED";
}

function isReservation(value: unknown): value is Reservation {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.productId === "string"
    && typeof value.quantity === "number"
    && isReservationStatus(value.status)
    && typeof value.createdAt === "number"
    && typeof value.expiresAt === "number";
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, init);
  const payload: unknown = await response.json();

  if (!response.ok) {
    if (isRecord(payload) && typeof payload.error === "string" && typeof payload.message === "string") {
      throw new FlashSaleApiError(payload.error, payload.message);
    }
    throw new Error(`Request failed with status ${response.status}`);
  }
  return payload;
}

function jsonPost(body?: unknown): RequestInit {
  return body === undefined
    ? { method: "POST" }
    : {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    };
}

export async function fetchProducts(): Promise<Product[]> {
  const payload = await requestJson("/api/products");
  if (!Array.isArray(payload) || !payload.every(isProduct)) {
    throw new Error("The server returned an invalid product list");
  }
  return payload;
}

export async function reserveStock(
  productId: string,
  quantity: number,
  expectedVersion: number
): Promise<Reservation> {
  const payload = await requestJson(
    "/api/reservations",
    jsonPost({ productId, quantity, expectedVersion })
  );
  if (!isReservation(payload)) {
    throw new Error("The server returned an invalid reservation");
  }
  return payload;
}

export async function fetchReservation(reservationId: string): Promise<Reservation> {
  const payload = await requestJson(`/api/reservations/${encodeURIComponent(reservationId)}`);
  if (!isReservation(payload)) {
    throw new Error("The server returned an invalid reservation");
  }
  return payload;
}

export async function checkoutReservation(reservationId: string): Promise<Reservation> {
  const payload = await requestJson(
    `/api/reservations/${encodeURIComponent(reservationId)}/checkout`,
    jsonPost()
  );
  if (!isReservation(payload)) {
    throw new Error("The server returned an invalid reservation");
  }
  return payload;
}

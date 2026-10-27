import { once } from "node:events";
import type { Server } from "node:http";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createFlashSaleService } from "../src/flash-sale-service";
import { createServer } from "../src/server";

let server: Server;
let baseUrl: string;
let service: ReturnType<typeof createFlashSaleService>;

beforeEach(async () => {
  service = createFlashSaleService({ ttlMs: 60_000 });
  server = createServer(service);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected an internet socket address");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  if (server.listening) {
    server.close();
    await once(server, "close");
  }
});

it("returns the current product inventory", async () => {
  const response = await fetch(`${baseUrl}/api/products`);
  const products = await response.json();

  expect(response.status).toBe(200);
  expect(products).toHaveLength(3);
  expect(products[0]).toMatchObject({
    id: "wireless-earbuds",
    available: 8,
    reserved: 0,
    sold: 0,
    version: 0
  });
});

it("reserves stock, retrieves the reservation, and checks it out", async () => {
  const reserveResponse = await fetch(`${baseUrl}/api/reservations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productId: "wireless-earbuds", quantity: 2, expectedVersion: 0 })
  });
  const reservation = await reserveResponse.json();

  expect(reserveResponse.status).toBe(201);
  expect(reservation).toMatchObject({ status: "RESERVED", quantity: 2 });
  expect(typeof reservation.expiresAt).toBe("number");

  const getResponse = await fetch(`${baseUrl}/api/reservations/${reservation.id}`);
  expect(getResponse.status).toBe(200);
  expect(await getResponse.json()).toMatchObject({ id: reservation.id, status: "RESERVED" });

  const checkoutResponse = await fetch(`${baseUrl}/api/reservations/${reservation.id}/checkout`, {
    method: "POST"
  });
  expect(checkoutResponse.status).toBe(200);
  expect(await checkoutResponse.json()).toMatchObject({ id: reservation.id, status: "CHECKED_OUT" });
});

it("returns explicit client errors for malformed, invalid, missing, and stale requests", async () => {
  const malformedResponse = await fetch(`${baseUrl}/api/reservations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{broken"
  });
  expect(malformedResponse.status).toBe(400);

  const invalidResponse = await fetch(`${baseUrl}/api/reservations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productId: "wireless-earbuds", quantity: 0, expectedVersion: 0 })
  });
  expect(invalidResponse.status).toBe(400);
  expect(await invalidResponse.json()).toMatchObject({ error: "INVALID_QUANTITY" });

  const missingResponse = await fetch(`${baseUrl}/api/reservations/missing-id`);
  expect(missingResponse.status).toBe(404);
  expect(await missingResponse.json()).toMatchObject({ error: "RESERVATION_NOT_FOUND" });

  service.reserve("wireless-earbuds", 1, 0);
  const staleResponse = await fetch(`${baseUrl}/api/reservations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productId: "wireless-earbuds", quantity: 1, expectedVersion: 0 })
  });
  expect(staleResponse.status).toBe(409);
  expect(await staleResponse.json()).toMatchObject({ error: "VERSION_CONFLICT" });
});

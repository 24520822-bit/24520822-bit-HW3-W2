import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse
} from "node:http";
import { pathToFileURL } from "node:url";
import type { FlashSaleService } from "./domain";
import { createFlashSaleService, FlashSaleError } from "./flash-sale-service";

const MAX_REQUEST_BODY_BYTES = 16_384;

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function getErrorResponse(error: FlashSaleError): { status: number; body: object } {
  const status = (() => {
    switch (error.code) {
      case "INVALID_QUANTITY":
        return 400;
      case "PRODUCT_NOT_FOUND":
      case "RESERVATION_NOT_FOUND":
        return 404;
      case "VERSION_CONFLICT":
      case "OUT_OF_STOCK":
      case "RESERVATION_EXPIRED":
      case "RESERVATION_ALREADY_FINALIZED":
        return 409;
    }
  })();
  return { status, body: { error: error.code, message: error.message } };
}

async function parseJsonBody(
  request: IncomingMessage
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_REQUEST_BODY_BYTES) {
      return { ok: false };
    }
    chunks.push(buffer);
  }

  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { ok: false };
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sendClientError(response: ServerResponse, status: number, code: string, message: string): void {
  sendJson(response, status, { error: code, message });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  service: FlashSaleService
): Promise<void> {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  if (request.method === "GET" && path === "/health") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("ok");
    return;
  }

  if (request.method === "GET" && path === "/api/products") {
    sendJson(response, 200, service.getProducts());
    return;
  }

  if (path === "/api/reservations" && request.method === "POST") {
    const body = await parseJsonBody(request);
    if (
      !body.ok
      || !isRecord(body.value)
      || typeof body.value.productId !== "string"
      || body.value.productId.trim().length === 0
      || typeof body.value.quantity !== "number"
      || !Number.isInteger(body.value.expectedVersion)
      || Number(body.value.expectedVersion) < 0
    ) {
      sendClientError(response, 400, "INVALID_REQUEST", "A valid JSON reservation request is required");
      return;
    }

    try {
      const reservation = service.reserve(
        body.value.productId,
        body.value.quantity,
        Number(body.value.expectedVersion)
      );
      sendJson(response, 201, reservation);
    } catch (error) {
      if (error instanceof FlashSaleError) {
        const result = getErrorResponse(error);
        sendJson(response, result.status, result.body);
        return;
      }
      throw error;
    }
    return;
  }

  const reservationMatch = /^\/api\/reservations\/([^/]+)(\/checkout)?$/.exec(path);
  if (reservationMatch) {
    let reservationId: string;
    try {
      reservationId = decodeURIComponent(reservationMatch[1]);
    } catch {
      sendClientError(response, 400, "INVALID_REQUEST", "Reservation ID is invalid");
      return;
    }

    if (!reservationMatch[2] && request.method === "GET") {
      const reservation = service.getReservation(reservationId);
      if (!reservation) {
        sendClientError(response, 404, "RESERVATION_NOT_FOUND", "Reservation was not found");
        return;
      }
      sendJson(response, 200, reservation);
      return;
    }

    if (reservationMatch[2] && request.method === "POST") {
      try {
        sendJson(response, 200, service.checkout(reservationId));
      } catch (error) {
        if (error instanceof FlashSaleError) {
          const result = getErrorResponse(error);
          sendJson(response, result.status, result.body);
          return;
        }
        throw error;
      }
      return;
    }
  }

  if (path.startsWith("/api/")) {
    sendClientError(response, 404, "NOT_FOUND", "API route was not found");
    return;
  }

  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
}

export function createServer(service: FlashSaleService = createFlashSaleService()) {
  return createHttpServer((request, response) => {
    void handleRequest(request, response, service).catch((error: unknown) => {
      console.error("Unhandled API request error", error);
      if (!response.headersSent) {
        sendClientError(response, 500, "INTERNAL_ERROR", "An internal server error occurred");
      } else {
        response.destroy();
      }
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  createServer().listen(port, "127.0.0.1", () => {
    console.log(`Flash-sale API listening on http://127.0.0.1:${port}`);
  });
}

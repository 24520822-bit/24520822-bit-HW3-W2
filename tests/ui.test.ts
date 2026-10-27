// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import type { Product, Reservation } from "../src/domain";
import { mountFlashSaleApp } from "../client/src/main";

let cleanup: (() => void) | undefined;

const initialProduct: Product = {
  id: "wireless-earbuds",
  name: "Wireless earbuds",
  priceVnd: 399_000,
  totalStock: 1,
  available: 1,
  reserved: 0,
  sold: 0,
  version: 0
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function createReservation(id = "reservation-1"): Reservation {
  return {
    id,
    productId: initialProduct.id,
    quantity: 1,
    status: "RESERVED",
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000
  };
}

function createRoot(): HTMLElement {
  const root = document.createElement("main");
  document.body.replaceChildren(root);
  return root;
}

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it("renders server-provided product names as text, not executable markup", async () => {
  const unsafeLookingName = '<img src=x onerror="alert(1)">';
  vi.stubGlobal("fetch", vi.fn(async () => response([{ ...initialProduct, name: unsafeLookingName }])));
  const root = createRoot();
  cleanup = mountFlashSaleApp(root);

  await vi.waitFor(() => expect(root.textContent).toContain(unsafeLookingName));
  expect(root.querySelector("img")).toBeNull();
});

it("reserves stock and displays a live countdown with a checkout action", async () => {
  const reservation = createReservation();
  let inventory = [initialProduct];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/products") {
      return response(inventory);
    }
    if (url === "/api/reservations" && init?.method === "POST") {
      inventory = [{ ...initialProduct, available: 0, reserved: 1, version: 1 }];
      return response(reservation, 201);
    }
    if (url === `/api/reservations/${reservation.id}/checkout` && init?.method === "POST") {
      inventory = [{ ...initialProduct, available: 0, reserved: 0, sold: 1, version: 2 }];
      return response({ ...reservation, status: "CHECKED_OUT" });
    }
    return response({ error: "NOT_FOUND", message: "Not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  const root = createRoot();
  cleanup = mountFlashSaleApp(root);
  await vi.waitFor(() => expect(root.querySelector('[data-action="reserve"]')).not.toBeNull());

  root.querySelector<HTMLButtonElement>('[data-action="reserve"]')?.click();

  await vi.waitFor(() => expect(root.textContent).toContain("Lock reserved"));
  expect(root.querySelector('[data-role="countdown"]')?.textContent).toMatch(/\d{2}:\d{2}/);
  expect(root.querySelector('[data-action="checkout"]')).not.toBeNull();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/reservations",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ productId: initialProduct.id, quantity: 1, expectedVersion: 0 })
    })
  );

  root.querySelector<HTMLButtonElement>('[data-action="checkout"]')?.click();
  await vi.waitFor(() => expect(root.textContent).toContain("CHECKED_OUT"));
  expect(root.textContent).toContain("Order confirmed");
});

it("simulates many buyers racing against the same product version", async () => {
  const reservation = createReservation();
  let reservationAttempts = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/products") {
      return response(reservationAttempts === 0
        ? [initialProduct]
        : [{ ...initialProduct, available: 0, reserved: 1, version: 1 }]);
    }
    if (url === "/api/reservations" && init?.method === "POST") {
      reservationAttempts += 1;
      return reservationAttempts === 1
        ? response(reservation, 201)
        : response({ error: "VERSION_CONFLICT", message: "Inventory changed" }, 409);
    }
    return response({ error: "NOT_FOUND", message: "Not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  const root = createRoot();
  cleanup = mountFlashSaleApp(root);
  await vi.waitFor(() => expect(root.querySelector('[data-action="simulate"]')).not.toBeNull());
  const buyerCount = root.querySelector<HTMLInputElement>('[data-buyers-for="wireless-earbuds"]');
  if (!buyerCount) {
    throw new Error("Missing simulated buyer count input");
  }
  buyerCount.value = "5";

  root.querySelector<HTMLButtonElement>('[data-action="simulate"]')?.click();

  await vi.waitFor(() => expect(root.textContent).toContain("1 buyer reserved stock; 4 lost the version race."));
  expect(reservationAttempts).toBe(5);
  const submittedVersions = fetchMock.mock.calls
    .filter(([url, init]) => String(url) === "/api/reservations" && init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init?.body)).expectedVersion);
  expect(submittedVersions).toEqual([0, 0, 0, 0, 0]);
});

it("refreshes the reservation and inventory when its countdown reaches zero", async () => {
  const reservation: Reservation = {
    ...createReservation("reservation-expiring"),
    expiresAt: Date.now() - 1
  };
  let reservationStatus: Reservation["status"] = "RESERVED";
  let inventory = [initialProduct];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/products") {
      return response(inventory);
    }
    if (url === "/api/reservations" && init?.method === "POST") {
      inventory = [{ ...initialProduct, available: 0, reserved: 1, version: 1 }];
      return response(reservation, 201);
    }
    if (url === `/api/reservations/${reservation.id}`) {
      reservationStatus = "EXPIRED";
      inventory = [{ ...initialProduct, available: 1, reserved: 0, version: 2 }];
      return response({ ...reservation, status: reservationStatus });
    }
    return response({ error: "NOT_FOUND", message: "Not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(Date.now()));
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const root = createRoot();
  cleanup = mountFlashSaleApp(root);
  await vi.waitFor(() => expect(root.querySelector('[data-action="reserve"]')).not.toBeNull());
  root.querySelector<HTMLButtonElement>('[data-action="reserve"]')?.click();

  await vi.waitFor(() => expect(root.textContent).toContain("Stock released"));
  expect(reservationStatus).toBe("EXPIRED");
  expect(root.textContent).toContain("Available");
});

it("does not render inventory after the app has been unmounted", async () => {
  let resolveResponse: (value: Response) => void = () => {
    throw new Error("Fetch has not been started");
  };
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  })));
  const root = createRoot();
  cleanup = mountFlashSaleApp(root);
  cleanup();
  cleanup = undefined;

  resolveResponse(response([initialProduct]));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(root.querySelector(".product-card")).toBeNull();
});

it.each(["temporary API failure", "server deadline not reached"] as const)(
  "backs off instead of scheduling more zero-time frames after %s",
  async (scenario) => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    let nextFrameId = 1;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));

    const reservation: Reservation = {
      ...createReservation(`reservation-${scenario.replaceAll(" ", "-")}`),
      expiresAt: 9_999
    };
    let inventory = [initialProduct];
    let expiryChecks = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/products") {
        return response(inventory);
      }
      if (url === "/api/reservations" && init?.method === "POST") {
        inventory = [{ ...initialProduct, available: 0, reserved: 1, version: 1 }];
        return response(reservation, 201);
      }
      if (url === `/api/reservations/${reservation.id}`) {
        expiryChecks += 1;
        if (scenario === "temporary API failure") {
          return response({ error: "UNAVAILABLE", message: "Temporary error" }, 503);
        }
        return response(reservation);
      }
      return response({ error: "NOT_FOUND", message: "Not found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    const root = createRoot();
    cleanup = mountFlashSaleApp(root);
    await vi.waitFor(() => expect(root.querySelector('[data-action="reserve"]')).not.toBeNull());
    root.querySelector<HTMLButtonElement>('[data-action="reserve"]')?.click();
    await vi.waitFor(() => expect(frames.size).toBe(1));

    const [frameId, frameCallback] = frames.entries().next().value as [number, FrameRequestCallback];
    frames.delete(frameId);
    frameCallback(Date.now());
    for (let turn = 0; turn < 50; turn += 1) {
      await Promise.resolve();
    }

    expect(expiryChecks).toBe(1);
    const expectedMessage = scenario === "temporary API failure"
      ? "Temporary error"
      : "Sale server has not reached the lock deadline; checking again shortly.";
    expect(root.textContent).toContain(expectedMessage);
    expect(frames.size).toBe(0);

    await vi.advanceTimersByTimeAsync(999);
    expect(expiryChecks).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    for (let turn = 0; turn < 50; turn += 1) {
      await Promise.resolve();
    }
    expect(expiryChecks).toBe(2);
    expect(frames.size).toBe(0);
  }
);

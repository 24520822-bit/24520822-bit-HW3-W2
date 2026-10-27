import type { Product, Reservation } from "../../src/domain";
import {
  checkoutReservation,
  fetchProducts,
  fetchReservation,
  FlashSaleApiError,
  reserveStock
} from "./api";
import { createAntiDriftTimer } from "./countdown";

interface StatusMessage {
  text: string;
  isError: boolean;
}

function makeElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function formatPrice(priceVnd: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(priceVnd);
}

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.ceil(remainingMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function statusMessage(error: unknown): string {
  if (error instanceof FlashSaleApiError) {
    if (error.code === "VERSION_CONFLICT") {
      return "Inventory changed during the race. Refresh and try again.";
    }
    if (error.code === "OUT_OF_STOCK") {
      return "This product has sold out.";
    }
    if (error.code === "RESERVATION_EXPIRED") {
      return "This reservation expired before checkout.";
    }
    if (error.code === "RESERVATION_ALREADY_FINALIZED") {
      return "This reservation has already been finalized.";
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function mountFlashSaleApp(root: HTMLElement): () => void {
  let products: Product[] = [];
  const reservations = new Map<string, Reservation>();
  const busyProducts = new Set<string>();
  const countdownCleanups = new Map<string, () => void>();
  let message: StatusMessage = { text: "Loading live inventory…", isError: false };
  let destroyed = false;

  function setMessage(text: string, isError = false): void {
    message = { text, isError };
  }

  function render(): void {
    for (const cleanup of countdownCleanups.values()) {
      cleanup();
    }
    countdownCleanups.clear();

    const hero = makeElement("header", "hero");
    const eyebrow = makeElement("p", "eyebrow", "11.11 NIGHT MARKET · VIETNAM");
    const title = makeElement("h1", undefined, "Midnight Flash Sale");
    const intro = makeElement(
      "p",
      "hero-copy",
      "Race for limited drops. Your reservation holds stock only until its server-set deadline."
    );
    const livePill = makeElement("span", "live-pill", "● LIVE SALE");
    hero.append(eyebrow, title, intro, livePill);

    const feedback = makeElement("p", message.isError ? "feedback error" : "feedback", message.text);
    feedback.setAttribute("role", message.isError ? "alert" : "status");

    const inventorySection = makeElement("section", "inventory-section");
    inventorySection.append(
      makeElement("h2", undefined, "Limited drops"),
      makeElement("p", "section-copy", "Inventory updates are authoritative on the sale server.")
    );
    const grid = makeElement("div", "product-grid");

    for (const product of products) {
      const card = makeElement("article", "product-card");
      const topLine = makeElement("div", "product-topline");
      topLine.append(
        makeElement("span", "drop-label", "FLASH DROP"),
        makeElement("span", "version-label", `Stock version ${product.version}`)
      );
      const name = makeElement("h3", "product-name", product.name);
      const price = makeElement("p", "product-price", formatPrice(product.priceVnd));
      const inventory = makeElement("dl", "inventory-stats");
      for (const [label, value] of [
        ["Available", product.available],
        ["Reserved", product.reserved],
        ["Sold", product.sold]
      ] as const) {
        const stat = makeElement("div", "inventory-stat");
        stat.append(makeElement("dt", undefined, label), makeElement("dd", undefined, String(value)));
        inventory.append(stat);
      }

      const controls = makeElement("div", "controls");
      const quantityInput = makeElement("input", "number-input");
      quantityInput.type = "number";
      quantityInput.min = "1";
      quantityInput.max = String(Math.max(1, product.available));
      quantityInput.value = "1";
      quantityInput.setAttribute("aria-label", `Quantity for ${product.name}`);
      quantityInput.dataset.quantityFor = product.id;
      const quantityLabel = makeElement("label", "field-label", "Quantity");
      quantityLabel.append(quantityInput);

      const buyerInput = makeElement("input", "number-input");
      buyerInput.type = "number";
      buyerInput.min = "2";
      buyerInput.max = "50";
      buyerInput.value = "5";
      buyerInput.setAttribute("aria-label", `Simulated buyers for ${product.name}`);
      buyerInput.dataset.buyersFor = product.id;
      const buyerLabel = makeElement("label", "field-label", "Buyers in race (2–50)");
      buyerLabel.append(buyerInput);
      controls.append(quantityLabel, buyerLabel);

      const actions = makeElement("div", "actions");
      const isBusy = busyProducts.has(product.id);
      const reserveButton = makeElement("button", "button primary", isBusy ? "Working…" : "Reserve");
      reserveButton.type = "button";
      reserveButton.dataset.action = "reserve";
      reserveButton.dataset.productId = product.id;
      reserveButton.disabled = isBusy || product.available < 1;
      const simulateButton = makeElement("button", "button secondary", "Simulate buyer race");
      simulateButton.type = "button";
      simulateButton.dataset.action = "simulate";
      simulateButton.dataset.productId = product.id;
      simulateButton.disabled = isBusy || product.available < 1;
      actions.append(reserveButton, simulateButton);
      card.append(topLine, name, price, inventory, controls, actions);
      grid.append(card);
    }

    if (products.length === 0) {
      grid.append(makeElement("p", "empty-state", "No products are available right now."));
    }
    inventorySection.append(grid);

    const reservationSection = makeElement("section", "reservation-section");
    reservationSection.append(
      makeElement("h2", undefined, "Your reservations"),
      makeElement("p", "section-copy", "Countdowns are calculated from each server-issued expiry time.")
    );
    const reservationList = makeElement("div", "reservation-list");

    for (const reservation of reservations.values()) {
      const product = products.find((candidate) => candidate.id === reservation.productId);
      const card = makeElement("article", "reservation-card");
      const details = makeElement("div", "reservation-details");
      details.append(
        makeElement("h3", undefined, product?.name ?? "Flash-sale product"),
        makeElement("p", "reservation-meta", `${reservation.quantity} unit${reservation.quantity === 1 ? "" : "s"}`)
      );
      const state = makeElement(
        "span",
        `reservation-state ${reservation.status.toLowerCase()}`,
        reservation.status
      );
      const actions = makeElement("div", "reservation-actions");
      if (reservation.status === "RESERVED") {
        const countdown = makeElement(
          "strong",
          "countdown",
          formatCountdown(Math.max(0, reservation.expiresAt - Date.now()))
        );
        countdown.dataset.role = "countdown";
        countdown.dataset.reservationId = reservation.id;
        const checkoutButton = makeElement("button", "button primary compact", "Checkout");
        checkoutButton.type = "button";
        checkoutButton.dataset.action = "checkout";
        checkoutButton.dataset.reservationId = reservation.id;
        checkoutButton.disabled = busyProducts.has(reservation.productId);
        actions.append(countdown, checkoutButton);
      } else {
        actions.append(makeElement(
          "span",
          reservation.status === "EXPIRED" ? "terminal-note expired" : "terminal-note",
          reservation.status === "EXPIRED" ? "Stock released" : "Order confirmed"
        ));
      }
      card.append(details, state, actions);
      reservationList.append(card);
    }
    if (reservations.size === 0) {
      reservationList.append(makeElement("p", "empty-state", "Reserve a product to start a countdown lock."));
    }
    reservationSection.append(reservationList);
    root.replaceChildren(hero, feedback, inventorySection, reservationSection);

    for (const reservation of reservations.values()) {
      if (reservation.status !== "RESERVED") {
        continue;
      }
      const countdown = Array.from(root.querySelectorAll<HTMLElement>('[data-role="countdown"]'))
        .find((element) => element.dataset.reservationId === reservation.id);
      if (!countdown) {
        continue;
      }
      let expirySyncStarted = false;
      const cleanup = createAntiDriftTimer(reservation.expiresAt, (remainingMs) => {
        countdown.textContent = formatCountdown(remainingMs);
        if (remainingMs === 0 && !expirySyncStarted) {
          expirySyncStarted = true;
          void syncReservation(reservation.id);
        }
      });
      countdownCleanups.set(reservation.id, cleanup);
    }
  }

  async function refreshInventory(): Promise<void> {
    products = await fetchProducts();
  }

  async function syncReservation(reservationId: string): Promise<void> {
    try {
      const reservation = await fetchReservation(reservationId);
      reservations.set(reservation.id, reservation);
      await refreshInventory();
      if (!destroyed) {
        render();
      }
    } catch (error) {
      if (!destroyed) {
        setMessage(statusMessage(error), true);
        render();
      }
    }
  }

  async function reserve(productId: string): Promise<void> {
    const product = products.find((candidate) => candidate.id === productId);
    const quantityInput = Array.from(root.querySelectorAll<HTMLInputElement>("[data-quantity-for]"))
      .find((input) => input.dataset.quantityFor === productId);
    const quantity = Number(quantityInput?.value);
    if (!product || !Number.isInteger(quantity) || quantity <= 0) {
      setMessage("Enter a positive whole-number quantity.", true);
      render();
      return;
    }

    busyProducts.add(productId);
    setMessage("Checking the latest inventory…");
    render();
    try {
      const reservation = await reserveStock(productId, quantity, product.version);
      reservations.set(reservation.id, reservation);
      setMessage("Lock reserved. Checkout before the countdown reaches zero.");
      await refreshInventory();
    } catch (error) {
      setMessage(statusMessage(error), true);
    } finally {
      busyProducts.delete(productId);
      if (!destroyed) {
        render();
      }
    }
  }

  async function simulateBuyers(productId: string): Promise<void> {
    const product = products.find((candidate) => candidate.id === productId);
    const buyersInput = Array.from(root.querySelectorAll<HTMLInputElement>("[data-buyers-for]"))
      .find((input) => input.dataset.buyersFor === productId);
    const buyerCount = Number(buyersInput?.value);
    if (!product || !Number.isInteger(buyerCount) || buyerCount < 2 || buyerCount > 50) {
      setMessage("Choose between 2 and 50 simulated buyers.", true);
      render();
      return;
    }

    busyProducts.add(productId);
    setMessage(`${buyerCount} buyers are competing for the same stock version…`);
    render();
    try {
      const results = await Promise.allSettled(
        Array.from({ length: buyerCount }, () => reserveStock(productId, 1, product.version))
      );
      let winners = 0;
      for (const result of results) {
        if (result.status === "fulfilled") {
          reservations.set(result.value.id, result.value);
          winners += 1;
        }
      }
      setMessage(
        `${winners} buyer${winners === 1 ? "" : "s"} reserved stock; ${buyerCount - winners} lost the version race.`
      );
      await refreshInventory();
    } catch (error) {
      setMessage(statusMessage(error), true);
    } finally {
      busyProducts.delete(productId);
      if (!destroyed) {
        render();
      }
    }
  }

  async function checkout(reservationId: string): Promise<void> {
    const reservation = reservations.get(reservationId);
    if (!reservation) {
      return;
    }
    busyProducts.add(reservation.productId);
    setMessage("Confirming checkout…");
    render();
    try {
      const checkedOut = await checkoutReservation(reservationId);
      reservations.set(checkedOut.id, checkedOut);
      setMessage("Checkout complete. Your units are now sold.");
      await refreshInventory();
    } catch (error) {
      let latest: Reservation | undefined;
      let refreshError: unknown;
      try {
        latest = await fetchReservation(reservationId);
        reservations.set(latest.id, latest);
        await refreshInventory();
      } catch (followUpError) {
        refreshError = followUpError;
      }
      setMessage(
        refreshError
          ? `${statusMessage(error)} Inventory refresh also failed: ${statusMessage(refreshError)}`
          : statusMessage(error),
        true
      );
    } finally {
      busyProducts.delete(reservation.productId);
      if (!destroyed) {
        render();
      }
    }
  }

  function handleClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const button = target.closest<HTMLButtonElement>("button[data-action]");
    if (!button || button.disabled) {
      return;
    }
    if (button.dataset.action === "reserve" && button.dataset.productId) {
      void reserve(button.dataset.productId);
    } else if (button.dataset.action === "simulate" && button.dataset.productId) {
      void simulateBuyers(button.dataset.productId);
    } else if (button.dataset.action === "checkout" && button.dataset.reservationId) {
      void checkout(button.dataset.reservationId);
    }
  }

  root.addEventListener("click", handleClick);
  render();
  void refreshInventory()
    .then(() => {
      if (!destroyed) {
        render();
      }
    })
    .catch((error: unknown) => {
      if (!destroyed) {
        setMessage(statusMessage(error), true);
        render();
      }
    });

  return () => {
    destroyed = true;
    root.removeEventListener("click", handleClick);
    for (const cleanup of countdownCleanups.values()) {
      cleanup();
    }
    countdownCleanups.clear();
  };
}

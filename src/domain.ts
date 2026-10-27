export type ReservationStatus = "RESERVED" | "CHECKED_OUT" | "EXPIRED";

export interface Product {
  id: string;
  name: string;
  priceVnd: number;
  totalStock: number;
  available: number;
  reserved: number;
  sold: number;
  version: number;
}

export interface Reservation {
  id: string;
  productId: string;
  quantity: number;
  status: ReservationStatus;
  createdAt: number;
  expiresAt: number;
}

export interface FlashSaleService {
  getProducts(): Product[];
  reserve(productId: string, quantity: number, expectedVersion: number): Reservation;
  getReservation(reservationId: string): Reservation | undefined;
}

export function createSampleProducts(): Product[] {
  return [
    {
      id: "wireless-earbuds",
      name: "Wireless earbuds",
      priceVnd: 399_000,
      totalStock: 8,
      available: 8,
      reserved: 0,
      sold: 0,
      version: 0
    },
    {
      id: "rice-cooker",
      name: "Smart rice cooker",
      priceVnd: 899_000,
      totalStock: 5,
      available: 5,
      reserved: 0,
      sold: 0,
      version: 0
    },
    {
      id: "air-purifier",
      name: "Compact air purifier",
      priceVnd: 1_490_000,
      totalStock: 3,
      available: 3,
      reserved: 0,
      sold: 0,
      version: 0
    }
  ];
}

export function hasValidInventory(product: Product): boolean {
  const counts = [product.totalStock, product.available, product.reserved, product.sold];
  return counts.every((count) => Number.isInteger(count) && count >= 0)
    && product.available + product.reserved + product.sold === product.totalStock;
}

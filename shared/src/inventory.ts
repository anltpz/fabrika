import { ITEMS } from './items';
import type { Slot } from './types';

export type Inventory = Array<Slot | null>;

export function makeInventory(n: number): Inventory {
  return new Array(n).fill(null);
}

export function countItem(inv: Inventory, item: string): number {
  let c = 0;
  for (const s of inv) if (s && s.item === item) c += s.count;
  return c;
}

export function hasItems(inv: Inventory, cost: Record<string, number>, mult = 1): boolean {
  return Object.entries(cost).every(([item, n]) => countItem(inv, item) >= n * mult);
}

/** Eklenebilen miktarı ekler, sığmayan miktarı döndürür */
export function addItem(inv: Inventory, item: string, count: number): number {
  const stack = ITEMS[item]?.stack ?? 100;
  let left = count;
  for (const s of inv) {
    if (left <= 0) break;
    if (s && s.item === item && s.count < stack) {
      const add = Math.min(stack - s.count, left);
      s.count += add;
      left -= add;
    }
  }
  for (let i = 0; i < inv.length && left > 0; i++) {
    if (!inv[i]) {
      const add = Math.min(stack, left);
      inv[i] = { item, count: add };
      left -= add;
    }
  }
  return left;
}

export function spaceFor(inv: Inventory, item: string): number {
  const stack = ITEMS[item]?.stack ?? 100;
  let space = 0;
  for (const s of inv) {
    if (!s) space += stack;
    else if (s.item === item) space += stack - s.count;
  }
  return space;
}

export function removeItem(inv: Inventory, item: string, count: number): number {
  let left = count;
  for (let i = inv.length - 1; i >= 0 && left > 0; i--) {
    const s = inv[i];
    if (s && s.item === item) {
      const rem = Math.min(s.count, left);
      s.count -= rem;
      left -= rem;
      if (s.count <= 0) inv[i] = null;
    }
  }
  return count - left;
}

export function removeItems(inv: Inventory, cost: Record<string, number>, mult = 1): void {
  for (const [item, n] of Object.entries(cost)) removeItem(inv, item, n * mult);
}

export function isEmpty(inv: Inventory): boolean {
  return inv.every((s) => !s);
}

import { Shop } from './entities/shop.entity';

function localDate(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function localTime(now: Date): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/**
 * Whether a shop is open right now, combining the manual switch with the weekly
 * schedule and holidays:
 *   - `isOpenManual` off  → closed (hard override).
 *   - no working hours set → the manual switch alone governs (always open).
 *   - today is a holiday  → closed.
 *   - otherwise open only inside today's slot's open/close time.
 * Uses server-local time (the deployment runs in the shops' timezone).
 */
export function isShopOpenNow(
  shop: Pick<Shop, 'isOpenManual' | 'workingHours' | 'holidays'>,
  now: Date = new Date(),
): boolean {
  if (!shop.isOpenManual) return false;
  const hours = shop.workingHours ?? [];
  if (hours.length === 0) return true;
  if ((shop.holidays ?? []).some((h) => h.date === localDate(now))) return false;
  const slot = hours.find((h) => h.dayOfWeek === now.getDay());
  if (!slot || !slot.isOpen) return false;
  const t = localTime(now);
  return t >= slot.openTime && t <= slot.closeTime;
}

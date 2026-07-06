import { Shop } from './entities/shop.entity';

/**
 * All shops currently operate in Uzbekistan, so opening-hours checks must be
 * evaluated in this timezone regardless of the server process's own `TZ` —
 * relying on an ops-configured env var is fragile (easy to misconfigure /
 * silently drift on redeploy), so we compute it explicitly every time.
 */
const SHOP_TZ = 'Asia/Tashkent';

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

interface TzNow {
  /** YYYY-MM-DD in {@link SHOP_TZ}. */
  date: string;
  /** HH:MM (24h) in {@link SHOP_TZ}. */
  time: string;
  /** 0 (Sunday) .. 6 (Saturday), matching WorkingHourSlot.dayOfWeek. */
  dayOfWeek: number;
}

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: SHOP_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hour12: false,
});

function tzNow(now: Date): TzNow {
  const parts = formatter.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  // With hour12:false some environments render midnight as "24" — normalize.
  const rawHour = get('hour');
  const hour = rawHour === '24' ? '00' : rawHour;
  const minute = get('minute');
  const weekday = get('weekday');
  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
    dayOfWeek: WEEKDAY_INDEX[weekday] ?? now.getUTCDay(),
  };
}

/**
 * Whether a shop is open right now, combining the manual switch with the weekly
 * schedule and holidays:
 *   - `isOpenManual` off      → closed (hard override).
 *   - no working hours set   → closed (seller hasn't configured a schedule yet;
 *     an unconfigured shop must not read as "always open").
 *   - today is a holiday     → closed.
 *   - otherwise open only inside today's slot's open/close time.
 * Always evaluated in Asia/Tashkent, independent of the server process's `TZ`.
 */
export function isShopOpenNow(
  shop: Pick<Shop, 'isOpenManual' | 'workingHours' | 'holidays'>,
  now: Date = new Date(),
): boolean {
  if (!shop.isOpenManual) return false;
  const hours = shop.workingHours ?? [];
  if (hours.length === 0) return false;

  const { date, time, dayOfWeek } = tzNow(now);
  if ((shop.holidays ?? []).some((h) => h.date === date)) return false;
  const slot = hours.find((h) => h.dayOfWeek === dayOfWeek);
  if (!slot || !slot.isOpen) return false;
  return time >= slot.openTime && time <= slot.closeTime;
}

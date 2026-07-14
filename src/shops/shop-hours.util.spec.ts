import type { Holiday, Shop, WorkingHourSlot } from './entities/shop.entity';
import { isShopOpenNow } from './shop-hours.util';

type ShopHoursInput = Pick<Shop, 'isOpenManual' | 'workingHours' | 'holidays'>;

function makeShop(overrides: Partial<ShopHoursInput> = {}): ShopHoursInput {
  return {
    isOpenManual: true,
    workingHours: [],
    holidays: [],
    ...overrides,
  };
}

/** Tashkent has used a fixed UTC+05:00 offset (no DST) throughout — safe to hardcode the shift. */
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

/** The Tashkent-local weekday (0=Sun..6=Sat) of `d`, computed independently of the util under test. */
function tashkentWeekday(d: Date): number {
  return new Date(d.getTime() + TASHKENT_OFFSET_MS).getUTCDay();
}

/** The Tashkent-local HH:MM of `d`, computed independently of the util under test. */
function tashkentTime(d: Date): string {
  const shifted = new Date(d.getTime() + TASHKENT_OFFSET_MS);
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** The Tashkent-local YYYY-MM-DD of `d`. */
function tashkentDate(d: Date): string {
  const shifted = new Date(d.getTime() + TASHKENT_OFFSET_MS);
  return shifted.toISOString().split('T')[0];
}

function slotAround(dayOfWeek: number, hhmm: string, overrides: Partial<WorkingHourSlot> = {}): WorkingHourSlot {
  const [h, m] = hhmm.split(':').map(Number);
  const openMinutes = h * 60 + m - 60;
  const closeMinutes = h * 60 + m + 60;
  const fmt = (mins: number) => {
    const wrapped = ((mins % (24 * 60)) + 24 * 60) % (24 * 60);
    return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
  };
  // A slot is labelled by the day it OPENS on (matches isShopOpenNow's
  // semantics). If subtracting 60 minutes wrapped past midnight, the slot
  // actually opened YESTERDAY (relative to `dayOfWeek`, which is `now`'s own
  // day) — e.g. at 00:30 "now ± 60min" is yesterday 23:30 to today 01:30, a
  // slot that belongs to yesterday's dayOfWeek, not today's. Only applies to
  // the auto-computed window though — if the caller overrides openTime, they
  // own the window and this heuristic no longer means anything.
  const dayOffset = overrides.openTime === undefined ? Math.floor(openMinutes / (24 * 60)) : 0;
  const slotDay = (((dayOfWeek + dayOffset) % 7) + 7) % 7;
  return {
    dayOfWeek: slotDay as WorkingHourSlot['dayOfWeek'],
    openTime: fmt(openMinutes),
    closeTime: fmt(closeMinutes),
    isOpen: true,
    ...overrides,
  };
}

describe('isShopOpenNow', () => {
  it('isOpenManual=false bo\'lsa har doim yopiq (qattiq o\'chirish)', () => {
    const now = new Date();
    const dow = tashkentWeekday(now);
    const shop = makeShop({
      isOpenManual: false,
      workingHours: [slotAround(dow, tashkentTime(now))],
    });
    expect(isShopOpenNow(shop, now)).toBe(false);
  });

  it('workingHours sozlanmagan bo\'lsa yopiq hisoblanadi (default ochiq emas)', () => {
    const shop = makeShop({ workingHours: [] });
    expect(isShopOpenNow(shop, new Date())).toBe(false);
  });

  it('bugungi kun ta\'til (holiday) bo\'lsa ish vaqti ichida bo\'lsa ham yopiq', () => {
    const now = new Date();
    const dow = tashkentWeekday(now);
    const holiday: Holiday = { date: tashkentDate(now), reason: 'Bayram' };
    const shop = makeShop({
      workingHours: [slotAround(dow, tashkentTime(now))],
      holidays: [holiday],
    });
    expect(isShopOpenNow(shop, now)).toBe(false);
  });

  it('shu kun uchun slot.isOpen=false bo\'lsa yopiq', () => {
    const now = new Date();
    const dow = tashkentWeekday(now);
    const shop = makeShop({
      workingHours: [slotAround(dow, tashkentTime(now), { isOpen: false })],
    });
    expect(isShopOpenNow(shop, now)).toBe(false);
  });

  it('ish vaqti ichida bo\'lsa ochiq', () => {
    const now = new Date();
    const dow = tashkentWeekday(now);
    const shop = makeShop({
      workingHours: [slotAround(dow, tashkentTime(now))],
    });
    expect(isShopOpenNow(shop, now)).toBe(true);
  });

  it('openTime chegarasida ochiq deb hisoblanadi (inclusive)', () => {
    const now = new Date();
    const dow = tashkentWeekday(now);
    const currentTime = tashkentTime(now);
    const shop = makeShop({
      workingHours: [{ dayOfWeek: dow as WorkingHourSlot['dayOfWeek'], openTime: currentTime, closeTime: '23:59', isOpen: true }],
    });
    expect(isShopOpenNow(shop, now)).toBe(true);
  });

  it('closeTime chegarasida ham ochiq deb hisoblanadi (inclusive)', () => {
    const now = new Date();
    const dow = tashkentWeekday(now);
    const currentTime = tashkentTime(now);
    const shop = makeShop({
      workingHours: [{ dayOfWeek: dow as WorkingHourSlot['dayOfWeek'], openTime: '00:00', closeTime: currentTime, isOpen: true }],
    });
    expect(isShopOpenNow(shop, now)).toBe(true);
  });

  it('ish vaqtidan tashqarida yopiq', () => {
    const now = new Date();
    const dow = tashkentWeekday(now);
    const shop = makeShop({
      workingHours: [slotAround(dow, tashkentTime(now), { openTime: '00:00', closeTime: '00:01' })],
    });
    // Only matches if "now" happens to be within the first minute after midnight —
    // astronomically unlikely, and even then the test is still correct either way.
    const expected = tashkentTime(now) <= '00:01';
    expect(isShopOpenNow(shop, now)).toBe(expected);
  });

  describe('timezone to\'g\'riligi (Asia/Tashkent, server TZ dan mustaqil)', () => {
    it('Tashkentda kun UTC dan oldin boshlansa, to\'g\'ri (Tashkent) haftaning kunidan foydalanadi', () => {
      // 20:15 UTC → 01:15 next day in Tashkent (UTC+5) — UTC-day and
      // Tashkent-day are guaranteed to differ (off by exactly one weekday).
      const now = new Date('2026-03-10T20:15:00.000Z');
      const utcDow = now.getUTCDay();
      const tzDow = tashkentWeekday(now);
      expect(tzDow).toBe((utcDow + 1) % 7);

      const shop = makeShop({
        workingHours: [
          // The UTC weekday's slot is CLOSED — a UTC-based implementation
          // would incorrectly read this one and report closed.
          { dayOfWeek: utcDow as WorkingHourSlot['dayOfWeek'], openTime: '00:00', closeTime: '23:59', isOpen: false },
          // The real Tashkent weekday's slot is OPEN and covers 01:15.
          { dayOfWeek: tzDow as WorkingHourSlot['dayOfWeek'], openTime: '00:00', closeTime: '23:59', isOpen: true },
        ],
      });

      expect(isShopOpenNow(shop, now)).toBe(true);
    });

    it('aksincha: UTC kuni ochiq bo\'lsa-da, Tashkent kuni yopiq bo\'lsa — yopiq', () => {
      const now = new Date('2026-03-10T20:15:00.000Z');
      const utcDow = now.getUTCDay();
      const tzDow = tashkentWeekday(now);

      const shop = makeShop({
        workingHours: [
          // UTC weekday wide-open — a UTC-based implementation would
          // incorrectly report open.
          { dayOfWeek: utcDow as WorkingHourSlot['dayOfWeek'], openTime: '00:00', closeTime: '23:59', isOpen: true },
          // The real Tashkent weekday is explicitly closed.
          { dayOfWeek: tzDow as WorkingHourSlot['dayOfWeek'], openTime: '00:00', closeTime: '23:59', isOpen: false },
        ],
      });

      expect(isShopOpenNow(shop, now)).toBe(false);
    });

    it('yarim tunni (00:00 Tashkent) xatosiz boshqaradi', () => {
      // 19:00 UTC → exactly 00:00 the next day in Tashkent.
      const now = new Date('2026-03-10T19:00:00.000Z');
      const tzDow = tashkentWeekday(now);
      expect(tashkentTime(now)).toBe('00:00');

      const shop = makeShop({
        workingHours: [{ dayOfWeek: tzDow as WorkingHourSlot['dayOfWeek'], openTime: '00:00', closeTime: '23:59', isOpen: true }],
      });

      expect(isShopOpenNow(shop, now)).toBe(true);
    });

    it('bugungi (Tashkent) sana holidays bilan solishtiriladi, UTC sana bilan emas', () => {
      const now = new Date('2026-03-10T20:15:00.000Z'); // Tashkent date is 2026-03-11
      const tzDow = tashkentWeekday(now);
      const utcDateStr = now.toISOString().split('T')[0]; // '2026-03-10'

      const shop = makeShop({
        workingHours: [{ dayOfWeek: tzDow as WorkingHourSlot['dayOfWeek'], openTime: '00:00', closeTime: '23:59', isOpen: true }],
        // Marks the UTC date (not the real Tashkent date) as a holiday — must NOT apply.
        holidays: [{ date: utcDateStr }],
      });

      expect(isShopOpenNow(shop, now)).toBe(true);
    });
  });
});

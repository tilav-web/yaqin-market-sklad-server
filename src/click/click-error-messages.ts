/**
 * Known Click Merchant API `error_code` values, mapped to a user-facing
 * Uzbek message. Click's own `error_note` comes back in Russian and isn't
 * routed through our i18n — codes not listed here fall back to that raw
 * note. Extend this as new codes are observed in production (see
 * ClickPaymentTransaction.errorCode/errorNote for the history).
 */
const CLICK_ERROR_MESSAGES: Record<number, string> = {
  [-125]: "To'lov tizimi hozircha ushbu do'kon uchun faol emas, administratorga murojaat qiling",
};

export function mapClickErrorMessage(errorCode: number, errorNote: string): string {
  return CLICK_ERROR_MESSAGES[errorCode] ?? errorNote ?? 'Click xatosi';
}

import { latinToCyrillic } from '../utils/transliteration.util';

export interface LocalizedText {
  uz: string;
  kr: string;
  ru: string;
}

export type LocalizedInput = string | Partial<LocalizedText> | null | undefined;

/**
 * Har qanday kiritilgan qiymatni (string yoki qisman {uz, kr, ru}) to'liq
 * LocalizedText { uz, kr, ru } jsonb formatiga o'tkazadi va avtomatik
 * Lotin -> Kirill transliteratsiyasini amalga oshiradi.
 */
export function toLocalizedText(
  val: LocalizedInput,
  fallback = '',
): LocalizedText {
  if (!val) {
    const fb = fallback.trim();
    return { uz: fb, kr: fb ? latinToCyrillic(fb) : '', ru: fb };
  }

  if (typeof val === 'string') {
    const trimmed = val.trim();
    return {
      uz: trimmed,
      kr: trimmed ? latinToCyrillic(trimmed) : '',
      ru: trimmed,
    };
  }

  const uz = val.uz?.trim() || fallback.trim();
  const kr = val.kr?.trim() || (uz ? latinToCyrillic(uz) : '');
  const ru = val.ru?.trim() || uz;

  return { uz, kr, ru };
}

/**
 * LocalizedText dan kerakli tildagi matnni ajratib oladi (fallback bilan).
 */
export function getLocalizedText(
  val?: LocalizedText | string | null,
  lang: 'uz' | 'kr' | 'ru' = 'uz',
): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  return val[lang] || val.uz || val.ru || val.kr || '';
}

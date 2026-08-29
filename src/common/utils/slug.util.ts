/**
 * SEO-friendly slug utility for Yaqin Market.
 * Converts Uzbek Latin, Cyrillic, and Russian strings into clean, URL-safe kebab-case slugs.
 */

const CYRL_TO_LATN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh',
  ъ: '', ь: '', э: 'e', ю: 'yu', я: 'ya', ғ: 'g', қ: 'q', ҳ: 'h', ў: 'o',
};

export function slugify(text: string | null | undefined): string {
  if (!text) return '';

  let str = String(text).trim().toLowerCase();

  // Normalize Uzbek specific apostrophes (o', g', etc.)
  str = str.replace(/[ʻʼ`‘’´']/g, '');

  // Convert Cyrillic characters to Latin equivalents
  str = str
    .split('')
    .map((char) => CYRL_TO_LATN[char] ?? char)
    .join('');

  // Replace symbols like %, +, &, / with meaningful hyphens or text
  str = str
    .replace(/%/g, 'foiz')
    .replace(/\+/g, 'plus')
    .replace(/&/g, 'va')
    .replace(/[/\\_.]/g, '-');

  // Remove any remaining non-alphanumeric characters except hyphen
  str = str.replace(/[^a-z0-9-]/g, '-');

  // Collapse consecutive hyphens and trim from ends
  str = str.replace(/-+/g, '-').replace(/^-|-$/g, '');

  return str;
}

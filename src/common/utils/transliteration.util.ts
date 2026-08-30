/**
 * O'zbek tili Lotin va Kirill alifbolari orasida ikki tomonlama (bidirectional)
 * transliteratsiya funksiyalari.
 */

// Digraph mappings (Lotin -> Kirill)
const LATIN_TO_CYRILLIC_DIGRAPHS: [RegExp, string][] = [
  // Bosh harflar
  [/Sh/g, 'Ш'],
  [/SH/g, 'Ш'],
  [/sh/g, 'ш'],
  [/Ch/g, 'Ч'],
  [/CH/g, 'Ч'],
  [/ch/g, 'ч'],
  [/Yo/g, 'Ё'],
  [/YO/g, 'Ё'],
  [/yo/g, 'ё'],
  [/Yu/g, 'Ю'],
  [/YU/g, 'Ю'],
  [/yu/g, 'ю'],
  [/Ya/g, 'Я'],
  [/YA/g, 'Я'],
  [/ya/g, 'я'],
  [/Ye/g, 'Е'],
  [/YE/g, 'Е'],
  [/ye/g, 'е'],
  [/Ts/g, 'Ц'],
  [/TS/g, 'Ц'],
  [/ts/g, 'ц'],

  // O' va G' turli apostroflar bilan
  [/O['`‘ʻ’]/g, 'Ў'],
  [/o['`‘ʻ’]/g, 'ў'],
  [/G['`‘ʻ’]/g, 'Ғ'],
  [/g['`‘ʻ’]/g, 'ғ'],
];

// Single letter mapping (Lotin -> Kirill)
const LATIN_TO_CYRILLIC_MAP: Record<string, string> = {
  a: 'а',
  A: 'А',
  b: 'б',
  B: 'Б',
  d: 'д',
  D: 'Д',
  e: 'е',
  E: 'Е',
  f: 'ф',
  F: 'Ф',
  g: 'г',
  G: 'Г',
  h: 'ҳ',
  H: 'Ҳ',
  i: 'и',
  I: 'И',
  j: 'ж',
  J: 'Ж',
  k: 'к',
  K: 'К',
  l: 'л',
  L: 'Л',
  m: 'м',
  M: 'М',
  n: 'н',
  N: 'Н',
  o: 'о',
  O: 'О',
  p: 'п',
  P: 'П',
  q: 'қ',
  Q: 'Қ',
  r: 'р',
  R: 'Р',
  s: 'с',
  S: 'С',
  t: 'т',
  T: 'Т',
  u: 'у',
  U: 'У',
  v: 'в',
  V: 'В',
  x: 'х',
  X: 'Х',
  y: 'й',
  Y: 'Й',
  z: 'з',
  Z: 'З',
  "'": 'ъ',
  '’': 'ъ',
  '‘': 'ъ',
  ʻ: 'ъ',
};

// Cyrillic to Latin digraphs & special letters
const CYRILLIC_TO_LATIN_MAP: Record<string, string> = {
  ш: 'sh',
  Ш: 'Sh',
  ч: 'ch',
  Ч: 'Ch',
  ё: 'yo',
  Ё: 'Yo',
  ю: 'yu',
  Ю: 'Yu',
  я: 'ya',
  Я: 'Ya',
  ў: "o'",
  Ў: "O'",
  ғ: "g'",
  Ғ: "G'",
  қ: 'q',
  Қ: 'Q',
  ҳ: 'h',
  Ҳ: 'H',
  х: 'x',
  Х: 'X',
  ц: 'ts',
  Ц: 'Ts',
  а: 'a',
  А: 'A',
  б: 'b',
  Б: 'B',
  в: 'v',
  В: 'V',
  г: 'g',
  Г: 'G',
  д: 'd',
  Д: 'D',
  е: 'e',
  Е: 'E',
  ж: 'j',
  Ж: 'J',
  з: 'z',
  З: 'Z',
  и: 'i',
  И: 'I',
  й: 'y',
  Й: 'Y',
  к: 'k',
  К: 'K',
  л: 'l',
  Л: 'L',
  м: 'm',
  М: 'M',
  н: 'n',
  Н: 'N',
  о: 'o',
  О: 'O',
  п: 'p',
  П: 'P',
  р: 'r',
  Р: 'R',
  с: 's',
  С: 'S',
  т: 't',
  Т: 'T',
  у: 'u',
  У: 'U',
  ф: 'f',
  Ф: 'F',
  э: 'e',
  Э: 'E',
  ъ: "'",
  Ъ: "'",
  ь: '',
  Ь: '',
};

/**
 * Lotin alifbosidagi matnni Kirill alifbosiga o'giradi.
 */
export function latinToCyrillic(text: string): string {
  if (!text) return '';

  let res = text;

  // 1. So'z boshidagi 'E' / 'e' larni 'Э' / 'э' ga o'girish
  res = res.replace(/(^|\s|[.,!?;:«"(]|\[)[Ee]/g, (match, prefix) => {
    const char = match.slice(prefix.length);
    return prefix + (char === 'E' ? 'Э' : 'э');
  });

  // 2. Ikki harfli birikmalarni almashtirish (Sh, Ch, Yo, Yu, Ya, O', G'...)
  for (const [regex, cyr] of LATIN_TO_CYRILLIC_DIGRAPHS) {
    res = res.replace(regex, cyr);
  }

  // 3. Qolgan yagona harflarni almashtirish
  let out = '';
  for (let i = 0; i < res.length; i++) {
    const char = res[i];
    out +=
      LATIN_TO_CYRILLIC_MAP[char] !== undefined
        ? LATIN_TO_CYRILLIC_MAP[char]
        : char;
  }

  return out;
}

/**
 * Kirill alifbosidagi matnni Lotin alifbosiga o'giradi.
 */
export function cyrillicToLatin(text: string): string {
  if (!text) return '';

  let out = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    // So'z boshidagi 'Е' / 'е' -> 'Ye' / 'ye'
    if (
      (char === 'е' || char === 'Е') &&
      (i === 0 || /\s|[.,!?;:«"(]|\[/.test(text[i - 1]))
    ) {
      out += char === 'Е' ? 'Ye' : 'ye';
    } else if (CYRILLIC_TO_LATIN_MAP[char] !== undefined) {
      out += CYRILLIC_TO_LATIN_MAP[char];
    } else {
      out += char;
    }
  }

  return out;
}

/**
 * Additive Qarshi demo seed for Yaqin Market (investor demo).
 *
 * Run with:  npm run seed:qarshi
 *
 * Unlike mock-data.ts this DOES NOT wipe the database. It adds ~46 shops laid
 * out on a ~1 km grid across Qarshi city so a customer logging in from anywhere
 * in town has shops within the 1 km delivery range. Each shop gets a real photo,
 * staff, working hours, a delivery zone (max 1 km, mix of free + paid), and a
 * catalog of products with stock and per-product photos. Images are downloaded
 * once and self-hosted in MinIO (served back through /api/uploads).
 *
 * Safe to run on production: it preserves existing users (incl. the super admin)
 * and aborts if shops already exist.
 */
import 'reflect-metadata';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { Client as MinioClient } from 'minio';
import { DataSource } from 'typeorm';

import { TaxCategory } from '../fiscal/entities/tax-category.entity';
import { toLocalizedText } from '../common/types/localized-text.type';
import { Category } from '../categories/entities/category.entity';
import {
  InventoryMovement,
  MovementType,
} from '../products/entities/inventory-movement.entity';
import {
  GlobalProduct,
  UnitType,
} from '../products/entities/global-product.entity';
import { ProductVariant } from '../products/entities/product-variant.entity';
import { StockBatch } from '../products/entities/stock-batch.entity';
import {
  PRESET_PERMISSIONS,
  ShopStaff,
} from '../shops/entities/shop-staff.entity';
import {
  DeliveryPricingType,
  Shop,
  WorkingHourSlot,
} from '../shops/entities/shop.entity';
import { User, UserStatus } from '../users/entities/user.entity';

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------
const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  username: process.env.POSTGRES_USER ?? 'yaqin',
  password: process.env.POSTGRES_PASSWORD ?? 'yaqin_dev_password',
  database: process.env.POSTGRES_DB ?? 'yaqin_market',
  entities: [
    Category,
    TaxCategory,
    Shop,
    ShopStaff,
    GlobalProduct,
    ProductVariant,
    StockBatch,
    InventoryMovement,
    User,
  ],
  synchronize: false,
  logging: ['error'],
});

// ---------------------------------------------------------------------------
// MinIO (self-host downloaded demo images)
// ---------------------------------------------------------------------------
const minio = new MinioClient({
  endPoint: process.env.MINIO_ENDPOINT ?? '127.0.0.1',
  port: Number(process.env.MINIO_PORT ?? 9100),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY ?? '',
  secretKey: process.env.MINIO_SECRET_KEY ?? '',
});
const BUCKET = process.env.MINIO_BUCKET ?? 'yaqin-uploads';
const imgCache = new Map<string, string>();

async function fetchImage(keyword: string, lock: number): Promise<Buffer> {
  const urls = [
    `https://loremflickr.com/600/600/${encodeURIComponent(keyword)}?lock=${lock}`,
    `https://picsum.photos/seed/${encodeURIComponent(keyword + lock)}/600/600`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 2000) return buf;
    } catch {
      /* try next source */
    }
  }
  throw new Error('all image sources failed');
}

/** Download a keyword image once, store in MinIO, return its /api/uploads path. */
async function seedImage(
  name: string,
  keyword: string,
  lock: number,
): Promise<string> {
  const cached = imgCache.get(name);
  if (cached) return cached;
  const key = `seed/${name}.jpg`;
  const apiPath = `/api/uploads/${key}`;
  try {
    let exists = false;
    try {
      await minio.statObject(BUCKET, key);
      exists = true;
    } catch {
      /* not uploaded yet */
    }
    if (!exists) {
      const buf = await fetchImage(keyword, lock);
      await minio.putObject(BUCKET, key, buf, buf.length, {
        'Content-Type': 'image/jpeg',
      });
    }
    imgCache.set(name, apiPath);
    return apiPath;
  } catch (e) {
    const fb = `https://placehold.co/600x600/0046AD/FFFFFF?text=${encodeURIComponent(name)}`;
    console.warn(`  ⚠️ image "${name}" fallback: ${(e as Error).message}`);
    imgCache.set(name, fb);
    return fb;
  }
}

// ---------------------------------------------------------------------------
// Geo: Qarshi city centre + grid
// ---------------------------------------------------------------------------
const CENTER = { lat: 38.8611918, lng: 65.7847269 }; // Qarshi (Google place centre)
const KM_PER_DEG_LAT = 111;
const KM_PER_DEG_LNG = 86.4; // at lat ~38.86
function offset(north: number, east: number) {
  return {
    lat: CENTER.lat + north / KM_PER_DEG_LAT,
    lng: CENTER.lng + east / KM_PER_DEG_LNG,
  };
}

// Deterministic PRNG so reseeds produce stable data.
let _seed = 0x51ed270b;
function rnd(): number {
  _seed = (_seed * 1103515245 + 12345) & 0x7fffffff;
  return _seed / 0x7fffffff;
}
const randInt = (min: number, max: number) =>
  Math.floor(rnd() * (max - min + 1)) + min;
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];

const round500 = (n: number) => Math.round(n / 500) * 500;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
interface CatNode {
  slug: string;
  uz: string;
  cy: string;
  ru: string;
  children?: CatNode[];
}
const CATEGORY_TREE: CatNode[] = [
  {
    slug: 'oziq-ovqat',
    uz: 'Oziq-ovqat',
    cy: 'Озиқ-овқат',
    ru: 'Продукты',
    children: [
      {
        slug: 'sut-mahsulotlari',
        uz: 'Sut mahsulotlari',
        cy: 'Сут маҳсулотлари',
        ru: 'Молочные продукты',
      },
      {
        slug: 'non-nonvoy',
        uz: 'Non va nonvoy',
        cy: 'Нон ва нонвой',
        ru: 'Хлеб и выпечка',
      },
      {
        slug: 'gosht-parranda',
        uz: "Go'sht va parranda",
        cy: 'Гўшт ва парранда',
        ru: 'Мясо и птица',
      },
      { slug: 'mevalar', uz: 'Mevalar', cy: 'Мевалар', ru: 'Фрукты' },
      {
        slug: 'sabzavotlar',
        uz: 'Sabzavotlar',
        cy: 'Сабзавотлар',
        ru: 'Овощи',
      },
      { slug: 'bakaleya', uz: 'Bakaleya', cy: 'Бакалея', ru: 'Бакалея' },
      {
        slug: 'shirinliklar',
        uz: 'Shirinliklar',
        cy: 'Ширинликлар',
        ru: 'Сладости',
      },
    ],
  },
  {
    slug: 'ichimliklar',
    uz: 'Ichimliklar',
    cy: 'Ичимликлар',
    ru: 'Напитки',
    children: [
      {
        slug: 'suv-gazli',
        uz: 'Suv va gazli ichimliklar',
        cy: 'Сув ва газли ичимликлар',
        ru: 'Вода и газировка',
      },
      { slug: 'sharbatlar', uz: 'Sharbatlar', cy: 'Шарбатлар', ru: 'Соки' },
      {
        slug: 'choy-kofe',
        uz: 'Choy va kofe',
        cy: 'Чой ва кофе',
        ru: 'Чай и кофе',
      },
    ],
  },
  {
    slug: 'uy-rozgor',
    uz: "Uy-ro'zg'or",
    cy: 'Уй-рўзғор',
    ru: 'Для дома',
    children: [
      {
        slug: 'gigiena',
        uz: 'Shaxsiy gigiena',
        cy: 'Шахсий гигиена',
        ru: 'Гигиена',
      },
      {
        slug: 'tozalash',
        uz: 'Tozalash vositalari',
        cy: 'Тозалаш воситалари',
        ru: 'Бытовая химия',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Product catalog (image keyword + variants)
// Each entry maps to GlobalProduct(s) shared across shops.
// ---------------------------------------------------------------------------
interface VarTpl {
  label: string;
  unitType: UnitType;
  unitSize: number;
  price: number;
  discount?: number;
}
interface ProdTpl {
  key: string;
  family: string;
  brand?: string;
  cat: string;
  kw: string;
  desc?: string;
  variants: VarTpl[];
}

const CATALOG: ProdTpl[] = [
  {
    key: 'sut',
    family: 'Sut',
    brand: 'Nestlé',
    cat: 'sut-mahsulotlari',
    kw: 'milk,bottle',
    desc: 'Tabiiy pasterizatsiyalangan sut',
    variants: [
      { label: 'Sut 0.5L', unitType: 'liter', unitSize: 0.5, price: 7000 },
      { label: 'Sut 1L', unitType: 'liter', unitSize: 1, price: 12000 },
    ],
  },
  {
    key: 'qatiq',
    family: 'Qatiq',
    brand: 'Milline',
    cat: 'sut-mahsulotlari',
    kw: 'yogurt',
    variants: [
      { label: 'Qatiq 0.5L', unitType: 'liter', unitSize: 0.5, price: 8000 },
    ],
  },
  {
    key: 'smetana',
    family: 'Smetana',
    cat: 'sut-mahsulotlari',
    kw: 'sour,cream',
    variants: [
      { label: 'Smetana 400g', unitType: 'gram', unitSize: 400, price: 15000 },
    ],
  },
  {
    key: 'tvorog',
    family: 'Tvorog',
    cat: 'sut-mahsulotlari',
    kw: 'cottage,cheese',
    variants: [
      { label: 'Tvorog 500g', unitType: 'gram', unitSize: 500, price: 22000 },
    ],
  },
  {
    key: 'pishloq',
    family: 'Pishloq',
    cat: 'sut-mahsulotlari',
    kw: 'cheese',
    variants: [
      { label: 'Pishloq 300g', unitType: 'gram', unitSize: 300, price: 28000 },
    ],
  },
  {
    key: 'sariyog',
    family: "Sariyog'",
    cat: 'sut-mahsulotlari',
    kw: 'butter',
    variants: [
      { label: "Sariyog' 200g", unitType: 'gram', unitSize: 200, price: 18000 },
    ],
  },
  {
    key: 'non',
    family: 'Oddiy non',
    cat: 'non-nonvoy',
    kw: 'flatbread,bread',
    desc: 'Tandirda yopilgan issiq non',
    variants: [
      { label: 'Oddiy non', unitType: 'piece', unitSize: 1, price: 2500 },
    ],
  },
  {
    key: 'bulochka',
    family: 'Bulochka',
    cat: 'non-nonvoy',
    kw: 'bun,bakery',
    variants: [
      { label: 'Bulochka', unitType: 'piece', unitSize: 1, price: 1500 },
    ],
  },
  {
    key: 'lavash',
    family: 'Lavash',
    cat: 'non-nonvoy',
    kw: 'lavash,wrap',
    variants: [
      { label: 'Lavash', unitType: 'piece', unitSize: 1, price: 3000 },
    ],
  },
  {
    key: 'mol',
    family: "Mol go'shti",
    cat: 'gosht-parranda',
    kw: 'beef,meat',
    desc: "Yangi mol go'shti",
    variants: [
      { label: "Mol go'shti 1kg", unitType: 'kg', unitSize: 1, price: 95000 },
    ],
  },
  {
    key: 'tovuq',
    family: "Tovuq go'shti",
    cat: 'gosht-parranda',
    kw: 'chicken,raw',
    variants: [
      {
        label: "Tovuq go'shti 1kg",
        unitType: 'kg',
        unitSize: 1,
        price: 38000,
        discount: 34000,
      },
    ],
  },
  {
    key: 'tuxum',
    family: 'Tuxum',
    cat: 'gosht-parranda',
    kw: 'eggs',
    variants: [
      { label: 'Tuxum 10 dona', unitType: 'pack', unitSize: 10, price: 16000 },
    ],
  },
  {
    key: 'kolbasa',
    family: 'Kolbasa',
    cat: 'gosht-parranda',
    kw: 'sausage',
    variants: [
      { label: 'Kolbasa 400g', unitType: 'gram', unitSize: 400, price: 32000 },
    ],
  },
  {
    key: 'olma',
    family: 'Olma',
    cat: 'mevalar',
    kw: 'apple,fruit',
    variants: [
      { label: 'Olma 1kg', unitType: 'kg', unitSize: 1, price: 12000 },
    ],
  },
  {
    key: 'banan',
    family: 'Banan',
    cat: 'mevalar',
    kw: 'banana',
    variants: [
      { label: 'Banan 1kg', unitType: 'kg', unitSize: 1, price: 22000 },
    ],
  },
  {
    key: 'apelsin',
    family: 'Apelsin',
    cat: 'mevalar',
    kw: 'orange,fruit',
    variants: [
      {
        label: 'Apelsin 1kg',
        unitType: 'kg',
        unitSize: 1,
        price: 18000,
        discount: 15000,
      },
    ],
  },
  {
    key: 'uzum',
    family: 'Uzum',
    cat: 'mevalar',
    kw: 'grapes',
    variants: [
      { label: 'Uzum 1kg', unitType: 'kg', unitSize: 1, price: 20000 },
    ],
  },
  {
    key: 'kartoshka',
    family: 'Kartoshka',
    cat: 'sabzavotlar',
    kw: 'potato',
    variants: [
      { label: 'Kartoshka 1kg', unitType: 'kg', unitSize: 1, price: 6000 },
    ],
  },
  {
    key: 'piyoz',
    family: 'Piyoz',
    cat: 'sabzavotlar',
    kw: 'onion',
    variants: [
      { label: 'Piyoz 1kg', unitType: 'kg', unitSize: 1, price: 5000 },
    ],
  },
  {
    key: 'pomidor',
    family: 'Pomidor',
    cat: 'sabzavotlar',
    kw: 'tomato',
    variants: [
      { label: 'Pomidor 1kg', unitType: 'kg', unitSize: 1, price: 14000 },
    ],
  },
  {
    key: 'bodring',
    family: 'Bodring',
    cat: 'sabzavotlar',
    kw: 'cucumber',
    variants: [
      { label: 'Bodring 1kg', unitType: 'kg', unitSize: 1, price: 12000 },
    ],
  },
  {
    key: 'sabzi',
    family: 'Sabzi',
    cat: 'sabzavotlar',
    kw: 'carrot',
    variants: [
      { label: 'Sabzi 1kg', unitType: 'kg', unitSize: 1, price: 7000 },
    ],
  },
  {
    key: 'guruch',
    family: 'Guruch',
    brand: 'Laser',
    cat: 'bakaleya',
    kw: 'rice,bag',
    variants: [
      { label: 'Guruch 1kg', unitType: 'kg', unitSize: 1, price: 18000 },
      {
        label: 'Guruch 5kg',
        unitType: 'kg',
        unitSize: 5,
        price: 85000,
        discount: 79000,
      },
    ],
  },
  {
    key: 'makaron',
    family: 'Makaron',
    brand: 'Makfa',
    cat: 'bakaleya',
    kw: 'pasta',
    variants: [
      { label: 'Makaron 450g', unitType: 'gram', unitSize: 450, price: 9000 },
    ],
  },
  {
    key: 'yog',
    family: "O'simlik yog'i",
    brand: 'Oleyna',
    cat: 'bakaleya',
    kw: 'cooking,oil',
    variants: [
      { label: "Yog' 1L", unitType: 'liter', unitSize: 1, price: 24000 },
    ],
  },
  {
    key: 'un',
    family: 'Un',
    brand: 'Oltin Boshoq',
    cat: 'bakaleya',
    kw: 'flour',
    variants: [{ label: 'Un 2kg', unitType: 'kg', unitSize: 2, price: 16000 }],
  },
  {
    key: 'shakar',
    family: 'Shakar',
    cat: 'bakaleya',
    kw: 'sugar',
    variants: [
      { label: 'Shakar 1kg', unitType: 'kg', unitSize: 1, price: 12000 },
    ],
  },
  {
    key: 'tuz',
    family: 'Tuz',
    cat: 'bakaleya',
    kw: 'salt',
    variants: [{ label: 'Tuz 1kg', unitType: 'kg', unitSize: 1, price: 3000 }],
  },
  {
    key: 'snickers',
    family: 'Snickers',
    brand: 'Mars',
    cat: 'shirinliklar',
    kw: 'chocolate,bar',
    variants: [
      { label: 'Snickers 50g', unitType: 'piece', unitSize: 1, price: 6000 },
    ],
  },
  {
    key: 'pechenye',
    family: 'Pechenye',
    cat: 'shirinliklar',
    kw: 'cookies',
    variants: [
      { label: 'Pechenye 300g', unitType: 'pack', unitSize: 1, price: 12000 },
    ],
  },
  {
    key: 'konfet',
    family: 'Konfet',
    brand: 'Roshen',
    cat: 'shirinliklar',
    kw: 'candy,sweets',
    variants: [
      { label: 'Konfet 1kg', unitType: 'kg', unitSize: 1, price: 45000 },
    ],
  },
  {
    key: 'shokolad',
    family: 'Shokolad',
    brand: 'Milka',
    cat: 'shirinliklar',
    kw: 'chocolate',
    variants: [
      { label: 'Shokolad 90g', unitType: 'piece', unitSize: 1, price: 14000 },
    ],
  },
  {
    key: 'choy',
    family: 'Choy',
    brand: 'Lipton',
    cat: 'choy-kofe',
    kw: 'tea,box',
    variants: [
      { label: 'Choy 100g', unitType: 'gram', unitSize: 100, price: 15000 },
    ],
  },
  {
    key: 'kofe',
    family: 'Kofe',
    brand: 'Nescafé',
    cat: 'choy-kofe',
    kw: 'coffee',
    variants: [
      { label: 'Kofe 100g', unitType: 'gram', unitSize: 100, price: 35000 },
    ],
  },
  {
    key: 'cola',
    family: 'Coca-Cola',
    brand: 'Coca-Cola',
    cat: 'suv-gazli',
    kw: 'cola,bottle',
    variants: [
      {
        label: 'Coca-Cola 0.5L',
        unitType: 'liter',
        unitSize: 0.5,
        price: 6000,
      },
      {
        label: 'Coca-Cola 1.5L',
        unitType: 'liter',
        unitSize: 1.5,
        price: 12000,
      },
    ],
  },
  {
    key: 'suv',
    family: 'Suv',
    brand: 'Hilol',
    cat: 'suv-gazli',
    kw: 'water,bottle',
    variants: [
      { label: 'Suv 1.5L', unitType: 'liter', unitSize: 1.5, price: 3000 },
    ],
  },
  {
    key: 'pepsi',
    family: 'Pepsi',
    brand: 'Pepsi',
    cat: 'suv-gazli',
    kw: 'soda,bottle',
    variants: [
      { label: 'Pepsi 1L', unitType: 'liter', unitSize: 1, price: 9000 },
    ],
  },
  {
    key: 'sharbat',
    family: 'Sharbat',
    brand: 'Yashnabod',
    cat: 'sharbatlar',
    kw: 'juice',
    variants: [
      { label: 'Sharbat 1L', unitType: 'liter', unitSize: 1, price: 11000 },
    ],
  },
  {
    key: 'sovun',
    family: 'Sovun',
    brand: 'Safeguard',
    cat: 'gigiena',
    kw: 'soap',
    variants: [{ label: 'Sovun', unitType: 'piece', unitSize: 1, price: 5000 }],
  },
  {
    key: 'shampun',
    family: 'Shampun',
    brand: 'Head&Shoulders',
    cat: 'gigiena',
    kw: 'shampoo,bottle',
    variants: [
      { label: 'Shampun 400ml', unitType: 'gram', unitSize: 400, price: 38000 },
    ],
  },
  {
    key: 'tishpasta',
    family: 'Tish pastasi',
    brand: 'Colgate',
    cat: 'gigiena',
    kw: 'toothpaste',
    variants: [
      { label: 'Tish pastasi', unitType: 'piece', unitSize: 1, price: 16000 },
    ],
  },
  {
    key: 'kukun',
    family: 'Kir kukuni',
    brand: 'Ariel',
    cat: 'tozalash',
    kw: 'laundry,detergent',
    variants: [
      {
        label: 'Kir kukuni 1.5kg',
        unitType: 'kg',
        unitSize: 1.5,
        price: 42000,
        discount: 37000,
      },
    ],
  },
];

const SHOP_NAMES = [
  'Baraka Market',
  'Mehribon Oziq-ovqat',
  'Oltin Boshoq',
  'Nasaf Savdo',
  'Yetti Iqlim',
  'Hilol Market',
  'Diyor Market',
  'Bereka',
  "Anvar Aka Do'koni",
  'Sharq Bozori',
  'Qarshi Savdo',
  'Bunyodkor Market',
  'Oila Market',
  'Salom Oziq-ovqat',
  'Mega Store',
  'Tong Market',
  'Obod Market',
  'Marjon Market',
  'Chashma',
  'Dilshod Savdo',
  'Farovon',
  'Iqbol Market',
  'Yangi Hayot',
  'Bahor Market',
  'Mevazor',
  'Suvloq Market',
  'Guliston',
  'Nur Market',
  'Ziyo Savdo',
  'Asaka Market',
  'Olamhona',
  'Saxiy Market',
  'Barakali',
  'Quyosh Market',
  'Lola Market',
  'Toza Mahsulot',
  'Ekonom Market',
  'Express Market',
  'Qulaylik',
  'Hamkor Savdo',
  "Yaqin Do'kon",
  "Mo'jiza Market",
  'Sano Market',
  'Davr Market',
  'Istiqlol Savdo',
  'Buyuk Ipak',
  'Zilol Market',
  'Shifo Market',
  'Marhamat',
  'Suhrob Savdo',
];
const STREETS = [
  'Mustaqillik',
  'Amir Temur',
  'Nasaf',
  "Ulug'bek",
  'Bunyodkor',
  'Islom Karimov',
  'Shifokorlar',
  "G'allaorol",
  'Kohna Qala',
  'Beruniy',
  'Navoiy',
  'Mirzo Bobur',
];
const OWNER_NAMES = [
  'Akmal Karimov',
  "Sardor To'rayev",
  'Jasur Rahmonov',
  'Bobur Sodiqov',
  'Davron Ergashev',
  'Sherzod Qodirov',
  'Olim Yusupov',
  'Farrux Nazarov',
  "Ulug'bek Tosh",
  'Aziz Murodov',
  'Shavkat Hamroyev',
  'Rustam Berdiyev',
];
const STAFF_FIRST = [
  'Bahodir',
  'Anvar',
  'Dilshod',
  'Sanjar',
  'Otabek',
  'Jamshid',
  'Nodir',
  'Sherali',
  'Ravshan',
  'Kamol',
  "Ulug'bek",
  'Doston',
  'Sardor',
  'Bekzod',
  'Aybek',
];
const SHOP_IMG_KW = [
  'grocery,store',
  'supermarket',
  'shop,storefront',
  'market,fruit',
  'convenience,store',
  'bakery,shop',
  'fruit,market',
  'food,store',
  'minimarket',
  'vegetable,stand',
  'store,front',
  'grocery,shelf',
];

// Demo shops are 24/7 so the feed/map are populated whenever an investor opens
// the app (real neighbourhood shops in UZ are often round-the-clock anyway).
const ALWAYS_OPEN: WorkingHourSlot[] = ([0, 1, 2, 3, 4, 5, 6] as const).map(
  (d) => ({
    dayOfWeek: d,
    openTime: '00:00',
    closeTime: '23:59',
    isOpen: true,
  }),
);

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
async function seed() {
  await AppDataSource.initialize();
  console.log('🔌 Connected');

  const catRepo = AppDataSource.getTreeRepository(Category);
  const userRepo = AppDataSource.getRepository(User);
  const shopRepo = AppDataSource.getRepository(Shop);
  const staffRepo = AppDataSource.getRepository(ShopStaff);
  const gpRepo = AppDataSource.getRepository(GlobalProduct);
  const variantRepo = AppDataSource.getRepository(ProductVariant);
  const batchRepo = AppDataSource.getRepository(StockBatch);
  const moveRepo = AppDataSource.getRepository(InventoryMovement);

  // Guard: don't double-seed.
  const existingShops = await shopRepo.count();
  if (existingShops >= 40) {
    console.log(
      `⚠️ ${existingShops} shops already exist — aborting to avoid duplicates.`,
    );
    await AppDataSource.destroy();
    return;
  }

  // 1. Categories (create only missing) --------------------------------------
  const existingCats = await catRepo.find();
  const catBySlug = new Map<string, Category>(
    existingCats.map((c) => [c.slug, c]),
  );
  let sort = existingCats.length;
  for (const root of CATEGORY_TREE) {
    let parent = catBySlug.get(root.slug);
    if (!parent) {
      parent = await catRepo.save(
        catRepo.create({
          slug: root.slug,
          nameUzLatn: root.uz,
          nameUzCyrl: root.cy,
          nameRu: root.ru,
          sortOrder: sort++,
          parent: null,
        }),
      );
      catBySlug.set(root.slug, parent);
    }
    for (const child of root.children ?? []) {
      if (catBySlug.get(child.slug)) continue;
      const node = await catRepo.save(
        catRepo.create({
          slug: child.slug,
          nameUzLatn: child.uz,
          nameUzCyrl: child.cy,
          nameRu: child.ru,
          sortOrder: sort++,
          parent,
        }),
      );
      catBySlug.set(child.slug, node);
    }
  }
  console.log(`📂 Categories ready: ${catBySlug.size}`);

  // 2. Owners ----------------------------------------------------------------
  const owners: User[] = [];
  for (let i = 0; i < OWNER_NAMES.length; i++) {
    owners.push(
      await userRepo.save(
        userRepo.create({
          phone: `+9989031${String(i).padStart(5, '0')}`,
          name: OWNER_NAMES[i],
          isSellerApproved: true,
          roles: ['customer', 'seller'],
          status: UserStatus.Active,
        }),
      ),
    );
  }
  console.log(`👤 Owners: ${owners.length}`);

  // 3. Pre-fetch product images (once) ---------------------------------------
  console.log('🖼️  Fetching product images…');
  const prodImg = new Map<string, string>();
  for (let i = 0; i < CATALOG.length; i++) {
    prodImg.set(
      CATALOG[i].key,
      await seedImage(`prod-${CATALOG[i].key}`, CATALOG[i].kw, 100 + i),
    );
  }
  console.log('🖼️  Fetching shop images…');
  const shopImg: string[] = [];
  for (let i = 0; i < SHOP_IMG_KW.length; i++) {
    shopImg.push(await seedImage(`shop-${i}`, SHOP_IMG_KW[i], 500 + i));
  }

  // 4. Shared GlobalProduct catalogue (once, before shops) -------------------
  // Each variant template becomes one GlobalProduct shared across all shops.
  // Multi-variant families are size-grouped via parentGlobalProductId.
  const globalProductMap = new Map<string, GlobalProduct[]>(); // family key → [gp, ...]
  let gpCount = 0;
  for (const tpl of CATALOG) {
    const category = catBySlug.get(tpl.cat) ?? null;
    const photo = prodImg.get(tpl.key) ?? '';
    const familyGps: GlobalProduct[] = [];
    let parentId: string | null = null;

    for (let vi = 0; vi < tpl.variants.length; vi++) {
      const v = tpl.variants[vi];
      const gp: GlobalProduct = await gpRepo.save(
        gpRepo.create({
          name: toLocalizedText(v.label),
          brand: tpl.brand ?? null,
          unitType: v.unitType,
          unitSize: v.unitSize,
          categoryId: category?.id ?? null,
          photos: photo ? [photo] : [],
          description: tpl.desc ? toLocalizedText(tpl.desc) : null,
          barcode: null,
          isVerified: true,
          isActive: true,
          usageCount: 0,
          ownerShopId: null,
          parentGlobalProductId: vi === 0 ? null : parentId,
        }),
      );
      if (vi === 0) parentId = gp.id;
      familyGps.push(gp);
      gpCount++;
    }
    globalProductMap.set(tpl.key, familyGps);
  }
  console.log(`📋 Global products: ${gpCount}`);

  // 5. Shops on a ~1 km grid across the city ---------------------------------
  const GRID = 7; // 7x7
  const SPACING = 1.0; // km between grid points
  const placements: { north: number; east: number }[] = [];
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      placements.push({
        north: (r - (GRID - 1) / 2) * SPACING + (rnd() - 0.5) * 0.25,
        east: (c - (GRID - 1) / 2) * SPACING + (rnd() - 0.5) * 0.25,
      });
    }
  }
  const shopCount = Math.min(SHOP_NAMES.length, placements.length);

  let staffSeq = 0;
  let variantCount = 0;

  for (let si = 0; si < shopCount; si++) {
    const name = SHOP_NAMES[si];
    const owner = owners[si % owners.length];
    const loc = offset(placements[si].north, placements[si].east);

    const freeKm = pick([0.3, 0.5, 0.7, 1.0]);
    const fullyFree = freeKm >= 1.0;
    const pricingType: DeliveryPricingType = fullyFree
      ? 'flat'
      : pick(['per_500m', 'per_100m', 'per_km']);
    const pricePerStep = fullyFree ? 0 : pick([1000, 1500, 2000, 2500, 3000]);

    const shop = await shopRepo.save(
      shopRepo.create({
        ownerId: owner.id,
        name,
        description: pick([
          'Tez yetkazib berish, sifatli mahsulotlar.',
          'Mahalla aholisi uchun qulay narxlarda.',
          'Yangi va sifatli oziq-ovqat mahsulotlari.',
          'Ertalabdan kechgacha ochiq, keng tanlov.',
          'Ishonchli va tezkor xizmat.',
        ]),
        photos: [
          shopImg[si % shopImg.length],
          shopImg[(si + 3) % shopImg.length],
        ],
        address: `Qarshi, ${pick(STREETS)} ko'chasi ${randInt(1, 140)}`,
        latitude: loc.lat,
        longitude: loc.lng,
        workingHours: ALWAYS_OPEN,
        holidays: [],
        isOpenManual: true,
        minOrderPrice: pick([0, 0, 10000, 15000, 20000, 25000]),
        deliveryZone: { maxKm: 1, freeKm, pricingType, pricePerStep },
        blockedUserIds: [],
        isActive: true,
        ratingAverage: Math.round((4.1 + rnd() * 0.8) * 10) / 10,
        ratingCount: randInt(12, 280),
      }),
    );

    // Staff
    const mkStaff = async (
      preset: 'kassir' | 'yetkazib_beruvchi',
      role: string,
    ) => {
      const u = await userRepo.save(
        userRepo.create({
          phone: `+9989032${String(staffSeq++).padStart(5, '0')}`,
          name: `${pick(STAFF_FIRST)} ${pick(['Aka', 'Karimov', 'Tosh', 'Yusup', 'Bek'])}`,
          roles: ['customer', 'staff'],
          status: UserStatus.Active,
        }),
      );
      await staffRepo.save(
        staffRepo.create({
          shopId: shop.id,
          userId: u.id,
          customRoleName: role,
          preset,
          permissions: PRESET_PERMISSIONS[preset],
          isActive: true,
        }),
      );
    };
    await mkStaff('kassir', 'Kassir');
    if (rnd() > 0.25) await mkStaff('yetkazib_beruvchi', 'Yetkazib beruvchi');

    // Products: a rotating subset of the catalog, 12–20 GlobalProducts per shop.
    const count = randInt(12, 20);
    const start = (si * 5) % CATALOG.length;
    for (let i = 0; i < count; i++) {
      const tpl = CATALOG[(start + i) % CATALOG.length];
      const gps = globalProductMap.get(tpl.key) ?? [];
      const jitter = 0.92 + rnd() * 0.16;

      for (const gp of gps) {
        const nameUz = typeof gp.name === 'object' ? gp.name?.uz : gp.name;
        const vtpl =
          tpl.variants.find((v) => v.label === nameUz) ?? tpl.variants[0];
        const price = round500(vtpl.price * jitter);
        const discountPrice = vtpl.discount
          ? round500(vtpl.discount * jitter)
          : null;
        const stock = randInt(8, 200);

        const variant = await variantRepo.save(
          variantRepo.create({
            shopId: shop.id,
            globalProductId: gp.id,
            price,
            discountPrice,
            stock,
            lowStockThreshold: 5,
            expiryDate: null,
            isActive: true,
          }),
        );
        variantCount++;

        await batchRepo.save(
          batchRepo.create({
            productVariantId: variant.id,
            shopId: shop.id,
            costPrice: Math.round(price * 0.75),
            quantityReceived: stock,
            quantityRemaining: stock,
            expiryDate: null,
            receivedAt: new Date(),
            performedByUserId: owner.id,
          }),
        );

        await moveRepo.save(
          moveRepo.create({
            productVariantId: variant.id,
            type: MovementType.In,
            quantity: stock,
            beforeStock: 0,
            afterStock: stock,
            reason: "Boshlang'ich kirim",
            performedByUserId: owner.id,
          }),
        );

        await gpRepo.increment({ id: gp.id }, 'usageCount', 1);
      }
    }
    if ((si + 1) % 10 === 0) console.log(`  …${si + 1}/${shopCount} shops`);
  }

  console.log(`🏪 Shops: ${shopCount}`);
  console.log(`👥 Staff users: ${staffSeq}`);
  console.log(`📦 Variants: ${variantCount}`);
  console.log('✅ Qarshi demo seed complete');
  await AppDataSource.destroy();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});

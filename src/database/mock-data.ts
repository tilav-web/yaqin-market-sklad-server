/**
 * Comprehensive development seed for Yaqin Market.
 *
 * Run with:  npm run seed   (alias: npm run seed:mock)
 *
 * Wipes the database and inserts a realistic, geographically coherent dataset
 * centred on the test device's location (Qarshi, Kashkadarya). Every shop sits
 * within ~2 km of CENTER so the customer Home feed and map are populated.
 *
 * Login: any seeded phone number + the dev OTP (FIXED_OTP_CODE in .env).
 */
import 'reflect-metadata';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { DataSource } from 'typeorm';

import { haversineKm, calcDeliveryFee } from '../geo/geo.util';
import { Category } from '../categories/entities/category.entity';
import {
  Order,
  OrderStatus,
  PaymentMethod,
} from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { Review } from '../orders/entities/review.entity';
import {
  InventoryMovement,
  MovementType,
} from '../products/entities/inventory-movement.entity';
import { toLocalizedText } from '../common/types/localized-text.type';
import {
  GlobalProduct,
  UnitType,
} from '../products/entities/global-product.entity';
import { ProductVariant } from '../products/entities/product-variant.entity';
import { StockBatch } from '../products/entities/stock-batch.entity';
import {
  SellerApplication,
  SellerApplicationStatus,
} from '../sellers/entities/seller-application.entity';
import {
  PRESET_PERMISSIONS,
  ShopStaff,
} from '../shops/entities/shop-staff.entity';
import { Shop, WorkingHourSlot } from '../shops/entities/shop.entity';
import { TaxCategory } from '../fiscal/entities/tax-category.entity';
import { UserAddress } from '../users/entities/user-address.entity';
import { User, UserStatus } from '../users/entities/user.entity';
import { StaffInvitation } from '@/shops/entities/staff-invitation.entity';

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
    User,
    UserAddress,
    Category,
    TaxCategory,
    Shop,
    ShopStaff,
    StaffInvitation,
    SellerApplication,
    GlobalProduct,
    ProductVariant,
    StockBatch,
    InventoryMovement,
    Order,
    OrderItem,
    Review,
  ],
  synchronize: true,
  logging: ['error'],
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Test device location: Qarshi, Kashkadarya. */
const CENTER = { lat: 38.8446827, lng: 65.7803532 };

// At lat ~38.84: 1° lat ≈ 111 km, 1° lng ≈ 86.4 km.
const KM_PER_DEG_LAT = 111;
const KM_PER_DEG_LNG = 86.4;
function offset(km: { north: number; east: number }) {
  return {
    lat: CENTER.lat + km.north / KM_PER_DEG_LAT,
    lng: CENTER.lng + km.east / KM_PER_DEG_LNG,
  };
}

// Deterministic PRNG so reseeds produce stable data.
let _seed = 0x2f6e2b1;
function rnd(): number {
  _seed = (_seed * 1103515245 + 12345) & 0x7fffffff;
  return _seed / 0x7fffffff;
}
function randInt(min: number, max: number): number {
  return Math.floor(rnd() * (max - min + 1)) + min;
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length)];
}

const img = (text: string, bg = '0046AD') =>
  `https://placehold.co/600x600/${bg}/FFFFFF?text=${encodeURIComponent(text)}`;

const STD_HOURS: WorkingHourSlot[] = ([0, 1, 2, 3, 4, 5, 6] as const).map(
  (d) => ({
    dayOfWeek: d,
    openTime: '08:00',
    closeTime: '22:00',
    isOpen: true,
  }),
);

const orderNo = () => `YM-${Math.floor(rnd() * 900000 + 100000)}`;

// ---------------------------------------------------------------------------
// Category tree
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
// Product catalog
// Each entry becomes one or more GlobalProducts (one per variant label).
// Variants within the same family are size-grouped via parentGlobalProductId.
// ---------------------------------------------------------------------------
interface VariantTpl {
  label: string;
  unitType: UnitType;
  unitSize: number;
  price: number;
  discount?: number;
}
interface ProductTpl {
  family: string;
  brand?: string;
  categorySlug: string;
  desc?: string;
  bg?: string;
  variants: VariantTpl[];
}

const CATALOG: ProductTpl[] = [
  // Dairy
  {
    family: 'Sut',
    brand: 'Nestlé',
    categorySlug: 'sut-mahsulotlari',
    bg: '1E88E5',
    desc: 'Tabiiy pasterizatsiyalangan sut',
    variants: [
      { label: 'Sut 0.5L', unitType: 'liter', unitSize: 0.5, price: 7000 },
      { label: 'Sut 1L', unitType: 'liter', unitSize: 1, price: 12000 },
    ],
  },
  {
    family: 'Qatiq',
    brand: 'Milline',
    categorySlug: 'sut-mahsulotlari',
    bg: '1E88E5',
    variants: [
      { label: 'Qatiq 0.5L', unitType: 'liter', unitSize: 0.5, price: 8000 },
    ],
  },
  {
    family: 'Smetana',
    brand: 'Nestlé',
    categorySlug: 'sut-mahsulotlari',
    bg: '1E88E5',
    variants: [
      { label: 'Smetana 400g', unitType: 'gram', unitSize: 400, price: 15000 },
    ],
  },
  {
    family: 'Tvorog',
    categorySlug: 'sut-mahsulotlari',
    bg: '1E88E5',
    variants: [
      { label: 'Tvorog 500g', unitType: 'gram', unitSize: 500, price: 22000 },
    ],
  },
  // Bakery
  {
    family: 'Oddiy non',
    categorySlug: 'non-nonvoy',
    bg: 'C0853B',
    desc: 'Tandirda yopilgan issiq non',
    variants: [
      { label: 'Oddiy non', unitType: 'piece', unitSize: 1, price: 2500 },
    ],
  },
  {
    family: 'Bulochka',
    categorySlug: 'non-nonvoy',
    bg: 'C0853B',
    variants: [
      { label: 'Bulochka', unitType: 'piece', unitSize: 1, price: 1500 },
    ],
  },
  {
    family: 'Lavash',
    categorySlug: 'non-nonvoy',
    bg: 'C0853B',
    variants: [
      { label: 'Lavash', unitType: 'piece', unitSize: 1, price: 3000 },
    ],
  },
  // Meat
  {
    family: "Mol go'shti",
    categorySlug: 'gosht-parranda',
    bg: 'C62828',
    desc: 'Yangi mol goʼshti',
    variants: [
      { label: "Mol go'shti 1kg", unitType: 'kg', unitSize: 1, price: 95000 },
    ],
  },
  {
    family: "Tovuq go'shti",
    categorySlug: 'gosht-parranda',
    bg: 'C62828',
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
    family: 'Tuxum',
    categorySlug: 'gosht-parranda',
    bg: 'C62828',
    variants: [
      { label: 'Tuxum 10 dona', unitType: 'pack', unitSize: 10, price: 16000 },
    ],
  },
  // Fruits
  {
    family: 'Olma',
    categorySlug: 'mevalar',
    bg: '43A047',
    variants: [
      { label: 'Olma 1kg', unitType: 'kg', unitSize: 1, price: 12000 },
    ],
  },
  {
    family: 'Banan',
    categorySlug: 'mevalar',
    bg: '43A047',
    variants: [
      { label: 'Banan 1kg', unitType: 'kg', unitSize: 1, price: 22000 },
    ],
  },
  {
    family: 'Apelsin',
    categorySlug: 'mevalar',
    bg: '43A047',
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
  // Vegetables
  {
    family: 'Kartoshka',
    categorySlug: 'sabzavotlar',
    bg: '6D4C41',
    variants: [
      { label: 'Kartoshka 1kg', unitType: 'kg', unitSize: 1, price: 6000 },
    ],
  },
  {
    family: 'Piyoz',
    categorySlug: 'sabzavotlar',
    bg: '6D4C41',
    variants: [
      { label: 'Piyoz 1kg', unitType: 'kg', unitSize: 1, price: 5000 },
    ],
  },
  {
    family: 'Pomidor',
    categorySlug: 'sabzavotlar',
    bg: '6D4C41',
    variants: [
      { label: 'Pomidor 1kg', unitType: 'kg', unitSize: 1, price: 14000 },
    ],
  },
  {
    family: 'Bodring',
    categorySlug: 'sabzavotlar',
    bg: '6D4C41',
    variants: [
      { label: 'Bodring 1kg', unitType: 'kg', unitSize: 1, price: 12000 },
    ],
  },
  // Bakaleya
  {
    family: 'Guruch',
    brand: 'Laser',
    categorySlug: 'bakaleya',
    bg: '8D6E63',
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
    family: 'Makaron',
    brand: 'Makfa',
    categorySlug: 'bakaleya',
    bg: '8D6E63',
    variants: [
      { label: 'Makaron 450g', unitType: 'gram', unitSize: 450, price: 9000 },
    ],
  },
  {
    family: "O'simlik yog'i",
    brand: 'Oleyna',
    categorySlug: 'bakaleya',
    bg: '8D6E63',
    variants: [
      { label: "Yog' 1L", unitType: 'liter', unitSize: 1, price: 24000 },
    ],
  },
  {
    family: 'Un',
    brand: 'Oltin Boshoq',
    categorySlug: 'bakaleya',
    bg: '8D6E63',
    variants: [{ label: 'Un 2kg', unitType: 'kg', unitSize: 2, price: 16000 }],
  },
  {
    family: 'Shakar',
    categorySlug: 'bakaleya',
    bg: '8D6E63',
    variants: [
      { label: 'Shakar 1kg', unitType: 'kg', unitSize: 1, price: 12000 },
    ],
  },
  // Sweets
  {
    family: 'Snickers',
    brand: 'Mars',
    categorySlug: 'shirinliklar',
    bg: 'EC407A',
    variants: [
      { label: 'Snickers 50g', unitType: 'piece', unitSize: 1, price: 6000 },
    ],
  },
  {
    family: 'Oreo',
    categorySlug: 'shirinliklar',
    bg: 'EC407A',
    variants: [
      { label: 'Oreo pechenye', unitType: 'pack', unitSize: 1, price: 12000 },
    ],
  },
  {
    family: 'Konfet',
    brand: 'Roshen',
    categorySlug: 'shirinliklar',
    bg: 'EC407A',
    variants: [
      { label: 'Konfet 1kg', unitType: 'kg', unitSize: 1, price: 45000 },
    ],
  },
  // Drinks - water/soda
  {
    family: 'Coca-Cola',
    brand: 'Coca-Cola',
    categorySlug: 'suv-gazli',
    bg: 'D32F2F',
    desc: 'Gazlangan tarogʼlama ichimlik',
    variants: [
      {
        label: 'Coca-Cola 0.5L',
        unitType: 'liter',
        unitSize: 0.5,
        price: 6000,
      },
      { label: 'Coca-Cola 1L', unitType: 'liter', unitSize: 1, price: 9000 },
      {
        label: 'Coca-Cola 1.5L',
        unitType: 'liter',
        unitSize: 1.5,
        price: 12000,
        discount: 10000,
      },
    ],
  },
  {
    family: 'Ichimlik suvi',
    brand: 'Hydrolife',
    categorySlug: 'suv-gazli',
    bg: '0288D1',
    variants: [
      { label: 'Suv 1.5L', unitType: 'liter', unitSize: 1.5, price: 4000 },
    ],
  },
  {
    family: 'Fanta',
    brand: 'Coca-Cola',
    categorySlug: 'suv-gazli',
    bg: 'F9A825',
    variants: [
      { label: 'Fanta 1L', unitType: 'liter', unitSize: 1, price: 9000 },
    ],
  },
  // Drinks - juice
  {
    family: 'Sharbat',
    brand: 'Jaffa',
    categorySlug: 'sharbatlar',
    bg: 'F57F17',
    variants: [
      {
        label: 'Apelsin sharbati 1L',
        unitType: 'liter',
        unitSize: 1,
        price: 14000,
      },
    ],
  },
  // Drinks - tea/coffee
  {
    family: 'Choy',
    brand: 'Greenfield',
    categorySlug: 'choy-kofe',
    bg: '2E7D32',
    variants: [
      { label: 'Choy 100g', unitType: 'gram', unitSize: 100, price: 28000 },
    ],
  },
  {
    family: 'Kofe',
    brand: 'Nescafé',
    categorySlug: 'choy-kofe',
    bg: '4E342E',
    variants: [
      { label: 'Kofe 100g', unitType: 'gram', unitSize: 100, price: 42000 },
    ],
  },
  // Household - hygiene
  {
    family: 'Shampun',
    brand: 'Head & Shoulders',
    categorySlug: 'gigiena',
    bg: '00838F',
    variants: [
      { label: 'Shampun 400ml', unitType: 'gram', unitSize: 400, price: 38000 },
    ],
  },
  {
    family: 'Tish pastasi',
    brand: 'Colgate',
    categorySlug: 'gigiena',
    bg: '00838F',
    variants: [
      {
        label: 'Tish pastasi 100ml',
        unitType: 'gram',
        unitSize: 100,
        price: 18000,
      },
    ],
  },
  {
    family: 'Sovun',
    brand: 'Safeguard',
    categorySlug: 'gigiena',
    bg: '00838F',
    variants: [{ label: 'Sovun', unitType: 'piece', unitSize: 1, price: 7000 }],
  },
  // Household - cleaning
  {
    family: 'Kir yuvish kukuni',
    brand: 'Ariel',
    categorySlug: 'tozalash',
    bg: '283593',
    variants: [
      {
        label: 'Ariel 1.5kg',
        unitType: 'kg',
        unitSize: 1.5,
        price: 65000,
        discount: 58000,
      },
    ],
  },
  {
    family: 'Idish yuvish vositasi',
    brand: 'Fairy',
    categorySlug: 'tozalash',
    bg: '283593',
    variants: [
      { label: 'Fairy 500ml', unitType: 'gram', unitSize: 500, price: 22000 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Shop & people definitions
// ---------------------------------------------------------------------------
interface OwnerDef {
  phone: string;
  name: string;
}
const ADMIN: OwnerDef = { phone: '+998900000000', name: 'Platforma Admin' };

const OWNERS: OwnerDef[] = [
  { phone: '+998901112233', name: 'Akmal Karimov' },
  { phone: '+998902223344', name: 'Dilnoza Yusupova' },
  { phone: '+998903334455', name: 'Sardor Toshmatov' },
  { phone: '+998904445566', name: 'Gulnora Rashidova' },
];

const STAFF: OwnerDef[] = [
  { phone: '+998905556677', name: 'Bahodir Eshonov' },
  { phone: '+998906667788', name: 'Anvar Qodirov' },
];

const CUSTOMERS: OwnerDef[] = [
  { phone: '+998907778899', name: 'Jasur Aliyev' },
  { phone: '+998908889900', name: 'Malika Saidova' },
  { phone: '+998909990011', name: 'Bobur Normatov' },
  { phone: '+998911234567', name: 'Nigora Tursunova' },
];

interface ShopDef {
  name: string;
  description: string;
  address: string;
  km: { north: number; east: number };
  ownerIdx: number;
  maxKm: number;
  freeKm: number;
  pricingType: 'flat' | 'per_km' | 'per_500m';
  pricePerStep: number;
  minOrderPrice: number;
  bg: string;
  productCount: number;
  isOpenManual: boolean;
}

const SHOPS: ShopDef[] = [
  {
    name: 'Yaqin Mahalla Market',
    description:
      'Mahalla doʼkonimiz sizning xizmatingizda — yangi mahsulotlar har kuni.',
    address: 'Qarshi, Mustaqillik koʼchasi 12',
    km: { north: 0.28, east: 0.26 },
    ownerIdx: 0,
    maxKm: 4,
    freeKm: 2,
    pricingType: 'per_km',
    pricePerStep: 3000,
    minOrderPrice: 20000,
    bg: '0046AD',
    productCount: 18,
    isOpenManual: true,
  },
  {
    name: 'Bahor Supermarket',
    description: 'Keng assortiment, qulay narxlar.',
    address: 'Qarshi, Navoiy shoh koʼchasi 45',
    km: { north: -0.4, east: 0.45 },
    ownerIdx: 0,
    maxKm: 3,
    freeKm: 1.5,
    pricingType: 'flat',
    pricePerStep: 5000,
    minOrderPrice: 15000,
    bg: '2E7D32',
    productCount: 16,
    isOpenManual: true,
  },
  {
    name: 'Oila Market',
    description:
      'Oilaviy doʼkon — bolalar uchun ham, katta yoshlilar uchun ham.',
    address: 'Qarshi, Ulugʼbek koʼchasi 8',
    km: { north: 0.85, east: -0.6 },
    ownerIdx: 1,
    maxKm: 4,
    freeKm: 2,
    pricingType: 'per_500m',
    pricePerStep: 2000,
    minOrderPrice: 25000,
    bg: 'E1251B',
    productCount: 20,
    isOpenManual: true,
  },
  {
    name: 'Salom Oziq-ovqat',
    description: 'Tez yetkazib berish, sifatli mahsulotlar.',
    address: 'Qarshi, Amir Temur koʼchasi 30',
    km: { north: -1.0, east: -0.8 },
    ownerIdx: 1,
    maxKm: 3,
    freeKm: 1,
    pricingType: 'per_km',
    pricePerStep: 2500,
    minOrderPrice: 0,
    bg: 'F9A825',
    productCount: 14,
    isOpenManual: true,
  },
  {
    name: 'Mega Store Qarshi',
    description: 'Shahardagi eng katta tanlov.',
    address: 'Qarshi, Nasaf koʼchasi 102',
    km: { north: 1.2, east: 1.35 },
    ownerIdx: 2,
    maxKm: 5,
    freeKm: 3,
    pricingType: 'flat',
    pricePerStep: 7000,
    minOrderPrice: 30000,
    bg: '6A1B9A',
    productCount: 24,
    isOpenManual: true,
  },
  {
    name: 'Tong Market',
    description: 'Ertalabdan kechgacha ochiq.',
    address: 'Qarshi, Bunyodkor koʼchasi 5',
    km: { north: 0.2, east: -1.55 },
    ownerIdx: 3,
    maxKm: 3,
    freeKm: 2,
    pricingType: 'per_km',
    pricePerStep: 3000,
    minOrderPrice: 18000,
    bg: '00838F',
    productCount: 15,
    isOpenManual: false,
  },
];

// ---------------------------------------------------------------------------
// Seed routine
// ---------------------------------------------------------------------------
async function seed() {
  await AppDataSource.initialize();
  console.log('🔌 Connected to database');

  // 1. Wipe -------------------------------------------------------------------
  await AppDataSource.query(`
    TRUNCATE TABLE
      reviews, order_items, orders, stock_batches, inventory_movements,
      product_variants, global_products,
      staff_invitations, shop_staff, seller_applications,
      shops, user_addresses, categories, users
    RESTART IDENTITY CASCADE;
  `);
  console.log('🧹 Cleared existing data');

  const catRepo = AppDataSource.getTreeRepository(Category);
  const userRepo = AppDataSource.getRepository(User);
  const addrRepo = AppDataSource.getRepository(UserAddress);
  const appRepo = AppDataSource.getRepository(SellerApplication);
  const shopRepo = AppDataSource.getRepository(Shop);
  const staffRepo = AppDataSource.getRepository(ShopStaff);
  const gpRepo = AppDataSource.getRepository(GlobalProduct);
  const variantRepo = AppDataSource.getRepository(ProductVariant);
  const batchRepo = AppDataSource.getRepository(StockBatch);
  const moveRepo = AppDataSource.getRepository(InventoryMovement);
  const orderRepo = AppDataSource.getRepository(Order);
  const reviewRepo = AppDataSource.getRepository(Review);

  // 2. Categories -------------------------------------------------------------
  const catBySlug = new Map<string, Category>();
  let sort = 0;
  for (const root of CATEGORY_TREE) {
    const parent = await catRepo.save(
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
    for (const child of root.children ?? []) {
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
  console.log(`📂 Categories: ${catBySlug.size}`);

  // 3. Shared GlobalProduct catalogue ----------------------------------------
  // Each CATALOG entry creates GlobalProducts once (shared across all shops).
  // Variants within the same family are size-grouped via parentGlobalProductId.
  const globalProductMap = new Map<string, GlobalProduct[]>(); // family → [gp, ...]
  for (const tpl of CATALOG) {
    const category = catBySlug.get(tpl.categorySlug) ?? null;
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
          photos: [img(v.label, tpl.bg ?? '0046AD')],
          description: tpl.desc ? toLocalizedText(tpl.desc) : null,
          barcode: null,
          isVerified: true,
          isActive: true,
          usageCount: 0,
          ownerShopId: null,
          // First variant of a multi-variant family becomes the parent
          parentGlobalProductId: vi === 0 ? null : parentId,
        }),
      );
      if (vi === 0) parentId = gp.id;
      familyGps.push(gp);
    }
    globalProductMap.set(tpl.family, familyGps);
  }
  console.log(
    `📋 Global products: ${[...globalProductMap.values()].flat().length}`,
  );

  // 4. Users ------------------------------------------------------------------
  const admin = await userRepo.save(
    userRepo.create({
      phone: ADMIN.phone,
      name: ADMIN.name,
      isAdmin: true,
      isSellerApproved: false,
      roles: ['customer', 'admin'],
      status: UserStatus.Active,
      avatarUrl: img('A', '111111'),
    }),
  );

  const owners: User[] = [];
  for (const o of OWNERS) {
    owners.push(
      await userRepo.save(
        userRepo.create({
          phone: o.phone,
          name: o.name,
          isSellerApproved: true,
          roles: ['customer', 'seller'],
          status: UserStatus.Active,
        }),
      ),
    );
  }

  const staffUsers: User[] = [];
  for (const s of STAFF) {
    staffUsers.push(
      await userRepo.save(
        userRepo.create({
          phone: s.phone,
          name: s.name,
          roles: ['customer'],
          status: UserStatus.Active,
        }),
      ),
    );
  }

  const customers: User[] = [];
  for (const c of CUSTOMERS) {
    customers.push(
      await userRepo.save(
        userRepo.create({
          phone: c.phone,
          name: c.name,
          roles: ['customer'],
          status: UserStatus.Active,
        }),
      ),
    );
  }
  console.log(
    `👤 Users: ${1 + owners.length + staffUsers.length + customers.length}`,
  );

  // 5. Addresses (customers near CENTER so deliveries are in-zone) -------------
  const addrByUser = new Map<string, UserAddress>();
  const labels = ['Uy', 'Ish'];
  const allRegularUsers = [...customers, ...owners, ...staffUsers];
  for (let i = 0; i < allRegularUsers.length; i++) {
    const u = allRegularUsers[i];
    const loc = offset({
      north: (rnd() - 0.5) * 1.2,
      east: (rnd() - 0.5) * 1.2,
    });
    const addr = await addrRepo.save(
      addrRepo.create({
        userId: u.id,
        label: labels[i % labels.length],
        address: `Qarshi, ${randInt(1, 12)}-mavze, ${randInt(1, 80)}-uy`,
        latitude: loc.lat,
        longitude: loc.lng,
        notes: i % 3 === 0 ? 'Eshik kodi 1234' : null,
        isDefault: true,
      }),
    );
    addrByUser.set(u.id, addr);
  }
  console.log(`📍 Addresses: ${addrByUser.size}`);

  // 6. Shops + approved seller applications -----------------------------------
  const shops: Shop[] = [];
  for (const def of SHOPS) {
    const owner = owners[def.ownerIdx];
    const loc = offset(def.km);

    await appRepo.save(
      appRepo.create({
        userId: owner.id,
        firstName: owner.name?.split(' ')[0] ?? 'Seller',
        lastName: owner.name?.split(' ').slice(1).join(' ') || 'Test',
        contactPhone: null,
        note: null,
        status: SellerApplicationStatus.Approved,
        reviewedByUserId: admin.id,
        reviewedAt: new Date(),
      }),
    );

    const shop = await shopRepo.save(
      shopRepo.create({
        ownerId: owner.id,
        name: def.name,
        description: def.description,
        photos: [img(def.name, def.bg), img(`${def.name} 2`, def.bg)],
        address: def.address,
        latitude: loc.lat,
        longitude: loc.lng,
        workingHours: STD_HOURS,
        holidays: [],
        isOpenManual: def.isOpenManual,
        minOrderPrice: def.minOrderPrice,
        deliveryZone: {
          maxKm: def.maxKm,
          freeKm: def.freeKm,
          pricingType: def.pricingType,
          pricePerStep: def.pricePerStep,
        },
        blockedUserIds: [],
        isActive: true,
      }),
    );
    shops.push(shop);
  }
  console.log(`🏪 Shops: ${shops.length}`);

  // 7. Staff (shop 0 gets a cashier + a courier) ------------------------------
  await staffRepo.save(
    staffRepo.create({
      shopId: shops[0].id,
      userId: staffUsers[0].id,
      customRoleName: 'Kassir - Bahodir',
      preset: 'kassir',
      permissions: PRESET_PERMISSIONS.kassir,
      isActive: true,
    }),
  );
  await staffRepo.save(
    staffRepo.create({
      shopId: shops[0].id,
      userId: staffUsers[1].id,
      customRoleName: 'Yetkazib beruvchi - Anvar',
      preset: 'yetkazib_beruvchi',
      permissions: PRESET_PERMISSIONS.yetkazib_beruvchi,
      isActive: true,
    }),
  );
  staffUsers[0].roles = ['customer', 'staff'];
  staffUsers[1].roles = ['customer', 'staff'];
  await userRepo.save(staffUsers);
  console.log('👥 Staff: 2 (shop 1)');

  // 8. ProductVariants per shop (thin offerings pointing to shared GlobalProducts)
  const variantsByShop = new Map<string, ProductVariant[]>();
  // variantId → GlobalProduct name (for order item snapshots)
  const variantNameMap = new Map<string, string>();
  let variantCount = 0;

  const catalogEntries = [...globalProductMap.entries()];
  for (let si = 0; si < shops.length; si++) {
    const shop = shops[si];
    const def = SHOPS[si];
    const shopVariants: ProductVariant[] = [];

    for (let i = 0; i < def.productCount; i++) {
      const tplIdx = (si * 5 + i) % CATALOG.length;
      const tpl = CATALOG[tplIdx];
      const gps = globalProductMap.get(tpl.family) ?? [];

      // Per-shop price jitter (±10%)
      const jitter = 0.92 + rnd() * 0.16;
      for (const gp of gps) {
        // Find template variant matching this GlobalProduct's name
        const nameUz = typeof gp.name === 'object' ? gp.name?.uz : gp.name;
        const vtpl =
          tpl.variants.find((v) => v.label === nameUz) ?? tpl.variants[0];
        const price = Math.round((vtpl.price * jitter) / 500) * 500;
        const discount = vtpl.discount
          ? Math.round((vtpl.discount * jitter) / 500) * 500
          : null;
        const stock = randInt(8, 200);

        const variant = await variantRepo.save(
          variantRepo.create({
            shopId: shop.id,
            globalProductId: gp.id,
            price,
            discountPrice: discount,
            stock,
            lowStockThreshold: 5,
            expiryDate: null,
            isActive: true,
          }),
        );
        shopVariants.push(variant);
        variantNameMap.set(
          variant.id,
          typeof gp.name === 'object' ? gp.name?.uz || '' : gp.name,
        );
        variantCount++;

        // FIFO stock batch
        await batchRepo.save(
          batchRepo.create({
            productVariantId: variant.id,
            shopId: shop.id,
            costPrice: Math.round(price * 0.75),
            quantityReceived: stock,
            quantityRemaining: stock,
            expiryDate: null,
            receivedAt: new Date(),
            performedByUserId: shop.ownerId,
          }),
        );

        // Initial stock-in movement
        await moveRepo.save(
          moveRepo.create({
            productVariantId: variant.id,
            type: MovementType.In,
            quantity: stock,
            beforeStock: 0,
            afterStock: stock,
            reason: 'Boshlangʼich kirim',
            performedByUserId: shop.ownerId,
          }),
        );

        // Increment usageCount on GlobalProduct
        await gpRepo.increment({ id: gp.id }, 'usageCount', 1);
      }
    }
    variantsByShop.set(shop.id, shopVariants);
  }
  console.log(`📦 Variants: ${variantCount}`);

  // 9. Orders + reviews -------------------------------------------------------
  const reviewTexts = [
    'Juda sifatli, rahmat!',
    'Tez yetkazib berishdi.',
    'Yaxshi mahsulot, yana buyurtma qilaman.',
    'Hammasi joyida.',
    'Narxi arzon, sifati zoʼr.',
    null,
  ];
  let orderCount = 0;
  let reviewCount = 0;
  const variantStars = new Map<string, number[]>();

  for (let ci = 0; ci < customers.length; ci++) {
    const customer = customers[ci];
    const addr = addrByUser.get(customer.id)!;
    for (let k = 0; k < 2; k++) {
      const shop = shops[(ci * 2 + k) % shops.length];
      const pool = variantsByShop.get(shop.id)!;
      const itemCount = randInt(2, 4);
      const chosen: ProductVariant[] = [];
      for (let n = 0; n < itemCount; n++) chosen.push(pick(pool));

      const items: OrderItem[] = [];
      let subTotal = 0;
      const seen = new Set<string>();
      for (const v of chosen) {
        if (seen.has(v.id)) continue;
        seen.add(v.id);
        const qty = randInt(1, 3);
        const unitPrice = v.discountPrice ?? v.price;
        const lineTotal = unitPrice * qty;
        subTotal += lineTotal;
        items.push(
          orderRepo.manager.create(OrderItem, {
            productVariantId: v.id,
            productName: variantNameMap.get(v.id) ?? '',
            quantity: qty,
            unitPrice,
            lineTotal,
            returnedQuantity: 0,
          }),
        );
      }

      const distanceKm = haversineKm(
        shop.latitude,
        shop.longitude,
        addr.latitude,
        addr.longitude,
      );
      const deliveryFee = calcDeliveryFee({
        distanceKm,
        freeKm: shop.deliveryZone.freeKm,
        pricingType: shop.deliveryZone.pricingType,
        pricePerStep: shop.deliveryZone.pricePerStep,
      });
      const createdAt = new Date(Date.now() - randInt(1, 20) * 86_400_000);
      const ts = (mins: number) =>
        new Date(createdAt.getTime() + mins * 60_000).toISOString();

      const order = await orderRepo.save(
        orderRepo.create({
          userId: customer.id,
          shopId: shop.id,
          deliveryAddressId: addr.id,
          deliveryAddress: {
            label: addr.label,
            address: addr.address,
            latitude: addr.latitude,
            longitude: addr.longitude,
            entrance: addr.entrance ?? null,
            floor: addr.floor ?? null,
            apartment: addr.apartment ?? null,
            intercom: addr.intercom ?? null,
          },
          orderNumber: orderNo(),
          items,
          subTotal,
          deliveryFee,
          total: subTotal + deliveryFee,
          distanceKm,
          status: OrderStatus.Delivered,
          paymentMethod: PaymentMethod.Cash,
          timeline: [
            { status: OrderStatus.New, at: ts(0) },
            { status: OrderStatus.Accepted, at: ts(3), byUserId: shop.ownerId },
            {
              status: OrderStatus.Preparing,
              at: ts(8),
              byUserId: shop.ownerId,
            },
            {
              status: OrderStatus.Delivering,
              at: ts(20),
              byUserId: shop.ownerId,
            },
            {
              status: OrderStatus.Delivered,
              at: ts(45),
              byUserId: shop.ownerId,
            },
          ],
          createdAt,
        }),
      );
      orderCount++;

      for (const it of order.items) {
        if (rnd() > 0.7) continue;
        const stars = randInt(3, 5);
        await reviewRepo.save(
          reviewRepo.create({
            userId: customer.id,
            productVariantId: it.productVariantId,
            orderId: order.id,
            stars,
            text: pick(reviewTexts),
          }),
        );
        reviewCount++;
        const arr = variantStars.get(it.productVariantId) ?? [];
        arr.push(stars);
        variantStars.set(it.productVariantId, arr);
      }
    }
  }
  console.log(`🧾 Orders: ${orderCount}, Reviews: ${reviewCount}`);

  // 10. Roll up ratings -------------------------------------------------------
  for (const [variantId, stars] of variantStars) {
    const avg = stars.reduce((a, b) => a + b, 0) / stars.length;
    await variantRepo.update(variantId, {
      ratingAverage: Math.round(avg * 100) / 100,
      ratingCount: stars.length,
    });
  }
  for (const shop of shops) {
    const vs = variantsByShop.get(shop.id)!;
    const allStars: number[] = [];
    for (const v of vs) allStars.push(...(variantStars.get(v.id) ?? []));
    if (allStars.length === 0) continue;
    const avg = allStars.reduce((a, b) => a + b, 0) / allStars.length;
    await shopRepo.update(shop.id, {
      ratingAverage: Math.round(avg * 100) / 100,
      ratingCount: allStars.length,
    });
  }
  console.log('⭐ Ratings rolled up');

  // Summary -------------------------------------------------------------------
  console.log('\n✅ Seed complete. Test logins (phone + dev OTP):');
  console.log(`   Admin:    ${ADMIN.phone}`);
  OWNERS.forEach((o, i) =>
    console.log(`   Owner ${i + 1}:  ${o.phone}  (${o.name})`),
  );
  CUSTOMERS.forEach((c, i) =>
    console.log(`   Customer: ${c.phone}  (${c.name})`),
  );
  console.log(
    `\n   Shops are within ~2km of ${CENTER.lat}, ${CENTER.lng} (Qarshi).`,
  );

  await AppDataSource.destroy();
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});

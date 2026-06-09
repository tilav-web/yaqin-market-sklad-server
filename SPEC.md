# Yaqin Market — Texnik Spetsifikatsiya

## 1. Kontekst va Vizyon

**Yaqin Market** — bu giperlokal oziq-ovqat marketpleysi va mobil ombor (sklad) tizimi. Asosiy fokus: mahalla va kichik shahar do'konlari hamda ularning yaqin atrofdagi xaridorlari.

### Asosiy g'oya
1. **Sotuvchilar (Seller)** — mahalla do'konchilari o'z mahsulotlarini ilova orqali skladda hisoblaydi, narx qo'yadi, qoldiq nazorat qiladi.
2. **Xaridorlar (Customer)** — o'z lokatsiyasi atrofida (yetkazib berish radiusi ichida) bo'lgan do'konlardagi mahsulotlarni ko'radi va buyurtma beradi.
3. **Yetkazib berishni** sotuvchining o'zi yoki uning yaqini amalga oshiradi (1-4 km radius).
4. **Bitta ilova, ikki rol** — bitta Expo ilovasi: foydalanuvchi seller bo'lish uchun ilovaning ichidan ariza yuboradi.

### Maqsadli auditoriya
- **Sellerlar**: mahalla do'konchilari, kichik supermarket egalari (bitta seller — bir nechta do'kon bo'lishi mumkin).
- **Customerlar**: do'kondan 1-4 km radiusda yashovchi va do'konga yurib bormay buyurtma qilishni istovchi xaridorlar.

---

## 2. Texnik Stek

| Qatlam | Texnologiya | Joylashuv |
|--------|-------------|-----------|
| **Mobile App** | Expo (React Native, TypeScript) | `mobile/` |
| **Web Client (Admin Panel)** | Next.js (TypeScript, App Router) | `client/` |
| **Backend Server** | NestJS (TypeScript) | `server/` |
| **Ma'lumotlar Bazasi** | PostgreSQL + PostGIS (geospatial) | Docker (server) |
| **Cache & Realtime** | Redis | Docker (server) |
| **Realtime Aloqa** | Socket.IO (NestJS gateway) | server |
| **Authentication** | JWT + Refresh Token | server |
| **SMS OTP** | Eskiz.uz | server orqali |
| **Push Notifications** | Firebase Cloud Messaging (FCM) | mobile + server |
| **Xarita** | Google Maps (mobile SDK tekin) + react-native-maps | mobile |
| **Lokatsiya** | expo-location (GPS) | mobile |
| **Masofa Hisoblash** | Haversine formula (to'g'ri chiziq) | server |
| **Fayl Saqlash** | S3-compatible (MinIO local, AWS S3 prod) | server |
| **State Management** | Zustand yoki Redux Toolkit (mobile/client) | mobile + client |
| **API** | REST + WebSocket (real-time updates) | server |

### Loyiha Tuzilmasi
```
yaqin-market/
├── client/              # Next.js admin paneli (Docker SIZ ishlaydi)
├── mobile/              # Expo ilova (Docker SIZ ishlaydi)
├── server/              # NestJS backend (Docker da ishga tushadi)
│   ├── docker-compose.yml
│   └── Dockerfile
├── .agents/skills/      # Agent skills (Expo, NestJS, React)
├── .claude/             # Permissions va settings
└── SPEC.md              # Bu fayl
```

**Muhim qoida:** `client/`, `mobile/`, `server/` — faqat kod uchun. Docker konfiguratsiya fayllari **faqat `server/` ichida** bo'ladi. Har bir folder o'z `git` repozitoriyasiga ega.

---

## 3. UI/UX Branding

### Asosiy Ranglar
**Boks sport stili** — kuch, harakat, professionallik:
- **Ko'k (Blue)**: `#0046AD` — asosiy brand rang, sarlavhalar, primary tugmalar
- **Qizil (Red)**: `#E1251B` — diqqat, aksiya, "Buyurtma berish", error
- **Oq (White)**: `#FFFFFF` — fon, kontrast

### Qo'shimcha ranglar (kerak bo'lsa)
- **Qora**: `#1A1A1A` — matn
- **Och kulrang**: `#F5F5F5` — kartochka foni
- **Yashil**: `#10B981` — "Yetkazildi", success
- **Sariq**: `#FBBF24` — yulduz (rating)

### Tillar
- O'zbekcha (lotin) — default
- O'zbekcha (kirill)
- Ruscha

`i18next` kabi kutubxona orqali til o'zgartirish.

---

## 4. Rollar va Foydalanuvchi Oqimi

> **Eslatma:** Quyidagi har bir oqim bo'sh holatdan boshlanadi — yangi user ilovani ochganda **customer interfeysi** ko'rsatiladi. Ish roli (seller/staff) kontekstiga o'tish faqat profile page orqali amalga oshiriladi (4.4-bo'limdagi "Customer-First" printsipiga qarang).

### 4.1 Customer (Xaridor) Oqimi
1. Ilovaga kiradi → telefon raqam + SMS OTP → **customer UI ochiladi** (default)
2. GPS lokatsiyasi avtomatik aniqlanadi (default)
3. Atrofdagi do'konlar (yetkazib berish radiusi ichida) ko'rinadi
4. Do'kon yoki mahsulotni tanlaydi → har bir do'kon uchun **alohida savat** yig'iladi
5. Har savatda mini-order narxi tekshiriladi
6. Buyurtma beradi (naqd to'lov) → 5 daqiqa ichida seller javob beradi
7. Real-time status oladi: `Yangi → Qabul qilindi → Yig'ilmoqda → Yetkazib berilmoqda → Yetkazildi`
8. Mahsulotlarni baholaydi (1-5 yulduz) → do'kon reytingi mahsulot baholaridan kelib chiqadi

### 4.2 Seller / Owner (Sotuvchi) Oqimi
1. Telefon raqam + SMS OTP bilan kiradi → **customer UI ochiladi** (default)
2. Profile page ga o'tadi → "Seller bo'lish" arizasini yuboradi (do'kon nomi, manzil, GPS, do'kon rasmi, STIR/INN)
3. Admin tasdiqlaydi → endi do'konni boshqarishi mumkin
4. Profile page → "Mening do'konlarim" → do'kon tanlash → **ish rejimiga o'tadi**
5. **Bir seller bir nechta do'kon** yarata oladi
6. Har do'konda: sklad mahsulotlari, ish vaqti, yetkazish zonasi, mini-order narxi sozlanadi
7. Push notification orqali yangi buyurtmalar haqida xabardor bo'ladi (customer rejimda bo'lsa ham)
8. Buyurtmani qabul qiladi va statusini yangilaydi
9. User bilan ichki chat yoki telefon orqali bog'lanadi
10. Ish tugagach → customer rejimga qaytib o'zi xarid qila oladi

### 4.3 Xodim (Staff) Oqimi
1. Telefon raqam + SMS OTP bilan kiradi → **customer UI ochiladi** (default)
2. Egasi QR-kod yuboradi → xodim ilovasi orqali skanlaydi → taklifni qabul qiladi
3. Profile page → "Mening ish o'rnim" bo'limida do'konlar ko'rinadi (rol nomi bilan)
4. Do'kon tanlaydi → **ish rejimiga o'tadi** (berilgan ruxsatlar doirasida)
5. Berilgan ruxsatlar asosida ishlaydi (buyurtma qabul, sklad, va h.k.)
6. Ish tugagach → customer rejimga qaytib o'zi xarid qila oladi

### 4.4 Admin Oqimi (Web — Next.js)
1. Seller arizalarini ko'radi va tasdiqlaydi/rad etadi
2. Kategoriya daraxtini boshqaradi
3. Userlar va do'konlarni nazorat qiladi (block qila oladi)
4. Statistika va analytics ko'radi

---

## 4.5 Do'kon Rollari va Ruxsatlar Tizimi

### Asosiy Konsept
Bitta sellerda bir nechta do'kon bo'lishi mumkin va har do'konga **xodimlar** qo'shilishi mumkin. Ruxsatlar **erkin permission flag** asosida ishlaydi — egasi har bir xodim uchun aniq ruxsatlarni belgilaydi.

### ⭐ "Customer-First" UX Printsipi (eng muhim)

**Har bir foydalanuvchi — rol qanday bo'lishidan qat'iy nazar — ilovaga kirganda birinchi navbatda customer interfeysini ko'radi.**

Bu loyihaning eng muhim UX qoidalaridan biri:
- Owner, Menejer, Kassir, Sklad ishchisi, Yetkazib beruvchi — barchasi ilovani ochganda customer sifatida boshlaydi
- Ish rolida ishlash uchun → **profile page** → "Mening do'konlarim" → do'kon tanlash → ish rejimiga o'tish
- Ish rejimida har doim "Customer rejimga qaytish" tugmasi mavjud
- **Sabab:** xodim/egasi ishdan tashqari vaqtda **user sifatida buyurtma bera olishi kerak**. Hayotda do'konchilar ham boshqa do'konlardan oziq-ovqat oladi.

**Konkret misol:**
- Bahodir kunduzi "Yaqin Mahalla Market" do'konida kassir
- Ish vaqtida: profile → do'kon → buyurtmalar qabul qiladi
- Ish tugagach: customer rejimga qaytadi → kechki ovqat buyurtma qiladi boshqa do'kondan
- Yetkazib beruvchi-Anvar bo'sh vaqtida customer rejimda mahsulot xarid qila oladi

### Rol Ierarxiyasi

**Egasi (Owner / Shop Owner)**
- Seller arizasini yuborgan va admin tomonidan tasdiqlangan asosiy shaxs
- O'z barcha do'konlari ustidan **to'liq nazorat**
- **Delegatsiya qilib bo'lmaydigan ruxsatlar (faqat egasi):**
  * Xodim qo'shish, o'chirish, ruxsatlarini o'zgartirish
  * Do'kon sozlamalari (yetkazib berish zonasi, mini-order narxi, ish vaqti, bayram kunlari)
  * Daromad va analytics ko'rish
  * Mahsulotni **butunlay o'chirish** (delete)

**Xodim (Staff)**
- Egasi tomonidan QR-kod orqali taklif qilingan shaxs
- Rol nomi — egasi erkin matnda yozadi (masalan: "Kechki kassir-Anvar", "Sklad - Bahodir")
- Ruxsatlar egasi tomonidan beriladi (preset + sozlash)
- Bir xodim **bir egasining bir nechta do'koni**da ishlay oladi (har birida alohida ruxsatlar bilan)
- **Bir xodim turli egalarning do'konlariga biriktirilishi mumkin emas**

### Preset Shablonlar
Egasi xodim qo'shganda quyidagilardan birini tanlaydi, keyin kerak bo'lsa har bir ruxsatni qo'lda yoqib/o'chiradi:

| Preset | Ruxsatlar |
|--------|-----------|
| **Kassir** | Sklad ko'rish, Buyurtma ko'rish, Buyurtma qabul qilish, Buyurtma statusini yangilash, Chat, Sotildi/qaytarildi (qoldiq harakati) |
| **Menejer** | Kassir ruxsatlari + Mahsulot qo'shish, Mahsulot tahrirlash (narx, rasm, izoh), Sharhlarni ko'rish, Do'konni qo'lda ochish/yopish, Kam qoldiq xabarnomalari |
| **Sklad ishchisi** | Sklad ko'rish, Mahsulot qo'shish, Mahsulot tahrirlash (faqat rasm va izoh — narxsiz), Barcode skaner, Kirim-chiqim, Kam qoldiq xabarnomalari. **Buyurtmalarni ko'rmaydi.** |
| **Yetkazib beruvchi** | Faqat "Yetkazib berilmoqda" statusidagi buyurtmalarni ko'radi, statusni "Yetkazildi" ga yangilaydi, customer telefon/manzilini ko'radi, chat |

### Permission Flag Ro'yxati

**Sklad (Inventory):**
- `inventory.view` — mahsulotlar ro'yxatini ko'rish
- `inventory.product.create` — yangi mahsulot qo'shish *(egasi delegate qila oladi)*
- `inventory.product.edit_info` — mahsulot nomi, rasm, izoh, kategoriya o'zgartirish
- `inventory.product.edit_price` — narx va chegirma narxini o'zgartirish
- `inventory.product.edit_stock` — qoldiq miqdorini o'zgartirish (kirim/chiqim)
- `inventory.product.delete` — mahsulotni butunlay o'chirish *(faqat egasi)*
- `inventory.movement.view` — kirim-chiqim tarixini ko'rish
- `inventory.low_stock_alerts` — kam qoldiq xabarnomalarini olish
- `inventory.barcode.scan` — barcode skanerdan foydalanish

**Buyurtmalar (Orders):**
- `orders.view_all` — barcha buyurtmalarni ko'rish
- `orders.view_assigned` — faqat o'ziga biriktirilgan buyurtmalarni ko'rish (yetkazib beruvchi uchun)
- `orders.accept` — yangi buyurtmani qabul qilish
- `orders.update_status` — status oqimini yangilash
- `orders.cancel` — buyurtmani bekor qilish
- `orders.chat` — customer bilan chat
- `orders.view_customer_contact` — customer telefon va manzilini ko'rish

**Do'kon (Shop):**
- `shop.toggle_open` — do'konni qo'lda ochish/yopish
- `shop.settings.view` — sozlamalarni ko'rish
- `shop.settings.edit` *(faqat egasi)* — yetkazib berish zonasi, mini-order, ish vaqti
- `shop.block_user` *(faqat egasi)* — userni bu do'kon uchun block qilish

**Sharhlar (Reviews):**
- `reviews.view` — mahsulot sharhlarini ko'rish

**Daromad va Statistika:**
- `analytics.view` *(faqat egasi)* — daromad va statistika

**Xodim boshqaruvi:**
- `staff.invite` *(faqat egasi)* — yangi xodim taklif qilish
- `staff.remove` *(faqat egasi)* — xodimni o'chirish
- `staff.edit_permissions` *(faqat egasi)* — xodim ruxsatlarini o'zgartirish

### Xodim Qo'shish Oqimi
1. Egasi do'konida "Xodim qo'shish" tugmasini bosadi
2. Preset tanlaydi (Kassir/Menejer/Sklad ishchisi/Yetkazib beruvchi) yoki erkin
3. Kerak bo'lsa har bir ruxsatni qo'lda sozlaydi
4. Xodim uchun rol nomini yozadi (erkin matn, masalan "Kechki kassir-Anvar")
5. Ilova QR-kod generatsiya qiladi (vaqtinchalik, masalan 10 daqiqa amal qiladi)
6. Xodim o'z ilovasi orqali (allaqachon ro'yxatdan o'tgan bo'lishi kerak) QR-kodni skanlab oladi
7. Xodim ilovasida "Sizni X do'koniga taklif qildilar" ko'rsatiladi
8. Xodim "Qabul qilaman" yoki "Rad etaman" tugmasini bosadi
9. Qabul qilsa — endi shu do'kon uning ilovasida ko'rinadi va biriktirilgan ruxsatlar bilan ishlay oladi

### Xodim Ilova Tajribasi
- Birinchi marta kirgan xodim default `customer` rolida bo'ladi
- Egasi QR orqali taklif qilsa, ilovada "Do'konlarim" bo'limi paydo bo'ladi
- Bir nechta do'konda ishlasa, do'kon tanlash imkoniyati bo'ladi
- Faqat berilgan ruxsatlar doirasidagi UI elementlarini ko'radi

### Xodim O'chirish
- Egasi istalgan vaqtda xodimni do'kondan o'chira oladi
- Xodim o'zi ham do'kondan chiqib keta oladi ("Do'kondan chiqish" tugmasi)
- Chiqarilgan xodimning ilovasidan o'sha do'kon yo'qoladi, lekin tarixiy ma'lumotlar (kim qabul qildi, kim yetkazdi) saqlanadi

---

## 5. Asosiy Funksiyalar

### 5.0 Mobile Ilova Navigatsiya Tuzilmasi

Mobile ilova ikki kontekst (rejim) ga ega bo'ladi. Default kontekst — **Customer**. Foydalanuvchi profile orqali **Ish rejimi**ga o'tadi va istagan vaqtda customer rejimga qaytadi.

```
┌─────────────────────────────────────────────────┐
│   CUSTOMER REJIM (default, har doim mavjud)     │
├─────────────────────────────────────────────────┤
│ Bottom Tab Navigator:                           │
│   🏠 Bosh sahifa  (do'konlar, mahsulotlar)      │
│   🗺️ Xarita      (Google Maps, do'konlar)       │
│   🔍 Qidiruv                                    │
│   🛒 Savatlar    (har do'kon uchun alohida)     │
│   👤 Profile                                    │
└─────────────────────────────────────────────────┘
                       │
                       │  Profile → "Mening do'konlarim"
                       │  (faqat owner yoki staff bo'lsa ko'rinadi)
                       │  Do'kon tanlash
                       ▼
┌─────────────────────────────────────────────────┐
│   ISH REJIM (kontekst: tanlangan do'kon)        │
├─────────────────────────────────────────────────┤
│ Top bar: 🏪 Do'kon nomi  | ← Customer rejimga   │
│                                                 │
│ Bottom Tab Navigator (ruxsatlarga qarab):       │
│   📋 Buyurtmalar      (orders.* ruxsati bor)   │
│   📦 Sklad           (inventory.* ruxsati bor) │
│   💬 Chat            (orders.chat ruxsati bor) │
│   📊 Statistika      (analytics.view, owner)   │
│   ⚙️ Sozlamalar      (shop.settings.*)         │
│   👥 Xodimlar        (staff.*, owner)          │
└─────────────────────────────────────────────────┘
```

**Muhim qoidalar:**
1. **Default har doim Customer** — yangi yoki qaytgan user customer UI ni ko'radi
2. **Profile page** — "Mening do'konlarim" bo'limida user biriktirilgan barcha do'konlar (owner yoki staff sifatida) ko'rinadi
3. **Bir vaqtda bitta ish konteksti** — agar user bir nechta do'konga biriktirilgan bo'lsa, har safar bittasini tanlaydi
4. **Push notifications customer rejimda ham ishlaydi** — masalan, do'koniga yangi buyurtma kelganda xabar oladi (agar `orders.view` ruxsati bo'lsa)
5. **Customer rejim hech qachon o'chmaydi** — ish konteksida bo'lganda ham "Customer rejimga qaytish" har doim 1 click bilan mavjud

### 5.1 Mobile Ilova (Customer Qismi)

**Auth & Profile**
- Telefon + SMS OTP (Eskiz.uz)
- Profil sozlash (ism, avatar)
- Bir nechta manzil saqlash (Uy, Ish, Boshqa) — har birida nom + GPS + manzil matni
- Sevimli do'konlar (favorites)
- Sevimli mahsulotlar
- Buyurtma tarixi + bir bosishda qayta buyurtma

**Lokatsiya va Manzil**
- GPS avtomatik aniqlanadi
- User saqlangan manzilni tanlasa → shu manzil atrofidagi do'konlar ko'rsatiladi
- Faqat **yetkazib berish radiusi ichidagi** do'konlar ko'rinadi
- Masofa Haversine bilan hisoblanadi

**Do'konlar va Mahsulotlar**
- Yaqin do'konlar ro'yxati (masofa bo'yicha tartiblangan)
- Do'kon profili (rasm, nomi, ish vaqti, rating, mini-order narxi)
- Mahsulot ro'yxati (rasm, narx, chegirma, qoldiq, kategoriya)
- Product Family + Variants modeli:
  * `Coca-Cola` (parent product family)
  * Variants: 0.5L, 1L, 1.5L — har biri alohida narx va qoldiq
  * User bir variantni bossa, qolgan variantlar ham ko'rinadi

**Xarita (Google Maps)**
- Alohida "Xarita" tab da Google Maps ko'rinadi
- User ning joriy lokatsiyasi markazda
- **Yaqin atrofdagi do'konlar** xaritada pin/marker sifatida ko'rsatiladi (faqat yetkazib berish zonasi ichida)
- Do'kon pinini bosish → mini-card chiqadi (nomi, masofa, ish vaqti, "Do'konga kirish" tugmasi)
- **Mahsulot qidiruvidan xaritaga o'tish**: user mahsulot qidirsa va "Xaritada ko'rsatish" tugmasini bossa, shu mahsulot bor bo'lgan do'konlar pin sifatida xaritada belgilanadi
- Buyurtma yetkazib berish jarayonida user xaritada o'z lokatsiyasini ko'radi
- Do'konni yangi qo'shayotgan seller ham xaritadan aniq joyni tanlaydi (drag-and-drop pin)

**Qidiruv va Filter**
- Mahsulot nomi bo'yicha global qidiruv (faqat yaqin do'konlardan)
- Kategoriya filteri
- Narx oralig'i
- Aksiya/chegirmali mahsulotlar
- Do'kon nomi bo'yicha qidiruv
- Tartiblash: yaqinlik, narx, reyting

**Savat va Buyurtma**
- **Har bir do'kon uchun alohida savat** (multi-vendor cart)
- Har savat: mini-order narxi tekshiriladi
- Yetkazib berish narxi avtomatik hisoblanadi (sellerning zona/narx siyosatiga ko'ra)
- To'lov turi: faqat naqd (MVP), kelajakda Click
- Manzil tanlash → buyurtma yuborish

**Buyurtma Statusi**
- Real-time status WebSocket orqali
- 5 bosqich: `Yangi → Qabul qilindi → Yig'ilmoqda → Yetkazib berilmoqda → Yetkazildi / Bekor qilindi`
- User qabul qilganda mahsulotlarning bir qismini **qaytarish** mumkin
  * Qaytarish faqat butun unit miqdorda (1 ta non, 1 kg pamidor)
  * Yarim unit qaytarib bo'lmaydi
  * Qaytarilgan mahsulotlar uchun ham reyting qo'yish mumkin
- Naqd to'lov refund: qo'l-qo'lga seller user ga qaytaradi (ilova orqali ariza yo'q)

**Reyting**
- User do'konni baholmaydi — **faqat mahsulotlarni** baholaydi
- Har mahsulot uchun 1-5 yulduz + ixtiyoriy izoh
- Do'kon reytingi → o'sha do'kondagi barcha mahsulot baholaridan o'rtacha
- Agar user buyurtmani baholamasa → eslatma notification yuboriladi

**Chat va Aloqa**
- Buyurtma ichida ichki chat (Socket.IO)
- Sellerning telefon raqami ham ko'rinadi → qo'ng'iroq qila oladi

**Notifications (FCM)**
- Buyurtma statusi o'zgardi
- Sevimli do'konda yangi aksiya/chegirma
- Buyurtmani baholash haqida eslatma

### 5.2 Mobile Ilova (Seller / Sklad Qismi)

**Seller Bo'lish Arizasi**
- Do'kon nomi, manzili, GPS lokatsiyasi
- Telefon raqam (allaqachon bor)
- Do'kon rasmi (kamida 1, ko'pi bilan 5)
- STIR/INN raqami
- Status: `Yuborildi → Admin ko'rib chiqmoqda → Tasdiqlandi / Rad etildi`

**Do'kon Boshqaruvi**
- Bir seller — bir nechta do'kon yaratish
- Har do'kon uchun alohida sozlamalar:
  * Nomi, rasmi, izohi, manzili, GPS
  * Ish vaqti:
    - Har kunlik alohida vaqt belgilash
    - 1-2 oy uchun jadval tez to'ldirish
    - Bayram kunlarini belgilash
    - Qo'lda "yopish/ochish" tugmasi (favqulodda)
  * Mini-order narxi (0 yoki istalgan summa)
  * Yetkazib berish zonasi:
    - Maksimal radius (masalan 4km)
    - Bepul radius (masalan 2km)
    - Qolgan masofa uchun narx:
      - Variant A: Flat fee (masalan 5000 so'm)
      - Variant B: Har 1km uchun X so'm
      - Variant C: Har 500m uchun X so'm

**Sklad (Inventory) Boshqaruvi**
- Mahsulot CRUD (qo'shish, o'zgartirish, o'chirish)
- Har mahsulotda:
  * 3-5 rasm
  * Tavsif (ixtiyoriy)
  * Narx + chegirma narxi
  * Qoldiq miqdori
  * O'lchov birligi (dona, kg, litr)
  * Yaroqlilik muddati (expiry date)
  * Kategoriya (admin tayyor kategoriyadan tanlash)
  * Variant guruhi (Product Family ga bog'lash)
- Kirim-chiqim tarixi: har bir harakat ko'rinadi (yangi kirdi, sotildi, qaytarildi, brakka chiqarildi)
- Kam qoldiqlar ogohlantirishi (seller chegara belgilaydi, masalan: 5 dan kam qolsa)
- **Shtrix-kod skaneri** (telefon kamerasi orqali) — mahsulot qo'shish/topish tez

**Buyurtmalar**
- Yangi buyurtma → push notification (tovush bilan)
- 5 daqiqa ichida qabul qilish (vaqt o'tib ketsa avtomatik bekor)
- Status yangilash: Qabul → Yig'ilmoqda → Yo'lda → Yetkazildi
- User bilan chat va telefon

**Multi-Device**
- Bitta seller akkaunti bir vaqtda bir nechta qurilmada faol bo'la oladi
- Do'konda 2-3 ishchi bo'lsa, hammasi telefonidan buyurtmalarni ko'radi va boshqaradi

**User Blokirovkasi**
- Seller o'z do'koni uchun ma'lum bir user ni block qila oladi
- Block qilingan user bu do'kondan buyurtma bera olmaydi

**Push Notifications (FCM)**
- Yangi buyurtma keldi (tovush bilan)
- Kam qoldiqlar
- Adminning xabarlari

### 5.3 Admin Panel (Web — Next.js)

**Dashboard**
- Umumiy statistika: jami sellerlar, do'konlar, userlar, buyurtmalar, GMV
- Top sellerlar va do'konlar
- Yangi seller arizalari soni

**Seller Arizalari**
- Yuborilgan arizalarni ko'rish
- Har arizada hujjatlar, rasmlar, GPS xaritada
- Tasdiqlash yoki rad etish (rad sababini yozish)

**Kategoriyalar**
- Daraxt ko'rinishida kategoriyalar boshqaruvi
- Masalan: `Oziq-ovqat → Sut mahsulotlari → Sut, Qatiq, Smetana`
- Drag & drop bilan tartibni o'zgartirish
- Har kategoriya: nomi (3 tilda), ikonka, holati (faol/o'chirilgan)

**Foydalanuvchilar**
- Userlar ro'yxati (qidiruv, filter)
- User profilini ko'rish va vaqtinchalik block qilish
- Buyurtma tarixini ko'rish

**Do'konlar**
- Barcha do'konlar ro'yxati (xaritada va list)
- Do'konni vaqtinchalik o'chirish/yoqish
- Reytingni va shikoyatlarni ko'rish

**Analytics**
- Vaqt davomida buyurtmalar
- Top mahsulotlar
- Geografik tarqalish (xaritada)
- Konversiya: ko'rilgan → savat → buyurtma

---

## 6. Business Qoidalari

0. **⭐ Customer-First UX**: Har qanday rol (owner, menejer, kassir, sklad, yetkazib beruvchi) bo'lgan user ilovaga kirganda **birinchi navbatda customer interfeysini** ko'radi. Ish rejimi (sklad/buyurtma boshqaruvi) faqat profile page → "Mening do'konlarim" orqali ochiladi. Ish vaqtidan tashqari xodim ham customer sifatida buyurtma bera oladi.

1. **Multi-vendor cart**: Bitta xarid jarayonida turli do'konlardan mahsulot olish mumkin, lekin har do'kon uchun alohida savat va alohida buyurtma. Yetkazib berishni har do'kon o'zi qiladi.
2. **Bir seller — bir nechta do'kon**: bitta sellerga bir nechta do'kon biriktirilishi mumkin (har biri alohida sozlamali).
3. **Yetkazib berish zonasi**: faqat seller belgilagan max radius ichidagi userlarga buyurtma yuborish mumkin.
4. **Mini-order narxi**: agar savat narxi seller belgilagan minimumdan kam bo'lsa, buyurtma yuborib bo'lmaydi.
5. **5-daqiqa qabul qilish qoidasi**: seller 5 daqiqa ichida qabul qilmasa, buyurtma avtomatik bekor bo'ladi va user ga xabar ketadi.
6. **Naqd to'lov + naqd refund**: barcha to'lovlar naqd, qaytarish ham qo'l-qo'lga.
7. **Reyting faqat mahsulotga**: user do'kon reytingiga to'g'ridan-to'g'ri ta'sir o'tkaza olmaydi, faqat mahsulot baholari orqali.
8. **Partial return**: user bir buyurtma ichidagi mahsulotlardan qismini qaytara oladi, lekin faqat butun unit miqdorda.
9. **Seller userni block qila oladi**: lekin faqat o'z do'koni doirasida, butun platforma uchun emas.
10. **Multi-device seller login**: do'kondagi 2-3 ishchi bir vaqtda ishlay oladi.
11. **Erkin permission flag tizimi**: egasi har xodim uchun ruxsatlarni alohida belgilaydi. Preset shablonlar (Kassir/Menejer/Sklad ishchisi/Yetkazib beruvchi) tez yondashuv uchun mavjud.
12. **Owner-only ruxsatlar**: xodim boshqaruvi, do'kon sozlamalari (zona/min-order/ish vaqti), daromad/analytics, mahsulotni o'chirish — faqat egasi qila oladi.
13. **Mahsulot qo'shish delegatsiyasi**: egasi mahsulot qo'shish ruxsatini xodimga bera oladi, lekin **mahsulotni o'chirish** faqat egasida qoladi.
14. **QR-kod orqali taklif**: xodim qo'shish faqat QR-kod orqali (10 daqiqa amal qiladi). Egasi xodim akkauntini o'zi yarata olmaydi.
15. **Bir xodim, bir egalik**: bir xodim faqat bitta egasining do'konlarida ishlay oladi (turli egalardan emas).

---

## 7. Yuqori Darajadagi Ma'lumotlar Modeli

```
User (xaridor + seller bir akkauntda)
  ├── id, phone, name, avatar
  ├── role[]: ["customer"] yoki ["customer", "seller"]
  ├── addresses[]: bir nechta saqlangan manzil
  ├── favorites: do'konlar, mahsulotlar
  └── devices[]: FCM tokenlar (multi-device)

SellerApplication
  ├── userId, status: pending/approved/rejected
  ├── shopName, shopAddress, shopGps, shopPhotos[]
  └── stir, rejectionReason

Shop (do'kon)
  ├── id, ownerId (User), name, photos[], gps
  ├── workingHours[]: {dayOfWeek, openTime, closeTime}
  ├── holidays[]: bayram kunlari
  ├── isOpenManual: qo'l-bilan ochiq/yopiq
  ├── minOrderPrice
  ├── deliveryZone: {maxKm, freeKm, pricing: {type, ...}}
  └── blockedUsers[]: bu do'kon block qilgan userlar

ShopStaff (do'kon xodimi)
  ├── id, shopId, userId
  ├── customRoleName: erkin matn (masalan "Kechki kassir-Anvar")
  ├── permissions[]: PermissionFlag[] (masalan ["inventory.view", "orders.accept", ...])
  ├── presetUsed: "kassir" | "menejer" | "sklad" | "yetkazib_beruvchi" | "custom"
  ├── status: active | removed
  └── joinedAt, removedAt

StaffInvitation (QR-kod orqali taklif)
  ├── id, shopId, invitedByUserId (owner)
  ├── qrCodeToken (vaqtinchalik, 10 daqiqa amal qiladi)
  ├── customRoleName, permissions[], presetUsed
  ├── status: pending | accepted | rejected | expired
  ├── acceptedByUserId?
  └── createdAt, expiresAt

Category (admin yaratadi)
  ├── id, parentId, name{uz_latn, uz_cyrl, ru}, icon, order
  └── isActive

ProductFamily (variant guruhi)
  ├── id, name, categoryId, brandName?
  └── variants[]: ProductVariant

ProductVariant (= sotiladigan mahsulot)
  ├── id, shopId, productFamilyId
  ├── name, photos[], description?
  ├── unit: {type: dona/kg/litr, size: 0.5/1/1.5}
  ├── price, discountPrice?
  ├── stock, lowStockThreshold
  ├── barcode?, expiryDate?
  ├── rating: avgFromReviews
  └── isActive

InventoryMovement (kirim-chiqim tarixi)
  ├── id, productVariantId, type: in/out/sold/returned/expired
  ├── quantity, before, after
  └── reason, orderId?

Order (har do'kon uchun alohida)
  ├── id, userId, shopId, deliveryAddressId
  ├── items[]: {productVariantId, qty, price}
  ├── subTotal, deliveryFee, total
  ├── status: new/accepted/preparing/delivering/delivered/cancelled
  ├── paymentMethod: cash (MVP)
  ├── acceptedByStaffId?: kim qabul qildi (egasi yoki xodim)
  ├── deliveredByStaffId?: kim yetkazdi
  ├── timeline[]: status o'zgarishlari (kim qachon o'zgartirdi)
  └── chat[]: messages

OrderReturn (partial return)
  ├── orderId, items[]: {productVariantId, qty}
  └── createdAt

Review (mahsulot uchun)
  ├── userId, productVariantId, orderId, stars, text
  └── createdAt
```

---

## 8. To'lov Oqimi va Xavfsizlik

### 8.1 Umumiy Prinsip

Platforma **escrow** rolida ishlaydi: barcha online to'lovlar avval platforma hisobiga tushadi, 24 soatlik himoya muddatidan keyin seller balansiga o'tkaziladi. Naqd to'lovlarda esa seller jismonan pulni oladi, lekin komissiya qarzga yoziladi.

### 8.2 Online To'lov Oqimi (Click/Payme — kelajak)

```
Xaridor → Click/Payme → Platforma Hisobi
                                │
                    Order status = 'delivered'
                                │
                    ┌───────────▼────────────┐
                    │  PendingTransaction     │
                    │  amount = total         │
                    │  settlesAt = now + 24h  │
                    └───────────┬────────────┘
                                │
              24 soat o'tdi, shikoyat yo'q?
                    ┌─────────────────────┐
                   Ha                    Yo'q
                    │                     │
         Seller availableBalance     Manual review
         += (total - commission%)    Admin qaror qabul qiladi
```

### 8.3 Naqd To'lov Oqimi (Hozirgi MVP)

```
Xaridor → Jismonan seller ga naqd to'laydi
                │
    Order status = 'delivered'
                │
    ┌───────────▼─────────────────┐
    │  SellerTransaction yaratiladi│
    │  type = 'cash_order_settled' │
    │  seller.availableBalance    │
    │    += (total - commission)  │
    │  seller.debtBalance         │
    │    += commission            │  ← komissiya qarzga yoziladi
    │  debt.dueDate = now + 30d   │
    └─────────────────────────────┘
```

> Naqd to'lovda platforma pulni jismonan olmaydi — seller komissiyani keyinchalik to'laydi. Komissiya yig'iladi va seller aktiv balansidan to'lanadi.

### 8.4 Komissiya Undirishning To'liq Qoidalari

1. **Online to'lov**: Komissiya settlement vaqtida avtomatik ushlab qolinadi (platforma to'liq summani olgan bo'ladi).
2. **Naqd to'lov**: Komissiya `debtBalance` ga yoziladi. Seller aktiv balansi bo'lganda tizim avtomatik qarzni so'ndiradi (`availableBalance` dan `debtBalance` ni ushlab qoladi).
3. **Qarzni undirish tartibi**: Faqat `availableBalance` dan undiriladi. `pendingBalance` ga tegib bo'lmaydi.
4. **Qarz muddati**: Standart — 30 kun. Admin panel dan o'zgartiriladi.
5. **Muddati o'tgan qarz**: `debtDueDate` o'tib ketsa → seller barcha do'konlari `isActive = false`.
6. **Qayta faollashtirish**: Qarz to'liq so'ndirilganda → tizim avtomatik `isActive = true` qiladi.
7. **Prime obuna komissiyasi**: Prime tarif tekshiriladi, mos komissiya % qo'llanadi.

### 8.5 24 Soatlik Himoya Muddati

- Buyurtma `delivered` bo'lgandan so'ng 24 soat `pendingBalance` da qoladi.
- Bu muddat ichida xaridor shikoyat qilsa → admin ko'rib chiqadi, zarur holda qaytarish (refund) amalga oshiriladi.
- 24 soat o'tib, shikoyat bo'lmasa → `pending → available` o'tadi.
- Admin panel dan har qanday buyurtmani qo'lda hal qila oladi (`force_settle` yoki `force_refund`).

---

## 9. Seller Balance Tizimi

### 9.1 Balance Turlari

| Tur | Nomi | Tavsif |
|-----|------|--------|
| `pendingBalance` | Kutilayotgan | 24 soat himoya muddatidagi pul — yechib bo'lmaydi |
| `availableBalance` | Mavjud | Yechib olish mumkin bo'lgan mablag' |
| `debtBalance` | Qarz | Platforma ga qarzdorlik (asosan naqd buyurtmalar komissiyasi) |

### 9.2 Balance O'zgarish Hodisalari

| Hodisa | `pending` | `available` | `debt` |
|--------|-----------|-------------|--------|
| Online buyurtma yetkazildi | `+ (total - commission)` | — | — |
| 24h o'tdi, shikoyat yo'q | `- amount` | `+ amount` | — |
| Naqd buyurtma yetkazildi | — | `+ (total - comm)` | `+ commission` |
| Seller `available` dan qarz to'laydi | — | `- amount` | `- amount` |
| Seller yechib olish so'rovi tasdiqlandi | — | `- amount` | — |
| Admin refund (online) | `- amount` | — | — |
| Prime obuna to'lovi | — | `- subscriptionFee` | — |

### 9.3 Yechib Olish (Withdrawal) Jarayoni

1. Seller **"Yechib olish"** so'rovi yuboradi — miqdor + bank kartasi.
2. Tizim tekshiradi: `availableBalance >= requestedAmount` va `debtBalance == 0`.
3. Agar qarz bo'lsa — oldin qarz so'ndiriladi, qolgan summa yechiladi.
4. Admin panel da so'rov ko'rinadi → admin tasdiqlaydi.
5. Admin to'lovni qo'lda amalga oshiradi (bank orqali, Humo/Uzcard).
6. Admin "Bajarildi" belgisi qo'yadi → `availableBalance -= amount`, `WithdrawalRequest.status = completed`.

> MVP da to'lov qo'lda amalga oshiriladi. Keyinroq Click Merchant / Payme Business API orqali avtomatlashtirish mumkin.

---

## 10. Komissiya Modeli

### 10.1 Standart Komissiya

- Admin paneldan global standart komissiya % belgilanadi (masalan: `12%`).
- Bu qiymat istalgan vaqtda o'zgartiriladi.
- O'zgarish faqat **yangi** buyurtmalarga ta'sir qiladi (retrospektiv emas).

### 10.2 Prime Komissiya

- Prime obunali seller uchun alohida komissiya % belgilanadi (masalan: `7%`).
- Har Prime tarif uchun alohida komissiya % bo'ladi.
- Komissiya hisoblash vaqtida seller ning aktiv prime obunasi tekshiriladi.

### 10.3 Komissiya Olinmaydigan Holat

| Holat | Komissiya |
|-------|-----------|
| Admin tomonidan yaratilgan sinov buyurtma | 0% |
| Platforma texnik xato sababli bekor qilingan | 0% |
| Admin `exempt` belgisi qo'ygan buyurtma | 0% |

### 10.4 Komissiya Hisoblash Formuli

```
commissionRate = seller.activePrimePlan?.commissionRate ?? globalCommissionRate
commissionAmount = order.total * commissionRate / 100
sellerNet = order.total - commissionAmount
```

---

## 11. Prime Obuna

### 11.1 Konsept

Prime — seller uchun oylik/yillik obuna. Asosiy foyda: **komissiya pasayishi**.

### 11.2 Prime Tarif Tuzilmasi (Admin Boshqaradi)

Admin panel dan istalgan vaqt quyidagi parametrlarni o'zgartirish mumkin:

| Maydon | Tavsif | Misol |
|--------|--------|-------|
| `name` | Tarif nomi | "Standart", "Pro", "Ultra" |
| `monthlyPrice` | Oylik narx (so'm) | 50 000 so'm |
| `yearlyPrice` | Yillik narx (so'm) | 500 000 so'm (2 oy tekin) |
| `commissionRate` | Bu tarifdagi komissiya % | 7% |
| `isActive` | Yangi sotib olish uchun ochiq/yopiq | true/false |
| `description` | Qisqa tavsif | "Eng mashhur tanlov" |

> Narxlar va foizlar faqat YANGI obunalarga ta'sir qiladi. Joriy obuna muddati tugagunga qadar eski narx/foiz saqlanadi.

### 11.3 Prime Obuna Hayot Sikli

```
Seller prime sotib oladi
        │
  SellerSubscription yaratiladi
  startDate = today
  endDate = today + 30 kun (oylik)
  commissionRate = tarif.commissionRate (snapshot — o'zgarmaydi)
        │
  Har buyurtmada: seller.activeSubscription tekshiriladi
        │
  endDate yaqinlashganda (3 kun oldin) → eslatma notification
        │
  endDate o'tdi → subscription.isActive = false
  seller → standart komissiyaga qaytadi
```

### 11.4 Prime Obunani To'lash

- Seller `availableBalance` dan to'laydi YOKI to'g'ridan-to'g'ri Click/Payme orqali.
- Balans yetarli bo'lmasa → to'lov amalga oshmaydi (qarzga yozmaydi prime uchun).

### 11.5 Admin Panel — Prime Boshqaruvi

- Tarif yaratish/o'chirish/tahrirlash
- Aktiv obunalar ro'yxati (kim, qaysi tarif, muddati)
- Seller obunasini qo'lda uzaytirish (promo, xato tuzatish)
- Umumiy prime daromad statistikasi

---

## 12. Seller Arizasi — Yangilangan Arxitektura

### 12.1 Jarayon

```
1. User ilova orqali ariza yuboradi (minimal ma'lumot)
        │
2. Admin arizani ko'radi → seller bilan bog'lanadi (telefon)
        │
3. Admin panel da qo'shimcha ma'lumotlarni to'ldiradi
        │
4. Admin "Tasdiqlash" bosadi → SellerProfile yaratiladi
   user.isSellerApproved = true
   Shop avtomatik yaratiladi
```

### 12.2 Ariza Shaklidagi Maydonlar (User To'ldiradi)

| Maydon | Majburiy | Eslatma |
|--------|----------|---------|
| Do'kon nomi | ✅ | |
| Do'kon manzili | ✅ | |
| GPS lokatsiya | ✅ | Xaritadan tanlanadi |
| Do'kon rasmi | ❌ | Keyinroq qo'shiladi |
| STIR/INN | ❌ | Ixtiyoriy |

> User ning telefon raqami allaqachon OTP orqali tasdiqlangan — qo'shimcha tasdiq shart emas.

### 12.3 Admin Panel da To'ldiriladigan Maydonlar

| Maydon | Tavsif |
|--------|--------|
| To'liq ism (FIO) | Seller ning rasmiy ismi |
| Pasport seriyasi / PINFL | Shaxsni tasdiqlash uchun |
| STIR | Agar arizada to'ldirilmagan bo'lsa |
| Bank karta raqami | Withdrawal uchun (16 raqam, Humo/Uzcard) |
| Karta egasining ismi | Karta ustidagi ism |
| Admin izohi | Ichki eslatmalar |

### 12.4 Bank Karta Ma'lumotlari Haqida

O'zbekiston ichki kartalar (Humo/Uzcard) uchun yetarli ma'lumot:
- **Karta raqami** (16 ta raqam) — to'g'ridan-to'g'ri o'tkazma uchun yetarli
- **Karta egasining ismi** — muvofiqlikni tekshirish uchun

> Visa/Mastercard uchun expiry ham kerak bo'ladi, lekin MVP da faqat Humo/Uzcard.

---

## 13. Yangilangan Ma'lumotlar Modeli (To'lov Bloklari)

```
SellerProfile (admin to'ldiradi)
  ├── userId (User — 1:1)
  ├── fullName: string | null
  ├── passportOrPinfl: string | null
  ├── stir: string | null
  ├── bankCardNumber: string | null        (16 raqam, shifrlangan)
  ├── bankCardHolderName: string | null
  ├── verifiedAt: timestamptz | null
  ├── verifiedByAdminId: uuid | null
  └── adminNotes: text | null

SellerBalance (per seller, 1:1)
  ├── sellerId (User)
  ├── pendingBalance: decimal(15,2)        default 0
  ├── availableBalance: decimal(15,2)      default 0
  ├── debtBalance: decimal(15,2)           default 0
  ├── debtDueDate: date | null             (30 kun standart)
  └── lastDebtReminderAt: timestamptz | null

SellerTransaction (har bir moliyaviy harakat)
  ├── id: uuid
  ├── sellerId
  ├── orderId: uuid | null
  ├── type: enum
  │     'online_order_pending'   — online buyurtma yetkazildi, 24h kutish
  │     'pending_settled'        — 24h o'tdi, available ga o'tdi
  │     'cash_order_commission'  — naqd buyurtma komissiyasi (qarzga)
  │     'debt_repaid'            — qarz so'ndirildi
  │     'withdrawal_requested'   — yechib olish so'rovi
  │     'withdrawal_completed'   — yechib olish bajarildi
  │     'prime_payment'          — prime obuna to'lovi
  │     'admin_adjustment'       — admin qo'lda tuzatish
  │     'refund_debit'           — qaytarish (online)
  ├── amount: decimal(15,2)
  ├── commissionRate: decimal(5,2) | null  (snapshot)
  ├── commissionAmount: decimal(15,2) | null
  ├── status: 'pending' | 'settled' | 'cancelled'
  ├── settlesAt: timestamptz | null        (pending → settled vaqti)
  ├── description: text
  └── createdAt: timestamptz

WithdrawalRequest
  ├── id: uuid
  ├── sellerId
  ├── amount: decimal(15,2)
  ├── bankCardNumber: string               (snapshot — o'sha vaqtdagi karta)
  ├── bankCardHolderName: string
  ├── status: 'pending' | 'processing' | 'completed' | 'rejected'
  ├── requestedAt: timestamptz
  ├── processedAt: timestamptz | null
  ├── processedByAdminId: uuid | null
  └── adminNote: text | null

PrimePlan (admin boshqaradi)
  ├── id: uuid
  ├── name: string
  ├── monthlyPrice: decimal(15,2)
  ├── yearlyPrice: decimal(15,2) | null
  ├── commissionRate: decimal(5,2)         (%)
  ├── description: text | null
  ├── isActive: boolean                    (yangi sotib olishga ochiq)
  └── sortOrder: int

SellerSubscription
  ├── id: uuid
  ├── sellerId
  ├── planId (PrimePlan)
  ├── commissionRateSnapshot: decimal(5,2) (sotib olingan vaqtdagi %)
  ├── priceSnapshot: decimal(15,2)         (sotib olingan vaqtdagi narx)
  ├── startDate: date
  ├── endDate: date
  ├── isActive: boolean
  ├── cancelledAt: timestamptz | null
  └── createdAt: timestamptz

GlobalSetting (admin panel dan o'zgartiriladi)
  ├── key: string (unique)               masalan 'commission_rate_default'
  ├── value: string                      masalan '12.00'
  ├── description: text
  └── updatedAt: timestamptz
```

---

## 14. Admin Panel — To'lov Boshqaruvi

### 14.1 Seller Balance Sahifasi
- Har seller ning balance holati (pending / available / debt)
- Tranzaksiyalar tarixi (filter: tur, sana, miqdor)
- Qo'lda tuzatish (admin_adjustment) — sababni yozish shart
- Force settle / force refund (24h kutmasdan)

### 14.2 Withdrawal So'rovlari
- Kutilayotgan so'rovlar ro'yxati
- So'rovni tasdiqlash → status = 'processing' → to'lov amalga oshiriladi → 'completed'
- Rad etish (sababni yozish)

### 14.3 Qarzli Sellerlar
- Muddati o'tgan qarzlar ro'yxati
- Seller do'konlari avtomatik `not active` bo'ladi
- Admin qo'lda "Qarzni kechirish" yoki "Muddatni uzaytirish" qila oladi

### 14.4 Komissiya va Prime Sozlamalari
- Global standart komissiya % (GlobalSetting)
- Prime tarif CRUD
- Aktiv obunalar monitoringi

---

## 15. Yangilangan Biznes Qoidalari (To'lov)

16. **Escrow prinsipi**: Online to'lovlarda barcha mablag' avval platformaga tushadi. Seller o'z "balansi"ni boshqaradi, jismonan pul olmaydi.
17. **24 soatlik himoya**: Buyurtma yetkazilgandan 24 soat o'tmaguncha seller pul yecha olmaydi. Xaridor bu muddat ichida shikoyat qilishi mumkin.
18. **Naqd + komissiya qarz**: Naqd to'lovlarda komissiya `debtBalance` ga yoziladi. Seller aktiv balansi shakllanganda tizim avtomatik qarzni so'ndiradi.
19. **Qarzni undirish tartib**: Faqat `availableBalance` dan. `pendingBalance` ga tegib bo'lmaydi.
20. **Muddati o'tgan qarz = do'kon not active**: `debtDueDate` o'tib ketgan seller ning barcha do'konlari avtomatik yopiladi. Xaridorlar buyurtma bera olmaydi.
21. **Qarz to'lansa — avtomatik ochiladi**: Qarz to'liq so'ndirilganda tizim do'konlarni qayta faollashtiradi.
22. **Prime narx/foiz o'zgarishi**: Faqat yangi obunalarga ta'sir qiladi. Joriy obuna muddati tugagunga qadar eski shartlar saqlanadi.
23. **Withdrawal faqat qarzsiz**: Seller yechib olish so'rov yuborganida `debtBalance > 0` bo'lsa, avval qarz so'ndiriladi, qolgan miqdor yechiladi.
24. **Withdrawal admin tasdiqlaydi**: Avtomatik bank to'lovi yo'q (MVP). Admin qo'lda o'tkazadi va tasdiqlaydi.
25. **Komissiya olinmaydigan holat**: Admin `exempt` belgisi qo'ygan buyurtmalardan komissiya olinmaydi.

---

## 16. API va Realtime

**REST API** (NestJS, OpenAPI/Swagger)
- `/auth/*` — SMS OTP, login, refresh
- `/users/me/*` — profil, manzillar, favorites
- `/shops/*` — do'konlarni ko'rish, qidirish (GPS-based)
- `/products/*` — mahsulotlar, qidiruv, filter
- `/orders/*` — buyurtma yaratish, status, qaytarish
- `/seller/applications/*` — ariza yuborish
- `/seller/shops/*` — do'kon CRUD, sozlamalar
- `/seller/inventory/*` — sklad CRUD, barcode, history
- `/seller/orders/*` — sellerning buyurtmalari
- `/seller/balance/*` — balance ko'rish, withdrawal so'rovi
- `/seller/subscription/*` — prime obuna olish, holati
- `/admin/*` — admin endpointlari
- `/admin/balance/*` — seller balanslar, withdrawal tasdiqlash
- `/admin/prime/*` — prime tarif CRUD
- `/admin/settings/*` — global sozlamalar (komissiya % va b.)

**WebSocket (Socket.IO)**
- Buyurtma statusi real-time (user + seller)
- Yangi buyurtma keldi (seller)
- Chat xabarlari
- Do'kon ochildi/yopildi xabar

---

## 17. MVP Bosqichlari (6+ oy)

### Bosqich 1 — Fundament (1 oy)
- Server: NestJS skeleton + Docker + PostgreSQL + Redis + PostGIS
- Auth: telefon + Eskiz.uz SMS OTP
- Mobile: Expo navigation skeleton, til, brand ranglar
- Admin: Next.js skeleton, auth

### Bosqich 2 — Seller MVP (1.5 oy)
- Seller arizasi va admin tasdiqlash
- Do'kon CRUD, ish vaqti, yetkazish zonasi
- Sklad CRUD (mahsulot, narx, qoldiq, rasm)
- Barcode skaneri
- Kategoriya daraxti (admin)

### Bosqich 3 — Customer MVP (1.5 oy)
- Customer auth va profil
- GPS-based do'kon va mahsulot ko'rinishi
- Product Family + Variants
- Multi-vendor savat
- Buyurtma yaratish va status oqimi
- Naqd to'lov

### Bosqich 4 — Realtime va UX (1 oy)
- Push notifications (FCM)
- WebSocket real-time updates
- Chat (seller ↔ customer)
- Reyting va mahsulot baholash
- Partial return

### Bosqich 5 — Polish va Beta (1 oy)
- Multi-language to'liq tarjima
- Admin analytics
- Bug fixes va performance
- Beta testing (TestFlight / Internal track)

### Kelajakda (MVP dan keyin)
- Click va boshqa online to'lov integratsiyasi
- Seller analytics
- Mahsulot reklama/banner
- Loyalty program
- Bir nechta kurer (delivery network)

---

## 18. Xavfsizlik va Sifat

- HTTPS majburiy (production)
- JWT 15 daqiqa + refresh token 30 kun
- SMS OTP rate-limiting (1 daqiqada 1 marta, 1 soatda 5 marta)
- Server-side input validation (class-validator)
- Sklad operatsiyalari uchun audit log
- Database backup (kunlik)
- Image upload: tur va o'lcham tekshirish, avtomatik resize/compress
- Geolocation spoofing: hozir nazorat yo'q (MVP), keyingi versiyada anti-fraud

---

## 19. Verification (Tekshirish Rejasi)

- **Unit testlar**: NestJS (Jest)
- **E2E testlar**: API uchun supertest
- **Mobile testlar**: Expo + Jest (component testlari)
- **Manual QA**:
  - Real qurilmada Customer va Seller oqimlarini tekshirish
  - Multi-device login bir vaqtda
  - GPS sinovi turli lokatsiyalarda
  - Offline → online o'tishi
  - Push notification jonli sinovi

---

## 20. Keyingi Qadamlar (Texnik)

1. Server: `server/` ichida NestJS skeleton + Docker setup
2. Mobile: `mobile/` ichida Expo init, brand ranglar, navigation
3. Client: `client/` ichida Next.js init, auth, admin layout
4. Ma'lumotlar bazasi sxemasini yakuniy fix qilish
5. UI design (Figma) — boks-themed brand kit

---

## 21. Amalga Oshirish Rejasi — To'lov Bloki

> Bu bo'lim hozirgi loyiha holatiga qarab qaysi ketma-ketlikda to'lov tizimi qo'shilishini belgilaydi.

### Bosqich A — Fundament (Hozir qilish kerak)

**Server (NestJS):**
- [ ] `GlobalSetting` entity + admin CRUD (`commission_rate_default`, `debt_due_days`)
- [ ] `SellerProfile` entity + admin panel to'ldirish endpoint
- [ ] `SellerBalance` entity + trigger: har yangi seller uchun avtomatik yaratish
- [ ] `SellerTransaction` entity + log yozish service
- [ ] Naqd buyurtma yetkazilganda: komissiya `debtBalance` ga yozish
- [ ] Cron job: har kuni qarz muddati o'tgan sellerlar → do'konlar `isActive = false`
- [ ] Cron job: `availableBalance` dan `debtBalance` ni avtomatik so'ndirish

**Admin Panel (Next.js):**
- [ ] Seller profil sahifasi (admin to'ldiradi: FIO, pasport, STIR, bank karta)
- [ ] Seller balance ko'rish sahifasi
- [ ] Global sozlamalar sahifasi (komissiya %, qarz muddat)

### Bosqich B — Withdrawal Tizimi

**Server:**
- [ ] `WithdrawalRequest` entity
- [ ] Seller → withdrawal so'rovi endpoint
- [ ] Validatsiya: `availableBalance >= amount`, qarz so'ndirish logikasi
- [ ] Admin → tasdiqlash/rad etish endpoint
- [ ] Notification: so'rov tasdiqlandi/rad etildi

**Mobile:**
- [ ] Seller balance ko'rish ekrani
- [ ] Withdrawal so'rovi shakli

**Admin Panel:**
- [ ] Withdrawal so'rovlar ro'yxati va tasdiqlash UI

### Bosqich C — Prime Obuna

**Server:**
- [ ] `PrimePlan` entity + admin CRUD
- [ ] `SellerSubscription` entity
- [ ] Prime sotib olish endpoint (availableBalance yoki online to'lov)
- [ ] Komissiya hisoblashda aktiv subscription tekshirish
- [ ] Cron job: muddati tugagan obunalar → isActive = false + eslatma

**Mobile:**
- [ ] Prime obuna sahifasi (tariflar, sotib olish)
- [ ] Seller settings da aktiv obuna holati

**Admin Panel:**
- [ ] Prime tarif CRUD
- [ ] Aktiv obunalar monitoringi
- [ ] Seller obunasini qo'lda uzaytirish

### Bosqich D — Online To'lov (Kelajak)

- [ ] Click Merchant yoki Payme Business integratsiya
- [ ] `pendingBalance` tizimini to'liq yoqish
- [ ] 24h settlement cron job
- [ ] Xaridor shikoyat endpoint
- [ ] Admin force settle / force refund

---

## 22. Loyiha Holati va Rejalashtirish Darajasi

### Hozirgi holat (2026 yil iyun)

| Blok | Holat |
|------|-------|
| Auth (OTP, JWT) | ✅ Tayyor |
| Customer UI (mahsulot, qidiruv, xarita) | ✅ Tayyor |
| Seller sklad va buyurtma boshqaruvi | ✅ Tayyor |
| Admin panel (users, categories, notifications) | ✅ Tayyor |
| Seller ariza va tasdiqlash | ✅ Tayyor |
| To'lov oqimi (online) | ❌ Rejalashtirilmagan |
| Seller balance tizimi | ❌ Faqat spec da |
| Komissiya tizimi | ❌ Faqat spec da |
| Prime obuna | ❌ Faqat spec da |
| Withdrawal | ❌ Faqat spec da |
| MChJ + soliq muvofiqlik | 🔄 MChJ ochilmoqda |

### Rejalashtirish Darajasi

```
SPEC (bu hujjat)       ██████████  100% — arxitektura to'liq
Kod (server)           ████░░░░░░   45% — asosiy flow tayyor, to'lov yo'q
Kod (mobile)           █████░░░░░   50% — customer + seller UI asosiy
Kod (admin panel)      ████░░░░░░   40% — CRUD + notifications
To'lov bloki (kod)     ░░░░░░░░░░    0% — bosqich A boshlash kerak
```

### Eng Yaqin Keyingi Qadam

**Bosqich A** ni boshlash: `GlobalSetting` + `SellerBalance` + `SellerTransaction` + naqd komissiya qarz logikasi. Bu blok loyihaning pul oqimini boshqarishga tayyorligini ta'minlaydi.

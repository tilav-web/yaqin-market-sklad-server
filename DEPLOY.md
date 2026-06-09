# Yaqin Market — Deploy qilish tartibi

## Arxitektura

```
VPS: 176.101.56.229 (Ubuntu 24.04)
/home/yaqin-market/
  server/   → github: tilav-web/yaqin-market-sklad-server
  client/   → github: tilav-web/yaqin-market-sklad-client
  make-admin.sh
```

**Domenlar:**
- `api.yaqin-market.uz` → Nginx → `127.0.0.1:8080` (NestJS server, systemd)
- `yaqin-market.uz` → Nginx → `/home/yaqin-market/client/dist` (Next.js static export)

**Docker konteynerlar** (data services, to'xtatma):
| Konteyner | Ichki port | VPS porti | Maqsad |
|-----------|-----------|-----------|--------|
| yaqin-postgres | 5432 | 5437 | Ma'lumotlar bazasi |
| yaqin-redis | 6379 | 6381 | Cache / sessions |
| yaqin-minio | 9000/9001 | 9100/9101 | Fayl saqlash |

> ⚠️ `family-house-*` konteynerlariga tegma — boshqa loyiha!

---

## Server deploy (NestJS)

```bash
ssh root@176.101.56.229
# parol: tilav7251

cd /home/yaqin-market/server
git pull origin master
npm install          # faqat package.json o'zgansa
npm run build        # TypeScript → dist/
systemctl restart yaqin-server
systemctl status yaqin-server   # running ko'rinishi kerak
```

**Log ko'rish:**
```bash
tail -f /var/log/yaqin-server.log
```

**Agar build xato bo'lsa:**
```bash
npm run build 2>&1 | tail -30
```

---

## Client deploy (Next.js static)

```bash
cd /home/yaqin-market/client
git pull origin master
npm install          # faqat package.json o'zgansa
npm run build        # → dist/ papkasiga chiqaradi
# Nginx avtomatik yangi fayllarni ko'radi, restart shart emas
```

> `next.config.ts` da `output: "export"`, `distDir: "dist"` — Nginx to'g'ridan-to'g'ri `dist/` ni serve qiladi, Node process kerak emas.

**Env fayllar** (o'zgartirma):
```
/home/yaqin-market/client/.env.production  → NEXT_PUBLIC_API_URL=https://api.yaqin-market.uz
/home/yaqin-market/server/.env             → NODE_ENV, PORT=8080, DB, Redis, MinIO, JWT, Eskiz
```

---

## Mobile deploy (Expo APK)

Mobile dastur VPSga o'rnatilmaydi. APK EAS orqali build qilinadi:

```bash
# Lokal mashinada:
cd /home/tilav_web/Projects/miniSkald/yaqin-market/mobile
eas build --platform android --profile preview    # APK (test uchun)
eas build --platform android --profile production # AAB (Play Store uchun)
```

> `EXPO_PUBLIC_API_URL=https://api.yaqin-market.uz` `.env` da — bu Metro bundle ga baked in bo'ladi.

---

## Tipik to'liq deploy (server + client birga)

```bash
ssh root@176.101.56.229

# 1. Server
cd /home/yaqin-market/server
git pull origin master
npm run build
systemctl restart yaqin-server

# 2. Client
cd /home/yaqin-market/client
git pull origin master
npm run build

# 3. Tekshirish
systemctl status yaqin-server
curl -s https://api.yaqin-market.uz/health | head -c 100
```

---

## Har qanday o'zgarishdan keyin deploy tartibi

Kod o'zgartirish tugagandan so'ng **shu ketma-ketlikda** bajaring:

```bash
# 1. Lokal — GitHub ga push
cd /home/tilav_web/Projects/miniSkald/yaqin-market/server && git push origin master
cd /home/tilav_web/Projects/miniSkald/yaqin-market/client && git push origin master

# 2. VPS — pull + build
sshpass -p 'tilav7251' ssh root@176.101.56.229 '
  cd /home/yaqin-market/server && git pull && npm run build && systemctl restart yaqin-server
  cd /home/yaqin-market/client && git pull && npm run build
'
```

> Faqat server o'zgansa — faqat server qismini, faqat client o'zgansa — faqat client qismini bajaring.

---

## Muhim eslatmalar

- **Lokal git push kerak** — VPS `git pull` dan oldin lokal `git push origin master` qilingan bo'lishi shart
- **Server .env** da `FIXED_OTP_CODE=111111` bor — produksiyada haqiqiy Eskiz SMS ishlashi uchun `ESKIZ_EMAIL` va `ESKIZ_PASSWORD` to'ldirilishi kerak
- **TypeORM `synchronize: true`** — server restart qilganda yangi entity column'lari avtomatik qo'shiladi (migration kerak emas, dev/prod ikkalasida ham)
- **Docker restart shart emas** — Postgres/Redis/MinIO to'xtovsiz ishlaydi
- **Nginx restart** faqat nginx config o'zgarganda: `systemctl reload nginx`

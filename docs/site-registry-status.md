# Site Registry — สถานะงานและแผนต่อ

รวมทะเบียนไซต์โซลาร์ทุกค่าย/ทุกแอปติดตามไว้ที่เดียว แล้วต่อยอดเป็นทะเบียนลูกค้า
+ ทะเบียนงานซ่อมบำรุง

- Branch: `feat/site-registry` (ยังไม่ push / ยังไม่เปิด PR)
- Supabase: โปรเจกต์ `hisolar-tracker` (`hlswbazcojsnfibirkzl`)
- อัปเดตล่าสุด: 2026-07-29

## เสร็จแล้ว

### Sprint 1 — Data Foundation
- `supabase/site-registry.sql` — ตาราง `hi_solar_sites` + dimension
  `hi_solar_inverter_brands` (5) / `hi_solar_platforms` (6) + คอลัมน์ `site_id`
  ใน `hi_solar_jobs` และ `hi_solar_permits` + RLS
- `supabase/site-registry-rollback.sql` — rollback ทั้งชุด
- `scripts/import-site-registry.mjs` — upsert idempotent บน
  `(platform_code, platform_plant_id)`, dry-run เป็น default, `--commit` เพื่อเขียนจริง
- **apply เข้า prod แล้ว** 2 migration: `site_registry_foundation`,
  `site_registry_tighten_write_policies`
- **โหลดข้อมูลแล้ว 271 ไซต์** — Huawei 157 / Deye 106 / Solis 8 · รวม 4,732.6 kWp

### Sprint 2 — Registry & Search UI
- `sites.html` — ค้นหา (ชื่อ/ที่อยู่/เบอร์/ผู้ติดต่อ/รหัสไซต์/รหัสในแอป) + กรองยี่ห้อ
  + bottom sheet รายละเอียด + ปุ่มโทร/นำทาง + ประวัติงานต่อไซต์
- `hisolar_planner.html` — เพิ่มปุ่มลัดเข้าหน้าทะเบียน

## เหลือทำ

### Sprint 4 — Job Tags & Timeline (แนะนำทำก่อน Sprint 3)
ทำก่อนเพราะทำให้หน้า `sites.html` ที่เสร็จแล้วมีข้อมูลครบทันที

1. **Backfill `hi_solar_jobs.site_id`** — ตอนนี้ยังเป็น NULL ทั้ง 125 งาน ทำให้
   ช่อง "งานบริการของไซต์นี้" ว่างทุกไซต์ จับคู่ด้วย `customer_name` / `phone`
   เทียบกับ `hi_solar_sites.site_name` / `address` (ต้อง normalize ช่องว่างซ้อน
   แบบเดียวกับตอน merge FusionSolar — ดูหัวข้อ "กับดัก" ด้านล่าง)
2. ทำเหมือนกันกับ `hi_solar_permits.site_id` (15 แถว)
3. หน้าบันทึกงาน: เลือกไซต์ → เลือก Tag → บันทึกเข้า `hi_solar_jobs` พร้อม `site_id`
4. รอบล้างแผง / PM: เก็บรอบต่อไซต์ + วันครบกำหนดถัดไป แล้วต่อกับ LINE reminder เดิม
   (`scripts/daily-reminder.js`)

Tag งานใช้ `sheet_key` เดิมของ planner ไม่ต้องสร้างใหม่:
`ngan` (งานติดตั้ง) · `duNgan` (ดูงาน) · `langPaeng` (ล้างแผง) · `som` (ซ่อมบำรุง) ·
`bil` (บิล VAT) — ส่วนงานขออนุญาตอยู่ใน `hi_solar_permits` แยกอยู่แล้ว

### Sprint 3 — Map & Geo
1. เติม `latitude` / `longitude` (คอลัมน์มีแล้ว ยังว่าง) — geocode จาก `address`
   หรือดึงจาก `maps_url`
2. หน้าแผนที่: หมุดแยกสีตามยี่ห้อ/สถานะ + cluster + แตะดูการ์ด + ปุ่มนำทาง

### Backlog
เตือนรอบ PM เข้า LINE · QR ประจำไซต์ · ออกใบงาน/ใบเสนอราคา PDF ·
sync สถานะจาก API ค่าย (แทนการ export ไฟล์เอง) · แดชบอร์ดผู้บริหาร · สิทธิ์ตามบทบาท

## กับดักที่เจอมาแล้ว (อย่าพลาดซ้ำ)

- **ช่องว่างซ้อนในชื่อไซต์** — FusionSolar sheet หนึ่งพิมพ์ `Mother Heart␣␣Cafe`
  อีก sheet พิมพ์เว้นวรรคเดียว ทำให้ 9 ชื่อไม่แมตช์ ต้อง `re.sub(r'\s+',' ')`
  ก่อนจับคู่เสมอ — จะเจออีกตอน backfill `site_id`
- **วันที่ปนกัน ค.ศ./พ.ศ.** — FusionSolar ส่งออกทั้งสองแบบ importer แปลงให้แล้ว
  (ปี > 2500 ลบ 543) DB เก็บเป็น ค.ศ. เสมอ
- **Capacity บางแถวเป็นวัตต์** — เช่น 13750 ที่จริงคือ 13.75 kWp importer หาร 1000
  ให้เมื่อเกิน 500 kWp
- **UI แสดงวันที่เป็น พ.ศ.** — `toLocaleDateString('th-TH')` ใช้ปฏิทินไทย
  (2025 → 2568) ถูกต้องแล้ว ไม่ใช่บั๊ก อย่า "แก้"
- **`applyUserSummary` รับ element id เป็น string** ไม่ใช่ตัว element และรับ
  `user` / `membership` แยกกัน (ดู `line-auth-client.js`)
- **ไฟล์ข้อมูลลูกค้าเป็น PII** — `Solar_Site_DATA/*.xlsx|xls|jpg` และ
  `_reference/sites_seed.csv` อยู่ใน `.gitignore` แล้ว **อย่า commit ขึ้น GitHub**
- **เขียน `hi_solar_sites` ต้องใช้ service role** — ไม่มี policy ให้ anon เขียน
  (ถอดออกตามที่ Supabase advisor เตือน)

## หนี้ด้านความปลอดภัยที่เจอ (คนละ scope กับงานนี้ ยังไม่แตะ)

จาก Supabase security advisor:
- 🔴 **ERROR** — ตาราง `line_group_daily_replies` เปิด public แต่ไม่ได้เปิด RLS
- 🟡 `auth_sessions` เปิด RLS แต่ไม่มี policy
- 🟡 `hi_solar_jobs` มี policy `Public update gcal sync` แบบ always-true (anon เขียนได้)
- 🟡 helper functions หลายตัวเป็น SECURITY DEFINER ที่ anon เรียกได้

## วิธีรันซ้ำ

```bash
# ตรวจ seed ก่อนเขียนจริง (ไม่แตะ DB)
node scripts/import-site-registry.mjs

# เขียนจริง (ต้องใช้ service role key)
SUPABASE_URL=https://hlswbazcojsnfibirkzl.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
node scripts/import-site-registry.mjs --commit
```

`sites_seed.csv` สร้างจาก `Solar_Site_DATA/master_registry.xlsx` ซึ่งรวมมาจาก
ไฟล์ export ของแต่ละค่ายใน `Solar_Site_DATA/`

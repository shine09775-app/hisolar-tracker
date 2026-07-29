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

### Sprint 3 — Map & Geo
- `map.html` — Leaflet + OpenStreetMap (ไม่ต้องใช้ API key) หมุดแยกสีตามยี่ห้อ
  + กรองยี่ห้อพร้อมจำนวน + แตะหมุดดูรายละเอียด + ปุ่มโทร/นำทาง
- **เก็บพิกัดจากหน้างาน** — เลือกไซต์จากรายการ "ยังไม่มีพิกัด" → แตะแผนที่วางหมุด
  หรือกด ⌖ ใช้ GPS อุปกรณ์ → ลากปรับได้ → บันทึกลง `hi_solar_sites.latitude/longitude`
- `sites.html` เพิ่มปุ่มลัดเข้าแผนที่

**ทำไมไม่ geocode อัตโนมัติ:** ที่อยู่ที่ได้จาก export ค่ายไม่มีโครงสร้าง
(เช่น `ประเทศไทยอ.หางดงต.หารแก้วซอยบ้านวัวลาย174`) แถมต้องใช้ geocoding API
ที่มีค่าใช้จ่ายและผลลัพธ์คลาดเคลื่อนสูง การให้ช่างปักหมุดตอนไปหน้างานแม่นกว่ามาก
และไม่มีค่าใช้จ่าย — ข้อมูลจะทยอยครบเองตามรอบงานจริง

## เหลือทำ

### Sprint 4 (บางส่วน) — ผูกงานเข้าไซต์
- `link-jobs.html` — ไล่ผูก 125 งานเข้าไซต์ทีละงาน มีตัวช่วยแนะนำไซต์ที่น่าจะใช่
  (ชื่อตรง / ชื่อมีคำร่วม / เบอร์ตรง / maps_url ตรง) ให้คนกดยืนยัน ค้นหาเองก็ได้
  ยกเลิกการผูกได้ พร้อมแถบความคืบหน้า

**ทำไมไม่ backfill อัตโนมัติ:** วัดแล้วจับคู่ได้แค่ ~5 จาก 125 งาน (ชื่อตรง 2 ·
ชื่อมีคำร่วม 4 · เบอร์ตรง 1) เพราะงานมาจาก Google Sheet ใช้ชื่อเล่นลูกค้า
(`แหม่ม`, `สวนส้มจงลักษณ์`) ส่วนไซต์มาจากพอร์ทัลค่ายใช้ชื่อโรงไฟฟ้า
(`JL FARM 5`) การจับคู่แบบหลวมจะผูกผิด ทำให้ช่างเห็นประวัติซ่อมของลูกค้าคนอื่น
ซึ่งแย่กว่าไม่ผูก จึงให้ระบบ "แนะนำ" แล้วให้คนยืนยันแทน

### Sprint 4 (ต่อ) — โครงสร้างข้อมูลแบบมีไซต์เป็นแกน
`supabase/site-registry-v2.sql` (apply เข้า prod แล้ว: `site_registry_v2_site_centric`)

- `source` (import/manual) + `lifecycle` (lead/installing/active/inactive) —
  ไซต์ที่สร้างตอนไปติดตั้งใหม่ยังไม่ต้องมี `platform_code`/`platform_plant_id`
  ค่อยเติมทีหลังเมื่อลงทะเบียนในพอร์ทัลค่ายแล้ว
- `site_code` ออกอัตโนมัติจาก sequence (ต่อจาก HS-0271) ผ่าน trigger
- ฟิลด์บำรุงรักษา: `clean_interval_months`, `next_clean_date`,
  `warranty_inverter_expiry`, `warranty_panel_expiry`, `inverter_model`,
  `inverter_count`, `panel_count`
- view `hi_solar_site_overview` — 1 แถวต่อไซต์ พร้อมสรุปงาน (job_count,
  clean_count, repair_count, last_clean_date, last_repair_date, permit_count)
  + `clean_due_state` (overdue / due_soon / scheduled) ใช้ `security_invoker`
  จึงคง RLS เดิม
- trigger: บันทึกงานล้างแผงที่ผูกไซต์ → เลื่อน `next_clean_date` ให้เอง
  ตามรอบที่ตั้งไว้ (ทดสอบแล้ว: ล้าง 20 ก.ค. รอบ 6 เดือน → 20 ม.ค. 2027)

### Sprint 4 (ที่เหลือ)
1. `hi_solar_permits.site_id` (15 แถว) — ทำแบบเดียวกับ jobs
2. หน้าบันทึกงานใหม่: เลือกไซต์ → เลือก Tag → บันทึกพร้อม `site_id` ตั้งแต่ต้น
   (จะได้ไม่ต้องมาไล่ผูกทีหลังอีก)
3. รอบล้างแผง / PM: เก็บรอบต่อไซต์ + วันครบกำหนดถัดไป ต่อกับ LINE reminder เดิม
   (`scripts/daily-reminder.js`)

Tag งานใช้ `sheet_key` เดิมของ planner ไม่ต้องสร้างใหม่:
`ngan` (งานติดตั้ง) · `duNgan` (ดูงาน) · `langPaeng` (ล้างแผง) · `som` (ซ่อมบำรุง) ·
`bil` (บิล VAT) — ส่วนงานขออนุญาตอยู่ใน `hi_solar_permits` แยกอยู่แล้ว

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

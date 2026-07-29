# LINE Auth Cutover Runbook (Phase 4)

ขั้นตอนปิดระบบเดิม = ลบ anon policies ด้วย `supabase/line-auth-cutover.sql`
**นี่คือขั้นที่ย้อนยากที่สุด** — ทำเมื่อทุกคนย้ายมาระบบใหม่ครบและใช้งานจริงเสถียรแล้วเท่านั้น

> สัญลักษณ์: 👤 = คุณทำบน dashboard/console · 💻 = โค้ด/CLI · 🗄️ = SQL บน Supabase

---

## สิ่งที่ cutover ทำจริง

ต้องรัน **2 ไฟล์คู่กัน** ในหน้าต่างเดียวกัน:

### 1) `line-auth-cutover.sql` — ตารางเดิม (13 policies / 5 ตาราง)
- `hi_solar_jobs` — Public read / insert / update / update gcal sync (4)
- `hi_solar_job_comments` — Public read / insert (2)
- `hi_solar_job_logs` — Public read (1)
- `hi_solar_permits` — Public read / insert / update (3)
- `hi_solar_permit_logs` — Public read / insert (2)

### 2) `site-registry-cutover.sql` — 🆕 ตาราง site registry
> ไฟล์ `line-auth-cutover.sql` เขียนไว้**ก่อน**ที่ site registry จะเกิด จึงไม่ครอบคลุม
- `hi_solar_sites` — drop `Public read sites` (policy ผูก role `public` ซึ่งรวม anon → anon อ่าน **ชื่อลูกค้า/ที่อยู่/เบอร์/พิกัด ของ 271 ไซต์** ได้)
- `hi_solar_inverter_brands` / `hi_solar_platforms` — เปลี่ยน public read → authenticated read
- `line_group_daily_replies` — เปิด RLS ปิดช่องโหว่ที่ advisor เตือน

**ปลอดภัยที่จะ drop:** `hi_solar_sites` มี policy authenticated ครอบอยู่แล้ว
(`Authenticated read sites by org` + `Authenticated write sites hisolar admin member`)
หน้า `sites.html` / `map.html` / `link-jobs.html` / `home.html` ใช้ LINE auth + publishable key + JWT อยู่แล้ว จึงไม่พัง

หลังรันทั้งสอง: **anon key อ่าน/เขียนไม่ได้อีกทั้งระบบ** → ระบบเดิม (PIN + anon) หยุดทำงานทันที (ตามตั้งใจ) ส่วน authenticated JWT + RLS ยังทำงานปกติ

---

## Preconditions — ต้องเป็นจริงทุกข้อก่อนรัน (Gate)

- [ ] ทีม **Hi Solar** ทุกคน login ระบบใหม่ + ถูก approve แล้ว (ตรวจ: ไม่มี pending ค้างที่ยังต้องใช้งาน)
- [ ] ทีม **JDK** ทุกคน login ระบบใหม่แล้ว (auto-approve `commenter`)
- [ ] ระบบใหม่ใช้งานจริงเสถียร **อย่างน้อย 2–3 วัน** ไม่มีปัญหา
- [ ] ✅ `daily-reminder.js` แก้ให้ใช้ `SUPABASE_SERVICE_ROLE_KEY` แล้ว (backward-compatible) — *ทำแล้วบน branch*
- [ ] 👤 เพิ่ม GitHub secret **`SUPABASE_SERVICE_ROLE_KEY`** ใน repo (Settings → Secrets and variables → Actions)
- [ ] 💻 การแก้ `daily-reminder.js` + workflow อยู่บน **`main`** แล้ว (cron รันจาก main เสมอ)
- [ ] 👤 ตั้ง **Production env vars** บน Vercel ครบ (เหมือนที่ตั้งใน Preview) + register callback ของ production domain
- [ ] 🗄️ **Backup** schema + policies ปัจจุบัน และจดเวลาก่อนรัน

---

## ลำดับการทำ (Cutover Day)

### Step 1 — 👤 เตรียม production ให้เป็นระบบใหม่
เลือก 1 แนวทาง:

- **แนะนำ: Promote เป็น production จริง** — ตั้ง Production env บน Vercel + เพิ่ม callback URL ของ production ใน LINE Console:
  ```
  https://hisolar-tracker.vercel.app/api/auth/line/callback
  ```
  แล้ว **merge `codex/line-auth-tracker-hardening` → `main`** → Vercel deploy production ใหม่ = ระบบ LINE auth
- **หรือชั่วคราว: ให้ทุกคนใช้ branch alias URL ต่อไป** แล้วปิด/redirect `hisolar-tracker.vercel.app` ทิ้ง (กัน user เจอ old app ที่พังหลัง cutover)

> ⚠️ ถ้าไม่ทำ Step นี้ หลัง cutover คนที่เข้า `hisolar-tracker.vercel.app` (old production) จะเจอแอปเปล่า/พัง เพราะ old code ใช้ anon

### Step 2 — 🗄️ รัน cutover SQL (ทั้ง 2 ไฟล์ ติดกัน)
รันในช่วงเวลาที่ควบคุมได้ (นอกเวลางานหน้างาน) และมีคนพร้อม rollback:
```text
1) supabase/line-auth-cutover.sql
2) supabase/site-registry-cutover.sql
```
> ถ้ารันแค่ไฟล์แรก ระบบเดิมจะปิด แต่ทะเบียนไซต์ (PII มากกว่า) ยังเปิดให้ anon อ่านอยู่

### Step 3 — 💻 ยืนยัน integrations ที่ใช้ service-role ยังทำงาน (ไม่โดน RLS)
- [ ] Apps Script sync (`hi-solar-apps-script.js`) — sync ชีต → Supabase ได้
- [ ] Calendar sync (`api/webhook/sync-calendar.js`) — service_role ✅
- [ ] LINE webhook (`api/webhook/line-jdk-group.js`) — service_role ✅
- [ ] **Daily reminder** — trigger `workflow_dispatch` ของ `daily-reminder-hisolar.yml` ด้วยมือ 1 ครั้ง → ต้องได้ข้อมูลงาน/permit จริง (พิสูจน์ว่า service-role key ทำงาน)

### Step 4 — 💻 ยืนยัน anon ถูกปิดจริง
```bash
# ต้องได้ [] (ว่าง) หรือ error สิทธิ์ — อ่านไม่ได้แล้ว
curl "$SUPABASE_URL/rest/v1/hi_solar_jobs?select=id&limit=1" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY"
```
- [ ] anon อ่าน `hi_solar_jobs` / `hi_solar_permits` ไม่ได้แล้ว
- [ ] **anon อ่าน `hi_solar_sites` ไม่ได้แล้ว** (สำคัญ — เป็น PII ลูกค้า)
- [ ] authenticated user (login LINE) ยังเห็นข้อมูล + คอมเมนต์ได้ตามปกติ
- [ ] **`sites.html` / `map.html` / `link-jobs.html` / `home.html` ยังใช้งานได้** (ค้นหาไซต์ / หมุดแผนที่ / ผูกงาน)

### Step 5 — 👤 ปิดทางเข้าเดิม
- [ ] ยืนยัน production domain ชี้ระบบใหม่ (จาก Step 1) และ user เข้าผ่าน LINE login เท่านั้น

---

## งานเก็บตกที่ควรทำคู่ cutover

- [x] 🗄️ ปิดช่องโหว่ `line_group_daily_replies` — **รวมอยู่ใน `site-registry-cutover.sql` แล้ว**
  หลังรัน ให้ตรวจว่า `line-jdk-group.js` (service-role) ยังเขียน dedup ได้ตามปกติ

## เรื่อง branch: ไม่ต้อง merge สองสาย — `feat/site-registry-pr` คือสายรวมอยู่แล้ว

ตรวจ git history แล้ว: `feat/site-registry-pr` **ต่อยอดมาจาก** `codex/line-auth-tracker-hardening`
(มี commit `79d0ee6` / `4436f22` / `3e32bfd` ของ LINE auth ครบใน history)

```
main ──────────────────────────────────► (ตามหลัง 17 commits)
        └── codex/line-auth-tracker-hardening
                    └── feat/site-registry-pr  ← สายรวม: auth + site registry
```

ก่อน cutover ต้อง:
- [x] รวมงาน — ไม่ต้องทำ `feat/site-registry-pr` มีครบแล้ว
- [x] commit `b95dd6b` (Telegram env) ที่มีเฉพาะบน codex — **ผสานเข้า workflow แล้ว**
- [ ] merge `feat/site-registry-pr` → `main` (สายเดียวจบ)
- [ ] 👤 อัปเดต Vercel Preview/Production env + LINE callback ให้ครอบคลุม deployment ที่จะใช้จริง
- [ ] 💻 `npm test` ผ่านก่อน deploy production

### ⚠️ Routing ของ launcher (แก้แล้ว — ต้องมีก่อน deploy)

`index.html` เรียก `startLineLogin('hisolar', '/home.html')` แต่ `config.js` เดิม
allowlist มีแค่ `/hisolar_planner.html` → จะได้ **400 "return_to is not allowed"**

แก้ที่ `api/_lib/config.js` แล้ว:
- `hisolar.successPath` = `/home.html` (launcher เป็นหน้าแรกหลัง login)
- allowlist เพิ่ม `/hisolar_planner.html`, `/sites.html`, `/map.html`, `/link-jobs.html`
  → เปิดลิงก์ลึกโดยไม่มี session แล้วล็อกอินกลับมาหน้าเดิมได้
- `jdk` ยังแยกขาด: `/JDK.html` เท่านั้น (กันข้ามแอป)

---

## Rollback (ถ้าหลัง cutover มีปัญหาหน้างาน)

รันคืน anon policies (คู่กันทั้งสองไฟล์):
```text
1) supabase/line-auth-cutover-rollback.sql
2) supabase/site-registry-cutover-rollback.sql
```
⚠️ การคืน policy = **เปิด DB ให้ browser key อ่าน/เขียนได้อีกครั้ง** (ความปลอดภัยลดลงชั่วคราว) — บันทึกเวลาที่คืนไว้

**หลักการเลือก rollback:**
- ถ้าเฉพาะ LINE Login/auth มีปัญหา แต่ authenticated Supabase/RLS ยังดี → **คง RLS ปิดไว้** แก้ที่ env/endpoint ก่อน
- คืน anon เฉพาะกรณีงานหน้างานหยุดจริงและธุรกิจยอมรับความเสี่ยงชั่วคราว
- rollback frontend: revert production ไป deployment เดิม หรือ redeploy commit ก่อน merge

---

## หมายเหตุความปลอดภัย: rollback policy มีชื่อ author hard-coded

`line-auth-cutover-rollback.sql` (policy `"Public insert comments"` / `"Public insert permit logs"`) จำกัด `author`/`actor` ไว้เฉพาะรายชื่อ: `Shine, Wassan, Wave, OT, Lui, Aoom, ไม่ระบุ` — ถ้าทีมเปลี่ยน ให้แก้ไฟล์ rollback ก่อนใช้จริง

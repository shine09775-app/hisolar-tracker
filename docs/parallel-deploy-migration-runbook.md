# Parallel Deploy Migration Runbook (Hi Solar first)

แผนแม่บทการย้ายจากระบบเดิม (PIN + localStorage + anon policies) ไประบบใหม่ (LINE Login + RLS)
โดยใช้กลยุทธ์ **deploy URL ใหม่คู่ขนาน → ย้าย Hi Solar ก่อน → ย้าย JDK → แล้วค่อยปิดของเดิม**

Branch: `codex/line-auth-tracker-hardening`

---

## หลักการที่ห้ามลืม (ข้อจำกัดจริงของระบบ)

1. **Database เดียวกัน** — URL ใหม่และเดิมชี้ Supabase project เดียวกัน โค้ด/session แยกกัน แต่ data ไม่แยก
2. **Cutover เป็นสวิตช์ตัวเดียว** — การลบ anon policies (`supabase/line-auth-cutover.sql`) ทำให้ระบบเดิม **พังทั้ง Hi Solar และ JDK พร้อมกัน** จึงต้องทำ**เป็นขั้นตอนสุดท้าย** หลังทุกคนย้ายครบ
3. **Host canonicalization** — `LINE_LOGIN_CALLBACK_URL` ต้องตรงกับ host ของ deployment นั้นเป๊ะ ไม่งั้น login จะเด้งไป host อื่น
4. **Migration ก่อน cutover ต้อง additive เท่านั้น** (foundation / provider-identity / org-scope) — ไม่กระทบระบบเดิม
5. ตลอดเฟส 1–3 **ระบบเดิมคือ safety net** ถ้าตัวใหม่มีปัญหา ให้คนกลับไปใช้ URL เดิมได้ทันที

สัญลักษณ์ผู้รับผิดชอบ: 👤 = คุณทำบน dashboard/console · 💻 = แก้ในโค้ด/รันเทสต์ · 🗄️ = รัน SQL บน Supabase

---

## Phase 0 — Baseline & Backup

- [x] 💻 รันเทสต์ผ่านครบ (`npm test` → 36/36) — *ทำแล้ว*
- [ ] 👤 Export schema + policies ปัจจุบันจาก Supabase (Database → Backups หรือ `pg_dump`) เก็บไว้
- [ ] 👤 บันทึก env vars ปัจจุบันของ production (เผื่อ rollback)
- [ ] 👤 ยืนยันระบบเดิมยังใช้งานได้ปกติ (PIN/localStorage) — **ยังไม่แตะ**
- [ ] 💻 ยืนยัน `main` = production ปัจจุบัน และงานใหม่ยังอยู่บน branch เท่านั้น

**Gate 0:** มี backup + จดค่า env เดิมครบ → ไปต่อ

---

## Phase 1 — Deploy URL ใหม่คู่ขนาน (ยังไม่แตะ production)

### 1.1 👤 สร้าง deployment ใหม่บน Vercel
- ทางเลือกที่ง่ายสุด: ใช้ **Vercel Preview** ของ branch `codex/line-auth-tracker-hardening` (ได้ URL เฉพาะอัตโนมัติ)
- หรือสร้าง Vercel project แยก แล้วชี้มา branch นี้
- จด URL ที่ได้ เช่น `https://hisolar-tracker-<hash>.vercel.app`

### 1.2 👤 เพิ่ม Callback URL ใน LINE Developers Console
- ไปที่ LINE Login channel (`LINE_LOGIN_CHANNEL_ID = 2010738223`)
- เพิ่ม Callback URL: `https://<URL-ใหม่>/api/auth/line/callback`
- **เก็บ callback เดิมไว้ด้วย** (LINE ใส่ได้หลายอัน) — ของเดิมจะได้ไม่พัง

### 1.3 👤 ตั้ง Environment Variables บน deployment ใหม่ให้ครบ
| Env | ค่า |
|-----|-----|
| `SUPABASE_URL` | เหมือน production เดิม |
| `SUPABASE_SERVICE_ROLE_KEY` | เหมือนเดิม (server-only) |
| `LINE_LOGIN_CHANNEL_ID` | `2010738223` |
| `LINE_LOGIN_CHANNEL_SECRET` | ของ channel นี้ |
| `LINE_LOGIN_CALLBACK_URL` | ⚠️ `https://<URL-ใหม่>/api/auth/line/callback` (ต้องตรง host ใหม่) |
| `LINE_LOGIN_PROVIDER_NAMESPACE` | `hisolar-tracker-line` (ต้องเท่าเดิม ไม่งั้น identity ไม่ unify) |
| `AUTH_SESSION_SECRET` | สุ่มยาว ≥ 32 bytes |
| `AUTH_SESSION_COOKIE_NAME` | `hs_session` (ปล่อย default ได้) |
| `AUTH_FLOW_COOKIE_NAME` | `hs_auth_flow` (ปล่อย default ได้) |
| `AUTH_SESSION_MAX_AGE_SECONDS` | `604800` |
| `SUPABASE_JWT_PRIVATE_KEY` | คีย์เซ็น JWT (server-only) |
| `SUPABASE_JWT_KID` | kid ของคีย์ |
| `SUPABASE_JWT_ISSUER` | `https://<ref>.supabase.co/auth/v1` |
| `SUPABASE_JWT_AUDIENCE` | `authenticated` |

> อ้างอิงรายการเต็ม: `.env.example` · ค่าจริง (local): `.env.local`

### 1.4 🗄️ รัน additive migrations บน Supabase (ตามลำดับ — **ยังไม่รัน cutover**)
```text
1) supabase/line-auth-foundation.sql
2) supabase/line-auth-provider-identity.sql
3) supabase/line-auth-org-scope.sql
```
migration เหล่านี้เพิ่มตาราง/policy ใหม่แบบ additive — ระบบเดิมยังทำงานปกติเพราะ anon policies ยังอยู่

**Gate 1:** เปิด `https://<URL-ใหม่>/api/auth/line/start?app=hisolar` แล้วเด้งไปหน้า LINE Login ได้ และ callback กลับมาไม่ error → ไปต่อ

---

## Phase 2 — ย้าย Hi Solar (data สำคัญสุด: permit/job)

### 2.1 🗄️ Seed แอดมิน Hi Solar คนแรก
1. ให้เจ้าของ/แอดมิน login ที่ URL ใหม่ 1 ครั้ง (จะกลายเป็น pending)
2. หา `app_user_id` และอนุมัติเป็น `admin` ตาม `docs/hisolar-member-approval-runbook.md` (ข้อ 1 + ข้อ 3)

### 2.2 👤 ให้ทีม Hi Solar login LINE ทีละคน แล้วอนุมัติ
- ส่ง URL ใหม่ให้ทีม → แต่ละคนกด login LINE 1 ครั้ง → เกิด pending
- อนุมัติตาม `docs/hisolar-member-approval-runbook.md` (ข้อ 2 หรือข้อ 4 อนุมัติทีละหลายคน)
- normal staff = `member`, เจ้าของ/ผู้ดูแล = `admin`

### 2.3 💻 เดิน Preview verification checklist ส่วน Hi Solar
ตาม `docs/vercel-preview-live-verification-checklist.md`:
- Section **A** (Hi Solar real-user) — login, อ่าน/แก้ job, คอมเมนต์, realtime, header แสดงชื่อ/รูป LINE
- Section **C** (pending/suspended/wrong-app ถูกปฏิเสธ)
- Section **E** (เข้าตรง `hisolar_planner.html` ไม่มี session ต้องเด้ง login)
- Section **F** (logout/expire/refresh token)
- Section **G** (Maps/phone/comment identity)
- Section **H** (page source ไม่มี secret) ← สำคัญด้านความปลอดภัย

**Gate 2:** ทีม Hi Solar ทุกคนใช้งาน URL ใหม่ได้จริงครบถ้วน + checklist A/C/E/F/G/H ผ่าน → ไปต่อ
(ระหว่างนี้ JDK ยังใช้ระบบเดิมตามปกติ)

---

## Phase 3 — ย้าย JDK (ง่ายสุด: auto-approve)

### 3.1 👤 ส่ง URL ใหม่ให้ทีม JDK
- JDK login LINE ครั้งแรก = **auto-approve เป็น `commenter` อัตโนมัติ** (ไม่ต้องอนุมัติมือ)
- ยกเว้น membership ที่ถูก suspend/revoke จะยังถูกบล็อก (พฤติกรรมถูกต้องตามดีไซน์)

### 3.2 💻 เดิน checklist ส่วน JDK
- Section **B** (JDK real-user — เห็นเฉพาะ sheet JDK, คอมเมนต์ได้, ไม่มีปุ่มแก้ job)
- Section **D** (dual-membership + JDK token ยิง REST ฝั่ง Hi Solar ไม่ได้)

**Gate 3:** ทีม JDK ทุกคนอยู่บน URL ใหม่ + checklist B/D ผ่าน → พร้อม cutover
**ยืนยันสำคัญ:** ไม่มีใคร (ทั้ง Hi Solar และ JDK) เหลือค้างบน URL/ระบบเดิมแล้ว

---

## Phase 4 — Cutover: ปิดของเดิม (จุดที่ย้อนยากที่สุด)

> ทำในช่วงเวลาที่ควบคุมได้ (นอกเวลางานหน้างาน) และมีคนพร้อม rollback

### 4.1 🗄️ รัน cutover migration (ลบ anon policies)
```text
supabase/line-auth-cutover.sql
```
หลังจุดนี้ **anon ยิงตรง Supabase ไม่ได้อีก** — ระบบเดิมหยุดทำงานทันทีทั้งสองแอป (ตามตั้งใจ)

### 4.2 💻 ยืนยัน service-role integrations ยังทำงาน (ไม่โดน RLS)
- Google Apps Script sync (`hi-solar-apps-script.js`)
- Calendar sync endpoint (`api/webhook/sync-calendar.js`)
- LINE reminder/webhook (`scripts/daily-reminder.js`, `api/webhook/*`)

### 4.3 💻 ยืนยัน anon ถูกปิดจริง
- ยิง REST ด้วย publishable key ตรง ๆ ต้องอ่าน/เขียนไม่ได้ (checklist Section I)

### 4.4 👤 เปลี่ยนทางเข้าเดิม → URL ใหม่
- ชี้ domain production เดิมมาที่ deployment ใหม่ **หรือ** วาง redirect หน้าเดิมไป URL ใหม่

**Gate 4:** ระบบเดิมปิด, anon ถูกล็อก, integrations ปกติ, ทุกคนใช้ URL ใหม่ → เสร็จการย้าย

---

## Phase 5 — Cleanup

- [ ] 💻 ลบ PIN UI + name modal เดิม, ลบการใช้ localStorage identity, ลบ `VIEWER_USERS` ที่ตายแล้ว
- [ ] 💻 merge branch `codex/line-auth-tracker-hardening` → `main`
- [ ] 💻 อัปเดตเอกสาร setup/operational
- [ ] 👤 revoke session เก่าถ้าต้องการเริ่มนับใหม่

---

## Rollback ต่อเฟส

| เฟส | ถ้ามีปัญหา ทำอย่างไร |
|-----|----------------------|
| 1–3 (ก่อน cutover) | หยุดส่งคนไป URL ใหม่ → ทุกคนกลับใช้ระบบเดิม (anon ยังอยู่ ไม่กระทบ). ตารางใหม่เป็น additive ทิ้งไว้ได้ |
| 4 (หลัง cutover) | รัน `supabase/line-auth-cutover-rollback.sql` เพื่อคืน anon policies (⚠️ เปิด DB ให้ browser key อีกครั้ง) + revert domain กลับ deployment เดิม. บันทึกเวลาที่คืน policy ไว้ |

**Emergency:** ถ้าเฉพาะ LINE Login พังแต่ authenticated Supabase/RLS ยังดี ให้คง RLS ปิดไว้แล้วแก้ที่ env/endpoint ก่อน — คืน anon เฉพาะกรณีงานหน้างานหยุดจริงและยอมรับความเสี่ยงชั่วคราว

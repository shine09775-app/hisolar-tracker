# ดึงไซต์จาก Deye Cloud เข้าทะเบียน

ปุ่ม 🔄 ในหน้า `sites.html` เรียก `/api/sites/sync-deye` ซึ่งอ่านรายชื่อโรงไฟฟ้า
จากบัญชี Deye Cloud แล้วเพิ่ม **เฉพาะไซต์ที่ยังไม่มีในทะเบียน**

- อัปเดตล่าสุด: 2026-08-06
- Supabase migration ที่ apply เข้า prod แล้ว: `deye_cloud_api_sync`

## ทำไมใช้ REST ไม่ใช่ MCP

Deye เปิด remote MCP ที่ `https://developer.deyecloud.com/openmcp/mcp`
(Streamable HTTP, ต่อได้ ไม่ต้อง auth ตอน connect — ทดสอบแล้ว server ตอบ
`deye-open-mcp` v1.27.2, 39 tools) แต่ MCP มีไว้ให้ **AI client** คุยกับบัญชี
เป็นภาษาคนได้ ตัวมันเองก็ห่อ REST API ตัวเดียวกันนี้อีกที

งานเราเป็นการดึงข้อมูลจาก backend ตามรอบ ไม่มีคนมานั่งคุย จึงยิง REST ตรง:
ไม่ต้องถือ MCP session ไม่ต้องแกะ SSE และจบใน 1 request ต่อ 1 หน้า

ถ้าอยากต่อ MCP ไว้ถาม Deye จาก Claude Code ด้วย (คนละเรื่องกับ app):

```bash
claude mcp add --transport http deye-open https://developer.deyecloud.com/openmcp/mcp
```

## เอา AppId / AppSecret มาจากไหน

พอร์ทัล `developer.deyecloud.com` เป็น SPA เมนูไม่มี href ตรง ๆ เส้นทางจริงคือ

| หน้า | URL |
|---|---|
| Quick Start (มีวิธีทั้งหมด) | `/start` |
| **Application** (ออก AppId/AppSecret) | **`/app`** |
| API Documentation (Swagger) | `/api` |
| OpenAPI FAQ | `/support/openApi/faq` |

ที่ `/app` → กรอกฟอร์ม new Application → ระบบออก **AppId** กับ **AppSecret** ให้
(Quick Start เขียนว่า "Please save this information securely" — เห็นครั้งเดียว
ให้เก็บทันที)

## ตั้งค่า env บน Vercel

Vercel → Project → Settings → Environment Variables (scope **Production** และ
**Preview** ถ้าจะทดสอบบน preview ด้วย)

| ตัวแปร | จำเป็น | หมายเหตุ |
|---|---|---|
| `DEYE_APP_ID` | ✅ | AppId จาก `/app` |
| `DEYE_APP_SECRET` | ✅ | AppSecret จาก `/app` |
| `DEYE_EMAIL` | ✅* | อีเมลบัญชี Deye Cloud |
| `DEYE_PASSWORD` | ✅* | รหัสผ่านบัญชี (โค้ด sha256 ให้เองก่อนส่ง) |
| `DEYE_PASSWORD_SHA256` | – | ใช้แทน `DEYE_PASSWORD` ถ้าไม่อยากเก็บ plaintext |
| `DEYE_REGION` | – | `eu` (ค่าเริ่มต้น) / `am` / `india` |
| `DEYE_COMPANY_ID` | – | เฉพาะตอนบัญชีอยู่หลายองค์กร (ดูหัวข้อถัดไป) |
| `DEYE_MOBILE` + `DEYE_COUNTRY_CODE` | – | ใช้แทน `DEYE_EMAIL` ถ้าล็อกอินด้วยเบอร์ |

\* ต้องมี `DEYE_EMAIL` หรือ `DEYE_MOBILE` อย่างใดอย่างหนึ่ง

**`DEYE_REGION` ต้องตรงกับศูนย์ข้อมูลที่บัญชีถูกสร้าง** ไม่งั้น `/v1.0/account/token`
จะตอบว่าไม่มีบัญชีนี้ ทั้งที่รหัสผ่านถูก — Quick Start บอกให้เลือกตามที่ตั้งอุปกรณ์:
ยุโรป/แอฟริกา/เอเชียแปซิฟิก → `eu` · อเมริกาเหนือ-ใต้ → `am`
(ไทยอยู่เอเชียแปซิฟิก → `eu`)

## Business Member ต้องขอ token สองรอบ

จุดนี้พลาดง่ายที่สุดและ**พังแบบดูเหมือนสำเร็จ** — Quick Start หัวข้อ
"Business Member" ระบุว่า

1. `POST /v1.0/account/token?appId=…` body `{appSecret, email, password}` → token ของ**คน**
2. `POST /v1.0/account/info` (ใส่ token จากข้อ 1) → ได้ `orgInfoList[].companyId`
3. `POST /v1.0/account/token?appId=…` body เดิม **+ `companyId`** → token ของ**องค์กร**

โรงไฟฟ้าเป็นของ *องค์กร* ไม่ใช่ของคน ถ้าหยุดที่ข้อ 1 แล้วยิง `/v1.0/station/list`
เลย มันจะตอบ **200 พร้อม `stationList` ว่าง** ซึ่งอ่านเหมือน "บัญชีนี้ไม่มีโรงไฟฟ้า"
ทั้งที่จริงคือ token ผิด scope

`api/_lib/deye-cloud.js` ทำครบทั้ง 3 ขั้นให้เอง:

- เจอ **1 องค์กร** → ขอ token รอบสองอัตโนมัติ ไม่ต้องตั้งอะไร
- เจอ **หลายองค์กร** → หยุดแล้วฟ้องพร้อมรายชื่อ `companyId = ชื่อ (role)` ให้เลือก
  แล้วเอาไปใส่ `DEYE_COMPANY_ID` (ไม่เดาให้ เพราะเดาผิด = ดึงไซต์ของบริษัทอื่นเข้ามา)
- เจอ **0 องค์กร** → เป็น personal account ใช้ token แรกได้เลย

ชื่อองค์กรที่ token ผูกอยู่จะถูกส่งกลับมาแสดงบนจอยืนยันด้วย (`companyName`)
จะได้แยกออกว่า "ไม่มีไซต์" กับ "ต่อผิดองค์กร" คนละเรื่องกัน

token อายุ 60 วัน (`expiresIn` 5183999) โค้ด cache ไว้ข้าม warm invocation
และจะหมดอายุทันทีถ้ามีการเปลี่ยนรหัสผ่านหรือแก้ role

## กันข้อมูลซ้ำยังไง

ทะเบียนมี Deye อยู่แล้ว 106 ไซต์ แต่อยู่ใต้ `platform_code = 'SOLARMAN'`
เพราะตอนนั้นดูผ่านแอป Solarman ไซต์เดียวกันที่ดึงมาจาก Deye Cloud API จะมาพร้อม
`platform_code = 'DEYECLOUD'` และ id คนละตัว → unique key
`(platform_code, platform_plant_id)` **มองไม่เห็นว่าซ้ำ** และจะสร้างแถวที่สอง

การ sync จึงเช็ก 2 ชั้น

1. **`(platform_code, platform_plant_id)`** — เจอ = อัปเดตแถวเดิม (รันซ้ำได้ไม่งอก)
2. **ชื่อไซต์ที่ normalize แล้ว** เทียบกับทุกไซต์ในทะเบียน — เจอ = **ข้าม** และ
   รายงานว่าไปตรงกับ `site_code` ไหน ไม่ดึงเข้ามาซ้ำ

normalize = NFKC + ยุบช่องว่างซ้อนเหลือช่องเดียว + trim + lowercase
(ยุบช่องว่างสำคัญ — ตอน import FusionSolar เคยพลาดเพราะ `Mother Heart␣␣Cafe`
กับ `Mother Heart␣Cafe` ไม่แมตช์กัน 9 ชื่อ)

จับคู่ด้วย **ชื่อตรงเป๊ะเท่านั้น** ไม่ใช้การจับคู่แบบหลวม ด้วยเหตุผลเดียวกับ
`link-jobs.html` — ผูกผิดแย่กว่าไม่ผูก ถ้ามีไซต์ที่ควรเข้ามาแต่ถูกข้าม ให้แก้ชื่อ
ในทะเบียนให้ต่างกันก่อนแล้วกดดึงใหม่

## ฟิลด์ไหนถูกเขียนทับ ฟิลด์ไหนไม่

| กลุ่ม | ฟิลด์ | พฤติกรรม |
|---|---|---|
| แพลตฟอร์มเป็นเจ้าของ | `site_name`, `capacity_kwp`, `status`, `grid_connection_date` | **รีเฟรชทุกครั้ง** |
| คน/หน้างานเป็นเจ้าของ | `customer_name`, `phone`, `address`, `latitude`, `longitude` | **เติมเฉพาะตอนยังว่าง** ไม่เขียนทับ |
| ดิบ | `raw_data`, `synced_at` | เก็บ station object ทั้งก้อนไว้ทุกครั้ง |

พิกัดไม่เขียนทับเพราะ `map.html` มีไว้ให้ช่างปักหมุดหน้างาน ซึ่งแม่นกว่าพิกัดจากแอปค่าย

`generationPower` / `batterySOC` เก็บไว้ใน `raw_data` เฉย ๆ ยังไม่แมปลง
`current_power_kw` เพราะ swagger ไม่ได้ระบุหน่วย — ค่าที่ผิด 1000 เท่าแย่กว่าค่าว่าง

## การใช้งาน

ปุ่มขึ้นเฉพาะ role `admin` / `member` (ตรงกับ RLS policy
`Authenticated write sites hisolar admin member`) การซ่อนปุ่มเป็นแค่ UX —
ตัวกันจริงคือการเช็ก role ใน handler เพราะการเขียนใช้ service role

กดปุ่มแล้วจะเป็น 2 จังหวะเสมอ

1. **dry run** — ยิง `{"dryRun": true}` แสดงว่าจะเพิ่มกี่ไซต์ อัปเดตกี่ไซต์
   ข้ามกี่ไซต์ พร้อมรายชื่อ **ยังไม่เขียนอะไรลงฐานข้อมูล**
2. กด "ยืนยัน ดึงเข้าทะเบียน" → ยิง `{"dryRun": false}` เขียนจริง แล้วโหลด
   ทะเบียนใหม่ในหน้า

`site_code` ของไซต์ใหม่ออกจาก sequence เดิมผ่าน trigger `hi_solar_sites_set_code`
(ต่อจาก HS-0271) ไม่ต้องส่งมาเอง

## ทดสอบ

```bash
npm test
```

`tests/deye-sync-mapping.test.js` คุมเรื่อง mapping + กันซ้ำ
`tests/deye-sync-endpoint.test.js` คุม handler (สิทธิ์, dry-run ไม่เขียน,
รันซ้ำไม่งอก, Deye ล่มต้องขึ้น error ไม่ใช่เงียบ) โดย stub ทั้ง Deye และ Supabase

## เหลือทำ

- ยังต้องกดปุ่มเอง — ถ้าอยากให้ดึงอัตโนมัติทุกคืน ต่อกับ Vercel Cron ยิง
  `{"dryRun": false}` ได้ แต่ต้องเปลี่ยน auth จาก session cookie เป็น shared
  secret header แบบ `api/webhook/sync-calendar.js`
- ไซต์ที่ถูกข้ามเพราะซ้ำ ยังไม่ได้เติม `platform_plant_id` ของ Deye Cloud ลงแถว
  SOLARMAN เดิม ถ้าอยากดึงข้อมูลเรียลไทม์ต่อไซต์พวกนั้นในอนาคต ต้องเก็บ mapping
  เพิ่ม (คนละคอลัมน์ หรือแยกตาราง เพราะ 1 แถวมีได้ 1 platform)

# Mobile-only Polish — บันทึกสิ่งที่แก้ไปแล้ว

**ทิศทาง:** คงเป็น mobile-only (คอลัมน์เดียว) ต่อไป ไม่ทำ responsive เต็มรูปแบบ
แต่ทำให้เปิดบน desktop แล้วดูตั้งใจและอ่านง่ายขึ้น

สถานะ: **ทำเสร็จแล้ว** — ไม่แตะ DOM, ไม่แตะ JS, ไม่มีไฟล์ใหม่ (`npm test` 118/118 ผ่าน)

---

## 1. บั๊ก: navbar ไม่ sticky บนจอ ≥576px

`hi-solar-theme-reference.css` ตั้ง `overflow: hidden` บน `#app` ในบล็อก `@media (min-width: 576px)`
ซึ่งทำให้ `#app` กลายเป็น scroll container → `.hs-navbar` ที่เป็น `position: sticky; top: 0`
ไป stick กับกล่อง `#app` ที่ไม่ได้ scroll แทน viewport แถบเขียวจึงเลื่อนหายไปกับหน้า

กระทบเฉพาะ `hisolar_planner.html` (ไฟล์เดียวที่โหลดธีมนี้) และเฉพาะจอ ≥576px

**แก้:** `overflow: hidden` → `overflow: clip`
`clip` ตัดขอบมนได้เหมือนเดิมทุกประการ แต่ไม่สร้าง scroll container

**ยืนยันแล้วใน browser จริง** (A/B บนหน้าเดียวกัน หลังเลื่อน 600px):

| | ตำแหน่ง navbar หลังเลื่อน |
|---|---|
| `overflow: hidden` (เดิม) | `-592px` → เลื่อนหลุดจอไปแล้ว |
| `overflow: clip` (ใหม่) | `0px` → ค้างบนสุดถูกต้อง |

---

## 2. เปิดให้ zoom ได้

ทั้ง 6 ไฟล์เดิมเป็น:

```html
<meta name="viewport" content="... maximum-scale=1.0, user-scalable=no">
```

เปลี่ยนเป็น `width=device-width, initial-scale=1, viewport-fit=cover`

ผู้ใช้กด `Ctrl` + `+` ขยายทั้งหน้าเองได้ — เป็นวิธีที่ถูกที่สุดในการทำให้ mobile-only
อ่านง่ายบนจอใหญ่ ส่วน `user-scalable=no` ขัด WCAG 1.4.4 อยู่แล้ว
`viewport-fit=cover` จำเป็นเพราะ `.sheet-box` ใช้ `env(safe-area-inset-bottom)`

ไฟล์: `hisolar_planner.html`, `sites.html`, `map.html`, `link-jobs.html`, `home.html`, `JDK.html`

---

## 3. ขยายคอลัมน์ 480 → 560px และแยกพื้นหลัง (เฉพาะ ≥576px)

เดิม `body` กับ `#app` เป็นสี `#f1f5f9` เหมือนกัน บนจอใหญ่จึงมองไม่ออกว่าขอบแอปอยู่ไหน
ตอนนี้ backdrop เป็น `#dde5ee` เข้มกว่า พร้อมเงา คอลัมน์จึงอ่านเป็น "ตัวแอป" ชัดเจน

```css
@media (min-width: 576px) {
  body   { background: #dde5ee; }
  #app   { max-width: 560px; box-shadow: 0 14px 44px rgba(15,23,42,.18); }
  .sheet { max-width: 560px; }
}
```

`JDK.html` ไม่ต้องแก้ `body` (เป็น `#e2e8f0` ต่างจาก `#app` อยู่แล้ว)

### ⚠️ กับดักที่เจอตอนทำ — media query ไม่เพิ่ม specificity

ครั้งแรกวางบล็อกนี้ไว้ **ต้น** stylesheet (ถัดจาก `#app`) ผลคือ `#app` ได้ 560px
แต่ `.sheet` ยังเป็น 480px เพราะ base rule `.sheet { max-width: 480px }`
อยู่**ล่างกว่า**ในไฟล์เดียวกัน — specificity เท่ากัน ตัวที่อยู่ทีหลังชนะ
การห่อด้วย `@media` ไม่ได้เพิ่มน้ำหนักให้เลย

**กติกา:** บล็อก `@media (min-width: 576px)` ต้องอยู่**ท้ายสุดของ `<style>`** เสมอ
ตอนนี้ทุกไฟล์วางไว้ท้ายแล้ว ถ้าจะเพิ่ม override ใหม่ ให้เพิ่มในบล็อกนั้น

**สามค่าที่ต้องขยับพร้อมกันเสมอ** ไม่งั้นขอบจะไม่ตรงกัน:
`#app` · `.bottom-nav` (fixed, `left:50%` + `translateX(-50%)`) · `.sheet-box` / `.sheet`

---

## 4. ขยายฟอนต์ที่เล็กเกินไป (planner, ≥576px)

`.stat-item .num` 23px · `.stat-item .lbl` 11.5px · `.nav-btn` 11.5px + ไอคอน 22px ·
`.card-date` / `.card-meta` 12.5px · `.cal-dow` 11.5px · แถบ `.m2-bar` / `.m2-pill` 10.5px

### ⚠️ กับดักที่สอง — theme file โหลดทีหลัง

`hi-solar-theme-reference.css` ถูก `<link>` ไว้**หลัง** `<style>` inline และมันนิยาม
`.stat-item .num`, `.stat-item .lbl`, `.card-date`, `.card-meta` ไว้ด้วย
rule ที่เขียนใน inline style จึงแพ้เพราะ specificity เท่ากันแต่มาก่อน

**แก้:** scope ด้วย `#app` เช่น `#app .stat-item .lbl { ... }` → specificity `(1,0,2)` ชนะ `(0,0,2)`
(`.cal-dow` กับ `.m2-bar` ไม่ต้อง scope เพราะธีมไม่ได้นิยามไว้)

---

## 5. `100vh` → `100dvh`

แก้ครบทุกไฟล์แล้ว (`map.html` ใช้อยู่ก่อนแล้ว) — บนมือถือ `100vh` ไม่นับแถบ URL ที่ยุบ/ขยาย

---

## 6. กัน `:hover` ค้างบนจอสัมผัส

ย้าย hover rule ที่เปลี่ยนสีพื้นเข้าไปใน `@media (hover: hover)`:

- `hisolar_planner.html` — `.hs-navbar .sites-link`, `.bulk-link`, `.cal-view-btn`, `.cal-day`
- `link-jobs.html` — `.sug-btn`
- `hi-solar-theme-reference.css` — `.bulk-link`

`.btn-primary:hover` ปล่อยไว้ (เป็นแค่การเปลี่ยนเฉดปุ่ม เหมือนที่ Bootstrap ทำ)

---

## ผลการตรวจรับ

ตรวจทั้ง 6 หน้าที่ **390px** และ **1280px** ด้วย computed style จริงในเบราว์เซอร์:

| | 390px | 1280px |
|---|---|---|
| `#app` / `.sheet` / `.bottom-nav` | 480px ทั้งหมด (เท่าเดิม) | 560px ทั้งหมด ตรงกัน |
| `#app` overflow (planner) | `visible` | `clip` |
| `.stat-item .lbl` (planner) | 10px (เท่าเดิม) | 11.5px |
| scroll แนวนอน | ไม่มี | ไม่มี |

`npm test` → 118 passed / 0 failed

---

## สิ่งที่ตัดออก (ไม่ได้ทำ และยังไม่แนะนำให้ทำ)

- ❌ แยก `hs-shell.css` — งานเหลือน้อยจน copy ข้ามไฟล์คุ้มกว่ารื้อ
- ❌ Side rail แทน bottom nav / card grid หลายคอลัมน์ / bottom sheet → center dialog
- ❌ Master–detail (list ซ้าย + รายละเอียดขวา) — ต้องรื้อ `switchTab()` และ sheet ทั้งชุด
- ❌ ย้ายไป framework หรือ build step — ไม่จำเป็นเลยกับงานระดับนี้

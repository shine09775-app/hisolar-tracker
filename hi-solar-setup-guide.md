# Hi Solar Job Tracker â€” Setup Guide (Supabase Edition)

## à¹„à¸Ÿà¸¥à¹Œà¹ƒà¸™à¹‚à¸›à¸£à¹€à¸ˆà¸„
| à¹„à¸Ÿà¸¥à¹Œ | à¸„à¸³à¸­à¸˜à¸´à¸šà¸²à¸¢ |
|---|---|
| `index.html` | Web App à¸«à¸¥à¸±à¸ (Bootstrap + Kanit + Supabase JS) |
| `supabase-setup.sql` | SQL à¸ªà¸£à¹‰à¸²à¸‡ tables + seed data + RLS policies |
| `hi-solar-setup-guide.md` | à¸„à¸¹à¹ˆà¸¡à¸·à¸­à¸™à¸µà¹‰ |

---

## à¸‚à¸±à¹‰à¸™à¸•à¸­à¸™à¸—à¸µà¹ˆ 1 â€” à¸ªà¸£à¹‰à¸²à¸‡ Supabase Project

1. à¹„à¸›à¸—à¸µà¹ˆ supabase.com â†’ Start your project (à¸Ÿà¸£à¸µ)
2. Sign in à¸”à¹‰à¸§à¸¢ GitHub
3. New Project: Name = hisolar-tracker, Region = Southeast Asia (Singapore)
4. à¸£à¸­ ~2 à¸™à¸²à¸—à¸µ

---

## à¸‚à¸±à¹‰à¸™à¸•à¸­à¸™à¸—à¸µà¹ˆ 2 â€” à¸£à¸±à¸™ SQL Setup

1. Supabase Dashboard â†’ SQL Editor â†’ New query
2. Copy à¹‚à¸„à¹‰à¸”à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸”à¸ˆà¸²à¸ supabase-setup.sql â†’ Paste â†’ Run
3. à¹€à¸«à¹‡à¸™ "Success" = à¹„à¸”à¹‰ 5 tables + à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸„à¸£à¸š

---

## à¸‚à¸±à¹‰à¸™à¸•à¸­à¸™à¸—à¸µà¹ˆ 3 â€” Copy API Keys

1. Settings â†’ API
2. Copy: Project URL à¹à¸¥à¸° anon public key

---

## à¸‚à¸±à¹‰à¸™à¸•à¸­à¸™à¸—à¸µà¹ˆ 4 â€” à¹ƒà¸ªà¹ˆ Keys à¹ƒà¸™ index.html

```js
const SUPABASE_URL      = 'https://xxxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
```

---

## à¸‚à¸±à¹‰à¸™à¸•à¸­à¸™à¸—à¸µà¹ˆ 5 â€” Deploy GitHub + Vercel

1. à¸­à¸±à¸›à¹‚à¸«à¸¥à¸” index.html à¹ƒà¸«à¸¡à¹ˆà¸‚à¸¶à¹‰à¸™ GitHub repo
2. Vercel auto-deploy à¸ à¸²à¸¢à¹ƒà¸™ 30 à¸§à¸´à¸™à¸²à¸—à¸µ

---

## à¸‚à¸±à¹‰à¸™à¸•à¸­à¸™à¸—à¸µà¹ˆ 6 â€” à¹€à¸›à¸´à¸” Realtime

Supabase â†’ Database â†’ Replication â†’ à¹€à¸›à¸´à¸” Realtime à¸ªà¸³à¸«à¸£à¸±à¸šà¸—à¸¸à¸ table

---

## Architecture

Supabase (PostgreSQL) â†” REST API + WebSocket â†” index.html â†” GitHub/Vercel â†” à¸—à¸µà¸¡à¸‡à¸²à¸™ (à¸¡à¸·à¸­à¸–à¸·à¸­)

à¸‚à¹‰à¸­à¸”à¸µà¹€à¸«à¸™à¸·à¸­ Google Sheets:
- Real-time: à¸Šà¹ˆà¸²à¸‡à¸­à¸±à¸›à¹€à¸”à¸• à¸—à¸¸à¸à¸„à¸™à¹€à¸«à¹‡à¸™à¸žà¸£à¹‰à¸­à¸¡à¸à¸±à¸™ à¹„à¸¡à¹ˆà¸•à¹‰à¸­à¸‡ refresh
- SQL: query à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸¢à¹‰à¸­à¸™à¸«à¸¥à¸±à¸‡ filter à¸ªà¸–à¸´à¸•à¸´à¹„à¸”à¹‰
- à¹„à¸¡à¹ˆà¸¡à¸µ Apps Script middleware à¹€à¸£à¹‡à¸§à¸à¸§à¹ˆà¸²
- à¸Ÿà¸£à¸µ 500MB + unlimited API calls

*Hi Solar Job Tracker v2.0 â€” Supabase Edition*


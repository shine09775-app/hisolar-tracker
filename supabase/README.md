# Hi Solar Supabase Setup

## 1. Create tables

Open Supabase SQL Editor and run:

```sql
-- copy/paste supabase/schema.sql
```

This creates:

- `hi_solar_jobs`
- `hi_solar_job_comments`
- `hi_solar_job_logs`

`hi_solar_jobs` uses `(sheet_key, sheet_row)` as the upsert key, so running sync repeatedly updates the same Sheet rows instead of duplicating them.

`hi_solar_job_comments` stores each comment as its own row:

- `job_id`
- `author`
- `message`
- `commented_at`
- `created_at`

The schema allows the website anon key to read, insert, and update `hi_solar_jobs` for internal team usage, and allows anon users to insert comments when the author is one of `Shine`, `Wassan`, `Wave`, `OT`, `Lui`, or `Aoom`.

## 2. Set Apps Script secrets

In Google Apps Script, set these in **Project Settings > Script Properties**:

- `SUPABASE_URL`: `https://xxxx.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key

Do not put the service role key in `index.html`.

For the website, put only these public values in `index.html`:

```js
const SUPABASE_URL = 'https://xxxx.supabase.co';
const SUPABASE_ANON_KEY = 'your anon public key';
```

Never put `SUPABASE_SERVICE_ROLE_KEY` in `index.html`.

You can also reload the Google Sheet and use:

`Hi Solar > à¸•à¸±à¹‰à¸‡à¸„à¹ˆà¸² Supabase`

That menu stores the same values in Script Properties.

## 3. Run bulk sync

Reload the Google Sheet after saving the Apps Script.

Use the menu:

`Hi Solar > Sync à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸”à¹€à¸‚à¹‰à¸² Supabase`

To make it a visible sheet button:

1. In Google Sheet, insert a Drawing or image.
2. Click the drawing menu.
3. Choose **Assign script**.
4. Enter:

```text
syncAllSheetsToSupabase
```

## 4. What gets synced

The sync reads these sheets:

- `à¸‡à¸²à¸™`
- `à¸”à¸¹à¸‡à¸²à¸™`
- `à¸¥à¹‰à¸²à¸‡à¹à¸œà¸‡`
- `à¸‹à¹ˆà¸­à¸¡`
- `à¸šà¸´à¸¥`

It maps Thai column headers into structured Supabase columns and also stores the original row in `raw_data`.

Comments in `à¸«à¸¡à¸²à¸¢à¹€à¸«à¸•à¸¸` are imported into `hi_solar_job_comments` when they match this format:

```text
[dd/MM/yyyy HH:mm] à¸œà¸¹à¹‰à¹€à¸‚à¸µà¸¢à¸™: à¸‚à¹‰à¸­à¸„à¸§à¸²à¸¡
```

Legacy notes that do not match this format stay in `hi_solar_jobs.note`.


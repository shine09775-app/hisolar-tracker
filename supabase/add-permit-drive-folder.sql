-- Add Google Drive project folder link to permits
alter table public.hi_solar_permits
  add column if not exists drive_folder_url text;

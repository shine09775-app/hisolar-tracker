// Turning Deye Cloud stations into hi_solar_sites rows, and deciding which of
// them we already have.
//
// The wrinkle this exists for: the 106 Deye plants already in the registry were
// loaded from a *Solarman* export (platform_code SOLARMAN), because that is the
// app those jobs were commissioned on. The same physical plant pulled from the
// Deye Cloud API arrives with a different platform_code and a different vendor
// id, so the unique (platform_code, platform_plant_id) key does not see it as a
// duplicate — it would happily create a second row for a site we already track.
//
// So the sync matches on the site name as well, and skips anything that already
// exists under another platform rather than importing it twice.

const PLATFORM_CODE = 'DEYECLOUD';
const BRAND_CODE = 'DEYE';

// A few plants in the vendor exports had capacity typed in watts (13750 for a
// 13.75 kWp rooftop). Nothing in this fleet is near 500 kWp, so the importer
// scales those back down — kept identical here so API rows and imported rows
// stay comparable.
const CAPACITY_SANITY_KWP = 500;

const STATUS_LABEL = {
  NORMAL: 'Online',
  ONLINE: 'Online',
  OFFLINE: 'Offline',
  ALARM: 'Fault',
  FAULT: 'Fault',
};

// Fields the platform owns: a sync always refreshes them.
const REFRESH_FIELDS = [
  'site_name',
  'capacity_kwp',
  'status',
  'grid_connection_date',
];

// Fields a person may have filled in from the field. map.html exists because
// vendor coordinates were worse than a technician standing on the roof, and
// phone/customer come from the office — so the sync only fills these when they
// are still empty, and never overwrites.
const FILL_IF_EMPTY_FIELDS = [
  'customer_name',
  'phone',
  'address',
  'latitude',
  'longitude',
];

// FusionSolar sheets shipped "Mother Heart␣␣Cafe" in one export and a single
// space in another, which cost us 9 unmatched names last time. Collapse
// whitespace before comparing anything, always.
function normalizeSiteName(value) {
  return String(value == null ? '' : value)
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function toNumber(value) {
  const n = Number.parseFloat(String(value == null ? '' : value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function toCapacityKwp(value) {
  const n = toNumber(value);
  if (n === null || n <= 0) return null;
  return n > CAPACITY_SANITY_KWP ? n / 1000 : n;
}

function toStatus(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return null;
  return STATUS_LABEL[raw.toUpperCase()] || raw;
}

// startOperatingTime is a 10-digit unix timestamp typed as a string. Deye sets
// it to local midnight, so formatting in UTC would land a day early for
// anything east of Greenwich — use the station's own timezone when it sent one.
function toDateString(unixSeconds, timeZone) {
  const seconds = toNumber(unixSeconds);
  if (seconds === null || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
    return /^\d{4}-\d{2}-\d{2}$/.test(parts) ? parts : date.toISOString().slice(0, 10);
  } catch (_error) {
    // Unknown IANA zone from the API — fall back rather than fail the sync.
    return date.toISOString().slice(0, 10);
  }
}

function isEmpty(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

// One Deye station -> the columns of hi_solar_sites we can fill from it.
function mapStation(station, { syncedAt = new Date().toISOString() } = {}) {
  const timeZone = station.regionTimezone || null;
  return {
    organization: 'hisolar',
    platform_code: PLATFORM_CODE,
    brand_code: BRAND_CODE,
    platform_plant_id: String(station.id),
    source: 'import',
    source_file: 'deye-cloud-api',
    site_name: String(station.name || '').replace(/\s+/g, ' ').trim() || `Deye ${station.id}`,
    customer_name: isEmpty(station.ownerName) ? null : String(station.ownerName).trim(),
    phone: isEmpty(station.contactPhone) ? null : String(station.contactPhone).trim(),
    address: isEmpty(station.locationAddress) ? null : String(station.locationAddress).trim(),
    latitude: toNumber(station.locationLat),
    longitude: toNumber(station.locationLng),
    capacity_kwp: toCapacityKwp(station.installedCapacity),
    status: toStatus(station.connectionStatus),
    grid_connection_date: toDateString(station.startOperatingTime, timeZone),
    // generationPower / batterySOC are kept raw: the spec does not state units,
    // and a current_power_kw that is wrong by 1000x is worse than an empty one.
    raw_data: station,
    synced_at: syncedAt,
  };
}

// The row to send for a station we already hold under DEYECLOUD.
function buildUpdate(mapped, existing) {
  const patch = { raw_data: mapped.raw_data, synced_at: mapped.synced_at };
  for (const field of REFRESH_FIELDS) {
    if (mapped[field] !== null && mapped[field] !== undefined) patch[field] = mapped[field];
  }
  for (const field of FILL_IF_EMPTY_FIELDS) {
    if (!isEmpty(mapped[field]) && isEmpty(existing[field])) patch[field] = mapped[field];
  }
  return patch;
}

/**
 * Sort the stations into what to insert, what to update, and what to leave
 * alone because the registry already has it under another platform.
 *
 * @param stations  raw station objects from /v1.0/station/list
 * @param existingSites  every hi_solar_sites row (id, site_code, site_name,
 *                       platform_code, platform_plant_id, + the fill-if-empty
 *                       columns)
 */
function planSync(stations, existingSites, { syncedAt } = {}) {
  const byPlantId = new Map();
  const byName = new Map();

  for (const site of existingSites || []) {
    if (site.platform_code === PLATFORM_CODE && site.platform_plant_id) {
      byPlantId.set(String(site.platform_plant_id), site);
    }
    const key = normalizeSiteName(site.site_name);
    // First one wins: if the registry already holds two sites under the same
    // name, reporting the earliest is enough for a person to go and look.
    if (key && !byName.has(key)) byName.set(key, site);
  }

  const inserts = [];
  const updates = [];
  const duplicates = [];
  const seenPlantIds = new Set();

  for (const station of stations || []) {
    if (station == null || station.id === undefined || station.id === null) continue;
    const plantId = String(station.id);
    // The API has handed back the same plant on two pages before; do not let
    // that turn into two conflicting rows in one upsert batch.
    if (seenPlantIds.has(plantId)) continue;
    seenPlantIds.add(plantId);

    const mapped = mapStation(station, { syncedAt });
    const known = byPlantId.get(plantId);

    if (known) {
      updates.push({ id: known.id, siteCode: known.site_code, mapped, patch: buildUpdate(mapped, known) });
      continue;
    }

    const nameMatch = byName.get(normalizeSiteName(mapped.site_name));
    if (nameMatch) {
      duplicates.push({
        stationId: plantId,
        stationName: mapped.site_name,
        matchedSiteCode: nameMatch.site_code,
        matchedSiteName: nameMatch.site_name,
        matchedPlatform: nameMatch.platform_code,
      });
      continue;
    }

    inserts.push(mapped);
  }

  return { inserts, updates, duplicates };
}

module.exports = {
  BRAND_CODE,
  CAPACITY_SANITY_KWP,
  FILL_IF_EMPTY_FIELDS,
  PLATFORM_CODE,
  REFRESH_FIELDS,
  buildUpdate,
  mapStation,
  normalizeSiteName,
  planSync,
  toCapacityKwp,
  toDateString,
  toStatus,
};

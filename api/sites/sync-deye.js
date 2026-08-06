// POST /api/sites/sync-deye
//
// Pulls the station list from Deye Cloud and brings anything we do not already
// have into hi_solar_sites. Stations that already exist under another platform
// (the Deye plants imported from Solarman) are reported, not re-imported.
//
// Body:
//   { "dryRun": true }   plan only, touches nothing — what the refresh button
//                        calls first so a person can see the effect and confirm
//   { "dryRun": false }  apply the plan
//
// Auth: an approved hisolar session with role admin or member, matching the
// "Authenticated write sites hisolar admin member" RLS policy. The writes
// themselves go through the service role, so this check is the real gate.

const { getAuthenticatedSessionContext } = require('../_lib/auth-context');
const { listAllStations } = require('../_lib/deye-cloud');
const { PLATFORM_CODE, planSync } = require('../_lib/deye-site-mapping');
const { createHttpError, methodNotAllowed, sendError, writeJson } = require('../_lib/http');
const { insertSites, listSitesForSync, updateSite } = require('../_lib/supabase-admin');

const WRITE_ROLES = new Set(['admin', 'member']);

function readBody(req) {
  const body = req.body;
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch (_error) {
      throw createHttpError(400, 'Request body is not valid JSON');
    }
  }
  return body;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST']);
  }

  try {
    const context = await getAuthenticatedSessionContext(req, 'hisolar');
    if (!WRITE_ROLES.has(String(context.membership.role))) {
      throw createHttpError(403, 'Only a Hi Solar admin or member can sync the site registry');
    }

    const { dryRun = true } = readBody(req);
    const syncedAt = new Date().toISOString();

    const [{ stations, total, companyId, companyName }, existingSites] = await Promise.all([
      listAllStations(),
      listSitesForSync('hisolar'),
    ]);

    const plan = planSync(stations, existingSites, { syncedAt });

    const summary = {
      dryRun: Boolean(dryRun),
      platformCode: PLATFORM_CODE,
      stationsFetched: stations.length,
      stationsReported: total,
      registrySize: existingSites.length,
      // Named so 0 stations reads as "wrong organisation" rather than
      // "the account is empty" — the two look identical otherwise.
      companyId: companyId || null,
      companyName: companyName || null,
      counts: {
        toInsert: plan.inserts.length,
        toUpdate: plan.updates.length,
        duplicates: plan.duplicates.length,
      },
      // The names are what makes the confirmation step worth anything.
      newSites: plan.inserts.map(row => ({
        stationId: row.platform_plant_id,
        siteName: row.site_name,
        capacityKwp: row.capacity_kwp,
        status: row.status,
      })),
      duplicates: plan.duplicates,
      syncedAt,
    };

    if (dryRun) {
      return writeJson(res, 200, summary);
    }

    const inserted = await insertSites(plan.inserts);

    // Updates go one row at a time rather than as an upsert batch: an upsert
    // would need every column of every row, which risks writing a null over a
    // field somebody filled in by hand. The registry is small enough that the
    // extra round trips stay well inside the 60s function budget.
    let updated = 0;
    for (const item of plan.updates) {
      if (!Object.keys(item.patch).length) continue;
      await updateSite(item.id, item.patch);
      updated += 1;
    }

    return writeJson(res, 200, {
      ...summary,
      dryRun: false,
      applied: {
        inserted: inserted.length,
        updated,
        insertedSites: inserted.map(row => ({
          siteCode: row.site_code,
          siteName: row.site_name,
          stationId: row.platform_plant_id,
        })),
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
};

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PLATFORM_CODE,
  buildUpdate,
  mapStation,
  normalizeSiteName,
  planSync,
  toCapacityKwp,
  toDateString,
  toStatus,
} = require('../api/_lib/deye-site-mapping');

// A station shaped like /v1.0/station/list actually returns one.
function station(overrides = {}) {
  return {
    id: 61025545,
    name: 'JL FARM 5',
    locationLat: 18.7061,
    locationLng: 98.9817,
    locationAddress: '98/1 ม.3 ต.ประตูป่า',
    regionNationId: 764,
    regionTimezone: 'Asia/Bangkok',
    gridInterconnectionType: 'DISTRIBUTED_FULLY',
    installedCapacity: 6.51,
    startOperatingTime: 1705593600,
    createdDate: 1705304227.0,
    batterySOC: 0.0,
    connectionStatus: 'NORMAL',
    generationPower: 0.0,
    lastUpdateTime: 1711108284,
    contactPhone: '',
    ownerName: null,
    ...overrides,
  };
}

function site(overrides = {}) {
  return {
    id: 'uuid-1',
    site_code: 'HS-0163',
    site_name: 'JL FARM 5',
    platform_code: 'SOLARMAN',
    platform_plant_id: '3030254',
    customer_name: null,
    phone: null,
    address: null,
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

test('site names are compared with whitespace collapsed', () => {
  // The exact shape that cost us 9 unmatched names in the FusionSolar import.
  assert.equal(normalizeSiteName('Mother Heart  Cafe'), normalizeSiteName('Mother Heart Cafe'));
  assert.equal(normalizeSiteName('  JL FARM 5 '), 'jl farm 5');
  assert.equal(normalizeSiteName('JL\tFARM\n5'), 'jl farm 5');
  assert.equal(normalizeSiteName(null), '');
});

test('capacity typed in watts is scaled back to kWp', () => {
  assert.equal(toCapacityKwp(6.51), 6.51);
  assert.equal(toCapacityKwp(13750), 13.75);
  assert.equal(toCapacityKwp(0), null);
  assert.equal(toCapacityKwp('not a number'), null);
});

test('connection status maps onto the labels the registry UI colours', () => {
  assert.equal(toStatus('NORMAL'), 'Online');
  assert.equal(toStatus('OFFLINE'), 'Offline');
  assert.equal(toStatus('ALARM'), 'Fault');
  assert.equal(toStatus(''), null);
});

test('operating date uses the station timezone, not UTC', () => {
  // Deye records local midnight, which for a Thai plant is 17:00 UTC the day
  // before — formatting that in UTC would date every site a day early.
  const localMidnightBangkok = 1705597200; // 2024-01-18 17:00 UTC
  assert.equal(toDateString(localMidnightBangkok, 'Asia/Bangkok'), '2024-01-19');
  assert.equal(toDateString(localMidnightBangkok, 'UTC'), '2024-01-18');
  // An IANA zone Node does not know must not take the whole sync down.
  assert.equal(toDateString(localMidnightBangkok, 'Not/AZone'), '2024-01-18');
  assert.equal(toDateString(null, 'Asia/Bangkok'), null);
});

test('a station maps onto the registry columns', () => {
  const row = mapStation(station({ ownerName: 'คุณสมชาย', contactPhone: '0812345678' }));
  assert.equal(row.platform_code, PLATFORM_CODE);
  assert.equal(row.brand_code, 'DEYE');
  assert.equal(row.platform_plant_id, '61025545');
  assert.equal(row.site_name, 'JL FARM 5');
  assert.equal(row.customer_name, 'คุณสมชาย');
  assert.equal(row.phone, '0812345678');
  assert.equal(row.capacity_kwp, 6.51);
  assert.equal(row.status, 'Online');
  assert.equal(row.organization, 'hisolar');
  // The whole station is kept so a later column can be backfilled without
  // another round trip to Deye.
  assert.equal(row.raw_data.generationPower, 0);
});

test('an empty contactPhone becomes null rather than an empty string', () => {
  const row = mapStation(station());
  assert.equal(row.phone, null);
  assert.equal(row.customer_name, null);
});

test('a plant already held under Solarman is reported, not imported again', () => {
  const plan = planSync([station()], [site({ site_name: 'JL  FARM  5' })]);

  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.duplicates.length, 1);
  assert.deepEqual(plan.duplicates[0], {
    stationId: '61025545',
    stationName: 'JL FARM 5',
    matchedSiteCode: 'HS-0163',
    matchedSiteName: 'JL  FARM  5',
    matchedPlatform: 'SOLARMAN',
  });
});

test('a station we have never seen is queued for insert', () => {
  const plan = planSync([station({ id: 999, name: 'บ้านสวนใหม่' })], [site()]);

  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.duplicates.length, 0);
  assert.equal(plan.inserts[0].site_name, 'บ้านสวนใหม่');
  assert.equal(plan.inserts[0].platform_plant_id, '999');
  // site_code is the trigger's job, not ours.
  assert.equal(plan.inserts[0].site_code, undefined);
});

test('re-running the sync updates the DEYECLOUD row instead of duplicating it', () => {
  const existing = site({
    site_code: 'HS-0272',
    platform_code: PLATFORM_CODE,
    platform_plant_id: '61025545',
  });
  const plan = planSync([station({ connectionStatus: 'OFFLINE' })], [existing]);

  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.duplicates.length, 0);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].patch.status, 'Offline');
});

test('a sync never overwrites coordinates or contact details entered by hand', () => {
  const existing = site({
    platform_code: PLATFORM_CODE,
    platform_plant_id: '61025545',
    // pinned on the roof via map.html, and better than the vendor's guess
    latitude: 18.5,
    longitude: 98.5,
    phone: '0899999999',
    address: 'ที่อยู่ที่ออฟฟิศแก้เอง',
  });
  const patch = buildUpdate(mapStation(station({ contactPhone: '0812345678' })), existing);

  assert.equal(patch.latitude, undefined);
  assert.equal(patch.longitude, undefined);
  assert.equal(patch.phone, undefined);
  assert.equal(patch.address, undefined);
  // platform-owned fields are still refreshed
  assert.equal(patch.status, 'Online');
  assert.equal(patch.capacity_kwp, 6.51);
});

test('an empty field on an existing site does get filled in', () => {
  const existing = site({
    platform_code: PLATFORM_CODE,
    platform_plant_id: '61025545',
    phone: '',
    latitude: null,
  });
  const patch = buildUpdate(mapStation(station({ contactPhone: '0812345678' })), existing);

  assert.equal(patch.phone, '0812345678');
  assert.equal(patch.latitude, 18.7061);
});

test('the same station returned on two pages is only inserted once', () => {
  const plan = planSync([station({ id: 777 }), station({ id: 777 })], []);
  assert.equal(plan.inserts.length, 1);
});

test('a station with no id is skipped rather than inserted with a null key', () => {
  const plan = planSync([{ name: 'ไม่มี id' }, station({ id: 5 })], []);
  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.inserts[0].platform_plant_id, '5');
});

// ============================================================
//  Hi Solar — Google Apps Script (Web App API)
//  วางโค้ดนี้ใน Google Apps Script แล้ว Deploy เป็น Web App
//  Execute as: Me | Who has access: Anyone
// ============================================================

// ชื่อ Sheet ที่ต้องมีใน Spreadsheet
var SHEET_MAP = {
  'duNgan'   : 'ดูงาน',
  'ngan'     : 'งาน',
  'langPaeng': 'ล้างแผง',
  'som'      : 'ซ่อม',
  'bil'      : 'บิล'
};

var DATE_HEADERS = ['วันที่', 'วันที่สร้าง', 'วันที่นัด', 'วันที่ส่ง', 'วันที่รับ'];
var TEXT_HEADERS = ['เบอร์โทร'];

function isDateHeader(header) {
  return DATE_HEADERS.indexOf(header) !== -1;
}

function isTextHeader(header) {
  return TEXT_HEADERS.indexOf(header) !== -1;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function normalizeDateString(value) {
  var s = String(value || '').trim().replace(/^'/, '');
  if (!s) return '';

  var iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return pad2(iso[3]) + '/' + pad2(iso[2]) + '/' + iso[1];

  var th = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (th) return pad2(th[1]) + '/' + pad2(th[2]) + '/' + th[3];

  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    var d = new Date(s);
    if (!isNaN(d)) return Utilities.formatDate(d, 'Asia/Bangkok', 'dd/MM/yyyy');
  }

  return s;
}

function normalizeTimeString(value) {
  var s = String(value || '').trim().replace(/^'/, '');
  if (!s) return '';

  var time = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (time) return pad2(time[1]) + ':' + time[2];

  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    var d = new Date(s);
    if (!isNaN(d)) return Utilities.formatDate(d, 'Asia/Bangkok', 'HH:mm');
  }

  return s;
}

function normalizePhoneString(value) {
  var s = String(value || '').trim().replace(/^'/, '');
  if (!s) return '';

  if (/^\d+(\.0+)?$/.test(s)) {
    s = s.replace(/\.0+$/, '');
  }
  if (/^\d{8,9}$/.test(s) && s.charAt(0) !== '0') {
    s = '0' + s;
  }
  return s;
}

function formatCellValue(header, value) {
  if (value instanceof Date) {
    if (header === 'เวลา') {
      return Utilities.formatDate(value, 'Asia/Bangkok', 'HH:mm');
    }
    if (isDateHeader(header)) {
      return Utilities.formatDate(value, 'Asia/Bangkok', 'dd/MM/yyyy');
    }
  }

  if (header === 'เวลา') return normalizeTimeString(value);
  if (header === 'เบอร์โทร') return normalizePhoneString(value);
  if (isDateHeader(header)) return normalizeDateString(value);
  return value;
}

function normalizeInputValue(header, value) {
  if (header === 'เวลา') return normalizeTimeString(value);
  if (header === 'เบอร์โทร') return normalizePhoneString(value);
  if (isDateHeader(header)) return normalizeDateString(value);
  return value || '';
}

function forceTextValue(header, value) {
  var v = normalizeInputValue(header, value);
  if (!v) return '';
  return (header === 'เวลา' || isDateHeader(header) || isTextHeader(header)) ? "'" + v : v;
}

// ----------------------------------------------------------
//  GET Handler — รองรับ getData, updateStatus, updateFields, addRow, addComment
// ----------------------------------------------------------
function doGet(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    var action = params.action || 'getData';

    if (action === 'getData') {
      return respond(getAllData());
    }
    if (action === 'updateStatus') {
      return respond(updateStatus(params));
    }
    if (action === 'updateFields') {
      return respond(updateFields(params));
    }
    if (action === 'addRow') {
      return respond(addRow(params));
    }
    if (action === 'addComment') {
      return respond(addComment(params));
    }
    return respond({ error: 'Unknown action' });
  } catch (err) {
    return respond({ error: err.message });
  }
}

// ----------------------------------------------------------
//  ดึงข้อมูลทุก Sheet
// ----------------------------------------------------------
function getAllData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var result = {};

  for (var key in SHEET_MAP) {
    var sheet = ss.getSheetByName(SHEET_MAP[key]);
    if (!sheet) { result[key] = []; continue; }

    var data   = sheet.getDataRange().getValues();
    var headers = data[0];
    var rows   = [];

    for (var i = 1; i < data.length; i++) {
      if (!data[i][0] && !data[i][1]) continue; // ข้ามแถวว่าง
      var row = { _row: i + 1 };
      for (var j = 0; j < headers.length; j++) {
        var val = data[i][j];
        row[headers[j]] = formatCellValue(headers[j], val);
      }
      rows.push(row);
    }
    result[key] = rows;
  }
  return result;
}

// ----------------------------------------------------------
//  อัปเดตสถานะ
//  params: sheet, row, status, updatedBy
// ----------------------------------------------------------
function updateStatus(params) {
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = SHEET_MAP[params.sheet];
  if (!sheetName) return { success: false, error: 'ไม่พบหมวด: ' + params.sheet };

  var sheet   = ss.getSheetByName(sheetName);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var statusCol = headers.indexOf('สถานะ') + 1;
  if (statusCol === 0) return { success: false, error: 'ไม่พบ column สถานะ' };

  var rowNum  = parseInt(params.row);
  sheet.getRange(rowNum, statusCol).setValue(params.status);

  // Log การเปลี่ยนแปลง
  writeLog(params.sheet, rowNum, params.status, params.updatedBy || 'ไม่ระบุ');

  return { success: true };
}

// ----------------------------------------------------------
//  อัปเดตหลาย field ในแถวเดิม
//  params: sheet, row, data(JSON string), updatedBy
// ----------------------------------------------------------
function updateFields(params) {
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = SHEET_MAP[params.sheet];
  if (!sheetName) return { success: false, error: 'ไม่พบหมวด: ' + params.sheet };

  var sheet   = ss.getSheetByName(sheetName);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var rowNum  = parseInt(params.row, 10);
  if (!rowNum || rowNum < 2 || rowNum > sheet.getLastRow()) {
    return { success: false, error: 'แถวไม่ถูกต้อง' };
  }

  var data = JSON.parse(params.data || '{}');
  var updated = [];
  Object.keys(data).forEach(function(h) {
    var col = headers.indexOf(h) + 1;
    if (col === 0) return;
    sheet.getRange(rowNum, col).setNumberFormat((h === 'เวลา' || isDateHeader(h) || isTextHeader(h)) ? '@' : 'General');
    sheet.getRange(rowNum, col).setValue(forceTextValue(h, data[h]));
    updated.push(h);
  });

  if (!updated.length) return { success: false, error: 'ไม่มี field ที่อัปเดต' };
  writeLog(params.sheet, rowNum, 'แก้ไข ' + updated.join(', '), params.updatedBy || 'ไม่ระบุ');

  return { success: true, updated: updated };
}

// ----------------------------------------------------------
//  เพิ่มแถวใหม่
//  params: sheet + field values (JSON string ใน params.data)
// ----------------------------------------------------------
function addRow(params) {
  var ss        = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = SHEET_MAP[params.sheet];
  if (!sheetName) return { success: false, error: 'ไม่พบหมวด: ' + params.sheet };

  var sheet   = ss.getSheetByName(sheetName);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var rowData = JSON.parse(params.data);

  // Auto ID
  var lastRow = sheet.getLastRow();
  var newId   = lastRow; // แถวสุดท้าย = ID ใหม่ (แถวที่ 1 คือ header)

  var newRow  = headers.map(function(h) {
    if (h === 'ID')         return newId;
    if (h === 'วันที่สร้าง') return "'" + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'dd/MM/yyyy');
    return forceTextValue(h, rowData[h]);
  });

  var targetRow = sheet.getLastRow() + 1;
  var targetRange = sheet.getRange(targetRow, 1, 1, headers.length);
  targetRange.setNumberFormats([headers.map(function(h) {
    return (h === 'เวลา' || isDateHeader(h) || isTextHeader(h)) ? '@' : 'General';
  })]);
  targetRange.setValues([newRow]);
  writeLog(params.sheet, targetRow, 'เพิ่มงานใหม่', params.updatedBy || 'ไม่ระบุ');

  return { success: true, id: newId };
}

// ----------------------------------------------------------
//  เพิ่ม comment ต่อท้ายคอลัมน์หมายเหตุ
//  params: sheet, row, comment, updatedBy
// ----------------------------------------------------------
function addComment(params) {
  var ss        = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = SHEET_MAP[params.sheet];
  if (!sheetName) return { success: false, error: 'ไม่พบหมวด: ' + params.sheet };

  var sheet   = ss.getSheetByName(sheetName);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var noteCol = headers.indexOf('หมายเหตุ') + 1;
  if (noteCol === 0) {
    noteCol = headers.length + 1;
    sheet.getRange(1, noteCol).setValue('หมายเหตุ');
  }

  var rowNum = parseInt(params.row, 10);
  if (!rowNum || rowNum < 2 || rowNum > sheet.getLastRow()) {
    return { success: false, error: 'แถวไม่ถูกต้อง' };
  }

  var comment = String(params.comment || '').replace(/\r?\n/g, ' ').trim();
  if (!comment) return { success: false, error: 'comment ว่าง' };

  var updatedBy = params.updatedBy || 'ไม่ระบุ';
  var now = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'dd/MM/yyyy HH:mm');
  var entry = '[' + now + '] ' + updatedBy + ': ' + comment;
  var oldNote = String(sheet.getRange(rowNum, noteCol).getValue() || '').trim();
  var nextNote = oldNote ? oldNote + '\n' + entry : entry;

  sheet.getRange(rowNum, noteCol).setValue(nextNote);
  writeLog(params.sheet, rowNum, 'เพิ่ม comment', updatedBy);

  return { success: true, comment: entry, note: nextNote };
}

// ----------------------------------------------------------
//  บันทึก Log
// ----------------------------------------------------------
function writeLog(sheet, row, status, updatedBy) {
  var ss       = SpreadsheetApp.getActiveSpreadsheet();
  var logSheet = ss.getSheetByName('Log');
  if (!logSheet) {
    logSheet = ss.insertSheet('Log');
    logSheet.appendRow(['วันที่-เวลา', 'หมวด', 'แถว', 'สถานะใหม่', 'อัปเดตโดย']);
  }
  logSheet.appendRow([
    Utilities.formatDate(new Date(), 'Asia/Bangkok', 'dd/MM/yyyy HH:mm:ss'),
    sheet, row, status, updatedBy
  ]);
}

// ----------------------------------------------------------
//  Supabase Bulk Sync
//  ตั้งค่า Script Properties:
//  SUPABASE_URL = https://xxxx.supabase.co
//  SUPABASE_SERVICE_ROLE_KEY = service_role key
// ----------------------------------------------------------
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Hi Solar')
    .addItem('Sync ทั้งหมดเข้า Supabase', 'syncAllSheetsToSupabase')
    .addSeparator()
    .addItem('ตั้งค่า Supabase', 'setupSupabase')
    .addToUi();
}

function setupSupabase() {
  var ui = SpreadsheetApp.getUi();
  var urlResult = ui.prompt(
    'ตั้งค่า Supabase',
    'ใส่ SUPABASE_URL เช่น https://xxxx.supabase.co',
    ui.ButtonSet.OK_CANCEL
  );
  if (urlResult.getSelectedButton() !== ui.Button.OK) return;

  var keyResult = ui.prompt(
    'ตั้งค่า Supabase',
    'ใส่ SUPABASE_SERVICE_ROLE_KEY เก็บไว้ใน Script Properties เท่านั้น',
    ui.ButtonSet.OK_CANCEL
  );
  if (keyResult.getSelectedButton() !== ui.Button.OK) return;

  PropertiesService.getScriptProperties().setProperties({
    SUPABASE_URL: String(urlResult.getResponseText() || '').trim().replace(/\/+$/, ''),
    SUPABASE_SERVICE_ROLE_KEY: String(keyResult.getResponseText() || '').trim()
  });

  ui.alert('บันทึกค่า Supabase แล้ว');
}

function syncAllSheetsToSupabase() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    SpreadsheetApp.getUi().alert('มี sync อื่นกำลังทำงานอยู่ กรุณาลองใหม่อีกครั้ง');
    return;
  }

  var summary = [];
  var total = 0;
  try {
    for (var key in SHEET_MAP) {
      var count = syncSheetToSupabase_(key);
      total += count;
      summary.push(SHEET_MAP[key] + ': ' + count + ' รายการ');
    }
    writeSupabaseSyncLog_(total, summary.join(' | '), 'สำเร็จ');
    SpreadsheetApp.getActiveSpreadsheet().toast('Sync เข้า Supabase แล้ว ' + total + ' รายการ', 'Hi Solar', 8);
    SpreadsheetApp.getUi().alert('Sync เข้า Supabase แล้ว\n\n' + summary.join('\n'));
  } catch (err) {
    writeSupabaseSyncLog_(total, err.message, 'ไม่สำเร็จ');
    SpreadsheetApp.getUi().alert('Sync ไม่สำเร็จ\n\n' + err.message);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function syncSheetToSupabase_(sheetKey) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = SHEET_MAP[sheetKey];
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return 0;

  var values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return 0;

  var headers = values[0].map(function(h) { return String(h || '').trim(); });
  var jobs = [];
  for (var i = 1; i < values.length; i++) {
    if (isBlankSheetRow_(values[i])) continue;
    jobs.push(buildSupabaseJob_(sheetKey, sheetName, i + 1, headers, values[i]));
  }
  if (!jobs.length) return 0;

  var returnedJobs = [];
  chunk_(jobs, 100).forEach(function(batch) {
    var rows = supabaseRequest_(
      '/rest/v1/hi_solar_jobs?on_conflict=sheet_key,sheet_row&select=id,sheet_key,sheet_row,note',
      'post',
      batch,
      'resolution=merge-duplicates,return=representation'
    );
    returnedJobs = returnedJobs.concat(rows || []);
  });

  syncSheetCommentsToSupabase_(returnedJobs);
  return jobs.length;
}

function buildSupabaseJob_(sheetKey, sheetName, sheetRow, headers, row) {
  var raw = {};
  headers.forEach(function(h, idx) {
    if (h) raw[h] = row[idx];
  });

  var customer = pickRaw_(raw, ['ลูกค้า']);
  var title = pickRaw_(raw, ['รายการ']) || customer;
  var note = pickRaw_(raw, ['หมายเหตุ']);
  var status = pickRaw_(raw, ['สถานะ']) || defaultStatusForSheet_(sheetKey);

  return {
    sheet_key: sheetKey,
    sheet_name: sheetName,
    sheet_row: sheetRow,
    customer_name: customer,
    title: title,
    detail: pickRaw_(raw, ['รายละเอียด']),
    phone: normalizePhoneString(pickRaw_(raw, ['เบอร์โทร'])),
    job_date: toSupabaseDate_(pickRaw_(raw, ['วันที่'])),
    job_time: toSupabaseTime_(pickRaw_(raw, ['เวลา'])),
    created_date: toSupabaseDate_(pickRaw_(raw, ['วันที่สร้าง'])),
    appointment_date: toSupabaseDate_(pickRaw_(raw, ['วันที่นัด'])),
    sent_date: toSupabaseDate_(pickRaw_(raw, ['วันที่ส่ง'])),
    received_date: toSupabaseDate_(pickRaw_(raw, ['วันที่รับ'])),
    technician: pickRaw_(raw, ['ช่าง']),
    job_type: pickRaw_(raw, ['ประเภท']),
    price: toSupabaseNumber_(pickRaw_(raw, ['ราคา'])),
    amount: toSupabaseNumber_(pickRaw_(raw, ['ยอด'])),
    maps_url: pickRaw_(raw, ['Maps', 'Maps Link']),
    status: status,
    note: note,
    raw_data: raw,
    synced_at: new Date().toISOString()
  };
}

function syncSheetCommentsToSupabase_(jobs) {
  var comments = [];
  (jobs || []).forEach(function(job) {
    parseSheetComments_(job.note, job.sheet_key, job.sheet_row).forEach(function(comment) {
      comments.push({
        job_id: job.id,
        author: comment.author,
        message: comment.message,
        source: 'google_sheet',
        source_key: comment.sourceKey,
        commented_at: comment.createdAt,
        created_at: comment.createdAt
      });
    });
  });

  if (!comments.length) return;
  chunk_(comments, 100).forEach(function(batch) {
    supabaseRequest_(
      '/rest/v1/hi_solar_job_comments?on_conflict=source,source_key',
      'post',
      batch,
      'resolution=merge-duplicates,return=minimal'
    );
  });
}

function parseSheetComments_(note, sheetKey, sheetRow) {
  var text = String(note || '').trim();
  if (!text) return [];

  return text.split(/\r?\n/).map(function(line) {
    var s = String(line || '').trim();
    if (!s) return null;

    var m = s.match(/^\[(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2})\]\s*([^:]+):\s*(.+)$/);
    var author = 'บันทึกเดิม';
    var message = s;
    var createdAt = new Date().toISOString();

    if (m) {
      author = m[3].trim() || author;
      message = m[4].trim();
      createdAt = thaiDateTimeToIso_(m[1], m[2]) || createdAt;
    }

    return {
      author: author,
      message: message,
      createdAt: createdAt,
      sourceKey: sha256Hex_([sheetKey, sheetRow, s].join('|'))
    };
  }).filter(Boolean);
}

function getSupabaseConfig_() {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty('SUPABASE_URL') || '').trim().replace(/\/+$/, '');
  var key = String(props.getProperty('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  if (!url || !key) {
    throw new Error('ยังไม่ได้ตั้งค่า SUPABASE_URL หรือ SUPABASE_SERVICE_ROLE_KEY ใน Script Properties');
  }
  return { url: url, key: key };
}

function supabaseRequest_(path, method, payload, prefer) {
  var cfg = getSupabaseConfig_();
  var headers = {
    apikey: cfg.key,
    Authorization: 'Bearer ' + cfg.key,
    Accept: 'application/json'
  };
  if (prefer) headers.Prefer = prefer;

  var options = {
    method: method,
    headers: headers,
    contentType: 'application/json',
    muteHttpExceptions: true
  };
  if (payload !== undefined && payload !== null) {
    options.payload = JSON.stringify(payload);
  }

  var res = UrlFetchApp.fetch(cfg.url + path, options);
  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Supabase HTTP ' + code + ': ' + body);
  }
  return body ? JSON.parse(body) : null;
}

function pickRaw_(raw, names) {
  for (var i = 0; i < names.length; i++) {
    var v = raw[names[i]];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function toSupabaseDate_(value) {
  var s = normalizeDateString(value);
  var m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return m[3] + '-' + pad2(m[2]) + '-' + pad2(m[1]);
}

function toSupabaseTime_(value) {
  var s = normalizeTimeString(value);
  var m = String(s || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return pad2(m[1]) + ':' + m[2] + ':00';
}

function toSupabaseNumber_(value) {
  var s = String(value || '').replace(/,/g, '').trim();
  if (!s) return null;
  var n = Number(s);
  return isNaN(n) ? null : n;
}

function thaiDateTimeToIso_(dateText, timeText) {
  var d = toSupabaseDate_(dateText);
  var t = toSupabaseTime_(timeText);
  return d && t ? d + 'T' + t + '+07:00' : null;
}

function defaultStatusForSheet_(sheetKey) {
  var map = {
    ngan: 'Waiting',
    duNgan: 'รอดูงาน',
    langPaeng: 'รอนัด',
    som: 'รอส่ง',
    bil: 'รอออกบิล'
  };
  return map[sheetKey] || '';
}

function isBlankSheetRow_(row) {
  return row.every(function(v) { return String(v || '').trim() === ''; });
}

function chunk_(items, size) {
  var out = [];
  for (var i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function sha256Hex_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function(b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function writeSupabaseSyncLog_(count, message, status) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Supabase Sync Log');
  if (!sheet) {
    sheet = ss.insertSheet('Supabase Sync Log');
    sheet.appendRow(['วันที่-เวลา', 'สถานะ', 'จำนวน', 'รายละเอียด']);
  }
  sheet.appendRow([
    Utilities.formatDate(new Date(), 'Asia/Bangkok', 'dd/MM/yyyy HH:mm:ss'),
    status,
    count,
    message
  ]);
}

// ----------------------------------------------------------
//  Helper: Return JSON with CORS headers
// ----------------------------------------------------------
function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

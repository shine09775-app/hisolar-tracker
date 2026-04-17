(function () {
  const WORKBOOK_SHEET_MAP = Object.freeze({
    ngan: 'งาน',
    duNgan: 'ดูงาน',
    langPaeng: 'ล้างแผง',
    som: 'ซ่อม',
    bil: 'บิล',
  });

  const DEFAULT_SHEET_NAMES = Object.freeze({
    ngan: 'งาน',
    duNgan: 'ดูงาน',
    langPaeng: 'ล้างแผง',
    som: 'ซ่อม',
    bil: 'บิล VAT',
  });

  const SHEET_LABELS = Object.freeze({
    ...WORKBOOK_SHEET_MAP,
    permit: 'ขออนุญาต',
  });

  const PERMIT_SHEET_NAME = 'ขออนุญาต';
  const PERMIT_PHASES = ['PRECHECK', 'DOCS', 'SUBMITTED', 'COMMENT', 'CONTRACT', 'INSTALLED', 'INSPECTION', 'APPROVED', 'CLOSED'];
  const PERMIT_STATUSES = ['WAITING', 'IN_PROGRESS', 'NEED_FIX', 'DONE', 'REJECTED'];
  const PERMIT_CHECKLIST_KEYS = ['id_card', 'house_registration', 'electricity_bill', 'authorization_letter', 'sld', 'inverter_datasheet', 'layout', 'meter_photo', 'mdb_photo'];
  const DATE_HEADERS = new Set([
    'วันที่', 'วันที่สร้าง', 'วันที่นัด', 'วันที่ส่ง', 'วันที่รับ',
    'submit_date', 'comment_date', 'resubmit_date', 'contract_date', 'install_date',
    'photo_upload_date', 'inspection_date', 'meter_change_date', 'parallel_date', 'next_action_date',
  ]);
  const UPLOAD_COMMENT_SOURCE = 'xlsx_upload';

  const PERMIT_FIELD_ALIASES = Object.freeze({
    customer_name: ['customer_name', 'customer', 'customer name', 'ชื่อลูกค้า', 'ลูกค้า'],
    phone: ['phone', 'phone_no', 'โทรศัพท์', 'เบอร์โทร', 'เบอร์ติดต่อ'],
    site_name: ['site_name', 'site', 'site name', 'ชื่อสถานที่', 'ไซต์งาน'],
    site_address: ['site_address', 'address', 'site address', 'ที่อยู่', 'ที่อยู่ติดตั้ง'],
    utility_provider: ['utility_provider', 'utility', 'provider', 'การไฟฟ้า'],
    permit_type: ['permit_type', 'permit type', 'ประเภทขออนุญาต'],
    project_type: ['project_type', 'project type', 'ประเภทโครงการ'],
    meter_phase: ['meter_phase', 'meter phase', 'เฟสมิเตอร์'],
    meter_no: ['meter_no', 'meter no', 'meter number', 'เลขมิเตอร์'],
    ca_no: ['ca_no', 'ca no', 'ca number', 'เลข ca', 'ca'],
    pv_kwp: ['pv_kwp', 'pv kwp', 'kwp', 'กำลังติดตั้ง', 'pv'],
    inverter_brand: ['inverter_brand', 'inverter brand', 'ยี่ห้ออินเวอร์เตอร์'],
    inverter_model: ['inverter_model', 'inverter model', 'รุ่นอินเวอร์เตอร์'],
    inverter_kw: ['inverter_kw', 'inverter kw', 'กำลังอินเวอร์เตอร์'],
    export_mode: ['export_mode', 'export mode', 'โหมดส่งออก'],
    workflow_key: ['workflow_key', 'workflow', 'template', 'workflow template'],
    phase: ['phase', 'current_phase', 'ขั้นตอน'],
    status: ['status', 'state', 'สถานะ'],
    application_no: ['application_no', 'application no', 'เลขคำขอ'],
    submit_date: ['submit_date', 'วันที่ยื่น'],
    comment_date: ['comment_date', 'วันที่ comment'],
    resubmit_date: ['resubmit_date', 'วันที่ยื่นแก้ไข'],
    contract_date: ['contract_date', 'วันที่ทำสัญญา'],
    install_date: ['install_date', 'วันที่ติดตั้ง'],
    photo_upload_date: ['photo_upload_date', 'วันที่อัปโหลดรูป'],
    inspection_date: ['inspection_date', 'วันที่ตรวจ'],
    meter_change_date: ['meter_change_date', 'วันที่เปลี่ยนมิเตอร์'],
    parallel_date: ['parallel_date', 'วันที่ขนานไฟ'],
    assigned_to: ['assigned_to', 'assigned', 'ผู้รับผิดชอบ'],
    priority: ['priority', 'ความสำคัญ'],
    next_action_date: ['next_action_date', 'วันที่ติดตาม', 'วันติดตามถัดไป'],
    aging_days: ['aging_days', 'aging', 'days', 'จำนวนวันค้าง'],
    owner_docs_complete: ['owner_docs_complete', 'owner docs complete', 'เอกสารเจ้าของครบ'],
    design_docs_complete: ['design_docs_complete', 'design docs complete', 'เอกสารออกแบบครบ'],
    installation_docs_complete: ['installation_docs_complete', 'installation docs complete', 'เอกสารติดตั้งครบ'],
    payment_status: ['payment_status', 'payment', 'สถานะชำระเงิน'],
    remark: ['remark', 'หมายเหตุ', 'note'],
    id_card: ['id_card', 'สำเนาบัตรประชาชน'],
    house_registration: ['house_registration', 'ทะเบียนบ้าน'],
    electricity_bill: ['electricity_bill', 'บิลไฟ'],
    authorization_letter: ['authorization_letter', 'หนังสือมอบอำนาจ'],
    sld: ['sld'],
    inverter_datasheet: ['inverter_datasheet', 'datasheet'],
    layout: ['layout', 'แบบ layout'],
    meter_photo: ['meter_photo', 'รูปมิเตอร์'],
    mdb_photo: ['mdb_photo', 'รูป mdb'],
  });

  function getUploadInput() {
    return document.getElementById('xlsxUploadInput');
  }

  function getUploadButton() {
    return document.getElementById('xlsxUploadTrigger');
  }

  function getUploadStatus() {
    return document.getElementById('xlsxUploadStatus');
  }

  function setUploadStatus(message, tone) {
    const el = getUploadStatus();
    if (!el) return;
    el.textContent = message;
    if (tone) el.dataset.tone = tone;
    else delete el.dataset.tone;
  }

  function setUploadBusy(isBusy) {
    const btn = getUploadButton();
    if (!btn) return;
    if (!btn.dataset.defaultLabel) btn.dataset.defaultLabel = btn.innerHTML;
    btn.disabled = isBusy;
    btn.innerHTML = isBusy
      ? '<span class="spinner-border spinner-border-sm me-1"></span>กำลังอัปโหลด'
      : btn.dataset.defaultLabel;
  }

  function chunkArray(items, size) {
    const output = [];
    for (let i = 0; i < items.length; i += size) {
      output.push(items.slice(i, i + size));
    }
    return output;
  }

  function isBlankRow(row) {
    return (row || []).every(value => String(value ?? '').trim() === '');
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function cleanCellString(value) {
    return String(value ?? '').replace(/\r\n/g, '\n').trim();
  }

  function normalizeHeader(value) {
    return cleanCellString(value).toLowerCase().replace(/\s+/g, '_');
  }

  function normalizePhoneString(value) {
    const raw = cleanCellString(value);
    if (!raw) return '';
    if (/^[\d.]+e\+\d+$/i.test(raw)) {
      const numeric = Number(raw);
      if (Number.isFinite(numeric)) {
        const digits = Math.round(numeric).toString();
        return digits.length === 9 ? `0${digits}` : digits;
      }
    }
    if (/^\d+(\.0+)?$/.test(raw)) {
      const digits = raw.replace(/\.0+$/, '');
      return digits.length === 9 ? `0${digits}` : digits;
    }
    return raw;
  }

  function normalizeDateString(value) {
    const raw = cleanCellString(value);
    if (!raw) return '';

    let match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) return `${pad2(match[1])}/${pad2(match[2])}/${match[3]}`;

    match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (match) return `${pad2(match[3])}/${pad2(match[2])}/${match[1]}`;

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return `${pad2(parsed.getDate())}/${pad2(parsed.getMonth() + 1)}/${parsed.getFullYear()}`;
    }
    return raw;
  }

  function normalizeTimeString(value) {
    const raw = cleanCellString(value);
    if (!raw) return '';

    let match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
    if (match) {
      let hour = Number(match[1]);
      const minute = match[2];
      const meridiem = match[3].toUpperCase();
      if (meridiem === 'PM' && hour < 12) hour += 12;
      if (meridiem === 'AM' && hour === 12) hour = 0;
      return `${pad2(hour)}:${minute}`;
    }

    match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (match) return `${pad2(match[1])}:${match[2]}`;

    return raw;
  }

  function normalizeWorkbookCell(header, value) {
    const raw = cleanCellString(value);
    if (!raw) return '';
    const normalizedHeader = normalizeHeader(header);
    if (normalizedHeader === 'เบอร์โทร' || normalizedHeader === 'phone') return normalizePhoneString(raw);
    if (normalizedHeader === 'เวลา' || normalizedHeader === 'time') return normalizeTimeString(raw);
    if (DATE_HEADERS.has(header) || normalizedHeader.endsWith('_date') || normalizedHeader.startsWith('วันที่')) {
      return normalizeDateString(raw);
    }
    if (normalizedHeader === 'หมายเหตุ' || normalizedHeader === 'remark') return raw;
    return raw.replace(/\n+/g, ' ');
  }

  function toSupabaseDate(value) {
    const normalized = normalizeDateString(value);
    const match = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
  }

  function toSupabaseTime(value) {
    const normalized = normalizeTimeString(value);
    const match = normalized.match(/^(\d{2}):(\d{2})$/);
    return match ? `${match[1]}:${match[2]}:00` : null;
  }

  function toSupabaseNumber(value) {
    const raw = cleanCellString(value).replace(/,/g, '');
    if (!raw) return null;
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function toSupabaseInteger(value) {
    const numeric = toSupabaseNumber(value);
    return numeric === null ? null : Math.round(numeric);
  }

  function toSupabaseIso(dateText, timeText) {
    const date = toSupabaseDate(dateText);
    const time = toSupabaseTime(timeText);
    return date && time ? `${date}T${time}+07:00` : new Date().toISOString();
  }

  function toBoolean(value) {
    const raw = cleanCellString(value).toLowerCase();
    if (!raw) return false;
    return ['true', 'yes', 'y', '1', 'ครบ', 'มี', 'done', 'ok', 'x'].includes(raw);
  }

  function normalizeEnum(value, choices, fallback) {
    const raw = cleanCellString(value).toUpperCase().replace(/\s+/g, '_');
    return choices.includes(raw) ? raw : fallback;
  }

  function pickRaw(raw, names) {
    for (const name of names) {
      const value = raw[name];
      if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
    }
    return '';
  }

  function pickPermitRaw(raw, fieldName) {
    const aliases = PERMIT_FIELD_ALIASES[fieldName] || [fieldName];
    for (const alias of aliases) {
      const direct = raw[alias];
      if (direct !== undefined && direct !== null && String(direct).trim() !== '') return String(direct).trim();
      const normalizedAlias = normalizeHeader(alias);
      for (const key of Object.keys(raw)) {
        if (normalizeHeader(key) === normalizedAlias && String(raw[key] ?? '').trim() !== '') {
          return String(raw[key]).trim();
        }
      }
    }
    return '';
  }

  function defaultStatusForSheet(sheetKey) {
    const map = {
      ngan: 'Waiting',
      duNgan: 'รอดูงาน',
      langPaeng: 'รอนัด',
      som: 'รอส่ง',
      bil: 'รอออกบิล',
    };
    return map[sheetKey] || '';
  }

  function hashText(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function parseWorkbookComments(note, sheetKey, sheetRow) {
    const text = cleanCellString(note);
    if (!text) return [];

    return text
      .split(/\r?\n/)
      .map((line, index) => {
        const rawLine = cleanCellString(line);
        if (!rawLine) return null;

        const match = rawLine.match(/^\[(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2})\]\s*([^:]+):\s*(.+)$/);
        if (!match) {
          return {
            author: 'ไม่ระบุ',
            message: rawLine,
            source: UPLOAD_COMMENT_SOURCE,
            source_key: `${UPLOAD_COMMENT_SOURCE}:${hashText(`${sheetKey}|${sheetRow}|${index}|${rawLine}`)}`,
            commented_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
          };
        }

        const parsedAuthor = cleanCellString(match[3]);
        const allowedAuthor = Array.isArray(TEAM_MEMBERS) && TEAM_MEMBERS.includes(parsedAuthor) ? parsedAuthor : 'ไม่ระบุ';
        const parsedMessage = cleanCellString(match[4]);
        const message = allowedAuthor === parsedAuthor || !parsedAuthor
          ? parsedMessage
          : `${parsedAuthor}: ${parsedMessage}`;

        return {
          author: allowedAuthor,
          message,
          source: UPLOAD_COMMENT_SOURCE,
          source_key: `${UPLOAD_COMMENT_SOURCE}:${hashText(`${sheetKey}|${sheetRow}|${index}|${rawLine}`)}`,
          commented_at: toSupabaseIso(match[1], match[2]),
          created_at: toSupabaseIso(match[1], match[2]),
        };
      })
      .filter(Boolean);
  }

  function inferPermitWorkflowKey(record) {
    const provider = record.utility_provider === 'MEA' ? 'MEA' : 'PEA';
    const exportMode = cleanCellString(record.export_mode).toUpperCase();
    const projectType = cleanCellString(record.project_type).toUpperCase();
    const permitType = cleanCellString(record.permit_type).toUpperCase();
    if (exportMode.includes('SELL') || projectType.includes('SELL') || permitType.includes('SELL')) {
      return `${provider}_HOUSEHOLD_SELL`;
    }
    return `${provider}_SELF_USE`;
  }

  function computePermitAgingDays(record) {
    const baseDate = record.next_action_date
      || record.submit_date
      || record.comment_date
      || record.contract_date
      || record.install_date
      || new Date().toISOString().slice(0, 10);
    if (!baseDate) return 0;
    const base = new Date(baseDate);
    if (Number.isNaN(base.getTime())) return 0;
    const diff = Date.now() - base.getTime();
    return Math.max(0, Math.floor(diff / 86400000));
  }

  function buildWorkbookJob(sheetKey, sheetRow, headers, row) {
    const raw = {};
    headers.forEach((header, index) => {
      if (!header) return;
      raw[header] = normalizeWorkbookCell(header, row[index]);
    });

    const customer = pickRaw(raw, ['ลูกค้า']);
    const title = pickRaw(raw, ['รายการ']) || customer;
    const note = pickRaw(raw, ['หมายเหตุ']);

    return {
      sheet_key: sheetKey,
      sheet_name: DEFAULT_SHEET_NAMES[sheetKey] || WORKBOOK_SHEET_MAP[sheetKey] || sheetKey,
      sheet_row: sheetRow,
      customer_name: customer || null,
      title: title || null,
      detail: pickRaw(raw, ['รายละเอียด']) || null,
      phone: normalizePhoneString(pickRaw(raw, ['เบอร์โทร'])) || null,
      job_date: toSupabaseDate(pickRaw(raw, ['วันที่'])),
      job_time: toSupabaseTime(pickRaw(raw, ['เวลา'])),
      created_date: toSupabaseDate(pickRaw(raw, ['วันที่สร้าง'])),
      appointment_date: toSupabaseDate(pickRaw(raw, ['วันที่นัด'])),
      sent_date: toSupabaseDate(pickRaw(raw, ['วันที่ส่ง'])),
      received_date: toSupabaseDate(pickRaw(raw, ['วันที่รับ'])),
      technician: pickRaw(raw, ['ช่าง']) || null,
      job_type: pickRaw(raw, ['ประเภท']) || null,
      price: toSupabaseNumber(pickRaw(raw, ['ราคา'])),
      amount: toSupabaseNumber(pickRaw(raw, ['ยอด'])),
      maps_url: pickRaw(raw, ['Maps', 'Maps Link']) || null,
      status: pickRaw(raw, ['สถานะ']) || defaultStatusForSheet(sheetKey),
      note: note || null,
      raw_data: raw,
      synced_at: new Date().toISOString(),
    };
  }

  function buildPermitRecord(sheetRow, headers, row) {
    const raw = {};
    headers.forEach((header, index) => {
      if (!header) return;
      raw[header] = normalizeWorkbookCell(header, row[index]);
    });

    const checklist = {};
    PERMIT_CHECKLIST_KEYS.forEach(key => {
      checklist[key] = toBoolean(pickPermitRaw(raw, key));
    });

    const utilityProvider = normalizeEnum(pickPermitRaw(raw, 'utility_provider'), ['PEA', 'MEA'], 'PEA');
    const phase = normalizeEnum(pickPermitRaw(raw, 'phase'), PERMIT_PHASES, 'PRECHECK');
    const status = normalizeEnum(pickPermitRaw(raw, 'status'), PERMIT_STATUSES, 'WAITING');

    const record = {
      sheet_name: PERMIT_SHEET_NAME,
      sheet_row: sheetRow,
      customer_name: pickPermitRaw(raw, 'customer_name') || null,
      phone: normalizePhoneString(pickPermitRaw(raw, 'phone')) || null,
      site_name: pickPermitRaw(raw, 'site_name') || null,
      site_address: pickPermitRaw(raw, 'site_address') || null,
      utility_provider: utilityProvider,
      permit_type: pickPermitRaw(raw, 'permit_type') || null,
      project_type: pickPermitRaw(raw, 'project_type') || null,
      meter_phase: pickPermitRaw(raw, 'meter_phase') || null,
      meter_no: pickPermitRaw(raw, 'meter_no') || null,
      ca_no: pickPermitRaw(raw, 'ca_no') || null,
      pv_kwp: toSupabaseNumber(pickPermitRaw(raw, 'pv_kwp')),
      inverter_brand: pickPermitRaw(raw, 'inverter_brand') || null,
      inverter_model: pickPermitRaw(raw, 'inverter_model') || null,
      inverter_kw: toSupabaseNumber(pickPermitRaw(raw, 'inverter_kw')),
      export_mode: pickPermitRaw(raw, 'export_mode') || null,
      workflow_key: pickPermitRaw(raw, 'workflow_key') || null,
      phase,
      status,
      application_no: pickPermitRaw(raw, 'application_no') || null,
      submit_date: toSupabaseDate(pickPermitRaw(raw, 'submit_date')),
      comment_date: toSupabaseDate(pickPermitRaw(raw, 'comment_date')),
      resubmit_date: toSupabaseDate(pickPermitRaw(raw, 'resubmit_date')),
      contract_date: toSupabaseDate(pickPermitRaw(raw, 'contract_date')),
      install_date: toSupabaseDate(pickPermitRaw(raw, 'install_date')),
      photo_upload_date: toSupabaseDate(pickPermitRaw(raw, 'photo_upload_date')),
      inspection_date: toSupabaseDate(pickPermitRaw(raw, 'inspection_date')),
      meter_change_date: toSupabaseDate(pickPermitRaw(raw, 'meter_change_date')),
      parallel_date: toSupabaseDate(pickPermitRaw(raw, 'parallel_date')),
      assigned_to: pickPermitRaw(raw, 'assigned_to') || null,
      priority: pickPermitRaw(raw, 'priority') || null,
      next_action_date: toSupabaseDate(pickPermitRaw(raw, 'next_action_date')),
      aging_days: toSupabaseInteger(pickPermitRaw(raw, 'aging_days')),
      owner_docs_complete: toBoolean(pickPermitRaw(raw, 'owner_docs_complete')),
      design_docs_complete: toBoolean(pickPermitRaw(raw, 'design_docs_complete')),
      installation_docs_complete: toBoolean(pickPermitRaw(raw, 'installation_docs_complete')),
      payment_status: pickPermitRaw(raw, 'payment_status') || null,
      remark: pickPermitRaw(raw, 'remark') || null,
      document_checklist: checklist,
      raw_data: raw,
    };

    record.workflow_key = record.workflow_key || inferPermitWorkflowKey(record);
    if (record.aging_days === null) record.aging_days = computePermitAgingDays(record);
    return record;
  }

  function sheetToMatrix(workbook, sheetName) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) return null;
    return XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: false,
      defval: '',
    });
  }

  function buildWorkbookData(workbook) {
    const jobs = [];
    const permits = [];
    const counts = {};
    const missingSheets = [];

    Object.entries(WORKBOOK_SHEET_MAP).forEach(([sheetKey, sheetName]) => {
      counts[sheetKey] = 0;
      const matrix = sheetToMatrix(workbook, sheetName);
      if (!matrix) {
        missingSheets.push(sheetName);
        return;
      }
      if (!matrix.length) return;

      const headers = (matrix[0] || []).map(value => cleanCellString(value));
      for (let rowIndex = 1; rowIndex < matrix.length; rowIndex += 1) {
        const row = matrix[rowIndex] || [];
        if (isBlankRow(row)) continue;
        jobs.push(buildWorkbookJob(sheetKey, rowIndex + 1, headers, row));
        counts[sheetKey] += 1;
      }
    });

    counts.permit = 0;
    const permitMatrix = sheetToMatrix(workbook, PERMIT_SHEET_NAME);
    if (!permitMatrix) {
      missingSheets.push(PERMIT_SHEET_NAME);
    } else if (permitMatrix.length) {
      const headers = (permitMatrix[0] || []).map(value => cleanCellString(value));
      for (let rowIndex = 1; rowIndex < permitMatrix.length; rowIndex += 1) {
        const row = permitMatrix[rowIndex] || [];
        if (isBlankRow(row)) continue;
        permits.push(buildPermitRecord(rowIndex + 1, headers, row));
        counts.permit += 1;
      }
    }

    return { jobs, permits, counts, missingSheets };
  }

  async function upsertJobs(jobs) {
    const returned = [];
    for (const batch of chunkArray(jobs, 100)) {
      const { data, error } = await sb
        .from('hi_solar_jobs')
        .upsert(batch, { onConflict: 'sheet_key,sheet_row' })
        .select('id,sheet_key,sheet_row,note');
      if (error) throw error;
      returned.push(...(data || []));
    }
    return returned;
  }

  async function upsertPermits(permits) {
    for (const batch of chunkArray(permits, 100)) {
      const { error } = await sb
        .from('hi_solar_permits')
        .upsert(batch, { onConflict: 'sheet_name,sheet_row' });
      if (error) throw error;
    }
  }

  function buildCommentPayload(jobs) {
    const comments = [];
    (jobs || []).forEach(job => {
      parseWorkbookComments(job.note, job.sheet_key, job.sheet_row).forEach(comment => {
        comments.push({
          job_id: job.id,
          author: comment.author,
          message: comment.message,
          source: comment.source,
          source_key: comment.source_key,
          commented_at: comment.commented_at,
          created_at: comment.created_at,
        });
      });
    });
    return comments;
  }

  async function upsertComments(comments) {
    for (const batch of chunkArray(comments, 100)) {
      const { error } = await sb
        .from('hi_solar_job_comments')
        .upsert(batch, { onConflict: 'source,source_key' });
      if (error) throw error;
    }
  }

  function summarizeCounts(counts) {
    return Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([sheetKey, count]) => `${SHEET_LABELS[sheetKey] || sheetKey} ${count}`)
      .join(' | ');
  }

  function openWorkbookPicker() {
    const input = getUploadInput();
    if (!input) return;
    input.click();
  }

  async function handleWorkbookFile(event) {
    const input = event?.target || getUploadInput();
    const file = input?.files?.[0];
    if (!file) return;

    if (!sb) {
      showToast('ยังไม่ได้เชื่อม Supabase', 'danger');
      setUploadStatus('ยังไม่ได้เชื่อม Supabase', 'danger');
      input.value = '';
      return;
    }
    if (!window.XLSX) {
      showToast('ยังไม่ได้โหลดตัวอ่านไฟล์ Excel', 'danger');
      setUploadStatus('ยังไม่ได้โหลดตัวอ่านไฟล์ Excel', 'danger');
      input.value = '';
      return;
    }

    setUploadBusy(true);
    setUploadStatus(`กำลังอ่านไฟล์ ${file.name}`, 'progress');

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const { jobs, permits, counts, missingSheets } = buildWorkbookData(workbook);
      const totalItems = jobs.length + permits.length;

      if (!totalItems) {
        throw new Error('ไม่พบข้อมูลในชีตที่รองรับ');
      }

      setUploadStatus(`กำลังอัปโหลด ${totalItems} รายการเข้า Supabase`, 'progress');

      if (jobs.length) {
        const savedJobs = await upsertJobs(jobs);
        const comments = buildCommentPayload(savedJobs);
        if (comments.length) {
          setUploadStatus(`อัปโหลดงานแล้ว กำลัง sync คอมเมนต์ ${comments.length} รายการ`, 'progress');
          await upsertComments(comments);
        }
      }

      if (permits.length) {
        setUploadStatus(`กำลังอัปโหลดขออนุญาต ${permits.length} รายการ`, 'progress');
        await upsertPermits(permits);
      }

      await loadData();

      const summary = summarizeCounts(counts);
      const missingText = missingSheets.length ? ` | ไม่พบชีต: ${missingSheets.join(', ')}` : '';
      setUploadStatus(`อัปโหลดสำเร็จ ${totalItems} รายการ${summary ? ` | ${summary}` : ''}${missingText}`, 'success');
      showToast(`อัปโหลด Excel สำเร็จ ${totalItems} รายการ`, 'success');
    } catch (error) {
      console.error('Workbook import failed', error);
      const message = typeof formatSupabaseError === 'function'
        ? formatSupabaseError(error, 'อัปโหลดไฟล์')
        : `อัปโหลดไฟล์ไม่ได้: ${error?.message || error}`;
      setUploadStatus(message, 'danger');
      showToast(message, 'danger');
    } finally {
      setUploadBusy(false);
      if (input) input.value = '';
    }
  }

  window.openWorkbookPicker = openWorkbookPicker;
  window.handleWorkbookFile = handleWorkbookFile;
})();

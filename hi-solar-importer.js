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

  const DATE_HEADERS = new Set(['วันที่', 'วันที่สร้าง', 'วันที่นัด', 'วันที่ส่ง', 'วันที่รับ']);
  const UPLOAD_COMMENT_SOURCE = 'xlsx_upload';

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
    if (header === 'เบอร์โทร') return normalizePhoneString(raw);
    if (header === 'เวลา') return normalizeTimeString(raw);
    if (DATE_HEADERS.has(header)) return normalizeDateString(raw);
    if (header === 'หมายเหตุ') return raw;
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

  function toSupabaseIso(dateText, timeText) {
    const date = toSupabaseDate(dateText);
    const time = toSupabaseTime(timeText);
    return date && time ? `${date}T${time}+07:00` : new Date().toISOString();
  }

  function pickRaw(raw, names) {
    for (const name of names) {
      const value = raw[name];
      if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
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

  function buildJobsFromWorkbook(workbook) {
    const jobs = [];
    const counts = {};
    const missingSheets = [];

    Object.entries(WORKBOOK_SHEET_MAP).forEach(([sheetKey, sheetName]) => {
      const worksheet = workbook.Sheets[sheetName];
      counts[sheetKey] = 0;
      if (!worksheet) {
        missingSheets.push(sheetName);
        return;
      }

      const matrix = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        raw: false,
        defval: '',
      });
      if (!matrix.length) return;

      const headers = (matrix[0] || []).map(value => cleanCellString(value));
      for (let rowIndex = 1; rowIndex < matrix.length; rowIndex += 1) {
        const row = matrix[rowIndex] || [];
        if (isBlankRow(row)) continue;
        jobs.push(buildWorkbookJob(sheetKey, rowIndex + 1, headers, row));
        counts[sheetKey] += 1;
      }
    });

    return { jobs, counts, missingSheets };
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
      .map(([sheetKey, count]) => `${WORKBOOK_SHEET_MAP[sheetKey]} ${count}`)
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
      const { jobs, counts, missingSheets } = buildJobsFromWorkbook(workbook);

      if (!jobs.length) {
        throw new Error('ไม่พบข้อมูลในชีตที่รองรับ');
      }

      setUploadStatus(`กำลังอัปโหลด ${jobs.length} รายการเข้า Supabase`, 'progress');
      const savedJobs = await upsertJobs(jobs);
      const comments = buildCommentPayload(savedJobs);
      if (comments.length) {
        setUploadStatus(`อัปโหลดรายการแล้ว กำลัง sync คอมเมนต์ ${comments.length} รายการ`, 'progress');
        await upsertComments(comments);
      }

      await loadData();

      const summary = summarizeCounts(counts);
      const missingText = missingSheets.length ? ` | ไม่พบชีต: ${missingSheets.join(', ')}` : '';
      setUploadStatus(`อัปโหลดสำเร็จ ${jobs.length} รายการ${summary ? ` | ${summary}` : ''}${missingText}`, 'success');
      showToast(`อัปโหลด Excel สำเร็จ ${jobs.length} รายการ`, 'success');
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

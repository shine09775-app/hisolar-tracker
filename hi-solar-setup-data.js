// ============================================================
//  Hi Solar - Setup Data Script
//  วิธีใช้:
//  1. เปิด Google Sheets -> Extensions -> Apps Script
//  2. วางโค้ดนี้ทั้งหมดลงใน editor
//  3. เลือก function "setupAllSheets" -> Run
// ============================================================

function setupAllSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // —— 1. ดูงาน ——————————————————————————————————————————————
  var shDu = getOrCreateSheet(ss, 'ดูงาน');
  shDu.clearContents();
  shDu.getRange(1, 1, 1, 8).setValues([[
    'ID', 'วันที่', 'เวลา', 'ลูกค้า', 'เบอร์โทร', 'Maps', 'หมายเหตุ', 'สถานะ'
  ]]);
  shDu.getRange(2, 1, 7, 8).setValues([
    [1, '02/04/2026', '10:00', 'บ้านคุณเต็มดวง สันป่าตอง', '', 'https://maps.app.goo.gl/VWdaUybNycs852yX8', '', 'รอดูงาน'],
    [2, '02/04/2026', '13:30', 'บ้านสวนสันทราย', '', 'https://maps.app.goo.gl/mhC6TzXETE1ruEFD8', '', 'รอดูงาน'],
    [3, '03/04/2026', '10:00', 'Rich Atlas ใกล้ Big C หางดง', '', 'https://maps.app.goo.gl/L8ih7LuvGhUWiziT7', '', 'รอดูงาน'],
    [4, '03/04/2026', '13:00', 'วราภรณ์ (Lucky)', '0807902365', 'https://maps.app.goo.gl/XYudYMX5aeSBrHV56', '', 'รอดูงาน'],
    [5, '04/04/2026', '', 'คุณปู หมู่บ้านกุลพันธ์ พร็อพเพอร์ตี้', '', '', '', 'รอดูงาน'],
    [6, '09/04/2026', '10:30', 'บ้านคุณทับทิม', '', 'https://maps.app.goo.gl/a6weVtWVX4pD1ozp9', 'แนะนำโดย ผรม.คุณเก่ง | 10KW Hybrid 3 Phase', 'รอดูงาน'],
    [7, '16/04/2026', '', 'เพื่อนคุณ LINDA - Upgrade ระบบ', '', '', '', 'รอดูงาน'],
  ]);
  styleHeader(shDu, 8);

  // —— 2. งาน ——————————————————————————————————————————————
  var shNgan = getOrCreateSheet(ss, 'งาน');
  shNgan.clearContents();
  shNgan.getRange(1, 1, 1, 11).setValues([[
    'ID', 'วันที่สร้าง', 'ลูกค้า', 'เบอร์โทร', 'รายละเอียด', 'Maps', 'ประเภท', 'ช่าง', 'ราคา', 'สถานะ', 'หมายเหตุ'
  ]]);
  shNgan.getRange(2, 1, 8, 11).setValues([
    [1, '07/04/2026', 'คุณ Tap - กาญจนกนก 19 (Sorawit home)', '', 'ล้างแผง / ตะแกรงกันนก', 'https://maps.app.goo.gl/mQukt7wCLHAXw2uv8', '', '', '', 'Done', ''],
    [2, '', 'คุณเอ๋นุชชนา - ดอยสะเก็ด', '', 'ติดตั้งแบตเตอรี่ FLA48250 + แผงกันหมาฉี่', 'https://maps.app.goo.gl/mqKgBRN3Js6mdfQ68', 'Off Grid', '', '', 'Waiting', ''],
    [3, '', 'สวนแม่วาง', '', 'ย้ายระบบ Off Grid จากสวน -> ตัวเมืองแม่วาง', 'https://maps.app.goo.gl/iSQHvhTMsQRyVnPG6', 'Off Grid', '', '', 'Waiting', ''],
    [4, '', 'คุณลินดา', '', 'เพิ่มแบตเตอรี่ LV Topsun', '', '', '', '', 'Waiting', ''],
    [5, '', 'คุณหมอวีระชาติ', '', 'เพิ่มแบตเตอรี่ PSI', '', '', '', '', 'Waiting', ''],
    [6, '', 'คุณปู - หมู่บ้านกุลพันธ์ 19', '', 'ติดตั้งแผง 8 ใบ + เปลี่ยน CT', '', 'Hybrid', '', 45000, 'Waiting', ''],
    [7, '', 'คุณเต็มดวง - สันป่าตอง', '', 'เพิ่มแผง + ติดตั้ง CT จุดใหม่', '', '', '', 25000, 'Waiting', ''],
    [8, '', 'คุณอุ๋ย', '', 'ปรับปรุงระบบ', '', '', '', '', 'Waiting', ''],
  ]);
  styleHeader(shNgan, 11);

  // —— 3. ล้างแผง ——————————————————————————————————————————————
  var shLang = getOrCreateSheet(ss, 'ล้างแผง');
  shLang.clearContents();
  shLang.getRange(1, 1, 1, 7).setValues([[
    'ID', 'ลูกค้า', 'Maps', 'วันที่นัด', 'ช่าง', 'สถานะ', 'หมายเหตุ'
  ]]);
  shLang.getRange(2, 1, 1, 7).setValues([
    [1, 'บ้านคุณ Nook Home', 'https://maps.app.goo.gl/Z4f3XEq5RHHNbAPf7', '', '', 'รอนัด', ''],
  ]);
  styleHeader(shLang, 7);

  // —— 4. ซ่อม ——————————————————————————————————————————————
  var shSom = getOrCreateSheet(ss, 'ซ่อม');
  shSom.clearContents();
  shSom.getRange(1, 1, 1, 7).setValues([[
    'ID', 'รายการ', 'ลูกค้า', 'วันที่ส่ง', 'วันที่รับ', 'สถานะ', 'หมายเหตุ'
  ]]);
  shSom.getRange(2, 1, 1, 7).setValues([
    [1, 'Inverter', 'หอพักสุธาสินี', '', '', 'ส่งซ่อมแล้ว', 'เครื่องมีปัญหาภายใน'],
  ]);
  styleHeader(shSom, 7);

  // —— 5. บิล ——————————————————————————————————————————————
  var shBil = getOrCreateSheet(ss, 'บิล');
  shBil.clearContents();
  shBil.getRange(1, 1, 1, 6).setValues([[
    'ID', 'ลูกค้า', 'ยอด', 'วันที่', 'สถานะ', 'หมายเหตุ'
  ]]);
  shBil.getRange(2, 1, 4, 6).setValues([
    [1, 'เสาวรภย์ กุสุมาฯ ณ อยุธยา', 250000, '', 'รอออกบิล', ''],
    [2, 'คุณอุรพันธ์ สุขสมนิตย์', 210000, '', 'รอออกบิล', ''],
    [3, 'บริษัท ราชาน๊อต จำกัด', 489000, '', 'รอออกบิล', ''],
    [4, 'บริษัท แพทริค แมค ไบรด์ มาร์เก็ตติ้ง จำกัด', 1060000, '', 'รอออกบิล', ''],
  ]);
  styleHeader(shBil, 6);

  // —— 6. ขออนุญาต ——————————————————————————————————————————————
  var shPermit = getOrCreateSheet(ss, 'ขออนุญาต');
  shPermit.clearContents();
  shPermit.getRange(1, 1, 1, 46).setValues([[
    'customer_name', 'phone', 'site_name', 'site_address', 'utility_provider', 'permit_type', 'project_type', 'meter_phase', 'meter_no', 'ca_no',
    'pv_kwp', 'inverter_brand', 'inverter_model', 'inverter_kw', 'export_mode', 'workflow_key', 'phase', 'status', 'application_no', 'submit_date',
    'comment_date', 'resubmit_date', 'contract_date', 'install_date', 'photo_upload_date', 'inspection_date', 'meter_change_date', 'parallel_date', 'assigned_to', 'priority',
    'next_action_date', 'aging_days', 'owner_docs_complete', 'design_docs_complete', 'installation_docs_complete', 'payment_status', 'remark', 'id_card',
    'house_registration', 'electricity_bill', 'authorization_letter', 'sld', 'inverter_datasheet', 'layout', 'meter_photo', 'mdb_photo'
  ]]);
  shPermit.getRange(2, 1, 1, 46).setValues([[
    'คุณตัวอย่าง', '0812345678', 'บ้านคุณตัวอย่าง', 'เชียงใหม่', 'PEA', 'SELF_USE', 'RESIDENTIAL', '1P', '1234567', 'CA-001',
    5.28, 'Huawei', 'SUN2000', 5, 'SELF_USE', 'PEA_SELF_USE', 'DOCS', 'IN_PROGRESS', 'APP-0001', '17/04/2026',
    '', '', '', '', '', '', '', '', 'Shine', 'HIGH',
    '20/04/2026', 0, 'TRUE', 'FALSE', 'FALSE', 'UNPAID', 'รอเอกสารเจ้าของ', 'TRUE',
    'TRUE', 'TRUE', 'FALSE', 'FALSE', 'TRUE', 'FALSE', 'TRUE', 'FALSE'
  ]]);
  styleHeader(shPermit, 46);

  var defaultSheet = ss.getSheetByName('Sheet1') || ss.getSheetByName('แผ่น1');
  if (defaultSheet && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }

  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert('✅ Setup เสร็จแล้ว!\nมี 6 Sheets: ดูงาน | งาน | ล้างแผง | ซ่อม | บิล | ขออนุญาต');
}

function getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

function styleHeader(sheet, numCols) {
  var headerRange = sheet.getRange(1, 1, 1, numCols);
  headerRange.setBackground('#16a34a');
  headerRange.setFontColor('#ffffff');
  headerRange.setFontWeight('bold');
  headerRange.setFontSize(11);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, numCols);
}

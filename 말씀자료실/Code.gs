/**
 * 말씀 자료실 — 장유중앙교회
 * 주일 설교 요약본과 목장 모임 교재(휴대폰 화면 HTML + 인쇄용 PDF)를 주마다 모아 두는 앱.
 * 파일은 구글 드라이브 「말씀 자료실」 폴더에, 목록은 그 폴더의 「자료목록.json」에 저장합니다.
 * 보기는 누구나, 올리기·지우기는 편집 비밀번호를 아는 사람만 할 수 있습니다.
 */

var FOLDER_ID = '1J3hEnZgx2rb-ut-E3nO8gB57vxOrHS2w';
var INDEX_NAME = '자료목록.json';
var KIND_NAME = { summary: '설교요약본', mokjang: '목장모임교재' };

/* ---------- 화면 ---------- */
function doGet(e) {
  var p = (e && e.parameter) || {};
  migrate_();
  if (p.v) return viewHtml_(String(p.v));
  var t = HtmlService.createTemplateFromFile('Index');
  t.dataJson = JSON.stringify(publicWeeks_(readIndex_().weeks)).replace(/</g, '\\u003c');
  t.appUrl = ScriptApp.getService().getUrl();
  t.hasPin = !!PropertiesService.getScriptProperties().getProperty('PIN_HASH');
  return t.evaluate()
    .setTitle('말씀 자료실')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* 휴대폰 화면(HTML) 자료를 한 페이지로 보여 줍니다. 자료목록에 있는 파일만 엽니다. */
function viewHtml_(id) {
  var found = null;
  readIndex_().weeks.forEach(function (w) {
    ['summary', 'mokjang'].forEach(function (k) { if (w[k] && w[k].html === id) found = { w: w, k: k }; });
  });
  if (!found) return HtmlService.createHtmlOutput('<p style="font:18px sans-serif;padding:24px">찾는 자료가 없습니다.</p>').setTitle('말씀 자료실');
  var html = DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8');
  var back = '<a href="' + ScriptApp.getService().getUrl() + '" target="_top" style="position:sticky;top:0;z-index:99;display:block;' +
    'background:#2f4858;color:#fff;font:600 15px/1.4 sans-serif;padding:12px 16px;text-decoration:none">← 말씀 자료실 목록</a>';
  var m = html.match(/<body[^>]*>/i);
  html = m ? html.replace(m[0], m[0] + back) : back + html;
  var title = (KIND_NAME[found.k] === '설교요약본' ? '설교 요약본' : '목장 모임 교재') + ' · ' + (found.w.title || '');
  return HtmlService.createHtmlOutput(html)
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ---------- 자료목록 ---------- */
function folder_() { return DriveApp.getFolderById(FOLDER_ID); }
function indexFile_() {
  var it = folder_().getFilesByName(INDEX_NAME);
  return it.hasNext() ? it.next() : null;
}
function readIndex_() {
  var f = indexFile_();
  if (!f) return { weeks: [] };
  try {
    var d = JSON.parse(f.getBlob().getDataAsString('UTF-8'));
    if (!d || !Array.isArray(d.weeks)) return { weeks: [] };
    return d;
  } catch (err) { return { weeks: [] }; }
}
function writeIndex_(d) {
  d.weeks.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  var s = JSON.stringify(d, null, 1);
  var f = indexFile_();
  if (f) f.setContent(s); else folder_().createFile(INDEX_NAME, s, 'application/json');
}
/* 화면에 넘길 때는 PDF 보기 주소를 붙여 줍니다. */
function publicWeeks_(weeks) {
  return weeks.map(function (w) {
    var o = { date: w.date, title: w.title || '', ref: w.ref || '' };
    ['summary', 'mokjang'].forEach(function (k) {
      if (!w[k]) return;
      var x = {};
      if (w[k].html) x.html = w[k].html;
      if (w[k].pdf) x.pdf = 'https://drive.google.com/file/d/' + w[k].pdf + '/view';
      if (x.html || x.pdf) o[k] = x;
    });
    return o;
  });
}

/* ---------- 처음 한 번: 예전 자료 가져오기 ---------- */
function migrate_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('MIGRATED') === '2') return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    if (props.getProperty('MIGRATED') === '2') return;
    var d = readIndex_(), changed = false;
    d.weeks.forEach(function (w) {
      ['summary', 'mokjang'].forEach(function (k) {
        var x = w[k]; if (!x) return;
        ['html', 'pdf'].forEach(function (fmt) {
          var src = x[fmt + 'Src'];
          if (!src || x[fmt]) return;
          var res = UrlFetchApp.fetch(src, { muteHttpExceptions: true });
          if (res.getResponseCode() !== 200) return;
          var name = w.date + '_' + KIND_NAME[k] + '_' + (w.title || '') + (fmt === 'pdf' ? '.pdf' : '.html');
          var blob = res.getBlob().setName(name).setContentType(fmt === 'pdf' ? 'application/pdf' : 'text/html');
          var file = folder_().createFile(blob);
          x[fmt] = file.getId();
          delete x[fmt + 'Src'];
          changed = true;
        });
      });
    });
    d.weeks.forEach(function (w) {
      ['summary', 'mokjang'].forEach(function (k) {
        if (w[k] && w[k].pdf) shareFile_(w[k].pdf);
      });
    });
    if (changed) writeIndex_(d);
    var left = d.weeks.some(function (w) { return ['summary', 'mokjang'].some(function (k) { return w[k] && (w[k].htmlSrc || w[k].pdfSrc); }); });
    if (!left) props.setProperty('MIGRATED', '2');
  } finally { lock.releaseLock(); }
}
function shareFile_(id) {
  try { DriveApp.getFileById(id).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (err) {}
}

/* ---------- 편집 비밀번호 ---------- */
function hash_(s) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'jjc-word|' + s, Utilities.Charset.UTF_8));
}
function checkPin_(pin) {
  var h = PropertiesService.getScriptProperties().getProperty('PIN_HASH');
  if (!h || hash_(String(pin || '')) !== h) throw new Error('편집 비밀번호가 맞지 않습니다.');
}
/* 처음에는 비밀번호를 정하고, 그 뒤로는 맞는지만 확인합니다. */
function checkPin(pin) {
  pin = String(pin || '').trim();
  var props = PropertiesService.getScriptProperties();
  var h = props.getProperty('PIN_HASH');
  if (!h) {
    if (pin.length < 4) throw new Error('비밀번호는 4자 이상으로 정해 주세요.');
    props.setProperty('PIN_HASH', hash_(pin));
    return 'set';
  }
  checkPin_(pin);
  return 'ok';
}

/* ---------- 올리기 ---------- */
/* meta: {date, title, ref}, files: [{kind:'summary'|'mokjang', fmt:'html'|'pdf', name, data(base64)}] */
function saveWeek(pin, meta, files) {
  checkPin_(pin);
  meta = meta || {};
  var date = String(meta.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('설교 날짜가 올바르지 않습니다.');
  var title = String(meta.title || '').trim().slice(0, 80);
  if (!title) throw new Error('설교 제목을 적어 주세요.');
  if (!Array.isArray(files) || !files.length) throw new Error('올릴 파일이 없습니다.');
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var d = readIndex_();
    var w = null;
    d.weeks.forEach(function (x) { if (x.date === date) w = x; });
    if (!w) { w = { date: date }; d.weeks.push(w); }
    w.title = title; w.ref = String(meta.ref || '').trim().slice(0, 80);
    files.forEach(function (f) {
      var k = f.kind, fmt = f.fmt;
      if ((k !== 'summary' && k !== 'mokjang') || (fmt !== 'html' && fmt !== 'pdf')) return;
      var bytes = Utilities.base64Decode(String(f.data || ''));
      if (!bytes.length) return;
      var name = date + '_' + KIND_NAME[k] + '_' + title + (fmt === 'pdf' ? '.pdf' : '.html');
      var file = folder_().createFile(Utilities.newBlob(bytes, fmt === 'pdf' ? 'application/pdf' : 'text/html', name));
      if (fmt === 'pdf') shareFile_(file.getId());
      w[k] = w[k] || {};
      if (w[k][fmt]) { try { DriveApp.getFileById(w[k][fmt]).setTrashed(true); } catch (err) {} }
      w[k][fmt] = file.getId();
    });
    writeIndex_(d);
    return publicWeeks_(d.weeks);
  } finally { lock.releaseLock(); }
}

/* ---------- 지우기 (드라이브 휴지통으로 이동하므로 30일 안에는 되살릴 수 있습니다) ---------- */
function deleteWeek(pin, date) {
  checkPin_(pin);
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var d = readIndex_();
    d.weeks = d.weeks.filter(function (w) {
      if (w.date !== date) return true;
      ['summary', 'mokjang'].forEach(function (k) {
        ['html', 'pdf'].forEach(function (fmt) {
          if (w[k] && w[k][fmt]) { try { DriveApp.getFileById(w[k][fmt]).setTrashed(true); } catch (err) {} }
        });
      });
      return false;
    });
    writeIndex_(d);
    return publicWeeks_(d.weeks);
  } finally { lock.releaseLock(); }
}

/* 편집기에서 한 번 실행하면 권한을 미리 허용할 수 있습니다. */
function 처음설정() {
  migrate_();
  Logger.log('자료 ' + readIndex_().weeks.length + '주를 확인했습니다.');
}

/**
 * 장유중앙교회 교인앱 — QR 출석 저장 (구글 시트에 묶인 Apps Script)
 *
 * 처음 한 번: setup() 실행 → 권한 허용. 그다음 배포(웹 앱) → 나온 /exec 주소를 config.js의 GAS_URL에 붙여 넣기.
 * 자세한 순서는 GUIDE.md 참고.
 */

// ===== 여기만 고치면 됩니다 =====
var SHEET_NAME = '출석';
var TZ = 'Asia/Seoul';
var DEDUP_MINUTES = 5;          // 같은 날·같은 예배·같은 사람이 이 시간(분) 안에 또 찍으면 무시. 0이면 '예배당 1회만'
// 사역자·목회자 PIN의 SHA-256 값 (config.js의 두 PIN 값과 같게). PIN 자체는 적지 않습니다.
var PIN_HASHES = ['207464be5b0c08c49a760dc937d8dfaf51d9e6368ef34a9ad580e97cd1a58f0d', '45f7e2974982124d00b1e5f06a2732d1e993e0b2875a7dfda572e35d99783db2'];
var LOCATIONS = { main_hall: '은혜홀', faith_hall: '믿음홀' };
// 예배 시간표 (dow: 0=일 … 6=토, 시작 이상 ~ 끝 미만, 24시간제 "시:분")
var SERVICES = [
  { name: '주일 1부',       dow: [0],             from: '08:00', to: '10:15' },   // 오전 8:50 은혜홀
  { name: '주일 2부',       dow: [0],             from: '10:15', to: '13:00' },   // 오전 10:50 은혜홀
  { name: '주일 오후찬양',  dow: [0],             from: '13:00', to: '16:00' },   // 오후 2:00 은혜홀
  { name: '수요예배',       dow: [3],             from: '18:30', to: '21:30' },   // 저녁 7:30 은혜홀
  { name: '금요심야기도회', dow: [5],             from: '20:00', to: '24:00' },   // 저녁 9:00 은혜홀
  { name: '새벽기도회',     dow: [1, 2, 3, 4, 5, 6], from: '04:30', to: '07:00' } // 오전 5:30 믿음홀
];
var HEADERS = ['타임스탬프', '날짜', '성명', '소속 목장', '연락처 뒷자리', '예배 구분', '스캔 위치/경로', '동반 여부'];
// ================================

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#DCE8F5');
    sh.setFrozenRows(1);
  }
  sh.getRange('B:B').setNumberFormat('@');   // 날짜 글자로
  sh.getRange('E:E').setNumberFormat('@');   // 0123 같은 앞자리 0 보존
  Logger.log('준비 완료. 이제 배포 → 새 배포 → 웹 앱 으로 주소를 만들어 주세요.');
}

function pinOk_(pin) {
  if (!/^\d{4}$/.test(String(pin || ''))) return false;
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'jjc:' + pin, Utilities.Charset.UTF_8);
  var hex = bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
  return PIN_HASHES.indexOf(hex) > -1;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function toMin_(hhmm) { var p = hhmm.split(':'); return Number(p[0]) * 60 + Number(p[1]); }

function serviceOf_(d) {
  var dow = Number(Utilities.formatDate(d, TZ, 'u')) % 7;      // u: 월=1…일=7 → 일=0
  var min = toMin_(Utilities.formatDate(d, TZ, 'HH:mm'));
  for (var i = 0; i < SERVICES.length; i++) {
    var s = SERVICES[i];
    if (s.dow.indexOf(dow) > -1 && min >= toMin_(s.from) && min < toMin_(s.to)) return s.name;
  }
  return '기타';
}

// 시트 수식 주입 방지 + 길이 제한
function clean_(v, max) {
  var s = String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max || 30);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
function phone_(v) { var s = String(v == null ? '' : v).replace(/\D/g, ''); return s.slice(-4); }

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var body = JSON.parse(e.postData.contents);
    if (body.action !== 'checkin') return json_({ ok: false, error: '알 수 없는 요청' });

    var loc = String(body.loc || '');
    if (!LOCATIONS[loc]) return json_({ ok: false, error: '알 수 없는 QR 위치' });

    var name = clean_(body.name, 20);
    if (!name) return json_({ ok: false, error: '이름이 없습니다' });
    var mokjang = clean_(body.mokjang, 20);
    var people = [{ name: name, mokjang: mokjang, phone4: phone_(body.phone4), companion: 'N' }];
    (body.companions || []).slice(0, 10).forEach(function (c) {
      var n = clean_(c.name, 20);
      if (n) people.push({ name: n, mokjang: clean_(c.mokjang, 20) || mokjang, phone4: phone_(c.phone4), companion: 'Y (' + name + ' 동반)' });
    });

    // 인터넷이 끊겼다 나중에 전송된 경우만 기기 시각(24시간 이내, 미래 아님) 사용. 아니면 서버 시각.
    var now = new Date(), when = now;
    if (body.scanTs) {
      var t = new Date(body.scanTs);
      if (!isNaN(t) && t.getTime() <= now.getTime() + 60000 && now.getTime() - t.getTime() < 24 * 3600 * 1000) when = t;
    }
    var date = Utilities.formatDate(when, TZ, 'yyyy-MM-dd');
    var service = serviceOf_(when);

    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sh) { setup(); sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME); }

    // 최근 500줄만 훑어 중복 확인
    var last = sh.getLastRow(), start = Math.max(2, last - 499), recent = [];
    if (last >= 2) recent = sh.getRange(start, 1, last - start + 1, HEADERS.length).getValues();

    var results = [], rows = [];
    people.forEach(function (p) {
      var key = p.name + '|' + p.phone4;
      var dup = recent.some(function (r) {
        if (String(r[1]) !== date || String(r[5]) !== service || (String(r[2]).replace(/^'/, '') + '|' + String(r[4])) !== key) return false;
        if (DEDUP_MINUTES <= 0) return true;
        var rt = r[0] instanceof Date ? r[0] : new Date(r[0]);
        return Math.abs(when.getTime() - rt.getTime()) < DEDUP_MINUTES * 60000;
      });
      if (dup) { results.push({ name: p.name, status: 'duplicate' }); return; }
      rows.push([Utilities.formatDate(when, TZ, 'yyyy-MM-dd HH:mm:ss'), date, p.name, p.mokjang, p.phone4, service, LOCATIONS[loc] + ' (' + loc + ')', p.companion]);
      recent.push([when, date, p.name, p.mokjang, p.phone4, service]);
      results.push({ name: p.name, status: 'saved' });
    });
    if (rows.length) {
      var r0 = sh.getLastRow() + 1;
      sh.getRange(r0, 1, rows.length, HEADERS.length).setNumberFormat('@').setValues(rows);
    }
    return json_({ ok: true, date: date, service: service, results: results });
  } catch (err) {
    return json_({ ok: false, error: '저장 중 오류' });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

// 확인용(주소만 열었을 때) + 사역자용 오늘 목장별 현황(PIN 필요)
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action !== 'summary') return json_({ ok: true, app: '장유중앙교회 교인앱 출석', time: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm') });

  if (!pinOk_(p.pin)) return json_({ ok: false, error: 'PIN이 맞지 않습니다' });

  var date = p.date || Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var groups = {}, services = {}, seen = {};
  if (sh && sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.length).getValues().forEach(function (r) {
      if (String(r[1]) !== date) return;
      var k = r[2] + '|' + r[4];
      services[r[5]] = true;
      if (seen[k]) return; seen[k] = true;                 // 하루에 한 번만 세기
      var m = r[3] || '미정';
      (groups[m] = groups[m] || []).push(String(r[2]).replace(/^'/, ''));
    });
  }
  var list = Object.keys(groups).sort().map(function (m) { return { mokjang: m, count: groups[m].length, names: groups[m] }; });
  return json_({ ok: true, date: date, total: Object.keys(seen).length, services: Object.keys(services), groups: list });
}

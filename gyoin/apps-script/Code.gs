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
  cardSheet_();
  Logger.log('준비 완료. 이제 배포 → 새 배포 → 웹 앱 으로 주소를 만들어 주세요.');
}

// PIN의 권한: 'staff'(사역자) / 'pastor'(목회자) / ''(틀림)   (PIN_HASHES 순서: 사역자, 목회자)
function pinRole_(pin) {
  if (!/^\d{4}$/.test(String(pin || ''))) return '';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'jjc:' + pin, Utilities.Charset.UTF_8);
  var hex = bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
  var i = PIN_HASHES.indexOf(hex);
  return i === 0 ? 'staff' : i === 1 ? 'pastor' : '';
}
function pinOk_(pin) { return !!pinRole_(pin); }

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
    if (body.action === 'card_request') return cardRequest_(body);
    if (body.action === 'card_approve') return cardApprove_(body);
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
  if (p.action === 'card_status') return cardStatus_(p);
  if (p.action === 'card_list') return cardList_(p);
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

// ===== 교인 카드 확인 (사진은 보내지 않고 '사진 지문'만 기록) =====
var CARD_SHEET = '교인카드';
var CARD_HEADERS = ['이름', '소속', '연락처 뒷자리', '사진 지문', '요청일', '상태', '승인일', '승인 권한'];
var CARD_VALID_DAYS = 365;   // 승인 후 이 기간(일)이 지나면 '만료'. 다시 확인을 받아야 합니다.

function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }

function cardSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CARD_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CARD_SHEET);
    sh.getRange(1, 1, 1, CARD_HEADERS.length).setValues([CARD_HEADERS]).setFontWeight('bold').setBackground('#E6DDF8');
    sh.setFrozenRows(1);
    sh.getRange('A:H').setNumberFormat('@');
  }
  return sh;
}

function cardValues_(sh) {
  var n = sh.getLastRow() - 1;
  return n > 0 ? sh.getRange(2, 1, n, CARD_HEADERS.length).getValues() : [];
}

function plain_(v) { return String(v == null ? '' : v).replace(/^'/, ''); }

function cardFind_(vals, name, phone4, hash) {
  for (var i = 0; i < vals.length; i++) {
    if (plain_(vals[i][0]) === plain_(name) && String(vals[i][2]) === phone4 && String(vals[i][3]) === hash) return i;
  }
  return -1;
}

function cardStatusOf_(row) {
  var st = String(row[5]);
  if (st === '확인됨') {
    var days = (new Date(today_()).getTime() - new Date(String(row[6])).getTime()) / 86400000;
    if (!(days <= CARD_VALID_DAYS)) return '만료';
  }
  return st;
}

function cardIdentity_(b) {
  var name = clean_(b.name, 20), phone4 = phone_(b.phone4), hash = String(b.hash || '');
  if (!name || phone4.length !== 4 || !/^[0-9a-f]{24}$/.test(hash)) return null;
  return { name: name, phone4: phone4, hash: hash, mokjang: clean_(b.mokjang, 20) };
}

// 성도 폰 → "확인해 주세요" 요청 (사진은 오지 않음)
function cardRequest_(b) {
  var id = cardIdentity_(b);
  if (!id) return json_({ ok: false, error: '정보가 올바르지 않습니다' });
  var sh = cardSheet_(), vals = cardValues_(sh), i = cardFind_(vals, id.name, id.phone4, id.hash), t = today_();
  if (i > -1) {
    var st = cardStatusOf_(vals[i]);
    if (st === '확인됨' || st === '대기') return json_({ ok: true, status: st, date: String(vals[i][6]) });
    sh.getRange(i + 2, 2).setValue(id.mokjang);
    sh.getRange(i + 2, 5, 1, 3).setValues([[t, '대기', '']]);       // 해제·만료 → 다시 대기
    return json_({ ok: true, status: '대기', date: '' });
  }
  for (var k = vals.length - 1; k >= 0; k--) {                         // 같은 사람의 예전 '대기'는 정리
    if (plain_(vals[k][0]) === plain_(id.name) && String(vals[k][2]) === id.phone4 && String(vals[k][5]) === '대기') sh.deleteRow(k + 2);
  }
  var r0 = sh.getLastRow() + 1;
  sh.getRange(r0, 1, 1, CARD_HEADERS.length).setNumberFormat('@').setValues([[id.name, id.mokjang, id.phone4, id.hash, t, '대기', '', '']]);
  return json_({ ok: true, status: '대기', date: '' });
}

// 성도 폰 → 내 카드 상태 조회 (이름+뒷자리+사진 지문이 모두 맞아야 결과가 나옴)
function cardStatus_(p) {
  var id = cardIdentity_(p);
  if (!id) return json_({ ok: false, error: '정보가 올바르지 않습니다' });
  var vals = cardValues_(cardSheet_()), i = cardFind_(vals, id.name, id.phone4, id.hash);
  if (i < 0) return json_({ ok: true, status: '없음', date: '' });
  return json_({ ok: true, status: cardStatusOf_(vals[i]), date: String(vals[i][6]) });
}

// 목회자 PIN: 확인 대기 / 확인된 목록 (사진 없이 이름·소속·날짜만)
function cardList_(p) {
  if (pinRole_(p.pin) !== 'pastor') return json_({ ok: false, error: '목회자 PIN이 필요합니다' });
  var vals = cardValues_(cardSheet_()), pending = [], confirmed = [];
  vals.forEach(function (v) {
    var st = cardStatusOf_(v);
    var item = { name: plain_(v[0]), mokjang: String(v[1]), phone4: String(v[2]), hash: String(v[3]), requested: String(v[4]), approved: String(v[6]), status: st };
    if (st === '대기') pending.push(item);
    else if (st === '확인됨' || st === '만료') confirmed.push(item);
  });
  return json_({ ok: true, pending: pending, confirmed: confirmed, validDays: CARD_VALID_DAYS });
}

// 목회자 PIN: 승인(approve) / 해제(revoke)
function cardApprove_(b) {
  if (pinRole_(b.pin) !== 'pastor') return json_({ ok: false, error: '목회자 PIN이 필요합니다' });
  var id = cardIdentity_(b), op = String(b.op || '');
  if (!id || (op !== 'approve' && op !== 'revoke')) return json_({ ok: false, error: '요청이 올바르지 않습니다' });
  var sh = cardSheet_(), vals = cardValues_(sh), i = cardFind_(vals, id.name, id.phone4, id.hash);
  if (i < 0) return json_({ ok: false, error: '대상을 찾지 못했습니다' });
  if (op === 'revoke') {
    sh.getRange(i + 2, 6).setValue('해제');
    return json_({ ok: true, status: '해제' });
  }
  for (var k = 0; k < vals.length; k++) {                              // 같은 사람의 예전 확인은 새 사진으로 교체
    if (k !== i && plain_(vals[k][0]) === plain_(id.name) && String(vals[k][2]) === id.phone4 && String(vals[k][5]) === '확인됨') sh.getRange(k + 2, 6).setValue('해제');
  }
  sh.getRange(i + 2, 6, 1, 3).setValues([['확인됨', today_(), '목회자']]);
  return json_({ ok: true, status: '확인됨', date: today_() });
}

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
var PIN_HASHES = ['45e1ca72b672acd1138ce84c32385e7795c7fe9610b826f6db9618a7d050c61e', '45f7e2974982124d00b1e5f06a2732d1e993e0b2875a7dfda572e35d99783db2'];
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
  appsSheet_();
  Logger.log('준비 완료. 이제 배포 → 새 배포 → 웹 앱 으로 주소를 만들어 주세요.');
}

// PIN 무작정 대입 방지: 틀린 PIN이 10분 안에 30번 쌓이면 그 동안은 맞는 PIN도 잠시 받지 않습니다.
var PIN_FAIL_LIMIT = 30, PIN_FAIL_WINDOW = 600;
function pinLocked_() {
  try { return Number(CacheService.getScriptCache().get('pinfail') || 0) >= PIN_FAIL_LIMIT; } catch (e) { return false; }
}
function pinFailed_() {
  try { var c = CacheService.getScriptCache(); c.put('pinfail', String(Number(c.get('pinfail') || 0) + 1), PIN_FAIL_WINDOW); } catch (e) {}
}

// PIN의 권한: 'staff'(사역자) / 'pastor'(목회자) / ''(틀림)   (PIN_HASHES 순서: 사역자, 목회자)
function pinRole_(pin) {
  if (!/^\d{4}$/.test(String(pin || ''))) return '';
  if (pinLocked_()) return '';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'jjc:' + pin, Utilities.Charset.UTF_8);
  var hex = bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
  var i = PIN_HASHES.indexOf(hex);
  if (i < 0) pinFailed_();
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
    if (body.action === 'app_save') return appSave_(body);
    if (body.action === 'app_delete') return appDelete_(body);
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
  if (p.action === 'apps') return json_({ ok: true, items: appsList_(pinRole_(p.pin)) });
  if (p.action === 'apps_all') return appsAll_(p);
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


// ===== 앱 목록 (교인 홈에 보이는 앱을 앱 안에서 추가·고침) =====
// 시트 「앱목록」 탭에 한 줄이 앱 하나입니다. 목회자 PIN으로만 쓰고 고칠 수 있고, 목록 보기는 누구나 됩니다.
// 같은 id가 apps.json에도 있으면 이 시트 줄이 apps.json 항목을 덮어씁니다(상태가 '숨김'이면 홈에서 감춤).
var APPS_SHEET = '앱목록';
var APPS_HEADERS = ['id', '묶음', '아이콘', '제목', '설명', '주소', '열림', '닫힘', '대상', '상태', '수정일'];
var APP_SECTIONS = { worship: 1, grow: 1, season: 1 };   // 예배·말씀 / 양육·동아리 / 절기·전도 (대상이 all일 때)
var APP_TARGETS = { all: 1, staff: 1, pastor: 1 };       // all=교인 모두, staff=사역자부터, pastor=목회자만

function appsSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(APPS_SHEET);
  if (!sh) {
    try { sh = ss.insertSheet(APPS_SHEET); } catch (e) { sh = ss.getSheetByName(APPS_SHEET); }
    if (sh && sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, APPS_HEADERS.length).setValues([APPS_HEADERS]).setFontWeight('bold').setBackground('#DDF3E6');
      sh.setFrozenRows(1);
      sh.getRange('A:K').setNumberFormat('@');
    }
  }
  return sh;
}

function dateStr_(v) {
  var s = v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : plain_(v).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function appRow_(v) {
  return { id: plain_(v[0]), section: plain_(v[1]), icon: plain_(v[2]), title: plain_(v[3]), desc: plain_(v[4]), url: plain_(v[5]),
           open: dateStr_(v[6]), close: dateStr_(v[7]), target: plain_(v[8]) || 'all', status: plain_(v[9]) || '공개' };
}

function appsValues_(sh) {
  var n = sh.getLastRow() - 1;
  return n > 0 ? sh.getRange(2, 1, n, APPS_HEADERS.length).getValues() : [];
}

// 누구나(role '') / 사역자 / 목회자가 볼 수 있는 줄만. 숨김 줄은 내용 없이 id만 보냅니다.
function appsList_(role) {
  var out = [];
  appsValues_(appsSheet_()).forEach(function (v) {
    var a = appRow_(v);
    if (!a.id) return;
    var ok = a.target === 'all' || (a.target === 'staff' && (role === 'staff' || role === 'pastor')) || (a.target === 'pastor' && role === 'pastor');
    if (!ok) return;
    out.push(a.status === '숨김' ? { id: a.id, status: '숨김' } : a);
  });
  return out;
}

function appsAll_(p) {
  if (pinLocked_()) return json_({ ok: false, error: '잠시 뒤 다시 시도해 주세요' });
  if (pinRole_(p.pin) !== 'pastor') return json_({ ok: false, error: '목회자 PIN이 필요합니다' });
  var items = appsValues_(appsSheet_()).map(appRow_).filter(function (a) { return a.id; });
  return json_({ ok: true, items: items });
}

function appSave_(b) {
  if (pinLocked_()) return json_({ ok: false, error: '잠시 뒤 다시 시도해 주세요' });
  if (pinRole_(b.pin) !== 'pastor') return json_({ ok: false, error: '목회자 PIN이 필요합니다' });
  var a = b.app || {};
  var title = clean_(a.title, 40), desc = clean_(a.desc, 60), icon = clean_(a.icon, 8) || '📱';
  var url = String(a.url == null ? '' : a.url).trim();
  var target = String(a.target || 'all'), section = String(a.section || ''), status = a.status === '숨김' ? '숨김' : '공개';
  var open = String(a.open || ''), close = String(a.close || '');
  if (!title) return json_({ ok: false, error: '앱 이름을 적어 주세요' });
  if (url && !/^https:\/\/[^\s"'<>]{4,490}$/.test(url)) return json_({ ok: false, error: '주소는 https:// 로 시작해야 해요' });
  if (!APP_TARGETS[target]) return json_({ ok: false, error: '보일 대상이 올바르지 않아요' });
  if (target === 'all' && !APP_SECTIONS[section]) return json_({ ok: false, error: '들어갈 묶음을 골라 주세요' });
  if (target !== 'all') section = '';
  if ((open && !/^\d{4}-\d{2}-\d{2}$/.test(open)) || (close && !/^\d{4}-\d{2}-\d{2}$/.test(close))) return json_({ ok: false, error: '날짜 형식이 올바르지 않아요' });
  if (open && close && close < open) return json_({ ok: false, error: '닫는 날이 여는 날보다 빨라요' });
  var id = String(a.id || '');
  if (id && !/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) return json_({ ok: false, error: '앱 번호(id)가 올바르지 않아요' });

  var sh = appsSheet_(), vals = appsValues_(sh), at = -1;
  if (!id) {                                                           // 새 앱: 겹치지 않는 번호를 새로 만듦
    var used = {}; vals.forEach(function (v) { used[plain_(v[0])] = 1; });
    do { id = 'a' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); } while (used[id]);
  }
  for (var i = 0; i < vals.length; i++) { if (plain_(vals[i][0]) === id) { at = i; break; } }
  var row = [id, section, icon, title, desc, url, open, close, target, status, today_()];
  var r = at > -1 ? at + 2 : sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, APPS_HEADERS.length).setNumberFormat('@').setValues([row]);
  return json_({ ok: true, id: id });
}

function appDelete_(b) {
  if (pinLocked_()) return json_({ ok: false, error: '잠시 뒤 다시 시도해 주세요' });
  if (pinRole_(b.pin) !== 'pastor') return json_({ ok: false, error: '목회자 PIN이 필요합니다' });
  var id = String(b.id || ''), sh = appsSheet_(), vals = appsValues_(sh);
  for (var i = vals.length - 1; i >= 0; i--) { if (plain_(vals[i][0]) === id) sh.deleteRow(i + 2); }
  return json_({ ok: true });
}

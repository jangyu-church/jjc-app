/* 장유중앙교회 교인앱 */
(function () {
  'use strict';
  const CFG = window.JJC_CONFIG;
  const VERSION = 'v1';
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- 저장소(이 폰에만) ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  let profile = store.get('jjc_profile', null);
  let family = store.get('jjc_family', []);
  let last = store.get('jjc_last', null);      // {date, service}
  let queue = store.get('jjc_queue', []);      // 인터넷 안 될 때 쌓아 두는 출석
  let APPS = null;
  let pendingCheckin = null;                   // QR 주소로 들어왔을 때 {loc}

  /* ---------- 시간·예배 구분 (한국 시간 기준) ---------- */
  function kst(d) {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
      .formatToParts(d || new Date()).reduce((o, x) => (o[x.type] = x.value, o), {});
    return { date: p.year + '-' + p.month + '-' + p.day, min: (+p.hour) * 60 + (+p.minute), dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
  }
  // 서버(Code.gs)와 같은 규칙. 시간대는 Code.gs 맨 위 SERVICES에서 고칩니다.
  function serviceOf(d) {
    const t = kst(d), m = t.min, h = (a, b) => a * 60 + b;
    if (t.dow === 0) {
      if (m >= h(8, 0) && m < h(10, 15)) return '주일 1부';
      if (m >= h(10, 15) && m < h(13, 0)) return '주일 2부';
      if (m >= h(13, 0) && m < h(16, 0)) return '주일 오후찬양';
    }
    if (t.dow === 3 && m >= h(18, 30) && m < h(21, 30)) return '수요예배';
    if (t.dow === 5 && m >= h(20, 0)) return '금요심야기도회';
    if (t.dow >= 1 && t.dow <= 6 && m >= h(4, 30) && m < h(7, 0)) return '새벽기도회';
    return '기타';
  }

  /* ---------- 작은 도우미 ---------- */
  let toastTimer;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }
  async function sha(text) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
  }
  function fillMokjang(sel, val) {
    sel.innerHTML = CFG.MOKJANGS.map(m => '<option>' + esc(m) + '</option>').join('');
    if (val) sel.value = val;
  }
  function findApp(id) {
    const all = APPS.sections.flatMap(s => s.items).concat(APPS.staff.items);
    return all.find(a => a.id === id);
  }
  function openUrl(url) { if (url) location.href = url; }

  /* ---------- 화면 모드: 자동 / 라이트 / 나이트 ---------- */
  function getTheme() { try { const t = localStorage.getItem('jjc_theme'); return t === 'light' || t === 'dark' ? t : 'auto'; } catch (e) { return 'auto'; } }
  function applyTheme(t) {
    const root = document.documentElement;
    if (t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
    try { if (t === 'auto') localStorage.removeItem('jjc_theme'); else localStorage.setItem('jjc_theme', t); } catch (e) {}
    const dark = t === 'dark' || (t === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', dark ? '#14161C' : '#F6F8FC');
    document.querySelectorAll('#themeSeg button').forEach(b => b.classList.toggle('on', b.dataset.themeSet === t));
  }
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(getTheme()));

  /* ---------- 화면 시작 ---------- */
  async function init() {
    try { APPS = await (await fetch('apps.json', { cache: 'no-cache' })).json(); }
    catch (e) { APPS = { sections: [], staff: { items: [] } }; toast('앱 목록을 불러오지 못했어요'); }
    fillMokjang($('obMokjang')); fillMokjang($('meMokjang'));
    applyTheme(getTheme());

    const q = new URLSearchParams(location.search);
    if (q.get('action') === 'checkin') {
      pendingCheckin = { loc: q.get('loc') || 'main_hall' };
      history.replaceState(null, '', location.pathname);   // 주소에서 꼬리표 지우기
    }

    if (!profile) {
      $('onboard').hidden = false;
      if (pendingCheckin) $('obPending').hidden = false;
    } else {
      showMain();
    }
    bindEvents();
    flushQueue();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  function showMain() {
    $('onboard').hidden = true; $('main').hidden = false;
    renderHome(); renderMe(); renderStaff();
    if (pendingCheckin) { const p = pendingCheckin; pendingCheckin = null; startUrlCheckin(p.loc); }
  }

  /* ---------- 홈 ---------- */
  function cardHtml(a, sec) {
    const ic = a.img
      ? '<div class="ic img"><img src="' + esc(a.img) + '" alt=""></div>'
      : '<div class="ic" style="background:' + sec.bg + '">' + esc(a.icon || '•') + '</div>';
    const tx = '<div class="nm">' + esc(a.title) + '</div><div class="ds">' + esc(a.desc || '') + '</div>';
    if (a.options) {
      const o = a.options.map(x => x.url ? '<a href="' + esc(x.url) + '">' + esc(x.label) + '</a>' : '<span>' + esc(x.label) + ' 준비 중</span>').join('');
      return '<div class="app">' + ic + '<div class="tx">' + tx + '<div class="opts">' + o + '</div></div></div>';
    }
    if (a.special === 'mokja') {
      const has = !!store.get('jjc_mokja_key', '');
      return '<div class="app">' + ic + '<div class="tx">' + tx + '<div class="opts">' +
        '<button type="button" data-mokja="open">' + (has ? '우리 목장 열기' : '링크 등록') + '</button>' +
        (has ? '<button type="button" class="sub" data-mokja="set">링크 변경</button>' : '') +
        (a.guide ? '<a class="sub" href="' + esc(a.guide) + '">사용 안내</a>' : '') + '</div></div></div>';
    }
    if (a.special === 'summary') return '<button class="app" data-special="summary" type="button">' + ic + '<div class="tx">' + tx + '</div><span class="go">›</span></button>';
    if (a.url) return '<a class="app" href="' + esc(a.url) + '">' + ic + '<div class="tx">' + tx + '</div><span class="go">›</span></a>';
    return '<div class="app soon">' + ic + '<div class="tx">' + tx + '</div><span class="soon-tag">준비 중</span></div>';
  }
  // 시즌 앱: open 날짜부터 close 날짜까지만 보임 (한국 날짜 기준)
  function isOpen(a) {
    if (!('open' in a)) return true;
    const today = kst().date;
    return !!a.open && today >= a.open && (!a.close || today <= a.close);
  }
  function sectionHtml(sec) {
    const items = sec.items.filter(isOpen);
    if (!items.length) return '';
    return '<h2 class="sec-title" style="color:' + sec.fg + '"><span style="color:var(--ink)">' + esc(sec.title) + '</span></h2>' +
      '<div class="grid">' + items.map(a => cardHtml(a, sec)).join('') + '</div>';
  }
  function renderHome() {
    $('helloName').textContent = profile.name;
    $('helloMok').textContent = profile.mokjang;
    $('helloMsg').textContent = CFG.GREETING || '오늘도 은혜로운 예배 되세요!';
    $('pillText').textContent = profile.name + ' · ' + profile.mokjang;
    const b = $('attBadge');
    if (last && last.date === kst().date) { b.className = 'badge on'; b.textContent = '오늘 출석 완료 · ' + last.service; }
    else { b.className = 'badge off'; b.textContent = '오늘 출석 전'; }
    const pn = $('pendingNote');
    pn.hidden = !queue.length;
    pn.textContent = queue.length ? '인터넷이 연결되면 출석 ' + queue.length + '건이 자동 전송돼요' : '';
    $('sections').innerHTML = APPS.sections.map(sectionHtml).join('');
  }

  /* ---------- 사역자 탭 ---------- */
  // 권한: 'staff'(사역자) 또는 'pastor'(목회자 — 사역자용도 모두 보임). 앱을 닫으면 다시 잠깁니다.
  function role() { try { const r = sessionStorage.getItem('jjc_staff'); return r === 'staff' || r === 'pastor' ? r : ''; } catch (e) { return ''; } }
  function renderStaff() {
    const r = role();
    $('staffLock').hidden = !!r; $('staffBody').hidden = !r;
    if (!r) return;
    const st = APPS.staff;
    const common = Object.assign({}, st, { items: st.items.filter(a => a.role !== 'pastor') });
    const pastor = Object.assign({}, st, { title: st.pastorTitle || '목회자 전용', fg: '#7C5CE0', bg: '#EFE9FF', items: st.items.filter(a => a.role === 'pastor') });
    $('staffBody').innerHTML = '<div class="role-bar"><span>' + (r === 'pastor' ? '목회자로 열림' : '사역자로 열림') + '</span><button type="button" id="btnLock">🔒 잠그기</button></div>' +
      (r === 'pastor' ? sectionHtml(pastor) : '') + sectionHtml(common) + '<div id="summaryBox"></div>';
  }
  async function showSummary() {
    const box = $('summaryBox');
    box.innerHTML = '<div class="card"><p class="muted">불러오는 중…</p></div>';
    box.scrollIntoView({ behavior: 'smooth' });
    if (!CFG.GAS_URL) { box.innerHTML = '<div class="card"><p class="muted">연습 모드입니다. 구글 시트 주소(GAS_URL)를 연결하면 목장별 출석이 여기에 보입니다.</p></div>'; return; }
    try {
      const pin = sessionStorage.getItem('jjc_pin') || '';
      const r = await fetch(CFG.GAS_URL + '?action=summary&pin=' + encodeURIComponent(pin));
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || '실패');
      const rows = d.groups.map(g => '<tr><td>' + esc(g.mokjang) + '</td><td><b>' + g.count + '</b>명<div class="names">' + esc(g.names.join(', ')) + '</div></td></tr>').join('');
      box.innerHTML = '<div class="card"><div class="sum-head"><h2>' + esc(d.date) + ' 출석 현황</h2><button class="btn" id="sumRefresh" type="button">새로고침</button></div>' +
        '<p class="muted small">합계 ' + d.total + '명 · ' + esc(d.services.join(' / ') || '아직 없음') + '</p>' +
        (rows ? '<table class="tbl"><tr><th>목장</th><th>출석</th></tr>' + rows + '</table>' : '<p class="muted">아직 출석한 분이 없어요.</p>') + '</div>';
    } catch (e) {
      box.innerHTML = '<div class="card"><p class="err">현황을 불러오지 못했어요. (' + esc(e.message) + ')</p></div>';
    }
  }

  /* ---------- 목자 앱: 목장 열쇠는 이 폰에만 저장 ---------- */
  function mokjaKeyFrom(text) {
    const t = String(text || '').trim();
    const m = /[?&]k=([A-Za-z0-9]{6,32})/.exec(t);
    if (m) return m[1];
    return /^[A-Za-z0-9]{6,32}$/.test(t) ? t : '';
  }
  function mokjaRegister() {
    const v = prompt('카톡으로 받은 "우리 목장 앱" 링크를 붙여 넣어 주세요.\n(이 폰에만 저장됩니다)');
    if (v == null) return false;
    const k = mokjaKeyFrom(v);
    if (!k) { toast('링크를 다시 확인해 주세요'); return false; }
    store.set('jjc_mokja_key', k); renderStaff(); toast('등록했어요');
    return true;
  }
  function mokjaOpen() {
    let k = store.get('jjc_mokja_key', '');
    if (!k) { if (!mokjaRegister()) return; k = store.get('jjc_mokja_key', ''); }
    const a = findApp('mokja');
    location.href = a.url + '?k=' + encodeURIComponent(k);
  }

  /* ---------- 내 정보 ---------- */
  function renderMe() {
    $('meName').value = profile.name; fillMokjang($('meMokjang'), profile.mokjang); $('mePhone').value = profile.phone4;
    $('famList').innerHTML = family.length
      ? family.map((f, i) => '<li><span>' + esc(f.name) + (f.phone4 ? ' <span class="muted small">(' + esc(f.phone4) + ')</span>' : '') + '</span><button data-del="' + i + '" type="button">삭제</button></li>').join('')
      : '<li class="muted small">아직 없어요</li>';
    $('verLine').textContent = '교인앱 ' + VERSION + (CFG.GAS_URL ? '' : ' · 연습 모드(시트 미연결)');
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    $('installHint').textContent = ios
      ? '아이폰: 사파리 아래 공유 버튼(□↑) → "홈 화면에 추가"를 눌러 주세요.'
      : '안드로이드: 아래 버튼을 누르거나, 크롬 메뉴(⋮) → "홈 화면에 추가"를 눌러 주세요.';
  }

  /* ---------- 출석 보내기 ---------- */
  function me() { return { name: profile.name, mokjang: profile.mokjang, phone4: profile.phone4 }; }
  function buildPayload(people, loc) {
    return { action: 'checkin', name: profile.name, mokjang: profile.mokjang, phone4: profile.phone4, loc,
      companions: people.map(p => ({ name: p.name, mokjang: profile.mokjang, phone4: p.phone4 || '' })), scanTs: new Date().toISOString() };
  }
  // 연습 모드: 시트 없이 이 폰 안에서만 중복 검사
  function demoSend(payload) {
    const log = store.get('jjc_demo', []), now = Date.now(), t = kst(), svc = serviceOf();
    const res = [{ name: payload.name, phone4: payload.phone4, self: true }].concat(payload.companions.map(c => ({ name: c.name, phone4: c.phone4 })))
      .map(p => {
        const dup = log.some(l => l.k === p.name + '|' + p.phone4 && l.d === t.date && l.s === svc && now - l.t < 5 * 60000);
        if (!dup) log.push({ k: p.name + '|' + p.phone4, d: t.date, s: svc, t: now });
        return { name: p.name, status: dup ? 'duplicate' : 'saved' };
      });
    store.set('jjc_demo', log.slice(-100));
    return { ok: true, date: t.date, service: svc, results: res, demo: true };
  }
  async function send(payload) {
    if (!CFG.GAS_URL) return demoSend(payload);
    const r = await fetch(CFG.GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || '서버 오류');
    return d;
  }
  async function doCheckin(people, loc) {
    const payload = buildPayload(people, loc);
    try {
      const d = await send(payload);
      afterSaved(d);
    } catch (e) {
      if (e instanceof TypeError || !navigator.onLine) {      // 인터넷 문제 → 나중에 자동 재전송
        queue.push(payload); store.set('jjc_queue', queue); renderHome();
        toast('인터넷이 안 돼서 보관했어요. 연결되면 자동 전송됩니다.');
        showDone({ date: kst().date, service: serviceOf(), results: [{ name: profile.name, status: 'queued' }].concat(people.map(p => ({ name: p.name, status: 'queued' }))) });
      } else { toast('출석 실패: ' + e.message); }
    }
  }
  function afterSaved(d) {
    const mine = d.results[0];
    if (mine && (mine.status === 'saved' || mine.status === 'duplicate')) {
      last = { date: d.date, service: d.service }; store.set('jjc_last', last);
    }
    renderHome(); showDone(d);
  }
  async function flushQueue() {
    if (!queue.length || !CFG.GAS_URL || !navigator.onLine) return;
    const rest = [];
    for (const p of queue) { try { await send(p); } catch (e) { rest.push(p); } }
    const sent = queue.length - rest.length;
    queue = rest; store.set('jjc_queue', queue);
    if (sent && profile) { renderHome(); toast('보관했던 출석 ' + sent + '건을 전송했어요'); }
  }
  window.addEventListener('online', flushQueue);

  function showDone(d) {
    stopScanner(); $('scanModal').hidden = true; $('confirmModal').hidden = true;
    const allDup = d.results.every(r => r.status === 'duplicate');
    const queued = d.results[0] && d.results[0].status === 'queued';
    $('doneTitle').textContent = queued ? '출석 보관 완료' : allDup ? '이미 출석했어요' : '출석 완료!';
    $('doneSub').textContent = d.date + ' · ' + d.service + (d.demo ? ' (연습 모드: 시트에 저장되지 않음)' : '');
    $('doneList').innerHTML = d.results.map(r => '<li class="' + (r.status === 'duplicate' ? 'dup' : '') + '">' + esc(r.name) +
      (r.status === 'duplicate' ? ' — 이미 출석됨' : r.status === 'queued' ? ' — 전송 대기' : ' ✓') + '</li>').join('');
    $('doneModal').hidden = false;
    if (!allDup) toast(queued ? '출석을 보관했어요' : '출석이 기록되었습니다 🙏');
  }

  /* ---------- QR 스캔 ---------- */
  let scanner = null, scanning = false, tmp = [];
  function companionChecks(container, withTmp) {
    const list = family.concat(withTmp ? tmp : []);
    container.innerHTML = list.map((f, i) => '<label class="ck"><input type="checkbox" data-i="' + i + '"> ' + esc(f.name) + (f.phone4 ? ' <span class="muted small">(' + esc(f.phone4) + ')</span>' : '') + '</label>').join('');
    return list;
  }
  function chosen(container, list) {
    return Array.from(container.querySelectorAll('input:checked')).map(c => list[+c.dataset.i]);
  }
  let scanList = [];
  function openScanner() {
    $('scanModal').hidden = false; tmp = [];
    scanList = companionChecks($('compList'), true);
    $('companions').hidden = !scanList.length;
    $('scanMsg').textContent = '예배실에 붙은 QR을 네모 안에 맞춰 주세요';
    scanner = new Html5Qrcode('reader');
    scanning = true;
    scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 230, height: 230 } }, onScan, () => {})
      .catch(() => {
        scanning = false;
        $('scanMsg').innerHTML = '카메라를 열 수 없어요. 폰 설정에서 카메라 허용을 확인하거나,<br>폰 기본 카메라로 예배실 QR을 찍어 주세요.';
      });
  }
  function stopScanner() {
    if (scanner && scanning) { scanning = false; scanner.stop().then(() => scanner.clear()).catch(() => {}); }
    scanner = null;
  }
  let scanBusy = false;
  function parseQr(text) {
    let loc = null;
    try { const u = new URL(text); if (u.searchParams.get('action') === 'checkin') loc = u.searchParams.get('loc'); }
    catch (e) { const m = /action=checkin&loc=([\w-]+)/.exec(text); if (m) loc = m[1]; }
    return loc && CFG.LOCATIONS[loc] ? loc : null;
  }
  function onScan(text) {
    if (scanBusy) return;
    const loc = parseQr(text);
    if (!loc) { $('scanMsg').textContent = '교회 출석 QR이 아니에요. 예배실 QR을 다시 비춰 주세요.'; return; }
    scanBusy = true;
    const people = chosen($('compList'), scanList);
    doCheckin(people, loc).finally(() => { scanBusy = false; });
  }

  // 폰 기본 카메라로 QR을 찍어 주소로 들어온 경우
  function startUrlCheckin(loc) {
    if (!CFG.LOCATIONS[loc]) loc = 'main_hall';
    if (!family.length) { doCheckin([], loc); return; }       // 동반자 없으면 바로 출석
    $('confirmModal').hidden = false;
    const list = companionChecks($('cfList'), false);
    $('cfGo').onclick = () => { const p = chosen($('cfList'), list); $('confirmModal').hidden = true; doCheckin(p, loc); };
  }

  /* ---------- 이벤트 ---------- */
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; $('btnInstall').hidden = false; });

  function bindEvents() {
    $('obForm').addEventListener('submit', e => {
      e.preventDefault();
      profile = { name: $('obName').value.trim(), mokjang: $('obMokjang').value, phone4: $('obPhone').value.trim() };
      if (!profile.name || !/^\d{4}$/.test(profile.phone4)) { toast('이름과 숫자 4자리를 확인해 주세요'); return; }
      store.set('jjc_profile', profile); showMain();
    });
    $('meForm').addEventListener('submit', e => {
      e.preventDefault();
      const ph = $('mePhone').value.trim();
      if (!/^\d{4}$/.test(ph)) { toast('뒷자리는 숫자 4자리예요'); return; }
      profile = { name: $('meName').value.trim(), mokjang: $('meMokjang').value, phone4: ph };
      store.set('jjc_profile', profile); renderHome(); toast('저장했어요');
      document.querySelector('.tabbar [data-tab="home"]').click();
    });
    $('famForm').addEventListener('submit', e => {
      e.preventDefault();
      family.push({ name: $('famName').value.trim(), phone4: $('famPhone').value.trim() });
      store.set('jjc_family', family); $('famName').value = ''; $('famPhone').value = ''; renderMe();
    });
    $('famList').addEventListener('click', e => {
      const i = e.target.dataset && e.target.dataset.del;
      if (i != null) { family.splice(+i, 1); store.set('jjc_family', family); renderMe(); }
    });
    $('tmpForm').addEventListener('submit', e => {
      e.preventDefault();
      const prev = chosen($('compList'), scanList).map(p => p.name + '|' + (p.phone4 || ''));
      tmp.push({ name: $('tmpName').value.trim(), phone4: $('tmpPhone').value.trim() });
      $('tmpName').value = ''; $('tmpPhone').value = '';
      scanList = companionChecks($('compList'), true); $('companions').hidden = false;
      $('compList').querySelectorAll('input').forEach((c, i) => { const p = scanList[i]; if (prev.includes(p.name + '|' + (p.phone4 || '')) || i === scanList.length - 1) c.checked = true; });
    });
    $('btnReset').addEventListener('click', () => {
      if (!confirm('이 폰에 저장된 내 정보와 가족 목록을 지울까요? (구글 시트의 출석 기록은 그대로입니다)')) return;
      ['jjc_profile', 'jjc_family', 'jjc_last', 'jjc_queue', 'jjc_theme', 'jjc_mokja_key'].forEach(store.del);
      location.replace(location.pathname);
    });
    $('btnInstall').addEventListener('click', async () => {
      if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $('btnInstall').hidden = true;
    });
    $('btnScan').addEventListener('click', openScanner);
    $('themeSeg').addEventListener('click', e => { const b = e.target.closest('[data-theme-set]'); if (b) applyTheme(b.dataset.themeSet); });
    $('btnProfile').addEventListener('click', () => { document.querySelector('.tabbar [data-tab="me"]').click(); $('meName').focus(); });
    $('scanClose').addEventListener('click', () => { stopScanner(); $('scanModal').hidden = true; });
    $('cfClose').addEventListener('click', () => { $('confirmModal').hidden = true; });
    $('doneClose').addEventListener('click', () => { $('doneModal').hidden = true; });
    $('goJubo').addEventListener('click', () => { const a = findApp('jubo'); a && a.url ? openUrl(a.url) : toast('주보 주소가 아직 없어요'); });
    $('goWord').addEventListener('click', () => { const a = findApp('word'); a && a.url ? openUrl(a.url) : toast('말씀 자료실 주소가 아직 없어요'); });

    $('tabScan').addEventListener('click', openScanner);   // 어느 화면에서든 바로 QR 출석
    document.querySelectorAll('.tabbar button[data-tab]').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.tabbar button[data-tab]').forEach(x => x.classList.toggle('on', x === b));
      document.querySelectorAll('.tab').forEach(t => { t.hidden = t.id !== 'tab-' + b.dataset.tab; });
      if (b.dataset.tab === 'staff') renderStaff();
      window.scrollTo(0, 0);
    }));
    $('pinForm').addEventListener('submit', async e => {
      e.preventDefault();
      const pin = $('pinInput').value.trim();
      const h = /^\d{4}$/.test(pin) ? await sha('jjc:' + pin) : '';
      const r = h && h === CFG.PASTOR_PIN_SHA256 ? 'pastor' : h && h === CFG.STAFF_PIN_SHA256 ? 'staff' : '';
      $('pinErr').hidden = !!r;
      if (r) { try { sessionStorage.setItem('jjc_staff', r); sessionStorage.setItem('jjc_pin', pin); } catch (x) {} $('pinInput').value = ''; renderStaff(); }
      else { $('pinInput').value = ''; }
    });
    $('staffBody').addEventListener('click', e => {
      if (e.target.closest('#sumRefresh') || e.target.closest('[data-special="summary"]')) showSummary();
      if (e.target.closest('#btnLock')) { try { sessionStorage.removeItem('jjc_staff'); sessionStorage.removeItem('jjc_pin'); } catch (x) {} renderStaff(); return; }
      const mk = e.target.closest('[data-mokja]');
      if (mk) { if (mk.dataset.mokja === 'set') mokjaRegister(); else mokjaOpen(); }
    });
  }

  init();
})();

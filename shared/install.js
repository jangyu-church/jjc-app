/*
 * 장유중앙교회 앱 공통 — '앱으로 설치해 보세요' 막대와 설치 방법 안내
 * 쓰는 법: 겉 앱 index.html 맨 아래에
 *   <script src="../shared/install.js" data-name="교회 주보" data-icon="icons/icon-192.png" data-color="#D96A30"></script>
 * - data-name : 홈 화면에 생길 아이콘 이름 (안내 문구에 들어감)
 * - data-icon : 막대와 안내 창에 보일 아이콘
 * - data-color: 단추 색
 * 처음 열면 아래쪽에 막대가 뜨고, 크롬은 '설치하기' 한 번으로 설치됩니다.
 * 앱 화면(iframe) 안에서 window.top.postMessage({jjc:'install'},'*') 를 보내면 설치 안내를 다시 엽니다.
 */
(function(){
  var me = document.currentScript || document.querySelector('script[src*="install.js"]');
  var NAME = (me && me.getAttribute('data-name')) || '앱';
  var ICON = (me && me.getAttribute('data-icon')) || 'icons/icon-192.png';
  var COLOR = (me && me.getAttribute('data-color')) || '#D96A30';
  var K_CLOSED = 'jjc_install_closed:' + location.pathname;

  /* ── 모양 ── */
  var css = ''+
  'body.jjc-ib{display:flex;flex-direction:column}'+
  'body.jjc-ib>iframe{flex:1;min-height:0;height:auto!important}'+
  '#jjcBar{flex:none;padding:8px max(10px,env(safe-area-inset-right,0px)) calc(10px + env(safe-area-inset-bottom,0px)) max(10px,env(safe-area-inset-left,0px));background:inherit}'+
  '#jjcBar[hidden],#jjcSheet[hidden],#jjcToast[hidden]{display:none}'+
  '#jjcBar .in{max-width:640px;margin:0 auto;background:#2A2420;color:#FBF4EA;border-radius:16px;padding:10px 8px 10px 11px;display:flex;gap:9px;align-items:center;box-shadow:0 6px 24px rgba(0,0,0,.22);animation:jjcUp .35s ease-out;font-family:"Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif}'+
  '@keyframes jjcUp{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}'+
  '#jjcBar img{width:42px;height:42px;border-radius:10px;flex:none}'+
  '#jjcBar .tx{flex:1;min-width:0;font-size:13.5px;line-height:1.4;opacity:.95}'+
  '#jjcBar .tx b{display:block;font-size:15.5px;letter-spacing:-.02em;word-break:keep-all}'+
  '#jjcBar button{border:0;border-radius:11px;padding:10px 13px;font:inherit;font-weight:800;font-size:16px;cursor:pointer}'+
  '#jjcBar .go{background:'+COLOR+';color:#fff;white-space:nowrap}'+
  '#jjcBar .x{background:transparent;color:inherit;opacity:.7;padding:8px 6px;font-weight:400;font-size:18px;line-height:1}'+
  '#jjcSheet{position:fixed;inset:0;z-index:2147483000;background:rgba(20,10,4,.6);display:flex;align-items:flex-end;justify-content:center;font-family:"Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif}'+
  '#jjcSheet .box{width:100%;max-width:560px;box-sizing:border-box;background:#fff;color:#2A2420;border-radius:20px 20px 0 0;padding:20px 20px calc(20px + env(safe-area-inset-bottom,0px));max-height:88vh;overflow:auto;animation:jjcUp .3s ease-out}'+
  '#jjcSheet .hd{display:flex;gap:12px;align-items:center;margin-bottom:6px}'+
  '#jjcSheet .hd img{width:46px;height:46px;border-radius:12px}'+
  '#jjcSheet h2{margin:0;font-size:20px}'+
  '#jjcSheet p.m{margin:0;color:#6B625B;font-size:15px;line-height:1.55}'+
  '#jjcSheet ol{margin:14px 0;padding:0;list-style:none;counter-reset:st;display:flex;flex-direction:column;gap:12px}'+
  '#jjcSheet li{counter-increment:st;word-break:keep-all;display:grid;grid-template-columns:30px minmax(0,1fr);gap:10px;align-items:start;font-size:16.5px;line-height:1.55}'+
  '#jjcSheet li::before{content:counter(st);width:28px;height:28px;border-radius:50%;background:'+COLOR+';color:#fff;font-weight:800;font-size:14px;display:flex;align-items:center;justify-content:center}'+
  '#jjcSheet li b{color:'+COLOR+'}'+
  '#jjcSheet .btn{display:block;width:100%;box-sizing:border-box;border:0;border-radius:13px;padding:14px;font:inherit;font-size:17px;font-weight:800;cursor:pointer;text-align:center;text-decoration:none;margin-top:8px}'+
  '#jjcSheet .primary{background:'+COLOR+';color:#fff}'+
  '#jjcSheet .ghost{background:#F4ECE3;color:#2A2420}'+
  '#jjcSheet .row{display:flex;gap:8px;margin-top:6px}'+
  '#jjcSheet .row input{flex:1;min-width:0;border:1px solid #E5D7C8;border-radius:10px;padding:10px;font-size:13px;color:#555}'+
  '#jjcSheet .row button{border:0;border-radius:10px;padding:0 14px;background:#F4ECE3;font:inherit;font-weight:700;cursor:pointer}'+
  '#jjcToast{position:fixed;left:50%;bottom:calc(96px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:#2A2420;color:#fff;padding:11px 18px;border-radius:999px;font:15px "Noto Sans KR","Apple SD Gothic Neo",sans-serif;z-index:2147483001;max-width:calc(100vw - 32px);text-align:center}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function el(id){ var e = document.getElementById(id); if (!e){ e = document.createElement('div'); e.id = id; e.hidden = true; document.body.appendChild(e); } return e; }
  var bar = el('jjcBar'), sheet = el('jjcSheet'), toastEl = el('jjcToast');
  function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function lsSet(k,v){ try{ v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); }catch(e){} }
  var tT; function toast(m){ toastEl.textContent = m; toastEl.hidden = false; clearTimeout(tT); tT = setTimeout(function(){ toastEl.hidden = true; }, 3000); }
  function esc(s){ return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  /* ── 설치 방법 ── */
  var deferred = null;
  function isStandalone(){ try{ return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }catch(e){ return false; } }
  function kind(){
    var ua = navigator.userAgent || '';
    if (/KAKAOTALK/i.test(ua)) return 'kakao';
    if (/NAVER\(inapp|Instagram|FBAN|FBAV|; wv\)|Line\/|BAND\//i.test(ua)) return 'inapp';
    if (/iPhone|iPad|iPod/.test(ua)) return /CriOS|FxiOS|EdgiOS|NAVER/.test(ua) ? 'ios-other' : 'ios';
    if (/SamsungBrowser/i.test(ua)) return 'samsung';
    if (/EdgA/i.test(ua)) return 'edge';
    if (/Android/.test(ua)) return 'chrome';
    if (/Windows|Macintosh|Linux|CrOS/.test(ua)){                       // PC
      if (/Edg\//.test(ua)) return 'pc-edge';
      if (/Whale/i.test(ua)) return 'pc-whale';
      if (/Firefox/i.test(ua)) return 'pc-firefox';
      if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium/.test(ua)) return 'pc-safari';
      if (/Chrome|Chromium/.test(ua)) return 'pc-chrome';
    }
    return 'other';
  }
  function guide(){
    var k = kind(), N = '<b>' + esc(NAME) + '</b>';
    if (k === 'kakao') return { t:'먼저 인터넷 앱으로 열어 주세요', s:['지금은 <b>카카오톡 안</b>에서 열려 있어서 설치가 안 돼요.','아래 <b>‘인터넷 앱으로 열기’</b>를 눌러요.','새로 열린 화면 아래쪽에서 <b>‘설치하기’</b>를 다시 눌러요.'], kakao:true, copy:true };
    if (k === 'inapp') return { t:'먼저 인터넷 앱으로 열어 주세요', s:['지금은 다른 앱 안에서 열려 있어서 설치가 안 돼요.','화면 위나 아래의 <b>⋮</b> 또는 <b>⋯</b> 메뉴를 눌러요.','<b>‘다른 브라우저로 열기’</b>를 누른 뒤, 아래쪽 <b>‘설치하기’</b>를 다시 눌러요.'], copy:true };
    if (k === 'ios') return { t:'아이폰에서 설치하기', s:['화면 아래쪽 <b>공유 버튼</b>(네모에서 화살표가 위로 나온 모양)을 눌러요.','메뉴를 위로 올려 <b>‘홈 화면에 추가’</b>를 눌러요.','오른쪽 위 <b>‘추가’</b>를 누르면 ' + N + ' 아이콘이 생겨요.'], tip:'공유 버튼이 안 보이면 아래쪽 <b>⋯</b>을 먼저 누르세요.' };
    if (k === 'ios-other') return { t:'사파리로 열어 주세요', s:['아이폰은 <b>Safari(사파리)</b>에서만 설치할 수 있어요.','아래 주소를 복사해 사파리 주소창에 붙여 넣어요.','사파리에서 공유 버튼 → <b>‘홈 화면에 추가’</b>를 눌러요.'], copy:true };
    if (k === 'samsung') return { t:'삼성 인터넷에서 설치하기', s:['화면 오른쪽 아래 <b>☰</b>(줄 세 개)를 눌러요.','<b>‘현재 페이지 추가’</b>를 누르고 <b>‘홈 화면’</b>을 골라요.','<b>‘추가’</b>를 누르면 ' + N + ' 아이콘이 생겨요.'] };
    if (k === 'edge') return { t:'Edge에서 설치하기', s:['화면 아래 <b>☰</b> 또는 <b>⋯</b> 메뉴를 눌러요.','<b>‘휴대폰에 추가’</b> 또는 <b>‘홈 화면에 추가’</b>를 눌러요.','<b>‘설치’</b>를 누르면 ' + N + ' 아이콘이 생겨요.'] };
    if (k === 'pc-chrome') return { pc:true, t:'컴퓨터에 앱으로 설치하기', s:['오른쪽 위 <b>⋮</b>(점 세 개)를 눌러요.','<b>‘캐스팅, 저장, 공유’</b>에 마우스를 올리고, 옆에 나오는 <b>‘' + esc(NAME) + ' 설치’</b>(또는 ‘페이지를 앱으로 설치’)를 눌러요.','<b>‘설치’</b>를 누르면 바탕화면과 시작 메뉴에 ' + N + ' 아이콘이 생겨요.'], tip:'주소창 오른쪽 끝에 <b>설치 아이콘</b>(모니터에 ↓ 모양)이 보이면 그걸 눌러도 돼요.' };
    if (k === 'pc-edge') return { pc:true, t:'컴퓨터에 앱으로 설치하기', s:['주소창 <b>오른쪽</b>의 <b>‘앱 사용 가능’ 아이콘</b>(네모 칸 모양)을 눌러요.','아이콘이 안 보이면 오른쪽 위 <b>⋯</b> → <b>‘앱’</b> → <b>‘이 사이트를 앱으로 설치’</b>를 눌러요.','<b>‘설치’</b>를 누르면 바탕화면과 시작 메뉴에 ' + N + ' 아이콘이 생겨요.'] };
    if (k === 'pc-whale') return { pc:true, t:'컴퓨터에 앱으로 설치하기', s:['주소창 <b>오른쪽</b>의 <b>설치 아이콘</b>을 눌러요.','아이콘이 안 보이면 오른쪽 위 <b>⋯</b> 메뉴에서 <b>‘앱 설치’</b>를 찾아 눌러요.','<b>‘설치’</b>를 누르면 ' + N + ' 아이콘이 생겨요.'], tip:'잘 안 되면 크롬이나 엣지에서 이 주소를 열어 주세요.', copy:true };
    if (k === 'pc-safari') return { pc:true, t:'맥에 앱으로 설치하기', s:['화면 맨 위 메뉴에서 <b>‘파일’</b>을 눌러요.','<b>‘Dock에 추가’</b>를 눌러요.','<b>‘추가’</b>를 누르면 Dock에 ' + N + ' 아이콘이 생겨요.'] };
    if (k === 'pc-firefox') return { pc:true, t:'크롬이나 엣지로 열어 주세요', s:['파이어폭스는 앱 설치를 지원하지 않아요.','아래 주소를 복사해 <b>크롬</b> 또는 <b>엣지</b> 주소창에 붙여 넣어요.','열린 화면 아래쪽 <b>‘설치하기’</b>를 다시 눌러요.'], copy:true };
    return { t:'홈 화면에 앱 만들기', s:['오른쪽 위 <b>⋮</b>(점 세 개)를 눌러요.','<b>‘앱 설치’</b> 또는 <b>‘홈 화면에 추가’</b>를 눌러요.','<b>‘설치’</b>를 누르면 ' + N + ' 아이콘이 생겨요.'], tip:'그래도 안 되면 삼성 인터넷에서 이 주소를 열고 같은 방법으로 해 보세요.' };
  }
  function closeSheet(){ sheet.hidden = true; sheet.innerHTML = ''; }
  function openSheet(){
    var g = guide(), url = location.href.split('#')[0];
    sheet.innerHTML = '<div class="box" role="dialog" aria-label="' + esc(g.t) + '"><div class="hd"><img src="' + esc(ICON) + '" alt=""><div><h2>' + g.t + '</h2>'+
      '<p class="m">' + (g.pc ? '바탕화면 아이콘을 두 번 누르면 바로 열려요.' : '아이콘을 만들어 두면 다음부터 한 번에 열려요.') + '</p></div></div>'+
      (deferred ? '<button type="button" class="btn primary" data-now>지금 바로 설치하기</button><p class="m" style="margin-top:12px">버튼이 안 되면 아래 방법으로 하세요.</p>' : '')+
      '<ol>' + g.s.map(function(x){ return '<li><span>' + x + '</span></li>'; }).join('') + '</ol>'+
      (g.tip ? '<p class="m">💡 ' + g.tip + '</p>' : '')+
      (g.kakao ? '<a class="btn primary" href="kakaotalk://web/openExternal?url=' + encodeURIComponent(url) + '">인터넷 앱으로 열기</a>' : '')+
      (g.copy ? '<div class="row"><input readonly value="' + esc(url) + '" aria-label="앱 주소"><button type="button" data-cp>주소 복사</button></div>' : '')+
      '<button type="button" class="btn ' + (g.kakao ? 'ghost' : 'primary') + '" data-ok>알겠어요</button></div>';
    sheet.hidden = false;
    sheet.onclick = function(e){ if (e.target === sheet) closeSheet(); };
    sheet.querySelector('[data-ok]').onclick = closeSheet;
    var now = sheet.querySelector('[data-now]');
    if (now) now.onclick = function(){ closeSheet(); doInstall(); };
    var cp = sheet.querySelector('[data-cp]');
    if (cp) cp.onclick = function(){
      var inp = sheet.querySelector('input'); inp.select();
      var done = false; try{ done = document.execCommand('copy'); }catch(e){}
      if (!done && navigator.clipboard) navigator.clipboard.writeText(url).then(function(){ toast('주소를 복사했어요.'); }, function(){ toast('주소를 길게 눌러 복사해 주세요.'); });
      else toast(done ? '주소를 복사했어요.' : '주소를 길게 눌러 복사해 주세요.');
    };
  }
  function doInstall(){
    if (isStandalone()){ toast('이미 앱으로 열려 있어요.'); return; }
    if (deferred){
      var d = deferred; deferred = null;
      try{
        d.prompt();
        d.userChoice.then(function(r){ if (r && r.outcome === 'accepted') toast('설치하는 중이에요. 잠시 뒤 홈 화면을 확인해 보세요.'); render(); });
      }catch(e){ openSheet(); }
      return;
    }
    openSheet();
  }
  function closed(){ var t = +lsGet(K_CLOSED); return !!t && Date.now() - t < 3 * 864e5; }   // 닫으면 3일 동안 쉬어요
  function render(){
    var show = !isStandalone() && !closed();
    document.body.classList.toggle('jjc-ib', show);
    bar.hidden = !show;
    if (!show){ bar.innerHTML = ''; return; }
    if (bar.firstChild) return;
    bar.innerHTML = '<div class="in"><img src="' + esc(ICON) + '" alt=""><div class="tx"><b>앱으로 설치하기</b>한 번에 바로 열려요</div>'+
      '<button class="go" type="button">설치하기</button><button class="x" type="button" aria-label="닫기">✕</button></div>';
    bar.querySelector('.go').onclick = doInstall;
    bar.querySelector('.x').onclick = function(){ lsSet(K_CLOSED, Date.now()); render(); };
  }
  // 크롬은 화면을 조금 써 본 뒤에야 '바로 설치' 신호를 줍니다. 안내 창이 열려 있을 때 신호가 오면 바로 설치 단추를 띄워요.
  window.addEventListener('beforeinstallprompt', function(e){ e.preventDefault(); deferred = e; render(); if (!sheet.hidden) openSheet(); });
  window.addEventListener('appinstalled', function(){ deferred = null; closeSheet(); render(); toast('설치되었어요! 홈 화면의 ‘' + NAME + '’를 눌러 보세요.'); });
  window.addEventListener('message', function(e){
    var d = e.data;
    if (d && (d.jjc === 'install' || d.jubo === 'install')){ lsSet(K_CLOSED, null); render(); doInstall(); }
  });
  window.jjcInstall = { open: doInstall, guide: openSheet };
  render();
})();

/*
 * 장유중앙교회 교인앱 설정 (여기만 고치면 됩니다)
 * - GAS_URL     : 구글 Apps Script 웹앱 배포 주소 (…/exec). 배포 후 여기에 붙여 넣으세요.
 *                 비어 있으면 '연습 모드'로 동작합니다(구글 시트에 저장되지 않음).
 * - STAFF_PIN_SHA256 / PASTOR_PIN_SHA256 : 사역자 PIN, 목회자 PIN의 SHA-256 값(PIN 자체는 적지 않습니다).
 *                 목회자 PIN으로 들어가면 사역자용 앱도 모두 보입니다. 바꾸는 법은 GUIDE.md 3번.
 * - MOKJANGS    : 처음 등록할 때 고르는 소속 목록 (목장 + 교역자)
 * - LOCATIONS   : QR의 loc 값 → 화면에 보일 이름
 */
window.JJC_CONFIG = {
  CHURCH_NAME: "장유중앙교회",
  GREETING_SUNDAY: "오늘도 은혜로운 예배 되세요!",      // 주일에 보이는 인사 멘트 (여기만 고치면 바뀝니다)
  GREETING_WEEKDAY: "오늘도 주님 안에서 평안하세요.",   // 평일·토요일에 보이는 인사 멘트
  GAS_URL: "https://script.google.com/macros/s/AKfycbzm9LqE1AGsBaopu6V5p6WCoZ71lAmhI1rv198XVHU11eBP-QzJxHPxM1C9L2hceGYsUA/exec",
  STAFF_PIN_SHA256: "207464be5b0c08c49a760dc937d8dfaf51d9e6368ef34a9ad580e97cd1a58f0d",
  PASTOR_PIN_SHA256: "45f7e2974982124d00b1e5f06a2732d1e993e0b2875a7dfda572e35d99783db2",
  MOKJANGS: [
    "충성목장", "사랑목장", "소망목장", "감사목장", "은혜목장",
    "향기목장", "평안목장", "청년목장", "VIP목장",
    "교역자"
  ],
  LOCATIONS: {
    main_hall: "은혜홀",
    faith_hall: "믿음홀"
  }
};

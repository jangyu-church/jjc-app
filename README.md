# jjc-app

장유중앙교회 웹앱을 휴대폰 홈 화면에 앱처럼(주소창 없이) 설치하기 위한 겉 앱입니다.

| 폴더 | 앱 | 설치 주소 |
|---|---|---|
| `board/` | 사역 메인 보드 | https://jangyu-church.github.io/jjc-app/board/ |
| `word/` | 말씀 자료실 | https://jangyu-church.github.io/jjc-app/word/ |
| `jubo/` | 모바일 주보 (교인용) | https://jangyu-church.github.io/jjc-app/jubo/ |
| `jubo-edit/` | 주보 제작 (담임목사·부목사·행정간사) | https://jangyu-church.github.io/jjc-app/jubo-edit/ |
| `smart/` | 스마트목회 (교회 일정 공유) | https://jangyu-church.github.io/jjc-app/smart/ |
| `check/` | 목회 일정 점검판 | https://jangyu-church.github.io/jjc-app/check/ |
| `newfamily/` | 새가족 정착 관리 | https://jangyu-church.github.io/jjc-app/newfamily/ |
| `mokjang/` | 목장관리 교역자 화면 (비밀번호) | https://jangyu-church.github.io/jjc-app/mokjang/ |
| `mokja/` | 목자 앱 (목장 관리) | 목장마다 다른 링크: `…/jjc-app/mokja/?k=목장열쇠` (열쇠는 교회에서 따로 전달) |

각 폴더는 실제 앱(구글 앱스 스크립트 웹 앱)을 화면 가득 담아 보여 줍니다. 실제 앱 주소와 자료는 그대로입니다.

`말씀자료실/` 폴더에는 말씀 자료실 앱스 스크립트 원본(Code.gs, Index.html)이 있습니다.


## 홈 화면 설치 막대 (모든 앱 공통)
모든 겉 앱은 `shared/install.js`를 불러, 처음 열면 아래쪽에 ‘앱으로 설치하기’ 막대를 보여 줍니다.
- 안드로이드 크롬: **설치하기** 한 번으로 설치
- 삼성 인터넷·아이폰 사파리·Edge: 기기에 맞는 설치 방법 안내 창
- 카카오톡 안: ‘인터넷 앱으로 열기’ 단추
- ✕를 누르면 3일 동안 쉬고, 이미 설치해서 연 경우에는 나오지 않음
- 앱 화면(iframe) 안에서 `window.top.postMessage({jjc:'install'},'*')`를 보내면 설치 안내를 다시 엽니다.

새 앱을 추가할 때는 다른 폴더를 복사해 `index.html`의 앱 주소·이름·색과 `manifest.webmanifest`, `icons/`만 바꾸면 됩니다.

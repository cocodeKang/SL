# 슐런 훈련 일지 - Firebase + GitHub Pages 버전

이 버전은 Apps Script(Code.gs)를 사용하지 않습니다.

구조:

```text
HTML 앱
 ↓
Firebase Authentication 로그인
 ↓
Firebase Firestore 저장
 ↓
PC/모바일 실시간 동기화
 ↓
CSV 다운로드 → 엑셀/구글시트에서 열기
```

## 1. 파일 구성

```text
sjoelen_firebase_app/
├─ index.html             # 화면 구조
├─ style.css              # PC/모바일 반응형 디자인
├─ app.js                 # 앱 기능, 점수계산, Firestore 저장/조회
├─ firebase-config.js     # Firebase 프로젝트 설정값 입력 파일
├─ firestore.rules        # Firestore 보안 규칙
├─ .gitignore
└─ README.md
```

## 2. Firebase 프로젝트 만들기

1. Firebase Console 접속
2. 프로젝트 만들기
3. 좌측 메뉴에서 Authentication 선택
4. 시작하기 클릭
5. Sign-in method에서 다음 로그인 방식을 사용 설정
   - Google: PC/모바일 동기화용으로 권장
   - Anonymous: 테스트 또는 이 기기만 사용용
6. 좌측 메뉴에서 Firestore Database 선택
7. 데이터베이스 만들기
8. 위치 선택 후 시작

## 3. Firebase Web 앱 등록

1. Firebase 프로젝트 설정으로 이동
2. 일반 탭에서 `</>` 웹 앱 추가
3. 앱 이름 예: `sjoelen-diary-web`
4. SDK 설정 및 구성에서 `firebaseConfig` 값을 복사
5. 이 프로젝트의 `firebase-config.js` 파일에 붙여넣기

예시:

```js
export const firebaseConfig = {
  apiKey: "...",
  authDomain: "...firebaseapp.com",
  projectId: "...",
  storageBucket: "...appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
```

## 4. Firestore 보안 규칙 적용

Firebase Console → Firestore Database → 규칙 탭에 들어가서 `firestore.rules` 내용을 붙여넣고 게시합니다.

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

이 규칙은 로그인한 사용자가 자기 UID 아래 데이터만 읽고 쓰도록 제한합니다.

## 5. GitHub에 업로드

1. GitHub에서 새 저장소 생성
   - 예: `sjoelen-diary`
2. 이 폴더 안 파일 전체를 저장소 루트에 업로드
3. `firebase-config.js`에 본인 Firebase 설정값이 들어갔는지 확인
4. Commit

## 6. GitHub Pages 켜기

1. GitHub 저장소 → Settings
2. Pages 메뉴
3. Build and deployment
4. Source: Deploy from a branch
5. Branch: `main`
6. Folder: `/root`
7. Save
8. 잠시 후 다음 형태의 주소가 생성됩니다.

```text
https://깃허브아이디.github.io/sjoelen-diary/
```

## 7. Firebase Authentication 승인 도메인 추가

GitHub Pages 주소에서 Google 로그인을 쓰려면 Firebase 승인 도메인에 GitHub Pages 도메인을 추가해야 합니다.

1. Firebase Console → Authentication → Settings
2. Authorized domains
3. 도메인 추가
4. 예: `깃허브아이디.github.io`

## 8. 사용 방법

### PC/모바일 동기화

PC와 모바일에서 같은 Google 계정으로 로그인하면 같은 Firestore UID를 사용하므로 기록이 동기화됩니다.

### 이 기기만 사용

`이 기기만` 버튼은 익명 로그인입니다.
브라우저 또는 기기를 바꾸면 다른 UID가 될 수 있으므로 장기 기록에는 Google 로그인을 권장합니다.

### CSV/엑셀/구글시트 내보내기

앱의 홈 화면에서 `CSV 내보내기`를 누르면 CSV 파일이 다운로드됩니다.

- 엑셀: CSV 파일을 바로 열기
- 구글시트: 파일 → 가져오기 → 업로드 → CSV 선택

## 9. 데이터 저장 구조

Firestore에는 아래 구조로 저장됩니다.

```text
users/{uid}/sessions/{sessionId}
users/{uid}/reflections/{reflectionId}
users/{uid}/updates/{updateId}
```

### sessions 예시

```js
{
  kind: "score", // score | target | focus
  date: "2026-05-29",
  player: "강대희",
  gateTotals: { 1: 3, 2: 8, 3: 9, 4: 6 },
  calculated: {
    score: 100,
    sets: 3,
    totalIn: 26,
    successRate: 87,
    weakGate: 1,
    balance: 6
  },
  reflection: {
    good: "손목을 고정했을 때 안정적이었다.",
    improve: "오른쪽 이탈이 많았다.",
    question: "시선을 어디에 두면 좋을까?"
  }
}
```

## 10. 다음 확장 추천

1. 선수별 프로필 관리
2. 관문별 월간 성장 그래프
3. 30개 퍽 세부 추적판
4. 훈련 루틴 체크리스트 자동 추천
5. 대회 점수표 모드
6. 구글시트 직접 연동용 Cloud Function 또는 Apps Script 보조 내보내기

현재 버전은 `Code.gs`를 완전히 빼고도 훈련 기록과 동기화가 가능하도록 구성했습니다.

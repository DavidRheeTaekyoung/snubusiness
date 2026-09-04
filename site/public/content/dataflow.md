## 1. 전체 데이터 흐름 (Level 0)

```mermaid
flowchart LR
  V((방문자 · 동문)) -->|열람| PUB[공개 사이트<br/>/ /about /news /events<br/>/members /giving /media]
  PUB -->|fetch| JSON[(/data/*.json)]
  O((작업대 주인)) -->|질문 · 요청| DISC[개발자토론<br/>/admin/discussion]
  DISC -->|POST /api/discussions| API[Pages Functions]
  API -->|INSERT/SELECT| D1[(D1 · threads · messages)]
  AG((에이전트 Claude)) -->|GET /api/discussions?status=open| API
  AG -->|답변 · 반영 커밋| GH[(GitHub main)]
  GH -->|자동 배포| PUB
  GH -->|자동 배포| API
  AG -->|점검 결과 기록| INS[(inspections.json)]
  AG -->|이력 기록| LOG[(history.json)]
  INS -->|판단 필요| DISC
  O -->|열람| WB[작업대 문서<br/>리서치 · 개요 · 데이터 · 흐름]
  WB -->|fetch| MD[(/content/*.md)]
```

## 2. 개발자토론 — 질의 → 반영 시퀀스

```mermaid
sequenceDiagram
  autonumber
  participant O as 작업대 주인
  participant UI as /admin/discussion
  participant API as /api/discussions
  participant DB as D1
  participant AG as 에이전트
  participant GH as GitHub → Pages
  O->>UI: 제목 · 내용 작성, 등록
  UI->>API: POST {title, author, body}
  API->>DB: INSERT threads, messages
  API-->>UI: 201 {thread}
  Note over AG: 다음 세션 시작
  AG->>API: GET /api/discussions?status=open
  API->>DB: SELECT threads + messages
  API-->>AG: {threads[]}
  AG->>AG: 요청 분석 · 코드 수정 · 점검
  AG->>API: POST /api/discussions/:id {role:agent, body:답변}
  AG->>GH: commit "discuss: #id 반영" + history.json 갱신
  GH-->>UI: 배포 완료 (답변 · 이력 표시)
  O->>UI: 확인 후 상태 resolved
  UI->>API: PATCH {status:resolved}
```

## 3. 자율점검 — 페르소나 순환

```mermaid
flowchart TB
  D[배포 완료] --> R[점검 실행<br/>페르소나 7인 × 시나리오]
  R --> F{발견 항목}
  F -->|P3 사소 · 즉시 수정 가능| FX[코드 수정]
  FX --> L[개발이력 기록 fix]
  FX --> RE[재배포]
  F -->|P1·P2 또는 판단 필요| ES[개발자토론에 issue 스레드 생성<br/>role: persona]
  ES --> W[작업대 주인 판단]
  W -->|승인| FX
  W -->|보류| H[wontfix · hold 기록]
  F -->|문제 없음| OK[pass 기록]
  L --> I[(inspections.json 갱신)]
  OK --> I
  H --> I
```

## 4. 콘텐츠 흐름 (P1 → P2)

```mermaid
flowchart LR
  subgraph P1 · 파일
    E1[에이전트가 JSON 편집] --> C1[git commit] --> B1[Pages 배포] --> S1[사이트 fetch /data/*.json]
  end
  subgraph P2 · CMS
    E2[사무국이 작업대 편집 화면 입력] --> A2[POST /api/posts] --> D2[(D1 posts · events)] --> S2[사이트 fetch /api/posts]
  end
  P1 -. 이관 스크립트 .-> P2
```

## 5. 회원 인증 흐름 (P3 설계안)

```mermaid
sequenceDiagram
  participant M as 동문
  participant S as 사이트
  participant API as Functions
  participant DB as D1
  participant ST as 사무국
  M->>S: 가입 신청 (이름 · 학번 · 이메일 · 졸업연도)
  S->>API: POST /api/members/apply
  API->>DB: INSERT members(verified=0)
  API-->>ST: 검수 알림 (이메일)
  ST->>API: 졸업생 명부 대조 후 승인
  API->>DB: UPDATE verified=1
  API-->>M: 매직링크 이메일
  M->>S: 링크 클릭 → 세션 쿠키
  S->>API: GET /api/members/search (세션 필요)
  API->>DB: SELECT visibility IN (public, members)
```

## 6. 배포 파이프라인

```mermaid
flowchart LR
  L[로컬 작업대<br/>OneDrive/경영대총동문회/site] -->|git push main| G[GitHub]
  G -->|webhook| CFB[Cloudflare Pages Build<br/>빌드 없음 · /public 그대로]
  CFB --> PR[프로덕션<br/>snubusiness.com]
  G -->|PR 브랜치| PV[프리뷰 URL<br/>*.snubusiness.pages.dev]
  PR --> HC[/api/health 확인/]
  HC --> INSP[자율점검]
```

## 7. 데이터 보관 · 백업
| 데이터 | 위치 | 백업 | 보관 |
|---|---|---|---|
| 소스 · JSON · MD | GitHub | git 이력 자체 | 영구 |
| D1 (토론, P2~ 콘텐츠) | Cloudflare | Time Travel(30일) + 주기 export(P6) | 영구 |
| 회원 개인정보 (P3) | D1 (암호화 필드) | 주기 export → 암호화 보관 | 탈퇴 후 즉시 삭제 |
| 사진 | Cloudflare R2 또는 Images (P2) | 원본 별도 보관 | 영구 |

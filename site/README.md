# snubusiness.com — 서울대학교 경영대학 총동문회

정적 HTML/CSS/JS + Cloudflare Pages Functions + D1. 빌드 도구 없음.

```
site/
  public/          ← Pages 배포 루트 (Build output directory: site/public)
    index.html     홈
    about/ news/ events/ members/ giving/ media/ login/   공개 페이지
    admin/         작업대(관리자): research, overview, data, dataflow, discussion, inspection, history
    data/*.json    콘텐츠 데이터 (P1)
    content/*.md   작업대 문서
    assets/        css, js, img
  functions/       Pages Functions (/api/*)
```

## 배포
- GitHub `main` → Cloudflare Pages 자동 배포. Root directory `site`, Build command 없음, Build output directory `public`. Functions는 `site/functions`에서 자동 인식.
- D1 바인딩: 변수명 `DB`, 데이터베이스 `snubusiness-db`.
- 선택: 환경변수 `AGENT_KEY` — 설정 시 `X-Agent-Key` 헤더로 role=agent 메시지 허용.

## 로컬 미리보기
```
cd site && npx wrangler pages dev public --d1 DB=snubusiness-db --local
```
(정적만 볼 때: `npx serve public`)

## 운영 규칙
작업대 `/admin/overview/` 의 마스터 개발계획이 최상위 기준. 모든 변경은 `/admin/history/`(data/history.json)에 기록.

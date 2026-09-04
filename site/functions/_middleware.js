// 정식 도메인으로 통일: snu.artus.kr · www.snubusiness.com · *.pages.dev → https://snubusiness.com
const CANON = 'snubusiness.com';
export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (url.hostname !== CANON && !url.hostname.startsWith('127.') && url.hostname !== 'localhost') {
    // 프리뷰 배포(해시.snubusiness.pages.dev)는 그대로 두고, 검토용·www만 리디렉션
    if (url.hostname === 'snu.artus.kr' || url.hostname === 'www.' + CANON || url.hostname === 'snubusiness.pages.dev') {
      url.hostname = CANON; return Response.redirect(url.toString(), 301);
    }
  }
  return next();
}

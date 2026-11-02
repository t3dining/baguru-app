/* =====================================================================
 *  サービスワーカー（2026-11-02 ko-dai さんの報告：Android でホーム画面に追加すると、アイコンに Chrome のマークが付く）
 *  Chrome は、fetch を受けるサービスワーカーがないと「インストールしますか」（beforeinstallprompt）を出さない。
 *  出ないと、メニューからの追加がショートカット（Chrome のマーク付き）になりやすい。js/install.js で登録する。
 *  ★何も保存しない（いつも新しいファイルを読む。公開した直しがすぐ届くように）。
 *    公式アプリの画面（index.html・takeout.html）を開くときだけ受けて、電波がないときに一言出す。
 *    同じ場所に公開している Order受付 などの画面や、受け口・写真の読み込みには手を出さない
 * ===================================================================== */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

const BASE = new URL(self.registration.scope).pathname;
const PAGES = [BASE, BASE + 'index.html', BASE + 'takeout.html'];

const OFFLINE = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>炭焼ハンバーグ バグる</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box;background:#faf6f0;color:#221c18;font-family:'Hiragino Sans',sans-serif;text-align:center">
<div><p style="font-size:18px;font-weight:700;margin:0 0 8px">電波がつながっていません</p><p style="margin:0 0 20px;color:#675d55">電波の良いところで、もう一度開いてください。</p>
<button onclick="location.reload()" style="padding:12px 28px;border:0;border-radius:999px;background:#c7361d;color:#fff;font-size:16px;font-weight:700">開き直す</button></div></body></html>`;

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.mode !== 'navigate' || !PAGES.includes(new URL(r.url).pathname)) return;
  e.respondWith(fetch(r).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});

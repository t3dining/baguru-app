/* =====================================================================
 *  バグる Owner から開いたとき（?from=owner、またはこのタブの sessionStorage の bg.fromOwner）だけ、最初にすること。
 *  index.html と takeout.html の <head> で、ほかの js より先に読む。
 *  ・テスト用アカウントの印 window.OWNER_TEST（js/db.js が保存の箱を bgtest. に替える。マネージの「アプリで見る」の中では付けない）
 *  ・viewport-fit=cover を外す（2026-11-01。予約ボードと同じ）。iPhone のホーム画面のアプリで別のページへ移ると、cover のままでは、
 *    使える高さが時計の帯のぶん短いのに上の端が時計の下にもぐり、下にすき間ができて全体が上に寄る。ホーム画面から直接開くときは、今までのまま
 *  ★2026-11-05 に、2つの画面の中に書いていたスクリプトをこのファイルに移した（CSP で、中に書いたスクリプトを許さないため。計画書 `お店用アプリの引っ越し.md`）
 * ===================================================================== */
(function () {
  var owner = /[?&]from=owner\b/.test(location.search);
  try { owner = owner || sessionStorage.getItem('bg.fromOwner') === '1'; } catch (e) {}
  if (!owner) return;
  window.OWNER_TEST = !(window.parent !== window && /[?&]preview\b/.test(location.search));
  var v = document.querySelector('meta[name="viewport"]');
  if (v) v.setAttribute('content', v.getAttribute('content').replace(/,\s*viewport-fit=cover/, ''));
  addEventListener('pageshow', function (e) { if (!e.persisted) scrollTo(0, 0); });   // 切り替えたときのずれが残らないように
})();

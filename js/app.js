/* =====================================================================
 *  お客さまの画面
 *  #home ホーム ／ #menu 注文 ／ #cart カート ／ #checkout 受け取りとお名前
 *  #request 配達・大量注文の申請 ／ #order/ID 注文の様子 ／ #stamp スタンプ ／ #shop お店 ／ #me マイページ
 *  ★takeout.html（ホームページの「モバイルオーダーで注文」から開く）は、注文に要る画面だけ（ORDER_ONLY）
 *    メニュー・カート・受け取りとお名前・配達と大量注文の申請・注文の様子。ほかの画面はメニューに戻す
 * ===================================================================== */

const ORDER_ONLY = !!window.ORDER_ONLY;

/* ★お店用アプリの引っ越し（計画書 `お店用アプリの引っ越し.md` の段階2の5）：お店用のアプリは t3dining-store.github.io に引っ越した。
 *  この場所（t3dining.github.io）は、前のお店用のアプリと保存場所が同じなので、前のお店のアプリが残したお店の保存（合言葉など）を、開いたときに消す
 *  （お店の画面を開かない端末にも残さないため）。名前は計画書の「古い場所で消すもの」の表と同じ。
 *  ★bg. で始まる名前はお客様の会員・スタンプにも使っているので、まとめて消さない。表の名前だけを1つずつ消す。
 *  ★消すのは引っ越しの日から（SHOP.storeMoved。道具/公開する.py の MOVED で、公開するときだけ true になる）。前の場所の公開先でだけ消す */
const OLD_STORE_KEYS = ['baguru.daicho.pin', 'baguru.daicho.seen', 'baguru.daicho.sound', 'baguru.daicho.shell',   // shell には今日の予約の控え（お客様のお名前）
  'baguru.line.screen', 'bg.hpAdmin', 'baguru.yoyaku.owner', 'baguru.yoyaku.view', 'bg.cookRung', 'bg.hub', 'bg.owner'];
function clearOldStore() {
  [() => localStorage, () => sessionStorage].forEach(box => {
    try { const b = box(); OLD_STORE_KEYS.forEach(k => b.removeItem(k)); } catch (e) { /* 保存が使えない端末 */ }
  });
}
if (SHOP.storeMoved && location.hostname === 't3dining.github.io') clearOldStore();
const ORDER_ROUTES = ['menu', 'cart', 'checkout', 'request', 'order'];

const view = $('#view');
const sheet = $('#sheet');
const sheetBody = $('.sheet-body', sheet);

const ME = ensureMember();
const myOrders = () => getOrders().filter(o => o.member === ME.no);
const statusMap = () => Object.fromEntries(myOrders().map(o => [o.id, o.status]));

// カートは、マネージの中身を重ねたあと（下の applyContent のあと）で fixCart が確かめる。
// ★先に確かめると、マネージで足した商品がまだ ITEM_BY_ID に無く、カートから消えてしまう（Codex の指摘 2026-11-05）
let cart = DB.get('cart', []);
/** カートの行を、いまのメニューに合わせる。選ぶ項目が変わる前に入れたもの（いまの決まりでは選び終わっていないもの）と、
 *  無くなった商品（マネージで消したもの）は取りのぞく。個数の欄（追加カラアゲなど）が上限（g.max）を超えていたら、上限にそろえる
 *  （2026-11-04 に追加カラアゲを10個まで→3個までにしたとき、前のカートの4個以上を残さないため）。変えたら保存して true */
function fixCart() {
  const next = cart.filter(c => ITEM_BY_ID[c.itemId] && !priceOf(ITEM_BY_ID[c.itemId], c.sel || {}).missing).map(clampCounts);
  const changed = JSON.stringify(next) !== JSON.stringify(cart);
  cart = next;
  if (changed) saveCart();
  return changed;
}
function clampCounts(c) {
  (ITEM_BY_ID[c.itemId].groups || []).forEach(g => { if (g.type === 'count' && typeof c.sel?.[g.id] === 'number' && c.sel[g.id] > g.max) c.sel = { ...c.sel, [g.id]: g.max }; });
  return c;
}
let pick = { mode: 'asap', day: 0, slot: null };   // 受け取り方（asap＝できしだい／time＝時間を指定）と日・時間。cutlery はお箸・スプーンの有無（選ぶまで無い）
let justOrdered = null;                  // 注文した直後の「ありがとうございます」を出すため
let lastStatus = statusMap();            // 注文の様子が変わったら知らせるため
let lastStampTotal = getStamps().total;
// スタンプカードで最後に見せたマスの数。新しく押されたマスだけ、押す動きを出す（下から出る画面を閉じてから）
let stampSeen = stampOnCard(lastStampTotal);
let onSheetClosed = null;                // 下から出る画面を閉じたあとにすること（スタンプの演出のあと、カードを描き直す）

function ensureMember() {
  let m = DB.get('member', null);
  if (!m) {
    const r = () => Math.floor(1000 + Math.random() * 9000);
    m = { no: `B-${r()}-${r()}`, name: '', tel: '', since: new Date().toISOString() };
    DB.set('member', m);
  }
  return m;
}

const saveCart = () => DB.set('cart', cart);

/* ---------------------------------------------------------------------
 *  画面の切り替え
 * --------------------------------------------------------------------- */

const ROUTES = {
  home: viewHome, menu: viewMenu, cart: viewCart, checkout: viewCheckout, request: viewRequest,
  order: viewOrder, stamp: viewStamp, shop: viewShop, me: viewMe, reserve: viewReserve, privacy: viewPrivacy, join: viewJoin, install: viewInstallGate, test: viewTestGate,
  recruit: viewRecruit,
};
// 入力の途中で消えないよう、ほかのタブの書き換えでは描き直さない画面
const NO_LIVE = ['checkout', 'request', 'me', 'reserve', 'join', 'test', 'recruit'];

// ★会員登録をしていない人には、登録の画面だけを出す（2026-11-02 ko-dai さんの指示）。アプリのどの画面も、予約も注文も、登録のあと。
// マネージの「アプリで見る」では止めない。受け口では止めていない（ホームページのネット予約が同じ口を使うため）
const needJoin = () => MEMBER_PLUS && !PREVIEW && !ME.registeredAt;
// バグる Owner から開いたとき、テスト用アカウントがまだ無ければ、作る画面だけを出す（スタンプ台帳の決めごと.md の15節）
// ★Owner に預けた鍵を待つあいだ・その鍵で台帳を読み直すあいだ（ownerKeepWait。下の「テスト用アカウントの鍵を、Owner にも預ける」）も、この画面（「読み込んでいます…」）にする。
//   鍵が入ってから台帳の答えが来るまでのあいだに描き直すと、まだ登録の印が無いので、会員登録の画面が出てしまうため（2026-11-06 ko-dai さんの報告「数秒会員登録画面になる」）
let ownerKeepWait = false;
const needTest = () => TEST_MEMBER && (!memberAuth() || ownerKeepWait);
const routeName = () => (needInstall() ? 'install' : needTest() ? 'test' : needJoin() ? 'join' : location.hash.replace(/^#/, '').split('/')[0] || (ORDER_ONLY ? 'menu' : 'home'));

function render(keepScroll = false) {
  let [name, arg] = needInstall() ? ['install', ''] : needTest() ? ['test', ''] : needJoin() ? ['join', ''] : location.hash.replace(/^#/, '').split('/');
  if (name === 'install' && !needInstall()) name = '';
  if (name === 'test' && !needTest()) name = '';
  if (name === 'join' && !needJoin() && !PREVIEW) name = '';   // 登録が済んだら、開こうとしていた画面へ
  // 注文だけの画面は、注文の画面だけ。登録とテスト用アカウントの入口（バグる Owner から開いたとき。2026-11-04）は、そのまま出す
  if (ORDER_ONLY && !needJoin() && !needTest() && !ORDER_ROUTES.includes(name)) { history.replaceState(null, '', '#menu'); name = 'menu'; arg = ''; }
  document.body.classList.toggle('joining', needInstall() || needTest() || needJoin());   // 下のタブとカートを隠す（app.css）
  const v = (ROUTES[name] || viewHome)(arg && decodeURIComponent(arg));
  if (!v) return;
  const y = window.scrollY;
  $('#title').innerHTML = v.title ? `<span>${esc(v.title)}</span>` : `<img src="img/logo.png" alt=""><span>${esc(SHOP.fullName)}</span>`;
  $('#back').hidden = !v.back;
  $('#back').dataset.to = v.back || '';
  view.innerHTML = v.html;
  // 画面を移ったときだけ、上から順にふわっと出す（1分ごとなどの描き直しでは動かさない。app.css の「装飾と動き」）
  view.classList.remove('enter');
  if (!keepScroll) { void view.offsetWidth; view.classList.add('enter'); }
  v.after?.();   // 描いたあとに動かすもの（ネット予約の空き状況・演出）
  fitAll(view);
  if (!keepScroll && view.querySelector('a[href="#reserve"]')) availAhead();   // ネット予約へのリンクがある画面では、空き状況を裏で先に読む（reserve.js）
  if (!keepScroll) FX.reveal(view);   // スクロールで順に出す（js/fx.js。1分ごとの描き直しでは動かさない）
  view.dataset.route = name || 'home';     // ヨコ画面のとき、メニューだけ横に広げる（app.css の最後）
  $$('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === v.tab));
  $('#meBtn')?.classList.toggle('on', v.tab === 'me');   // 右上のマイページ（2026-11-04）
  drawCart();
  window.scrollTo(0, keepScroll ? y : 0);
}

/* 1行に収める字（.fit-1。お知らせのタイトル。2026-11-04 ko-dai さんの指示：「タイトルが日付の下に来るように、1行で収まるように」）
 *  はみ出すときだけ、字を小さくして1行に収める（FIT_MIN まで。それより長いときは、終わりを … にする。app.css の .fit-1）。
 *  字が後から変わるとき（バグるマネージで直した文に置きかえたとき・字の形を読み終えたとき・画面の幅が変わったとき）も、測り直す */
const FIT_MIN = 12;
function fitOne(el) {
  el.style.fontSize = '';
  const max = parseFloat(getComputedStyle(el).fontSize);
  if (!el.clientWidth || el.scrollWidth <= el.clientWidth + 0.5) return;
  let size = Math.max(FIT_MIN, Math.floor(max * el.clientWidth / el.scrollWidth * 4) / 4);
  el.style.fontSize = size + 'px';
  while (el.scrollWidth > el.clientWidth + 0.5 && size > FIT_MIN) { size = Math.max(FIT_MIN, size - 0.25); el.style.fontSize = size + 'px'; }
}
const fitAll = (root = document) => root.querySelectorAll('.fit-1').forEach(fitOne);
let fitQueued = false;
const fitSoon = () => { if (fitQueued) return; fitQueued = true; setTimeout(() => { fitQueued = false; fitAll(); }, 30); };
addEventListener('resize', fitSoon);
document.fonts?.ready.then(fitSoon);
document.fonts?.addEventListener?.('loadingdone', fitSoon);
// 字が置きかわったら（マネージの文章・画面で直す）。大きさを変えるのは style なので、ここには引っかからない
new MutationObserver(list => { if (list.some(m => (m.target.nodeType === 1 ? m.target : m.target.parentElement)?.closest?.('.fit-1'))) fitSoon(); })
  .observe(document.documentElement, { childList: true, subtree: true, characterData: true });

let cartCount = null;
let cartShown = 0;
function drawCart() {
  const n = cart.reduce((s, c) => s + c.qty, 0);
  const badge = $('#cartBtn .badge');
  badge.hidden = !n;
  badge.textContent = n;
  if (cartCount !== null && n > cartCount) { badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump'); }
  cartCount = n;
  const bar = $('#cartbar');
  bar.hidden = !(n && routeName() === 'menu' && !/^#menu\/dine/.test(location.hash));   // 店内のメニューでは出さない
  const total = cartTotal();
  if (!bar.hidden) {
    bar.innerHTML = `<span>${ICON.cart}カートを見る<small>${n}点</small></span><b>${yen(cartShown)}</b>`;
    FX.count($('b', bar), cartShown, total, 450, yen);   // 合計は、増えるところを見せる
  }
  cartShown = total;
}

/** カートの1行が、売り切れ・出さないもの（バグるマネージで止めたもの）か。商品か、選んだものの1つでも売り切れなら true */
function lineOut(c) {
  const item = ITEM_BY_ID[c.itemId];
  if (!item || item.hidden || item.soldOut) return true;
  return (item.groups || []).some(g => {
    const v = c.sel[g.id];
    if (g.type === 'one') return typeof v === 'number' && !!g.choices[v]?.soldOut;
    if (g.type === 'many') return Array.isArray(v) && v.some(i => g.choices[i]?.soldOut);
    return g.type === 'count' && v > 0 && !!g.choices[0].soldOut;
  });
}
const cartOut = () => cart.filter(lineOut);

/** お店からの一言（バグるマネージで書いたもの。js/content.js の APP_NOTICE）。ホームとメニューのいちばん上に出す */
const noticeHtml = () => APP_NOTICE
  ? `<p class="notice shop-notice">${ICON.gift}<span><b>お店からのお知らせ</b><small>${esc(APP_NOTICE.text)}</small></span></p>` : '';

function cartLine(c) {
  const item = ITEM_BY_ID[c.itemId];
  const p = priceOf(item, c.sel);
  return { key: c.key, item, name: item.full || item.name, qty: c.qty, unit: p.unit, opts: p.opts };
}
const cartTotal = () => cart.map(cartLine).reduce((s, l) => s + l.unit * l.qty, 0);
const cartMeals = () => mealCount(cart);

const photo = (i, cls = 'thumb') => i.img
  ? `<img class="${cls}${i.cut ? ' cut' : ''}" src="${esc(photoSrc(i.img))}" alt="" loading="lazy">`
  : `<span class="${cls} noimg"><img src="img/logo.png" alt=""></span>`;

function linesHtml(lines, total) {
  return `<div class="summary">${lines.map(l => `
      <div><span>${esc(l.name)} <i>×${l.qty}</i>${l.opts.length ? `<small>${esc(l.opts.join(' / '))}</small>` : ''}</span><b>${yen(l.unit * l.qty)}</b></div>`).join('')}
      <div class="sum"><span>合計（税込）</span><b>${yen(total)}</b></div>
    </div>`;
}

/* ---------------------------------------------------------------------
 *  ホーム
 * --------------------------------------------------------------------- */

function viewHome() {
  const st = shopState();
  const active = myOrders().filter(o => ACTIVE.includes(o.status));
  const s = getStamps();
  const coupons = s.coupons.filter(c => !c.usedAt).length;
  return {
    tab: 'home',
    html: `
      <section class="hero">
        <img src="${esc(SHOP.hero)}" alt="">
        <div class="hero-in">
          <img class="hero-logo" src="img/logo.png" alt="">
          <div><p class="hero-en">CHARCOAL GRILLED HAMBURG</p><p class="hero-catch">${esc(SHOP.catch)}</p><p class="hero-name">${esc(SHOP.name)}</p></div>
        </div>
      </section>
      ${stateHtml(st)}
      ${noticeHtml()}
      ${active.map(orderBanner).join('')}
      ${rsvBanners()}
      <div class="quick">
        <a class="quick-btn q-order" href="#menu">${ICON.bag}<b>テイクアウト注文</b><small>今から注文・時間指定</small></a>
        <a class="quick-btn q-stamp" href="#stamp">${ICON.card}<b>スタンプカード</b><small>${ME.registeredAt ? `<em>${stampOnCard(s.total)}</em> / ${STAMP.goal}${coupons ? `・特典${coupons}枚` : ''}` : '登録で1ポイント＋アイス'}</small></a>
      </div>
      ${callBtn()}
      <a class="link-card" href="#reserve">${ICON.cal}<span><b>ネット予約（席のご予約）</b><small>空いている日と時間を選んで、リクエストを送れます。お店が確かめて、確定をメールとアプリでお知らせします</small></span></a>
      <a class="link-card" href="#shop">${ICON.pin}<span><b>お店の情報</b><small>住所・アクセス・営業時間・営業日カレンダー・駐車場・お支払い</small></span></a>
      ${recruitCard()}
      <a class="link-card req-card" href="#request">${ICON.truck}<span><b>配達・大量注文の申請</b><small>配達は${TAKEOUT.deliveryFreeMin}食以上で無料（原則${TAKEOUT.deliveryKm}km圏内）・${TAKEOUT.deliveryFreeMin}食未満は要相談。大量注文は${TAKEOUT.bulkMin}食以上。お店が確認してから確定します</small></span><i class="req-go" aria-hidden="true">›</i></a>   <!-- 目立つ形（.req-card。2026-11-06 ko-dai さんの指示「もう少し目立たせて」） -->
      ${installCard()}
      <h2 class="sec" data-en="NEWS">お知らせ</h2>
      <ul class="news">${NEWS.map((n, i) => `
        <li data-news="${i}"><time>${n.date.slice(5).replace('-', '/')}</time><b class="fit-1" data-nf="title">${esc(n.title)}</b><p data-nf="body">${esc(n.body)}</p></li>`).join('')}
      </ul>
      <a class="link-card" href="${SHOP.instagram}" target="_blank" rel="noopener">${ICON.insta}<span><b>最新情報は Instagram で</b><small>@baguru.hamburg</small></span></a>
      <footer class="home-foot">
        <img src="img/logo.png" alt="">
        <p class="hf-catch">${esc(SHOP.catch)}</p>
        <p class="hf-name">${esc(SHOP.name)}</p>
        <p class="hf-en">CHARCOAL GRILLED HAMBURG</p>
      </footer>`,
    after: () => { FX.embers($('.hero')); FX.embers($('.home-foot'), 8); },
  };
}

function stateHtml(st) {
  return `<div class="state state-${st.state}"><i></i>${esc(st.text)}</div>`;
}

/** ワンタップでお店に電話するボタン */
const callBtn = () => `<a class="btn btn-call btn-block" href="tel:${SHOP.tel.replace(/-/g, '')}">${ICON.phone}お店に電話する<small>${esc(SHOP.tel)}</small></a>`;

function orderBanner(o) {
  const t = new Date(o.pickupAt);
  return `<a class="obanner ob-${o.status}" href="#order/${o.id}">
      <span class="ob-st">${statusLabel(o)}</span>
      <span class="ob-main"><b>${isRequest(o) ? `${KIND[o.kind]}の申請 ` : '注文番号 '}${o.no}</b><small>${dayLabel(t)} ${hhmm(t)}${o.asap ? '頃' : ''} ${whenWord(o)}${o.status === 'request' ? '（希望）' : untilText(o.pickupAt) ? `・${untilText(o.pickupAt)}` : ''}</small>${o.movedFrom ? `<em class="ob-moved">${whenWord(o)}の時間が変わりました</em>` : ''}</span>
      <span class="ob-go">›</span>
    </a>`;
}

/* ---------------------------------------------------------------------
 *  メニュー（テイクアウト注文）
 * --------------------------------------------------------------------- */

/** 「10食未満は30分後・10食以上は40分後」（data.js の TAKEOUT.leadByMeals から作る） */
function leadRuleText() {
  let from = 0;
  return TAKEOUT.leadByMeals.map(([under, min]) => {
    const t = under === Infinity ? `${from}食以上は${min}分後` : from === 0 ? `${under}食未満は${min}分後` : `${from}〜${under - 1}食は${min}分後`;
    from = under;
    return t;
  }).join('・');
}

/** 一番早い受け取り（今日できしだい／それが無理なら、次に選べる時間） */
function firstPickup(lead) {
  const asap = asapTime(new Date(), lead);
  if (asap) return `今日 ${hhmm(asap)}頃`;
  const d = pickupDays(new Date(), lead)[0];
  return d ? `${dayLabel(d.date)} ${hhmm(d.slots[0])}` : '—';
}

/* メニューのタブ（2026-11-04 ko-dai さんの指示：「店内メニューとテイクアウトのメニューが全部見れるメニュータブ」）。
 *  上の切りかえで、店内のメニュー（#menu/dine。見るだけ）と、テイクアウト（#menu。アプリで注文できる）。
 *  ★同じ日の2回目の指示で、テイクアウトの注文は「注文」のタブ（#menu）に分けた。メニューのタブは店内のメニューから開き、切りかえはこちらだけに出す。
 *  切りかえの「テイクアウト」を押すと、注文のタブに移る。注文だけの画面（takeout.html）では切りかえを出さない */
const menuSwitch = on => (ORDER_ONLY ? '' : `<nav class="menu-switch" aria-label="メニューの種類">
    <a href="#menu/dine" class="${on === 'dine' ? 'on' : ''}">${ICON.menu}<span><b>店内のメニュー</b><small>お店でお召し上がり</small></span></a>
    <a href="#menu" class="${on === 'takeout' ? 'on' : ''}">${ICON.bag}<span><b>テイクアウト</b><small>「注文」で注文できます</small></span></a>
  </nav>`);
function viewDine() {
  return {
    tab: 'menu', title: 'メニュー',
    html: `${menuSwitch('dine')}
      <p class="hint">お店でお召し上がりのメニューです（アプリからは注文できません）。価格は税込です。</p>
      <div class="dine">${DINE_IN.map((c, i) => `
        <details ${i === 0 ? 'open' : ''}>
          <summary>${esc(c.name)}<small>${c.items.filter(x => !x.hidden).length}品</small></summary>
          ${c.note ? `<p class="dine-note">${esc(c.note)}</p>` : ''}
          <ul>${c.items.filter(x => !x.hidden).map(dineItem).join('')}</ul>
        </details>`).join('')}
      </div>
      <a class="link-card" href="#reserve">${ICON.cal}<span><b>席のご予約</b><small>ネット予約か、お電話でどうぞ</small></span></a>`,
  };
}
function viewMenu(arg) {
  if (arg === 'dine' && !ORDER_ONLY) return viewDine();
  const accepting = DB.get('accepting', true);
  const first = firstPickup(leadFor(cartMeals()));
  const setNote = `<p class="cat-note">全定食にお得なセット！ ポテトフライ or 唐揚げ（5個）＋${yen(SET.choices[1].p)}／ミニシーザーサラダ ＋${yen(SALAD.choices[1].p)}</p>`;
  // バグるマネージで「出さない」にした商品は並べない（中身が無くなった見出しも出さない）
  const shown = c => ITEMS.filter(i => i.cat === c.id && !i.hidden);
  const cats = CATEGORIES.filter(c => shown(c).length);
  return {
    tab: 'order', title: 'テイクアウト注文',   // 下のタブの「注文」（2026-11-04 の2回目。前はメニューのタブの中の切りかえ）
    html: `
      <nav class="cats">${cats.map(c => `<button data-act="cat" data-arg="${c.id}">${esc(c.name)}</button>`).join('')}</nav>
      ${ORDER_ONLY ? myOrders().filter(o => ACTIVE.includes(o.status)).map(orderBanner).join('') : ''}
      ${accepting ? '' : '<p class="notice warn">ただいま、アプリからの注文の受付を止めています。お急ぎの方はお電話でどうぞ。</p>'}
      ${noticeHtml()}
      <p class="notice">${ICON.clock}<span>一番早い受け取り：<b>${first}</b><small>最短の受け取りは、${leadRuleText()}（ハンバーグBOX・定食の数）。${esc(TAKEOUT.payNote)}</small></span></p>
      <!-- 配達・大量注文の入口は、一番早い受け取りのすぐ下に、目立つ形で（2026-11-06 ko-dai さんの指示。前はメニューのいちばん下） -->
      <a class="link-card req-card" href="#request">${ICON.truck}<span><b>配達・大量注文はこちら</b><small>配達は${TAKEOUT.deliveryFreeMin}食以上で無料（原則${TAKEOUT.deliveryKm}km圏内）・${TAKEOUT.deliveryFreeMin}食未満は要相談。大量注文は${TAKEOUT.bulkMin}食以上。申請して、お店が承認したら確定です</small></span><i class="req-go" aria-hidden="true">›</i></a>
      <button class="link-line" data-act="allergy">アレルギーについて ›</button>
      ${cats.map(c => `
        <section class="cat-sec" id="cat-${c.id}">
          <h2 class="sec" data-en="${esc(c.en)}">${esc(c.name)}</h2>
          ${c.id === 'hamburg' || c.id === 'teishoku' ? setNote : ''}
          ${c.id === 'side' ? `<p class="cat-note">${esc(SIDE_CAT_NOTE)}</p>` : ''}
          <div class="items">${shown(c).map(itemRow).join('')}</div>
        </section>`).join('')}
`,
    after: () => {
      FX.spy($('.cats'));
      if (ORDERS_ONLINE) refreshAccepting().then(changed => changed && render(true)).catch(() => {});
    },
  };
}

function itemRow(i) {
  const from = i.groups.some(g => g.id === 'size');
  // サイド・ドリンクで写真のないものは、小さい絵にして、名前を1行に入れる
  const small = i.cat === 'side' && !i.img;
  // 売り切れ（バグるマネージで止めたもの）は、押せないようにして「売り切れ」と出す
  return `<button class="item${small ? ' item-sm' : ''}${i.soldOut ? ' is-out' : ''}" data-act="item" data-arg="${i.id}" ${i.soldOut ? 'disabled' : ''}>
      ${photo(i, small ? 'thumb sm' : 'thumb')}
      <span class="item-txt">
        <b>${esc(i.name)}</b>
        ${i.sub ? `<small>${esc(i.sub)}</small>` : ''}
        ${i.desc ? `<small class="desc">${esc(i.desc)}</small>` : ''}
        <em>${yen(i.price)}${from ? '〜' : ''}${i.soldOut ? '<span class="out-tag">売り切れ</span>' : ''}</em>
      </span>
      <span class="plus">＋</span>
    </button>`;
}

/* ---- 商品をえらぶ（下から出る画面） ---- */

function stepper(id, v, max = 99) {
  return `<span class="stepper" data-id="${id}" data-max="${max}"><button type="button" data-s="step:${id}:-1" aria-label="減らす">−</button><b>${v}</b><button type="button" data-s="step:${id}:1" aria-label="増やす">＋</button></span>`;
}

function groupHtml(g) {
  const tag = (g.required ? '<span class="req">必須</span>' : '')
    + (g.type === 'many' && g.choices.filter(c => !c.none).length > 1 ? '<span class="opt">いくつでも</span>' : '');
  const head = `<div class="g-head"><b>${esc(g.name)}</b>${tag}</div>`;
  if (g.type === 'count') {
    // 個数のボタンは、数量と同じく横に並べる：1個 ＋¥130 ……「なし」［− 0 ＋］。「なし」か個数を選ぶまで、カートに入れられない
    const c = g.choices[0];
    return `<div class="g g-cnt">${head}<div class="g-cnt-row"><small>1個 ＋${yen(c.p)}（${c.soldOut ? '売り切れ' : `${g.max}個まで`}）</small>
      <div class="g-cnt-r">${g.required ? `<label class="none-chip"><input type="checkbox" name="${g.id}" value="none">なし</label>` : ''}${c.soldOut ? '' : stepper(g.id, 0, g.max)}</div></div></div>`;
  }
  const type = g.type === 'one' ? 'radio' : 'checkbox';
  return `<div class="g">${head}<div class="choices">${g.choices.map((c, i) => `
      <label class="choice${c.soldOut ? ' off' : ''}"><input type="${type}" name="${g.id}" value="${i}" ${g.default === i && !c.soldOut ? 'checked' : ''} ${c.soldOut ? 'disabled' : ''}>
        <span class="c-name">${esc(c.n)}${c.soldOut ? '<small>売り切れ</small>' : ''}</span>${c.show ? `<span class="c-price">${c.show}</span>` : c.p ? `<span class="c-price">＋${yen(c.p)}</span>` : ''}
      </label>`).join('')}</div></div>`;
}

/** 次の欄を、見えている範囲のまん中へ動かす（下の「カートに入れる」に隠れる分は除く）。入りきらないときは欄の頭を見せる */
function showNextGroup(cur) {
  const next = cur.nextElementSibling;
  if (!next) return;   // 待っているあいだに閉じた
  const box = sheetBody.getBoundingClientRect();
  const r = next.getBoundingClientRect();
  const seen = box.height - $('.sheet-foot', sheetBody).offsetHeight;
  sheetBody.scrollTo({ top: sheetBody.scrollTop + r.top - box.top - Math.max(0, (seen - r.height) / 2), behavior: FX.calm ? 'auto' : 'smooth' });
}

function openItem(id) {
  const item = ITEM_BY_ID[id];
  const sel = {};
  // 必須の個数（追加カラアゲ）は、はじめは「まだ選んでいない」（null）
  item.groups.forEach(g => { sel[g.id] = g.type === 'one' ? (g.default ?? null) : g.type === 'many' ? [] : g.required ? null : 0; });
  let qty = 1;

  openSheet(`
    ${photo(item, 'item-photo')}
    ${item.photoNote ? `<p class="photo-note">${esc(item.photoNote)}</p>` : ''}
    <button class="sheet-x" data-s="close" aria-label="閉じる">×</button>
    <div class="item-head">
      <h2>${esc(item.full || item.name)}</h2>
      ${item.sub ? `<p class="sub">${esc(item.sub)}</p>` : ''}
      ${item.desc ? `<p class="sub">${esc(item.desc)}</p>` : ''}
      <p class="price">${yen(item.price)}${item.groups.some(g => g.id === 'size') ? '〜' : ''}</p>
    </div>
    ${item.groups.map(groupHtml).join('')}
    <div class="g g-qty"><b>数量</b>${stepper('qty', 1, 50)}</div>
    <div class="g-allergy" id="allergyBox"></div>
    <div class="sheet-foot"><button class="btn btn-main btn-block" data-s="add"></button></div>`);

  const refresh = () => {
    $('#allergyBox', sheetBody).innerHTML = allergyHtml(item, sel);
    const { unit, missing } = priceOf(item, sel);
    const btn = $('[data-s="add"]', sheetBody);
    btn.disabled = !!missing;
    btn.textContent = missing ? `${missing.name}を選んでください` : `カートに入れる　${yen(unit * qty)}`;
  };

  // 選んだら、次の欄へ動かす（選んだ色が見えるように、少し待つ）
  let nextTimer;
  const goNext = (el, wait = 200) => {
    clearTimeout(nextTimer);
    nextTimer = setTimeout(() => showNextGroup(el), wait);
  };

  sheetBody.onchange = e => {
    const g = item.groups.find(x => x.id === e.target.name);
    if (!g) return;
    const el = e.target.closest('.g');
    if (g.type === 'count') {
      // 「なし」を押したら 0 個。外したら、また「まだ選んでいない」に
      sel[g.id] = e.target.checked ? 0 : null;
      $(`.stepper[data-id="${g.id}"] b`, sheetBody).textContent = 0;
      refresh();
      if (e.target.checked) goNext(el);
      return;
    }
    if (g.type === 'many') {
      // 「なし」（none）と、ほかのものは一緒に選べない
      const boxes = $$(`input[name="${g.id}"]`, sheetBody);
      const picked = g.choices[Number(e.target.value)];
      if (e.target.checked) boxes.forEach(b => { if (b !== e.target && (picked.none || g.choices[Number(b.value)].none)) b.checked = false; });
    }
    sel[g.id] = g.type === 'one'
      ? Number(e.target.value)
      : $$(`input[name="${g.id}"]:checked`, sheetBody).map(i => Number(i.value));
    refresh();
    // いくつでも選べる欄は、続けて選ぶので動かさない（「なし」のときだけ次へ）
    if (g.type === 'one' || (e.target.checked && g.choices[Number(e.target.value)].none)) goNext(el);
  };

  sheetBody.onclick = e => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    const [kind, gid, d] = b.dataset.s.split(':');
    if (kind === 'close') return closeSheet();
    if (kind === 'step') {
      const box = b.closest('.stepper');
      const cur = gid === 'qty' ? qty : (sel[gid] || 0);
      const min = gid === 'qty' ? 1 : 0;
      const v = Math.min(Number(box.dataset.max), Math.max(min, cur + Number(d)));
      if (gid === 'qty') qty = v;
      else {
        // 個数を増やしたら「なし」は外れる。0 まで減らしたら「なし」を選んだことにする
        sel[gid] = v;
        const none = $(`input[name="${gid}"][value="none"]`, sheetBody);
        if (none) none.checked = v === 0;
        goNext(box.closest('.g'), 800);   // 続けて押すので、押し終わるのを待つ（この欄は1行なので、動いても見えたまま）
      }
      $('b', box).textContent = v;
      refresh();
    }
    if (kind === 'add') {
      if (priceOf(item, sel).missing) return;
      // 同じ選び方のものがカートにあれば、数を足す
      const same = cart.find(c => c.itemId === item.id && JSON.stringify(c.sel) === JSON.stringify(sel));
      if (same) same.qty += qty;
      else cart.push({ key: 'k' + Date.now(), itemId: item.id, sel, qty });
      saveCart();
      FX.fly($('img.item-photo', sheetBody), $('#cartBtn'));
      closeSheet();
      drawCart();
      toast('カートに入れました');
    }
  };
  refresh();
}

/* ---------------------------------------------------------------------
 *  アレルギー（data.js の ALLERGY。お店に確かめた中身があるときだけ出す）
 * --------------------------------------------------------------------- */

const ALLERGY_ALL = [...ALLERGY.major, ...ALLERGY.others];
const allergyKnown = item => !!ALLERGY.checked && Array.isArray(ALLERGY.items[item.id]);
const allergyAsk = () => `<p class="allergy-ask">${ICON.phone}<span>アレルギーについては、ご注文の前にお電話でお問い合わせください。<a href="tel:${SHOP.tel.replace(/-/g, '')}">${esc(SHOP.tel)}</a></span></p>`;

/** その商品に入っているもの（sel があれば、選んだソース・トッピングなどの分も足す）。並びは ALLERGY の順。
 *  unknown … 選んだもののうち、お店がまだ確かめていないもの（その分は「お問い合わせください」と出す） */
function allergensOf(item, sel = null) {
  const has = new Set(ALLERGY.items[item.id] || []);
  const unknown = [];
  if (sel) {
    item.groups.filter(g => ALLERGY.groups.includes(g.id)).forEach(g => {
      const v = sel[g.id];
      const picked = g.type === 'one' ? [v] : g.type === 'many' ? (v || []) : [];
      picked.map(i => g.choices[i]).filter(c => c && !c.plain).forEach(c => {
        if (Array.isArray(ALLERGY.choices[c.n])) ALLERGY.choices[c.n].forEach(a => has.add(a));
        else unknown.push(c.n);
      });
    });
  }
  return { list: ALLERGY_ALL.filter(a => has.has(a)), unknown };
}

const allergyTags = list => list.length
  ? list.map(a => `<span class="al ${ALLERGY.major.includes(a) ? 'al-major' : ''}">${esc(a)}</span>`).join('')
  : '<span class="al al-none">入っていません</span>';

function allergyHtml(item, sel) {
  if (!allergyKnown(item)) return allergyAsk();
  const { list, unknown } = allergensOf(item, sel);
  return `<div class="allergy">
      <b>アレルギー（${ALLERGY_ALL.length}品目のうち）</b>
      <div class="al-list">${unknown.length && !list.length ? '' : allergyTags(list)}</div>
      ${unknown.length ? `<p class="al-ask">選んだ「${esc(unknown.join('」「'))}」の分は、お電話でお問い合わせください（<a href="tel:${SHOP.tel.replace(/-/g, '')}">${esc(SHOP.tel)}</a>）。</p>` : ''}
      <small>${ALLERGY.note ? esc(ALLERGY.note) + '　' : ''}${ALLERGY.checked.replace(/-/g, '/')} 時点。太字は表示が義務の${ALLERGY.major.length}品目です。${unknown.length ? '' : '選んだソースやトッピングの分も入っています。'}</small>
    </div>`;
}

/** メニューの全部のアレルギー（メニューの上の「アレルギーの一覧」から） */
function openAllergyList() {
  const choices = Object.entries(ALLERGY.choices).filter(([, list]) => list.length);
  openSheet(`
    <button class="sheet-x" data-s="close" aria-label="閉じる">×</button>
    <h2 class="sheet-title">アレルギーの一覧</h2>
    ${ALLERGY.checked ? `<p class="hint">${ALLERGY_ALL.length}品目のうち、入っているもの（${ALLERGY.checked.replace(/-/g, '/')} 時点）。太字は表示が義務の${ALLERGY.major.length}品目です。${esc(ALLERGY.note)}</p>
      <ul class="al-table">${ITEMS.map(i => `<li><b>${esc(i.full || i.name)}</b><div class="al-list">${allergyKnown(i) ? allergyTags(allergensOf(i).list) : '<span class="al al-none">お問い合わせください</span>'}</div></li>`).join('')}</ul>
      ${choices.length ? `<h3 class="sec">選んだときに足されるもの</h3>
        <ul class="al-table">${choices.map(([n, list]) => `<li><b>${esc(n)}</b><div class="al-list">${allergyTags(ALLERGY_ALL.filter(a => list.includes(a)))}</div></li>`).join('')}</ul>` : ''}`
      : allergyAsk()}`);
  sheetBody.onchange = null;
  sheetBody.onclick = e => { if (e.target.closest('[data-s="close"]')) closeSheet(); };
}

/* ---------------------------------------------------------------------
 *  カート
 * --------------------------------------------------------------------- */

function viewCart() {
  if (!cart.length) {
    return {
      tab: 'order', title: 'カート', back: '#menu',
      html: `<div class="empty">${ICON.cart}<p>カートは空です</p><a class="btn btn-main" href="#menu">メニューを見る</a></div>`,
    };
  }
  const lines = cart.map(cartLine);
  const meals = cartMeals();
  const bulk = meals >= TAKEOUT.bulkMin;
  const out = cartOut();
  return {
    tab: 'order', title: 'カート', back: '#menu',
    html: `
      ${out.length ? `<p class="notice warn">売り切れになったものがあります。カートから削除してください。</p>` : ''}
      <div class="lines">${lines.map((l, k) => `
        <div class="line${lineOut(cart[k]) ? ' is-out' : ''}">
          ${photo(l.item, 'thumb sm')}
          <div class="line-txt"><b>${esc(l.name)}</b>${l.opts.length ? `<small>${esc(l.opts.join(' / '))}</small>` : ''}<em>${yen(l.unit * l.qty)}${lineOut(cart[k]) ? '<span class="out-tag">売り切れ</span>' : ''}</em></div>
          <span class="stepper"><button data-act="cq" data-arg="${l.key}:-1" aria-label="減らす">${l.qty === 1 ? '<small>削除</small>' : '−'}</button><b>${l.qty}</b><button data-act="cq" data-arg="${l.key}:1" aria-label="増やす">＋</button></span>
        </div>`).join('')}
      </div>
      <a class="add-more" href="#menu">＋ 他の商品も選ぶ</a>
      <div class="summary"><div class="sum"><span>合計（税込）</span><b>${yen(cartTotal())}</b></div></div>
      ${meals ? `<p class="meals">ハンバーグBOX・定食 <b>${meals}食</b>${bulk ? '' : `・一番早くて${leadFor(meals)}分後に受け取れます`}</p>` : ''}
      ${bulk ? `<p class="notice warn">${ICON.truck}<span>${TAKEOUT.bulkMin}食以上は大量注文です。下の「配達・大量注文を申請する」から申請してください。お店が確認してから確定します。</span></p>` : ''}
      <p class="pay-note">${esc(TAKEOUT.payNote)}</p>
      ${out.length ? '' : `<div class="foot foot-2">
        ${bulk ? '' : '<a class="btn btn-main btn-block" href="#checkout">受け取り時間を選ぶ</a>'}
        <a class="btn ${bulk ? 'btn-main' : 'btn-sub'} btn-block" href="#request">${ICON.truck}配達・大量注文を申請する</a>
      </div>`}`,
  };
}

/* ---------------------------------------------------------------------
 *  受け取りとお名前 → 注文
 *  「今から受け取る」（今日いちばん早く。2026-11-06 ko-dai さんの指示で「できしだい」から名前を替えた。注文の印は asap のまま）か「時間を指定」。いちばん早い時間は食数で変わる（TAKEOUT.leadByMeals）
 * --------------------------------------------------------------------- */

const checkoutLead = () => leadFor(cartMeals());
const checkoutDays = () => takeoutDays(new Date(), checkoutLead());

function viewCheckout() {
  if (!cart.length) { location.replace('#cart'); return null; }
  const meals = cartMeals();
  if (meals >= TAKEOUT.bulkMin) { location.replace('#request'); return null; }
  const lead = checkoutLead();
  const asap = asapTime(new Date(), lead);
  const days = checkoutDays();
  if (!asap) pick.mode = 'time';
  if (pick.day >= days.length) pick = { ...pick, day: 0, slot: null };
  const accepting = DB.get('accepting', true);
  const ok = accepting && (asap || days.length);
  return {
    tab: 'order', title: '受け取りとお名前', back: '#cart',
    html: `
      ${jstOk() ? '' : `<p class="notice warn">${JST_WARN}</p>`}
      <h2 class="sec">受け取りの時間</h2>
      <div class="modes">
        <button class="mode ${pick.mode === 'asap' ? 'on' : ''}" data-act="mode" data-arg="asap" ${asap ? '' : 'disabled'}>
          <b>今から受け取る</b><small>${asap ? `今日 ${hhmm(asap)}頃（約${lead}分後）` : '今日はもう受け取れません'}</small></button>
        <button class="mode ${pick.mode === 'time' ? 'on' : ''}" data-act="mode" data-arg="time">
          <b>時間を指定</b><small>${TAKEOUT.monthsAhead}か月先まで・${TAKEOUT.stepMinutes}分ごと</small></button>
      </div>
      <p class="hint">${meals ? `${meals}食の` : ''}ご注文は、一番早くて${lead}分後に受け取れます（${leadRuleText()}）。</p>
      <div id="timePick" ${pick.mode === 'time' ? '' : 'hidden'}>
        <div class="days">${days.map((d, i) => `
          <button class="chip ${i === pick.day ? 'on' : ''}" data-act="day" data-arg="${i}">${['今日', '明日'].includes(dayLabel(d.date)) ? dayLabel(d.date) : WEEK[d.date.getDay()] + '曜'}<small>${d.date.getMonth() + 1}/${d.date.getDate()}</small></button>`).join('')}
        </div>
        ${days.length > 4 ? `<p class="hint">日にちは、横に動かすと${TAKEOUT.monthsAhead}か月先（${mdw(days[days.length - 1].date)}）まで選べます。定休日は出ません。</p>` : ''}
        <div class="slots" id="slots">${slotsHtml(days)}</div>
      </div>
      ${cutleryHtml()}
      <h2 class="sec">お名前と電話番号</h2>
      ${savedContact(`<label class="field"><span>お名前（受け取りのときにお呼びします）</span><input id="f-name" autocomplete="name" value="${esc(ME.name)}" placeholder="例：豊田 太郎"></label>
      <label class="field"><span>電話番号</span><input id="f-tel" type="tel" inputmode="tel" autocomplete="tel" value="${esc(ME.tel)}" placeholder="例：090-1234-5678"></label>`, ME.registeredAt && ME.name && ME.tel ? [`${ME.name} 様`, ME.tel] : [])}
      <label class="field"><span>ご要望（なくても構いません）</span><textarea id="f-memo" rows="2" placeholder="例：お箸を2膳ください"></textarea></label>
      <h2 class="sec">ご注文の内容</h2>
      ${linesHtml(cart.map(cartLine), cartTotal())}
      <p class="pay-note">${esc(TAKEOUT.payNote)}</p>
      ${cancelRulesHtml(false)}
      ${privacyLink('お預かりする情報の扱いは ')}
      <div class="foot"><button class="btn btn-main btn-block" data-act="submit" ${ok ? '' : 'disabled'}>${!accepting ? 'ただいま注文を受け付けていません' : !ok ? '受け取りできる日がありません' : 'この内容で注文する'}</button></div>`,
    after: () => { if (ORDERS_ONLINE) refreshAccepting(true).catch(() => {}); },   // 止めていたら、送ったときに受け口が断る
  };
}

function slotsHtml(days) {
  const d = days[pick.day];
  if (!d) return '<p class="hint">受け取りできる時間がありません。</p>';
  return d.slots.map((t, i) => {
    const iso = t.toISOString();
    // 昼と夜のあいだ（お店が休みの時間）で区切る
    const gap = i && t - d.slots[i - 1] > TAKEOUT.stepMinutes * 60000;
    return `${gap ? '<p class="slot-sep">夜の部</p>' : ''}<button class="slot ${pick.slot === iso ? 'on' : ''}" data-act="slot" data-arg="${iso}">${hhmm(t)}</button>`;
  }).join('');
}

/** キャンセル規定の欄（注文・申請を送る前の画面）。文は data.js の TAKEOUT.cancelRules。req は配達・大量注文の申請のとき */
function cancelRulesHtml(req) {
  return `<h2 class="sec">キャンセル規定</h2>
      ${cancelRulesList(req)}
      <p class="hint">${req ? `ご希望の日時の${TAKEOUT.cookBefore}分前から調理を始めます。` : `「今から受け取る」の注文は受け付けるとすぐ、「時間を指定」の注文は受け取りの${TAKEOUT.cookBefore}分前から調理を始めます。`}</p>`;
}
const cancelRulesList = req => `<ul class="cancel-rules">${(req ? TAKEOUT.cancelRulesRequest : TAKEOUT.cancelRules).map(([k, v]) => `<li><b>${esc(k)}</b><span>${esc(v)}</span></li>`).join('')}</ul>`;

/** お箸・スプーンの有無を選ぶ欄（注文と申請で同じ）。お店には「カトラリー」と出る（js/order-api.js の noteOf） */
function cutleryHtml() {
  return `<h2 class="sec">お箸・スプーンの有無</h2>
      <div class="modes" id="cutlery">
        <button class="mode ${pick.cutlery === true ? 'on' : ''}" data-act="cutlery" data-arg="yes"><b>必要</b><small>お付けします</small></button>
        <button class="mode ${pick.cutlery === false ? 'on' : ''}" data-act="cutlery" data-arg="no"><b>不要</b><small>お付けしません</small></button>
      </div>`;
}

/** お箸・スプーンの有無を選んだか（選んでいなければ、その欄へ動かして知らせる） */
function cutleryChosen() {
  if (typeof pick.cutlery === 'boolean') return true;
  $('#cutlery').scrollIntoView({ block: 'center', behavior: 'smooth' });
  toast('お箸・スプーンの有無を選んでください', 'warn');
  return false;
}

const toHalf = s => s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[－ー‐―−]/g, '-');

/** お名前・電話番号・ご要望を読む（足りなければ知らせて null）。p は入れ物の id の頭（f／r） */
function readContact(p) {
  const name = $(`#${p}-name`).value.trim();
  const tel = toHalf($(`#${p}-tel`).value.trim());
  const memo = $(`#${p}-memo`)?.value.trim() || '';
  const digits = tel.replace(/[^0-9]/g, '');
  if (!name) { openContact(); $(`#${p}-name`).focus(); toast('お名前を入れてください', 'warn'); return null; }
  if (digits.length < 10 || digits.length > 11) { openContact(); $(`#${p}-tel`).focus(); toast('電話番号を確かめてください', 'warn'); return null; }
  return { name, tel, memo };
}

/** 登録した内容が揃っていれば、入力欄をたたんで内容だけ見せる（席の予約・テイクアウトの注文の入力を省く）。fields … 入力欄、rows … 見せる内容 */
function savedContact(fields, rows) {
  if (!MEMBER_PLUS || !rows.length) return fields;
  return `<div class="saved-contact" id="savedContact"><b>ご登録の内容で承ります</b>${rows.map(r => `<span>${esc(r)}</span>`).join('')}<button class="mini" data-act="contactEdit">変更する</button></div>
    <div id="contactFields" hidden>${fields}</div>`;
}
function openContact() {
  $('#savedContact')?.remove();
  if ($('#contactFields')) $('#contactFields').hidden = false;
}

/* 会員情報の項目（スタンプ台帳の決めごと.md の12節）。フリガナ・性別・年代は必須、メールアドレスだけ任意。★性別と年代は、一人ずつではなく集計して使う（バグるマネージの「客層」） */
const GENDERS = ['男性', '女性', 'その他'], AGES = ['10代', '20代', '30代', '40代', '50代', '60代', '70代以上'];
const pickHtml = (id, label, list, now) => `<label class="field"><span>${label}</span><select id="${id}"><option value="">選んでください</option>${list.map(x => `<option ${x === now ? 'selected' : ''}>${x}</option>`).join('')}</select></label>`;
function extraFields(p) {
  if (!MEMBER_PLUS) return '';
  const [seiKana, meiKana] = twoParts(ME.kana);
  return `<div class="r-names">
        <label class="field"><span>セイ（カタカナ）</span><input id="${p}-sei-kana" autocomplete="off" maxlength="19" value="${esc(seiKana)}" placeholder="例：トヨタ"></label>
        <label class="field"><span>メイ（カタカナ）</span><input id="${p}-mei-kana" autocomplete="off" maxlength="19" value="${esc(meiKana)}" placeholder="例：タロウ"></label>
      </div>
      <div class="r-names">${pickHtml(`${p}-gender`, '性別', GENDERS, ME.gender)}${pickHtml(`${p}-age`, '年代', AGES, ME.age)}</div>
      <label class="field"><span>メールアドレス（なくても構いません）</span><input id="${p}-email" type="email" inputmode="email" autocomplete="email" maxlength="120" value="${esc(ME.email || '')}"></label>
      <p class="hint">メールアドレスを入れておくと、席のご予約の入力も省けます。性別と年代は、一人ずつではなく集計して、お店のサービスを考える参考にします。</p>
      ${privacyLink('登録すると、次の内容に同意したことになります：')}`;
}
/** 会員情報の残りの項目を読む（足りない・形が違えば知らせて null）。name … お名前（席の予約で苗字と名前に分けるので、スペースが要る） */
function readExtra(p, name) {
  if (!MEMBER_PLUS) return {};
  const ng = (id, text) => { $(`#${p}-${id}`).focus(); toast(text, 'warn'); return null; };
  if (!twoParts(name)[1]) return ng('name', '苗字と名前のあいだにスペースを入れてください');
  const sei = toKatakana($(`#${p}-sei-kana`).value), mei = toKatakana($(`#${p}-mei-kana`).value);
  if (!sei) return ng('sei-kana', 'セイを入れてください');
  if (!mei) return ng('mei-kana', 'メイを入れてください');
  if (!/^[\u30a1-\u30f6\u30fc]+$/.test(sei + mei)) return ng('sei-kana', 'フリガナはカタカナで入れてください');
  const gender = $(`#${p}-gender`).value, age = $(`#${p}-age`).value, email = $(`#${p}-email`).value.trim();
  if (!gender) return ng('gender', '性別を選んでください');
  if (!age) return ng('age', '年代を選んでください');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return ng('email', 'メールアドレスの形を確かめてください');
  return { email, kana: `${sei} ${mei}`, gender, age };
}

/** 再送の印は、推測されないよう乱数で作る（時刻から作ると、当てられたときに他人の注文が読める。2026-11-01 の Codex のレビュー）。
 *  返事が切れて押し直しても、10分の間に同じ内容なら同じ印で送る（お店に届いていたら、受け口が前の注文を返すので2件にならない） */
function orderRid(o) {
  const key = hashOf(JSON.stringify([o.kind, o.asap || o.pickupAt, o.name, o.tel, o.memo, o.cutlery, o.lines]));
  const p = DB.get('orderSending');
  if (p?.key === key && Date.now() - p.at < 600000) return p.rid;
  const rid = randomRid('o');
  DB.set('orderSending', { key, rid, at: Date.now() });
  return rid;
}

/** 注文（申請）を作って保存し、注文の様子の画面へ。
 *  受け口につなぐとき（ORDERS_ONLINE。js/order-api.js）は、受け口に送ってから。番号と合計は受け口がつけ直す。btn は押したボタン（送っているあいだ止める） */
async function placeOrder(fields, btn) {
  if (STAMPS_ONLINE) await memberReady().catch(() => {});   // 注文に会員番号を残す（つながらないときは会員なしで送る）。★お渡し済みでもスタンプは押さない（2026-11-04）
  const now = new Date();
  const lines = cart.map(cartLine).map(l => ({ id: l.item.id, name: l.name, opts: l.opts, unit: l.unit, qty: l.qty }));
  let order = {
    no: nextOrderNo(now), date: dateKey(now), createdAt: now.toISOString(),
    lines, total: cartTotal(), meals: cartMeals(), member: ME.no, ...fields,
    times: { [fields.status]: now.toISOString() },
  };
  order.id = orderRid(order);
  if (ORDERS_ONLINE) {
    const label = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = '送っています…'; }
    try {
      order = await sendOrder(order);
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = label; }
      if (e.code === 'not_accepting') DB.set('accepting', false);
      return toast(orderMessage(e), 'warn');
    }
    DB.set('orderSending', null);
    // 端末に保存できなかったとき（容量がいっぱいなど）。注文はお店に届いているので、番号だけは伝える
    if (!getOrders().some(o => o.id === order.id)) alert(`ご注文を受け付けました。注文番号は ${order.no} です。この端末に控えを残せなかったので、番号を控えてください。`);
  } else {
    saveOrders([...getOrders(), order]);
  }
  Object.assign(ME, { name: order.name, tel: order.tel });
  DB.set('member', ME);
  cart = [];
  saveCart();
  pick = { mode: 'asap', day: 0, slot: null };
  req = { kind: '', day: 0, slot: '' };
  lastStatus[order.id] = order.status;
  justOrdered = order.id;
  location.hash = '#order/' + order.id;
}

/** 端末の時計が日本時間でないと、受け取りの時刻がずれて届く（画面の時刻は端末の時計で作っている）ので、送らない */
const jstOk = () => new Date().getTimezoneOffset() === -540;
const JST_WARN = 'この端末の時計が日本時間ではないため、受け取りの時刻が正しく届きません。日本時間に合わせるか、お電話でご注文ください。';

function submitOrder(btn) {
  if (!jstOk()) return toast(JST_WARN, 'warn');
  if (cartOut().length) { location.hash = '#cart'; return toast('売り切れになったものがあります。カートから削除してください', 'warn'); }
  if (cartMeals() >= TAKEOUT.bulkMin) { location.hash = '#request'; return; }
  const lead = checkoutLead();
  let pickupAt;
  if (pick.mode === 'asap') {
    const t = asapTime(new Date(), lead);
    if (!t) return toast('今日はもう「今から受け取る」はできません。時間を指定してください', 'warn');
    pickupAt = t.toISOString();
  } else {
    if (!pick.slot) {
      $('#slots').scrollIntoView({ block: 'center', behavior: 'smooth' });
      return toast('受け取りの時間を選んでください', 'warn');
    }
    // 画面を開いたままのあいだに、その時間が選べなくなっていないか
    if (!checkoutDays().some(d => d.slots.some(t => t.toISOString() === pick.slot))) {
      pick.slot = null;
      $('#slots').innerHTML = slotsHtml(checkoutDays());
      return toast('その時間はもう選べません。もう一度選んでください', 'warn');
    }
    pickupAt = pick.slot;
  }
  if (!cutleryChosen()) return;
  const c = readContact('f');
  if (!c) return;
  if (!DB.get('accepting', true)) return toast('ただいま注文を受け付けていません', 'warn');
  placeOrder({ ...c, kind: 'pickup', asap: pick.mode === 'asap', pickupAt, cutlery: pick.cutlery, status: 'new' }, btn);
}

/* ---------------------------------------------------------------------
 *  配達・大量注文の申請
 *  すぐには確定しない。お店に「申請」が届き、お店が承認したら確定（お店の画面 order.html の「申請」）
 *  ・大量注文 … TAKEOUT.bulkMin 食以上をお店で受け取る
 *  ・配達 … 届けてほしい。何食からでも申請できる。deliveryFreeMin 食以上は無料（原則 deliveryKm km 圏内）、
 *          それより少ないときは要相談（配達料は承認のときにお店から知らせる）
 * --------------------------------------------------------------------- */

let req = { kind: '', day: 0, slot: '' };   // 申請の受け取り方・希望の日時（選んでいる途中）

function viewRequest() {
  const meals = cartMeals();
  const can = { delivery: cart.length > 0, bulk: meals >= TAKEOUT.bulkMin };
  const free = meals >= TAKEOUT.deliveryFreeMin;   // 無料で配達できる食数か
  if (req.kind && !can[req.kind]) req.kind = '';
  if (!req.kind) req.kind = can.delivery ? 'delivery' : '';
  const days = requestDays();
  if (req.day >= days.length) req = { ...req, day: 0, slot: '' };
  const rules = `
      <ul class="req-rules">
        <li>${ICON.truck}<span><b>配達</b>ハンバーグBOX・定食が<b>${TAKEOUT.deliveryFreeMin}食以上</b>で無料（原則${TAKEOUT.deliveryKm}km圏内）。${TAKEOUT.deliveryFreeMin}食未満は<b>要相談</b>（配達料は、承認のときにお店からお知らせします）</span></li>
        <li>${ICON.bag}<span><b>大量注文</b><b>${TAKEOUT.bulkMin}食以上</b>をお店で受け取るとき</span></li>
        <li>${ICON.check}<span><b>確定の仕方</b>申請すると、お店が内容と日時を確かめます。<b>お店が承認したら確定</b>です（この画面と、お店からのお電話でお知らせします）</span></li>
      </ul>`;
  if (!can.delivery) {
    return {
      tab: 'order', title: '配達・大量注文の申請', back: cart.length ? '#cart' : '#menu',
      html: `
        <p class="lead">配達・大量注文は、メニューを選んでカートに入れてから申請します。</p>
        ${rules}
        <p class="notice">${ICON.cart}<span>カートは空です。<small>お店で受け取るなら、${TAKEOUT.bulkMin - 1}食までは、普通のテイクアウト注文（今から受け取る・時間指定）からどうぞ。</small></span></p>
        <div class="foot foot-2">
          <a class="btn btn-main btn-block" href="#menu">メニューを選ぶ</a>
          ${cart.length ? '<a class="btn btn-sub btn-block" href="#cart">カートを見る</a>' : ''}
        </div>`,
    };
  }
  const d = days[req.day];
  const timeOpts = d ? d.slots.map(t => `<option value="${t.toISOString()}" ${req.slot === t.toISOString() ? 'selected' : ''}>${hhmm(t)}</option>`).join('') : '';
  const choice = (k, title, sub) => `
      <label class="choice ${can[k] ? '' : 'off'}"><input type="radio" name="r-kind" value="${k}" ${req.kind === k ? 'checked' : ''} ${can[k] ? '' : 'disabled'}>
        <span class="c-name">${title}<small>${sub}</small></span></label>`;
  return {
    tab: 'order', title: '配達・大量注文の申請', back: '#cart',
    html: `
      ${rules}
      ${jstOk() ? '' : `<p class="notice warn">${JST_WARN}</p>`}
      <h2 class="sec">受け取り方</h2>
      <div class="choices">
        ${choice('delivery', '配達してほしい', free ? `${meals}食なので無料・原則${TAKEOUT.deliveryKm}km圏内` : `${meals}食なので要相談（${TAKEOUT.deliveryFreeMin}食から無料）。配達料は、承認のときにお店からお知らせします`)}
        ${choice('bulk', 'お店で受け取る（大量注文）', can.bulk ? `${TAKEOUT.bulkMin}食以上` : `${TAKEOUT.bulkMin}食からです。今は${meals}食`)}
      </div>
      <h2 class="sec">ご希望の日時</h2>
      ${d ? `<div class="field-row">
        <label class="field"><span>日にち</span><select id="r-day">${days.map((x, i) => `<option value="${i}" ${i === req.day ? 'selected' : ''}>${mdw(x.date)}</option>`).join('')}</select></label>
        <label class="field"><span>時間</span><select id="r-time"><option value="">選ぶ</option>${timeOpts}</select></label>
      </div>
      <p class="hint">${TAKEOUT.requestDaysBefore === 1 ? '前の日' : `${TAKEOUT.requestDaysBefore}日前`}までにお申し込みください（当日の分は選べません）。${TAKEOUT.requestDaysAhead}日先（定休日を除く）まで選べます。お店の都合で、ご相談のお電話をすることがあります。</p>` : '<p class="hint">選べる日がありません。お電話でご相談ください。</p>'}
      <div id="r-addrBox" ${req.kind === 'delivery' ? '' : 'hidden'}>
        <h2 class="sec">お届け先</h2>
        <label class="field"><span>ご住所</span><input id="r-addr" autocomplete="street-address" placeholder="例：豊田市若林西町◯◯ 1-2-3"></label>
        <label class="field"><span>建物名・会社名・部署（なくても構いません）</span><input id="r-addr2" placeholder="例：◯◯ビル 2階 ◯◯株式会社"></label>
      </div>
      ${cutleryHtml()}
      <h2 class="sec">お名前と電話番号</h2>
      <label class="field"><span>お名前（ご担当の方）</span><input id="r-name" autocomplete="name" value="${esc(ME.name)}" placeholder="例：豊田 太郎"></label>
      <label class="field"><span>電話番号（お店から確認のお電話をします）</span><input id="r-tel" type="tel" inputmode="tel" autocomplete="tel" value="${esc(ME.tel)}" placeholder="例：090-1234-5678"></label>
      <label class="field"><span>ご要望（なくても構いません）</span><textarea id="r-memo" rows="3" placeholder="例：お箸を20膳、領収書の宛名は◯◯株式会社"></textarea></label>
      <h2 class="sec">ご注文の内容（${meals}食）</h2>
      ${linesHtml(cart.map(cartLine), cartTotal())}
      <a class="add-more" href="#cart">内容を直す（カートへ）</a>
      <p class="pay-note">まだ確定していません。お店が承認したら確定します。<span id="r-pay">${esc(payNoteOf(req.kind, meals))}</span></p>
      ${cancelRulesHtml(true)}
      ${privacyLink('お預かりする情報の扱いは ')}
      <div class="foot"><button class="btn btn-main btn-block" data-act="request" ${d ? '' : 'disabled'}>この内容で申請する</button></div>`,
    after: () => { if (ORDERS_ONLINE) refreshAccepting(true).catch(() => {}); },
  };
}

function submitRequest(btn) {
  if (!jstOk()) return toast(JST_WARN, 'warn');
  if (cartOut().length) { location.hash = '#cart'; return toast('売り切れになったものがあります。カートから削除してください', 'warn'); }
  const meals = cartMeals();
  const kind = $('input[name="r-kind"]:checked')?.value;
  if (!kind) return toast('受け取り方を選んでください', 'warn');
  if (kind === 'bulk' && meals < TAKEOUT.bulkMin) return toast(`大量注文は${TAKEOUT.bulkMin}食からです`, 'warn');
  const slot = $('#r-time')?.value;
  if (!slot) { $('#r-time')?.focus(); return toast('ご希望の時間を選んでください', 'warn'); }
  if (!requestDays().some(d => d.slots.some(t => t.toISOString() === slot))) return toast('その時間はもう選べません。もう一度選んでください', 'warn');
  const address = kind === 'delivery' ? $('#r-addr').value.trim() : '';
  const address2 = kind === 'delivery' ? $('#r-addr2').value.trim() : '';
  if (kind === 'delivery' && !address) { $('#r-addr').focus(); return toast('お届け先のご住所を入れてください', 'warn'); }
  if (!cutleryChosen()) return;
  const c = readContact('r');
  if (!c) return;
  placeOrder({ ...c, kind, pickupAt: slot, address, address2, cutlery: pick.cutlery, status: 'request' }, btn);
}

// 申請の画面：受け取り方・日にちを変えたとき（入力を消さないよう、その部分だけ書きかえる）
document.addEventListener('change', e => {
  if (routeName() !== 'request') return;
  if (e.target.name === 'r-kind') {
    req.kind = e.target.value;
    $('#r-addrBox').hidden = req.kind !== 'delivery';
    $('#r-pay').textContent = payNoteOf(req.kind, cartMeals());
  }
  if (e.target.id === 'r-day') {
    req = { ...req, day: Number(e.target.value), slot: '' };
    const d = requestDays()[req.day];
    $('#r-time').innerHTML = '<option value="">選ぶ</option>' + (d ? d.slots.map(t => `<option value="${t.toISOString()}">${hhmm(t)}</option>`).join('') : '');
  }
  if (e.target.id === 'r-time') req.slot = e.target.value;
});

/* ---------------------------------------------------------------------
 *  注文の様子
 * --------------------------------------------------------------------- */

const STATUS_MSG = {
  request: 'お店が内容とご希望の日時を確認しています。承認されたら、この画面でお知らせします（お店からお電話することもあります）。',
  new: 'お店が注文を確認しています。少しお待ちください。',
  accepted: '受け付けました。受け取りの時間に合わせて調理します。',
  ready: 'できあがりました！ お店で、お名前と注文番号をお伝えください。',
  done: 'お受け取りありがとうございました。またのご利用をお待ちしています。',
};

function statusMsg(o) {
  // 受け付けたが、まだ調理を始める前（お店の画面の「受付済み」）。受け取りの cookBefore 分前を過ぎると、ふつうの言い方に戻る
  if (isBooked(o)) {
    const t = new Date(o.pickupAt), when = `${dayLabel(t)} ${hhmm(t)}`;
    if (o.kind === 'delivery') return `承認されました。${when}にお届けします。`;
    if (o.kind === 'bulk') return `承認されました。${when}の受け取りに合わせて準備します。`;
    return `受け付けました。${when}の受け取りの${TAKEOUT.cookBefore}分前から調理します。`;
  }
  if (o.kind === 'delivery') {
    if (o.status === 'accepted') return '承認されました。ご希望の日時にお届けします。';
    if (o.status === 'ready') return 'できあがりました。これからお届けします。';
    if (o.status === 'done') return 'お届けしました。ご利用ありがとうございました。';
  }
  if (o.kind === 'bulk' && o.status === 'accepted') return '承認されました。ご希望の日時に合わせて準備します。';
  return STATUS_MSG[o.status];
}

/** 注文の様子に合わせた、キャンセルの案内（キャンセル規定。data.js の TAKEOUT.cancelRules）。進み終わった注文は空 */
function cancelMsg(o) {
  if (['new', 'request'].includes(o.status)) return isRequest(o) ? 'お店が承認するまでは、下の「申請を取り下げる」からキャンセルできます。' : 'お店が受け付けるまでは、下の「注文を取り消す」からキャンセルできます。';
  if (isBooked(o)) return `お店が${isRequest(o) ? '承認した' : '受け付けた'}ので、この画面からはキャンセルできません。ご相談は、調理を始める前（${whenWord(o)}の${TAKEOUT.cookBefore}分前まで）にお電話でお願いします。`;
  if (['accepted', 'ready'].includes(o.status)) return '調理を始めたため、キャンセルできません。';
  return '';
}

const movedWhen = (o, t, day = true) => `${day ? `${dayLabel(t)} ` : ''}${hhmm(t)}${o.asap ? '頃' : ''}`;

function viewOrder(id) {
  const o = getOrders().find(x => x.id === id);
  if (!o) return { tab: 'me', title: 'ご注文', back: ORDER_ONLY ? '#menu' : '#me', html: '<div class="empty"><p>注文が見つかりません</p></div>' };
  const t = new Date(o.pickupAt);
  const step = STATUS[o.status].step;
  const steps = [isRequest(o) ? 'request' : 'new', 'accepted', 'ready', 'done'];
  const req = isRequest(o);
  const thanks = req
    ? `<b>${KIND[o.kind]}の申請を受け付けました</b><small>まだ確定していません。お店が承認すると「承認・準備中」に変わります</small>`
    : `<b>ご注文ありがとうございます</b><small>お店が確認すると「調理中」に変わります</small>`;
  return {
    tab: 'me', title: req ? `${KIND[o.kind]}の申請` : 'ご注文', back: ORDER_ONLY ? '#menu' : justOrdered === o.id ? '#home' : '#me',
    html: `
      ${justOrdered === o.id ? `<div class="thanks">${ICON.check}<div>${thanks}</div></div>` : ''}
      <div class="ticket">
        <div><small>${req ? '申請番号' : '注文番号'}</small><b class="t-no">${o.no}</b></div>
        <div><small>${whenWord(o)}${o.status === 'request' ? '（ご希望）' : ''}${o.asap ? '（今から受け取る）' : ''}</small><b>${dayLabel(t)} ${hhmm(t)}${o.asap ? '頃' : ''}</b>${ACTIVE.includes(o.status) && o.status !== 'request' ? `<small>${untilText(o.pickupAt)}</small>` : ''}</div>
      </div>
      ${o.status === 'canceled' ? `<p class="notice warn">この${req ? '申請' : '注文'}は取り消しになりました。</p>`
        : o.status === 'declined' ? `<p class="notice warn">${ICON.phone}<span>お店から、この申請はお受けできないとの連絡がありました。${o.shopMsg || o.declineNote ? `<small>お店から：${esc(o.shopMsg || o.declineNote)}</small>` : ''}<small>ご相談はお電話でどうぞ。</small></span></p>` : `
        <ol class="track">${steps.map((s, i) => `
          <li class="${i < step || o.status === 'done' ? 'past' : i === step ? 'now' : ''}"><i>${i < step || o.status === 'done' ? ICON.check : ''}</i><span>${statusLabel(o, s)}</span></li>`).join('')}
        </ol>
        <p class="track-msg tm-${o.status}">${statusMsg(o)}</p>
        ${o.movedFrom && ACTIVE.includes(o.status) ? `<p class="notice shop-notice">${ICON.clock}<span><b>お店が${whenWord(o)}の時間を変えました</b><small>${movedWhen(o, new Date(o.movedFrom))} → ${movedWhen(o, t, dateKey(new Date(o.movedFrom)) !== dateKey(t))}</small></span></p>` : ''}
        ${o.shopMsg ? `<p class="notice">${ICON.phone}<span>お店から<small>${esc(o.shopMsg)}</small></span></p>` : ''}`}
      <h2 class="sec">ご注文の内容${o.meals ? `（${o.meals}食）` : ''}</h2>
      ${linesHtml(o.lines, o.total)}
      <p class="pay-note">${o.kind === 'delivery' ? esc(TAKEOUT.deliveryPayNote + (needsFee(o) && o.status === 'request' && o.fee == null ? '配達料は、承認のときにお店からお知らせします。' : '')) : esc(TAKEOUT.payNote)}</p>
      <dl class="info">
        <dt>お名前</dt><dd>${esc(o.name)} 様</dd>
        <dt>電話番号</dt><dd>${esc(o.tel)}</dd>
        ${o.fee != null ? `<dt>配達料</dt><dd>${yen(o.fee)}（お届けのときに、ご注文の合計と一緒に）</dd>` : ''}
        ${o.kind === 'delivery' ? `<dt>お届け先</dt><dd>${esc(o.address)}${o.address2 ? `<br>${esc(o.address2)}` : ''}</dd>` : ''}
        ${typeof o.cutlery === 'boolean' ? `<dt>お箸・スプーン</dt><dd>${o.cutlery ? '必要' : '不要'}</dd>` : ''}
        ${o.memo ? `<dt>ご要望</dt><dd>${esc(o.memo)}</dd>` : ''}
      </dl>
      ${cancelMsg(o) ? `<p class="hint cancel-msg">${cancelMsg(o)}</p>` : ''}
      <div class="row-btns">
        <a class="btn btn-sub" href="tel:${SHOP.tel.replace(/-/g, '')}">${ICON.phone}お店に電話</a>
        ${['new', 'request'].includes(o.status) ? `<button class="btn btn-sub danger" data-act="cancel" data-arg="${o.id}">${o.status === 'request' ? '申請を取り下げる' : '注文を取り消す'}</button>` : ''}
      </div>`,
    // 注文した直後の「ありがとうございます」で、紙ふぶきを1回だけ
    after: justOrdered === o.id && !celebrated.has(o.id) ? () => { celebrated.add(o.id); FX.confettiFrom($('.thanks svg'), 'pop'); } : null,
  };
}
const celebrated = new Set();   // 紙ふぶきを出した注文（同じ注文で何度も出さない）

/* ---------------------------------------------------------------------
 *  スタンプカード
 * --------------------------------------------------------------------- */

// 2026-11-04 ko-dai さんの指示：スタンプは店頭（お店のQR）だけでためる。下の「QRを読むと…」の説明から、テイクアウトの受け取りでたまる一文を外した。
// 残りは、ko-dai さんがマネージで直した形（改行・「お店の中にいるときだけ」）をそのまま入れた（前の文を直したものは、この文には当たらなくなるため）
function viewStamp() {
  const s = getStamps();
  const on = stampOnCard(s.total);
  const cardNo = Math.floor(Math.max(s.total - 1, 0) / STAMP.goal) + 1;
  const next = STAMP.rewards.find(r => r.at > on);
  const coupons = s.coupons.filter(c => !c.usedAt);
  const doneToday = stampDoneToday();
  const useOk = couponOkToday();
  // 新しく押されたマス（前に見せたときより後の分）は、ぽんと押す動き。ゴールして新しいカードになったときは 0 から
  const from = on < stampSeen ? 0 : stampSeen;
  const fresh = on !== stampSeen && sheet.hidden;   // 下から出る画面が開いているあいだ（開き始めも）は、閉じてから
  const prevAt = Math.max(0, ...STAMP.rewards.filter(r => r.at <= on).map(r => r.at));
  const pct = next ? Math.round((on - prevAt) / (next.at - prevAt) * 100) : 100;
  const cells = Array.from({ length: STAMP.goal }, (_, i) => {
    const n = i + 1;
    const r = STAMP.rewards.find(x => x.at === n);
    const mark = n <= on ? '<img src="img/logo.png" alt="">' : r?.goal ? '<b>GOAL</b>' : r ? ICON.gift : n;
    const isNew = fresh && n > from && n <= on;
    // 押したスタンプは、マスごとに少しずつ傾ける（手で押したように）
    return `<span class="cell ${n <= on ? 'got' : ''} ${r ? 'gift' : ''} ${r?.goal ? 'goal' : ''} ${isNew ? 'new' : ''}" style="--rot:${(n * 47) % 23 - 18}deg;--n:${n}${isNew ? `;animation-delay:${(n - from - 1) * 0.15}s` : ''}">${mark}</span>`;
  }).join('');
  return {
    tab: 'stamp', title: 'スタンプカード',
    html: `
      ${ME.registeredAt ? '' : welcomeBox()}
      <div class="stampcard">
        <div class="sc-head">
          <img src="img/logo.png" alt="">
          <div><b>${esc(SHOP.name)} スタンプカード</b><small>${cardNo}枚目</small></div>
          <span class="sc-count"><em>${fresh ? from : on}</em>/${STAMP.goal}</span>
        </div>
        <div class="sc-grid">${cells}</div>
        <div class="sc-bar" aria-hidden="true"><i style="--p:${pct}%"></i></div>
        <p class="sc-next">${next ? `あと <b>${next.at - on}</b> 個で「${esc(couponTitle(next))}」` : 'ゴール！ 次のスタンプから新しいカードになります。'}</p>
      </div>
      <button class="btn btn-main btn-block" data-act="stamp" ${doneToday ? 'disabled' : ''}>${doneToday ? '今日のスタンプはもらいました' : `${ICON.qr}QRを読んでスタンプをもらう`}</button>
      <p class="hint">お店に置いてあるQRを読むと、1個たまります。<br>お店の中にいるときだけ読めます（位置情報を使います）。スタンプは1日${STAMP.perDay}個までです（初回登録の${STAMP.welcome.points}ポイントは別）。</p>
      ${(s.lineMovedAt && !TEST_MEMBER) || !STAMPS_ONLINE || !MEMBER_PLUS ? '' : `<button class="link-card line-card" data-act="lineMove"><span><b>${ICON.card}LINEのポイントカードをお持ちの方</b>
        <span class="l-step"><i>1</i>お会計で、LINEのショップカードを見せる</span>
        <span class="l-step"><i>2</i>お店の人が見せるQRを、ここを押して読む</span>
        <em class="l-get">同じ数のポイントを引き継げます（1回だけ）</em>
        <small>引き継いだ分のマスの特典は出ません。既に獲得済みのLINEの特典は、ご利用いただけます</small>
        <span class="l-go">QRを読む ›</span></span></button>`}
      ${coupons.length ? `
        <h2 class="sec">使える特典</h2>
        ${useOk ? '' : `<p class="notice">${ICON.check}<span>今日はもう特典を使いました。<small>特典は1日${STAMP.couponsPerDay}枚までです（他の特典とは一緒に使えません）。また次のご来店でどうぞ。</small></span></p>`}
        <div class="coupons">${coupons.map(c => `
          <div class="coupon">${ICON.gift}<div><b>${esc(couponName(c))}</b><small>${esc(c.label || `${c.at}個たまった特典`)}</small></div><button class="btn btn-small" data-act="coupon" data-arg="${c.id}" ${useOk ? '' : 'disabled'}>使う</button></div>`).join('')}
        </div>
        <p class="hint">特典は1日${STAMP.couponsPerDay}枚まで。他の特典とは一緒に使えません。</p>` : ''}
      <h2 class="sec" data-en="REWARDS">特典</h2>
      <ul class="rewards">
        <li class="${ME.registeredAt ? 'done' : ''}"><span>登録</span><b>${STAMP.welcome.points}ポイント ＋ ${esc(couponTitle(STAMP.welcome))}</b></li>
        ${STAMP.rewards.map(r => `<li class="${on >= r.at ? 'done' : ''} ${r.goal ? 'goal' : ''}"><span>${r.at}個${r.goal ? '<small>ゴール</small>' : ''}</span>${r.picks
          ? `<div class="rw"><b>${esc(couponTitle(r))}</b><p class="rw-picks">${r.picks.map(p => { const k = p.lastIndexOf(' '); return k < 0 ? `<i>${esc(p)}</i>` : `<i>${esc(p.slice(0, k))}<em>${esc(p.slice(k + 1))}</em></i>`; }).join('')}</p></div>`
          : `<b>${r.options.map(esc).join('<i class="or">or</i>')}</b>`}</li>`).join('')}
      </ul>
      <p class="hint">「or」でつないだ特典と、ゴールのハンバーグは、どれか1つをサービスします。使うときに選んでください。</p>
      <h2 class="sec">スタンプの履歴</h2>
      ${s.log.length
        ? `<ul class="hist">${s.log.slice(-10).reverse().map(l => `<li><span>${mdw(new Date(l.at))} ${hhmm(new Date(l.at))}</span><b>${esc(l.via)}</b></li>`).join('')}</ul>`
        : '<p class="hint">まだありません。</p>'}`,
    after: () => {
      pullStamps();
      if (!fresh) return;
      stampSeen = on;
      FX.count($('.sc-count em'), from, on);
      setTimeout(() => FX.confettiFrom($$('.cell.new').pop(), on === STAMP.goal ? 'party' : 'pop'), 450);
    },
  };
}

/** 初めての方へ：会員登録（お名前と電話番号）で1ポイントと、初回登録の特典（data.js の STAMP.welcome） */
function welcomeBox() {
  return `<div class="welcome">
      <div class="w-head">${ICON.gift}<div><b>初めての方へ</b><small>会員登録で <em>${STAMP.welcome.points}ポイント</em> ＋ <em>${esc(couponTitle(STAMP.welcome))}</em> をサービス</small></div></div>
      <p>${MEMBER_PLUS ? '会員情報' : 'お名前と電話番号'}を登録すると、すぐにもらえます。今日お店のQRも読むと、合わせて${STAMP.welcome.points + STAMP.perDay}ポイントになります。</p>
      <label class="field"><span>お名前</span><input id="w-name" autocomplete="name" value="${esc(ME.name)}" placeholder="例：豊田 太郎"></label>
      <label class="field"><span>電話番号</span><input id="w-tel" type="tel" inputmode="tel" autocomplete="tel" value="${esc(ME.tel)}" placeholder="例：090-1234-5678"></label>
      ${extraFields('w')}
      <button class="btn btn-main btn-block" data-act="register" data-arg="w">登録して${STAMP.welcome.points}ポイントもらう</button>
    </div>`;
}

/** 会員登録（マイページの保存も同じ）。はじめてのときだけ、初回登録の特典を渡す。★本番は、同じ電話番号の2回目をサーバーで止める */
function register(p) {
  const c = readContact(p);
  if (!c) return;
  const more = readExtra(p, c.name);
  if (!more) return;
  if (STAMPS_ONLINE) {
    return stampPost('memberSave', { name: c.name, tel: c.tel, ...more }).then(r => {
      lastStampTotal = getStamps().total;
      if (!r.first) return toast('保存しました');
      // 同じ電話番号で、前に初回の特典を受けている（受け口が welcome: false を返す。2026-11-05 ko-dai さんの指示：消して登録し直しても、2回は出さない）。
      // welcome が無い答え（前の版の受け口）は、今までどおり特典を出す
      if (r.welcome === false) { toast('会員登録ありがとうございます。この電話番号では、初回の特典はもう受け取っています', 'good'); render(true); return; }
      showStamped(r, '会員登録ありがとうございます');
      render(true);
    }).catch(e => toast(stampMessage(e), 'warn'));
  }
  Object.assign(ME, { name: c.name, tel: c.tel, ...more });
  const first = !ME.registeredAt;
  if (first) ME.registeredAt = new Date().toISOString();
  DB.set('member', ME);
  if (!first) return toast('保存しました');
  const r = giveWelcome();
  lastStampTotal = getStamps().total;
  showStamped(r, '会員登録ありがとうございます');
  render(true);
}

/** スタンプがたまったとき。上からスタンプがどんと落ちて、紙ふぶき・数字が増える・特典の箱がはねる（js/fx.js・app.css の「装飾と動き」） */
function showStamped(r, title = 'スタンプがたまりました') {
  const goal = r.on === STAMP.goal && !r.moved;   // LINE からの引き継ぎ（moved）は、ゴールのマスに着いてもゴールの特典を出さないので、言葉も出さない
  const next = STAMP.rewards.find(x => x.at > r.on);
  const prevAt = Math.max(0, ...STAMP.rewards.filter(x => x.at <= r.on).map(x => x.at));
  const from = r.moved ? (r.from < r.on ? r.from : 0) : Math.max(0, r.on - 1);
  openSheet(`
    <div class="stamped ${goal ? 'goal' : ''}">
      <div class="st-stage"><span class="st-ring"></span><span class="big-stamp"><img src="img/logo.png" alt=""></span></div>
      <h2>${esc(goal ? 'ゴール！ おめでとうございます' : title)}</h2>
      <p class="sc-count"><em>${FX.calm ? r.on : from}</em> / ${STAMP.goal}</p>
      ${next ? `<p class="st-next">次の特典まで あと <b>${next.at - r.on}</b> 個</p>
        <div class="sc-bar" aria-hidden="true"><i style="--p:${Math.round((r.on - prevAt) / (next.at - prevAt) * 100)}%"></i></div>` : ''}
      ${r.got.map(g => `<p class="got-gift">${ICON.gift}特典「${esc(couponName(g))}」をもらいました</p>`).join('')}
      ${r.moved ? '<p class="hint">引き継いだ分のマスの特典は出ません（LINEでもらった特典と重ならないように）。既に獲得済みのLINEの特典は、ご利用いただけます。次の特典からは、ふつうにたまります。</p>' : ''}
      ${title !== 'スタンプがたまりました' && !stampDoneToday() ? '<p class="hint">今日お店のQRを読むと、もう1ポイントたまります。</p>' : ''}
      <button class="btn btn-main btn-block" data-s="close">閉じる</button>
    </div>`);
  sheetBody.onchange = null;
  sheetBody.onclick = e => { if (e.target.closest('[data-s="close"]')) closeSheet(); };
  // スタンプが下に着いたところで、画面がどんと揺れて紙ふぶき。特典をもらった・ゴールのときは、たくさん
  setTimeout(() => {
    sheetBody.classList.remove('thud'); void sheetBody.offsetWidth; sheetBody.classList.add('thud');
    setTimeout(() => sheetBody.classList.remove('thud'), 450);
    FX.confettiFrom($('.st-stage', sheetBody), goal || r.got.length ? 'party' : 'pop');   // 落ちてくるスタンプではなく、着く場所から
    FX.buzz(goal ? [80, 60, 80, 60, 160] : 80);
  }, 420);
  setTimeout(() => FX.count($('.sc-count em', sheetBody), from, r.on), 560);
  if (r.got.length) setTimeout(() => FX.confettiFrom($('.got-gift', sheetBody), 'pop'), 1150);
  // 閉じたら、スタンプカードの新しいマスを押す動きを見せる
  onSheetClosed = () => { if (routeName() === 'stamp') render(true); };
}

function openCoupon(id) {
  const c = getStamps().coupons.find(x => x.id === id);
  if (!c || c.usedAt) return;
  if (!couponOkToday()) return toast(`特典は1日${STAMP.couponsPerDay}枚までです（今日はもう使いました）`, 'warn');
  const opts = c.options || [c.title];
  openSheet(`
    <button class="sheet-x" data-s="close" aria-label="閉じる">×</button>
    <div class="coupon-big">
      <p class="cb-label">特典券${c.label ? `・${esc(c.label)}` : ''}</p>
      <h2>${opts.length > 1 ? (c.at === STAMP.goal ? `${esc(couponName(c))}<small>この中のどれか1つをサービスします</small>` : 'どれか1つをサービス') : `${esc(opts[0])}をサービス`}</h2>
      ${opts.length > 1 ? `<div class="choices cb-opts">${opts.map(o => `
        <label class="choice"><input type="radio" name="cb-opt" value="${esc(o)}"><span class="c-name">${esc(o)}</span></label>`).join('')}
      </div>` : ''}
      <p class="cb-live"><i></i>${mdw(new Date())} ${hhmm(new Date())} 表示中</p>
      <p>お会計のときに、この画面をお店の人に見せてください。特典は1日${STAMP.couponsPerDay}枚まで、他の特典とは一緒に使えません。</p>
      <button class="btn btn-sub danger btn-block" data-s="use">お店の人が押す：使用済みにする</button>
    </div>`);
  sheetBody.onchange = null;
  sheetBody.onclick = e => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    if (b.dataset.s === 'close') return closeSheet();
    if (b.dataset.s !== 'use') return;
    const chose = opts.length > 1 ? $('input[name="cb-opt"]:checked', sheetBody)?.value : opts[0];
    if (!chose) return toast('どれにするか、選んでください', 'warn');
    if (!couponOkToday()) { closeSheet(); return toast(`特典は1日${STAMP.couponsPerDay}枚までです`, 'warn'); }
    if (!confirm(`「${chose}」で、この特典を使用済みにします。よろしいですか？`)) return;
    const used = () => {
      closeSheet();
      render(true);
      toast(`特典を使いました（${chose}）`);
      FX.confetti({ kind: 'pop' });
    };
    if (STAMPS_ONLINE) {
      b.disabled = true;
      return stampPost('couponUse', { id, chose }).then(used).catch(e => { b.disabled = false; toast(stampMessage(e), 'warn'); });
    }
    const s = getStamps();
    Object.assign(s.coupons.find(x => x.id === id), { usedAt: new Date().toISOString(), chose });
    DB.set('stamps', s);
    used();
  };
}

/* ---------------------------------------------------------------------
 *  お店
 * --------------------------------------------------------------------- */

function viewShop() {
  const q = encodeURIComponent(SHOP.address);
  const row = (icon, label, value, link = '') => `<li>${icon}<div><small>${label}</small><b>${value}</b></div>${link}</li>`;
  // 配達：1つの文にまとめず、何の話かを小さな見出しにして行を分ける（お支払いと同じ形。2026-10-30 ko-dai さんの指示：「見やすく改行」）
  const delivery = [
    ['配達できるところ', `原則${TAKEOUT.deliveryKm}km圏内`],
    [`${TAKEOUT.deliveryFreeMin}食未満`, '要相談（配達料はお店からお知らせします）'],
    ['お支払い', 'お届けのときに現金で'],
    ['ご相談・お申し込み', 'アプリの「配達・大量注文の申請」か、ホームページのお問い合わせフォームから'],
  ];
  return {
    tab: 'shop', title: 'お店の情報',   // 下のタブの「お店」（2026-11-04 の2回目の指示で、一番右に戻した）。ホームの「お店の情報」からも開く
    html: `
      <img class="shop-photo" src="${esc(SHOP.shopPhoto)}" alt="">
      <div class="shop-name"><img src="img/logo.png" alt=""><div><small>${esc(SHOP.catch)}</small><b>${esc(SHOP.name)}</b></div></div>
      ${stateHtml(shopState())}
      ${callBtn()}
      <ul class="rows">
        ${row(ICON.pin, '住所', esc(SHOP.address), `<a class="mini" href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">地図</a>`)}
        ${row(ICON.map, 'アクセス', esc(SHOP.access))}
        ${row(ICON.phone, '電話', esc(SHOP.tel), `<a class="mini" href="tel:${SHOP.tel.replace(/-/g, '')}">電話する</a>`)}
        ${row(ICON.clock, '営業時間', hoursHtml())}
        ${row(ICON.cal, '定休日', closedHtml())}
        ${row(ICON.car, '駐車場', esc(SHOP.parking))}
        ${row(ICON.seat, '席', esc(SHOP.seats), '<a class="mini" href="#reserve">予約</a>')}
        ${row(ICON.wallet, 'お支払い', `現金${SHOP.pay.map(([k, v]) => `<span class="sub-line">${v ? `<em>${esc(k)}</em>${esc(v)}` : esc(k)}</span>`).join('')}`)}
        ${row(ICON.truck, '配達', `${TAKEOUT.deliveryFreeMin}食以上で無料配達${delivery.map(([k, v]) => `<span class="sub-line"><em>${esc(k)}</em>${esc(v)}</span>`).join('')}` + (SHOP.contactUrl ? `<span class="sub-line"><a href="${esc(SHOP.contactUrl)}" target="_blank" rel="noopener">ホームページのお問い合わせフォーム ›</a></span>` : ''), '<a class="mini" href="#request">申請</a>')}
        ${row(ICON.bag, 'テイクアウトのキャンセル', TAKEOUT.cancelRules.map(([k, v]) => `<span class="sub-line"><em>${esc(k)}</em>${esc(v)}</span>`).join(''))}
        ${row(ICON.insta, 'Instagram', '@baguru.hamburg', `<a class="mini" href="${SHOP.instagram}" target="_blank" rel="noopener">見る</a>`)}
      </ul>
      <div class="map"><iframe src="https://www.google.com/maps?q=${q}&output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="地図"></iframe></div>
      <h2 class="sec" data-en="CALENDAR">営業日カレンダー</h2>
      ${openCalHtml()}
      <a class="link-card" href="#menu/dine">${ICON.menu}<span><b>店内のメニュー</b><small>お店でお召し上がりのメニューは、「メニュー」のタブで見られます</small></span></a>
      ${recruitCard()}
      ${faqHtml()}
      <h2 class="sec" data-en="OUR SHOPS">系列店</h2>
      ${SHOP.sisters.map(s => `<div class="sister">
        <img class="sister-logo" src="img/sisters/${esc(s.logo)}" alt="" width="64" height="64" loading="lazy">
        <div class="sister-txt"><b>${esc(s.name)}</b><small>${esc(s.addr.replace(/^愛知県/, ''))}</small>
          <span class="sister-links"><a class="mini" href="${esc(s.url)}" target="_blank" rel="noopener">ホットペッパー</a><a class="mini" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.name} ${s.addr}`)}" target="_blank" rel="noopener">${ICON.pin}地図</a></span></div>
      </div>`).join('')}`,
  };
}

/* ---- よくあるご質問（お店の情報のタブ。中身は data.js の FAQ。ホームページと同じ。2026-11-06 ko-dai さんの指示） ----
 *  押すと開く形（details）。{TEL} は店の電話のリンクにする。答えの下に link のボタン */
const faqText = a => esc(a).replace(/\n/g, '<br>').replace(/\{TEL\}/g, `<a class="link-inline" href="tel:${SHOP.tel.replace(/-/g, '')}">${esc(SHOP.tel)}</a>`);
const faqHtml = () => `<h2 class="sec" data-en="FAQ">よくあるご質問</h2>
  ${FAQ.map(g => `<p class="faq-group">${esc(g.group)}</p>
    <div class="faq">${g.items.map(it => `<details><summary><span>${esc(it.q)}</span></summary>
      <div class="faq-a"><p>${faqText(it.a)}</p>${it.link ? `<a class="mini" href="${esc(it.link[0])}">${esc(it.link[1])}</a>` : ''}</div></details>`).join('')}</div>`).join('')}`;

/* ---- 採用情報（2026-11-04 ko-dai さんの指示：「ホームページと同じように採用情報をアプリにも入れてください」） ----
 *  中身は data.js の RECRUIT（ホームページの採用情報と同じ）。ホームと、お店の情報のカードから開く（#recruit。下のタブは「お店」）。
 *  応募は、ホームページと同じ受け口の contact（kind: '採用'）に送る。受け口が、タブ「設定」の送り先にメールで届け、タブ「問い合わせ」に控えを残す。
 *  入れるものと決まりも、ホームページと同じ（お名前・電話番号・メールアドレスは必須。電話番号は 0 から始まる10〜11桁） */
const recruitCard = () => `<a class="link-card recruit-card" href="#recruit">${ICON.user}<span><b>採用情報<em>スタッフ募集中</em></b><small>ホール・キッチンのアルバイト・パート。時給 ${esc(RECRUIT.key[0][1].replace(/\n/g, '／'))}</small></span></a>`;
const brLines = t => esc(t).replace(/\n/g, '<br>');
let recruitRid = '';
function viewRecruit() {
  const R = RECRUIT;
  return {
    tab: 'shop', title: '採用情報', back: '#shop',
    html: `
      <div class="recruit-hero"><img src="${esc(R.photo)}" alt=""><div><small>CREW WANTED</small><b>${brLines(R.catch)}</b></div></div>
      <p class="recruit-lead">${esc(R.lead)}</p>
      <dl class="recruit-key">${R.key.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${brLines(v)}</dd></div>`).join('')}</dl>
      <div class="recruit-go">
        <button class="btn btn-main btn-block" data-act="recruitEntry">応募する</button>
        <div class="recruit-sub">
          <a class="btn btn-sub" href="tel:${SHOP.tel.replace(/-/g, '')}">${ICON.phone}電話で応募</a>
          <a class="btn btn-sub" href="${esc(SHOP.instagram)}" target="_blank" rel="noopener">${ICON.insta}DMで応募</a>
        </div>
      </div>
      <h2 class="sec" data-en="POINT">バグるで働くと</h2>
      <p class="recruit-wanted"><b>${esc(R.wanted)}</b><small>${esc(R.wantedSub)}</small></p>
      <ul class="recruit-points">${R.points.map(([t, s]) => `<li>${ICON.check}<div><b>${esc(t)}</b><small>${esc(s)}</small></div></li>`).join('')}</ul>
      <h2 class="sec" data-en="JOB DETAILS">募集要項</h2>
      <dl class="recruit-table">${R.details.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${brLines(v)}</dd></div>`).join('')}</dl>
      <h2 class="sec" data-en="ENTRY" id="r-entry">応募する</h2>
      <div id="r-form">
        <p class="hint">入力して送ると、お店から折り返しご連絡します。お電話（${esc(SHOP.tel)}）・Instagram の DM・お店のスタッフへの声かけでも受け付けています。</p>
        <label class="field"><span>お名前 <em class="req">必須</em></span><input id="r-name" autocomplete="name" maxlength="40" value="${esc(ME.name || '')}"></label>
        <label class="field"><span>電話番号 <em class="req">必須</em></span><input id="r-tel" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" value="${esc(ME.tel || '')}" placeholder="例：090-1234-5678"></label>
        <label class="field"><span>メールアドレス <em class="req">必須</em></span><input id="r-email" type="email" inputmode="email" autocomplete="email" maxlength="120" value="${esc(ME.email || '')}" placeholder="ご連絡に使います"></label>
        <div class="recruit-field"><span class="recruit-label">希望の仕事</span><div class="choices recruit-jobs">${R.jobs.map(j => `<label class="choice"><input type="checkbox" name="r-job" value="${esc(j)}"><b class="c-name">${esc(j)}</b></label>`).join('')}</div></div>
        <label class="field"><span>働きたい曜日・時間帯</span><input id="r-time" maxlength="200" placeholder="例：土日の昼、平日の夕方から"></label>
        <label class="field"><span>一言</span><textarea id="r-msg" rows="3" maxlength="2000" placeholder="聞きたいことなど、何でもどうぞ"></textarea></label>
        <p class="hint">入れていただいた内容は、採用の選考とご連絡のためだけに使います（<button class="link-inline" data-act="privacy">個人情報の扱い</button>）。</p>
        <button class="btn btn-main btn-block" data-act="recruitSend">この内容で応募する</button>
      </div>
      <div id="r-done" class="recruit-done" hidden>
        ${ICON.check}<b>ご応募ありがとうございます</b>
        <p>お店から、お電話かメールで折り返しご連絡します。数日たっても連絡がないときは、お電話（<a class="link-inline" href="tel:${SHOP.tel.replace(/-/g, '')}">${esc(SHOP.tel)}</a>）でお知らせください。</p>
      </div>`,
  };
}
const RECRUIT_MSG = {
  need_name: 'お名前を入れてください', need_tel: '電話番号を入れてください（お店から折り返しご連絡します）', bad_tel: '電話番号を正しく入れてください（例：090-1234-5678）',
  need_email: 'メールアドレスを入れてください（ご連絡に使います）', bad_email: 'メールアドレスの形が違います',
  busy: 'ただいま混み合っています。少し時間を置いて、もう一度お試しください',
};
/** 応募を送る（受け口の contact。kind: '採用'）。同じ応募は、受付の印（rid）で1通にまとめる */
async function sendRecruit(btn) {
  const val = id => ($(`#${id}`)?.value || '').trim();
  // via … 公式アプリから来た印（受け口はまだ見ていない。メールの「ホームページの…から届きました」を分けるときに使える）
  const v = { action: 'contact', kind: '採用', via: 'アプリ', name: val('r-name'), tel: val('r-tel'), email: val('r-email'), time: val('r-time'), message: val('r-msg'), website: '',
    jobs: $$('input[name="r-job"]:checked').map(c => c.value) };
  const telD = v.tel.replace(/[^\d]/g, '');
  const bad = !v.name ? 'need_name' : !v.tel ? 'need_tel' : !/^0\d{9,10}$/.test(telD) ? 'bad_tel' : !v.email ? 'need_email' : !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email) ? 'bad_email' : '';
  if (bad) return toast(RECRUIT_MSG[bad], 'warn');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = '送っています…';
  try {
    await baguruLib();
    if (!BaguruApi.ready()) throw Object.assign(new Error('not_ready'), { code: 'not_ready' });
    recruitRid = recruitRid || BaguruApi.rid();
    await BaguruApi.post({ ...v, rid: recruitRid });
    recruitRid = '';
    $('#r-form').hidden = true;
    $('#r-done').hidden = false;
    $('#r-done').scrollIntoView({ block: 'center', behavior: 'smooth' });
    FX.confetti({ kind: 'pop' });
  } catch (e) {
    const code = e.code || 'no_answer';
    toast(RECRUIT_MSG[code] || `送れませんでした。お手数ですが、お電話（${SHOP.tel}）でお知らせください`, 'warn');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

/* ---- 営業日カレンダー（2026-11-04 ko-dai さんの指示。予約のタブと、お店の情報に出す） ----
 *  休みかどうかは isClosedDay（T3Works の定休日・臨時休業・臨時営業 → data.js の順。common.js）。T3Works から来るのは60日先までなので、今月から3か月分。
 *  休：いつもの定休日、臨休：臨時休業、営：いつもは休みの曜日だが営業（祝日・臨時営業） */
let openCalYm = '';
const ymOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
function openCalHtml() {
  const now = new Date(), minYm = ymOf(now), maxYm = ymOf(new Date(now.getFullYear(), now.getMonth() + 2, 1));
  if (!openCalYm || openCalYm < minYm || openCalYm > maxYm) openCalYm = minYm;
  const [y, m] = openCalYm.split('-').map(Number), last = new Date(y, m, 0).getDate(), pad = new Date(y, m - 1, 1).getDay(), today = dateKey(now);
  const cells = [];
  for (let day = 1; day <= last; day++) {
    const d = new Date(y, m - 1, day), k = dateKey(d), closed = isClosedDay(d), usual = closedDows().includes(d.getDay()) && !isHoliday(d);
    const mark = closed ? (usual ? '休' : '臨休') : usual ? '営' : '';
    const cls = [closed ? 'is-off' : '', closed && !usual ? 'is-extra' : '', !closed && usual ? 'is-on' : '', k === today ? 'is-today' : '', k < today ? 'is-past' : '',
      d.getDay() === 0 || isHoliday(d) ? 'sun' : d.getDay() === 6 ? 'sat' : ''].filter(Boolean).join(' ');
    cells.push(`<span class="oc-day ${cls}" aria-label="${mdw(d)} ${closed ? (usual ? '定休日' : '臨時休業') : '営業'}"><b>${day}</b><i>${mark}</i></span>`);
  }
  return `<div class="ocal">
      <div class="oc-nav">
        <button type="button" class="oc-move" data-act="ocal" data-arg="-1" ${openCalYm <= minYm ? 'disabled' : ''} aria-label="前の月">‹</button>
        <p class="oc-title">${y}年<b>${m}</b>月</p>
        <button type="button" class="oc-move" data-act="ocal" data-arg="1" ${openCalYm >= maxYm ? 'disabled' : ''} aria-label="次の月">›</button>
      </div>
      <div class="oc-grid">${WEEK.map((w, i) => `<span class="oc-wd ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</span>`).join('')}${'<span></span>'.repeat(pad)}${cells.join('')}</div>
      <p class="oc-key"><span><i class="k-off">休</i>定休日</span><span><i class="k-extra">臨休</i>臨時休業</span><span><i class="k-on">営</i>祝日などで営業</span></p>
      <div class="oc-hours">${hoursHtml()}</div>
    </div>`;
}

function hoursHtml() {
  const range = ([open, close]) => `${open}〜${close}<small>（L.O. ${minusMin(close, SHOP.lastOrder)}）</small>`;
  return Object.values(SHOP.hours).map(h => `<span class="sub-line"><em>${esc(h.label)}</em>${h.times.map(range).join('<br>')}</span>`).join('');
}

/** 定休日と、これから先の臨時休業・臨時営業。休みの曜日が T3Works で変わったら、文もそれに合わせる */
function closedHtml() {
  const dows = closedDows();
  const note = String(dows) === String(SHOP.closedDays) ? SHOP.closedNote
    : dows.length ? `${dows.map(n => WEEK[n] + '曜日').join('・')}（祝日は営業）` : 'なし';
  const days = specialDays().map(s => `<span class="sub-line"><em>${mdw(s.date)}</em>${s.open ? '営業します' : '臨時休業'}</span>`);
  return esc(note) + days.join('');
}

function dineItem(i) {
  const price = i.sizes
    ? `<span class="sizes">${i.sizes.map(([n, p, more = '']) => `<span>${esc(n)} <b>${yen(p)}${more}</b></span>`).join('')}</span>`
    : `<b class="dine-p">${yen(i.p)}</b>`;
  // 写真があるものは、左に小さく（2026-10-30 ホームページと同じ写真）
  const pic = i.img ? `<img class="dine-pic" src="${esc(photoSrc(i.img))}" alt="" loading="lazy">` : '';
  return `<li class="${pic ? 'has-pic' : ''}">${pic}<div><b>${esc(i.n)}</b>${i.d ? `<small>${esc(i.d)}</small>` : ''}${i.sizes ? price : ''}</div>${i.sizes ? '' : price}</li>`;
}

/* ---------------------------------------------------------------------
 *  マイページ
 * --------------------------------------------------------------------- */

/** 登録しないと使えない。入れ直した人が先へ進めるように、前の会員に戻す欄も同じ画面に置く */
function viewJoin() {
  const mode = installMode();
  return {
    title: '会員登録',
    html: `
      <div class="join-head"><img src="img/logo.png" alt=""><h2>ご利用には会員登録が必要です</h2><p>スタンプ、テイクアウトの注文、席のご予約は、会員登録のあとでご利用いただけます。</p></div>
      ${mode === 'ios' || mode === 'inapp' ? `<p class="notice warn">${ICON.addbox}<span>先にホーム画面に追加して、そこから開いて登録してください。<small>このまま登録してから追加すると、もう一度「前に登録した方」から戻すことになります。</small></span></p>${installCard()}` : ''}
      ${welcomeBox()}
      <h2 class="sec">前に登録した方</h2>
      ${moveFields()}`,
  };
}

/** 引き継ぎコードで続きを使う欄と、お名前と電話番号で前の会員に戻す欄（マイページと登録の画面） */
function moveFields() {
  return `<label class="field"><span>引き継ぎコード（新しいスマホで入れる）</span><input id="t-code" autocapitalize="characters" autocomplete="off"></label>
      <label class="field"><span>登録した電話番号（登録していなければ空のまま）</span><input id="t-tel" type="tel" inputmode="tel" autocomplete="tel"></label>
      <button class="btn btn-sub btn-block" data-act="memberTake">新しいスマホで続きを使う</button>
      ${MEMBER_PLUS ? `<h3 class="move-head">アプリを入れ直したとき</h3>
      <p class="hint">登録したお名前と電話番号を入れると、前のスタンプと特典に戻せます。フリガナ・性別・年代・メールアドレスは戻らないので、戻したあとにもう一度入れてください。</p>
      <label class="field"><span>登録したお名前</span><input id="b-name" autocomplete="name"></label>
      <label class="field"><span>登録した電話番号</span><input id="b-tel" type="tel" inputmode="tel" autocomplete="tel"></label>
      <button class="btn btn-sub btn-block" data-act="memberBack">前の会員に戻す</button>` : ''}`;
}

function viewPrivacy() {
  return { tab: 'me', title: 'プライバシーポリシー', back: '#me', html: privacyHtml() };
}

function viewMe() {
  const mine = myOrders().slice().reverse();
  return {
    tab: 'me', title: 'マイページ',
    html: `
      <div class="member"><img src="img/logo.png" alt=""><div><small>会員番号</small><b>${ME.no}</b></div></div>
      <h2 class="sec">${ME.registeredAt ? (MEMBER_PLUS ? '会員情報' : 'お名前と電話番号') : '会員登録'}</h2>
      <p class="hint">${ME.registeredAt ? `${MEMBER_PLUS ? '席のご予約やテイクアウトの注文の入力を省けます。' : 'テイクアウトの注文のときに、最初から入ります。'}` : `登録すると、スタンプ${STAMP.welcome.points}ポイントと${esc(couponTitle(STAMP.welcome))}のサービス券をお渡しします。${MEMBER_PLUS ? '席のご予約やテイクアウトの注文の入力も省けます。' : 'テイクアウトの注文のときにも、最初から入ります。'}`}</p>
      <label class="field"><span>お名前</span><input id="m-name" autocomplete="name" value="${esc(ME.name)}"></label>
      <label class="field"><span>電話番号</span><input id="m-tel" type="tel" inputmode="tel" autocomplete="tel" value="${esc(ME.tel)}"></label>
      ${extraFields('m')}
      <button class="btn ${ME.registeredAt ? 'btn-sub' : 'btn-main'}" data-act="register" data-arg="m">${ME.registeredAt ? '保存する' : `登録して${STAMP.welcome.points}ポイントもらう`}</button>
      <h2 class="sec">ご予約のリクエスト</h2>
      <div id="myRsv">${reservesHtml()}</div>
      <h2 class="sec">注文の履歴</h2>
      ${mine.length ? `<ul class="orders">${mine.map(o => {
        const t = new Date(o.pickupAt);
        return `<li><a href="#order/${o.id}">
            <span class="o-top"><b>${isRequest(o) ? `${KIND[o.kind]}の申請 ` : '注文番号 '}${o.no}</b><em class="st st-${o.status}">${statusLabel(o)}</em></span>
            <small>${mdw(t)} ${hhmm(t)} ${whenWord(o)}${o.status === 'request' ? '（ご希望）' : ''}</small>
            <small>${esc(o.lines.map(l => l.name + (l.qty > 1 ? '×' + l.qty : '')).join('、'))}</small>
            <b class="o-total">${yen(o.total)}</b>
          </a></li>`;
      }).join('')}</ul>` : '<p class="hint">まだありません。</p>'}
      ${TEST_MEMBER ? `<h2 class="sec">テスト用アカウント</h2>
      <p class="hint">バグる Owner から開いたときだけの、テスト用のアカウントです。スタンプ・特典・LINEの引き継ぎを0に戻して、最初から試せます（お名前は「テスト」のまま）。</p>
      <button class="btn btn-sub btn-block danger" data-act="testReset">テストのアカウントを0に戻す</button>` : ''}
      ${STAMPS_ONLINE && !TEST_MEMBER ? `<h2 class="sec">スマホを替えるとき</h2>
      <p class="hint">前のスマホで引き継ぎコードを出して、新しいスマホで入れると、スタンプと特典を続けて使えます。コードは24時間使えます。</p>
      <button class="btn btn-sub btn-block" data-act="memberCode">引き継ぎコードを出す</button>
      ${moveFields()}` : ''}
      ${privacyLink()}
      ${installRow()}
      ${MEMBER_DELETE && !TEST_MEMBER && (ME.registeredAt || memberAuth()) ? `<h2 class="sec">アカウントの削除</h2>
      <p class="hint">会員情報・スタンプ・特典を消して、会員をやめられます。</p>
      <button class="btn btn-sub btn-block danger" data-act="memberDelete">アカウントを削除する</button>` : ''}
      ${DEV_HOST ? `<h2 class="sec">この試作版について</h2>
      <div class="about">
        <p>この Mac で試すときだけ出ます（公開先には出ません）。</p>
        <button class="btn btn-sub danger" data-act="reset">試作のデータを全部消す</button>
      </div>` : ''}`,
    after: () => { reservesSeen(); pullReserves(); },
  };
}

/* ---------------------------------------------------------------------
 *  下から出る画面・おしらせ
 * --------------------------------------------------------------------- */

function openSheet(html) {
  sheetBody.innerHTML = html;
  sheet.hidden = false;
  sheetBody.scrollTop = 0;   // ★hidden を外してから。隠れたままでは効かず、前に開いたときの位置から始まってしまう
  requestAnimationFrame(() => sheet.classList.add('show'));
  document.body.classList.add('lock');
}

function closeSheet() {
  stopCamera();   // スタンプのQRを読んでいる途中なら、カメラを止める
  sheet.classList.remove('show');
  document.body.classList.remove('lock');
  setTimeout(() => {
    if (sheet.classList.contains('show')) return;
    sheet.hidden = true;
    const after = onSheetClosed;
    onSheetClosed = null;
    after?.();
  }, 250);
}

let toastTimer;
function toast(text, kind = '') {
  const el = $('#toast');
  el.textContent = text;
  el.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
}

/* ---------------------------------------------------------------------
 *  ボタン
 * --------------------------------------------------------------------- */

/** マイページの「アカウントを削除する」（2026-11-02 ko-dai さんの指示。スタンプ台帳の決めごと.md の14節）。
 *  消えるものを見せて、確かめてから消す。受け取り前の注文やこれからの予約があるあいだは消さない（この端末で様子を見られなくなるため） */
function openDeleteMember() {
  const busy = myOrders().some(o => ACTIVE.includes(o.status)) || DB.get('reserves', []).some(r => rsvAhead(r) && ['request', 'ok'].includes(r.state || 'request'));
  if (busy) return toast('受け取り前の注文や、これからのご予約があるあいだは削除できません。済んでから、もう一度お試しください', 'warn');
  const s = getStamps(), left = s.coupons.filter(c => !c.usedAt).length;
  openSheet(`
    <button class="sheet-x" data-s="close" aria-label="閉じる">×</button>
    <div class="del-member">
      <h2>アカウントを削除しますか？</h2>
      <p>次のものが消えます。<b>元に戻せません。</b></p>
      <ul>
        <li>会員番号 ${esc(ME.no)} と、お名前・電話番号などの会員情報</li>
        <li>スタンプ ${s.total}個${left ? `と、使える特典 ${left}枚` : ''}</li>
      </ul>
      <p class="hint">テイクアウトの注文と席のご予約の記録は、お店の記録として残ります。消したいときは、お店にお電話ください。</p>
      <p class="hint">同じ電話番号で登録し直しても、初回の特典と LINE の引き継ぎは、もう一度は受けられません（そのために、電話番号そのものは残さず、電話番号から作った印と、受けた日付だけを残します）。</p>
      <label class="del-ok"><input type="checkbox" data-s="agree">スタンプと特典がなくなることを確かめました</label>
      <button class="btn btn-main btn-block del-go" data-s="go" disabled>削除する</button>
      <button class="btn btn-sub btn-block" data-s="close">やめる</button>
    </div>`);
  sheetBody.onchange = e => { if (e.target.dataset.s === 'agree') $('[data-s="go"]', sheetBody).disabled = !e.target.checked; };
  sheetBody.onclick = e => {
    const b = e.target.closest('[data-s]');
    if (!b || b.dataset.s === 'agree') return;
    if (b.dataset.s === 'close') return closeSheet();
    if (b.dataset.s !== 'go' || b.disabled) return;
    b.disabled = true;
    b.textContent = '削除しています…';
    deleteMember().then(() => {
      try { sessionStorage.setItem('bg.deleted', '1'); } catch (e) { /* 知らせが出ないだけ */ }
      location.hash = '#home';
      location.reload();
    }).catch(e => {
      b.disabled = false;
      b.textContent = '削除する';
      toast(stampMessage(e), 'warn');
    });
  };
}

/* ---- テスト用アカウント（バグる Owner から開いたときだけ。スタンプ台帳の決めごと.md の15節） ---- */


/** テスト用アカウントを作る画面。合言葉は、この端末に覚えてあれば入れなくてよい */
function viewTestGate() {
  // Owner の中にはめ込まれているとき、Owner に預けた鍵を待つあいだ（下の「テスト用アカウントの鍵を、Owner にも預ける」）
  if (ownerKeepWait) return { title: 'テスト用アカウント', html: `<p class="hint">読み込んでいます…</p>` };
  return {
    title: 'テスト用アカウント',
    html: `
      <div class="join-head"><img src="img/logo.png" alt=""><h2>テスト用アカウントで開きます</h2><p>バグる Owner から開いた公式アプリは、お客さまとは別の、テスト用のアカウントで動きます。</p></div>
      <ul class="test-points">
        <li>お店のQRのスタンプを、何度でも読めます（1日1個・お店にいるかの確かめをしません）</li>
        <li>LINEの引き継ぎのQRも、何度でも読めます</li>
        <li>特典は、1日に何枚でも使えます</li>
        <li>マイページの「テストのアカウントを0に戻す」で、最初からやり直せます</li>
      </ul>
      <p class="notice warn">${ICON.bag}<span>テイクアウトの注文と席のご予約は、本物としてお店に届きます。</span></p>
      <label class="field"><span>お店の合言葉（予約ボードと同じ。作るときに毎回入れます。この端末には覚えません）</span><input id="test-pin" type="password" autocomplete="off"></label>
      <button class="btn btn-main btn-block" data-act="testMake">テスト用アカウントを作る</button>`,
  };
}

function makeTestFrom(b) {
  const typed = $('#test-pin')?.value.trim() || '';
  const pin = typed;   // ★お店の合言葉は、入れてもらった字だけを使う（端末の保存からは読まない。2026-11-05）
  if (!pin) return toast('合言葉を入れてください', 'warn');
  b.disabled = true;
  b.textContent = '作っています…';
  makeTestMember(pin).then(() => {
    lastStampTotal = getStamps().total;
    render();
    toast('テスト用アカウントを作りました', 'good');
  }).catch(e => {
    b.disabled = false;
    b.textContent = 'テスト用アカウントを作る';
    console.warn('テスト用アカウントを作れませんでした', e.code, e.message, e.data);   // パソコンでは開発ツールでも見られる
    toast(testMessage(e), 'warn');
  });
}

/** マイページの「テストのアカウントを0に戻す」 */
function openTestReset() {
  const s = getStamps(), left = s.coupons.filter(c => !c.usedAt).length;
  openSheet(`
    <button class="sheet-x" data-s="close" aria-label="閉じる">×</button>
    <div class="del-member">
      <h2>テストのアカウントを0に戻しますか？</h2>
      <ul>
        <li>スタンプ ${s.total}個${left ? `と、使える特典 ${left}枚` : ''}が消えます</li>
        <li>LINEの引き継ぎも、まだの形に戻ります</li>
      </ul>
      <p class="hint">会員番号とお名前（テスト）はそのままです。</p>
      <button class="btn btn-main btn-block test-reset" data-s="go">0に戻す</button>
      <button class="btn btn-sub btn-block" data-s="close">やめる</button>
    </div>`);
  sheetBody.onchange = null;
  sheetBody.onclick = e => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    if (b.dataset.s === 'close') return closeSheet();
    if (b.dataset.s !== 'go' || b.disabled) return;
    b.disabled = true;
    b.textContent = '戻しています…';
    resetTestMember().then(() => {
      lastStampTotal = getStamps().total;
      stampSeen = stampOnCard(getStamps().total);
      closeSheet();
      render(true);
      toast('テストのアカウントを0に戻しました', 'good');
    }).catch(e => {
      b.disabled = false;
      b.textContent = '0に戻す';
      toast(testMessage(e), 'warn');
    });
  };
}

const ACTIONS = {
  item: id => openItem(id),
  cat: id => $('#cat-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
  ocal: dir => {   // 営業日カレンダーの前の月・次の月（その場だけ描き直す）
    const [y, m] = openCalYm.split('-').map(Number);
    openCalYm = ymOf(new Date(y, m - 1 + Number(dir), 1));
    $$('.ocal').forEach(el => { el.outerHTML = openCalHtml(); });
  },
  cq: arg => {
    const [key, d] = arg.split(':');
    const c = cart.find(x => x.key === key);
    if (!c) return;
    c.qty += Number(d);
    if (c.qty <= 0) cart = cart.filter(x => x !== c);
    saveCart();
    render(true);
  },
  mode: m => {
    pick.mode = m;
    $$('.mode[data-act="mode"]').forEach(b => b.classList.toggle('on', b.dataset.arg === m));
    $('#timePick').hidden = m !== 'time';
  },
  cutlery: a => {
    pick.cutlery = a === 'yes';
    $$('#cutlery .mode').forEach(b => b.classList.toggle('on', b.dataset.arg === a));
  },
  day: i => {
    pick = { ...pick, day: Number(i), slot: null };
    $$('.days .chip').forEach((b, n) => b.classList.toggle('on', n === pick.day));
    $('#slots').innerHTML = slotsHtml(checkoutDays());
  },
  slot: iso => {
    pick.slot = iso;
    $$('#slots .slot').forEach(b => b.classList.toggle('on', b.dataset.arg === iso));
  },
  submit: (_, el) => submitOrder(el),
  request: (_, el) => submitRequest(el),
  cancel: id => {
    const o = getOrders().find(x => x.id === id);
    if (!o) return;
    if (!['new', 'request'].includes(o.status)) return toast(cancelMsg(o) || '取り消せません', 'warn');
    if (!confirm(`${o.status === 'request' ? '申請' : '注文'}番号 ${o.no} を取り消します。よろしいですか？`)) return;
    const done = () => { lastStatus[id] = getOrders().find(x => x.id === id)?.status; render(true); };
    if (ORDERS_ONLINE) {
      if (!orderKeys()[id]) return toast('この端末からは取り消せません。お店にお電話ください', 'warn');   // 鍵が無いと受け口に届かない。取り消したように見せない
      return cancelOrderOnline(id)
        .then(() => { done(); toast('注文を取り消しました'); })
        .catch(e => { done(); toast(e.code === 'already' ? cancelMsg(getOrders().find(x => x.id === id)) || orderMessage(e) : orderMessage(e), 'warn'); });   // 押す前にお店が受け付けていたとき
    }
    updateOrder(id, { status: 'canceled', canceledBy: 'お客様' });
    done();
    toast('注文を取り消しました');
  },
  stamp: () => openScanner(),
  lineMove: () => openLineMove(),
  coupon: id => openCoupon(id),
  allergy: () => openAllergyList(),
  install: () => startInstall(),
  'install-guide': () => openInstallGuide(),
  'install-hide': () => hideInstallCard(),
  register: p => register(p),
  memberCode: () => stampPost('memberCode').then(r => {
    openSheet(`
      <button class="sheet-x" data-s="close" aria-label="閉じる">×</button>
      <div class="coupon-big">
        <p class="cb-label">引き継ぎコード</p>
        <h2>${esc(r.code)}</h2>
        <p>新しいスマホのマイページで入れてください。${mdw(new Date(r.until))} ${hhmm(new Date(r.until))} まで使えます。入れると、このスマホでは使えなくなります。</p>
      </div>`);
    sheetBody.onchange = null;
    sheetBody.onclick = e => { if (e.target.closest('[data-s="close"]')) closeSheet(); };
  }).catch(e => toast(stampMessage(e), 'warn')),
  memberTake: () => {
    const code = $('#t-code').value.trim().toUpperCase(), tel = toHalf($('#t-tel').value.trim());
    if (!code) return toast('引き継ぎコードを入れてください', 'warn');
    if (getStamps().total && !confirm('このスマホのスタンプと特典は、前のスマホの内容に置きかわります。よろしいですか？')) return;
    takeMember(code, tel).then(() => {
      lastStampTotal = getStamps().total;
      render(true);
      toast('前のスマホの続きを使えるようになりました', 'good');
    }).catch(e => toast(stampMessage(e), 'warn'));
  },
  contactEdit: () => openContact(),
  privacy: () => openPrivacy(),
  recruitEntry: () => $('#r-entry')?.scrollIntoView({ block: 'start', behavior: 'smooth' }),   // 採用情報の「応募する」（下のフォームへ）
  recruitSend: (a, el) => sendRecruit(el),
  memberDelete: () => openDeleteMember(),
  testMake: (_, el) => makeTestFrom(el),
  testReset: () => openTestReset(),
  memberBack: () => {
    const name = $('#b-name').value.trim(), tel = toHalf($('#b-tel').value.trim());
    if (!name || !tel) return toast('お名前と電話番号を入れてください', 'warn');
    if (getStamps().total && !confirm('このスマホのスタンプと特典は、前の会員の内容に置きかわります。よろしいですか？')) return;
    backMember(name, tel).then(() => {
      lastStampTotal = getStamps().total;
      if (routeName() === 'me') render(true); else location.hash = '#me';
      toast('前の会員に戻しました。会員情報をもう一度入れてください', 'good');
    }).catch(e => toast(stampMessage(e), 'warn'));
  },
  reset: () => {
    if (!DEV_HOST || !confirm('注文・スタンプ・会員番号など、試作のデータを全部消します。よろしいですか？')) return;
    DB.clearAll();
    location.hash = '#home';
    location.reload();
  },
  close: () => closeSheet(),
};

// バグるマネージの「アプリで見る」の中では、注文・スタンプ・特典・登録など、動かすと本物に残るものは止める（js/content.js の PREVIEW）
const PREVIEW_STOP = new Set(['submit', 'request', 'cancel', 'stamp', 'lineMove', 'coupon', 'register', 'reset', 'install-guide', 'memberCode', 'memberTake', 'memberBack', 'memberDelete', 'recruitSend']);
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  e.preventDefault();
  if (PREVIEW && PREVIEW_STOP.has(el.dataset.act)) return toast('見え方を確かめる画面なので、ここでは動きません', 'warn');
  ACTIONS[el.dataset.act]?.(el.dataset.arg, el);
});

$('#back').addEventListener('click', e => { location.hash = e.currentTarget.dataset.to || (ORDER_ONLY ? '#menu' : '#home'); });
window.addEventListener('hashchange', () => { if (routeName() !== 'order') justOrdered = null; render(); });

/* ---------------------------------------------------------------------
 *  お店の画面が書き換えたとき（注文の様子・スタンプ・受付の停止）
 * --------------------------------------------------------------------- */

/** 注文の様子が変わったら知らせる（お店の画面が同じブラウザで書き換えたとき・受け口から取り寄せたとき） */
function ordersChanged() {
  // お店が受け取りの時間を変えたとき（js/order-api.js の mergeOrders が控える）。下の様子の知らせと重なったら、そちらを出す
  orderMoved.splice(0).forEach(o => { toast(`${whenWord(o)}の時間が ${movedWhen(o, new Date(o.pickupAt))} に変わりました`, 'warn'); FX.buzz([120, 80, 120]); });
  for (const o of myOrders()) {
    const before = lastStatus[o.id];
    if (before && before !== o.status) {
      if (o.status === 'accepted') toast(isRequest(o) ? `${KIND[o.kind]}の申請 ${o.no} が承認されました`: `注文番号 ${o.no} を受け付けました`, isRequest(o) ? 'good' : '');
      if (o.status === 'declined') toast(`${KIND[o.kind]}の申請 ${o.no} は、お受けできませんでした`, 'warn');
      if (o.status === 'ready') { toast(`注文番号 ${o.no} ができあがりました！`, 'good'); FX.buzz([120, 80, 120]); FX.confetti({ kind: 'pop' }); }
      if (o.status === 'canceled') toast(`注文番号 ${o.no} は取り消しになりました`, 'warn');
    }
  }
  lastStatus = statusMap();
  // ★お渡し済みになっても、スタンプは押さない（2026-11-04 ko-dai さんの指示：テイクアウトのネット注文ではポイントをためない。ためるのは店頭のQRだけ）
}

/** ネット予約の様子が変わったら知らせる（js/reserve.js の syncReserves が返した控え） */
function reservesChanged(list) {
  list.forEach(r => {
    if (r.state === 'ok') { toast(`ご予約 ${r.no} が確定しました`, 'good'); FX.buzz([120, 80, 120]); FX.confetti({ kind: 'pop' }); }
    if (r.state === 'no') toast(`ご予約 ${r.no} は、お受けできませんでした`, 'warn');
    if (r.state === 'canceled') toast(`ご予約 ${r.no} は取り消しになりました`, 'warn');
  });
}

function stampsChanged() {
  const s = getStamps();
  // ほかの端末・タブでスタンプがたまったとき（スタンプカードを開いていれば、新しいマスを押す動きも出る）
  if (s.total > lastStampTotal && !ORDER_ONLY) { toast(`スタンプが${s.total - lastStampTotal}個たまりました`, 'good'); FX.confetti({ kind: 'pop' }); }
  lastStampTotal = s.total;
}

DB.onChange(key => {
  if (key === 'orders') ordersChanged();
  if (key === 'stamps') stampsChanged();
  if (!NO_LIVE.includes(routeName()) && !sheet.classList.contains('show')) render(true);
});

// 受け口につなぐとき：進めている注文があるあいだ、画面を見ているときだけ SYNC_EVERY ごとに、お店が進めた様子を取り寄せる（js/order-api.js）
function pullOrders() {
  if (!ORDERS_ONLINE || document.visibilityState !== 'visible') return;
  syncOrders().then(changed => {
    if (!changed) return;
    ordersChanged();
    if (!NO_LIVE.includes(routeName()) && !sheet.classList.contains('show')) render(true);
  }).catch(() => {});   // つながらないときは、次の回に
}
if (ORDERS_ONLINE && !PREVIEW) {
  setInterval(pullOrders, SYNC_EVERY);
  document.addEventListener('visibilitychange', pullOrders);
}

// ネット予約の様子を読む（js/reserve.js）。開いたとき・戻ってきたとき・開いている間は RSV_EVERY ごと。マイページは入力欄があるので、予約の所だけ書きかえる
let reservesAt = 0;
function pullReserves() {
  if (ORDER_ONLY || PREVIEW || document.visibilityState !== 'visible' || Date.now() - reservesAt < RSV_GAP) return;
  reservesAt = Date.now();
  syncReserves().then(changed => {
    if (!changed.length) return;
    reservesChanged(changed);
    if (routeName() === 'home' && !sheet.classList.contains('show')) render(true);
    if (routeName() === 'me') { $('#myRsv').innerHTML = reservesHtml(); reservesSeen(); }
  }).catch(() => {});   // つながらないときは、次の回に
}
if (!ORDER_ONLY && !PREVIEW) {
  setInterval(pullReserves, RSV_EVERY);
  document.addEventListener('visibilitychange', pullReserves);
}

// スタンプの台帳を読む（js/stamp-api.js）。開いたとき・戻ってきたとき・スタンプの画面を開いたとき・開いている間は RSV_EVERY ごと
let stampsAt = 0;
function pullStamps(force = false) {
  if (!STAMPS_ONLINE || PREVIEW || ORDER_ONLY || document.visibilityState !== 'visible' || (!force && Date.now() - stampsAt < RSV_GAP)) return;
  stampsAt = Date.now();
  syncStamps().then(changed => {
    if (!changed) return;
    stampsChanged();
    if (!NO_LIVE.includes(routeName()) && !sheet.classList.contains('show')) render(true);
  }).catch(() => {});   // つながらないときは、前に読んだ分を見せる
}
if (STAMPS_ONLINE && !ORDER_ONLY && !PREVIEW) {
  setInterval(pullStamps, RSV_EVERY);
  document.addEventListener('visibilitychange', () => pullStamps());
}

// T3Works の営業日を読み直す（30分に1回まで）。変わっていたら描き直す
const syncDays = () => refreshDays().then(changed => {
  if (changed && !NO_LIVE.includes(routeName()) && !sheet.classList.contains('show')) render(true);
});

// 「あと◯分」や営業中の表示を新しくする
setInterval(() => {
  if (['home', 'order'].includes(routeName()) && !sheet.classList.contains('show')) render(true);
  syncDays();
}, 60000);

// スマホのカメラアプリでお店のQRを読んで開いたとき（?stamp=印）。印はアドレスから消してから確かめる
const stampParam = new URLSearchParams(location.search).get('stamp');
if (stampParam) history.replaceState(null, '', location.pathname + '#stamp');

// バグる Owner（オーナー用の入口）から開いたときだけ、上の帯に「🏠 ホーム」を出す（2026-10-30 ko-dai さんの指示。フォルダーアプリのセッションに頼まれた）。
// 印は common.js がこのタブの sessionStorage に控えている（アドレスの ? が消えても出し続ける）。お客さまが開いたときは出さない。
// 戻り先は、バグる Owner（バグる Staff から開いた印 hub=staff があれば Staff）。
// ★2026-11-05 お店用アプリの引っ越しの段階2の3（計画書 `お店用アプリの引っ越し.md`）：Owner・Staff は t3dining-store.github.io に引っ越したので、
//   Owner が控える sessionStorage の bg.owner は、ここ（t3dining.github.io）からは読めない（前の場所の Owner が書いた古い控えが残っていると、前の Owner に戻ってしまう）。
//   そこで、bg.owner は読まず、アドレスの印（?from=owner・&hub=staff）だけで決める。印は、このタブの sessionStorage（bg.fromOwner・bg.fromHub）に控えて、アドレスの ? が消えても使う。
//   この Mac（localhost）で試すときは、手元の バグるOwner/・バグるStaff/ に戻る（?test で開いたときは ?test 付き）
const OWNER_URL = 'https://t3dining-store.github.io/baguru-owner/';
const STAFF_URL = 'https://t3dining-store.github.io/baguru-staff/';
const OWNER_MODE = (() => { try { return sessionStorage.getItem('bg.fromOwner') === '1'; } catch (e) { return false; } })();
const FROM_STAFF = (() => {
  const q = location.search, mark = /[?&]hub=staff\b/.test(q);
  try {   // ?from=owner で開き直したときは、そのときの印に替える（Staff から開いたあと、同じタブで Owner から開いたときに Staff へ戻らないように）
    if (/[?&]from=owner\b/.test(q)) { if (mark) sessionStorage.setItem('bg.fromHub', 'staff'); else sessionStorage.removeItem('bg.fromHub'); }
    return sessionStorage.getItem('bg.fromHub') === 'staff';
  } catch (e) { return mark; }
})();
function ownerHome() {
  if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return FROM_STAFF ? STAFF_URL : OWNER_URL;
  const u = new URL(FROM_STAFF ? 'バグるStaff/index.html' : 'バグるOwner/index.html', location.href);
  u.search = /[?&]test\b/.test(location.search) ? '?test' : '';
  u.hash = '';
  return u.href;
}
if (TEST_MEMBER) { $('#testBand').hidden = false; document.body.classList.add('test-account'); }   // テスト用アカウントの帯（15節）
if (OWNER_MODE && $('#ownerHome')) {
  $('#ownerHome').hidden = false;
  $('.top').classList.add('has-owner');   // 名前の字を少し小さくして、ボタンと並べても名前が切れないように
  $('#ownerHome').onclick = () => {
    const to = ownerHome();
    // Owner の中にはめ込まれているときは、枠の外の窓（Owner の画面そのもの）を移す（枠の中で開くと、Owner の中に Owner が出る）。
    // 押したときだけ動く（ブラウザは、押していないのに枠の外を移すのを止める）。移せなかったときは、枠の中で開く
    if (ENV.ownerFrame) { try { if (window.open(to, '_top')) return; } catch (e) { /* 下で枠の中に */ } }
    location.href = to;
  };
}
// ★Owner の中にはめ込まれているとき（ENV.ownerFrame。js/install.js）：外へのリンクは、枠の中で開かない（2026-11-05 お店用アプリの引っ越し）。
//   地図・Instagram・ホットペッパーなどは新しい窓（ほかのサイトの多くは、枠の中では開けない）、電話・メールなどは枠の外の窓で開く。
//   公式アプリの中の画面（同じ場所の、このファイルと同じフォルダの下）は、そのまま枠の中で開く。押したときに a の target を付け替えるだけ
if (ENV.ownerFrame) {
  const APP_DIR = location.origin + location.pathname.replace(/[^/]*$/, '');
  document.addEventListener('click', e => {
    const a = e.target.closest?.('a[href]');
    if (!a) return;
    let u;
    try { u = new URL(a.getAttribute('href'), location.href); } catch (err) { return; }
    if (/^https?:$/.test(u.protocol)) {
      if (u.href.startsWith(APP_DIR)) return;
      a.target = '_blank';
      a.rel = 'noopener';
    } else if (u.protocol !== 'javascript:') a.target = '_top';   // tel: mailto: など
  }, true);
}

/* ---- テスト用アカウントの鍵を、Owner にも預ける（2026-11-06 ko-dai さんの報告「スマホのオーナーから公式アプリを開くと毎回合言葉を聞かれる。パソコンだと聞かれません」） ----
 *  Owner の app.html（t3dining-store.github.io）にはめ込まれた公式アプリは、ブラウザから見ると「ほかの場所の中のページ」。
 *  iPhone の Safari は、そういうページの保存（localStorage）を、閉じると消す（パソコンの Chrome は残す）。そのため、テスト用アカウントの鍵
 *  （bgtest.memberAuth）が毎回消え、作る画面（お店の合言葉）が毎回出ていた。そこで、鍵を親の app.html にも預ける（親の保存は消えない）。
 *  ・開いたら、親に { type: 'baguru-app', kind: 'testAuth-hello' } を送る。親は預かっている鍵を { type: 'baguru-owner', kind: 'testAuth', auth } で返す
 *  ・この端末に鍵が無ければ、親の鍵を使い、台帳を読み直す（読み終わるまで「読み込んでいます…」。登録の画面が一瞬出ないように）。
 *    この端末に鍵があって親と違えば、この端末の鍵を親に知らせる
 *  ・鍵が変わったら（作った・使えなくなった）、{ kind: 'testAuth-set', auth } で親に知らせる（DB.set('memberAuth') のたびに）
 *  ・受けるのは、親の画面（parent）からで、場所が Owner の場所（OWNER_URL。この Mac では同じ場所 localhost も）のときだけ。送る先も名指し
 *  ・親の返事が OWNER_KEEP_WAIT ミリ秒のうちに来なければ（前の app.html など）、今までのとおり作る画面を出す
 *  ★預けるのはテスト用アカウントの鍵だけ（TEST_MEMBER のときだけ動く）。お客さまの鍵（bg.memberAuth）とお店の合言葉は、渡さない・受け取らない
 *  ★親の側は バグるOwner/app.html（バグるOwner のセッション）。知らせの形を変えるときは、両方を一緒に直す */
const OWNER_KEEP = TEST_MEMBER && ENV.ownerFrame && window.parent !== window;
const OWNER_KEEP_WAIT = 1500;
ownerKeepWait = OWNER_KEEP && !memberAuth();   // 名前は上の needTest のところで作ってある
if (OWNER_KEEP) {
  const origins = new Set([new URL(OWNER_URL).origin, ...(/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? [location.origin] : [])]);
  const authOk = a => !!a && typeof a === 'object' && typeof a.no === 'string' && typeof a.key === 'string'
    && a.no.length > 0 && a.no.length <= 60 && a.key.length > 0 && a.key.length <= 200;
  const pick = a => (authOk(a) ? { no: a.no, key: a.key } : null);
  const toOwner = msg => origins.forEach(o => { try { parent.postMessage({ type: 'baguru-app', ...msg }, o); } catch (e) { /* 届かないだけ */ } });
  const setRaw = DB.set.bind(DB), clearRaw = DB.clearAll.bind(DB);
  DB.set = (k, v) => { setRaw(k, v); if (k === 'memberAuth') toOwner({ kind: 'testAuth-set', auth: pick(v) }); };
  DB.clearAll = () => { clearRaw(); toOwner({ kind: 'testAuth-set', auth: null }); };
  const done = () => { if (!ownerKeepWait) return; ownerKeepWait = false; render(); };
  let answered = false;
  addEventListener('message', e => {
    if (answered || e.source !== parent || !origins.has(e.origin)) return;
    const d = e.data || {};
    if (d.type !== 'baguru-owner' || d.kind !== 'testAuth') return;
    answered = true;
    const mine = pick(memberAuth()), kept = pick(d.auth);
    if (mine) {
      if (!kept || kept.no !== mine.no || kept.key !== mine.key) toOwner({ kind: 'testAuth-set', auth: mine });
      return done();
    }
    if (!kept) return done();
    setRaw('memberAuth', kept);
    syncStamps().then(() => { lastStampTotal = getStamps().total; stampSeen = stampOnCard(lastStampTotal); }).catch(() => {}).finally(() => {
      stampsAt = Date.now();
      ownerKeepWait = false;
      render();
    });
  });
  // ★待つのをやめるのは、親の返事が来なかったときだけ。返事が来て台帳を読み直している途中で止めると、会員登録の画面が数秒出た（2026-11-06）
  if (ownerKeepWait) setTimeout(() => { if (!answered) done(); }, OWNER_KEEP_WAIT);
  toOwner({ kind: 'testAuth-hello' });
}

// バグるマネージで直した中身（js/content.js）。前に読んだ分をすぐ重ねてから描き、そのあと受け口から読み直す（変わっていたら描き直す）
applyContent(PREVIEW ? previewContent() : contentNow()?.content);
fixCart();   // 足した商品が ITEM_BY_ID に入ってから、カートを確かめる
const syncContent = () => refreshContent().then(changed => {
  if (!changed) return;
  fixCart();   // マネージで消した商品がカートに残らないように
  // ★入力の途中の画面（NO_LIVE：受け取りとお名前・申請・予約・登録・採用の応募など）は描き直さない。入れた字が消えないように（Codex の指摘 2026-11-05）。
  //   字の置きかえ（applyTexts）だけ重ね、ほかは次に画面を移ったときに出る
  if (!sheet.classList.contains('show') && !NO_LIVE.includes(routeName())) render(true);
  drawCart();
  applyTexts();
});

$$('[data-icon]').forEach(el => el.insertAdjacentHTML('afterbegin', ICON[el.dataset.icon]));
FX.parallax();
FX.ripples();
render();
startTexts();   // バグるマネージで直した文章に置きかえる（js/content.js）
try {   // アカウントを削除して開き直したとき
  if (sessionStorage.getItem('bg.deleted')) { sessionStorage.removeItem('bg.deleted'); setTimeout(() => toast('アカウントを削除しました', 'good'), 400); }
} catch (e) { /* 何もしない */ }
syncDays();
if (PREVIEW) setTimeout(previewFocus, 700);   // バグるマネージの「アプリで見る」。画面が出そろってから、確かめている文へ
else {
  pullOrders();
  pullReserves();
  pullStamps();
  syncContent();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncContent(); });
}
if (stampParam && !needInstall() && !needTest() && !needJoin()) claimStamp(stampParam);

/* ---------------------------------------------------------------------
 *  新しい版が出ていたら、開き直す（2026-11-04 ko-dai さんの指示「オーナーから開いても最新の画面になるようにしてください」）
 *  ホーム画面に追加した Owner・アプリは、戻ってきても前に開いた画面のまま読み直さない。そのため、公開した直し（下のタブなど）が出なかった。
 *  ・公開の道具（道具/公開する.py）が HTML に書いた版（meta bg-version）と、公開先の version.json を比べる。違えば、新しいアドレスで開き直す
 *  ・見るのは、開いたとき・画面に戻ったとき（visibilitychange・pageshow）。30秒に1回まで
 *  ・入力の途中（入れた字・選んだものがある、下から出る画面が開いている）は開き直さない。次に戻ったときにまた見る
 *  ・同じ版で2回は開き直さない（このタブの sessionStorage の bg.verTry）。この Mac（版が書かれていない）と、マネージの「アプリで見る」では何もしない
 * --------------------------------------------------------------------- */
const PAGE_VER = document.querySelector('meta[name="bg-version"]')?.content || '';
let verAt = 0;
// 入力の途中の画面（NO_LIVE）も開き直さない。受け取りの日時・カトラリーなどはボタンで選ぶので、入れた字だけでは分からない（Codex の指摘 2026-11-05）
const typingNow = () => sheet.classList.contains('show') || NO_LIVE.includes(routeName()) || $$('input, textarea, select').some(el =>
  el.type === 'checkbox' || el.type === 'radio' ? el.checked !== el.defaultChecked
    : el.tagName === 'SELECT' ? el.selectedIndex !== Math.max(0, [...el.options].findIndex(o => o.defaultSelected))   // 何も決めていない選ぶ欄は、いちばん上が選ばれている
      : el.type !== 'hidden' && el.value !== el.defaultValue);
async function checkVersion() {
  if (!PAGE_VER || PREVIEW || document.hidden || Date.now() - verAt < 30000) return;
  verAt = Date.now();
  let ver = '';
  try { ver = String((await (await fetch('version.json?t=' + Date.now(), { cache: 'no-store' })).json()).version || ''); } catch (e) { return; }
  if (!/^[0-9a-f]{6,40}$/.test(ver) || ver === PAGE_VER || typingNow()) return;
  try { if (sessionStorage.getItem('bg.verTry') === ver) return; sessionStorage.setItem('bg.verTry', ver); } catch (e) { return; }
  const q = withoutVer(location.search);
  location.replace(location.pathname + (q ? q + '&' : '?') + 'v=' + ver + location.hash);   // 新しいアドレスにして、端末に残った古い画面を使わせない（開いたあとで消す）
}
/** アドレスの ? のところから、開き直しの印 v=… だけを外す（?test・?from=owner などは、そのままの形で残す） */
function withoutVer(search) { return search.replace(/([?&])v=[^&]*&?/, '$1').replace(/[?&]$/, ''); }
if (/[?&]v=/.test(location.search)) history.replaceState(history.state, '', location.pathname + withoutVer(location.search) + location.hash);   // 開き直したときに付けた印を消す
if (PAGE_VER && !PREVIEW) {
  checkVersion();
  document.addEventListener('visibilitychange', checkVersion);
  window.addEventListener('pageshow', e => { if (e.persisted) { verAt = 0; checkVersion(); } });
}

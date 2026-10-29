/* =====================================================================
 *  お客さまの画面
 *  #home ホーム ／ #menu 注文 ／ #cart カート ／ #checkout 受け取りとお名前
 *  #request 配達・大量注文の申請 ／ #order/ID 注文の様子 ／ #stamp スタンプ ／ #shop お店 ／ #me マイページ
 *  ★takeout.html（ホームページの「モバイルオーダーで注文」から開く）は、注文に要る画面だけ（ORDER_ONLY）
 *    メニュー・カート・受け取りとお名前・配達と大量注文の申請・注文の様子。ほかの画面はメニューに戻す
 * ===================================================================== */

const ORDER_ONLY = !!window.ORDER_ONLY;
const ORDER_ROUTES = ['menu', 'cart', 'checkout', 'request', 'order'];

const view = $('#view');
const sheet = $('#sheet');
const sheetBody = $('.sheet-body', sheet);

const ME = ensureMember();
const myOrders = () => getOrders().filter(o => o.member === ME.no);
const statusMap = () => Object.fromEntries(myOrders().map(o => [o.id, o.status]));

// 選ぶ項目が変わる前にカートへ入れたもの（いまの決まりでは選び終わっていないもの）は、取りのぞく
let cart = DB.get('cart', []).filter(c => ITEM_BY_ID[c.itemId] && !priceOf(ITEM_BY_ID[c.itemId], c.sel || {}).missing);
let pick = { mode: 'asap', day: 0, slot: null };   // 受け取り方（asap＝できしだい／time＝時間を指定）と日・時間
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
  order: viewOrder, stamp: viewStamp, shop: viewShop, me: viewMe, reserve: viewReserve,
};
// 入力の途中で消えないよう、ほかのタブの書き換えでは描き直さない画面
const NO_LIVE = ['checkout', 'request', 'me', 'reserve'];

const routeName = () => location.hash.replace(/^#/, '').split('/')[0] || (ORDER_ONLY ? 'menu' : 'home');

function render(keepScroll = false) {
  let [name, arg] = location.hash.replace(/^#/, '').split('/');
  if (ORDER_ONLY && !ORDER_ROUTES.includes(name)) { history.replaceState(null, '', '#menu'); name = 'menu'; arg = ''; }
  const v = (ROUTES[name] || viewHome)(arg && decodeURIComponent(arg));
  if (!v) return;
  const y = window.scrollY;
  $('#title').innerHTML = v.title ? esc(v.title) : `<img src="img/logo.png" alt="">${esc(SHOP.name)}`;
  $('#back').hidden = !v.back;
  $('#back').dataset.to = v.back || '';
  view.innerHTML = v.html;
  // 画面を移ったときだけ、上から順にふわっと出す（1分ごとなどの描き直しでは動かさない。app.css の「装飾と動き」）
  view.classList.remove('enter');
  if (!keepScroll) { void view.offsetWidth; view.classList.add('enter'); }
  v.after?.();   // 描いたあとに動かすもの（ネット予約の空き状況・演出）
  view.dataset.route = name || 'home';     // ヨコ画面のとき、メニューだけ横に広げる（app.css の最後）
  $$('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === v.tab));
  drawCart();
  window.scrollTo(0, keepScroll ? y : 0);
}

let cartCount = null;
function drawCart() {
  const n = cart.reduce((s, c) => s + c.qty, 0);
  const badge = $('#cartBtn .badge');
  badge.hidden = !n;
  badge.textContent = n;
  if (cartCount !== null && n > cartCount) { badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump'); }
  cartCount = n;
  const bar = $('#cartbar');
  bar.hidden = !(n && routeName() === 'menu');
  if (!bar.hidden) bar.innerHTML = `<span>${ICON.cart}カートを見る<small>${n}点</small></span><b>${yen(cartTotal())}</b>`;
}

function cartLine(c) {
  const item = ITEM_BY_ID[c.itemId];
  const p = priceOf(item, c.sel);
  return { key: c.key, item, name: item.full || item.name, qty: c.qty, unit: p.unit, opts: p.opts };
}
const cartTotal = () => cart.map(cartLine).reduce((s, l) => s + l.unit * l.qty, 0);
const cartMeals = () => mealCount(cart);

const photo = (i, cls = 'thumb') => i.img
  ? `<img class="${cls}" src="img/menu/${i.img}" alt="" loading="lazy">`
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
        <img src="${SHOP.hero}" alt="">
        <div class="hero-in">
          <img class="hero-logo" src="img/logo.png" alt="">
          <div><p class="hero-catch">${esc(SHOP.catch)}</p><p class="hero-name">${esc(SHOP.name)}</p></div>
        </div>
      </section>
      ${stateHtml(st)}
      ${active.map(orderBanner).join('')}
      <div class="quick">
        <a class="quick-btn q-order" href="#menu">${ICON.bag}<b>テイクアウト注文</b><small>できしだい・時間指定</small></a>
        <a class="quick-btn q-stamp" href="#stamp">${ICON.card}<b>スタンプカード</b><small>${ME.registeredAt ? `<em>${stampOnCard(s.total)}</em> / ${STAMP.goal}${coupons ? `・特典${coupons}枚` : ''}` : '登録で1ポイント＋アイス'}</small></a>
      </div>
      ${callBtn()}
      <a class="link-card" href="#reserve">${ICON.cal}<span><b>ネット予約（席のご予約）</b><small>空いている日と時間を選んで、リクエストを送れます。お店が確かめて、確定をメールでお知らせします</small></span></a>
      <a class="link-card" href="#request">${ICON.truck}<span><b>配達・大量注文の申請</b><small>配達は${TAKEOUT.deliveryFreeMin}食以上で無料（原則${TAKEOUT.deliveryKm}km圏内）・${TAKEOUT.deliveryFreeMin}食未満は要相談。大量注文は${TAKEOUT.bulkMin}食以上。お店が確認してから確定します</small></span></a>
      ${installCard()}
      <h2 class="sec">お知らせ</h2>
      <ul class="news">${NEWS.map(n => `
        <li><time>${n.date.slice(5).replace('-', '/')}</time><b>${esc(n.title)}</b><p>${esc(n.body)}</p></li>`).join('')}
      </ul>
      <a class="link-card" href="${SHOP.instagram}" target="_blank" rel="noopener">${ICON.insta}<span><b>最新情報は Instagram で</b><small>@baguru.hamburg</small></span></a>`,
    after: () => FX.embers($('.hero')),
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
      <span class="ob-main"><b>${isRequest(o) ? `${KIND[o.kind]}の申請 ` : '注文番号 '}${o.no}</b><small>${dayLabel(t)} ${hhmm(t)}${o.asap ? '頃' : ''} ${whenWord(o)}${o.status === 'request' ? '（希望）' : `・${untilText(o.pickupAt)}`}</small></span>
      <span class="ob-go">›</span>
    </a>`;
}

/* ---------------------------------------------------------------------
 *  メニュー（テイクアウト注文）
 * --------------------------------------------------------------------- */

/** 「5食未満は20分後・5〜9食は30分後・10食以上は40分後」 */
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

function viewMenu() {
  const accepting = DB.get('accepting', true);
  const first = firstPickup(leadFor(cartMeals()));
  const setNote = '<p class="cat-note">全定食にお得なセット！ ポテトフライ or 唐揚げ（5個）＋¥600／ミニシーザーサラダ ＋¥400</p>';
  return {
    tab: 'menu', title: 'テイクアウト注文',
    html: `
      <nav class="cats">${CATEGORIES.map(c => `<button data-act="cat" data-arg="${c.id}">${esc(c.name)}</button>`).join('')}</nav>
      ${ORDER_ONLY ? myOrders().filter(o => ACTIVE.includes(o.status)).map(orderBanner).join('') : ''}
      ${accepting ? '' : '<p class="notice warn">ただいま、アプリからの注文の受付を止めています。お急ぎの方はお電話でどうぞ。</p>'}
      <p class="notice">${ICON.clock}<span>一番早い受け取り：<b>${first}</b><small>最短の受け取りは、${leadRuleText()}（ハンバーグBOX・定食の数）。${esc(TAKEOUT.payNote)}</small></span></p>
      <button class="link-line" data-act="allergy">アレルギーについて ›</button>
      ${CATEGORIES.map(c => `
        <section class="cat-sec" id="cat-${c.id}">
          <h2 class="sec">${esc(c.name)}</h2>
          ${c.id === 'hamburg' || c.id === 'teishoku' ? setNote : ''}
          ${c.id === 'side' ? `<p class="cat-note">サイドの${esc(SIDE_PHOTO_NOTE)}</p>` : ''}
          <div class="items">${ITEMS.filter(i => i.cat === c.id).map(itemRow).join('')}</div>
        </section>`).join('')}
      <a class="link-card" href="#request">${ICON.truck}<span><b>配達・大量注文はこちら</b><small>配達は${TAKEOUT.deliveryFreeMin}食以上で無料（原則${TAKEOUT.deliveryKm}km圏内）・${TAKEOUT.deliveryFreeMin}食未満は要相談。大量注文は${TAKEOUT.bulkMin}食以上。申請して、お店が承認したら確定です</small></span></a>`,
  };
}

function itemRow(i) {
  const from = i.groups.some(g => g.id === 'size');
  // サイド・ドリンクで写真のないものは、小さい絵にして、名前を1行に入れる
  const small = i.cat === 'side' && !i.img;
  return `<button class="item${small ? ' item-sm' : ''}" data-act="item" data-arg="${i.id}">
      ${photo(i, small ? 'thumb sm' : 'thumb')}
      <span class="item-txt">
        <b>${esc(i.name)}</b>
        ${i.sub ? `<small>${esc(i.sub)}</small>` : ''}
        ${i.desc ? `<small class="desc">${esc(i.desc)}</small>` : ''}
        <em>${yen(i.price)}${from ? '〜' : ''}</em>
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
    return `<div class="g g-cnt">${head}<div class="g-cnt-row"><small>1個 ＋${yen(c.p)}（${g.max}個まで）</small>
      <div class="g-cnt-r">${g.required ? `<label class="none-chip"><input type="checkbox" name="${g.id}" value="none">なし</label>` : ''}${stepper(g.id, 0, g.max)}</div></div></div>`;
  }
  const type = g.type === 'one' ? 'radio' : 'checkbox';
  return `<div class="g">${head}<div class="choices">${g.choices.map((c, i) => `
      <label class="choice"><input type="${type}" name="${g.id}" value="${i}" ${g.default === i ? 'checked' : ''}>
        <span class="c-name">${esc(c.n)}</span>${c.show ? `<span class="c-price">${c.show}</span>` : c.p ? `<span class="c-price">＋${yen(c.p)}</span>` : ''}
      </label>`).join('')}</div></div>`;
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

  sheetBody.onchange = e => {
    const g = item.groups.find(x => x.id === e.target.name);
    if (!g) return;
    if (g.type === 'count') {
      // 「なし」を押したら 0 個。外したら、また「まだ選んでいない」に
      sel[g.id] = e.target.checked ? 0 : null;
      $(`.stepper[data-id="${g.id}"] b`, sheetBody).textContent = 0;
      return refresh();
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
      tab: 'menu', title: 'カート', back: '#menu',
      html: `<div class="empty">${ICON.cart}<p>カートは空です</p><a class="btn btn-main" href="#menu">メニューを見る</a></div>`,
    };
  }
  const lines = cart.map(cartLine);
  const meals = cartMeals();
  const bulk = meals >= TAKEOUT.bulkMin;
  return {
    tab: 'menu', title: 'カート', back: '#menu',
    html: `
      <div class="lines">${lines.map(l => `
        <div class="line">
          ${photo(l.item, 'thumb sm')}
          <div class="line-txt"><b>${esc(l.name)}</b>${l.opts.length ? `<small>${esc(l.opts.join(' / '))}</small>` : ''}<em>${yen(l.unit * l.qty)}</em></div>
          <span class="stepper"><button data-act="cq" data-arg="${l.key}:-1" aria-label="減らす">${l.qty === 1 ? '<small>削除</small>' : '−'}</button><b>${l.qty}</b><button data-act="cq" data-arg="${l.key}:1" aria-label="増やす">＋</button></span>
        </div>`).join('')}
      </div>
      <a class="add-more" href="#menu">＋ 他の商品も選ぶ</a>
      <div class="summary"><div class="sum"><span>合計（税込）</span><b>${yen(cartTotal())}</b></div></div>
      ${meals ? `<p class="meals">ハンバーグBOX・定食 <b>${meals}食</b>${bulk ? '' : `・一番早くて${leadFor(meals)}分後に受け取れます`}</p>` : ''}
      ${bulk ? `<p class="notice warn">${ICON.truck}<span>${TAKEOUT.bulkMin}食以上は大量注文です。下の「配達・大量注文を申請する」から申請してください。お店が確認してから確定します。</span></p>` : ''}
      <p class="pay-note">${esc(TAKEOUT.payNote)}</p>
      <div class="foot foot-2">
        ${bulk ? '' : '<a class="btn btn-main btn-block" href="#checkout">受け取り時間を選ぶ</a>'}
        <a class="btn ${bulk ? 'btn-main' : 'btn-sub'} btn-block" href="#request">${ICON.truck}配達・大量注文を申請する</a>
      </div>`,
  };
}

/* ---------------------------------------------------------------------
 *  受け取りとお名前 → 注文
 *  「できしだい」（今日いちばん早く）か「時間を指定」。いちばん早い時間は食数で変わる（TAKEOUT.leadByMeals）
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
    tab: 'menu', title: '受け取りとお名前', back: '#cart',
    html: `
      <h2 class="sec">受け取りの時間</h2>
      <div class="modes">
        <button class="mode ${pick.mode === 'asap' ? 'on' : ''}" data-act="mode" data-arg="asap" ${asap ? '' : 'disabled'}>
          <b>できしだい</b><small>${asap ? `今日 ${hhmm(asap)}頃（約${lead}分後）` : '今日はもう受け取れません'}</small></button>
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
      <h2 class="sec">お名前と電話番号</h2>
      <label class="field"><span>お名前（受け取りのときにお呼びします）</span><input id="f-name" autocomplete="name" value="${esc(ME.name)}" placeholder="例：豊田 太郎"></label>
      <label class="field"><span>電話番号</span><input id="f-tel" type="tel" inputmode="tel" autocomplete="tel" value="${esc(ME.tel)}" placeholder="例：090-1234-5678"></label>
      <label class="field"><span>ご要望（なくても構いません）</span><textarea id="f-memo" rows="2" placeholder="例：お箸を2膳ください"></textarea></label>
      <h2 class="sec">ご注文の内容</h2>
      ${linesHtml(cart.map(cartLine), cartTotal())}
      <p class="pay-note">${esc(TAKEOUT.payNote)}</p>
      <div class="foot"><button class="btn btn-main btn-block" data-act="submit" ${ok ? '' : 'disabled'}>${!accepting ? 'ただいま注文を受け付けていません' : !ok ? '受け取りできる日がありません' : 'この内容で注文する'}</button></div>`,
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

const toHalf = s => s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[－ー‐―−]/g, '-');

/** お名前・電話番号・ご要望を読む（足りなければ知らせて null）。p は入れ物の id の頭（f／r） */
function readContact(p) {
  const name = $(`#${p}-name`).value.trim();
  const tel = toHalf($(`#${p}-tel`).value.trim());
  const memo = $(`#${p}-memo`)?.value.trim() || '';
  const digits = tel.replace(/[^0-9]/g, '');
  if (!name) { $(`#${p}-name`).focus(); toast('お名前を入れてください', 'warn'); return null; }
  if (digits.length < 10 || digits.length > 11) { $(`#${p}-tel`).focus(); toast('電話番号を確かめてください', 'warn'); return null; }
  return { name, tel, memo };
}

/** 注文（申請）を作って保存し、注文の様子の画面へ */
function placeOrder(fields) {
  const now = new Date();
  const lines = cart.map(cartLine).map(l => ({ id: l.item.id, name: l.name, opts: l.opts, unit: l.unit, qty: l.qty }));
  const order = {
    id: 'o' + now.getTime(), no: nextOrderNo(now), date: dateKey(now), createdAt: now.toISOString(),
    lines, total: cartTotal(), meals: cartMeals(), member: ME.no, ...fields,
    times: { [fields.status]: now.toISOString() },
  };
  saveOrders([...getOrders(), order]);
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

function submitOrder() {
  if (cartMeals() >= TAKEOUT.bulkMin) { location.hash = '#request'; return; }
  const lead = checkoutLead();
  let pickupAt;
  if (pick.mode === 'asap') {
    const t = asapTime(new Date(), lead);
    if (!t) return toast('今日はもう「できしだい」で受け取れません。時間を指定してください', 'warn');
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
  const c = readContact('f');
  if (!c) return;
  if (!DB.get('accepting', true)) return toast('ただいま注文を受け付けていません', 'warn');
  placeOrder({ ...c, kind: 'pickup', asap: pick.mode === 'asap', pickupAt, status: 'new' });
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
      tab: 'menu', title: '配達・大量注文の申請', back: cart.length ? '#cart' : '#menu',
      html: `
        <p class="lead">配達・大量注文は、メニューを選んでカートに入れてから申請します。</p>
        ${rules}
        <p class="notice">${ICON.cart}<span>カートは空です。<small>お店で受け取るなら、${TAKEOUT.bulkMin - 1}食までは、普通のテイクアウト注文（できしだい・時間指定）からどうぞ。</small></span></p>
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
    tab: 'menu', title: '配達・大量注文の申請', back: '#cart',
    html: `
      ${rules}
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
      <h2 class="sec">お名前と電話番号</h2>
      <label class="field"><span>お名前（ご担当の方）</span><input id="r-name" autocomplete="name" value="${esc(ME.name)}" placeholder="例：豊田 太郎"></label>
      <label class="field"><span>電話番号（お店から確認のお電話をします）</span><input id="r-tel" type="tel" inputmode="tel" autocomplete="tel" value="${esc(ME.tel)}" placeholder="例：090-1234-5678"></label>
      <label class="field"><span>ご要望（なくても構いません）</span><textarea id="r-memo" rows="3" placeholder="例：お箸を20膳、領収書の宛名は◯◯株式会社"></textarea></label>
      <h2 class="sec">ご注文の内容（${meals}食）</h2>
      ${linesHtml(cart.map(cartLine), cartTotal())}
      <a class="add-more" href="#cart">内容を直す（カートへ）</a>
      <p class="pay-note">まだ確定していません。お店が承認したら確定します。<span id="r-pay">${esc(payNoteOf(req.kind, meals))}</span></p>
      <div class="foot"><button class="btn btn-main btn-block" data-act="request" ${d ? '' : 'disabled'}>この内容で申請する</button></div>`,
  };
}

function submitRequest() {
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
  const c = readContact('r');
  if (!c) return;
  placeOrder({ ...c, kind, pickupAt: slot, address, address2, status: 'request' });
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
        <div><small>${whenWord(o)}${o.status === 'request' ? '（ご希望）' : ''}${o.asap ? '（できしだい）' : ''}</small><b>${dayLabel(t)} ${hhmm(t)}${o.asap ? '頃' : ''}</b>${ACTIVE.includes(o.status) && o.status !== 'request' ? `<small>${untilText(o.pickupAt)}</small>` : ''}</div>
      </div>
      ${o.status === 'canceled' ? `<p class="notice warn">この${req ? '申請' : '注文'}は取り消しになりました。</p>`
        : o.status === 'declined' ? `<p class="notice warn">${ICON.phone}<span>お店から、この申請はお受けできないとの連絡がありました。${o.declineNote ? `<small>お店から：${esc(o.declineNote)}</small>` : ''}<small>ご相談はお電話でどうぞ。</small></span></p>` : `
        <ol class="track">${steps.map((s, i) => `
          <li class="${i < step || o.status === 'done' ? 'past' : i === step ? 'now' : ''}"><i>${i < step || o.status === 'done' ? ICON.check : ''}</i><span>${statusLabel(o, s)}</span></li>`).join('')}
        </ol>
        <p class="track-msg tm-${o.status}">${statusMsg(o)}</p>`}
      <h2 class="sec">ご注文の内容${o.meals ? `（${o.meals}食）` : ''}</h2>
      ${linesHtml(o.lines, o.total)}
      <p class="pay-note">${o.kind === 'delivery' ? esc(TAKEOUT.deliveryPayNote + (needsFee(o) && o.status === 'request' ? '配達料は、承認のときにお店からお知らせします。' : '')) : esc(TAKEOUT.payNote)}</p>
      <dl class="info">
        <dt>お名前</dt><dd>${esc(o.name)} 様</dd>
        <dt>電話番号</dt><dd>${esc(o.tel)}</dd>
        ${o.kind === 'delivery' ? `<dt>お届け先</dt><dd>${esc(o.address)}${o.address2 ? `<br>${esc(o.address2)}` : ''}</dd>` : ''}
        ${o.memo ? `<dt>ご要望</dt><dd>${esc(o.memo)}</dd>` : ''}
      </dl>
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

function viewStamp() {
  const s = getStamps();
  const on = stampOnCard(s.total);
  const cardNo = Math.floor(Math.max(s.total - 1, 0) / STAMP.goal) + 1;
  const next = STAMP.rewards.find(r => r.at > on);
  const coupons = s.coupons.filter(c => !c.usedAt);
  const doneToday = stampedToday();
  const useOk = canUseCoupon();
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
    return `<span class="cell ${n <= on ? 'got' : ''} ${r ? 'gift' : ''} ${r?.goal ? 'goal' : ''} ${isNew ? 'new' : ''}" style="--rot:${(n * 47) % 23 - 18}deg${isNew ? `;animation-delay:${(n - from - 1) * 0.15}s` : ''}">${mark}</span>`;
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
        <p class="sc-next">${next ? `あと <b>${next.at - on}</b> 個で「${esc(couponTitle(next.options))}」` : 'ゴール！ 次のスタンプから新しいカードになります。'}</p>
      </div>
      <button class="btn btn-main btn-block" data-act="stamp" ${doneToday ? 'disabled' : ''}>${doneToday ? '今日のスタンプはもらいました' : `${ICON.qr}QRを読んでスタンプをもらう`}</button>
      <p class="hint">お店に置いてあるQRを読むと、1個たまります。お店の中（駐車場を含む）にいるときだけ読めます（位置情報を使います）。テイクアウトは、受け取りのときに自動で1個たまります。スタンプは1日${STAMP.perDay}個までです（初回登録の${STAMP.welcome.points}ポイントは別）。</p>
      ${coupons.length ? `
        <h2 class="sec">使える特典</h2>
        ${useOk ? '' : `<p class="notice">${ICON.check}<span>今日はもう特典を使いました。<small>特典は1日${STAMP.couponsPerDay}枚までです（他の特典とは一緒に使えません）。また次のご来店でどうぞ。</small></span></p>`}
        <div class="coupons">${coupons.map(c => `
          <div class="coupon">${ICON.gift}<div><b>${esc(c.title)}</b><small>${esc(c.label || `${c.at}個たまった特典`)}</small></div><button class="btn btn-small" data-act="coupon" data-arg="${c.id}" ${useOk ? '' : 'disabled'}>使う</button></div>`).join('')}
        </div>
        <p class="hint">特典は1日${STAMP.couponsPerDay}枚まで。他の特典とは一緒に使えません。</p>` : ''}
      <h2 class="sec">特典</h2>
      <ul class="rewards">
        <li class="${ME.registeredAt ? 'done' : ''}"><span>登録</span><b>${STAMP.welcome.points}ポイント ＋ ${esc(couponTitle(STAMP.welcome.options))}</b></li>
        ${STAMP.rewards.map(r => `<li class="${on >= r.at ? 'done' : ''} ${r.goal ? 'goal' : ''}"><span>${r.at}個${r.goal ? '<small>ゴール</small>' : ''}</span><b>${esc(couponTitle(r.options))}</b></li>`).join('')}
      </ul>
      <p class="hint">「または」の特典は、どれか1つをサービスします。使うときに選んでください。</p>
      <h2 class="sec">スタンプの履歴</h2>
      ${s.log.length
        ? `<ul class="hist">${s.log.slice(-10).reverse().map(l => `<li><span>${mdw(new Date(l.at))} ${hhmm(new Date(l.at))}</span><b>${esc(l.via)}</b></li>`).join('')}</ul>`
        : '<p class="hint">まだありません。</p>'}`,
    after: fresh ? () => {
      stampSeen = on;
      FX.count($('.sc-count em'), from, on);
      setTimeout(() => FX.confettiFrom($$('.cell.new').pop(), on === STAMP.goal ? 'party' : 'pop'), 450);
    } : null,
  };
}

/** 初めての方へ：会員登録（お名前と電話番号）で1ポイントとバニラアイス */
function welcomeBox() {
  return `<div class="welcome">
      <div class="w-head">${ICON.gift}<div><b>初めての方へ</b><small>会員登録で <em>${STAMP.welcome.points}ポイント</em> ＋ <em>${esc(couponTitle(STAMP.welcome.options))}</em> をサービス</small></div></div>
      <p>お名前と電話番号を登録すると、すぐにもらえます。今日お店のQRも読むと、合わせて${STAMP.welcome.points + STAMP.perDay}ポイントになります。</p>
      <label class="field"><span>お名前</span><input id="w-name" autocomplete="name" value="${esc(ME.name)}" placeholder="例：豊田 太郎"></label>
      <label class="field"><span>電話番号</span><input id="w-tel" type="tel" inputmode="tel" autocomplete="tel" value="${esc(ME.tel)}" placeholder="例：090-1234-5678"></label>
      <button class="btn btn-main btn-block" data-act="register" data-arg="w">登録して${STAMP.welcome.points}ポイントもらう</button>
    </div>`;
}

/** 会員登録（マイページの保存も同じ）。はじめてのときだけ、初回登録の特典を渡す。★本番は、同じ電話番号の2回目をサーバーで止める */
function register(p) {
  const c = readContact(p);
  if (!c) return;
  Object.assign(ME, { name: c.name, tel: c.tel });
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
  const goal = r.on === STAMP.goal;
  const next = STAMP.rewards.find(x => x.at > r.on);
  const prevAt = Math.max(0, ...STAMP.rewards.filter(x => x.at <= r.on).map(x => x.at));
  const from = Math.max(0, r.on - 1);
  openSheet(`
    <div class="stamped ${goal ? 'goal' : ''}">
      <div class="st-stage"><span class="st-ring"></span><span class="big-stamp"><img src="img/logo.png" alt=""></span></div>
      <h2>${esc(goal ? 'ゴール！ おめでとうございます' : title)}</h2>
      <p class="sc-count"><em>${FX.calm ? r.on : from}</em> / ${STAMP.goal}</p>
      ${next ? `<p class="st-next">次の特典まで あと <b>${next.at - r.on}</b> 個</p>
        <div class="sc-bar" aria-hidden="true"><i style="--p:${Math.round((r.on - prevAt) / (next.at - prevAt) * 100)}%"></i></div>` : ''}
      ${r.got.map(g => `<p class="got-gift">${ICON.gift}特典「${esc(g.title)}」をもらいました</p>`).join('')}
      ${title !== 'スタンプがたまりました' && !stampedToday() ? '<p class="hint">今日お店のQRを読むと、もう1ポイントたまります。</p>' : ''}
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
  if (!canUseCoupon()) return toast(`特典は1日${STAMP.couponsPerDay}枚までです（今日はもう使いました）`, 'warn');
  const opts = c.options || [c.title];
  openSheet(`
    <button class="sheet-x" data-s="close" aria-label="閉じる">×</button>
    <div class="coupon-big">
      <p class="cb-label">特典券${c.label ? `・${esc(c.label)}` : ''}</p>
      <h2>${opts.length > 1 ? 'どれか1つをサービス' : `${esc(opts[0])}をサービス`}</h2>
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
    if (!canUseCoupon()) { closeSheet(); return toast(`特典は1日${STAMP.couponsPerDay}枚までです`, 'warn'); }
    if (!confirm(`「${chose}」で、この特典を使用済みにします。よろしいですか？`)) return;
    const s = getStamps();
    Object.assign(s.coupons.find(x => x.id === id), { usedAt: new Date().toISOString(), chose });
    DB.set('stamps', s);
    closeSheet();
    render(true);
    toast(`特典を使いました（${chose}）`);
    FX.confetti({ kind: 'pop' });
  };
}

/* ---------------------------------------------------------------------
 *  お店
 * --------------------------------------------------------------------- */

function viewShop() {
  const q = encodeURIComponent(SHOP.address);
  const row = (icon, label, value, link = '') => `<li>${icon}<div><small>${label}</small><b>${value}</b></div>${link}</li>`;
  return {
    tab: 'shop', title: 'お店の情報',
    html: `
      <img class="shop-photo" src="${SHOP.shopPhoto}" alt="">
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
        ${row(ICON.truck, '配達', esc(TAKEOUT.deliveryNote) + (SHOP.contactUrl ? `<span class="sub-line"><a href="${esc(SHOP.contactUrl)}" target="_blank" rel="noopener">ホームページのお問い合わせフォーム ›</a></span>` : ''), '<a class="mini" href="#request">申請</a>')}
        ${row(ICON.insta, 'Instagram', '@baguru.hamburg', `<a class="mini" href="${SHOP.instagram}" target="_blank" rel="noopener">見る</a>`)}
      </ul>
      <div class="map"><iframe src="https://www.google.com/maps?q=${q}&output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="地図"></iframe></div>
      <h2 class="sec">店内のメニュー</h2>
      <p class="hint">お店でお召し上がりのメニューです（アプリからは注文できません）。価格は税込です。テイクアウトは「注文」からどうぞ。</p>
      <div class="dine">${DINE_IN.map((c, i) => `
        <details ${i === 0 ? 'open' : ''}>
          <summary>${esc(c.name)}<small>${c.items.length}品</small></summary>
          ${c.note ? `<p class="dine-note">${esc(c.note)}</p>` : ''}
          <ul>${c.items.map(dineItem).join('')}</ul>
        </details>`).join('')}
      </div>`,
  };
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
  const pic = i.img ? `<img class="dine-pic" src="img/menu/${i.img}" alt="" loading="lazy">` : '';
  return `<li class="${pic ? 'has-pic' : ''}">${pic}<div><b>${esc(i.n)}</b>${i.d ? `<small>${esc(i.d)}</small>` : ''}${i.sizes ? price : ''}</div>${i.sizes ? '' : price}</li>`;
}

/* ---------------------------------------------------------------------
 *  マイページ
 * --------------------------------------------------------------------- */

function viewMe() {
  const mine = myOrders().slice().reverse();
  return {
    tab: 'me', title: 'マイページ',
    html: `
      <div class="member"><img src="img/logo.png" alt=""><div><small>会員番号</small><b>${ME.no}</b></div></div>
      <h2 class="sec">${ME.registeredAt ? 'お名前と電話番号' : '会員登録'}</h2>
      <p class="hint">${ME.registeredAt ? 'テイクアウトの注文のときに、最初から入ります。' : `登録すると、スタンプ${STAMP.welcome.points}ポイントと${esc(couponTitle(STAMP.welcome.options))}のサービス券をお渡しします。テイクアウトの注文のときにも、最初から入ります。`}</p>
      <label class="field"><span>お名前</span><input id="m-name" autocomplete="name" value="${esc(ME.name)}"></label>
      <label class="field"><span>電話番号</span><input id="m-tel" type="tel" inputmode="tel" autocomplete="tel" value="${esc(ME.tel)}"></label>
      <button class="btn ${ME.registeredAt ? 'btn-sub' : 'btn-main'}" data-act="register" data-arg="m">${ME.registeredAt ? '保存する' : `登録して${STAMP.welcome.points}ポイントもらう`}</button>
      <h2 class="sec">ご予約のリクエスト</h2>
      ${reservesHtml()}
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
      ${installRow()}
      <h2 class="sec">この試作版について</h2>
      <div class="about">
        <p>データはこの端末のブラウザの中だけに保存しています。本物のお店にはまだ注文が届きません。</p>
        <p>同じブラウザで <a href="order.html" target="_blank">お店の画面（order.html）</a> を開くと、注文を受けて「できあがり」にする流れを試せます。</p>
        <button class="btn btn-sub danger" data-act="reset">試作のデータを全部消す</button>
      </div>`,
  };
}

/* ---------------------------------------------------------------------
 *  下から出る画面・おしらせ
 * --------------------------------------------------------------------- */

function openSheet(html) {
  sheetBody.innerHTML = html;
  sheetBody.scrollTop = 0;
  sheet.hidden = false;
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

const ACTIONS = {
  item: id => openItem(id),
  cat: id => $('#cat-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
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
    $$('.modes .mode').forEach(b => b.classList.toggle('on', b.dataset.arg === m));
    $('#timePick').hidden = m !== 'time';
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
  submit: () => submitOrder(),
  request: () => submitRequest(),
  cancel: id => {
    const o = getOrders().find(x => x.id === id);
    if (!o || !['new', 'request'].includes(o.status)) return toast('お店が受け付けた後は、お電話でご連絡ください', 'warn');
    if (!confirm(`${o.status === 'request' ? '申請' : '注文'}番号 ${o.no} を取り消します。よろしいですか？`)) return;
    updateOrder(id, { status: 'canceled', canceledBy: 'お客様' });
    lastStatus[id] = 'canceled';
    render(true);
    toast('注文を取り消しました');
  },
  stamp: () => openScanner(),
  coupon: id => openCoupon(id),
  allergy: () => openAllergyList(),
  install: () => startInstall(),
  'install-guide': () => openInstallGuide(),
  'install-hide': () => hideInstallCard(),
  register: p => register(p),
  reset: () => {
    if (!confirm('注文・スタンプ・会員番号など、試作のデータを全部消します。よろしいですか？')) return;
    DB.clearAll();
    location.hash = '#home';
    location.reload();
  },
  close: () => closeSheet(),
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  e.preventDefault();
  ACTIONS[el.dataset.act]?.(el.dataset.arg, el);
});

$('#back').addEventListener('click', e => { location.hash = e.currentTarget.dataset.to || (ORDER_ONLY ? '#menu' : '#home'); });
window.addEventListener('hashchange', () => { if (routeName() !== 'order') justOrdered = null; render(); });

/* ---------------------------------------------------------------------
 *  お店の画面が書き換えたとき（注文の様子・スタンプ・受付の停止）
 * --------------------------------------------------------------------- */

DB.onChange(key => {
  if (key === 'orders') {
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
  }
  if (key === 'stamps') {
    const s = getStamps();
    // お店がお渡し済みにして、スタンプがたまったとき（スタンプカードを開いていれば、新しいマスを押す動きも出る）
    if (s.total > lastStampTotal && !ORDER_ONLY) { toast('スタンプが1個たまりました', 'good'); FX.confetti({ kind: 'pop' }); }
    lastStampTotal = s.total;
  }
  if (!NO_LIVE.includes(routeName()) && !sheet.classList.contains('show')) render(true);
});

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

$$('[data-icon]').forEach(el => el.insertAdjacentHTML('afterbegin', ICON[el.dataset.icon]));
render();
syncDays();
if (stampParam) claimStamp(stampParam);

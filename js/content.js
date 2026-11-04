/* =====================================================================
 *  公式アプリの中身を、バグるマネージ（../バグるマネージ/）で直した分で書きかえる（2026-10-30 ko-dai さんの指示）
 *  ・data.js が「もと」。受け口（予約ボードの受け口）には、もとと違うところだけを置く（content。受け口の appContent・saveAppContent）
 *  ・アプリは起動したときに、前に読んだ分（この端末の控え。DB 'content'）をすぐ重ね、そのあと受け口から読み直す（CONTENT_EVERY に1回まで）。
 *    変わっていたら描き直す。読めないときは、前の控え（無ければ data.js）のまま
 *  ・applyContent(c) は、何度呼んでも同じになる（毎回「もと」に戻してから重ねる）。知らない値・形の違う値は使わずに捨てる
 *  ・このファイルは data.js だけを使って読みこめる（バグるマネージも読む）。DB・baguruLib を使うのは refreshContent だけ
 *
 *  中身の形（content）
 *    news:    [{ date: 'YYYY-MM-DD', title, body }]           … あれば、お知らせをこれに置きかえる（無ければ data.js の NEWS）
 *    notice:  { text, until: 'YYYY-MM-DD' | '' }             … ホームとメニューのいちばん上に出す、お店からの一言（until の日まで）
 *    items:   { 商品id: { price, regular, soldOut, hidden } }   … テイクアウトの商品。regular はアサイーのレギュラーの値段
 *    choices: { 'グループid/名前': { p, soldOut } }            … ご飯の量・セット・トッピングなど。同じグループを使う商品すべてに効く
 *    dine:    { '見出し/名前': { p, sizes: [値段…], hidden } } … 店内のメニュー（sizes は data.js の sizes と同じ順）
 *    rewards: { マス: { options: [..], title, picks: [..] } }  … スタンプの特典（title・picks はゴールだけ）
 *    texts:   { 元の文: { to: 新しい文, s: 1 | 0 } }           … 画面に出る文章（マネージの「文章」のタブ。元の文の一覧は 道具/文章を集める.py が作る）
 *             s が 1 なら文の一部としても置きかえる（前後に数字などが入る文）。0 なら、字のかたまり全体が同じときだけ
             x が 1 なら、枠ごとの形（元の文の {1}・{2}… に、数字などその時の字が入る。マネージの APP_FRAMES）。
               字のかたまり全体がこの形に合えば、直した文の {1} などにその時の字を入れて出す（2026-11-04 から）
             x が 2 なら、文の途中に飾りの字（<b>・<em> など）が入る文。元の文は、飾りの所を {1}・{2}… にした形（runSig）。
               飾りはそのまま残し、そのあいだの字だけを入れかえる（runMark。2026-11-04 から）
 *             ★画面に出た字（テキストノード）を置きかえるだけなので、アプリの動きは変わらない。HTML としては読まない（字のまま出る）
    menu:    { cats, order, added, removed, dineCats, dineOrder, dineAdded, dineRemoved } … 商品を足す・消す・並べる（下の applyMenu。2026-11-04 から）
    photos:  { 'hero' | 'shop' | 'item:商品id' | 'dine:見出し/名前': { id } } … 写真（マネージの「写真」のタブ。2026-11-04 から）。
             id は、マネージが受け口の savePhoto で Google ドライブに置いた写真の番号。出すときの URL は photoUrl が作る（1か所だけ）
 * ===================================================================== */

const CONTENT_EVERY = 3 * 60000;   // 受け口に読みに行くのは、この間隔に1回まで

/** 選ぶもののグループ（同じものは1つ。アサイーのサイズは商品ごとの値段なので items の regular で直す） */
const contentGroups = () => [...new Set(ITEMS.flatMap(i => i.groups || []))].filter(g => g.id !== 'size');

/** data.js の「もと」の値（このファイルを読んだときに控える） */
const CONTENT_BASE = {
  items: ITEMS.map(i => ({ price: i.price, regular: i.groups?.find(g => g.id === 'size') ? i.price + i.groups.find(g => g.id === 'size').choices[1].p : null })),
  groups: contentGroups().map(g => ({ g, ps: g.choices.map(c => c.p) })),
  dine: DINE_IN.map(cat => cat.items.map(it => ({ p: it.p ?? null, sizes: it.sizes ? it.sizes.map(s => s[1]) : null }))),
  news: NEWS.slice(),
  rewards: STAMP.rewards.map(r => ({ options: r.options.slice(), title: r.title, picks: r.picks ? r.picks.slice() : undefined })),
  photos: { hero: SHOP.hero, shop: SHOP.shopPhoto, items: ITEMS.map(i => ({ img: i.img || '', cut: !!i.cut })), dine: DINE_IN.map(cat => cat.items.map(it => it.img || '')) },
};

/* ---- 写真（マネージの「写真」のタブ） ----
 *  受け口（savePhoto）が Google ドライブに置いた写真の id から、出す URL を作る。★URL の形は、ここ1か所だけで決める
 *  （ドライブの「リンクを知っている人は見られる」の写真。形が変わったら、ここだけ直す） */
const PHOTO_ID = /^[A-Za-z0-9_-]{10,100}$/;   // 受け口（版 2026-11-04b）の saveAppContent が確かめる形と同じ
// この Mac の ?test では、にせの受け口が写真を配る（/api/photo/id）。
// ★lh3 の形は Google が約束している形ではない。出なくなったら、ここを直す（ドライブの縮小の形は、公開の確かめがドライブのアドレスとして止めるので使わない。2026-11-04）
const PHOTO_TEST = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /[?&]test\b/.test(location.search);
const photoUrl = id => (PHOTO_TEST ? `/api/photo/${id}` : `https://lh3.googleusercontent.com/d/${id}=w1280`);
/** 画面に出す写真の場所。data.js の写真（img/menu/ の名前）か、マネージで入れた写真（https の URL。この Mac の ?test では /api/photo/） */
const photoSrc = img => (/^(https:\/\/|\/api\/photo\/)/.test(img) ? img : `img/menu/${img}`);

/* ---- 商品を足す・消す・並べる（menu。2026-11-04 ko-dai さんの指示：「マネージで商品の追加や削除、同カテゴリー内での順番の入れ替え、カテゴリー自体の順番の入れ替え」） ----
 *  menu: {
 *    cats:  [カテゴリーid…]                 … テイクアウトのカテゴリーの順。書いていないものは、後ろに data.js の順で
 *    order: { カテゴリーid: [商品id…] }     … カテゴリーの中の商品の順（同じ）
 *    added: [{ id: 'n_…', cat, name, sub, desc, price, regular, like }]
 *                                           … 足した商品。like は「選ぶもの」を同じにする data.js の商品の id（ソース・ご飯の量など）。
 *                                             'acai' はアサイーボウルと同じ（サイズとトッピング。regular がレギュラーの値段）。'' は選ぶものなし
 *    removed: [商品id…]                     … 消した data.js の商品。メニューに出さない（前の注文・カートで名前を引けるよう、ITEM_BY_ID には残す）
 *    dineCats: [見出し…]、dineOrder: { 見出し: [名前 か 足した商品の id…] }
 *    dineAdded: [{ id: 'm_…', cat: 見出し, n, d, p }]、dineRemoved: ['見出し/名前'…]   … 店内のメニュー（同じ考え方）
 *  }
 *  ★売り切れ・出さない・値段の直し・写真は、今までどおり items・dine・photos に、商品の id（店内は 見出し/名前）で入れる。
 *    足した商品の値段だけは added の中に持つ（items の値段の直しは、data.js の値段からの直しなので）
 *  ★毎回 data.js の並びから作り直す（applyContent は何度呼んでも同じになる）。Order受付（バグるOrder受付）も、この ITEMS・CATEGORIES を使う */
const MENU_BASE = { items: ITEMS.slice(), cats: CATEGORIES.slice(), dine: DINE_IN.map(cat => ({ cat, items: cat.items.slice() })) };
const ITEM_BASE = new Map(ITEMS.map((i, k) => [i, k]));                                  // data.js の商品 → CONTENT_BASE の番号
const DINE_BASE = new Map(DINE_IN.flatMap((cat, a) => cat.items.map((it, b) => [it, [a, b]])));
const MENU_ID = /^[nm]_[a-z0-9]{6,16}$/;
/** list を、want の順（key が同じもの）に並べる。want に無いものは、後ろにもとの順で */
function orderBy(list, key, want) {
  const pos = new Map((Array.isArray(want) ? want : []).map((k, i) => [k, i]));
  return list.map((x, i) => [x, pos.has(key(x)) ? pos.get(key(x)) : 1e6 + i]).sort((a, b) => a[1] - b[1]).map(([x]) => x);
}
const cnum = v => (Number.isInteger(v) && v >= 0 && v <= 99999 ? v : null);
const ctext = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
/** 足した商品を、data.js の商品と同じ形にする */
function addedItem(a) {
  const price = cnum(a.price) ?? 0, name = ctext(a.name, 60), desc = ctext(a.desc, 120) || undefined, sub = ctext(a.sub, 40) || undefined;
  if (a.like === 'acai') {
    const reg = Math.max(price, cnum(a.regular) ?? price);
    return { ...acai(a.id, name, desc, undefined, price, reg), cat: a.cat, sub, added: true, price0: price, regular0: reg };
  }
  const like = MENU_BASE.items.find(i => i.id === a.like && !i.groups.some(g => g.id === 'size'));
  return { id: a.id, cat: a.cat, name, sub, desc, price, groups: like ? like.groups : [], added: true, price0: price };
}
function applyMenu(m) {
  const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []), map = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  // テイクアウト：足した商品は毎回作り直す。消した data.js の商品は、並びから外して「出さない」にする
  MENU_BASE.items.forEach(i => { delete i.removed; });
  Object.keys(ITEM_BY_ID).forEach(id => { if (!MENU_BASE.items.some(i => i.id === id)) delete ITEM_BY_ID[id]; });
  const catIds = new Set(MENU_BASE.cats.map(c => c.id)), seen = new Set(Object.keys(ITEM_BY_ID));
  const added = arr(m.added, 80).filter(a => a && MENU_ID.test(a.id) && !seen.has(a.id) && seen.add(a.id) && catIds.has(a.cat) && ctext(a.name, 60)).map(addedItem);
  added.forEach(i => { ITEM_BY_ID[i.id] = i; });
  const removed = new Set(arr(m.removed, 300).filter(x => typeof x === 'string'));
  const cats = orderBy(MENU_BASE.cats, c => c.id, arr(m.cats, 50)), ord = map(m.order);
  const all = [...MENU_BASE.items.filter(i => !removed.has(i.id)), ...added];
  CATEGORIES.splice(0, CATEGORIES.length, ...cats);
  ITEMS.splice(0, ITEMS.length, ...cats.flatMap(c => orderBy(all.filter(i => i.cat === c.id), i => i.id, arr(ord[c.id], 300))));
  MENU_BASE.items.forEach(i => { if (removed.has(i.id)) { i.removed = true; i.hidden = true; } });
  // 店内のメニュー
  const dcats = orderBy(MENU_BASE.dine, d => d.cat.name, arr(m.dineCats, 50)), dOrd = map(m.dineOrder);
  const dRemoved = new Set(arr(m.dineRemoved, 300).filter(x => typeof x === 'string')), dSeen = new Set();
  const dAdded = arr(m.dineAdded, 100).filter(a => a && MENU_ID.test(a.id) && !dSeen.has(a.id) && dSeen.add(a.id) && ctext(a.n, 60) && dcats.some(d => d.cat.name === a.cat));
  DINE_IN.splice(0, DINE_IN.length, ...dcats.map(d => d.cat));
  dcats.forEach(({ cat, items }) => {
    const mine = dAdded.filter(a => a.cat === cat.name).map(a => ({ n: ctext(a.n, 60), d: ctext(a.d, 120) || undefined, p: cnum(a.p) ?? 0, p0: cnum(a.p) ?? 0, added: a.id }));
    const list = [...items.filter(it => !dRemoved.has(contentKey.dine(cat, it))), ...mine];
    cat.items.splice(0, cat.items.length, ...orderBy(list, it => it.added || it.n, arr(dOrd[cat.name], 300)));
  });
}

/** お店からの一言（ホームとメニューの上に出す。無ければ null） */
let APP_NOTICE = null;

const contentKey = { choice: (g, c) => `${g.id}/${c.n}`, dine: (cat, it) => `${cat.name}/${it.n}` };

function applyContent(c) {
  c = c && typeof c === 'object' ? c : {};
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const num = v => (Number.isInteger(v) && v >= 0 && v <= 99999 ? v : null);
  const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const list = (v, max) => (Array.isArray(v) && v.length && v.every(x => text(x, max)) ? v.map(x => text(x, max)) : null);
  const show = n => '¥' + n.toLocaleString('ja-JP');

  // 商品を足す・消す・並べる（値段などを重ねる前に、並びを作り直す）
  applyMenu(obj(c.menu));
  // テイクアウトの商品：値段・売り切れ・出さない
  const items = obj(c.items);
  ITEMS.forEach(i => {
    const k = ITEM_BASE.get(i), b = k === undefined ? { price: i.price0, regular: i.regular0 ?? null } : CONTENT_BASE.items[k], o = obj(items[i.id]);
    i.price = num(o.price) ?? b.price;
    i.soldOut = o.soldOut === true;
    i.hidden = o.hidden === true;
    if (b.regular != null) {   // アサイー：ミニ（= price）とレギュラーの値段を、サイズの選ぶものに入れ直す
      const [mini, regular] = i.groups.find(g => g.id === 'size').choices, reg = Math.max(i.price, num(o.regular) ?? b.regular);
      regular.p = reg - i.price;
      mini.show = show(i.price);
      regular.show = show(reg);
    }
  });
  // 選ぶもの（ご飯の量・セット・トッピングなど）：足す値段・売り切れ
  const choices = obj(c.choices);
  CONTENT_BASE.groups.forEach(({ g, ps }) => g.choices.forEach((ch, k) => {
    const o = obj(choices[contentKey.choice(g, ch)]);
    ch.p = num(o.p) ?? ps[k];
    ch.soldOut = o.soldOut === true;
  }));
  // 店内のメニュー：値段・出さない
  const dine = obj(c.dine);
  DINE_IN.forEach(cat => cat.items.forEach(it => {
    const di = DINE_BASE.get(it), base = di ? CONTENT_BASE.dine[di[0]][di[1]] : { p: it.p0, sizes: null }, o = obj(dine[contentKey.dine(cat, it)]);
    if (base.p != null) it.p = num(o.p) ?? base.p;
    if (base.sizes) it.sizes.forEach((s, k) => { s[1] = num(Array.isArray(o.sizes) ? o.sizes[k] : null) ?? base.sizes[k]; });
    it.hidden = o.hidden === true;
  }));
  // お知らせ
  const news = Array.isArray(c.news)
    ? c.news.filter(n => n && /^\d{4}-\d{2}-\d{2}$/.test(n.date) && text(n.title, 80)).map(n => ({ date: n.date, title: text(n.title, 80), body: text(n.body, 600) || '' }))
    : null;
  NEWS.splice(0, NEWS.length, ...(news || CONTENT_BASE.news));
  // スタンプの特典
  const rewards = obj(c.rewards);
  STAMP.rewards.forEach((r, k) => {
    const b = CONTENT_BASE.rewards[k], o = obj(rewards[r.at]);
    r.options = list(o.options, 40) || b.options.slice();
    if (b.title !== undefined) r.title = text(o.title, 40) || b.title;
    if (b.picks) r.picks = list(o.picks, 20) || b.picks.slice();
  });
  // 写真：マネージで入れたものがあれば、それ。無ければ data.js の写真
  const ph = obj(c.photos), pid = k => { const o = obj(ph[k]); return typeof o.id === 'string' && PHOTO_ID.test(o.id) ? photoUrl(o.id) : null; };
  const pb = CONTENT_BASE.photos;
  SHOP.hero = pid('hero') || pb.hero;
  SHOP.shopPhoto = pid('shop') || pb.shop;
  ITEMS.forEach(i => {
    const u = pid('item:' + i.id), k = ITEM_BASE.get(i), b = k === undefined ? { img: '', cut: false } : pb.items[k];
    i.img = u || b.img || undefined;
    i.cut = u ? false : b.cut;   // 飲みものの切り抜き写真の見せ方は、data.js の写真のときだけ
    if (!i.img) delete i.img;
  });
  DINE_IN.forEach(cat => cat.items.forEach(it => {
    const u = pid('dine:' + contentKey.dine(cat, it)), di = DINE_BASE.get(it);
    it.img = u || (di ? pb.dine[di[0]][di[1]] : '') || undefined;
    if (!it.img) delete it.img;
  }));
  // 画面の文章
  setTexts(c.texts);
  // お店からの一言（until の日を過ぎたら出さない）
  const n = obj(c.notice), now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  APP_NOTICE = text(n.text, 200) && !(/^\d{4}-\d{2}-\d{2}$/.test(n.until) && n.until < today) ? { text: text(n.text, 200), until: /^\d{4}-\d{2}-\d{2}$/.test(n.until) ? n.until : '' } : null;
}

/* ---- 画面の文章：直した文に置きかえる（texts） ---- */
let TEXT_MAP = new Map(), TEXT_PART = null, TEXT_LOOSE = null, TEXT_TPL = [], TEXT_RUN = new Map(), RUN_TO = new WeakMap(), textsStarted = false;
const TEXT_SEEN = new WeakMap();                                                 // 置きかえたあとの字を覚える（同じ字を二度置きかえない）
const TEXT_FROM = new WeakMap();                                                 // 置きかえる前の字（アプリが書いた字。マネージの「画面で直す」が使う）
const TEXT_ATTRS = ['placeholder', 'aria-label', 'title', 'data-en'];

/** 枠ごとの形（'配達は{1}食以上…'）を、字のかたまり全体に合う形にする。{1} などは、何の字でも合う（空でも） */
function tplRe(key) {
  const nums = [], src = key.split(/\{(\d+)\}/).map((p, i) => {
    if (i % 2) { nums.push(Number(p)); return '([\\s\\S]*?)'; }
    return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  }).join('');
  return { re: new RegExp('^' + src + '$'), nums };
}
/** 枠ごとの形に合えば、直した文の {1} などに、画面のその時の字を入れて返す。合わなければ null */
function tplText(t, tpl, to) {
  const m = t.match(tpl.re);
  if (!m) return null;
  const val = {};
  tpl.nums.forEach((n, i) => { val[n] = m[i + 1]; });
  return to.replace(/\{(\d+)\}/g, (x, n) => val[n] ?? '');
}
function setTexts(c) {
  const all = Object.entries(c && typeof c === 'object' && !Array.isArray(c) ? c : {})
    .filter(([k, v]) => k.length <= 800 && v && typeof v.to === 'string' && v.to.trim() && v.to.length <= 800);
  const list = all.filter(([, v]) => v.x !== 1 && v.x !== 2);
  TEXT_TPL = all.filter(([, v]) => v.x === 1).map(([k, v]) => ({ ...tplRe(k), to: v.to }));
  TEXT_RUN = new Map(all.filter(([, v]) => v.x === 2).map(([k, v]) => [k, v.to]));
  RUN_TO = new WeakMap();
  TEXT_MAP = new Map(list.map(([k, v]) => [k, v.to]));
  const re = keys => (keys.length ? new RegExp(keys.sort((a, b) => b.length - a.length).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g') : null);
  TEXT_PART = re(list.filter(([, v]) => v.s).map(([k]) => k));
  TEXT_LOOSE = re(list.filter(([k]) => k.length >= 2).map(([k]) => k));
}

/** 字を置きかえる。loose … 全体が同じでなくても置きかえる（注文の文のように、言葉がつながっているもの） */
function textOf(s, loose = false) {
  if ((!TEXT_MAP.size && !TEXT_TPL.length) || !s) return s;
  const t = s.trim();
  if (TEXT_MAP.has(t)) return s.replace(t, () => TEXT_MAP.get(t));
  if (!loose) for (const tpl of TEXT_TPL) { const r = tplText(t, tpl, tpl.to); if (r !== null) return s.replace(t, () => r); }   // 枠ごと直した文
  const re = loose ? TEXT_LOOSE : TEXT_PART;
  return re ? s.replace(re, m => TEXT_MAP.get(m)) : s;
}

function textNode(n) {
  const v = n.nodeValue;
  if (TEXT_SEEN.get(n) === v) return;
  TEXT_FROM.set(n, v);
  putText(n, textFor(n));
  if (TEXT_EDIT) edMark(n);
}
/** その字のかたまりに入れる字（飾りの入る文を直したものが先。無ければ、ふつうの置きかえ） */
const textFor = n => (RUN_TO.has(n) ? RUN_TO.get(n) : textOf(TEXT_FROM.get(n) ?? n.nodeValue));

/* ---- 文の途中に飾りの字が入る文（x: 2） ----
 *  箱の子を、続いた「字のかたまり」と「飾り（display: inline の要素で、字のあるもの）」に分けたまとまりが run。アイコン・改行・ブロックの字で区切る。
 *  元の文の形は、字のかたまりは元の字、飾りは {1}・{2}…（runSig）。直した文の {1} などのあいだの字を、字のかたまりに順に入れる（runMark）。
 *  ★マネージが、飾りを消さず順も変えない形だけ保存する。飾りの中の字は変えない（中の字は、それぞれ別に直せる） */
const runText = x => x.nodeType === 3 || !!x.classList?.contains('t-br');
const runEl = x => x.nodeType === 1 && !runText(x) && !/^(svg|img|br|button|input|select|textarea)$/i.test(x.nodeName) && !!x.textContent.trim() && getComputedStyle(x).display === 'inline';
function runsOf(box) {
  const runs = [];
  let cur = [];
  const end = () => { if (cur.length) runs.push(cur); cur = []; };
  for (const x of box.childNodes) {
    if (runText(x)) cur.push({ x, n: x.nodeType === 3 ? x : x.firstChild });
    else if (runEl(x)) cur.push({ x, el: x });
    else if (x.nodeType === 1) end();
  }
  end();
  return runs.filter(r => r.some(s => s.el) && r.some(s => s.n && /[\u3041-\u30ff\u4e00-\u9fff]/.test(String(TEXT_FROM.get(s.n) ?? s.n.nodeValue))));
}
function runSig(run) {
  let k = 0;
  return run.map(s => (s.el ? `{${++k}}` : String((s.n && (TEXT_FROM.get(s.n) ?? s.n.nodeValue)) || '').replace(/\s+/g, ' '))).join('').trim();
}
/** 箱の中に、直した文と同じ形の run があれば、字のかたまりに入れる字を決める（入れるのは textNode・edRetext） */
function runMark(box) {
  if (!TEXT_RUN.size || box?.nodeType !== 1) return;
  for (const run of runsOf(box)) {
    const to = TEXT_RUN.get(runSig(run));
    if (to === undefined) continue;
    const segs = to.split(/\{\d+\}/);
    let slot = 0, used = false;
    run.forEach((s, i) => {
      if (s.el) {
        // 飾りの前に字のかたまりが無いのに、直した文ではそこに字があるときは、かたまりを足す
        if (!used && segs[slot]) { const t = document.createTextNode(''); TEXT_FROM.set(t, ''); RUN_TO.set(t, segs[slot]); s.el.before(t); }
        slot++; used = false;
        if (i === run.length - 1 && segs[slot]) { const t = document.createTextNode(''); TEXT_FROM.set(t, ''); RUN_TO.set(t, segs[slot]); s.el.after(t); }
        return;
      }
      if (s.n) { RUN_TO.set(s.n, used ? '' : segs[slot] ?? ''); used = true; }
    });
  }
}
/** 字を入れる。マネージで改行した文は、改行したとおりに出す（親にまとめて指定すると、タグの間の改行まで出てしまうので、この字だけを包む） */
function putText(n, r) {
  if (n.nodeValue !== r) n.nodeValue = r;
  TEXT_SEEN.set(n, r);
  if (r !== TEXT_FROM.get(n) && r.trim().includes('\n') && n.parentNode && !n.parentNode.classList?.contains('t-br')) {
    const box = document.createElement('span');
    box.className = 't-br';
    n.parentNode.insertBefore(box, n);
    box.append(n);
  }
}
function textEl(el) {
  const seen = TEXT_SEEN.get(el) || {}, from = TEXT_FROM.get(el) || {};
  for (const a of TEXT_ATTRS) {
    const v = el.getAttribute?.(a);
    if (!v || seen[a] === v) continue;
    from[a] = v;
    const r = textOf(v);
    if (r !== v) el.setAttribute(a, r);
    seen[a] = r;
  }
  TEXT_SEEN.set(el, seen);
  if (Object.keys(from).length) TEXT_FROM.set(el, from);
  runMark(el);   // 子の字のかたまりより先に（TreeWalker は箱を先に見る）
  if (TEXT_EDIT) edMarkEl(el);
}
/** root の中の字を置きかえる。入力欄の中（お客様が書いた字）と、スクリプトには触らない */
function applyTexts(root = document.body) {
  if ((!TEXT_MAP.size && !TEXT_TPL.length && !TEXT_RUN.size && !TEXT_EDIT) || !root) return;   // マネージの「画面で直す」では、直した文が無くても見る（直せる文に印を付ける）
  if (root.nodeType === 3) { if (!/^(SCRIPT|STYLE|TEXTAREA)$/.test(root.parentNode?.nodeName || '')) textNode(root); return; }
  if (root.nodeType !== 1) return;
  textEl(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.nodeType === 1 && /^(SCRIPT|STYLE|TEXTAREA)$/.test(n.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === 3) textNode(n); else textEl(n); }
  document.title = textOf(document.title);
}
/** 公式アプリの起動のときに1回。★直した文が無いあいだは何も置きかえない。あとから増えたもの（画面の描き直し・おしらせ）は見張って置きかえる */
function startTexts() {
  if (textsStarted) return applyTexts();
  textsStarted = true;
  for (const f of ['confirm', 'alert']) { const o = window[f].bind(window); window[f] = m => o(textOf(String(m))); }
  applyTexts();
  new MutationObserver(list => {
    if (!TEXT_MAP.size && !TEXT_TPL.length && !TEXT_RUN.size && !TEXT_EDIT) return;
    for (const m of list) {
      if (m.type === 'characterData') applyTexts(m.target);
      else m.addedNodes.forEach(n => applyTexts(n));
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}

/* ---- バグるマネージの「アプリで見る」（2026-11-01 ko-dai さんの指示：改行などの見え方を、保存する前に確かめる） ----
 *  マネージが、公式アプリを画面の中に開く（iframe・?preview）。保存前の直しは postMessage で届く（下）。
 *  ★見え方を確かめるだけ：受け口から読み直さず、この端末の保存も変えず（DB はこの画面の中だけ）、注文などは動かさない（app.js の PREVIEW_STOP） */
const PREVIEW = window.parent !== window && /[?&]preview\b/.test(location.search);
/* ★2026-11-05（お店用アプリの引っ越しの段階1）：マネージが別の場所に引っ越すと、sessionStorage は読めなくなる。そこで、直しは postMessage で受け取る。
 *  ・開いたら（load）、マネージに { type: 'baguru-preview', kind: 'hello' } を送る。マネージが { type: 'baguru-manage', kind: 'preview', content, focus } を返す
 *  ・受けるのは、親の画面（parent）からで、場所が data.js の SHOP.manageOrigins のどれかのときだけ（この Mac では同じ場所 localhost も）
 *  ・前の渡し方（同じ場所の sessionStorage の bg.preview・bg.previewFocus）は、引っ越しの日（2026-11-05）に外した（場所が分かれて読めないため） */
const MANAGE_ORIGINS = new Set([...((typeof SHOP === 'object' && SHOP.manageOrigins) || []), ...(/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? [location.origin] : [])]);
const fromManage = e => e.source === parent && MANAGE_ORIGINS.has(e.origin);
let manageAt = '';   // 返事を送る先（届いた親の場所。分かるまでは、名指しの場所のどれにも送る。合わない場所には、ブラウザが届けない）
const toManage = msg => (manageAt ? [manageAt] : [...MANAGE_ORIGINS]).forEach(o => { try { parent.postMessage(msg, o); } catch (e) { /* 届かないだけ */ } });
let previewData = null;   // マネージから届いた直し { content, focus }
const previewContent = () => (previewData ? previewData.content : null);   // 届くまでは、ふだんの中身で描く
if (PREVIEW) {
  addEventListener('message', e => {
    if (!fromManage(e)) return;
    const d = e.data || {};
    if (d.type !== 'baguru-manage' || d.kind !== 'preview') return;
    manageAt = e.origin;
    previewData = { content: d.content && typeof d.content === 'object' && !Array.isArray(d.content) ? d.content : null, focus: typeof d.focus === 'string' ? d.focus : '' };
    applyContent(previewData.content);
    if (typeof render === 'function' && !(typeof sheet === 'object' && !sheet.hidden)) render(true);
    if (!TEXT_EDIT) setTimeout(previewFocus, 300);
  });
  addEventListener('load', () => toManage({ type: 'baguru-preview', kind: 'hello' }));
}
if (PREVIEW && typeof DB === 'object') {
  const mem = new Map(), read = DB.get.bind(DB);
  DB.get = (k, fallback) => (mem.has(k) ? mem.get(k) : read(k, fallback));
  DB.set = (k, v) => { mem.set(k, v); };
}
/** 確かめている文までスクロールして、枠で示す。見つからなかったことはマネージに知らせる */
function previewFocus() {
  const focus = previewData ? previewData.focus.trim() : '';
  if (!focus) return;
  const find = text => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue.includes(text) && !/SCRIPT|STYLE/.test(n.parentNode.nodeName)) return n.parentNode;
    return null;
  };
  const el = find(focus) || find(focus.split('\n')[0].trim());   // 文全体で探し、無ければ1行目で
  el?.scrollIntoView({ block: 'center' });
  el?.classList.add('t-flash');
  toManage({ type: 'baguru-preview', kind: 'focus', found: !!el });
}

/* ---- バグるマネージの「画面で直す」（2026-11-03 ko-dai さんの指示：ホームページの管理画面のように、実際の画面を直しているような感じで文章を直す） ----
 *  マネージが「アプリで見る」と同じ形で、公式アプリを中に開く（?preview&edit）。マネージの文章の一覧にある文を点線で囲み（.t-ed）、
 *  押した文の元の字をマネージに知らせる。マネージで打った文は、その場で画面の字を入れかえて見せる（保存はマネージがする）。
 *  「アプリを動かす」のあいだは、ふつうに押せる（商品を選ぶ画面など、押して開く所の文を出すため。注文などは PREVIEW_STOP で止まる）
 *  ★やりとりは、同じ場所（/baguru-app/ と /baguru-manage/）の親の画面とだけ。マネージから来た文は字として入れる（HTML として読まない） */
const TEXT_EDIT = PREVIEW && /[?&]edit\b/.test(location.search);
const ED = { exact: null, part: null, frames: [], on: true, key: '', s: 0, tpl: null, news: null, run: '' };   // frames：枠ごとの形（マネージの APP_FRAMES）。news：直しているお知らせ { i, f }
const ED_ATTRS = ['placeholder', 'data-en'];   // 画面に字が見える属性（押して直せる）
const edTell = msg => toManage({ type: 'baguru-edit', ...msg });   // マネージの場所だけに送る（上の toManage）
const edOrig = n => String(TEXT_FROM.get(n) ?? n.nodeValue ?? '').trim();
const edIs = t => !!t && !!ED.exact && (ED.exact.has(t) || !!ED.part?.test(t) || ED.frames.some(f => f.re.test(t)));
const edHits = (t, key, s, tpl) => !!t && (tpl ? tpl.re.test(t) : t === key || (!!s && t.includes(key)));
function edMark(n) {
  const p = n.parentNode;
  if (ED.exact && p?.nodeType === 1 && (edIs(edOrig(n)) || p.closest('[data-nf]'))) p.classList.add('t-ed');   // お知らせのタイトルと本文も（お知らせのタブと同じものを直す）
}
function edMarkEl(el) {
  const from = TEXT_FROM.get(el);
  if (ED.exact && from && ED_ATTRS.some(a => edIs(String(from[a] || '').trim()))) el.classList.add('t-ed');
}
/** 画面の字と、字が見える属性を、全部見る */
function edWalk(onText, onEl) {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.nodeType === 1 && /^(SCRIPT|STYLE|TEXTAREA)$/.test(n.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === 3) onText(n); else onEl(n); }
}
/** マネージで打った文を、画面の字に入れ直す（元の字から作り直す） */
function edRetext() {
  edWalk(n => (TEXT_FROM.has(n) ? putText(n, textFor(n)) : textNode(n)), el => {
    const from = TEXT_FROM.get(el), seen = TEXT_SEEN.get(el) || {};
    if (!from) return textEl(el);
    runMark(el);
    for (const a of Object.keys(from)) { const r = textOf(from[a]); if (el.getAttribute(a) !== r) el.setAttribute(a, r); seen[a] = r; }
    TEXT_SEEN.set(el, seen);
  });
}
/** 直している文を、実線の枠で示す */
function edPick() {
  document.querySelectorAll('.t-on').forEach(el => el.classList.remove('t-on'));
  if (ED.news) return document.querySelector(`[data-news="${ED.news.i}"] [data-nf="${ED.news.f}"]`)?.classList.add('t-on');
  if (ED.run) return edWalk(() => {}, el => { if (el.childNodes.length > 1 && runsOf(el).some(r => runSig(r) === ED.run)) el.classList.add('t-on'); });
  if (!ED.key) return;
  edWalk(n => { if (n.parentNode?.nodeType === 1 && edHits(edOrig(n), ED.key, ED.s, ED.tpl)) n.parentNode.classList.add('t-on'); },
    el => { const from = TEXT_FROM.get(el); if (!ED.tpl && from && ED_ATTRS.some(a => edHits(String(from[a] || '').trim(), ED.key, ED.s))) el.classList.add('t-on'); });
}
/** その字が画面でどう並ぶか（マネージの直す欄を、同じ幅・同じ字の形にして、改行の場所をアプリとそろえるため）。
 *  w … 字が並ぶ箱の中の幅（小数まで）、indent … 1行目が、前の字やアイコンのぶん右から始まるときの空き（px）、
 *  fit … 箱が字の長さに合わせて縮んでいる（ボタンなど）。そのときは max まで、打った字に合わせて広がる */
function edStyle(n) {
  const p = n.parentElement;
  if (!p) return null;
  let box = p;
  while (box.parentElement && box !== document.body && /^(inline|contents)$/.test(getComputedStyle(box).display)) box = box.parentElement;
  const cs = getComputedStyle(p), px = v => parseFloat(v) || 0;
  const inner = el => { const s = getComputedStyle(el), rc = el.getBoundingClientRect(); return { left: rc.left + px(s.borderLeftWidth) + px(s.paddingLeft), w: rc.width - px(s.borderLeftWidth) - px(s.borderRightWidth) - px(s.paddingLeft) - px(s.paddingRight) }; };
  const r = document.createRange();
  r.selectNodeContents(n);
  const rects = [...r.getClientRects()].filter(x => x.width > 0), first = rects[0], last = rects[rects.length - 1], bi = inner(box);
  const oneLine = !!first && rects.every(x => Math.abs(x.top - first.top) < 2);
  const st = { w: bi.w, indent: first ? Math.max(0, first.left - bi.left) : 0, align: getComputedStyle(box).textAlign };
  if (oneLine && bi.w - (last.right - first.left) < 1.5 && box.parentElement) { st.fit = true; st.max = inner(box.parentElement).w; }
  for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'wordBreak', 'overflowWrap', 'lineBreak', 'fontFeatureSettings', 'textTransform', 'whiteSpace', 'color']) st[k] = cs[k];
  return st;
}
/** 押した所の字（元の字）。main … 指の下の字、more … 押した所のまわりの字（どちらも { t: 元の字, now: 今の字, st: 並び方 }）、attrs … 字が見える属性 */
function edHit(e) {
  const r = document.caretRangeFromPoint?.(e.clientX, e.clientY), p = !r && document.caretPositionFromPoint?.(e.clientX, e.clientY);
  const n = r ? r.startContainer : p ? p.offsetNode : null, t = e.target.nodeType === 1 ? e.target : e.target.parentNode;
  const uniq = list => [...new Set(list.filter(Boolean))];
  const one = x => ({ t: edOrig(x), now: String(x.nodeValue || '').trim(), st: edStyle(x), mark: !!x.parentElement?.closest('.t-ed') });
  const main = n?.nodeType === 3 && t.contains(n) && edOrig(n) ? [one(n)] : [];
  const more = [], attrs = [], box = t.closest('button, a, label, li, p, h1, h2, h3, dt, dd, th, td') || t;
  const w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  for (let x = w.nextNode(); x && more.length < 12; x = w.nextNode()) if (edOrig(x) && !more.some(m => m.t === edOrig(x))) more.push(one(x));
  for (let el = t, i = 0; el && el !== document.body && i < 3; el = el.parentElement, i++) {
    const from = TEXT_FROM.get(el);
    if (from) ED_ATTRS.forEach(a => from[a] && attrs.push(String(from[a]).trim()));
  }
  // お知らせのタイトル・本文（data-nf）を押したとき：お知らせの何番目のどれか
  const nf = t.closest?.('[data-nf]'), li = nf?.closest('[data-news]'), nn = nf && (n?.nodeType === 3 && nf.contains(n) ? n : document.createTreeWalker(nf, NodeFilter.SHOW_TEXT).nextNode());
  const news = li ? { i: Number(li.dataset.news), f: nf.dataset.nf, st: nn ? edStyle(nn) : null } : null;
  return { main, more, attrs: uniq(attrs), news, run: n?.nodeType === 3 ? edRunAt(n) : null };
}
/** 押した字が、文の途中に飾りの入る文（run）の一部なら、その形と飾りの字・形。地の字に数字があるもの（お客様ごとに変わる）は null */
function edRunAt(n) {
  let top = n;
  while (top.parentElement && top.parentElement !== document.body && (top.parentElement.classList.contains('t-br') || getComputedStyle(top.parentElement).display === 'inline')) top = top.parentElement;
  const box = top.parentElement, run = box && runsOf(box).find(r => r.some(s => s.x === top));
  if (!run || run.some(s => s.n && /[0-9０-９]/.test(String(TEXT_FROM.get(s.n) ?? s.n.nodeValue)))) return null;
  const vals = {}, cst = {};
  let k = 0;
  run.forEach(s => {
    if (!s.el) return;
    k++;
    vals[k] = s.el.textContent.replace(/\s+/g, ' ').trim();
    const c = getComputedStyle(s.el);
    cst[k] = {};
    for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'marginLeft', 'marginRight', 'paddingLeft', 'paddingRight', 'color']) cst[k][p] = c[p];
  });
  const firstText = run.find(s => s.n)?.n, st = firstText ? edStyle(firstText) : null;
  if (st) {   // 1行目の始まりは、run の最初のもの（飾りのこともある）から
    delete st.fit;
    const f = run[0].x.nodeType === 3 ? (() => { const r = document.createRange(); r.selectNodeContents(run[0].x); return [...r.getClientRects()].find(x => x.width > 0); })() : run[0].x.getClientRects()[0];
    const bs = getComputedStyle(box), bl = box.getBoundingClientRect().left + (parseFloat(bs.borderLeftWidth) || 0) + (parseFloat(bs.paddingLeft) || 0);
    st.indent = f ? Math.max(0, f.left - bl) : 0;
  }
  return { key: runSig(run), vals, cst, st, inner: run.some(s => s.el === top) };   // inner：飾りの中の字を押した（その字だけも直せる）
}
const edRoute = () => { const h = location.hash.replace(/^#/, '') || 'home'; return h === 'menu/dine' ? h : h.split('/')[0]; };   // 店内のメニュー（#menu/dine）は、マネージの画面の一覧で別に出す
if (TEXT_EDIT) {
  document.documentElement.classList.add('t-editing');
  // 「文を押して直す」のあいだは、アプリのボタン・リンク・入力欄を動かさず、押した字をマネージに知らせる
  addEventListener('click', e => {
    if (!ED.on) return;
    e.preventDefault();
    e.stopPropagation();
    edTell({ kind: 'pick', ...edHit(e) });
  }, true);
  addEventListener('mousedown', e => { if (ED.on) e.preventDefault(); }, true);
  addEventListener('focusin', e => { if (ED.on && /^(INPUT|SELECT)$/.test(e.target.nodeName)) e.target.blur(); }, true);
  addEventListener('submit', e => { if (ED.on) e.preventDefault(); }, true);
  addEventListener('hashchange', () => edTell({ kind: 'route', route: edRoute() }));
  addEventListener('message', e => {
    if (!fromManage(e)) return;   // マネージの場所から来た知らせだけ（2026-11-05 から名指しで確かめる。前は同じ場所かどうか）
    const d = e.data || {};
    if (d.type !== 'baguru-manage') return;
    manageAt = e.origin;
    if (d.kind === 'keys') {
      const esc2 = k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const part = (Array.isArray(d.part) ? d.part : []).filter(k => typeof k === 'string' && k).sort((a, b) => b.length - a.length);
      ED.exact = new Set((Array.isArray(d.exact) ? d.exact : []).filter(k => typeof k === 'string'));
      ED.part = part.length ? new RegExp(part.map(esc2).join('|')) : null;
      ED.frames = (Array.isArray(d.frames) ? d.frames : []).filter(k => typeof k === 'string' && k.length <= 800).map(tplRe);
      edWalk(edMark, edMarkEl);
    } else if (d.kind === 'texts') {
      setTexts(d.texts);
      edRetext();
    } else if (d.kind === 'mode') {
      ED.on = !!d.on;
      document.documentElement.classList.toggle('t-editing', ED.on);
      if (!ED.on) document.activeElement?.blur?.();
    } else if (d.kind === 'pick') {
      ED.key = String(d.key || '');
      ED.s = d.s ? 1 : 0;
      ED.tpl = d.x && ED.key ? tplRe(ED.key) : null;
      ED.news = d.news && Number.isInteger(d.news.i) ? { i: d.news.i, f: d.news.f === 'body' ? 'body' : 'title' } : null;
      ED.run = d.x === 2 ? ED.key : '';
      if (ED.run) ED.tpl = null;
    } else if (d.kind === 'content') {   // お知らせなど、文章のほかの直し：中身を入れ直して描き直す（開いている画面のまま）
      if (d.content && typeof d.content === 'object') { applyContent(d.content); if (typeof render === 'function' && !(typeof sheet === 'object' && !sheet.hidden)) render(true); }
    } else if (d.kind === 'go') {   // 上の画面のボタン。開いている下からの画面は閉じてから移る
      if (typeof closeSheet === 'function' && typeof sheet === 'object' && !sheet.hidden) closeSheet();
      location.hash = '#' + String(d.route || 'home');
    }
    if (d.kind === 'pick' || d.kind === 'texts' || d.kind === 'content') setTimeout(edPick);   // 描き直しで付いた印のあとに
  });
  addEventListener('load', () => edTell({ kind: 'ready', route: edRoute() }));
}

/* ---- 公式アプリ：この端末の控えと、受け口から読み直す ---- */

/** この端末の控え（{ content, v, at, got }。無ければ null） */
const contentNow = () => DB.get('content', null);
let contentTried = 0;

/** 受け口から読み直す。CONTENT_EVERY たっていなければ何もしない（force で今すぐ）。中身が変わったら true */
async function refreshContent(force = false) {
  const last = contentNow();
  if (!force && Date.now() - Math.max(contentTried, last ? last.got : 0) < CONTENT_EVERY) return false;
  contentTried = Date.now();
  try {
    const r = await baguruLib().then(() => BaguruApi.post({ action: 'appContent' }));
    if (!('content' in r)) return false;
    const changed = !last || last.v !== r.v || JSON.stringify(last.content) !== JSON.stringify(r.content ?? null);
    DB.set('content', { content: r.content ?? null, v: Number(r.v) || 0, at: r.at || '', got: Date.now() });
    if (changed) applyContent(r.content);
    return changed;
  } catch (e) {
    return false;   // 読めないとき（受け口がまだこの口を持っていないときも）は、前の控えのまま
  }
}

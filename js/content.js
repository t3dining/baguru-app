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
 *             ★画面に出た字（テキストノード）を置きかえるだけなので、アプリの動きは変わらない。HTML としては読まない（字のまま出る）
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
};

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

  // テイクアウトの商品：値段・売り切れ・出さない
  const items = obj(c.items);
  ITEMS.forEach((i, k) => {
    const b = CONTENT_BASE.items[k], o = obj(items[i.id]);
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
  DINE_IN.forEach((cat, a) => cat.items.forEach((it, b) => {
    const base = CONTENT_BASE.dine[a][b], o = obj(dine[contentKey.dine(cat, it)]);
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
  // 画面の文章
  setTexts(c.texts);
  // お店からの一言（until の日を過ぎたら出さない）
  const n = obj(c.notice), now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  APP_NOTICE = text(n.text, 200) && !(/^\d{4}-\d{2}-\d{2}$/.test(n.until) && n.until < today) ? { text: text(n.text, 200), until: /^\d{4}-\d{2}-\d{2}$/.test(n.until) ? n.until : '' } : null;
}

/* ---- 画面の文章：直した文に置きかえる（texts） ---- */
let TEXT_MAP = new Map(), TEXT_PART = null, TEXT_LOOSE = null, textsStarted = false;
const TEXT_SEEN = new WeakMap();                                                 // 置きかえたあとの字を覚える（同じ字を二度置きかえない）
const TEXT_ATTRS = ['placeholder', 'aria-label', 'title', 'data-en'];

function setTexts(c) {
  const list = Object.entries(c && typeof c === 'object' && !Array.isArray(c) ? c : {})
    .filter(([k, v]) => k.length <= 800 && v && typeof v.to === 'string' && v.to.trim() && v.to.length <= 800);
  TEXT_MAP = new Map(list.map(([k, v]) => [k, v.to]));
  const re = keys => (keys.length ? new RegExp(keys.sort((a, b) => b.length - a.length).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g') : null);
  TEXT_PART = re(list.filter(([, v]) => v.s).map(([k]) => k));
  TEXT_LOOSE = re(list.filter(([k]) => k.length >= 2).map(([k]) => k));
}

/** 字を置きかえる。loose … 全体が同じでなくても置きかえる（注文の文のように、言葉がつながっているもの） */
function textOf(s, loose = false) {
  if (!TEXT_MAP.size || !s) return s;
  const t = s.trim();
  if (TEXT_MAP.has(t)) return s.replace(t, () => TEXT_MAP.get(t));
  const re = loose ? TEXT_LOOSE : TEXT_PART;
  return re ? s.replace(re, m => TEXT_MAP.get(m)) : s;
}

function textNode(n) {
  const v = n.nodeValue;
  if (TEXT_SEEN.get(n) === v) return;
  const r = textOf(v);
  if (r !== v) n.nodeValue = r;
  TEXT_SEEN.set(n, r);
}
function textEl(el) {
  const seen = TEXT_SEEN.get(el) || {};
  for (const a of TEXT_ATTRS) {
    const v = el.getAttribute?.(a);
    if (!v || seen[a] === v) continue;
    const r = textOf(v);
    if (r !== v) el.setAttribute(a, r);
    seen[a] = r;
  }
  TEXT_SEEN.set(el, seen);
}
/** root の中の字を置きかえる。入力欄の中（お客様が書いた字）と、スクリプトには触らない */
function applyTexts(root = document.body) {
  if (!TEXT_MAP.size || !root) return;
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
    if (!TEXT_MAP.size) return;
    for (const m of list) {
      if (m.type === 'characterData') applyTexts(m.target);
      else m.addedNodes.forEach(n => applyTexts(n));
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
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

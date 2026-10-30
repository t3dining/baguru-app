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
  // お店からの一言（until の日を過ぎたら出さない）
  const n = obj(c.notice), now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  APP_NOTICE = text(n.text, 200) && !(/^\d{4}-\d{2}-\d{2}$/.test(n.until) && n.until < today) ? { text: text(n.text, 200), until: /^\d{4}-\d{2}-\d{2}$/.test(n.until) ? n.until : '' } : null;
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

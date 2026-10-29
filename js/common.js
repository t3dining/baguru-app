/* =====================================================================
 *  お客さまの画面とお店の画面の両方で使うもの
 *  （日付・営業時間・受け取り時間・注文・スタンプ）
 * ===================================================================== */

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const yen = n => '¥' + n.toLocaleString('ja-JP');
const pad = n => String(n).padStart(2, '0');
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const mdw = d => `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function atTime(day, hm) {
  const [h, m] = hm.split(':').map(Number);
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** "22:30" の min 分前を "22:00" の形で */
const minusMin = (hm, min) => hhmm(new Date(atTime(new Date(), hm).getTime() - min * 60000));

/* ---------------------------------------------------------------------
 *  祝日（法律の決まりから計算する。振替休日・国民の休日も入る）
 * --------------------------------------------------------------------- */

const HOLIDAYS = {};
function holidaysOf(y) {
  if (HOLIDAYS[y]) return HOLIDAYS[y];
  const monday = (m, n) => { const w = new Date(y, m - 1, 1).getDay(); return 1 + (8 - w) % 7 + (n - 1) * 7; };
  const e = y - 1980;
  const spring = Math.floor(20.8431 + 0.242194 * e - Math.floor(e / 4));
  const autumn = Math.floor(23.2488 + 0.242194 * e - Math.floor(e / 4));
  const days = [
    [1, 1], [1, monday(1, 2)], [2, 11], [2, 23], [3, spring], [4, 29], [5, 3], [5, 4], [5, 5],
    [7, monday(7, 3)], [8, 11], [9, monday(9, 3)], [9, autumn], [10, monday(10, 2)], [11, 3], [11, 23],
  ].map(([m, d]) => new Date(y, m - 1, d));
  const set = new Set(days.map(dateKey));
  // 国民の休日：前の日と次の日が祝日にはさまれた日（9月の敬老の日と秋分の日のあいだなど）
  for (const d of days) {
    if (set.has(dateKey(addDays(d, 2)))) set.add(dateKey(addDays(d, 1)));
  }
  // 振替休日：祝日が日曜なら、そのあとの祝日でない最初の日
  for (const d of days) {
    if (d.getDay() !== 0) continue;
    let n = addDays(d, 1);
    while (set.has(dateKey(n))) n = addDays(n, 1);
    set.add(dateKey(n));
  }
  return (HOLIDAYS[y] = set);
}
const isHoliday = d => holidaysOf(d.getFullYear()).has(dateKey(d));

/* ---------------------------------------------------------------------
 *  T3Works の営業日（マネージの「⚙ 設定 → 定休日」）
 *  SHOP.daysUrl から、休みの曜日と、これから先の臨時休業・臨時営業の日を読む。
 *  読めないとき・まだつないでいないときは、data.js の closedDays・extraOpen・extraClosed で動く。
 *  返事の形 … { ok: true, store: 'baguru', closedDows: [2] | null, exceptions: { 'YYYY-MM-DD': 'open' | 'closed' } }
 *  （今日から60日先までの分だけが来る。店が SHOP.id でない返事は使わない）
 *  （closedDows が null ＝ マネージで決めていない → data.js の closedDays を使う）
 * --------------------------------------------------------------------- */

const DAYS_EVERY = 30 * 60000;   // 読みに行くのは1台につきこの間隔に1回まで（T3Works の口の1日の上限を分け合うため）
let daysTried = 0;

const remoteDays = () => SHOP.daysUrl ? DB.get('days', null) : null;

/** 返事を確かめて、使える形だけを残す（形がちがえば null） */
function readDays(j) {
  if (!j || j.ok !== true || j.store !== SHOP.id || !j.exceptions || typeof j.exceptions !== 'object') return null;
  const dows = j.closedDows;
  if (dows !== null && !(Array.isArray(dows) && dows.every(n => Number.isInteger(n) && n >= 0 && n <= 6))) return null;
  const exceptions = {};
  for (const [k, v] of Object.entries(j.exceptions)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k) && (v === 'open' || v === 'closed')) exceptions[k] = v;
  }
  return { closedDows: dows, exceptions };
}

/** 読み直す。前に読んでから DAYS_EVERY たっていなければ何もしない。中身が変わったら true */
async function refreshDays() {
  const last = remoteDays();
  if (!SHOP.daysUrl || Date.now() - Math.max(daysTried, last ? last.at : 0) < DAYS_EVERY) return false;
  daysTried = Date.now();
  try {
    const res = await fetch(SHOP.daysUrl, { cache: 'no-store', signal: AbortSignal.timeout?.(8000) });
    const days = res.ok && readDays(await res.json());
    if (!days) return false;
    DB.set('days', { ...days, at: Date.now() });
    return !last || JSON.stringify([last.closedDows, last.exceptions]) !== JSON.stringify([days.closedDows, days.exceptions]);
  } catch (e) {
    return false;   // 読めなかったときは、前に読めた分（無ければ data.js）のまま
  }
}

/** 休みの曜日（T3Works で決めていればそれ、なければ data.js） */
function closedDows() {
  const r = remoteDays();
  return r && Array.isArray(r.closedDows) ? r.closedDows : SHOP.closedDays;
}

/** その日だけの指定（'open' | 'closed' | null）。T3Works の臨時休業・臨時営業 → data.js の extraClosed・extraOpen の順 */
function dayException(k) {
  const hit = remoteDays()?.exceptions?.[k];
  if (hit) return hit;
  if (SHOP.extraClosed.includes(k)) return 'closed';
  if (SHOP.extraOpen.includes(k)) return 'open';
  return null;
}

/** 休みの日か。決める順番：その日だけの指定 → 祝日は営業 → 休みの曜日 */
function isClosedDay(d) {
  const ex = dayException(dateKey(d));
  if (ex) return ex === 'closed';
  if (isHoliday(d)) return false;
  return closedDows().includes(d.getDay());
}

/** これから days 日のうち、いつもとちがう日（休みの曜日に開ける日・臨時休業の日）。祝日の火曜は入れない */
function specialDays(days = 60, now = new Date()) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(now, i);
    const usual = closedDows().includes(d.getDay()) && !isHoliday(d);
    const closed = isClosedDay(d);
    if (closed !== usual) out.push({ date: d, open: !closed });
  }
  return out;
}

/** その日の営業時間 [[開ける, 閉める], …]。土・日・祝日は通し営業（祝前日は平日と同じ） */
function hoursOf(d) {
  if (isClosedDay(d)) return [];
  const w = d.getDay();
  const long = w === 0 || w === 6 || isHoliday(d);
  return (long ? SHOP.hours.holiday : SHOP.hours.normal).times;
}

/** 今日・明日、それ以外は「11/2（日）」 */
function dayLabel(d, now = new Date()) {
  const a = new Date(now); a.setHours(0, 0, 0, 0);
  const b = new Date(d); b.setHours(0, 0, 0, 0);
  const diff = Math.round((b - a) / 86400000);
  if (diff === 0) return '今日';
  if (diff === 1) return '明日';
  return mdw(d);
}

/* ---------------------------------------------------------------------
 *  営業中かどうか
 * --------------------------------------------------------------------- */

function shopState(now = new Date()) {
  const times = hoursOf(now);
  if (!times.length) return { state: 'closed', text: '本日は定休日です' };
  for (const [i, [open, close]] of times.entries()) {
    if (now < atTime(now, open)) return { state: 'before', text: i ? `準備中・${open} から営業` : `本日 ${open} から営業` };
    if (now < atTime(now, close)) return { state: 'open', text: `営業中・${close} まで（L.O. ${minusMin(close, SHOP.lastOrder)}）` };
  }
  return { state: 'after', text: '本日の営業は終了しました' };
}

/* ---------------------------------------------------------------------
 *  受け取り時間
 *  昼・夜それぞれで、いちばん早いのは「開ける時刻」と「いま」のおそいほうから lead 分後。
 *  lead は食数で変わる（TAKEOUT.leadByMeals）。いちばんおそいのは閉める lastBeforeClose 分前。stepMinutes 刻み。
 * --------------------------------------------------------------------- */

const isMeal = itemId => !!CATEGORIES.find(c => c.id === ITEM_BY_ID[itemId]?.cat)?.meal;
/** 食数（ハンバーグBOX・定食の数）。list は { itemId か id, qty } の並び */
const mealCount = list => list.reduce((n, l) => n + (isMeal(l.itemId || l.id) ? l.qty : 0), 0);
/** その食数のとき、注文してから何分後から受け取れるか */
const leadFor = meals => TAKEOUT.leadByMeals.find(([under]) => meals < under)[1];

function pickupSlots(day, now = new Date(), leadMin = leadFor(0)) {
  const step = TAKEOUT.stepMinutes * 60000;
  const lead = leadMin * 60000;
  const out = [];
  for (const [open, close] of hoursOf(day)) {
    const first = Math.max(atTime(day, open).getTime(), now.getTime()) + lead;
    const last = atTime(day, close).getTime() - TAKEOUT.lastBeforeClose * 60000;
    for (let t = Math.ceil(first / step) * step; t <= last; t += step) out.push(new Date(t));
  }
  return out;
}

/** 受け取りを選べる日（定休日と、もう枠が残っていない日は除く） */
function pickupDays(now = new Date(), leadMin = leadFor(0), count = 7) {
  const days = [];
  for (let i = 0; days.length < count && i < count * 2 + 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    d.setHours(0, 0, 0, 0);
    if (isClosedDay(d)) continue;
    const slots = pickupSlots(d, now, leadMin);
    if (slots.length) days.push({ date: d, slots });
  }
  return days;
}

/** 月を足す（同じ日。その月に無い日は、その月の終わり。1/31 の1か月あとは 2/28） */
function addMonths(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth() + n, 1);
  x.setDate(Math.min(d.getDate(), new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()));
  return x;
}

/** テイクアウトの「時間を指定」で選べる日と時間。今日から TAKEOUT.monthsAhead か月先の同じ日まで（定休日・臨時休業を除く） */
function takeoutDays(now = new Date(), leadMin = leadFor(0)) {
  const last = addMonths(new Date(now.getFullYear(), now.getMonth(), now.getDate()), TAKEOUT.monthsAhead);
  return pickupDays(now, leadMin, 62).filter(d => d.date <= last);
}

/** 「できしだい」で受け取れるいちばん早い時刻（5分単位）。今日はもう受け取れないときは null */
function asapTime(now = new Date(), leadMin = leadFor(0)) {
  const five = 5 * 60000;
  for (const [open, close] of hoursOf(now)) {
    const t = Math.ceil((Math.max(atTime(now, open).getTime(), now.getTime()) + leadMin * 60000) / five) * five;
    if (t <= atTime(now, close).getTime() - TAKEOUT.lastBeforeClose * 60000) return new Date(t);
  }
  return null;
}

/** 配達・大量注文の申請で選べる日と時間。requestDaysBefore 日後の営業日から、定休日を除いて requestDaysAhead 日分。
 *  前もって申請してもらうので、その日の開店の時刻から選べる */
const requestDays = (now = new Date()) => pickupDays(addDays(now, TAKEOUT.requestDaysBefore), 0, TAKEOUT.requestDaysAhead);

/* ---------------------------------------------------------------------
 *  値段（選んだものを足す）
 *  sel は { グループのid: 選んだ番号 | 番号の配列 | 個数 }。まだ選んでいないものは null
 *  必須（required）の項目が選ばれていなければ missing にその項目が入る（カートに入れられない）
 * --------------------------------------------------------------------- */

function priceOf(item, sel) {
  let unit = item.price;
  let missing = null;
  const opts = [];
  const need = g => { if (g.required && !missing) missing = g; };
  for (const g of item.groups || []) {
    const v = sel[g.id];
    if (g.type === 'one') {
      const c = typeof v === 'number' ? g.choices[v] : null;
      if (!c) { need(g); continue; }
      unit += c.p || 0;
      if (!c.plain) opts.push((g.label || '') + c.n);
    } else if (g.type === 'many') {
      const list = Array.isArray(v) ? v.filter(i => g.choices[i]) : [];
      if (!list.length) { need(g); continue; }
      list.forEach(i => { const c = g.choices[i]; unit += c.p || 0; if (!c.plain) opts.push(c.n); });
    } else if (g.type === 'count') {
      if (typeof v !== 'number') { need(g); continue; }      // 「なし」なら 0、個数を選んだらその数
      if (v > 0) { unit += g.choices[0].p * v; opts.push(`${g.choices[0].n}×${v}`); }
    }
  }
  return { unit, opts, missing };
}

/* ---------------------------------------------------------------------
 *  注文
 * --------------------------------------------------------------------- */

// kind … 'pickup'（ふつうの注文）／'bulk'（大量注文の申請）／'delivery'（配達の申請）
// 申請は request（お店の確認待ち）から始まり、お店が承認すると accepted、断ると declined
const STATUS = {
  request:  { label: '申請中',     step: 0 },
  new:      { label: '受付待ち',   step: 0 },
  accepted: { label: '調理中',     step: 1 },
  ready:    { label: 'できあがり', step: 2 },
  done:     { label: 'お渡し済み', step: 3 },
  canceled: { label: '取り消し',   step: -1 },
  declined: { label: 'お断り',     step: -1 },
};
const ACTIVE = ['request', 'new', 'accepted', 'ready'];
const isRequest = o => o.kind === 'bulk' || o.kind === 'delivery';
const KIND = { pickup: 'テイクアウト', bulk: '大量注文', delivery: '配達' };
/** 配達で、無料の食数に届いていない（要相談・配達料はお店から知らせる）注文か */
const needsFee = o => o.kind === 'delivery' && (o.meals || 0) < TAKEOUT.deliveryFreeMin;
/** お支払いの案内。配達はお届けのときに現金、それ以外は受け取りのときに店頭。要相談の配達は、配達料をお店から知らせる */
const payNoteOf = (kind, meals = 0) => kind === 'delivery'
  ? TAKEOUT.deliveryPayNote + (meals < TAKEOUT.deliveryFreeMin ? '配達料は、承認のときにお店からお知らせします。' : '')
  : TAKEOUT.payNote;

/** まだ調理を始める時刻の前か（受け取り・お届けの TAKEOUT.cookBefore 分前より前）。「できしだい」の注文は、いつも調理の時刻を過ぎている扱い */
const beforeCook = (o, now = new Date()) => !o.asap && new Date(o.pickupAt) - now > TAKEOUT.cookBefore * 60000;
/** 受け付けたが、まだ調理を始める前の注文か（受け取り・お届けの TAKEOUT.cookBefore 分前まで）。status は accepted のまま。
 *  お店の画面では「受付済み」の枠に入り、その時刻を過ぎると「調理中」へ移る（2026-10-30 ko-dai さんの指示。前は「明日以降か」で見分けていた）。
 *  ★バグるOrder受付の js/store.js も isBooked を使う。名前や引数を変えるときは、そのセッションに知らせる */
const isBooked = (o, now = new Date()) => o.status === 'accepted' && beforeCook(o, now);

/** 注文の様子の名前（申請・配達のとき、調理を始める前の受け付けのときは言い方を変える） */
function statusLabel(o, status = o.status) {
  if (status === 'accepted' && beforeCook(o)) return isRequest(o) ? '承認済み' : '受付済み';   // 注文の様子の4段階の2つ目も、受け付ける前から
  if (isRequest(o) && status === 'accepted') return '承認・準備中';
  if (o.kind === 'delivery' && status === 'done') return 'お届け済み';
  return STATUS[status].label;
}
/** 受け取り（配達なら、お届け） */
const whenWord = o => o.kind === 'delivery' ? 'お届け' : '受け取り';

const getOrders = () => DB.get('orders', []);
const saveOrders = list => DB.set('orders', list);

function updateOrder(id, patch) {
  const list = getOrders();
  const o = list.find(x => x.id === id);
  if (!o) return null;
  Object.assign(o, patch);
  if (patch.status) o.times = { ...(o.times || {}), [patch.status]: new Date().toISOString() };
  saveOrders(list);
  return o;
}

/** その日の通し番号（001 から） */
function nextOrderNo(now = new Date()) {
  const today = dateKey(now);
  const n = getOrders().filter(o => o.date === today).length + 1;
  return String(n).padStart(3, '0');
}

/** 受け取り時刻までの残り（「あと25分」「12分過ぎ」） */
function untilText(iso, now = new Date()) {
  const min = Math.round((new Date(iso) - now) / 60000);
  if (min >= 60 * 24) return '';
  if (min >= 60) return `あと${Math.floor(min / 60)}時間${min % 60 ? (min % 60) + '分' : ''}`;
  if (min >= 0) return `あと${min}分`;
  return `${-min}分過ぎ`;
}

/* ---------------------------------------------------------------------
 *  スタンプ
 *  total は今までに押した数の合計。いまのカードの何個目かは stampOnCard で出す。
 * --------------------------------------------------------------------- */

const getStamps = () => DB.get('stamps', { total: 0, log: [], coupons: [] });

function stampOnCard(total) {
  return total === 0 ? 0 : ((total - 1) % STAMP.goal) + 1;
}

/** 特典券を作る。options のどれか1つを、使うときに選ぶ */
const couponTitle = options => options.join(' または ');
function makeCoupon(r, label, now) {
  return { id: `c${now.getTime()}-${r.at || 0}`, at: r.at || 0, label, options: r.options, title: couponTitle(r.options), earnedAt: now.toISOString(), usedAt: null, chose: '' };
}
const rewardLabel = r => r.goal ? 'ゴール特典' : `${r.at}個たまった特典`;

/** 1つ押す。1日の上限を超えるときは押さない。bonus（初回登録の分）は1日の上限に数えない */
function addStamp(via, now = new Date(), { bonus = false } = {}) {
  const s = getStamps();
  const today = dateKey(now);
  if (!bonus && stampedToday(now)) return { ok: false, reason: 'today' };
  s.total += 1;
  s.log.push({ date: today, at: now.toISOString(), via, ...(bonus ? { bonus: true } : {}) });
  const on = stampOnCard(s.total);
  const got = STAMP.rewards.filter(r => r.at === on).map(r => makeCoupon(r, rewardLabel(r), now));
  s.coupons.push(...got);
  DB.set('stamps', s);
  return { ok: true, on, got };
}

const stampedToday = (now = new Date()) => getStamps().log.filter(l => l.date === dateKey(now) && !l.bonus).length >= STAMP.perDay;

/** 初回登録の特典（1ポイントと、バニラアイスの券）。1端末1回 */
function giveWelcome(now = new Date()) {
  let r = { ok: true, on: stampOnCard(getStamps().total), got: [] };
  for (let i = 0; i < STAMP.welcome.points; i++) r = addStamp('初回登録', now, { bonus: true });
  const s = getStamps();
  const gift = makeCoupon({ options: STAMP.welcome.options }, '初回登録の特典', now);
  s.coupons.push(gift);
  DB.set('stamps', s);
  return { ...r, got: [...r.got, gift] };
}

/** 今日もう特典を使ったか（特典は1日 couponsPerDay 枚まで。併用できない） */
const couponsUsedToday = (now = new Date()) => getStamps().coupons.filter(c => c.usedAt && dateKey(new Date(c.usedAt)) === dateKey(now)).length;
const canUseCoupon = (now = new Date()) => couponsUsedToday(now) < STAMP.couponsPerDay;

/* ---------------------------------------------------------------------
 *  お店に置くスタンプのQR
 *  QR の中身は、アプリのアドレス ＋ ?stamp=印。アプリの「QRを読む」でも、スマホのカメラでも読める。
 *  印は「何回目に作ったQRか」（qrVersion）から作る。お店の画面で作り直すと、前に印刷したQRは使えなくなる。
 *  ★試作のあいだは、印をこの画面の中で作って確かめる。本番は印も位置もサーバーで確かめ、合言葉をアプリに入れない
 * --------------------------------------------------------------------- */

/** 文字から数を作る（FNV-1a）。★試作だけの作り方 */
function hashOf(str) {
  let h = 2166136261;
  for (const ch of str) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const qrVersion = () => DB.get('qrVersion', 1);
const qrToken = (v = qrVersion()) => `${v}-${hashOf(`${STAMP.demoSecret}:qr:${v}`).toString(36)}`;

/** QR を読んだら開くアドレス（SHOP.appUrl。空なら、いま開いている画面と同じ場所） */
function stampUrl(token = qrToken()) {
  const u = new URL(SHOP.appUrl || './', location.href);
  u.search = 'stamp=' + token;
  u.hash = '';
  return u.href;
}

/** QR の中身から印を取り出す（スタンプのQRでなければ ''） */
function tokenFrom(text) {
  try { return new URL(text).searchParams.get('stamp') || ''; } catch (e) { return ''; }
}

/** 2つの地点のあいだの距離（メートル） */
function distanceM(a, b) {
  const rad = x => x * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// QR を作る・読むライブラリ（どちらも MIT）。使うときだけ読みこむ。
// 版を決め打ちし、integrity で中身が変わっていないかを確かめる（変わっていたら読まない）
const LIB = {
  qrMake: { src: 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js', integrity: 'sha384-mZT2gIty7ZDdOGkxfP6joZcYdMW1Jvj9dRlfpTmaJAKKXTqzygtB22k7FLe+KZC1' },
  qrRead: { src: 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js', integrity: 'sha384-b5Ya4Bq3qCyz39m2ISh+4DxjAIljdeFwK/BsXLuj9gugaNwAcj/ia15fxNZL9Nlx' },
};
const LOADED = {};
function loadScript({ src, integrity }) {
  return LOADED[src] ??= new Promise((ok, ng) => {
    const s = document.createElement('script');
    Object.assign(s, { src, integrity, crossOrigin: 'anonymous', onload: ok });
    s.onerror = () => { delete LOADED[src]; s.remove(); ng(new Error('読み込めませんでした')); };
    document.head.append(s);
  });
}

/* ---------------------------------------------------------------------
 *  アイコン（線の絵）
 * --------------------------------------------------------------------- */

const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  home: svg('<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H10v6H4a1 1 0 0 1-1-1z"/>'),
  bag: svg('<path d="M5 8h14l-1.2 12.1a1 1 0 0 1-1 .9H7.2a1 1 0 0 1-1-.9z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>'),
  card: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M12 8.6l1.05 2.13 2.35.34-1.7 1.66.4 2.34L12 14l-2.1 1.07.4-2.34-1.7-1.66 2.35-.34z"/>'),
  pin: svg('<path d="M12 21s-7-6.2-7-11.2a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.6"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c.6-3.8 3.9-6 8-6s7.4 2.2 8 6"/>'),
  cart: svg('<path d="M3 4h2.2l2.1 11.2a1 1 0 0 0 1 .8h9.4a1 1 0 0 0 1-.8L20.5 8H6.1"/><circle cx="9.5" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  phone: svg('<path d="M5 4h3.5l1.8 4.4-2.3 1.4a11 11 0 0 0 6.2 6.2l1.4-2.3L20 15.5V19a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  car: svg('<path d="M5 16V11l2-5h10l2 5v5"/><path d="M3 16h18v3H3z"/><circle cx="7.5" cy="13" r=".6"/><circle cx="16.5" cy="13" r=".6"/>'),
  cal: svg('<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  insta: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r=".8" fill="currentColor"/>'),
  truck: svg('<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  gift: svg('<rect x="3.5" y="9" width="17" height="11" rx="1.5"/><path d="M3.5 13h17M12 9v11M12 9c-2-4-6-4-6-1.5S10 9 12 9zm0 0c2-4 6-4 6-1.5S14 9 12 9z"/>'),
  map: svg('<path d="M9 4L3.5 6v14L9 18l6 2 5.5-2V4L15 6z"/><path d="M9 4v14M15 6v14"/>'),
  // ホーム画面に追加の案内で使う
  share: svg('<path d="M12 3.5v11M8 7.5l4-4 4 4"/><path d="M8.5 10.5H6.5a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-8.5a1 1 0 0 0-1-1h-2"/>'),
  addbox: svg('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/>'),
  dots: svg('<circle cx="5.5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor"/>'),
  kebab: svg('<circle cx="12" cy="5.5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="18.5" r="1.4" fill="currentColor"/>'),
  copy: svg('<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9.5a1 1 0 0 0 1 1h3.5"/>'),
  compass: svg('<circle cx="12" cy="12" r="9"/><path d="M15.8 8.2l-2.3 5.3-5.3 2.3 2.3-5.3z"/>'),
  x: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  // お店の情報で使う
  seat: svg('<path d="M7 3.5h10v7.5H7z"/><path d="M5 11h14v3H5zM7 14v6.5M17 14v6.5"/>'),
  wallet: svg('<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.2" fill="currentColor"/>'),
  menu: svg('<path d="M6 3.5v7a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2v-7M8 12.5v8M16.5 20.5V3.5c-2 1-3 3.5-3 6.5v3h3"/>'),
  // スタンプのQRで使う
  qr: svg('<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1"/><path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 18.5v2M20.5 14v2"/>'),
};

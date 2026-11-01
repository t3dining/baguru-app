/* =====================================================================
 *  お店の画面（タブレットで開いておく想定）
 *  届いた注文を「受け付ける → できあがり → お渡し済み」と進める。
 *  受け付けた注文は、受け取りの30分前（TAKEOUT.cookBefore）までは「受付済み」に入り、それを過ぎると「調理中」に移る。
 *  お渡し済みにすると、そのお客様のスタンプが1個たまる（試作ではここで押す。受け口につないだときは、お客様のスマホが押す）。
 *  電話・店頭の注文も、ここから入れる。
 *  ★テイクアウトの操作は、すべてこの画面でする（2026-10-30 ko-dai さん。予約ボードのテイクアウトの画面は見るだけ）
 *  ★お店に置くスタンプのQRを出す・印刷する・作り直すボタンは、2026-10-30 に外した（ko-dai さんの指示）
 *  ★LINE のポイントの引き継ぎのQRを出すボタンは、2026-11-01 に外した（ko-dai さんの指示）
 *
 *  注文の置き場所は、公式アプリと同じ切り替え ORDERS_ONLINE（data.js の TAKEOUT.online を ../js/order-api.js が読む）で変わる
 *  ・false（試作）：このブラウザの中の注文（DB 'orders'）。お客様の画面を同じブラウザで開くと届く
 *  ・true：受け口（予約ボードの受け口・コード.gs）。15秒ごとに読み直す（orders）。進める・承認する・取り消す・電話の注文は saveOrder、
 *    受付の切り替えは setTakeout。この Mac で試すときは、にせの受け口（予約ボード/受け口/にせの受け口.py）が配るアドレスに ?test を付けて開く
 * ===================================================================== */

const NEXT = {
  new:      { to: 'accepted', label: '受け付ける' },
  accepted: { to: 'ready',    label: 'できあがり' },
  ready:    { to: 'done',     label: 'お渡し済み' },
};
const BACK = { accepted: 'new', ready: 'accepted', done: 'ready' };
// 申請（配達・大量注文）は、承認したら accepted。戻すと申請に戻る
const backOf = o => o.status === 'accepted' && isRequest(o) ? 'request' : BACK[o.status];
const nextLabel = o => o.kind === 'delivery' && o.status === 'ready' ? 'お届け済み' : NEXT[o.status]?.label;
// 受け付けた・承認したが、まだ調理を始める前（受け取り・お届けの TAKEOUT.cookBefore 分前まで）の注文は「受付済み」に置く。その時刻を過ぎると「調理中」に移る。
// 「できしだい」は、受け付けたらすぐ調理中。見分けは common.js の isBooked（お客さまの画面の「受付済み」と同じ。2026-10-30 ko-dai さん）
const who = o => o.name ? `${o.name} 様` : 'お名前なし';   // 店頭の注文は、お名前を聞かないことがある

// バグる Owner（フォルダーアプリ。../バグるOwner/）から開いたとき（?from=owner）だけ、上の帯と合言葉の画面に「🏠 ホーム」を出す
// （2026-10-30 ko-dai さんの指示。フォルダーアプリのセッションに頼まれた）。印はこのタブの sessionStorage にも残し、「↻ 更新」のあとも出し続ける。
// 戻り先は、開いたアプリが控えた sessionStorage の bg.owner（?test で開いたときは ?test 付き）。無ければ、端末に残る localStorage の bg.hub
// （バグる Owner・バグる Staff が開いたときに自分のアドレスを入れる。社員の端末では Staff になる。2026-11-01 ko-dai さんの指示）。
// ★お店のタブレットのホーム画面から開いたときは出さない
const OWNER_URL = 'https://t3dining.github.io/baguru-owner/';
const FROM_OWNER = (() => {
  const mark = /[?&]from=owner\b/.test(location.search);
  try {
    if (mark) sessionStorage.setItem('bg.fromOwner', '1');
    return sessionStorage.getItem('bg.fromOwner') === '1';
  } catch (e) { return mark; }
})();
function goOwner() {
  let to = '';
  try { to = sessionStorage.getItem('bg.owner') || ''; } catch (e) {}
  if (!to) try { to = localStorage.getItem('bg.hub') || ''; } catch (e) {}
  location.href = to || OWNER_URL;
}

const RING_EVERY = 3000;   // 受付待ちの注文があるあいだ、この間隔（ミリ秒）で鳴らし続ける
const CHIME_URL = 'snd/order.wav';   // 注文が入ったときの音（1.8秒。道具/注文の音を作る.py で作る）
const COOK_URL = 'snd/cook.wav';     // 調理を始める時間の音（2.6秒。「ピンポーン」を2回。同じ道具で作る）
const COOK_RINGS = 3;                // 調理を始める時間の音を、RING_EVERY の間隔で何回鳴らすか
const COOK_GLOW = 60000;             // 調理中に移った注文を光らせて「調理開始」の札を付けておく長さ（ミリ秒）

// タブレット（iPad など。画面の短いほうが600以上）は、開いたときから音はオン。「音」のボタンで、そのときだけ止められる。
// スマホは前のように、音はオフで始まり「音」のボタンで選ぶ（2026-10-30 ko-dai さん）。パソコンはタブレットと同じ扱い
const TABLET = Math.min(screen.width, screen.height) >= 600;
let soundOn = TABLET;
let audio = null;
let chime = null;   // 読み込んだ音。読めなかったときは、前の「ピッピッ」で鳴らす
let cookChime = null;   // 調理を始める時間の音。読めなかったときは、低い「ピッピッ」で鳴らす
let ringTimer = null;
// 新しく届いた注文に印を付けるため。受け口につないだときは、はじめて読めたときに埋める（開いたときからある注文には印を付けない）
let known = ORDERS_ONLINE ? null : new Set(getOrders().map(o => o.id));
const fresh = new Set();
const cookNow = new Set();   // 受付済みから調理中に移ったばかりの注文（光らせる）

/* ---------------------------------------------------------------------
 *  受け口とのやりとり（ORDERS_ONLINE のときだけ）
 *  ・合言葉は予約ボードと同じもの。予約ボードと同じ所（localStorage の baguru.daicho.pin）に置くので、同じブラウザなら1回入れれば両方で使える。
 *    受け口に「合言葉が違う」と言われたら消して、入れ直してもらう（予約ボードと同じ）
 *  ・受け口の注文は、このブラウザの DB 'orders' に入れない（同じブラウザで公式アプリを開くと、お客様の「自分の注文」に混ざるため）。
 *    画面を開いているあいだだけ持ち、開き直したら読み直す
 * --------------------------------------------------------------------- */

const PIN_KEY = 'baguru.daicho.pin';
const POLL_EVERY = 15000;   // 受け口に頼まれた 10〜20秒
const ASK_LIMIT = 30000;    // 受け口の返事を待つ長さ（ミリ秒）
const STALE_AFTER = 60000;  // これだけ注文を読めていないと、わけが分からなくても上の帯を赤くする
// orders：受け口の注文／accepting：受付中か／at：最後に読めた時刻／error：読めなかったわけ
// gen：進めた回数。読んでいるあいだに進めたら、その読んだ答えは古いので使わない
const net = { orders: [], accepting: true, at: 0, error: '', gen: 0, loading: null };
const STAFF_MSG = {
  bad_pin: '合言葉が違います。',
  locked: '受け口が止まっています（合言葉を何度も間違えた人がいたため。10分で戻ります）。',
  conflict: 'ほかの端末で、この注文が先に変わっていました。いまの様子を出したので、もう一度確かめてください。',
  not_found: 'この注文が見つかりませんでした。「更新」を押して確かめてください。',
  bad_date: '受け取りの日時を確かめてください。',
  bad_tel: '電話番号を確かめてください。',
  need_lines: '品物を1つ以上入れてください。',
  bad_input: '入れた内容を確かめてください。',
  bad_status: '注文の様子を変えられませんでした。「更新」を押して確かめてください。',
  not_setup: '受け口の準備がまだです（予約ボードの引き継ぎ書の setup）。',
  not_ready: '受け口の場所を読めませんでした。Wi-Fi・電波を確かめて「更新」を押してください。',
  no_answer: '受け口から返事がありませんでした。少し待って、もう一度お試しください。',
  offline: 'つながりませんでした。Wi-Fi・電波を確かめてください。',
};
const staffText = e => STAFF_MSG[e?.code] || STAFF_MSG.offline;
const quiet = e => e?.code === 'bad_pin';   // 合言葉の画面に出すので、ほかには出さない

function pinGet() { try { return localStorage.getItem(PIN_KEY) || ''; } catch (e) { return ''; } }
function pinSet(v) { try { if (v) localStorage.setItem(PIN_KEY, v); else localStorage.removeItem(PIN_KEY); } catch (e) {} }

/** 受け口に送る。ASK_LIMIT 待っても返事が無ければ、あきらめる（2026-11-01。Codex のレビューの指摘）。
 *  ★通信が終わらないまま待ち続けると、読み直しが止まるのに帯は緑のままになり、新しい注文も音も来なくなる。
 *  あきらめても受け口には届いていることがある。進める操作は expect、電話の注文は rid が付くので、押し直しても二重にならない */
function ask(payload) {
  let timer;
  const limit = new Promise((_, ng) => { timer = setTimeout(() => ng(Object.assign(new Error('no_answer'), { code: 'no_answer' })), ASK_LIMIT); });
  return Promise.race([orderPost(payload), limit]).finally(() => clearTimeout(timer));
}

/** 合言葉を付けて受け口に送る。合言葉が違うと言われたら、合言葉の画面を出す。
 *  ★止まっている（locked）ときは、合言葉を消さない（2026-10-31 ko-dai さんの指示。予約ボードと同じ）。だれかが間違えて止まっているだけで、この端末の合言葉は正しい。
 *  消すと同じブラウザの予約ボードの合言葉も消える。上の帯を赤くして読み直しつづけ、戻ったら元の画面に戻る */
async function staffPost(payload) {
  try {
    return await ask({ ...payload, pin: pinGet() });
  } catch (e) {
    if (quiet(e)) askPin(staffText(e));
    throw e;
  }
}

/** 受け口が返した注文の並び（orders の答え）を、画面の注文にする */
function take(r) {
  net.orders = (r.orders || []).map(fromServer);
  net.accepting = r.accepting !== false;
  checkNew();
}
/** 受け口が返した1件を、画面の注文に入れる（無ければ足す） */
function put(o) {
  const i = net.orders.findIndex(x => x.id === o.id);
  if (i >= 0) net.orders[i] = o; else net.orders.push(o);
}

/** 受け口の注文を読み直す（15秒ごと・画面に戻ったとき） */
function pull() {
  if (!ORDERS_ONLINE) return Promise.resolve();
  // 同じブラウザの予約ボードでログアウトすると、合言葉が消える（置き場所が同じ）。黙って読むのを止めないで、合言葉の画面を出す
  if (!pinGet()) {
    if ($('#pinGate').hidden) askPin('合言葉が消えました（同じブラウザの予約ボードでログアウトしたときなど）。もう一度入れてください。');
    return Promise.resolve();
  }
  if (net.loading) return net.loading;
  const gen = net.gen;
  net.loading = staffPost({ action: 'orders' })
    .then(r => { net.error = ''; net.at = Date.now(); if (gen === net.gen) take(r); })
    .catch(e => { net.error = staffText(e); })
    .then(() => { net.loading = null; render(); });
  return net.loading;
}

/** 合言葉の画面を出す（はじめて・合言葉が違うと言われたとき） */
function askPin(msg = '') {
  pinSet('');
  net.orders = [];
  known = null;
  $('#pinGate').hidden = false;
  $('#pinErr').textContent = msg;
  $('#pinErr').hidden = !msg;
  setTimeout(() => $('#pin').focus(), 50);
  render();
}

/** 画面の注文（試作はこのブラウザの中、受け口につないだときは受け口から読んだもの） */
const list = () => ORDERS_ONLINE ? net.orders : getOrders();
const isAccepting = () => ORDERS_ONLINE ? net.accepting : DB.get('accepting', true);

/** 注文を進める・直す。受け口につないだときは saveOrder（読んだときの更新日時 expect を付けて、ほかの端末と重ならないようにする）。
 *  うまくいったら true。だめなときは、わけを出して false */
async function change(o, patch) {
  if (!ORDERS_ONLINE) { updateOrder(o.id, patch); render(); return true; }
  net.gen++;
  try {
    const r = await staffPost({ action: 'saveOrder', row: { id: o.id, ...patch }, expect: o.updatedAt });
    put(fromServer(r.row));
    return true;
  } catch (e) {
    if (e.code === 'conflict' && e.data?.row) put(fromServer(e.data.row));
    if (!quiet(e)) alert(staffText(e));
    return false;
  } finally {
    net.gen++;   // 送っているあいだに読み始めた答えも、古いことがあるので使わない
    render();
  }
}

/** 注文の受付を止める・始める */
async function setAccepting(on) {
  if (!ORDERS_ONLINE) { DB.set('accepting', on); return; }
  net.gen++;   // 読んでいる途中の答えの受付中・停止は古いので使わない（スイッチが元に戻らないように）
  try {
    const r = await staffPost({ action: 'setTakeout', accepting: on });
    net.accepting = r.accepting !== false;
  } catch (e) {
    if (!quiet(e)) alert(staffText(e));
  } finally {
    net.gen++;
  }
}

/** 上の細い帯：試作か、受け口から読めているか */
function paintNet() {
  const bar = $('#netBar');
  if (!ORDERS_ONLINE) {
    bar.className = 'net-bar demo';
    bar.textContent = '試作版：お客様の画面（index.html）と同じブラウザで開くと、注文が届く様子を試せます。';
    return;
  }
  const test = TAKEOUT.online ? '' : '試し（にせの受け口）・';
  const last = net.at ? `最後に読めたのは ${hhmm(new Date(net.at))}。` : '';
  const stale = net.at && Date.now() - net.at > STALE_AFTER;
  bar.className = `net-bar ${net.error || stale ? 'ng' : 'ok'}`;
  bar.textContent = net.error || stale ? `⚠ ${test}${net.error || '注文を読めていません。'}${last}新しい注文が届いていないかもしれません。`
    : net.at ? `${test}${hhmm(new Date(net.at))} に注文を読みました（${POLL_EVERY / 1000}秒ごとに読み直します）`
    : `${test}読み込んでいます…`;
}

/* 音を出せるようにする。
   ★ブラウザの決まりで、画面に一度も触っていないページは音を出せないことがある（iPad はいつも。Android はホーム画面に置いたアプリなら出せる）。
   触ったその場でこれを呼ぶと、そのあとは鳴らせる。触る前に呼んでも、出せる端末ならそのまま鳴らせるようになる */
function unlockSound() {
  if (!audio) {
    audio = new (window.AudioContext || window.webkitAudioContext)();
    audio.onstatechange = () => { checkSound(); render(); };   // 止まった（スリープ・電話など）・また鳴らせるようになった
  }
  const resumed = audio.resume().catch(() => {});
  const s = audio.createBufferSource();   // iPad の Safari は、触ったその場で一度鳴らさないと、あとで音を出せない。聞こえない音を鳴らしておく
  s.buffer = audio.createBuffer(1, 1, 22050);
  s.connect(audio.destination);
  s.start();
  return loadChime().then(() => resumed);
}

// タブレットで、音がオンなのに出せないあいだは、画面いっぱいに「画面をタッチしてください」を出す（触ると音が出せるようになる）。
// スマホには出さない（前のように「音」のボタンで選ぶ）
function checkSound() {
  $('#soundGate').hidden = !(TABLET && soundOn && (!audio || audio.state !== 'running'));
}

function loadChime() {
  if (!audio) return Promise.resolve();
  const load = url => fetch(url)
    .then(r => r.arrayBuffer())
    .then(b => new Promise((ok, ng) => audio.decodeAudioData(b, ok, ng)))   // 古い Safari は、この書き方しか使えない
    .catch(() => null);
  return Promise.all([chime || load(CHIME_URL), cookChime || load(COOK_URL)]).then(([a, b]) => { chime = a; cookChime = b; });
}

/** 音を1回鳴らす。ふだんは注文の音。buf が読めていないときは、freq の高さの「ピッピッ」 */
function beep(buf = chime, freq = 880) {
  if (!soundOn || !audio) return;
  if (audio.state === 'suspended') audio.resume();   // タブレットがしばらく裏に回ると止まることがある
  if (buf) {
    const s = audio.createBufferSource();
    s.buffer = buf;
    s.connect(audio.destination);
    s.start();
    return;
  }
  [0, 0.28].forEach(t => {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, audio.currentTime + t);
    g.gain.exponentialRampToValueAtTime(0.4, audio.currentTime + t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t + 0.22);
    o.connect(g).connect(audio.destination);
    o.start(audio.currentTime + t);
    o.stop(audio.currentTime + t + 0.25);
  });
}

// 受付待ちがあるあいだは鳴らし続け、なくなったら（受け付けたら）止める
function ring(on) {
  if (on && !ringTimer) { beep(); ringTimer = setInterval(beep, RING_EVERY); }
  if (!on && ringTimer) { clearInterval(ringTimer); ringTimer = null; }
}

/** 受け取りの日が、今日から何日後か（0＝本日。過ぎた日はマイナス） */
function daysAhead(t, now = new Date()) {
  const a = new Date(now); a.setHours(0, 0, 0, 0);
  const b = new Date(t); b.setHours(0, 0, 0, 0);
  return Math.round((b - a) / 86400000);
}

/** カードのいちばん上の帯：本日の受け取りか、明日より先か（2026-10-30 ko-dai さんの指示。注文が入ったときに、ひと目でわかるように）。
 *  進めている注文（受付待ち・申請・受付済み・調理中・できあがり）にだけ付ける */
function dayStrip(o, t) {
  const d = daysAhead(t);
  const word = `の${whenWord(o)}${o.status === 'request' ? '（希望）' : ''}`;
  if (d === 0) return `<div class="c-day today">本日${word}</div>`;
  const text = d === 1 ? `明日 ${mdw(t)}${word}` : d > 1 ? `${mdw(t)}${word}・${d}日後` : `${mdw(t)}${word}（過ぎた日）`;
  return `<div class="c-day later">${text}</div>`;
}

/* 受付済みから調理中に移った注文を、音で知らせる（2026-11-01 ko-dai さんの指示。音は注文が入ったときと別の「ピンポーン」）。
   受付待ちと違い、押して止める操作は無いので、COOK_RINGS 回で止まる。カードは COOK_GLOW のあいだ光り、「調理開始」の札が付く。
   鳴らした注文は端末に控える（DB 'cookRung'）ので、「↻ 更新」で開き直しても2回鳴らない。閉じているあいだに時刻を過ぎた分は、開いたときに鳴る */

/** 調理を始める時刻を過ぎた、今日の受け取りの注文か。受付済みに一度も入らなかった注文（できしだい・時刻を過ぎてから受け付けた注文）は入れない。
 *  受け取りの時刻まで過ぎたものは、もう鳴らさない */
function toCook(o, now = new Date()) {
  if (o.status !== 'accepted' || o.asap || beforeCook(o, now)) return false;
  const t = new Date(o.pickupAt);
  return t > now && dateKey(t) === dateKey(now) && new Date(o.times?.accepted) < t - TAKEOUT.cookBefore * 60000;
}

function checkCook(all) {
  const rung = DB.get('cookRung', []);
  const due = all.filter(o => toCook(o) && !rung.includes(o.id));
  if (!due.length) return;
  if (soundOn && audio?.state !== 'running') return;   // いま音を出せない（「画面をタッチ」の前など）。出せるようになったら鳴らす
  const ids = due.map(o => o.id);
  DB.set('cookRung', [...rung, ...ids].slice(-200));
  ids.forEach(id => cookNow.add(id));
  for (let i = 0; i < COOK_RINGS; i++) setTimeout(() => beep(cookChime, 587), i * RING_EVERY);
  setTimeout(() => { ids.forEach(id => cookNow.delete(id)); render(); }, COOK_GLOW);
}

/* 注文の値段と食数を、この画面でも計算し直して確かめる（2026-11-01。Codex のレビューの指摘。公式アプリのセッションの案）。
   受け口はメニューを持たず、送られた値段をそのまま受ける。受け口で断ると正しい注文まで断る危険があるので、合わない注文はカードに知らせて、お店の人が見る。
   バグるマネージで値段を変えた直後は、前の値段の注文にも出ることがある */

// バグるマネージで名前を直すと、お客様のアプリからは直した字で届く（order-api.js の oneLine）。直す前の注文と電話の注文は元の字
const sameOpt = (name, text) => name === text || oneLine(name) === text;

/** 1行の正しい単価（common.js の priceOf の逆。opts の字から、選んだものを探す）。分からないものがあれば null */
function lineUnit(l) {
  const item = ITEM_BY_ID[l.id];
  if (!item) return null;
  let unit = item.price;
  for (const text of l.opts || []) {
    let p = null;
    for (const g of item.groups || []) {
      if (g.type === 'count') {
        for (let m = 1; m <= (g.max || 10) && p === null; m++) if (sameOpt(`${g.choices[0].n}×${m}`, text)) p = g.choices[0].p * m;
      } else {
        const c = g.choices.find(x => sameOpt((g.type === 'one' ? g.label || '' : '') + x.n, text));
        if (c) p = c.p || 0;
      }
      if (p !== null) break;
    }
    if (p === null) return null;
    unit += p;
  }
  return unit;
}

/** 値段・食数が合わない注文の知らせ（合っていれば ''）。進めている注文だけ見る */
function priceCheck(o) {
  if (!ACTIVE.includes(o.status)) return '';
  const units = o.lines.map(lineUnit);
  const meals = mealCount(o.lines);
  if (units.includes(null)) return '<p class="c-check">⚠ 金額を確認：メニューに無い品物か選択があります</p>';
  const total = units.reduce((s, u, i) => s + u * o.lines[i].qty, 0);
  if (total !== o.total) return `<p class="c-check">⚠ 金額を確認：メニューどおりなら ${yen(total)} です</p>`;
  if (meals !== (o.meals || 0)) return `<p class="c-check">⚠ 食数を確認：品物から数えると ${meals}食 です</p>`;
  if (o.kind === 'pickup' && meals >= TAKEOUT.bulkMin) return `<p class="c-check">⚠ 食数を確認：${TAKEOUT.bulkMin}食からは大量注文です</p>`;
  return '';
}

/** カトラリーの有無（2026-11-01 ko-dai さんの指示。お客様が公式アプリで選ぶ）。o.cutlery が true なら付ける、false なら付けない。
 *  聞いていない注文（電話・店頭、前からの注文）は何も出さない */
const cutlery = o => o.cutlery === true ? '<p class="c-cut yes">🍴 カトラリーを付ける</p>'
  : o.cutlery === false ? '<p class="c-cut no">✕ カトラリーは付けない</p>' : '';

function card(o) {
  const t = new Date(o.pickupAt);
  const isToday = dateKey(t) === dateKey(new Date());
  const live = ACTIVE.includes(o.status);   // 進めている注文には、上の帯（本日か明日より先か）を付ける。日付は帯に出す
  const late = ACTIVE.includes(o.status) && t < new Date();
  // 受付済みでも、今日の分は早くできたときのために「できあがり」を出す。明日より先の分は出さない
  const next = isBooked(o) && !isToday ? null : NEXT[o.status];
  const back = backOf(o);
  const map = o.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.address)}` : '';
  const tags = [
    isRequest(o) ? `<span class="c-kind k-${o.kind}">${KIND[o.kind]}・${o.meals || 0}食</span>` : '',
    isRequest(o) && needsFee(o) && o.fee == null ? '<span class="c-kind k-ask">要相談・配達料</span>' : '',
    cookNow.has(o.id) ? '<span class="c-kind k-cook">🔔 調理開始</span>' : '',
    o.asap ? '<span class="c-kind k-asap">できしだい</span>' : '',
    o.route && o.route !== 'アプリ' ? `<span class="c-kind k-route">${esc(o.route)}</span>` : '',   // 電話・店頭で入れた注文
  ].join('');
  const pay = o.kind !== 'delivery' ? '（店頭で支払い）'
    : `（お届けのときに現金で${o.fee != null ? `・配達料 ${yen(o.fee)} は別` : needsFee(o) ? '・配達料は承認のときに決めます' : ''}）`;
  return `<article class="card ${fresh.has(o.id) ? 'fresh' : ''} ${cookNow.has(o.id) ? 'cook-now' : ''} ${late ? 'late' : ''} ${o.kind === 'delivery' ? 'is-delivery' : ''}">
      ${live ? dayStrip(o, t) : ''}
      <div class="c-top">
        <b class="c-no">${esc(o.no)}</b>
        <div class="c-time"><small>${live ? '' : `${isToday ? '今日' : mdw(t)} `}${whenWord(o)}${o.status === 'request' ? '（希望）' : ''}</small><b>${hhmm(t)}${o.asap ? '<i>頃</i>' : ''}</b>${ACTIVE.includes(o.status) && o.status !== 'request' ? `<em>${untilText(o.pickupAt)}</em>` : ''}</div>
      </div>
      ${tags ? `<div class="c-tags">${tags}</div>` : ''}
      <div class="c-who"><b>${esc(who(o))}</b>${o.tel ? `<a href="tel:${esc(o.tel)}">${esc(o.tel)}</a>` : ''}</div>
      ${o.kind === 'delivery' ? `<p class="c-addr">お届け先：${esc(o.address)}${o.address2 ? `　${esc(o.address2)}` : ''}<a href="${map}" target="_blank" rel="noopener">地図</a></p>` : ''}
      <ul class="c-lines">${o.lines.map(l => `
        <li><b>${esc(l.name)}</b><span class="q">×${l.qty}</span>${l.opts.length ? `<div class="c-opts">${l.opts.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : ''}</li>`).join('')}
      </ul>
      ${cutlery(o)}
      ${o.memo ? `<p class="c-memo">ご要望：${esc(o.memo)}</p>` : ''}
      <div class="c-sum"><span>合計${pay}</span><b>${yen(o.total)}</b></div>
      ${priceCheck(o)}
      ${o.shopMsg && o.status !== 'declined' ? `<p class="c-msg">お客様への一言：${esc(o.shopMsg)}</p>` : ''}
      ${o.status === 'canceled' ? `<p class="c-cancel">取り消し（${esc(o.canceledBy || '')}）</p>` : ''}
      ${o.status === 'declined' ? `<p class="c-cancel">お断りしました${o.shopMsg || o.declineNote ? `（${esc(o.shopMsg || o.declineNote)}）` : ''}</p>` : ''}
      ${canAdjust(o) ? `<button class="b-time" data-act="time" data-id="${o.id}">🕐 できあがり時間を調整</button>` : ''}
      <div class="c-btns">
        ${o.status === 'request' ? `
          <button class="b-sub danger" data-act="decline" data-id="${o.id}">お断りする</button>
          <button class="b-main b-approve" data-act="approve" data-id="${o.id}">承認する</button>` : `
        ${back ? `<button class="b-sub" data-act="back" data-id="${o.id}">戻す</button>` : ''}
        ${NEXT[o.status] ? `<button class="b-sub danger" data-act="cancel" data-id="${o.id}">取り消す</button>` : ''}
        ${next ? `<button class="b-main b-${next.to}" data-act="next" data-id="${o.id}">${nextLabel(o)}</button>` : ''}`}
      </div>
    </article>`;
}

/** 注文が終わった日（お渡し済み・取り消し・お断りにした日）。古い形の注文は、更新か受けた日で見る */
const endedDay = o => dateKey(new Date(o.times?.[o.status] || o.updatedAt || o.createdAt || o.pickupAt));

function render() {
  const all = list();
  const today = dateKey(new Date());
  checkCook(all);
  const byTime = (a, b) => a.pickupAt.localeCompare(b.pickupAt);
  for (const col of $$('.col')) {
    const items = all.filter(o => o.status === col.dataset.col && !isBooked(o)).sort(byTime);
    $('.n', col).textContent = items.length;
    $('.list', col).innerHTML = items.length ? items.map(card).join('') : '<p class="none">ありません</p>';
  }
  const later = all.filter(o => isBooked(o)).sort(byTime);
  $('.booked .n').textContent = later.length;
  $('.booked .list').innerHTML = later.length ? later.map(card).join('') : '<p class="none">ありません</p>';
  // 今日終わった注文だけ。日付が変わると消え、次の日の開店のときは空になる（2026-11-01 ko-dai さんの指示。前は受けた日・受け取りの日で見ていたので、前の日に取り消した今日の受け取りの注文が残った）
  const past = all.filter(o => ['done', 'canceled', 'declined'].includes(o.status) && endedDay(o) === today).reverse();
  $('.past .n').textContent = past.length;
  $('.past .list').innerHTML = past.length ? past.map(card).join('') : '<p class="none">ありません</p>';
  const reqs = all.filter(o => o.status === 'request').sort(byTime);
  $('.reqs').hidden = !reqs.length;
  $('.reqs .n').textContent = reqs.length;
  $('.reqs .list').innerHTML = reqs.map(card).join('');

  const accepting = isAccepting();
  $('#accepting').checked = accepting;
  $('#acceptText').textContent = accepting ? '注文を受け付け中' : '受付を止めています';
  $('.s-accept').classList.toggle('off', !accepting);
  // 受付待ちの注文と、返事をしていない申請があるあいだは鳴らし続ける
  const waiting = all.filter(o => ['new', 'request'].includes(o.status)).length;
  ring(soundOn && waiting > 0);
  $('#sound').textContent = !soundOn ? '🔕 音：オフ（押すとオン）' : ringTimer ? '🔔 鳴っています（受け付ける・申請に返事をすると止まります）' : '🔔 音：オン';
  $('#sound').classList.toggle('on', soundOn);
  $('#sound').classList.toggle('warn', !soundOn && waiting > 0);
  document.title = (waiting ? `（${waiting}）` : '') + 'バグるOrder受付';
  paintNet();
}

function checkNew() {
  const all = list();
  if (!known) { known = new Set(all.map(o => o.id)); return; }   // 受け口から、はじめて読めたとき
  const added = all.filter(o => !known.has(o.id));
  if (added.length) {
    added.forEach(o => fresh.add(o.id));
    ring(false);   // 一度止めて、このあとの render で鳴らし直す（新しい注文はすぐ鳴る）
    setTimeout(() => { added.forEach(o => fresh.delete(o.id)); render(); }, 8000);
  }
  known = new Set(all.map(o => o.id));
}

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const o = list().find(x => x.id === b.dataset.id);
  if (!o) return;
  const act = b.dataset.act;
  if (act === 'approve' || act === 'decline') return openDecide(o, act === 'approve');
  if (act === 'time') return openTime(o);
  let patch = null;
  if (act === 'next' && NEXT[o.status]) patch = { status: NEXT[o.status].to };
  if (act === 'back' && backOf(o)) patch = { status: backOf(o) };
  // 調理を始めたあと（調理中・できあがり）は、キャンセル規定の一言を足す（2026-11-01 ko-dai さんの指示。規定は公式アプリに載っている）。お店の都合なら、これまでどおり取り消せる
  const cooked = o.status === 'ready' || (o.status === 'accepted' && !isBooked(o));
  if (act === 'cancel' && confirm(`注文番号 ${o.no}（${who(o)}）を取り消します。${cooked ? '\n\n★調理を始めたあとの、お客様の都合のキャンセルはお断りする決まりです。お店の都合のときだけ取り消してください。\n\n' : ''}お客様にはお電話でもお伝えください。`)) {
    patch = { status: 'canceled', canceledBy: 'お店' };
  }
  if (!patch) return;
  b.disabled = true;   // 受け口に送っているあいだ、2回押されないように
  fresh.delete(o.id);
  const ok = await change(o, patch);
  // ★試作ではお客様と同じ端末なので、ここでスタンプを押す。受け口につないだときは、お客様のスマホが押す（js/order-api.js の stampDoneOrders）
  if (ok && patch.status === 'done' && !ORDERS_ONLINE) addStamp(KIND[o.kind || 'pickup']);
  render();
});

/* ---------------------------------------------------------------------
 *  「できしだい」の注文の、できあがり時間を調整する（2026-11-01 ko-dai さんの指示）
 *  混み具合を見て、注文が入ったあとでお店が時間を動かす。受付待ちと調理中のあいだだけ。時間を指定した注文は動かさない。
 *  変えるのは pickupAt だけ（受け口は saveOrder）。お客様のアプリは、取り寄せたときに新しい時間を出す
 * --------------------------------------------------------------------- */

const canAdjust = o => o.asap && (o.status === 'new' || o.status === 'accepted');
let timing = null;   // { id, from: いまの時刻（ミリ秒）, at: 動かしている時刻（ミリ秒）, updatedAt: 窓を開いたときの更新日時 }

function openTime(o) {
  const from = new Date(o.pickupAt).getTime();
  // 時刻がもう過ぎた注文は、次の5分きざみから動かす
  timing = { id: o.id, from, at: Math.max(from, Math.ceil(Date.now() / 300000) * 300000), updatedAt: o.updatedAt };
  $('#tWho').textContent = `注文番号 ${o.no}（${who(o)}）・いまの時間 ${hhmm(new Date(from))}頃`;
  paintTime();
  $('#timeDlg').showModal();
}

function paintTime() {
  const at = new Date(timing.at);
  $('#tAt').textContent = hhmm(at);
  $('#tLeft').textContent = untilText(at.toISOString());
  // 過ぎた時刻・明日にはできない
  $$('#tBtns [data-min]').forEach(b => {
    const next = new Date(timing.at + Number(b.dataset.min) * 60000);
    b.disabled = next <= new Date() || dateKey(next) !== dateKey(new Date());
  });
  $('#tOk').disabled = timing.at === timing.from;
}

// ★?. は、公開の直後に古い order.html（最大10分）と新しいこの js が組み合わさっても、ここで止まって注文を読まなくならないように
$('#tBtns')?.addEventListener('click', e => {
  const b = e.target.closest('[data-min]');
  if (!b || b.disabled) return;
  timing.at += Number(b.dataset.min) * 60000;
  paintTime();
});

$('#tOk')?.addEventListener('click', async () => {
  const o = list().find(x => x.id === timing?.id);
  if (!o || !canAdjust(o)) { $('#timeDlg').close(); return alert('この注文は、もう先に進んでいます。時間は変えられません。'); }
  $('#tOk').disabled = true;
  // expect は窓を開いたときの値で送る。開いているあいだにほかの端末が変えていたら、黙って上書きしない
  const ok = await change({ ...o, updatedAt: timing.updatedAt }, { pickupAt: new Date(timing.at).toISOString() });
  $('#tOk').disabled = false;
  if (ok || list().find(x => x.id === o.id)?.updatedAt !== timing.updatedAt) $('#timeDlg').close();
});

/* ---------------------------------------------------------------------
 *  配達・大量注文の申請に返事をする（承認・お断り）
 *  ・お客様への一言（shopMsg）は、お客様のアプリの注文の様子に出る
 *  ・配達で TAKEOUT.deliveryFreeMin 食より少ないとき（要相談）は、承認のときに配達料（fee）を入れる。お客様のアプリに出る
 * --------------------------------------------------------------------- */

let deciding = null;   // { id, approve, updatedAt: 窓を開いたときの更新日時 }

function openDecide(o, approve) {
  deciding = { id: o.id, approve, updatedAt: o.updatedAt };
  const t = new Date(o.pickupAt);
  const fee = approve && needsFee(o);
  $('#dTitle').textContent = `${KIND[o.kind]}の申請 ${o.no} を${approve ? '承認する' : 'お断りする'}`;
  $('#dWho').textContent = `${who(o)}・${mdw(t)} ${hhmm(t)} ${whenWord(o)}・${o.meals || 0}食・${yen(o.total)}`;
  $('#dFeeRow').hidden = !fee;
  $('#dFee').value = o.fee ?? '';
  $('#dMsg').value = o.shopMsg || '';
  $('#dMsg').placeholder = approve ? '例：お届けは12時ごろになります' : '例：その日は貸切のため、お受けできません';
  $('#dOk').textContent = approve ? '承認する' : 'お断りする';
  $('#dOk').className = `b-main ${approve ? 'b-approve' : 'b-decline'}`;
  $('#dOk').disabled = false;
  decideErr('');
  $('#decideDlg').showModal();
}
function decideErr(text) { $('#dErr').textContent = text; $('#dErr').hidden = !text; }

$('#dOk').addEventListener('click', async () => {
  const o = list().find(x => x.id === deciding?.id);
  if (!o || o.status !== 'request') { $('#decideDlg').close(); return alert('この申請は、もう返事が済んでいます。'); }
  const patch = { status: deciding.approve ? 'accepted' : 'declined', shopMsg: $('#dMsg').value.trim() };
  if (deciding.approve && needsFee(o)) {
    const v = $('#dFee').value.trim();
    const fee = Number(v);
    if (v === '' || !Number.isInteger(fee) || fee < 0 || fee > 100000) return decideErr('配達料を入れてください（無料なら 0）');
    patch.fee = fee;
  }
  $('#dOk').disabled = true;
  fresh.delete(o.id);
  const ok = await change({ ...o, updatedAt: deciding.updatedAt }, patch);   // 窓を開いたときの内容で返事をする（時間の調整と同じ）
  $('#dOk').disabled = false;
  if (ok || list().find(x => x.id === o.id)?.updatedAt !== deciding.updatedAt) $('#decideDlg').close();
});

/* ---------------------------------------------------------------------
 *  電話・店頭の注文を入れる（受け付けた形で入る：調理中か受付済み。お客様のアプリには出ない）
 *  品物と値段は、公式アプリと同じ（data.js の ITEMS に、バグるマネージで直した分を重ねたもの。common.js の priceOf）。テイクアウトだけ（配達・大量注文は申請から）
 *  バグるマネージで止めたものは、お客様のアプリと同じ扱い：出さないものは並べず、売り切れは選べない（2026-10-31 ko-dai さんの指示）
 * --------------------------------------------------------------------- */

let phone = null;   // 入れている注文 { lines: [{ id, name, opts, unit, qty }], rid }。rid は送り直しで2つにならない印
const phoneMeals = () => mealCount(phone.lines);
const phoneWhen = () => $('input[name="pWhen"]:checked').value;
/** 「できしだい」の時刻（食数で変わる。営業時間の外なら、いまから） */
function phoneAsap() {
  const lead = leadFor(phoneMeals());
  return asapTime(new Date(), lead) || new Date(Math.ceil((Date.now() + lead * 60000) / 300000) * 300000);
}
function phoneErr(text) { $('#pErr').textContent = text; $('#pErr').hidden = !text; }

function openPhone() {
  phone = { lines: [], rid: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10) };
  $('#phoneDlg input[name="pRoute"][value="電話"]').checked = true;
  $('#phoneDlg input[name="pWhen"][value="asap"]').checked = true;
  ['#pName', '#pTel', '#pNote'].forEach(s => { $(s).value = ''; });
  const t = phoneAsap();
  const slot = new Date(Math.ceil(t.getTime() / (TAKEOUT.stepMinutes * 60000)) * TAKEOUT.stepMinutes * 60000);
  $('#pDay').value = $('#pDay').min = dateKey(new Date());
  $('#pDay').value = dateKey(slot);
  $('#pHm').value = hhmm(slot);
  paintItems();
  // 開いたときに、バグるマネージの値段・売り切れも読み直す（CONTENT_EVERY に1回まで）。まだ品物を選んでいなければ、並べ直す
  refreshContent().then(changed => { if (changed && $('#phoneDlg').open && !$('#pItem').value) paintItems(); });
  $('#pQty').value = 1;
  $('#pSend').disabled = false;
  paintOpts();
  paintPhone();
  phoneErr('');
  $('#phoneDlg').showModal();
}

/** 品物の選ぶ欄。出さないものは並べず、売り切れは「売り切れ」と出して選べないようにする */
function paintItems() {
  const label = i => `${esc(i.full || i.name)}（${i.soldOut ? '売り切れ' : yen(i.price) + (i.groups.length ? '〜' : '')}）`;
  $('#pItem').innerHTML = '<option value="">品物を選んでください</option>' + CATEGORIES.map(c => {
    const shown = ITEMS.filter(i => i.cat === c.id && !i.hidden);
    return shown.length ? `<optgroup label="${esc(c.name)}">${shown.map(i => `<option value="${i.id}" ${i.soldOut ? 'disabled' : ''}>${label(i)}</option>`).join('')}</optgroup>` : '';
  }).join('');
}

/** 選んだ品物の、選ぶ項目（ソース・ご飯の量など）。売り切れの項目は選べない */
function paintOpts() {
  const item = ITEM_BY_ID[$('#pItem').value];
  const plus = c => c.soldOut ? '（売り切れ）' : c.p ? `（+${yen(c.p)}）` : '';
  $('#pOpts').innerHTML = !item ? '' : item.groups.map(g => {
    if (g.type === 'one') {
      const def = g.choices.findIndex(c => c.plain && !c.soldOut);   // 「普通」「なし」があれば、はじめからそれ。ソースなどは選んでもらう
      return `<label class="f-opt"><span>${esc(g.name)}</span><select data-g="${g.id}">${def < 0 ? '<option value="">選んでください</option>' : ''}${
        g.choices.map((c, i) => `<option value="${i}" ${i === def ? 'selected' : ''} ${c.soldOut ? 'disabled' : ''}>${esc(c.n)}${plus(c)}</option>`).join('')}</select></label>`;
    }
    if (g.type === 'many') {
      return `<div class="f-opt"><span>${esc(g.name)}（なければ選ばない）</span><div class="f-checks">${
        g.choices.map((c, i) => c.none ? '' : `<label><input type="checkbox" data-g="${g.id}" value="${i}" ${c.soldOut ? 'disabled' : ''}>${esc(c.n)}${plus(c)}</label>`).join('')}</div></div>`;
    }
    if (g.type === 'count') {
      const c = g.choices[0];
      return `<label class="f-opt"><span>${esc(g.name)}（${c.soldOut ? '売り切れ' : `1つ ${yen(c.p)}`}）</span><input type="number" data-g="${g.id}" min="0" max="${g.max || 10}" value="0" inputmode="numeric" ${c.soldOut ? 'disabled' : ''}></label>`;
    }
    return '';
  }).join('');
}

/** 選んだもの（common.js の priceOf に渡す形） */
function readSel(item) {
  const sel = {};
  for (const g of item.groups) {
    if (g.type === 'one') {
      const v = $(`#pOpts select[data-g="${g.id}"]`).value;
      sel[g.id] = v === '' ? null : Number(v);
    }
    if (g.type === 'many') {
      const on = $$(`#pOpts input[data-g="${g.id}"]:checked`).map(x => Number(x.value));
      const none = g.choices.findIndex(c => c.none);
      sel[g.id] = on.length ? on : none >= 0 ? [none] : [];
    }
    if (g.type === 'count') sel[g.id] = Math.max(0, Math.min(g.max || 10, parseInt($(`#pOpts input[data-g="${g.id}"]`).value, 10) || 0));
  }
  return sel;
}

/** 入れた品物・合計・受け取りの時刻 */
function paintPhone() {
  $('#pLines').innerHTML = phone.lines.length ? phone.lines.map((l, i) => `
    <li><b>${esc(l.name)}</b><span class="q">×${l.qty}</span><span class="p-sum">${yen(l.unit * l.qty)}</span><button type="button" class="p-del" data-del="${i}" aria-label="消す">✕</button>${
      l.opts.length ? `<small>${esc(l.opts.join(' / '))}</small>` : ''}</li>`).join('') : '<li class="none">まだ品物がありません</li>';
  $('#pTotal').textContent = yen(phone.lines.reduce((s, l) => s + l.unit * l.qty, 0));
  const asap = phoneWhen() === 'asap';
  $('#pTime').hidden = asap;
  $('#pAsap').hidden = !asap;
  $('#pAsap').textContent = `${hhmm(phoneAsap())}頃（作るのに約${leadFor(phoneMeals())}分。食数で変わります。営業時間の外なら、次に開けてから）`;
}

$('#phoneBtn').addEventListener('click', openPhone);
$('#pItem').addEventListener('change', () => { paintOpts(); phoneErr(''); });
$$('#phoneDlg input[name="pWhen"]').forEach(r => r.addEventListener('change', paintPhone));
$('#pAdd').addEventListener('click', () => {
  const item = ITEM_BY_ID[$('#pItem').value];
  if (!item) return phoneErr('品物を選んでください');
  if (item.soldOut || item.hidden) return phoneErr('この品物は、いま売り切れです');
  const p = priceOf(item, readSel(item));
  if (p.missing) return phoneErr(`「${p.missing.name}」を選んでください`);
  const qty = Math.max(1, Math.min(99, parseInt($('#pQty').value, 10) || 1));
  phone.lines.push({ id: item.id, name: item.full || item.name, opts: p.opts, unit: p.unit, qty });
  $('#pItem').value = '';
  $('#pQty').value = 1;
  paintOpts();
  paintPhone();
  phoneErr('');
});
$('#pLines').addEventListener('click', e => {
  const d = e.target.closest('[data-del]');
  if (!d) return;
  phone.lines.splice(Number(d.dataset.del), 1);
  paintPhone();
});
$$('dialog [data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

$('#pSend').addEventListener('click', async () => {
  const route = $('input[name="pRoute"]:checked').value;
  const name = $('#pName').value.trim();
  const asap = phoneWhen() === 'asap';
  const at = asap ? phoneAsap() : new Date(`${$('#pDay').value}T${$('#pHm').value}`);
  if (route === '電話' && !name) return phoneErr('お名前を入れてください');
  if ($('#pItem').value) return phoneErr('選んだ品物を「＋ 入れる」で入れてください（入れないなら、品物を「品物を選んでください」に戻す）');
  if (!phone.lines.length) return phoneErr('品物を1つ以上入れてください（品物を選んで「＋ 入れる」）');
  if (!asap && (!$('#pDay').value || !$('#pHm').value || isNaN(at))) return phoneErr('受け取りの日と時刻を入れてください');
  if (!asap && at < Date.now() - 5 * 60000) return phoneErr('受け取りの時刻が、もう過ぎています');
  const row = { kind: 'pickup', asap, pickupAt: at.toISOString(), name, tel: $('#pTel').value.trim(), route, note: $('#pNote').value.trim(),
    lines: phone.lines, meals: phoneMeals() };
  $('#pSend').disabled = true;
  const ok = await addPhoneOrder(row);
  $('#pSend').disabled = false;
  if (ok) $('#phoneDlg').close();
});

/** 電話・店頭の注文を入れる。うまくいったら true */
async function addPhoneOrder(row) {
  if (!ORDERS_ONLINE) {
    const now = new Date();
    const o = { id: 'o' + now.getTime(), no: nextOrderNo(now), date: dateKey(now), createdAt: now.toISOString(), status: 'accepted', ...row,
      memo: row.note, total: row.lines.reduce((s, l) => s + l.unit * l.qty, 0), times: { accepted: now.toISOString() } };
    known?.add(o.id);   // 自分で入れた注文には「新しい」の印を付けない
    saveOrders([...getOrders(), o]);
    render();
    return true;
  }
  net.gen++;
  try {
    const r = await staffPost({ action: 'saveOrder', row, rid: phone.rid });   // status を省くと accepted になる
    const o = fromServer(r.row);
    known?.add(o.id);
    put(o);
    return true;
  } catch (e) {
    if (!quiet(e)) phoneErr(staffText(e));
    return false;
  } finally {
    net.gen++;
    render();
  }
}

/* ---------------------------------------------------------------------
 *  合言葉の画面（受け口につないだときだけ）
 * --------------------------------------------------------------------- */

$('#pinGate').addEventListener('submit', async e => {
  e.preventDefault();
  const pin = $('#pin').value.trim();
  if (!pin) return;
  if (TABLET && soundOn) unlockSound().then(() => { checkSound(); render(); });   // 触ったついでに、音も出せるようにする（iPad）
  const btn = $('#pinGate button');
  btn.disabled = true;
  $('#pinErr').hidden = true;
  try {
    const r = await ask({ action: 'orders', pin });
    pinSet(pin);
    $('#pin').value = '';
    $('#pinGate').hidden = true;
    net.error = '';
    net.at = Date.now();
    take(r);
  } catch (err) {
    $('#pinErr').textContent = staffText(err);
    $('#pinErr').hidden = false;
  }
  btn.disabled = false;
  render();
});

$('#accepting').addEventListener('change', async e => {
  const on = e.target.checked;
  e.target.disabled = true;
  await setAccepting(on);
  e.target.disabled = false;
  render();
});
// 「更新」：画面を読み直す（公開した新しい版もここで入る。注文は保存してある・受け口にあるので消えない）。
// ★iPad は読み直すと音が止まるので、また「画面をタッチしてください」が出る（ブラウザの決まり）
$('#reloadBtn').addEventListener('click', () => location.reload());
$('#homeBtn').hidden = $('#pinHome').hidden = !FROM_OWNER;
$('#homeBtn').addEventListener('click', goOwner);
$('#pinHome').addEventListener('click', goOwner);   // 合言葉を入れずに戻れるように
// 音をオンにして、試しに1回鳴らす（受付待ちがあれば、そのまま鳴り続ける）。押した・触ったその場で呼ぶ
function soundOnNow() {
  soundOn = true;
  const ready = unlockSound();
  checkSound();
  ready.then(() => {
    checkSound();
    render();
    if (soundOn && !ringTimer) beep();
  });
}

$('#sound').addEventListener('click', () => {
  if (soundOn) { soundOn = false; checkSound(); render(); return; }
  soundOnNow();
});
$('#soundGate').addEventListener('click', soundOnNow);
// タブレットを起こした・ほかのアプリから戻ったときは、音をもう一度出せるようにする（出せなければ「画面をタッチ」が出る）。注文も読み直す
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && soundOn && audio) audio.resume().catch(() => {});
  if (document.visibilityState === 'visible') { pull(); refreshContent(); }
  setTimeout(checkSound, 500);
});

DB.onChange(key => {
  if (key === 'orders' && !ORDERS_ONLINE) checkNew();
  render();
});
// T3Works の営業日も読み直す（30分に1回まで。変わっていたら描き直す）
const syncDays = () => refreshDays().then(changed => changed && render());
setInterval(() => { render(); syncDays(); refreshContent(); }, 30000);
$('#cookBefore').textContent = TAKEOUT.cookBefore;   // 「受付済み」の見出しの「◯分前」
// バグるマネージで直した値段・売り切れ（../js/content.js）を重ねる。電話・店頭の注文の窓を、公式アプリとそろえるため（2026-10-31 ko-dai さんの指示）。
// 前に読んだ分をすぐ重ね、そのあと受け口から読み直す（CONTENT_EVERY に1回まで）。読めないときは、前の控え（無ければ data.js）のまま
applyContent(contentNow()?.content);
refreshContent();
render();
syncDays();
// 受け口につないだときは、15秒ごとに注文を読み直す。電波が戻ったときもすぐ読む。合言葉がまだなら、合言葉の画面を出す
if (ORDERS_ONLINE) {
  setInterval(pull, POLL_EVERY);
  window.addEventListener('online', pull);
  if (pinGet()) pull(); else askPin();
}
// タブレットは、開いたときから音をオンにする。ブラウザが許さないとき（まだ画面に触っていない）は、少し待って「画面をタッチ」を出す
if (TABLET) {
  unlockSound().then(() => { checkSound(); render(); });
  setTimeout(checkSound, 600);
}

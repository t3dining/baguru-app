/* =====================================================================
 *  お店の画面（タブレットで開いておく想定）
 *  届いた注文を「受け付ける → できあがり → お渡し済み」と進める。
 *  受け付けた注文は、受け取りの30分前（TAKEOUT.cookBefore）までは「受付済み」に入り、それを過ぎると「調理中」に移る。
 *  お渡し済みにすると、そのお客様のスタンプが1個たまる（試作ではここで押す。受け口につないだときは、お客様のスマホが押す）。
 *  電話・店頭の注文も、ここから入れる。
 *  ★テイクアウトの操作は、すべてこの画面でする（2026-10-30 ko-dai さん。予約ボードのテイクアウトの画面は見るだけ）
 *  ★お店に置くスタンプのQRを出す・印刷する・作り直すボタンは、2026-10-30 に外した（ko-dai さんの指示）
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
// 戻り先は、バグる Owner が控えた sessionStorage の bg.owner（?test で開いたときは ?test 付き）。★お店のタブレットのホーム画面から開いたときは出さない
const OWNER_URL = 'https://t3dining.github.io/baguru-app/owner/';
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
  location.href = to || OWNER_URL;
}

const RING_EVERY = 3000;   // 受付待ちの注文があるあいだ、この間隔（ミリ秒）で鳴らし続ける
const CHIME_URL = 'snd/order.wav';   // 注文が入ったときの音（1.8秒。道具/注文の音を作る.py で作る）

// タブレット（iPad など。画面の短いほうが600以上）は、開いたときから音はオン。「音」のボタンで、そのときだけ止められる。
// スマホは前のように、音はオフで始まり「音」のボタンで選ぶ（2026-10-30 ko-dai さん）。パソコンはタブレットと同じ扱い
const TABLET = Math.min(screen.width, screen.height) >= 600;
let soundOn = TABLET;
let audio = null;
let chime = null;   // 読み込んだ音。読めなかったときは、前の「ピッピッ」で鳴らす
let ringTimer = null;
// 新しく届いた注文に印を付けるため。受け口につないだときは、はじめて読めたときに埋める（開いたときからある注文には印を付けない）
let known = ORDERS_ONLINE ? null : new Set(getOrders().map(o => o.id));
const fresh = new Set();

/* ---------------------------------------------------------------------
 *  受け口とのやりとり（ORDERS_ONLINE のときだけ）
 *  ・合言葉は予約ボードと同じもの。予約ボードと同じ所（localStorage の baguru.daicho.pin）に置くので、同じブラウザなら1回入れれば両方で使える。
 *    受け口に「合言葉が違う」と言われたら消して、入れ直してもらう（予約ボードと同じ）
 *  ・受け口の注文は、このブラウザの DB 'orders' に入れない（同じブラウザで公式アプリを開くと、お客様の「自分の注文」に混ざるため）。
 *    画面を開いているあいだだけ持ち、開き直したら読み直す
 * --------------------------------------------------------------------- */

const PIN_KEY = 'baguru.daicho.pin';
const POLL_EVERY = 15000;   // 受け口に頼まれた 10〜20秒
// orders：受け口の注文／accepting：受付中か／at：最後に読めた時刻／error：読めなかったわけ
// gen：進めた回数。読んでいるあいだに進めたら、その読んだ答えは古いので使わない
const net = { orders: [], accepting: true, at: 0, error: '', gen: 0, loading: null };
const STAFF_MSG = {
  bad_pin: '合言葉が違います。',
  locked: '合言葉を何度も間違えたので、10分止まっています。少し待ってから入れ直してください。',
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
const quiet = e => e?.code === 'bad_pin' || e?.code === 'locked';   // 合言葉の画面に出すので、ほかには出さない

function pinGet() { try { return localStorage.getItem(PIN_KEY) || ''; } catch (e) { return ''; } }
function pinSet(v) { try { if (v) localStorage.setItem(PIN_KEY, v); else localStorage.removeItem(PIN_KEY); } catch (e) {} }

/** 合言葉を付けて受け口に送る。合言葉が違う・止まっているときは、合言葉の画面を出す */
async function staffPost(payload) {
  try {
    return await orderPost({ ...payload, pin: pinGet() });
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
  try {
    const r = await staffPost({ action: 'setTakeout', accepting: on });
    net.accepting = r.accepting !== false;
  } catch (e) {
    if (!quiet(e)) alert(staffText(e));
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
  bar.className = `net-bar ${net.error ? 'ng' : 'ok'}`;
  bar.textContent = net.error ? `⚠ ${test}${net.error}${last}新しい注文が届いていないかもしれません。`
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
  if (chime || !audio) return Promise.resolve();
  return fetch(CHIME_URL)
    .then(r => r.arrayBuffer())
    .then(b => new Promise((ok, ng) => audio.decodeAudioData(b, ok, ng)))   // 古い Safari は、この書き方しか使えない
    .then(buf => { chime = buf; })
    .catch(() => {});
}

function beep() {
  if (!soundOn || !audio) return;
  if (audio.state === 'suspended') audio.resume();   // タブレットがしばらく裏に回ると止まることがある
  if (chime) {
    const s = audio.createBufferSource();
    s.buffer = chime;
    s.connect(audio.destination);
    s.start();
    return;
  }
  [0, 0.28].forEach(t => {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = 880;
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
    o.asap ? '<span class="c-kind k-asap">できしだい</span>' : '',
    o.route && o.route !== 'アプリ' ? `<span class="c-kind k-route">${esc(o.route)}</span>` : '',   // 電話・店頭で入れた注文
  ].join('');
  const pay = o.kind !== 'delivery' ? '（店頭で支払い）'
    : `（お届けのときに現金で${o.fee != null ? `・配達料 ${yen(o.fee)} は別` : needsFee(o) ? '・配達料は承認のときに決めます' : ''}）`;
  return `<article class="card ${fresh.has(o.id) ? 'fresh' : ''} ${late ? 'late' : ''} ${o.kind === 'delivery' ? 'is-delivery' : ''}">
      ${live ? dayStrip(o, t) : ''}
      <div class="c-top">
        <b class="c-no">${esc(o.no)}</b>
        <div class="c-time"><small>${live ? '' : `${isToday ? '今日' : mdw(t)} `}${whenWord(o)}${o.status === 'request' ? '（希望）' : ''}</small><b>${hhmm(t)}${o.asap ? '<i>頃</i>' : ''}</b>${ACTIVE.includes(o.status) && o.status !== 'request' ? `<em>${untilText(o.pickupAt)}</em>` : ''}</div>
      </div>
      ${tags ? `<div class="c-tags">${tags}</div>` : ''}
      <div class="c-who"><b>${esc(who(o))}</b>${o.tel ? `<a href="tel:${esc(o.tel)}">${esc(o.tel)}</a>` : ''}</div>
      ${o.kind === 'delivery' ? `<p class="c-addr">お届け先：${esc(o.address)}${o.address2 ? `　${esc(o.address2)}` : ''}<a href="${map}" target="_blank" rel="noopener">地図</a></p>` : ''}
      <ul class="c-lines">${o.lines.map(l => `
        <li><b>${esc(l.name)}</b><span class="q">×${l.qty}</span>${l.opts.length ? `<small>${esc(l.opts.join(' / '))}</small>` : ''}</li>`).join('')}
      </ul>
      ${o.memo ? `<p class="c-memo">ご要望：${esc(o.memo)}</p>` : ''}
      <div class="c-sum"><span>合計${pay}</span><b>${yen(o.total)}</b></div>
      ${o.shopMsg && o.status !== 'declined' ? `<p class="c-msg">お客様への一言：${esc(o.shopMsg)}</p>` : ''}
      ${o.status === 'canceled' ? `<p class="c-cancel">取り消し（${esc(o.canceledBy || '')}）</p>` : ''}
      ${o.status === 'declined' ? `<p class="c-cancel">お断りしました${o.shopMsg || o.declineNote ? `（${esc(o.shopMsg || o.declineNote)}）` : ''}</p>` : ''}
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

function render() {
  const all = list();
  const today = dateKey(new Date());
  const byTime = (a, b) => a.pickupAt.localeCompare(b.pickupAt);
  for (const col of $$('.col')) {
    const items = all.filter(o => o.status === col.dataset.col && !isBooked(o)).sort(byTime);
    $('.n', col).textContent = items.length;
    $('.list', col).innerHTML = items.length ? items.map(card).join('') : '<p class="none">ありません</p>';
  }
  const later = all.filter(o => isBooked(o)).sort(byTime);
  $('.booked .n').textContent = later.length;
  $('.booked .list').innerHTML = later.length ? later.map(card).join('') : '<p class="none">ありません</p>';
  const past = all.filter(o => ['done', 'canceled', 'declined'].includes(o.status) && (o.date === today || dateKey(new Date(o.pickupAt)) === today)).reverse();
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
  let patch = null;
  if (act === 'next' && NEXT[o.status]) patch = { status: NEXT[o.status].to };
  if (act === 'back' && backOf(o)) patch = { status: backOf(o) };
  if (act === 'cancel' && confirm(`注文番号 ${o.no}（${who(o)}）を取り消します。お客様にはお電話でもお伝えください。`)) {
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
 *  配達・大量注文の申請に返事をする（承認・お断り）
 *  ・お客様への一言（shopMsg）は、お客様のアプリの注文の様子に出る
 *  ・配達で TAKEOUT.deliveryFreeMin 食より少ないとき（要相談）は、承認のときに配達料（fee）を入れる。お客様のアプリに出る
 * --------------------------------------------------------------------- */

let deciding = null;   // { id, approve }

function openDecide(o, approve) {
  deciding = { id: o.id, approve };
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
  const ok = await change(o, patch);
  $('#dOk').disabled = false;
  if (ok || list().find(x => x.id === o.id)?.status !== 'request') $('#decideDlg').close();
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
 *  LINE のポイントの引き継ぎ（2026-10-30 ko-dai さんの指示：店頭で引き継ぐ形。公式アプリのセッションに頼まれた）
 *  LINE は、お店の側から一人ずつのポイント数を見られない。会計のときにお客様の LINE のショップカードを見て数を確かめ、
 *  その数のQRを出す。お客様が公式アプリで読むと、同じ数がたまる（スタンプを押すのはお客様のアプリ。ここでは押さない）。
 *  QRの中身（common.js の lineUrl）・決まり（data.js の STAMP.lineMove：1回に max まで・作ってから validMin 分だけ使える）は公式アプリのもの
 * --------------------------------------------------------------------- */

let lineN = 0;          // 選んだ数
let lineTimer = null;   // 残りの時間を数える（時間が過ぎたらQRを消す）

function openLine() {
  lineN = 0;
  $('#lineNums').innerHTML = Array.from({ length: STAMP.lineMove.max }, (_, i) =>
    `<button type="button" role="radio" aria-checked="false" data-n="${i + 1}">${i + 1}</button>`).join('');
  $('#lineMake').disabled = true;
  $('#lineMake').textContent = 'QRを出す';
  clearLine();
  lineErr('');
  $('#lineDlg').showModal();
}
function lineErr(text) { $('#lineErr').textContent = text; $('#lineErr').hidden = !text; }
function clearLine() {
  clearInterval(lineTimer);
  lineTimer = null;
  $('#lineOut').hidden = true;
  $('#lineQr').innerHTML = '';
}

$('#lineNums').addEventListener('click', e => {
  const b = e.target.closest('[data-n]');
  if (!b) return;
  lineN = Number(b.dataset.n);
  $$('#lineNums [data-n]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
  $('#lineMake').disabled = false;
  $('#lineMake').textContent = `${lineN}ポイントのQRを出す`;
  clearLine();   // 数を選び直したら、前のQRは消す（違う数のQRを読ませないため）
});

$('#lineMake').addEventListener('click', async () => {
  if (!lineN) return;
  const n = lineN, made = Date.now(), until = made + STAMP.lineMove.validMin * 60000;
  $('#lineMake').disabled = true;
  lineErr('');
  try {
    await loadScript(LIB.qrMake);   // QRを描く道具（qrcode-generator。common.js の LIB）。使うときだけ読む
  } catch (e) {
    $('#lineMake').disabled = false;
    return lineErr('QRを描く道具を読めませんでした。Wi-Fi・電波を確かめて、もう一度押してください。');
  }
  const q = qrcode(0, 'M');
  q.addData(lineUrl(n, new Date(made)));
  q.make();
  clearLine();
  $('#lineQr').innerHTML = q.createSvgTag({ cellSize: 6, margin: 2 });
  $('#lineN').textContent = `${n}ポイント`;
  $('#lineOut').hidden = false;
  $('#lineOut').scrollIntoView({ block: 'nearest' });   // 窓が画面より高いとき（横にしたタブレットなど）も、QRが見えるように
  $('#lineMake').disabled = false;
  const tick = () => {
    if (!$('#lineDlg').open) return clearLine();   // 窓を閉じたら、QRも消す
    const left = Math.ceil((until - Date.now()) / 1000);
    if (left <= 0) {
      clearLine();
      return lineErr('時間が過ぎたので、QRを消しました。もう一度「QRを出す」を押してください。');
    }
    $('#lineLeft').textContent = `このQRは${STAMP.lineMove.validMin}分だけ使えます（あと ${Math.floor(left / 60)}分${String(left % 60).padStart(2, '0')}秒）`;
  };
  tick();
  lineTimer = setInterval(tick, 1000);
});
$('#lineBtn').addEventListener('click', openLine);
// 閉じたらQRを消す（置きっぱなしにしない）。「閉じる」・Esc のどちらでも
$('#lineDlg').addEventListener('close', clearLine);
$('#lineDlg [data-close]').addEventListener('click', clearLine);

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
    const r = await orderPost({ action: 'orders', pin });
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

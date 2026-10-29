/* =====================================================================
 *  お店の画面（タブレットで開いておく想定）
 *  届いた注文を「受け付ける → できあがり → お渡し済み」と進める。
 *  受け付けた注文は、受け取りの30分前（TAKEOUT.cookBefore）までは「受付済み」に入り、それを過ぎると「調理中」に移る。
 *  お渡し済みにすると、そのお客様のスタンプが1個たまる。
 *  ★お店に置くスタンプのQRを出す・印刷する・作り直すボタンは、2026-10-30 に外した（ko-dai さんの指示）
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

const RING_EVERY = 3000;   // 受付待ちの注文があるあいだ、この間隔（ミリ秒）で鳴らし続ける
const CHIME_URL = 'snd/order.wav';   // 注文が入ったときの音（1.8秒。道具/注文の音を作る.py で作る）

// タブレット（iPad など。画面の短いほうが600以上）は、開いたときから音はオン。「音」のボタンで、そのときだけ止められる。
// スマホは前のように、音はオフで始まり「音」のボタンで選ぶ（2026-10-30 ko-dai さん）。パソコンはタブレットと同じ扱い
const TABLET = Math.min(screen.width, screen.height) >= 600;
let soundOn = TABLET;
let audio = null;
let chime = null;   // 読み込んだ音。読めなかったときは、前の「ピッピッ」で鳴らす
let ringTimer = null;
let known = new Set(getOrders().map(o => o.id));   // 新しく届いた注文に印を付けるため
const fresh = new Set();

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

function card(o) {
  const t = new Date(o.pickupAt);
  const isToday = dateKey(t) === dateKey(new Date());
  const late = ACTIVE.includes(o.status) && t < new Date();
  // 受付済みでも、今日の分は早くできたときのために「できあがり」を出す。明日より先の分は出さない
  const next = isBooked(o) && !isToday ? null : NEXT[o.status];
  const back = backOf(o);
  const map = o.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.address)}` : '';
  return `<article class="card ${fresh.has(o.id) ? 'fresh' : ''} ${late ? 'late' : ''} ${o.kind === 'delivery' ? 'is-delivery' : ''}">
      <div class="c-top">
        <b class="c-no">${o.no}</b>
        <div class="c-time"><small>${isToday ? '今日' : mdw(t)} ${whenWord(o)}${o.status === 'request' ? '（希望）' : ''}</small><b>${hhmm(t)}${o.asap ? '<i>頃</i>' : ''}</b>${ACTIVE.includes(o.status) && o.status !== 'request' ? `<em>${untilText(o.pickupAt)}</em>` : ''}</div>
      </div>
      ${isRequest(o) || o.asap ? `<div class="c-tags">${isRequest(o) ? `<span class="c-kind k-${o.kind}">${KIND[o.kind]}・${o.meals || 0}食</span>${needsFee(o) ? '<span class="c-kind k-ask">要相談・配達料</span>' : ''}` : '<span class="c-kind k-asap">できしだい</span>'}</div>` : ''}
      <div class="c-who"><b>${esc(o.name)} 様</b><a href="tel:${esc(o.tel)}">${esc(o.tel)}</a></div>
      ${o.kind === 'delivery' ? `<p class="c-addr">お届け先：${esc(o.address)}${o.address2 ? `　${esc(o.address2)}` : ''}<a href="${map}" target="_blank" rel="noopener">地図</a></p>` : ''}
      <ul class="c-lines">${o.lines.map(l => `
        <li><b>${esc(l.name)}</b><span class="q">×${l.qty}</span>${l.opts.length ? `<small>${esc(l.opts.join(' / '))}</small>` : ''}</li>`).join('')}
      </ul>
      ${o.memo ? `<p class="c-memo">ご要望：${esc(o.memo)}</p>` : ''}
      <div class="c-sum"><span>合計${o.kind === 'delivery' ? `（お届けのときに現金で${needsFee(o) ? '・配達料は承認のときにお伝えください' : ''}）` : '（店頭で支払い）'}</span><b>${yen(o.total)}</b></div>
      ${o.status === 'canceled' ? `<p class="c-cancel">取り消し（${esc(o.canceledBy || '')}）</p>` : ''}
      ${o.status === 'declined' ? `<p class="c-cancel">お断りしました${o.declineNote ? `（${esc(o.declineNote)}）` : ''}</p>` : ''}
      <div class="c-btns">
        ${o.status === 'request' ? `
          <button class="b-sub danger" data-act="decline" data-id="${o.id}">お断りする</button>
          <button class="b-main b-approve" data-act="approve" data-id="${o.id}">承認する</button>` : `
        ${back ? `<button class="b-sub" data-act="back" data-id="${o.id}">戻す</button>` : ''}
        ${o.status === 'new' ? `<button class="b-sub danger" data-act="cancel" data-id="${o.id}">取り消す</button>` : ''}
        ${next ? `<button class="b-main b-${next.to}" data-act="next" data-id="${o.id}">${nextLabel(o)}</button>` : ''}`}
      </div>
    </article>`;
}

function render() {
  const all = getOrders();
  const today = dateKey(new Date());
  const byTime = (a, b) => a.pickupAt.localeCompare(b.pickupAt);
  for (const col of $$('.col')) {
    const list = all.filter(o => o.status === col.dataset.col && !isBooked(o)).sort(byTime);
    $('.n', col).textContent = list.length;
    $('.list', col).innerHTML = list.length ? list.map(card).join('') : '<p class="none">ありません</p>';
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

  const accepting = DB.get('accepting', true);
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
}

function checkNew() {
  const all = getOrders();
  const added = all.filter(o => !known.has(o.id));
  if (added.length) {
    added.forEach(o => fresh.add(o.id));
    ring(false);   // 一度止めて、このあとの render で鳴らし直す（新しい注文はすぐ鳴る）
    setTimeout(() => { added.forEach(o => fresh.delete(o.id)); render(); }, 8000);
  }
  known = new Set(all.map(o => o.id));
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const o = getOrders().find(x => x.id === b.dataset.id);
  if (!o) return;
  if (b.dataset.act === 'next') {
    const to = NEXT[o.status].to;
    updateOrder(o.id, { status: to });
    // ★試作ではお客様と同じ端末なので、ここでスタンプを押す。本番はサーバーがお客様のカードに押す
    if (to === 'done') addStamp(KIND[o.kind || 'pickup']);
  }
  if (b.dataset.act === 'back') updateOrder(o.id, { status: backOf(o) });
  if (b.dataset.act === 'approve' && confirm(`${KIND[o.kind]}の申請 ${o.no}（${o.name} 様・${mdw(new Date(o.pickupAt))} ${hhmm(new Date(o.pickupAt))}）を承認します。この注文は確定になります。よろしいですか？`)) {
    updateOrder(o.id, { status: 'accepted' });
  }
  if (b.dataset.act === 'decline') {
    const note = prompt(`${KIND[o.kind]}の申請 ${o.no}（${o.name} 様）をお断りします。お客様の画面に出す一言があれば入れてください（なくても構いません）。`, '');
    if (note !== null) updateOrder(o.id, { status: 'declined', declineNote: note.trim() });
  }
  if (b.dataset.act === 'cancel' && confirm(`注文番号 ${o.no}（${o.name} 様）を取り消します。お客様にはお電話でもお伝えください。`)) {
    updateOrder(o.id, { status: 'canceled', canceledBy: 'お店' });
  }
  fresh.delete(o.id);
  render();
});

$('#accepting').addEventListener('change', e => { DB.set('accepting', e.target.checked); render(); });
// 「更新」：画面を読み直す（公開した新しい版もここで入る。注文は保存してあるので消えない）。
// ★iPad は読み直すと音が止まるので、また「画面をタッチしてください」が出る（ブラウザの決まり）
$('#reloadBtn').addEventListener('click', () => location.reload());
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
// タブレットを起こした・ほかのアプリから戻ったときは、音をもう一度出せるようにする（出せなければ「画面をタッチ」が出る）
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && soundOn && audio) audio.resume().catch(() => {});
  setTimeout(checkSound, 500);
});

DB.onChange(key => {
  if (key === 'orders') checkNew();
  render();
});
// T3Works の営業日も読み直す（30分に1回まで。変わっていたら描き直す）
const syncDays = () => refreshDays().then(changed => changed && render());
setInterval(() => { render(); syncDays(); }, 30000);
$('#cookBefore').textContent = TAKEOUT.cookBefore;   // 「受付済み」の見出しの「◯分前」
render();
syncDays();
// タブレットは、開いたときから音をオンにする。ブラウザが許さないとき（まだ画面に触っていない）は、少し待って「画面をタッチ」を出す
if (TABLET) {
  unlockSound().then(() => { checkSound(); render(); });
  setTimeout(checkSound, 600);
}

/* =====================================================================
 *  お店の画面（タブレットで開いておく想定）
 *  届いた注文を「受け付ける → できあがり → お渡し済み」と進める。
 *  お渡し済みにすると、そのお客様のスタンプが1個たまる。
 *  お店に置くスタンプのQRも、ここで出して印刷する（上の「スタンプのQR」）。
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

const RING_EVERY = 5000;   // 受付待ちの注文があるあいだ、この間隔（ミリ秒）で鳴らし続ける

let soundOn = false;
let audio = null;
let ringTimer = null;
let known = new Set(getOrders().map(o => o.id));   // 新しく届いた注文に印を付けるため
const fresh = new Set();

function beep() {
  if (!soundOn || !audio) return;
  if (audio.state === 'suspended') audio.resume();   // タブレットがしばらく裏に回ると止まることがある
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
  const next = NEXT[o.status];
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
    const list = all.filter(o => o.status === col.dataset.col).sort(byTime);
    $('.n', col).textContent = list.length;
    $('.list', col).innerHTML = list.length ? list.map(card).join('') : '<p class="none">ありません</p>';
  }
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
  document.title = (waiting ? `（${waiting}）` : '') + 'バグる 店舗用';
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
$('#sound').addEventListener('click', () => {
  soundOn = !soundOn;
  if (soundOn && !audio) audio = new (window.AudioContext || window.webkitAudioContext)();
  render();
  if (soundOn && !ringTimer) beep();   // 受付待ちがないときは、試しに1回だけ鳴らす
});

/* ---------------------------------------------------------------------
 *  スタンプのQR（お店に置く）
 * --------------------------------------------------------------------- */

const qrDlg = $('#qrDlg');

async function drawQr() {
  const url = stampUrl();
  const boxes = $$('.qr-box');
  boxes.forEach(b => { b.textContent = 'QRを作っています…'; });
  $('.qr-url', qrDlg).textContent = url;
  // 公開前のアドレス（このパソコンの中）だと、お客様のスマホでは開けない
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$|\.local$/.test(new URL(url).hostname);
  const warn = $('.qr-warn', qrDlg);
  warn.hidden = !local;
  warn.textContent = '試作：このQRは、このパソコンの中のアドレスです。お客様のスマホでは開けません。アプリを公開したら、data.js の SHOP.appUrl に公開先のアドレスを入れてから印刷してください。';
  try {
    await loadScript(LIB.qrMake);
    const qr = qrcode(0, 'M');   // 0 = 大きさは中身に合わせて自動。M = 15%ほど汚れても読める
    qr.addData(url);
    qr.make();
    const svgTag = qr.createSvgTag({ cellSize: 8, margin: 4, scalable: true, alt: 'スタンプのQR' });
    boxes.forEach(b => { b.innerHTML = svgTag; });
  } catch (e) {
    boxes.forEach(b => { b.textContent = 'QRを作れませんでした。インターネットにつながっているか確かめて、もう一度開いてください。'; });
  }
}

$('#qrBtn').addEventListener('click', () => { qrDlg.showModal(); drawQr(); });
qrDlg.addEventListener('click', e => {
  const k = e.target.closest('[data-q]')?.dataset.q;
  const r = qrDlg.getBoundingClientRect();
  const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  if (k === 'close' || (e.target === qrDlg && outside)) qrDlg.close();   // 枠の外を押しても閉じる
  if (k === 'print') window.print();
  if (k === 'renew' && confirm('スタンプのQRを作り直します。前に印刷したQRは使えなくなります。よろしいですか？')) {
    DB.set('qrVersion', qrVersion() + 1);
    drawQr();
  }
});

DB.onChange(key => {
  if (key === 'orders') checkNew();
  render();
});
// T3Works の営業日も読み直す（30分に1回まで。変わっていたら描き直す）
const syncDays = () => refreshDays().then(changed => changed && render());
setInterval(() => { render(); syncDays(); }, 30000);
render();
syncDays();

/* =====================================================================
 *  スタンプ：お店に置いたQRを読む → お店にいるかを位置で確かめる → 1個たまる
 *  ・アプリの「QRを読んでスタンプをもらう」… アプリの中でカメラを使って読む
 *    （ホーム画面のアプリのまま、そのアプリのカードにたまる）
 *  ・スマホのカメラアプリで読んだとき … アドレスの ?stamp= から同じ流れに入る（app.js のいちばん下）
 *  お店の外（STAMP.place から radius メートルより遠い）では押さない。
 *  ・LINE のポイントの引き継ぎは、会員番号を見せてお店の人が数を入れるか（下の openLineMove）、紙の券を読む（下の claimTicket）
 *  ※ app.js より先に読む（openSheet などは app.js にあるが、使うのは押されたあと）
 * ===================================================================== */

const DEV_HOST = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);   // この Mac で試すときだけ。★公開先では、試作のボタン（QRを読んだことにする など）を出さない
let camera = null;        // 動いているカメラ（閉じるときに止める）
let scanTimer = 0;
let scanId = 0;           // 止めるたびに変わる（閉じたあとに届いたカメラや読み取りを使わないため）
let pendingToken = '';    // 読んだ印（「もう一度試す」で読み直さずに済むように）

function stopCamera() {
  scanId++;
  clearTimeout(scanTimer);
  camera?.getTracks().forEach(t => t.stop());
  camera = null;
}

/** QR を読むしくみ。ブラウザにあればそれ（Android の Chrome など）、なければ jsQR を読みこむ */
async function qrReader() {
  if ('BarcodeDetector' in window) {
    try {
      if ((await BarcodeDetector.getSupportedFormats()).includes('qr_code')) {
        const d = new BarcodeDetector({ formats: ['qr_code'] });
        return async src => (await d.detect(src))[0]?.rawValue || '';
      }
    } catch (e) { /* jsQR を使う */ }
  }
  await loadScript(LIB.qrRead);
  const cv = document.createElement('canvas');
  const cx = cv.getContext('2d', { willReadFrequently: true });
  return async src => {
    const w = src.videoWidth || src.width, h = src.videoHeight || src.height;
    if (!w || !h) return '';
    const k = Math.min(1, 640 / Math.max(w, h));   // 大きいままだと遅いので縮めて読む
    cv.width = Math.round(w * k);
    cv.height = Math.round(h * k);
    cx.drawImage(src, 0, 0, cv.width, cv.height);
    return jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height, { inversionAttempts: 'dontInvert' })?.data || '';
  };
}

const CAMERA_NG = {
  NotAllowedError: 'カメラが許可されていません。スマホの設定でカメラを許可するか、スマホのカメラアプリでQRを読んでください。',
  NotFoundError: 'カメラが見つかりません。スマホのカメラアプリでQRを読んでください。',
  NotReadableError: 'カメラを他のアプリが使っています。他のアプリを閉じて、もう一度開いてください。',
};

/** QRを読む画面。ticket … 紙の LINE 引き継ぎ券を読むとき（今日のスタンプをもらったあとでも読める。スマホのカメラアプリでは読めない） */
async function openScanner({ ticket = false } = {}) {
  if (!ticket && stampedToday()) return toast(`スタンプは1日${STAMP.perDay}個までです`);
  stopCamera();
  const id = scanId;
  openSheet(`
    <button class="sheet-x" data-s="close" aria-label="閉じる">×</button>
    <div class="scan">
      ${ticket ? '<h2>引き継ぎのQRを読む</h2><p>お店の人が見せている紙のQRを、枠の中に入れてください。</p>' : '<h2>お店のQRを読む</h2><p>レジの横などに置いてある、スタンプのQRを枠の中に入れてください。</p>'}
      <div class="scan-view"><video playsinline muted></video><i class="scan-frame"></i></div>
      <p class="scan-msg">カメラを準備しています…</p>
      ${ticket ? '' : '<p class="hint">カメラが使えないときは、スマホのカメラアプリでQRを読んでもスタンプがたまります。</p>'}
      ${DEV_HOST && !ticket ? `<p class="demo-hint">試作版：パソコンで試すときは <button data-s="demo">QRを読んだことにする</button></p>` : ''}
    </div>`);
  sheetBody.onchange = null;
  sheetBody.onclick = e => {
    const k = e.target.closest('[data-s]')?.dataset.s;
    if (k === 'close') closeSheet();
    if (DEV_HOST && k === 'demo') { stopCamera(); claimStamp('demo'); }
  };
  const video = $('video', sheetBody);
  const stillOpen = () => id === scanId;
  const msg = t => { if (stillOpen()) $('.scan-msg', sheetBody).textContent = t; };
  const noCamera = t => msg(ticket ? 'カメラを使えません。スマホの設定でカメラを許可するか、お店の人に会員番号を見せてください。' : t);

  if (!navigator.mediaDevices?.getUserMedia) return noCamera('この開き方ではカメラを使えません。スマホのカメラアプリでQRを読んでください。');
  const reader = qrReader();   // カメラを待つあいだに読みこんでおく
  reader.catch(() => {});      // カメラが先にだめになったときに、失敗を放っておかない
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    if (!stillOpen()) return stream.getTracks().forEach(t => t.stop());   // 待っているあいだに閉じられた
    camera = stream;
    video.srcObject = stream;
    await video.play();
  } catch (e) {
    if (!stillOpen()) return;
    noCamera(CAMERA_NG[e.name] || 'カメラを使えませんでした。スマホのカメラアプリでQRを読んでください。');
    return stopCamera();
  }
  let read;
  try { read = await reader; } catch (e) {
    if (!stillOpen()) return;
    msg('QRを読む仕組みを読み込めませんでした。電波の良いところで、もう一度開いてください。');
    return stopCamera();
  }
  if (!stillOpen()) return;
  msg('QRを枠の中に入れてください');
  let warned = 0;
  const tick = async () => {
    if (!stillOpen()) return;
    let text = '';
    try { text = await read(video); } catch (e) { /* 次の回にもう一度 */ }
    if (!stillOpen()) return;
    const token = ticket ? '' : tokenFrom(text), code = LINE_TICKETS ? ticketFrom(text) : '';
    if (token) { stopCamera(); navigator.vibrate?.(40); return claimStamp(token); }
    if (code) { stopCamera(); navigator.vibrate?.(40); return claimTicket(code); }
    if (text && Date.now() - warned > 2500) { warned = Date.now(); msg(ticket ? 'LINEの引き継ぎのQRではないようです' : 'バグるのスタンプのQRではないようです'); }
    scanTimer = setTimeout(tick, 200);
  };
  tick();
}

// アプリを裏に回したらカメラを止める（つけっぱなしにしない）
document.addEventListener('visibilitychange', () => { if (document.hidden && camera) closeSheet(); });

/* ---- お店にいるかを確かめて押す ---- */

const farText = m => m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(1)}km`;

function claimStamp(token) {
  pendingToken = token;
  if (stampedToday()) return stampProblem('今日のスタンプはもらいました', `スタンプは1日${STAMP.perDay}個までです。またのご来店をお待ちしています。`);
  if (!navigator.geolocation) return stampProblem('お店にいるかを確かめられません', 'このスマホ・ブラウザでは位置情報を使えません。', { demo: true });
  openSheet(`
    <div class="checking">
      <span class="spin"></span>
      <h2>お店にいるか確かめています</h2>
      <p>「位置情報の利用」を尋ねられたら、「許可」を押してください。</p>
    </div>`);
  sheetBody.onchange = null;
  sheetBody.onclick = null;
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    if (STAMPS_ONLINE) return claimOnline(token, lat, lng, accuracy);
    const far = distanceM({ lat, lng }, STAMP.place);
    if (far > STAMP.place.radius + Math.min(accuracy || 0, STAMP.place.slack)) {
      return stampProblem('お店の外にいるようです', `今の場所は、お店から約${farText(far)}離れています。お店の中（駐車場を含む）で、もう一度試してください。`, { retry: true, demo: true });
    }
    giveStamp();
  }, err => {
    if (err.code === err.PERMISSION_DENIED) return stampProblem('位置情報が許可されていません', locationHelp(), { retry: true, demo: true });
    stampProblem('今の場所が分かりませんでした', 'Wi-Fi と位置情報をオンにして、窓の近くなどで、もう一度試してください。', { retry: true, demo: true });
  }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
}

/** 台帳につないだとき：印と位置を受け口へ送って、受け口が決める（位置は判定に使うだけで、保存しない） */
function claimOnline(token, lat, lng, accuracy) {
  stampPost('stampClaim', { token, lat, lng, accuracy }).then(r => {
    lastStampTotal = getStamps().total;
    pendingToken = '';
    showStamped(r);
    render(true);
  }).catch(e => {
    if (e.code === 'far') return stampProblem('お店の外にいるようです', `今の場所は、お店から約${farText(e.data.far)}離れています。お店の中（駐車場を含む）で、もう一度読んでください。`, { retry: true });
    if (e.code === 'today') return stampProblem('今日のスタンプはもらいました', `スタンプは1日${STAMP.perDay}個までです。またのご来店をお待ちしています。`);
    if (e.code === 'bad_qr') return stampProblem('このQRは使えません', '古いQRかもしれません。お店の人に声をかけてください。');
    stampProblem('スタンプを押せませんでした', stampMessage(e), { retry: true });
  });
}

function giveStamp() {
  const r = addStamp('ご来店');
  lastStampTotal = getStamps().total;
  if (!r.ok) return stampProblem('今日のスタンプはもらいました', `スタンプは1日${STAMP.perDay}個までです。`);
  pendingToken = '';
  showStamped(r);
  render(true);
}

/* ---- LINE のポイントを引き継ぐ ---- */

/** 会員番号を見せて、お店の人が数を入れるのを待つ。数を決めるのはお店（受け口の lineGive。1会員1回）。
 *  お客さまが LINE の画面を見せに行って戻ってくるので、見えていないあいだは読まずに待つ */
const LINE_EVERY = 6000, LINE_WAIT = 10 * 60000;
function openLineMove() {
  const before = getStamps().total;
  memberReady().then(a => {
    openSheet(`
      <button class="sheet-x" data-s="close" aria-label="閉じる">×</button>
      <div class="coupon-big" id="lineWait">
        <p class="cb-label">LINEのポイントの引き継ぎ</p>
        <h2 class="member-no">${esc(a.no)}</h2>
        <p>この会員番号と、LINEのショップカードの画面を、お店の人に見せてください。お店の人が数を入れると、この画面が変わります。</p>
        ${LINE_TICKETS ? '<p>お店の人が紙のQRを見せたときは、下のボタンから読んでください。</p><button class="btn btn-sub btn-block" data-s="ticket">紙のQRを読む</button>' : ''}
      </div>`);
    sheetBody.onchange = null;
    sheetBody.onclick = e => {
      const k = e.target.closest('[data-s]')?.dataset.s;
      if (k === 'close') closeSheet();
      if (k === 'ticket') openScanner({ ticket: true });
    };
    const until = Date.now() + LINE_WAIT;
    const waiting = () => !sheet.hidden && $('#lineWait', sheetBody);
    const look = () => {
      if (!waiting() || Date.now() > until) return;
      if (document.visibilityState !== 'visible') return setTimeout(look, LINE_EVERY);
      stampPost('stampRead').then(() => {
        if (!waiting()) return;
        const s = getStamps();
        if (!s.lineMovedAt) return setTimeout(look, LINE_EVERY);
        lastStampTotal = s.total;
        render(true);
        if (s.total <= before) { closeSheet(); return toast('LINEのポイントは引き継ぎ済みです'); }
        showStamped({ on: stampOnCard(s.total), from: stampOnCard(before), got: [], moved: true }, `${s.total - before}ポイント引き継ぎました`);
      }).catch(e => {
        if (e.code !== 'bad_member') return setTimeout(look, LINE_EVERY);   // つながらないときは、次の回に
        closeSheet();
        toast(stampMessage(e), 'warn');
      });
    };
    setTimeout(look, LINE_EVERY);
  }).catch(e => toast(stampMessage(e), 'warn'));
}

/** 紙の LINE 引き継ぎ券（スタンプ台帳の決めごと.md の10節）。1枚1回。★QRの中身はアドレスにしない。カメラアプリで開くと、ホーム画面のアプリとは別の場所の会員に使われて、券だけ消えるため */
const ticketFrom = text => (String(text).match(/^BAGURULINE:([0-9A-Z]{16})$/) || [])[1] || '';
function claimTicket(code) {
  const before = getStamps().total;
  stampPost('lineClaim', { code }).then(r => {
    lastStampTotal = getStamps().total;
    showStamped({ on: r.on, from: stampOnCard(before), got: [], moved: true }, `${r.n}ポイント引き継ぎました`);
    render(true);
  }).catch(e => {
    if (e.code === 'line_done') return stampProblem('LINEのポイントは引き継ぎ済みです', '引き継ぎは1回だけです。このQRは使っていないので、お店の人に返してください。');
    if (e.code === 'ticket_used') return stampProblem('このQRは、もう使われています', 'お店の人に、会員番号を見せてください。');
    if (e.code === 'bad_ticket') return stampProblem('このQRは使えません', 'お店の人に、会員番号を見せてください。');
    stampProblem('引き継げませんでした', stampMessage(e));
  });
}

function locationHelp() {
  return ENV.ios
    ? 'お店にいるかを確かめるのに使います。iPhone の「設定」→「プライバシーとセキュリティ」→「位置情報サービス」をオンにし、その中の「Safari の Web サイト」などを「使用中のみ許可」にしてから、もう一度試してください。'
    : 'お店にいるかを確かめるのに使います。アドレスの左のマーク（またはメニューの「設定」→「サイトの設定」）で、位置情報を「許可」にしてから、もう一度試してください。';
}

/** うまくいかなかったとき。retry … もう一度確かめるボタン、demo … 試作だけのボタン */
function stampProblem(title, body, { retry = false, demo = false } = {}) {
  openSheet(`
    <button class="sheet-x" data-s="close" aria-label="閉じる">×</button>
    <div class="stamp-ng">
      <span class="ng-ic">${ICON.pin}</span>
      <h2>${esc(title)}</h2>
      <p>${esc(body)}</p>
      ${retry ? '<button class="btn btn-main btn-block" data-s="retry">もう一度試す</button>' : ''}
      <button class="btn btn-sub btn-block" data-s="close">閉じる</button>
      ${demo && DEV_HOST ? '<p class="demo-hint">試作版：お店の外で試すときは <button data-s="demo">お店にいることにする</button></p>' : ''}
    </div>`);
  sheetBody.onchange = null;
  sheetBody.onclick = e => {
    const k = e.target.closest('[data-s]')?.dataset.s;
    if (k === 'close') closeSheet();
    if (k === 'retry') claimStamp(pendingToken);
    if (DEV_HOST && k === 'demo') giveStamp();
  };
}

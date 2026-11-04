/* =====================================================================
 *  スタンプ：お店に置いたQRを読む → お店にいるかを位置で確かめる → 1個たまる
 *  ・アプリの「QRを読んでスタンプをもらう」… アプリの中でカメラを使って読む
 *    （ホーム画面のアプリのまま、そのアプリのカードにたまる）
 *  ・スマホのカメラアプリで読んだとき … アドレスの ?stamp= から同じ流れに入る（app.js のいちばん下）
 *  お店の外（STAMP.place から radius メートルより遠い）では押さない。
 *  ・LINE のポイントの引き継ぎは、お店の人が見せる紙の券を読む形だけ（下の openLineMove・claimTicket。2026-11-02 ko-dai さんの指示で、会員番号を見せてお店の人が数を入れる形はやめた）
 *  ※ app.js より先に読む（openSheet などは app.js にあるが、使うのは押されたあと）
 * ===================================================================== */

const DEV_HOST = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);   // この Mac で試すときだけ。★公開先では、試作のボタン（QRを読んだことにする など）を出さない
let camera = null;        // 動いているカメラ（閉じるときに止める）
let scanTimer = 0;
let scanId = 0;           // 止めるたびに変わる（閉じたあとに届いたカメラや読み取りを使わないため）
let pendingToken = '';    // 読んだ印（「もう一度試す」で読み直さずに済むように）
let geoWatch = null;      // QRを読んでいるあいだに、先に取っておく位置（watchPosition の番号）
let geoFix = null;        // 先に取った位置 { lat, lng, accuracy, at }（いちばん確かなもの）

function stopCamera() {
  scanId++;
  clearTimeout(scanTimer);
  camera?.getTracks().forEach(t => t.stop());
  camera = null;
  if (geoWatch !== null) navigator.geolocation?.clearWatch(geoWatch);
  geoWatch = null;
}

/* ---- 読み取ってからを速くする（2026-11-04 ko-dai さんの指示：「LINEの引き継ぎやポイントの反映が、読み取りからの時間が長い」） ----
 *  ・スタンプのQRを読んでいるあいだに、位置を先に取っておく（watchPosition）。読めたら、その位置ですぐ受け口へ送る。
 *    前は、読めてから位置を取り始めていた（屋内だと数秒〜20秒かかる）。先に取った位置で、お店の中と言えないときだけ、前のとおり取り直す
 *  ・読めたらすぐ「押しています」「引き継いでいます」の画面にする（前は、止まったカメラの画面のまま待っていた） */
const GEO_FRESH = 60000;   // 先に取った位置を使うのは、取ってから1分まで
function watchGeo() {
  if (!navigator.geolocation || geoWatch !== null) return;
  geoWatch = navigator.geolocation.watchPosition(pos => {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    const fresh = geoFix && Date.now() - geoFix.at < GEO_FRESH;
    if (!fresh || accuracy <= geoFix.accuracy + 20) geoFix = { lat, lng, accuracy, at: Date.now() };   // 前より確かな位置（か、古くなったら新しい位置）を残す
  }, () => { /* だめなときは、読めたあとに前のとおり取り直す（そこで許可の案内を出す） */ }, { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 });
}
/** 先に取った位置で、お店の中と言えるなら、その位置（受け口と同じ数え方）。言えなければ null */
function geoReady() {
  if (!geoFix || Date.now() - geoFix.at > GEO_FRESH) return null;
  const far = distanceM(geoFix, STAMP.place);
  return far <= STAMP.place.radius + Math.min(geoFix.accuracy || 0, STAMP.place.slack) ? geoFix : null;
}
/** 読めたあと、受け口の答えを待つあいだの画面 */
function busySheet(title, body) {
  openSheet(`<div class="checking"><span class="spin"></span><h2>${esc(title)}</h2><p>${esc(body)}</p></div>`);
  sheetBody.onchange = null;
  sheetBody.onclick = null;
}

/* ---- カメラの映像を、自分で描いて見せる（2026-11-04 ko-dai さんの報告：「カメラが起動していても画面が真っ暗だが、QRは読み取れている」） ----
 *  iPhone では、下から出る画面（動きのある、角を丸めた枠）の中の video が、映像は届いているのに黒いまま描かれないことがある
 *  （QRは video から読むので読める）。そこで video の上に canvas を重ね、届いた映像を毎回 canvas に描いて見せる。
 *  映像がふつうに出る端末でも、同じものが重なるだけ。止めたら（scanId が変わったら）描くのもやめる */
function drawPreview(video, canvas, stillOpen) {
  const cx = canvas.getContext('2d');
  const step = () => {
    if (!stillOpen()) return;
    const w = video.videoWidth, h = video.videoHeight;
    if (w && h && video.readyState >= 2) {
      const dpr = Math.min(2, window.devicePixelRatio || 1), cw = Math.round(canvas.clientWidth * dpr), ch = Math.round(canvas.clientHeight * dpr);
      if (cw && ch) {
        if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
        const k = Math.max(cw / w, ch / h);   // 枠いっぱいに（video の object-fit: cover と同じ）
        cx.drawImage(video, (cw - w * k) / 2, (ch - h * k) / 2, w * k, h * k);
        canvas.classList.add('on');
      }
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
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
  NotAllowedError: 'カメラが許可されていません。スマホの設定でカメラを許可してから、もう一度開いてください。',
  NotFoundError: 'カメラが見つかりません。カメラのあるスマホで開いてください。',
  NotReadableError: 'カメラを他のアプリが使っています。他のアプリを閉じて、もう一度開いてください。',
};

/** QRを読む画面。ticket … 紙の LINE 引き継ぎ券を読むとき（今日のスタンプをもらったあとでも読める。スマホのカメラアプリでは読めない） */
async function openScanner({ ticket = false } = {}) {
  if (!ticket && stampDoneToday()) return toast(`スタンプは1日${STAMP.perDay}個までです`);
  stopCamera();
  const id = scanId;
  openSheet(`
    <button class="sheet-x" data-s="close" aria-label="閉じる">×</button>
    <div class="scan">
      ${ticket ? '<h2>引き継ぎのQRを読む</h2><p>お店の人が見せているQR（紙か画面）を、枠の中に入れてください。</p>' : '<h2>お店のQRを読む</h2><p>レジの横などに置いてある、スタンプのQRを枠の中に入れてください。</p>'}
      <div class="scan-view"><video playsinline muted autoplay></video><canvas aria-hidden="true"></canvas><i class="scan-frame"></i></div>
      <p class="scan-msg">カメラを準備しています…</p>
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
  const noCamera = t => msg(ticket ? 'カメラを使えません。スマホの設定でカメラを許可してから、もう一度開いてください。' : t);

  if (!navigator.mediaDevices?.getUserMedia) return noCamera('この開き方ではカメラを使えません。ホーム画面のアイコンから開き直してください。');
  const reader = qrReader();   // カメラを待つあいだに読みこんでおく
  reader.catch(() => {});      // カメラが先にだめになったときに、失敗を放っておかない
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    if (!stillOpen()) return stream.getTracks().forEach(t => t.stop());   // 待っているあいだに閉じられた
    camera = stream;
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    drawPreview(video, $('.scan-view canvas', sheetBody), stillOpen);
    // 映像が来ないまま（大きさが 0 のまま）なら、つなぎ直す
    setTimeout(() => { if (stillOpen() && !video.videoWidth) { video.srcObject = null; video.srcObject = stream; video.play().catch(() => {}); } }, 1500);
    if (!ticket && !TEST_MEMBER && STAMPS_ONLINE) watchGeo();   // スタンプのときは、読んでいるあいだに位置を先に取っておく
  } catch (e) {
    if (!stillOpen()) return;
    noCamera(CAMERA_NG[e.name] || 'カメラを使えませんでした。スマホの設定でカメラを許可してから、もう一度開いてください。');
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
    const token = ticket ? '' : tokenFrom(text), code = MEMBER_PLUS ? ticketFrom(text) : '';
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
  if (stampDoneToday()) return stampProblem('今日のスタンプはもらいました', `スタンプは1日${STAMP.perDay}個までです。またのご来店をお待ちしています。`);
  if (TEST_MEMBER) return claimOnline(token, STAMP.place.lat, STAMP.place.lng, 0);   // テスト用アカウントは位置を聞かない（受け口も確かめない。15節）
  const early = STAMPS_ONLINE && geoReady();
  if (early) return claimOnline(token, early.lat, early.lng, early.accuracy);   // 読んでいるあいだに取った位置で、すぐ送る
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
  busySheet('スタンプを押しています', 'そのままお待ちください。');
  stampPost('stampClaim', { token, lat, lng, accuracy }).then(r => {
    lastStampTotal = getStamps().total;
    pendingToken = '';
    showStamped(r);
    render(true);
  }).catch(e => {
    if (e.code === 'far') geoFix = null;   // 「もう一度」では、位置を取り直す
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

/** スタンプの「LINEのポイントカードをお持ちの方」。お店の人が見せる紙の券を、そのまま読む画面を開く（引き継げるのは登録した人だけ） */
function openLineMove() {
  if (!ME.registeredAt) return stampProblem('先に会員登録をお願いします', STAMP_MSG.need_register);
  openScanner({ ticket: true });
}

/** 紙の LINE 引き継ぎ券（スタンプ台帳の決めごと.md の10節）。券は何度でも使える。1会員1回は受け口が止める。★QRの中身はアドレスにしない。カメラアプリで開くと、ホーム画面のアプリとは別の場所の空の会員に入ってしまうため */
const ticketFrom = text => (String(text).match(/^BAGURULINE:([0-9A-Z]{16})$/) || [])[1] || '';
function claimTicket(code) {
  const before = getStamps().total;
  busySheet('LINEのポイントを引き継いでいます', 'そのままお待ちください。');
  stampPost('lineClaim', { code }).then(r => {
    lastStampTotal = getStamps().total;
    showStamped({ on: r.on, from: stampOnCard(before), got: [], moved: true }, `${r.n}ポイント引き継ぎました`);
    render(true);
  }).catch(e => {
    if (e.code === 'line_done') return stampProblem('LINEのポイントは引き継ぎ済みです', '引き継ぎは1回だけです。QRはお店の人に返してください。');
    if (e.code === 'need_register') return stampProblem('先に会員登録をお願いします', STAMP_MSG.need_register);
    if (e.code === 'bad_ticket') return stampProblem('このQRは使えません', '古いQRかもしれません。お店の人に声をかけてください。');
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

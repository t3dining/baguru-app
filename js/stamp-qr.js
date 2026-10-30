/* =====================================================================
 *  スタンプ：お店に置いたQRを読む → お店にいるかを位置で確かめる → 1個たまる
 *  ・アプリの「QRを読んでスタンプをもらう」… アプリの中でカメラを使って読む
 *    （ホーム画面のアプリのまま、そのアプリのカードにたまる）
 *  ・スマホのカメラアプリで読んだとき … アドレスの ?stamp= から同じ流れに入る（app.js のいちばん下）
 *  お店の外（STAMP.place から radius メートルより遠い）では押さない。
 *  ・LINE のポイントの引き継ぎのQR（?line=）も、同じカメラで読む（下の claimLine。お店にいるかは確かめない。QRに時間切れがある）
 *  ※ app.js より先に読む（openSheet などは app.js にあるが、使うのは押されたあと）
 * ===================================================================== */

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

/** QRを読む画面。line … LINE のポイントの引き継ぎのQRを読むとき（今日のスタンプをもらったあとでも読める） */
async function openScanner({ line = false } = {}) {
  if (!line && stampedToday()) return toast(`スタンプは1日${STAMP.perDay}個までです`);
  stopCamera();
  const id = scanId;
  openSheet(`
    <button class="sheet-x" data-s="close" aria-label="閉じる">×</button>
    <div class="scan">
      ${line
        ? '<h2>引き継ぎのQRを読む</h2><p>お店の人がお店の画面に出した、LINEのポイントの引き継ぎのQRを枠の中に入れてください。</p>'
        : '<h2>お店のQRを読む</h2><p>レジの横などに置いてある、スタンプのQRを枠の中に入れてください。</p>'}
      <div class="scan-view"><video playsinline muted></video><i class="scan-frame"></i></div>
      <p class="scan-msg">カメラを準備しています…</p>
      <p class="hint">カメラが使えないときは、スマホのカメラアプリでQRを読んでも${line ? '引き継げます' : 'スタンプがたまります'}。</p>
      <p class="demo-hint">試作版：パソコンで試すときは ${line ? '<button data-s="demo-line">5ポイントの引き継ぎのQRを読んだことにする</button>' : '<button data-s="demo">QRを読んだことにする</button>'}</p>
    </div>`);
  sheetBody.onchange = null;
  sheetBody.onclick = e => {
    const k = e.target.closest('[data-s]')?.dataset.s;
    if (k === 'close') closeSheet();
    if (k === 'demo') { stopCamera(); claimStamp(qrToken()); }
    if (k === 'demo-line') { stopCamera(); claimLine(lineToken(5)); }
  };
  const video = $('video', sheetBody);
  const stillOpen = () => id === scanId;
  const msg = t => { if (stillOpen()) $('.scan-msg', sheetBody).textContent = t; };

  if (!navigator.mediaDevices?.getUserMedia) return msg('この開き方ではカメラを使えません。スマホのカメラアプリでQRを読んでください。');
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
    msg(CAMERA_NG[e.name] || 'カメラを使えませんでした。スマホのカメラアプリでQRを読んでください。');
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
    const token = tokenFrom(text), moving = lineFrom(text);
    if (token) { stopCamera(); navigator.vibrate?.(40); return claimStamp(token); }
    if (moving) { stopCamera(); navigator.vibrate?.(40); return claimLine(moving); }
    if (text && Date.now() - warned > 2500) { warned = Date.now(); msg(line ? 'バグるの引き継ぎのQRではないようです' : 'バグるのスタンプのQRではないようです'); }
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
  if (token !== qrToken()) return stampProblem('このQRは使えません', '古いQRかもしれません。お店の人に声をかけてください。');
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

function giveStamp() {
  const r = addStamp('ご来店');
  lastStampTotal = getStamps().total;
  if (!r.ok) return stampProblem('今日のスタンプはもらいました', `スタンプは1日${STAMP.perDay}個までです。`);
  pendingToken = '';
  showStamped(r);
  render(true);
}

/* ---- LINE のポイントを引き継ぐ（common.js の「LINE のショップカードからの引き継ぎ」） ---- */
function claimLine(token) {
  const c = checkLine(token);
  if (c.error === 'old') return stampProblem('このQRは時間切れです', `引き継ぎのQRは、お店の画面に出してから${STAMP.lineMove.validMin}分だけ使えます。お店の人に、もう一度出してもらってください。`);
  if (c.error) return stampProblem('このQRは使えません', 'お店の人に声をかけてください。');
  if (getStamps().lineMovedAt) return stampProblem('LINEのポイントは引き継ぎ済みです', 'この端末には、もう引き継いであります（引き継ぎは1回だけです）。');
  const r = moveFromLine(c.n);
  lastStampTotal = getStamps().total;
  showStamped(r, `${c.n}ポイント引き継ぎました`);   // 長いと2行に折れるので、LINE の名前は入れない
  render(true);
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
      ${demo ? '<p class="demo-hint">試作版：お店の外で試すときは <button data-s="demo">お店にいることにする</button></p>' : ''}
    </div>`);
  sheetBody.onchange = null;
  sheetBody.onclick = e => {
    const k = e.target.closest('[data-s]')?.dataset.s;
    if (k === 'close') closeSheet();
    if (k === 'retry') claimStamp(pendingToken);
    if (k === 'demo') giveStamp();
  };
}

/* =====================================================================
 *  ホーム画面に追加の案内
 *  ・Android（Chrome など）… ボタンを押すと、ブラウザの「インストールしますか」が出る
 *  ・iPhone／iPad … ボタンで追加する仕組みがないので、手順を絵つきで見せる
 *  ・LINE／インスタの中で開いたとき … そのままでは追加できないので、ブラウザで開き直してもらう
 *  ホーム画面から開いているとき（追加済み）は何も出さない。
 *  ※ app.js より先に読む（ホームを描くときに installCard を使う）
 * ===================================================================== */

const UA = navigator.userAgent;
const ENV = {
  ios: /iPhone|iPad|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  android: /Android/.test(UA),
  // アプリの中のブラウザ（ホーム画面に追加のメニューがない）
  inApp: / Line\//.test(UA) ? 'LINE' : /Instagram/.test(UA) ? 'インスタ' : /FBAN|FBAV|FB_IAB/.test(UA) ? 'Facebook' : '',
  installed: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
};
const HIDE_DAYS = 14;            // ホームの案内の「×」を押したら、この日数は出さない
const appUrl = () => location.origin + location.pathname;
let installPrompt = null;        // Android の「インストールしますか」を出すためのもの（ブラウザから届く）

// LINE から開き直したときに付く印は、アドレスから消しておく
if (/[?&]openExternalBrowser=/.test(location.search)) history.replaceState(null, '', location.pathname + location.hash);

addEventListener('beforeinstallprompt', e => {
  e.preventDefault();            // ブラウザが勝手に出す案内は止めて、アプリのボタンから出す
  installPrompt = e;
  if (routeName() === 'home' && !sheet.classList.contains('show')) render(true);
});

addEventListener('appinstalled', () => {
  installPrompt = null;
  toast('ホーム画面に追加しました', 'good');
  render(true);
});

function installMode() {
  if (ENV.installed) return '';
  if (ENV.inApp) return 'inapp';
  if (ENV.ios) return 'ios';
  if (installPrompt) return 'prompt';
  return ENV.android ? 'android' : 'pc';
}

const browserName = () => ENV.ios ? 'Safari' : 'ブラウザ';

/* ---- ホームの案内・マイページ ---- */

function installCard() {
  const mode = installMode();
  if (!mode || Date.now() < DB.get('installHideUntil', 0)) return '';
  const add = ['ホーム画面に追加しませんか', 'アプリのように、ワンタップで開けます'];
  const [title, sub, btn] = {
    prompt:  [...add, '追加する'],
    ios:     [...add, '追加の仕方'],
    android: [...add, '追加の仕方'],
    pc:      ['スマホのホーム画面に追加できます', 'スマホで開いて、ホーム画面に追加してください', '追加の仕方'],
    inapp:   [`${ENV.inApp}の中で開いています`, `ホーム画面に追加するには、${browserName()}で開き直してください`, ENV.inApp === 'LINE' ? `${browserName()}で開く` : '開き方を見る'],
  }[mode];
  return `<div class="install ${mode === 'inapp' ? 'inapp' : ''}">
      <img src="img/icon-192.png" alt="">
      <div><b>${title}</b><small>${sub}</small><button class="btn btn-small" data-act="install">${btn}</button></div>
      <button class="install-x" data-act="install-hide" aria-label="閉じる">×</button>
    </div>`;
}

function installRow() {
  if (ENV.installed) return `<h2 class="sec">ホーム画面</h2><p class="notice">${ICON.check}<span>ホーム画面から開いています</span></p>`;
  return `<h2 class="sec">ホーム画面に追加</h2>
    <button class="link-card" data-act="install-guide">${ICON.addbox}<span><b>ホーム画面に追加の仕方</b><small>アプリのように、ワンタップで開けます</small></span></button>`;
}

function startInstall() {
  const mode = installMode();
  if (mode === 'prompt') return askInstall();
  if (mode === 'inapp' && ENV.inApp === 'LINE') return openInBrowser();
  openInstallGuide();
}

async function askInstall() {
  const p = installPrompt;
  if (!p) return openInstallGuide('android');
  installPrompt = null;          // 1回しか使えない
  if (sheet.classList.contains('show')) closeSheet();
  p.prompt();
  const { outcome } = await p.userChoice;
  if (outcome !== 'accepted') render(true);   // やめたときは「追加の仕方」の案内に変わる
}

// LINE は、アドレスの最後に openExternalBrowser=1 を付けると、いつものブラウザで開く
const openInBrowser = () => { location.href = appUrl() + '?openExternalBrowser=1'; };

async function copyUrl() {
  try {
    await navigator.clipboard.writeText(appUrl());
    toast('アドレスをコピーしました');
  } catch (e) {
    prompt('このアドレスをコピーして、Safari や Chrome に貼り付けてください', appUrl());
  }
}

function hideInstallCard() {
  DB.set('installHideUntil', Date.now() + HIDE_DAYS * 864e5);
  render(true);
  toast('マイページからも、追加の仕方を見られます');
}

/* ---- 追加の仕方（下から出る画面） ---- */

const GUIDE_TABS = { ios: 'iPhone', android: 'Android', inapp: 'LINE・インスタ' };

function openInstallGuide(tab) {
  tab = tab || (ENV.inApp ? 'inapp' : ENV.android ? 'android' : 'ios');
  const body = { ios: guideIos, android: guideAndroid, inapp: guideInApp }[tab];
  openSheet(`
    <button class="sheet-x" data-s="close" aria-label="閉じる">×</button>
    <div class="guide">
      <div class="guide-head"><img src="img/icon-192.png" alt=""><div><h2>ホーム画面に追加する</h2><p>ホーム画面の「${esc(SHOP.name)}」から、すぐ開けるようになります。</p></div></div>
      <div class="seg">${Object.entries(GUIDE_TABS).map(([k, v]) => `<button class="${k === tab ? 'on' : ''}" data-s="tab:${k}">${v}</button>`).join('')}</div>
      ${body()}
    </div>`);
  sheetBody.onchange = null;
  sheetBody.onclick = e => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    const [k, arg] = b.dataset.s.split(':');
    if (k === 'close') return closeSheet();
    if (k === 'tab') return openInstallGuide(arg);
    if (k === 'prompt') return askInstall();
    if (k === 'open') return openInBrowser();
    if (k === 'copy') return copyUrl();
  };
}

// 手順の1行（番号は CSS で付く）。mock はスマホの画面を簡単にまねた絵
const step = (text, note = '', mock = '') => `<li><p class="st-txt"><span>${text}${note ? `<small>${note}</small>` : ''}</span></p>${mock}</li>`;
const host = () => esc(location.hostname || SHOP.name);
const appRow = () => `<span class="m-app"><img src="img/icon-192.png" alt="">${esc(SHOP.name)}</span>`;
const homeMock = () => `<div class="mock m-home"><i></i><i></i><span><img src="img/icon-192.png" alt=""><small>${esc(SHOP.name)}</small></span><i></i></div>`;
const lastStep = () => step('ホーム画面に牛のアイコンができます', '次からは、このアイコンから開いてください。', homeMock());

function guideIos() {
  return `<ol class="steps">
      ${step('画面の下にある<b>共有ボタン</b>を押します', '見当たらないときは、右下の「…」を押すと出てきます。iPad は画面の右上にあります。',
        `<div class="mock m-bar"><span class="m-ic">${ICON.back}</span><span class="m-url">${host()}</span><span class="m-ic hl">${ICON.share}</span><span class="m-ic">${ICON.dots}</span></div>`)}
      ${step('メニューを上にずらして、<b>「ホーム画面に追加」</b>を押します', '',
        `<div class="mock m-list"><span>コピー${ICON.copy}</span><span class="hl">ホーム画面に追加${ICON.addbox}</span></div>`)}
      ${step('右上の<b>「追加」</b>を押します', '「Webアプリとして開く」が出ていたら、オンのままにしてください。',
        `<div class="mock m-list"><span class="m-head"><em>キャンセル</em><b>ホーム画面に追加</b><em class="hl">追加</em></span>${appRow()}<span>Webアプリとして開く<i class="m-sw"></i></span></div>`)}
      ${lastStep()}
    </ol>
    <p class="hint">Chrome で開いているときも、アドレスの右の共有ボタン →「ホーム画面に追加」で追加できます。</p>`;
}

function guideAndroid() {
  return `${installPrompt ? `
      <button class="btn btn-main btn-block guide-go" data-s="prompt">${ICON.addbox}ホーム画面に追加する</button>
      <p class="hint">押すと確認が出ます。「インストール」を押すと追加されます。うまくいかないときは、下の手順でも追加できます。</p>` : ''}
    <ol class="steps">
      ${step('右上の<b>「⋮」</b>（メニュー）を押します', 'ブラウザによって、メニューの場所や名前が少し違います。',
        `<div class="mock m-bar and"><span class="m-ic">${ICON.home}</span><span class="m-url">${host()}</span><span class="m-ic hl">${ICON.kebab}</span></div>`)}
      ${step('<b>「ホーム画面に追加」</b>または<b>「アプリをインストール」</b>を押します', '',
        `<div class="mock m-list and"><span>新しいタブ</span><span>履歴</span><span class="hl">ホーム画面に追加</span></div>`)}
      ${step('<b>「インストール」</b>（または「追加」）を押します', '',
        `<div class="mock m-dlg"><div><b>アプリをインストール</b>${appRow()}<p><em>キャンセル</em><em class="hl">インストール</em></p></div></div>`)}
      ${lastStep()}
    </ol>`;
}

function guideInApp() {
  return `<p class="guide-lead">LINE やインスタの中で開いていると、ホーム画面に追加できません。いつものブラウザ（iPhone は Safari、Android は Chrome）で開き直してください。</p>
    ${ENV.inApp === 'LINE' ? `<button class="btn btn-main btn-block guide-go" data-s="open">${ICON.compass}${browserName()}で開く</button>` : ''}
    <ol class="steps">
      ${step('画面の右上（または右下）の<b>「…」</b>や<b>「⋮」</b>を押します', '',
        `<div class="mock m-bar iab"><span class="m-ic">${ICON.x}</span><span class="m-url"><b>${esc(SHOP.name)}</b>${host()}</span><span class="m-ic hl">${ICON.dots}</span></div>`)}
      ${step('<b>「Safariで開く」「ブラウザで開く」「外部ブラウザで開く」</b>などを押します', '',
        `<div class="mock m-list"><span>リンクをコピー${ICON.copy}</span><span class="hl">ブラウザで開く${ICON.compass}</span></div>`)}
      ${step('開いたら、<button class="link" data-s="tab:ios">iPhone</button>・<button class="link" data-s="tab:android">Android</button> の手順で追加します')}
    </ol>
    <div class="copy-box">
      <p>うまくいかないときは、アドレスをコピーして Safari や Chrome に貼り付けてください。</p>
      <button class="btn btn-sub btn-block" data-s="copy">${ICON.copy}アドレスをコピー</button>
    </div>`;
}

/* =====================================================================
 *  ネット予約（席の予約のリクエスト。2026-10-30 ko-dai さんの指示：予約ボードとつなぐ）
 *  人数 → 日にち → 時間 → お客様のこと → 確認 → 受け付けました
 *
 *  ・ホームページの「ご予約」と同じ受け口（予約ボードの受け口・コード.gs）に、リクエストを送る。
 *    お店が予約ボードの「予約受付」で承認すると、確定のメールが届く（だからメールアドレスは必須）。アプリでも分かる（下の「予約の様子」）
 *  ・受け口の場所と、やりとりの道具は、予約ボードの公開先から読む（data.js の SHOP.reserveBase の config.js・api.js）。
 *    ★このアプリに受け口のアドレスを写さない（受け口が変わっても、予約ボードの側を直すだけで済むように）
 *  ・送る中身は、ホームページの予約フォーム（ホームページ/公開用/js/reserve.js）と同じにする。受け口が受け取る形を変えたら、こちらも直す
 *  ・送るときに「受付の印（rid）」を付ける。返事が途中で切れて送り直しても、リクエストは1件にしかならない
 *  ・★この Mac で試すときは、にせの受け口（予約ボード/受け口/にせの受け口.py。ポート 8131）から開いて、アドレスに ?test を付ける
 *    （予約ボードの config.js が、にせの受け口につなぎ替える）。本物の受け口にリクエストを送って試さない
 *  ・送ったリクエストは、この端末にも控える（マイページ）。確定・お断りは、お店からメールで届き、アプリを開いたときにも出る
 * ===================================================================== */

const RSV_MSG = {
  not_ready: 'ネット予約はただいま準備中です。お電話でご予約ください。',
  not_accepting: 'ネット予約はただいま受け付けていません。お電話でどうぞ。',
  full: 'この時間は、今、満席になりました。他の時間を選んでください。',
  no_slot: 'この時間は予約を受け付けていません。他の時間を選んでください。',
  out_of_range: 'この日はネット予約の受付期間の外です。',
  bad_date: '日にちと時間を選んでください。',
  bad_input: 'リクエストの内容を読めませんでした。もう一度入れ直してください。',
  bad_people: '人数を選んでください。',
  need_name: 'お名前を入れてください。',
  need_kana: 'セイ・メイを入れてください。',
  bad_kana: 'セイ・メイはカタカナで入れてください。',
  bad_tel: '電話番号を正しく入れてください（例：090-1234-5678）。',
  need_email: 'メールアドレスを入れてください（確定のお知らせをお送りします）。',
  bad_email: 'メールアドレスの形が違います。',
  too_many_bookings: '同じ電話番号でのご予約・リクエストが多いため、受け付けられませんでした。お電話でどうぞ。',
  busy: 'ただいま混み合っています。少し時間を置いて、もう一度お試しください。',
  offline: 'つながりませんでした。電波の良い所で、もう一度お試しください。',
  no_answer: 'つながりませんでした。時間を置いてもう一度お試しいただくか、お電話でどうぞ。',
};

// お名前を4欄にするか（data.js の SHOP.reserveKana。この Mac で ?test を付けて開いたときは、にせの受け口が新しい版なのでオン）
const RSV_KANA = !!SHOP.reserveKana || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /[?&]test\b/.test(location.search));
/** ひらがな・半角カナをカタカナにする（空白は入れない。受け口は「セイ メイ」を半角の空白でつないで受ける） */
const toKatakana = s => s.normalize('NFKC').replace(/[\u3041-\u3096]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60)).replace(/\s/g, '');
/** 「苗字 名前」を2つに分ける（マイページの控えから入れるとき。分けられなければ、全部を前の欄に） */
const twoParts = s => { const [a = '', ...b] = String(s || '').trim().split(/\s+/); return [a, b.join('')]; };

let rsv = { avail: null, people: 0, date: '', time: '', month: '', v: null, rid: '', step: 'form', done: null, err: '', busy: false, checking: false };   // month：カレンダーで見せている月（'2026-10'）。checking：前に読んだ分を出して、裏で読み直している

function rsvMessage(e) {
  const d = e.data || {};
  if (e.code === 'too_late') return `この時間のネット予約は締め切りました（来店の${d.leadHours}時間前まで）。お電話でどうぞ。`;
  if (e.code === 'too_many') return `${d.maxPeople}名を超えるご予約は、お電話でお受けします。`;
  return RSV_MSG[e.code] || RSV_MSG.no_answer;
}

// 受け口の場所（config.js）と、やりとりの道具（api.js）は、テイクアウトの注文と同じものを読む（js/order-api.js の baguruLib）

// アプリで選べる人数は15名まで（2026-11-04 ko-dai さんの指示。横5×縦3。16名以上はお電話で）。受け口の「1組の最大人数」がこれより少なければ、そちらに合わせる
const RSV_PEOPLE_MAX = 15;
const rsvMax = a => Math.min(RSV_PEOPLE_MAX, Number(a?.maxPeople) || RSV_PEOPLE_MAX);

const ymdDate = ymd => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d); };
const rsvDay = ymd => mdw(ymdDate(ymd));

// 予約のタブ（2026-11-04 ko-dai さんの指示：「ネット予約もわかりにくいので予約タブ」）。上に営業日カレンダー（app.js の openCalHtml）、その下にネット予約
function viewReserve() {
  return {
    tab: 'reserve', title: '予約',
    html: `
      <div id="qr" hidden></div>   <!-- 今すぐ行く（15分以内の即予約。下の qrStart。受けているときだけ出る） -->
      <h2 class="sec" data-en="CALENDAR">営業日カレンダー</h2>
      ${openCalHtml()}
      <h2 class="sec" data-en="RESERVATION">ネット予約</h2>
      <p class="notice">${ICON.cal}<span>席のご予約の<b>リクエスト</b>です<small>お店が確かめて承認すると、確定のメールが届き、このアプリでも分かります（それまでは確定ではありません）。お急ぎの方は、お電話でどうぞ。</small></span></p>
      <div id="rsv"><p class="hint">空き状況を読み込んでいます…</p></div>`,
    after: () => { qrStart(); rsvStart(); },
  };
}

function rsvStart() {
  const box = $('#rsv');
  box.onchange = rsvChange;
  box.onclick = rsvClick;
  if (rsv.step !== 'form') return rsvDraw();
  rsv.err = '';
  const c = availNow(), age = c ? Date.now() - c.got : Infinity;
  if (age < AVAIL_SHOW) {   // 前に読んだ分をすぐ出し、1分より前の分なら裏で読み直す
    rsv.avail = availCopy(c);
    rsvDropUnfit();
    rsv.checking = age >= AVAIL_FRESH;
    rsvDraw();
    if (rsv.checking) readAvail().then(rsvFresh, () => rsvFresh(null));
    return;
  }
  rsv.checking = false;
  readAvail()
    .then(a => { rsv.avail = a; rsvDropUnfit(); })
    .catch(e => { rsv.avail = null; rsv.err = rsvMessage(e); })
    .then(rsvDraw);
}

/* ---------- 空き状況を先に読む・端末に控える（2026-11-03 ko-dai さんの指示：「空き状況の確認の時間を短縮」） ----------
 *  受け口の avail は1回3〜4秒かかる（ほとんどが受け口の中の計算。2026-11-03 に本物で測った。受け口を呼ぶだけで約1.4秒）。そこで
 *  ・読んだ空き状況を端末に控える（DB 'avail'：{ a, got }）。予約の画面を開いたとき、30分以内に読んだ分ならすぐ出し、
 *    裏で読み直して、日にちと時間だけを描き直す（入れている途中のお名前などは消さない）
 *  ・ネット予約へのリンクがある画面（ホーム・お店の情報）を開いたら、裏で先に読んでおく（同じ端末から5分に1回まで。app.js の render が availAhead を呼ぶ）
 *  ・★控えは目安。送ったときに受け口が確かめるので、埋まっていれば full が返り、読み直して選び直してもらう（rsvSend）
 */
const AVAIL_SHOW = 30 * 60e3, AVAIL_FRESH = 60e3, AVAIL_AHEAD = 5 * 60e3;
let availReq = null, aheadT = 0;   // availReq：読んでいる途中の avail（同じ時に2回読まない）
const availNow = () => DB.get('avail', null);
const dropAvail = () => DB.set('avail', null);
/** 受け口から読み、端末に控える */
function readAvail() {
  return availReq ??= baguruLib()
    .then(() => BaguruApi.post({ action: 'avail' }))
    .then(a => { DB.set('avail', { a, got: Date.now() }); return a; })
    .finally(() => { availReq = null; });
}
/** 控えを画面に出す形に（日をまたいでいたら、今日より前の日は外す）。
 *  読んだあとに締め切り（来店の何時間前まで）を過ぎた枠は、受け口と同じ数え方で late にし直す。
 *  leadHours は受け口の版 2026-11-03a から返る。無ければ、締め切りは付け直さない */
function availCopy(c) {
  const now = new Date(), today = dateKey(now), nowMin = now.getHours() * 60 + now.getMinutes();
  const lead = Number(c.a.leadHours), days = c.a.days.filter(d => d.date >= today);
  if (!(c.a.leadHours !== undefined && lead >= 0)) return { ...c.a, days };
  const min = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  return { ...c.a, days: days.map(d => {
    const ahead = Math.round((ymdDate(d.date) - ymdDate(today)) / 864e5) * 1440 - nowMin;
    return { ...d, slots: d.slots.map(s => s.late || ahead + min(s.t) >= lead * 60 ? s : { ...s, late: true, left: 0 }) };
  }) };
}
/** ネット予約へのリンクがある画面を開いたとき、空き状況を裏で先に読んでおく（app.js の render から） */
function availAhead() {
  if (PREVIEW || !navigator.onLine) return;
  const stale = () => { const c = availNow(); return !c || Date.now() - c.got >= AVAIL_AHEAD; };
  if (!stale()) return;
  clearTimeout(aheadT);
  // 開いた直後のほかの読み込み（注文・スタンプなど）と重ならないよう、少し待ってから
  aheadT = setTimeout(() => { if (!document.hidden && stale()) readAvail().catch(() => {}); }, 1500);
}
/** 裏で読み直した空き状況で描き直す。読めなかったときは、控えのまま（送るときに受け口が確かめる） */
function rsvFresh(a) {
  rsv.checking = false;
  const note = $('#r-checking');
  if (!a) { if (note) note.textContent = '最新の空き状況を読めませんでした（少し前の空き状況です）。送るときに、空いているかを確かめます。'; return; }
  const was = rsv.avail, date = rsv.date, time = rsv.time;
  rsv.avail = a;
  if (rsv.step !== 'form') return;   // 確認の画面では、送ったときに受け口が確かめる
  if (rsv.people > rsvMax(a)) rsv.people = 0;
  rsvDropUnfit();
  if (!$('#r-days') || !was || a.accepting !== was.accepting || rsvMax(a) !== rsvMax(was)) {
    if ($('#r-tel')) rsv.v = rsvValues();   // 全部を描き直すときも、入れている途中のものは残す
    return rsvDraw();
  }
  note?.remove();
  $('#r-days').innerHTML = rsvDaysHtml();
  $('#r-times').innerHTML = rsvTimesHtml();
  const lost = date && !rsv.date ? '日' : time && !rsv.time ? '時間' : '';
  if (lost) toast(`選んでいた${lost}は、いま空きがなくなりました。選び直してください`, 'warn');
}

/* ---------- 空き状況（ホームページのフォームと同じ見方） ---------- */
// その時刻に、選んだ人数が入れるか（受け口が、電話の予約も入った台帳から、空いている席を数えて返す）
function rsvFits(s) {
  if (s.late || s.left <= 0) return false;
  if (s.single === undefined) return true;
  const p = rsv.people || 1, maxTable = rsv.avail.maxTable || 0;
  return p <= s.single || (p > maxTable && p <= s.group);
}
// その時刻に、選んだ人数が入れる空き卓（卓に入らない人数は、空いているグループ）がいくつあるか。受け口が数を返さないときは null
function rsvOptions(s) {
  if (!s.n) return null;
  const p = rsv.people || 1, caps = rsv.avail.caps || [], maxTable = rsv.avail.maxTable || 0;
  if (p <= maxTable) { const i = caps.findIndex(c => c >= p); return i < 0 ? 0 : s.n[i] || 0; }
  return (s.g || []).filter(c => c >= p).length;
}
// 「残りわずか」でないか：入れる卓が2つ以上（数が無いときは、受けられる組数で見る）
function rsvPlenty(s) {
  const o = rsvOptions(s);
  return o === null ? s.left >= Math.min(2, rsv.avail.cap) : o >= 2;
}
function rsvDayMark(d) {
  if (d.type === 'closed') return { m: '休', cls: 'is-closed', ok: false, sr: '定休日' };
  const open = d.slots.filter(rsvFits);
  // 締め切りの時間を過ぎただけの日（その日の夜など）は、満席と言わない
  if (!open.length && d.slots.every(s => s.late)) return { m: '－', cls: 'is-closed', ok: false, sr: '受付終了' };
  if (!open.length) return { m: '×', cls: 'is-full', ok: false, sr: '満席' };
  return open.some(rsvPlenty) ? { m: '○', cls: '', ok: true, sr: '空きあり' } : { m: '△', cls: 'is-few', ok: true, sr: '残りわずか' };
}
const rsvSlotMark = s => s.late ? '－' : !rsvFits(s) ? '×' : rsvPlenty(s) ? '○' : '△';

/** 選んでいた日・時間に入れなくなったら外す（埋まったとき・人数を変えたとき） */
function rsvDropUnfit() {
  if (!rsv.avail) return;
  const d = rsv.avail.days.find(x => x.date === rsv.date);
  if (!d || !rsvDayMark(d).ok) { rsv.date = ''; rsv.time = ''; }
  else if (!d.slots.some(s => s.t === rsv.time && rsvFits(s))) rsv.time = '';
}

/** お客様のことの入力欄 */
function rsvFields(v) {
  return `${RSV_KANA ? `<div class="r-names">
      <label class="field"><span>苗字</span><input id="r-sei" autocomplete="family-name" maxlength="19" value="${esc(v.sei)}" placeholder="例：豊田"></label>
      <label class="field"><span>名前</span><input id="r-mei" autocomplete="given-name" maxlength="19" value="${esc(v.mei)}" placeholder="例：太郎"></label>
      <label class="field"><span>セイ（カタカナ）</span><input id="r-sei-kana" autocomplete="off" maxlength="19" value="${esc(v.seiKana)}" placeholder="例：トヨタ"></label>
      <label class="field"><span>メイ（カタカナ）</span><input id="r-mei-kana" autocomplete="off" maxlength="19" value="${esc(v.meiKana)}" placeholder="例：タロウ"></label>
    </div>` : `<label class="field"><span>お名前</span><input id="r-name" autocomplete="name" maxlength="40" value="${esc(v.name)}" placeholder="例：豊田 太郎"></label>`}
    <label class="field"><span>電話番号</span><input id="r-tel" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" value="${esc(v.tel)}" placeholder="例：090-1234-5678"></label>
    <label class="field"><span>メールアドレス（確定のお知らせをお送りします）</span><input id="r-email" type="email" inputmode="email" autocomplete="email" maxlength="120" value="${esc(v.email)}"></label>`;
}
/** 登録した内容が揃っていれば、たたんで見せる内容（席の予約の入力を省く）。足りないものがあれば [] で、入力欄を出す */
function rsvSaved(v) {
  const names = RSV_KANA ? v.sei && v.mei && v.seiKana && v.meiKana : v.name;
  if (!ME.registeredAt || !names || !v.tel || !v.email) return [];
  return [`${RSV_KANA ? `${v.sei} ${v.mei}（${v.seiKana} ${v.meiKana}）` : v.name} 様`, v.tel, v.email];
}

/* ---------- 描く ---------- */
function rsvDraw() {
  const box = $('#rsv');
  if (!box) return;   // ほかの画面に移った
  const tel = `<a class="btn btn-call btn-block" href="tel:${SHOP.tel.replace(/-/g, '')}">${ICON.phone}お電話で予約する<small>${esc(SHOP.tel)}</small></a>`;
  if (rsv.step === 'done') return (box.innerHTML = rsvDoneHtml());
  if (rsv.step === 'confirm') return (box.innerHTML = rsvConfirmHtml());
  if (!rsv.avail) {
    box.innerHTML = `<p class="notice warn">${esc(rsv.err || RSV_MSG.no_answer)}</p>
      <button class="btn btn-sub btn-block" data-r="reload">読み込み直す</button>${tel}`;
    return;
  }
  if (!rsv.avail.accepting) { box.innerHTML = `<p class="notice warn">${esc(RSV_MSG.not_accepting)}</p>${tel}`; return; }
  const [sei, mei] = twoParts(ME.name), [seiKana, meiKana] = twoParts(ME.kana);
  const v = rsv.v || { name: ME.name, sei, mei, seiKana, meiKana, tel: ME.tel, email: ME.email || '', dessert: false, plateMsg: '', note: '' };
  const max = rsvMax(rsv.avail);
  box.innerHTML = `
    <h2 class="sec">人数</h2>
    <div class="r-people">${Array.from({ length: max }, (_, i) => `<label class="r-chip"><input type="radio" name="r-people" value="${i + 1}" ${rsv.people === i + 1 ? 'checked' : ''}><span>${i + 1}名</span></label>`).join('')}</div>
    <p class="hint">${max + 1}名以上のご予約は、<a class="link-inline" href="tel:${SHOP.tel.replace(/-/g, '')}">お電話（${esc(SHOP.tel)}）</a>でお問い合わせください。</p>
    <h2 class="sec">日にち</h2>
    ${rsv.checking ? '<p class="hint r-checking" id="r-checking">最新の空き状況を確かめています…</p>' : ''}
    <div id="r-days">${rsvDaysHtml()}</div>
    <h2 class="sec">時間</h2>
    <div id="r-times">${rsvTimesHtml()}</div>
    <h2 class="sec">お客様のこと</h2>
    ${savedContact(rsvFields(v), rsvSaved(v))}
    <div class="field"><span>デザートプレート（要予約・税込1,100円）</span>
      <div class="r-row"><label class="r-chip"><input type="radio" name="r-dessert" value="no" ${v.dessert ? '' : 'checked'}><span>注文しない</span></label>
      <label class="r-chip"><input type="radio" name="r-dessert" value="yes" ${v.dessert ? 'checked' : ''}><span>注文する</span></label></div></div>
    <label class="field" id="r-plate-box" ${v.dessert ? '' : 'hidden'}><span>プレートに書くメッセージ（30文字まで）</span><input id="r-plate" maxlength="30" value="${esc(v.plateMsg)}" placeholder="例：Happy Birthday たろう"></label>
    <label class="field"><span>ご要望（なくても構いません）</span><textarea id="r-note" rows="2" maxlength="300" placeholder="お祝い・アレルギー・ベビーカーなど">${esc(v.note)}</textarea></label>
    <div class="r-hp" aria-hidden="true"><label>ここには何も入れないでください<input id="r-website" tabindex="-1" autocomplete="off"></label></div>
    <p class="notice warn" id="r-msg" hidden></p>
    ${privacyLink('お預かりする情報の扱いは ')}
    <div class="foot"><button class="btn btn-main btn-block" data-r="next">内容を確認する</button></div>`;
}

// 年月（'2026-10'）を n か月動かす
function rsvAddMonth(ym, n) {
  const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// 日にちは、ひと月ずつのカレンダーで見せる（前の月・次の月のボタンで動かす）。ホームページの予約と同じ形（2026-10-30 ko-dai さんの指示）
function rsvDaysHtml() {
  const days = rsv.avail.days;
  if (!days.length) return '<p class="hint">受け付けている日がありません。</p>';
  const byDate = Object.fromEntries(days.map(d => [d.date, d]));
  const minYm = days[0].date.slice(0, 7), maxYm = days[days.length - 1].date.slice(0, 7);
  if (!rsv.month || rsv.month < minYm || rsv.month > maxYm) rsv.month = rsv.date ? rsv.date.slice(0, 7) : minYm;
  const ym = rsv.month, y = Number(ym.slice(0, 4)), mo = Number(ym.slice(5, 7));
  const last = new Date(y, mo, 0).getDate(), pad = new Date(y, mo - 1, 1).getDay();
  const cells = [];
  for (let day = 1; day <= last; day++) {
    const date = `${ym}-${String(day).padStart(2, '0')}`, d = byDate[date], w = new Date(y, mo - 1, day).getDay();
    const wcls = w === 0 || d?.holiday ? ' sun' : w === 6 ? ' sat' : '';
    if (!d) { cells.push(`<span class="r-out${wcls}">${day}</span>`); continue; }   // 今日より前と、受け付ける日より先は、数字だけ
    const mk = rsvDayMark(d);
    cells.push(`<label class="r-day ${mk.cls}${wcls}${date === days[0].date ? ' is-today' : ''}">
        <input type="radio" name="r-date" value="${d.date}" aria-label="${rsvDay(d.date)} ${mk.sr}" ${mk.ok ? '' : 'disabled'} ${rsv.date === d.date ? 'checked' : ''}>
        <span><b>${day}</b><i>${mk.m}</i></span></label>`);
  }
  return `<div class="r-cal-nav">
      <button type="button" class="r-cal-move" data-r="month" data-dir="-1" ${ym <= minYm ? 'disabled' : ''}><span aria-hidden="true">‹</span>前の月</button>
      <p class="r-cal-title" aria-live="polite">${y}年<b>${mo}</b>月</p>
      <button type="button" class="r-cal-move" data-r="month" data-dir="1" ${ym >= maxYm ? 'disabled' : ''}>次の月<span aria-hidden="true">›</span></button>
    </div>
    <div class="r-cal">${WEEK.map((w, i) => `<span class="r-wd ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</span>`).join('')}
      ${'<span></span>'.repeat(pad)}${cells.join('')}</div>
    <p class="r-key"><span><i class="ok">○</i>空きあり</span><span><i class="few">△</i>残りわずか</span><span><i>×</i>満席</span><span><i>休</i>定休日</span></p>`;
}

function rsvTimesHtml() {
  const d = rsv.avail.days.find(x => x.date === rsv.date);
  if (!d) return '<p class="hint">先に日にちを選んでください。</p>';
  // 時刻は10分きざみで多いので（2026-10-30 から）、昼と夜で区切る（1時間より長く空くところか、通しで営業する日は17時）
  const min = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const EVENING = 17 * 60;
  return `<p class="hint"><b>${rsvDay(d.date)}</b></p><div class="r-times">${d.slots.map((s, i) => {
    const ok = rsvFits(s), mk = rsvSlotMark(s);
    const now = min(s.t), prev = i ? min(d.slots[i - 1].t) : null;
    const head = i === 0 || now - prev > 60 || (prev < EVENING && now >= EVENING);
    const sep = head ? `<p class="r-sep">${now >= 16 * 60 ? '夜' : '昼'}</p>` : '';
    return `${sep}<label class="r-chip r-time ${!ok ? 'is-full' : mk === '△' ? 'is-few' : ''}"><input type="radio" name="r-time" value="${s.t}" ${ok ? '' : 'disabled'} ${rsv.time === s.t ? 'checked' : ''}><span>${s.t}<i>${mk}</i></span></label>`;
  }).join('')}</div>`;
}

// お子様連れの欄は、2026-11-04 に消した（ko-dai さんの指示）。受け口には送らない（受け口は、送られなければ「なし」として受ける）
function rsvValues() {
  const dessert = $('input[name="r-dessert"]:checked')?.value === 'yes';
  const part = id => $(id).value.replace(/\s/g, '');
  const names = RSV_KANA ? { sei: part('#r-sei'), mei: part('#r-mei'), seiKana: toKatakana($('#r-sei-kana').value), meiKana: toKatakana($('#r-mei-kana').value) } : null;
  return {
    people: rsv.people, date: rsv.date, time: rsv.time,
    ...(names ? { ...names, name: `${names.sei} ${names.mei}`, kana: `${names.seiKana} ${names.meiKana}` } : { name: $('#r-name').value.trim() }),
    tel: toHalf($('#r-tel').value.trim()), email: $('#r-email').value.trim(),
    note: $('#r-note').value.trim(), website: $('#r-website').value,
    dessert, plateMsg: dessert ? $('#r-plate').value.trim() : '',
  };
}
function rsvCheck(v) {
  if (!v.people) return RSV_MSG.bad_people;
  if (!v.date || !v.time) return RSV_MSG.bad_date;
  if (RSV_KANA) {
    if (!v.sei || !v.mei) return RSV_MSG.need_name;
    if (!v.seiKana || !v.meiKana) return RSV_MSG.need_kana;
    if (!/^[\u30a1-\u30f6\u30fc]+$/.test(v.seiKana + v.meiKana)) return RSV_MSG.bad_kana;   // 受け口と同じ確かめ
  } else if (!v.name) return RSV_MSG.need_name;
  if (!/^0\d{9,10}$/.test(v.tel.replace(/[^\d]/g, ''))) return RSV_MSG.bad_tel;
  if (!v.email) return RSV_MSG.need_email;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) return RSV_MSG.bad_email;
  return '';
}

function rsvSummary(v) {
  return `<dl class="info">
      <dt>日時</dt><dd>${rsvDay(v.date)} ${esc(v.time)}</dd>
      <dt>人数</dt><dd>${v.people}名</dd>
      <dt>お名前</dt><dd>${esc(v.name)} 様${v.kana ? `<br><small>${esc(v.kana)}</small>` : ''}</dd>
      <dt>電話番号</dt><dd>${esc(v.tel)}</dd>
      ${v.email ? `<dt>メール</dt><dd>${esc(v.email)}</dd>` : ''}
      ${v.dessert !== undefined ? `<dt>デザートプレート</dt><dd>${v.dessert ? `注文する（税込1,100円）${v.plateMsg ? `<br>メッセージ：「${esc(v.plateMsg)}」` : '<br>メッセージ：なし'}` : '注文しない'}</dd>` : ''}
      ${v.note ? `<dt>ご要望</dt><dd>${esc(v.note)}</dd>` : ''}
    </dl>`;
}

function rsvConfirmHtml() {
  return `<h2 class="sec">この内容で送ります</h2>
    ${rsvSummary(rsv.v)}
    <p class="hint">送ると、お店に「リクエスト」が届きます。お店が確かめて承認すると、確定のメールが届き、このアプリでも分かります。</p>
    <p class="notice warn" id="r-cmsg" hidden></p>
    <div class="foot foot-2">
      <button class="btn btn-main btn-block" data-r="send" ${rsv.busy ? 'disabled' : ''}>${rsv.busy ? '送っています…' : 'この内容で送る'}</button>
      <button class="btn btn-sub btn-block" data-r="back">戻って直す</button>
    </div>`;
}

function rsvDoneHtml() {
  const r = rsv.done;
  return `<div class="thanks">${ICON.check}<div><b>リクエストを受け付けました</b><small>まだ確定していません。お店が確かめて承認すると、確定のメールが届き、このアプリのマイページでも分かります</small></div></div>
    <div class="ticket"><div><small>受付番号</small><b class="t-no">${esc(r.no)}</b></div><div><small>ご来店</small><b>${rsvDay(r.date)} ${esc(r.time)}</b><small>${r.people}名</small></div></div>
    <p class="hint">${r.mailed ? '受け付けたことを伝えるメールを、今お送りしました。届かないときは、迷惑メールのフォルダも見てください。' : '★受け付けのメールを送れませんでした。メールアドレスが合っているか、お電話でお問い合わせください。'}</p>
    <div class="row-btns">
      <a class="btn btn-sub" href="tel:${SHOP.tel.replace(/-/g, '')}">${ICON.phone}お店に電話</a>
      <button class="btn btn-sub" data-r="again">続けて予約する</button>
    </div>`;
}

/* ---------- 選ぶ・押す ---------- */
function rsvChange(e) {
  const t = e.target;
  if (t.name === 'r-people') { rsv.people = Number(t.value); rsvDropUnfit(); $('#r-days').innerHTML = rsvDaysHtml(); $('#r-times').innerHTML = rsvTimesHtml(); }
  if (t.name === 'r-date') { rsv.date = t.value; rsv.time = ''; $('#r-times').innerHTML = rsvTimesHtml(); $('#r-times').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  if (t.name === 'r-time') rsv.time = t.value;
  if (t.name === 'r-dessert') { $('#r-plate-box').hidden = t.value !== 'yes'; if (t.value === 'yes') $('#r-plate').focus(); }
  const m = $('#r-msg');
  if (m) m.hidden = true;
}

function rsvClick(e) {
  const b = e.target.closest('[data-r]');
  if (!b) return;
  const act = b.dataset.r;
  if (act === 'reload') { $('#rsv').innerHTML = '<p class="hint">空き状況を読み込んでいます…</p>'; return rsvStart(); }
  if (act === 'month') {   // 前の月・次の月（押したボタンに、そのまま指が残るように）
    if (b.disabled) return;
    rsv.month = rsvAddMonth(rsv.month, Number(b.dataset.dir));
    $('#r-days').innerHTML = rsvDaysHtml();
    $('#r-days .r-cal').classList.add(b.dataset.dir === '1' ? 'go-next' : 'go-prev');   // 月が横にすべって変わる
    const nb = $(`#r-days [data-dir="${b.dataset.dir}"]`);
    return (nb && !nb.disabled ? nb : $('#r-days [data-dir]:not(:disabled)'))?.focus();
  }
  if (act === 'next') {
    const v = rsvValues(), err = rsvCheck(v);
    if (err && err !== RSV_MSG.bad_people && err !== RSV_MSG.bad_date) openContact();   // お客様のことが足りないときだけ、たたんだ欄を開く
    if (err) { const m = $('#r-msg'); m.textContent = err; m.hidden = false; m.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    rsv.v = v;
    rsv.rid = randomRid('r');   // 確認の画面を開くたびに新しい印。送り直しのときは同じ印を使う
    rsv.step = 'confirm';
    rsvDraw();
    return window.scrollTo(0, 0);
  }
  if (act === 'back') { rsv.step = 'form'; rsvDraw(); return; }
  if (act === 'again') { rsv = { ...rsv, step: 'form', done: null, people: 0, date: '', time: '', month: '', v: null }; $('#rsv').innerHTML = '<p class="hint">空き状況を読み込んでいます…</p>'; return rsvStart(); }
  if (act === 'send' && PREVIEW) return toast('見え方を確かめる画面なので、ここでは動きません', 'warn');
  if (act === 'send' && !rsv.busy) rsvSend();
}

function rsvSend() {
  rsv.busy = true;
  rsvDraw();
  // via … どこから来たか（受け口が読めるようになったら、予約ボードの「経路」に「アプリ」と出る。いまの受け口は読まずに「ホームページ」とする）
  const { sei, mei, seiKana, meiKana, ...send } = rsv.v;   // 4欄の分けたものは、この画面のためだけ。受け口には name（苗字 名前）・kana（セイ メイ）で送る
  BaguruApi.post({ action: 'reserve', rid: rsv.rid, via: 'アプリ', ...send })
    .then(r => {
      // この端末にも控える（マイページの「ご予約のリクエスト」）。id と token は、様子を読むときの鍵。お名前・電話・メールは、次に入れる手間を省くため会員の情報に
      DB.set('reserves', [...DB.get('reserves', []), { id: r.id, token: r.token, state: 'request', no: r.no, date: r.date, time: r.time, people: r.people, sentAt: new Date().toISOString() }]);
      Object.assign(ME, { name: rsv.v.name, tel: rsv.v.tel, email: rsv.v.email, ...(rsv.v.kana ? { kana: rsv.v.kana } : {}) });
      DB.set('member', ME);
      rsv = { ...rsv, step: 'done', done: r, v: null, people: 0, date: '', time: '', month: '', busy: false, avail: null };
      dropAvail();   // 自分の予約で空きが変わったので、控えは使わない
      rsvDraw();
      window.scrollTo(0, 0);
    })
    .catch(e => {
      rsv.busy = false;
      if (['full', 'too_late', 'no_slot'].includes(e.code)) {
        // 枠が埋まったときは、空き状況を読み直して、時間を選び直してもらう
        rsv.time = '';
        rsv.step = 'form';
        dropAvail();   // 控えは古いので、読み終わるまで待ってもらう
        $('#rsv').innerHTML = '<p class="hint">空き状況を読み込んでいます…</p>';
        rsvStart();
        return toast(rsvMessage(e), 'warn');
      }
      rsvDraw();
      const m = $('#r-cmsg');
      if (m) { m.textContent = rsvMessage(e); m.hidden = false; }
    });
}

// 送ったあと、ほかの画面に移ってから戻ったときは、新しいリクエストの画面から（app.js の描き直しより先に動く）
window.addEventListener('hashchange', () => {
  if (routeName() !== 'reserve' && rsv.step === 'done') rsv = { ...rsv, step: 'form', done: null };
});

/* =====================================================================
 *  今すぐ行く（15分以内に来店する、すぐ確定する即予約。★2026-11-06 ko-dai さんの指示で「いますぐ」→「今すぐ」、今から席を押さえることが分かる文に。2026-11-05 ko-dai さんの「作り始める」。予約ボードのセッションと決めた：即予約の決めごと.md）
 *  ・予約タブのいちばん上。受け口の nowAvail が accepting: true のときだけ出す。止めている・受付時間の外・休み・
 *    古い受け口（nowAvail を知らず unknown_action が返る）・読めないときは、何も出さない
 *  ・人数・お名前・電話（メールは任意）→ 確かめ（15分以内にお越しになれる方だけ・取り消しと遅れはお電話で）→ 確定（quickReserve。お店の承認は無く、すぐ確定）
 *  ・人数は nowAvail の people（いま入れる人数の一覧。★続かないことがある）だけを選べる。maxPeople が 0 なら「いまは満席」
 *  ・確定したら、この端末の控え（DB 'reserves'）に quick: true で入れる（マイページに出る。様子は今の myReserves で読む。state は ok）
 *  ・来店時刻は、受け口が「受けた時刻＋15分」で決める（arriveBy）。画面の「いま送ると○時○分まで」は目安（この端末の時計で数える）
 *  ・★今のネット予約（日時を選ぶリクエスト）は、そのまま下に残す。「他社のサービスの名前」は画面に使わない
 * ===================================================================== */
const QR_MSG = {
  not_accepting: '今は、今すぐのご予約を受け付けていません。お電話でどうぞ。',
  full: '今、満席になって、席を押さえられませんでした。お電話でお問い合わせください。',
  busy: '同じ電話番号で、まだご来店前のご予約があるか、ただいま混み合っています。お電話でどうぞ。',
  bad_people: '人数を選んでください。',
  bad_email: 'メールアドレスの形が違います（入れなくても予約できます）。',
};
const QR_EVERY = 60000;   // 予約タブを開いているあいだ、いま入れる人数を読み直す間隔
let qr = { now: null, step: 'card', people: 0, v: null, rid: '', done: null, busy: false };
let qrReq = null, qrTimer = 0;
const qrMsg = e => (e.code === 'too_many' ? `${Number(e.data?.maxPeople) || ''}名を超えるご予約は、お電話でお受けします。` : QR_MSG[e.code] || RSV_MSG[e.code] || RSV_MSG.no_answer);
const qrTel = () => `<a class="btn btn-call btn-block" href="tel:${SHOP.tel.replace(/-/g, '')}">${ICON.phone}お電話でどうぞ<small>${esc(SHOP.tel)}</small></a>`;
/** いま送ったときの来店時刻の目安（この端末の時計＋15分） */
const qrArrive = () => { const d = new Date(Date.now() + (Number(qr.now?.minutes) || 15) * 60000); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
// 選べる人数は、ふだんのネット予約と同じ15名まで（RSV_PEOPLE_MAX。2026-11-04 ko-dai さんの指示。16名以上はお電話で）
const qrPeople = () => (Array.isArray(qr.now?.people) ? qr.now.people.map(Number).filter(n => Number.isInteger(n) && n > 0 && n <= RSV_PEOPLE_MAX) : []);
const qrMax = () => Math.max(0, ...qrPeople());

/* テスト用アカウント（Owner の中の公式アプリ。stamp-api.js の TEST_MEMBER）は、いつでも即予約を試せる（2026-11-06 ko-dai さんの指示「テスト用アカウントからはいつでも即予約ができるようにしてください」）。
 *  nowAvail・quickReserve に、テスト用の会員番号と鍵（member・key。stampClaim と同じ）を足して送る。受け口は、テスト用の会員と確かめられたら、
 *  受付時間の外・休みの日でも受け、test: true を返す（受け口は予約ボードのセッション）。★2026-11-06 の受け口 2026-11-06c から、予約ボードのスイッチを止めているときは、テスト用でも受けない
 *  （ko-dai さんの指示「即予約を止めている時はテスト用アカウントであっても即予約ができないように」。nowAvail は accepting: false なので、カードは出ない）。席の空きの数え方は本物と同じ（満席なら受けない）。
 *  ★お客さまの会員では足さない。受け口が知らないあいだは、足したものは無視される（今までどおり、スイッチが入っているときだけ出る） */
const qrAuth = () => {
  if (typeof TEST_MEMBER === 'undefined' || !TEST_MEMBER) return {};
  const a = memberAuth();
  return a && a.no && a.key ? { member: a.no, key: a.key } : {};
};
function qrRead() {
  return qrReq ??= baguruLib().then(() => BaguruApi.post({ action: 'nowAvail', ...qrAuth() })).finally(() => { qrReq = null; });
}
function qrStart() {
  const box = $('#qr');
  if (!box) return;
  box.onclick = qrClick;
  box.onchange = qrChange;
  if (qr.step !== 'card') return qrDraw();
  qrLoad();
}
/** いま入れるかを読み、カードを描き直す。予約タブを開いているあいだは、1分ごとに読み直す */
function qrLoad() {
  clearTimeout(qrTimer);
  if (PREVIEW && !qr.now) return qrDraw();   // マネージの「アプリで見る」では読まない（出さない）
  qrRead()
    .then(a => { qr.now = a && a.accepting === true ? a : null; }, () => { qr.now = null; })
    .then(() => {
      if (!$('#qr') || qr.step !== 'card') return;
      qrDraw();
      qrTimer = setTimeout(() => { if ($('#qr') && qr.step === 'card' && !document.hidden) qrLoad(); }, QR_EVERY);
    });
}

function qrDraw() {
  const box = $('#qr');
  if (!box) return;
  const show = !!qr.now || qr.step !== 'card';
  box.hidden = !show;
  if (!show) return (box.innerHTML = '');
  const head = sub => `<div class="nowr-head">${ICON.clock}<div><b>今すぐ行く（15分以内）</b><small>${sub}</small></div></div>`;
  if (qr.step === 'done') return (box.innerHTML = qrDoneHtml());
  if (qr.step === 'confirm') return (box.innerHTML = `<div class="nowr">${head('この内容で、今すぐ席を押さえます')}${qrConfirmHtml()}</div>`);
  if (qr.step === 'form') return (box.innerHTML = `<div class="nowr">${head('今から席を押さえる、15分以内にお越しになれる方だけのご予約です')}${qrFormHtml()}</div>`);
  const max = qrMax();
  if (!max) {
    box.innerHTML = `<div class="nowr is-full">${head('今は満席で、席を押さえられません。少し時間を置くと、空くことがあります')}${qrTel()}</div>`;
    return;
  }
  box.innerHTML = `<div class="nowr">${head(`<b class="nowr-lead">今から、お席をすぐに押さえます</b>今 <em>${max}名</em>まで入れます。押さえたら <em>${esc(qrArrive())}</em>（今から15分）までにお越しください`)}
      ${qr.now.test ? '<p class="hint nowr-test">テスト用アカウント：受付時間の外・休みの日でも試せます（予約ボードで今すぐの予約を止めているときは、試せません。席の空きは本物と同じ。お店の予約ボードに届くので、試したら予約ボードで取り消してください）</p>' : ''}
      <button class="btn btn-main btn-block" data-q="open">今すぐ席を押さえる</button></div>`;
}

function qrFormHtml() {
  const v = qr.v || { name: ME.name || '', tel: ME.tel || '', email: ME.email || '' };
  const people = qrPeople();
  return `<p class="notice warn">${ICON.clock}<span><b>15分以内にお越しになれる方だけ</b><small>送ると、その場でお席を押さえて、予約が確定します（お店の確認はありません）。取り消し・遅れるときは、お電話（${esc(SHOP.tel)}）でお知らせください。</small></span></p>
    <h3 class="nowr-sub">人数</h3>
    <div class="r-people">${people.map(n => `<label class="r-chip"><input type="radio" name="q-people" value="${n}" ${qr.people === n ? 'checked' : ''}><span>${n}名</span></label>`).join('')}</div>
    ${people.length < qrMax() ? '<p class="hint">今の席の空き方で、入れる人数だけを出しています。</p>' : ''}
    ${(Number(qr.now?.maxPeople) || 0) > RSV_PEOPLE_MAX || qrMax() === RSV_PEOPLE_MAX ? `<p class="hint">${RSV_PEOPLE_MAX + 1}名以上は、<a class="link-inline" href="tel:${SHOP.tel.replace(/-/g, '')}">お電話（${esc(SHOP.tel)}）</a>でお問い合わせください。</p>` : ''}
    <label class="field"><span>お名前</span><input id="q-name" autocomplete="name" maxlength="40" value="${esc(v.name)}" placeholder="例：豊田 太郎"></label>
    <label class="field"><span>電話番号</span><input id="q-tel" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" value="${esc(v.tel)}" placeholder="例：090-1234-5678"></label>
    <label class="field"><span>メールアドレス（なくても構いません。入れると確定のメールが届きます）</span><input id="q-email" type="email" inputmode="email" autocomplete="email" maxlength="120" value="${esc(v.email)}"></label>
    <div class="r-hp" aria-hidden="true"><label>ここには何も入れないでください<input id="q-website" tabindex="-1" autocomplete="off"></label></div>
    <p class="notice warn" id="q-msg" hidden></p>
    ${privacyLink('お預かりする情報の扱いは ')}
    <div class="foot foot-2">
      <button class="btn btn-main btn-block" data-q="next">内容を確認する</button>
      <button class="btn btn-sub btn-block" data-q="close">やめる</button>
    </div>`;
}
function qrValues() {
  return { people: qr.people, name: $('#q-name').value.trim(), tel: toHalf($('#q-tel').value.trim()), email: $('#q-email').value.trim(), website: $('#q-website').value };
}
function qrCheck(v) {
  if (!v.people) return QR_MSG.bad_people;
  if (!v.name) return RSV_MSG.need_name;
  if (!/^0\d{9,10}$/.test(v.tel.replace(/[^\d]/g, ''))) return RSV_MSG.bad_tel;
  if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) return QR_MSG.bad_email;
  return '';
}
function qrConfirmHtml() {
  const v = qr.v;
  return `<dl class="info">
      <dt>ご来店</dt><dd>今日 <b>${esc(qrArrive())}</b> までに（送った時刻から15分以内）</dd>
      <dt>人数</dt><dd>${v.people}名</dd>
      <dt>お名前</dt><dd>${esc(v.name)} 様</dd>
      <dt>電話番号</dt><dd>${esc(v.tel)}</dd>
      ${v.email ? `<dt>メール</dt><dd>${esc(v.email)}</dd>` : ''}
    </dl>
    <p class="notice warn">${ICON.phone}<span><b>取り消し・遅れるときは、お電話で</b><small>このアプリからは取り消せません。お電話（${esc(SHOP.tel)}）でお知らせください。15分を過ぎてもお越しにならないときは、お店で取り消すことがあります。</small></span></p>
    <p class="notice warn" id="q-cmsg" hidden></p>
    <div class="foot foot-2">
      <button class="btn btn-main btn-block" data-q="send" ${qr.busy ? 'disabled' : ''}>${qr.busy ? '席を押さえています…' : '今すぐ席を押さえる（予約を確定）'}</button>
      <button class="btn btn-sub btn-block" data-q="back">戻って直す</button>
    </div>`;
}
function qrDoneHtml() {
  const r = qr.done;
  return `<div class="nowr is-done">
      <div class="thanks">${ICON.check}<div><b>お席を押さえました</b><small>予約が確定しました。<b>${esc(r.arriveBy)}</b> までにお越しください。遅れるとき・取り消すときは、お電話でお知らせください</small></div></div>
      <div class="ticket"><div><small>予約番号</small><b class="t-no">${esc(r.no)}</b></div><div><small>ご来店</small><b>今日 ${esc(r.arriveBy)} まで</b><small>${r.people}名</small></div></div>
      ${r.test ? '<p class="hint nowr-test">テスト用アカウントの試しの予約です。お店の予約ボードに「試」の印で届いています。確かめたら、予約ボードで取り消してください。</p>' : ''}
      ${r.email ? `<p class="hint">${r.mailed ? '確定のメールを、今お送りしました。届かないときは、迷惑メールのフォルダも見てください。' : '★確定のメールを送れませんでした。ご予約は確定しています。'}</p>` : ''}
      <div class="row-btns">
        <a class="btn btn-sub" href="tel:${String(r.tel || SHOP.tel).replace(/-/g, '')}">${ICON.phone}お店に電話</a>
        <a class="btn btn-sub" href="#me">マイページへ</a>
      </div></div>`;
}

function qrChange(e) {
  if (e.target.name === 'q-people') qr.people = Number(e.target.value);
  const m = $('#q-msg');
  if (m) m.hidden = true;
}
function qrClick(e) {
  const b = e.target.closest('[data-q]');
  if (!b) return;
  const act = b.dataset.q;
  if (act === 'open') { clearTimeout(qrTimer); qr = { ...qr, step: 'form', people: qrPeople().includes(qr.people) ? qr.people : 0 }; qrDraw(); return $('#qr').scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  if (act === 'close') { qr = { ...qr, step: 'card', v: null, people: 0 }; return qrLoad(); }
  if (act === 'next') {
    const v = qrValues(), err = qrCheck(v);
    if (err) { const m = $('#q-msg'); m.textContent = err; m.hidden = false; return m.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    qr = { ...qr, v, step: 'confirm', rid: randomRid('q') };   // 確認の画面を開くたびに新しい印。送り直しのときは同じ印を使う
    qrDraw();
    return $('#qr').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  if (act === 'back') { qr.step = 'form'; return qrDraw(); }
  if (act === 'send' && PREVIEW) return toast('見え方を確かめる画面なので、ここでは動きません', 'warn');
  if (act === 'send' && !qr.busy) qrSend();
}
function qrSend() {
  qr.busy = true;
  qrDraw();
  const v = qr.v;
  BaguruApi.post({ action: 'quickReserve', rid: qr.rid, via: 'アプリ', people: v.people, name: v.name, tel: v.tel, email: v.email, website: v.website, ...qrAuth() })
    .then(r => {
      // この端末に控える（マイページ）。id と token は様子を読む鍵。お名前・電話（・メール）は、次に入れる手間を省くため会員の情報に
      DB.set('reserves', [...DB.get('reserves', []), { id: r.id, token: r.token, state: 'ok', quick: true, no: r.no, date: r.date, time: r.time, arriveBy: r.arriveBy, people: r.people, sentAt: new Date().toISOString() }]);
      Object.assign(ME, { name: v.name, tel: v.tel, ...(v.email ? { email: v.email } : {}) });
      DB.set('member', ME);
      dropAvail();   // 席が埋まったので、ネット予約の空き状況の控えは使わない
      qr = { ...qr, step: 'done', done: { ...r, email: v.email }, v: null, people: 0, busy: false, now: null };
      qrDraw();
      $('#qr')?.scrollIntoView({ block: 'start' });
    })
    .catch(e => {
      qr.busy = false;
      if (['full', 'not_accepting', 'too_many'].includes(e.code)) {   // いま入れなくなった：はじめのカードに戻して読み直す
        qr = { ...qr, step: 'card', v: null, people: 0 };
        toast(qrMsg(e), 'warn');
        return qrLoad();
      }
      if (['need_name', 'bad_tel', 'bad_people', 'bad_kana', 'bad_email'].includes(e.code)) { qr.step = 'form'; qrDraw(); }
      else qrDraw();
      const m = $('#q-cmsg') || $('#q-msg');
      if (m) { m.textContent = qrMsg(e); m.hidden = false; }
    });
}
// 確定したあと、ほかの画面に移ってから戻ったときは、はじめのカードから
window.addEventListener('hashchange', () => {
  if (routeName() !== 'reserve') { clearTimeout(qrTimer); if (qr.step === 'done') qr = { ...qr, step: 'card', done: null }; }
});

/* ---------------------------------------------------------------------
 *  予約の様子（2026-11-01 ko-dai さんの指示：確定のお知らせをメールとアプリで。予約ボードのセッションから。受け口の版 2026-11-01h から）
 *  ・受け口の myReserves に、控えの id と token を渡して読む（鍵が合う予約だけ返る）。★token は端末の中だけ。アドレスに載せない
 *  ・プッシュのしくみは無いので、アプリを閉じている間は知らせられない。開いたときに読んで、ホームの帯とマイページに出す
 *  ・id の無い前からの控えは読めないので、今までの文のまま
 * --------------------------------------------------------------------- */

const RSV_EVERY = 180000;   // 開いている間に読み直す間隔
const RSV_GAP = 60000;      // 開き直すたびに読みすぎないように、これより短い間隔では読まない

const RSV_STATE = {
  request: { label: '確認中', css: 'request', note: 'お店が確かめています。確定したらメールでお知らせします。このアプリでも、開いたときに分かります' },
  ok: { label: '確定', css: 'ready', note: 'ご予約が確定しました。ご来店をお待ちしております' },
  no: { label: 'お受けできません', css: 'declined', note: '申し訳ありません。ご希望の日時ではお受けできませんでした' },
  canceled: { label: '取り消し', css: 'canceled', note: 'このご予約は取り消しになりました' },
};
const RSV_OLD = { label: 'リクエスト済み', css: 'request', note: '確定・お断りは、お店からメールでお知らせします' };
const rsvState = r => (r.id ? RSV_STATE[r.state] || RSV_STATE.request : RSV_OLD);
const rsvAhead = r => r.date >= dateKey(new Date());

/** 受け口から様子を読んで、控えを書きかえる。様子が変わった控えを返す（確定・お断りのあとは読まないものもある。読むものが無いときは受け口に聞かない） */
async function syncReserves() {
  const list = DB.get('reserves', []).filter(r => r.id && r.token && rsvAhead(r) && !['no', 'canceled'].includes(r.state))
    .slice(-30).map(({ id, token }) => ({ id, token }));
  if (!list.length) return [];
  const got = (await orderPost({ action: 'myReserves', list })).reserves || [];
  const changed = [];
  DB.set('reserves', DB.get('reserves', []).map(r => {
    const s = got.find(x => x.id === r.id);
    if (!s) return r;
    const now = { ...r, no: s.no, date: s.date, time: s.time, people: s.people, state: s.state };
    if (s.state !== r.state) { now.fresh = true; changed.push(now); }   // fresh … マイページを見るまで、ホームに帯を出す
    return now;
  }));
  return changed;
}

/** ホームの帯（様子が変わって、まだマイページで見ていない予約） */
function rsvBanners() {
  return DB.get('reserves', []).filter(r => r.fresh && rsvAhead(r)).map(r => `<a class="obanner ob-${rsvState(r).css}" href="#me">
      <span class="ob-st">${rsvState(r).label}</span>
      <span class="ob-main"><b>ご予約 受付番号 ${esc(r.no)}</b><small>${rsvDay(r.date)} ${esc(r.time)}・${r.people}名</small></span>
      <span class="ob-go">›</span>
    </a>`).join('');
}

/** マイページで見たら、ホームの帯を消す */
function reservesSeen() {
  const all = DB.get('reserves', []);
  if (all.some(r => r.fresh)) DB.set('reserves', all.map(({ fresh, ...r }) => r));
}

/** マイページの「ご予約のリクエスト」（この端末から送ったもの。今日より前のものは出さない） */
function reservesHtml() {
  const list = DB.get('reserves', []).filter(rsvAhead).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  if (!list.length) return '<p class="hint">まだありません。<a href="#reserve">ネット予約</a>から、席の予約のリクエストを送れます。</p>';
  // 即予約（今すぐ行く）は、確定のまま「○時○分までにお越しください」
  const note = r => (r.quick && r.state === 'ok' ? `今すぐのご予約です（お席を押さえています）。${esc(r.arriveBy || r.time)} までにお越しください（遅れるとき・取り消すときはお電話で）` : rsvState(r).note);
  return `<ul class="orders">${list.map(r => `<li><a href="#reserve">
      <span class="o-top"><b>${r.quick ? '予約番号' : '受付番号'} ${esc(r.no)}</b><em class="st st-${rsvState(r).css}">${rsvState(r).label}</em></span>
      <small>${rsvDay(r.date)} ${esc(r.time)}・${r.people}名</small>
      <small>${note(r)}</small>
    </a></li>`).join('')}</ul>`;
}

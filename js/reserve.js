/* =====================================================================
 *  ネット予約（席の予約のリクエスト。2026-10-30 ko-dai さんの指示：予約ボードとつなぐ）
 *  人数 → 日にち → 時間 → お客様のこと → 確認 → 受け付けました
 *
 *  ・ホームページの「ご予約」と同じ受け口（予約ボードの受け口・コード.gs）に、リクエストを送る。
 *    お店が予約ボードの「予約受付」で承認すると、確定のメールが届く（だからメールアドレスは必須）
 *  ・受け口の場所と、やりとりの道具は、予約ボードの公開先から読む（data.js の SHOP.reserveBase の config.js・api.js）。
 *    ★このアプリに受け口のアドレスを写さない（受け口が変わっても、予約ボードの側を直すだけで済むように）
 *  ・送る中身は、ホームページの予約フォーム（ホームページ/公開用/js/reserve.js）と同じにする。受け口が受け取る形を変えたら、こちらも直す
 *  ・送るときに「受付の印（rid）」を付ける。返事が途中で切れて送り直しても、リクエストは1件にしかならない
 *  ・★この Mac で試すときは、にせの受け口（予約ボード/受け口/にせの受け口.py。ポート 8131）から開いて、アドレスに ?test を付ける
 *    （予約ボードの config.js が、にせの受け口につなぎ替える）。本物の受け口にリクエストを送って試さない
 *  ・送ったリクエストは、この端末にも控える（マイページ）。確定・お断りは、お店からメールで届く
 * ===================================================================== */

const RSV_MSG = {
  not_ready: 'ネット予約はただいま準備中です。お電話でご予約ください。',
  not_accepting: 'ネット予約はただいま受け付けていません。お電話でどうぞ。',
  full: 'この時間は、今、満席になりました。他の時間を選んでください。',
  no_slot: 'この時間は予約を受け付けていません。他の時間を選んでください。',
  out_of_range: 'この日はネット予約の受付期間の外です。',
  bad_date: '日にちと時間を選んでください。',
  bad_people: '人数を選んでください。',
  need_name: 'お名前を入れてください。',
  bad_tel: '電話番号を正しく入れてください（例：090-1234-5678）。',
  need_email: 'メールアドレスを入れてください（確定のお知らせをお送りします）。',
  bad_email: 'メールアドレスの形が違います。',
  too_many_bookings: '同じ電話番号でのご予約・リクエストが多いため、受け付けられませんでした。お電話でどうぞ。',
  busy: 'ただいま混み合っています。少し時間を置いて、もう一度お試しください。',
  offline: 'つながりませんでした。電波の良い所で、もう一度お試しください。',
  no_answer: 'つながりませんでした。時間を置いてもう一度お試しいただくか、お電話でどうぞ。',
};

let rsv = { avail: null, people: 0, date: '', time: '', v: null, rid: '', step: 'form', done: null, err: '', busy: false };

function rsvMessage(e) {
  const d = e.data || {};
  if (e.code === 'too_late') return `この時間のネット予約は締め切りました（来店の${d.leadHours}時間前まで）。お電話でどうぞ。`;
  if (e.code === 'too_many') return `${d.maxPeople}名を超えるご予約は、お電話でお受けします。`;
  return RSV_MSG[e.code] || RSV_MSG.no_answer;
}

/** 予約ボードの公開先から、受け口の場所（config.js）と、やりとりの道具（api.js）を読む */
const rsvLib = () => loadScript({ src: SHOP.reserveBase + 'config.js', integrity: '' })
  .then(() => loadScript({ src: SHOP.reserveBase + 'api.js', integrity: '' }));

const ymdDate = ymd => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d); };
const rsvDay = ymd => mdw(ymdDate(ymd));

function viewReserve() {
  return {
    tab: 'home', title: 'ネット予約', back: '#home',
    html: `
      <p class="notice">${ICON.cal}<span>席のご予約の<b>リクエスト</b>です<small>お店が確かめて承認すると、確定のメールが届きます（それまでは確定ではありません）。お急ぎの方は、お電話でどうぞ。</small></span></p>
      <div id="rsv"><p class="hint">空き状況を読み込んでいます…</p></div>`,
    after: rsvStart,
  };
}

function rsvStart() {
  const box = $('#rsv');
  box.onchange = rsvChange;
  box.onclick = rsvClick;
  if (rsv.step !== 'form') return rsvDraw();
  rsv.err = '';
  rsvLib()
    .then(() => {
      if (!window.BaguruApi?.ready()) throw Object.assign(new Error('not_ready'), { code: 'not_ready' });
      return BaguruApi.post({ action: 'avail' });
    })
    .then(a => { rsv.avail = a; rsvDropUnfit(); })
    .catch(e => { rsv.avail = null; rsv.err = rsvMessage(e); })
    .then(rsvDraw);
}

/* ---------- 空き状況（ホームページのフォームと同じ見方） ---------- */
// その時刻に、選んだ人数が入れるか（受け口が、電話の予約も入った台帳から、空いている席を数えて返す）
function rsvFits(s) {
  if (s.late || s.left <= 0) return false;
  if (s.single === undefined) return true;
  const p = rsv.people || 1, maxTable = rsv.avail.maxTable || 0;
  return p <= s.single || (p > maxTable && p <= s.group);
}
function rsvDayMark(d) {
  if (d.type === 'closed') return { m: '休', cls: 'is-closed', ok: false };
  const open = d.slots.filter(rsvFits);
  if (!open.length && d.slots.every(s => s.late)) return { m: '－', cls: 'is-closed', ok: false };
  if (!open.length) return { m: '×', cls: 'is-full', ok: false };
  const many = open.some(s => s.left >= Math.min(2, rsv.avail.cap));
  return many ? { m: '○', cls: '', ok: true } : { m: '△', cls: 'is-few', ok: true };
}
const rsvSlotMark = s => s.late ? '－' : !rsvFits(s) ? '×' : (s.left === 1 && rsv.avail.cap > 1) ? '△' : '○';

/** 選んでいた日・時間に入れなくなったら外す（埋まったとき・人数を変えたとき） */
function rsvDropUnfit() {
  if (!rsv.avail) return;
  const d = rsv.avail.days.find(x => x.date === rsv.date);
  if (!d || !rsvDayMark(d).ok) { rsv.date = ''; rsv.time = ''; }
  else if (!d.slots.some(s => s.t === rsv.time && rsvFits(s))) rsv.time = '';
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
  const v = rsv.v || { name: ME.name, tel: ME.tel, email: ME.email || '', kids: false, dessert: false, plateMsg: '', note: '' };
  const max = rsv.avail.maxPeople;
  box.innerHTML = `
    <h2 class="sec">人数</h2>
    <div class="r-people">${Array.from({ length: max }, (_, i) => `<label class="r-chip"><input type="radio" name="r-people" value="${i + 1}" ${rsv.people === i + 1 ? 'checked' : ''}><span>${i + 1}名</span></label>`).join('')}</div>
    <p class="hint">${max + 1}名以上のご予約は、お電話でお受けします。</p>
    <h2 class="sec">日にち</h2>
    <div id="r-days">${rsvDaysHtml()}</div>
    <h2 class="sec">時間</h2>
    <div id="r-times">${rsvTimesHtml()}</div>
    <h2 class="sec">お客様のこと</h2>
    <label class="field"><span>お名前</span><input id="r-name" autocomplete="name" maxlength="40" value="${esc(v.name)}" placeholder="例：豊田 太郎"></label>
    <label class="field"><span>電話番号</span><input id="r-tel" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" value="${esc(v.tel)}" placeholder="例：090-1234-5678"></label>
    <label class="field"><span>メールアドレス（確定のお知らせをお送りします）</span><input id="r-email" type="email" inputmode="email" autocomplete="email" maxlength="120" value="${esc(v.email)}"></label>
    <label class="r-check"><input type="checkbox" id="r-kids" ${v.kids ? 'checked' : ''}>お子様連れ</label>
    <div class="field"><span>デザートプレート（要予約・税込1,100円）</span>
      <div class="r-row"><label class="r-chip"><input type="radio" name="r-dessert" value="no" ${v.dessert ? '' : 'checked'}><span>注文しない</span></label>
      <label class="r-chip"><input type="radio" name="r-dessert" value="yes" ${v.dessert ? 'checked' : ''}><span>注文する</span></label></div></div>
    <label class="field" id="r-plate-box" ${v.dessert ? '' : 'hidden'}><span>プレートに書くメッセージ（30文字まで）</span><input id="r-plate" maxlength="30" value="${esc(v.plateMsg)}" placeholder="例：Happy Birthday たろう"></label>
    <label class="field"><span>ご要望（なくても構いません）</span><textarea id="r-note" rows="2" maxlength="300" placeholder="お祝い・アレルギー・ベビーカーなど">${esc(v.note)}</textarea></label>
    <div class="r-hp" aria-hidden="true"><label>ここには何も入れないでください<input id="r-website" tabindex="-1" autocomplete="off"></label></div>
    <p class="notice warn" id="r-msg" hidden></p>
    <div class="foot"><button class="btn btn-main btn-block" data-r="next">内容を確認する</button></div>`;
}

function rsvDaysHtml() {
  const days = rsv.avail.days;
  if (!days.length) return '<p class="hint">受け付けている日がありません。</p>';
  const pad = ymdDate(days[0].date).getDay();
  return `<div class="r-cal">${WEEK.map((w, i) => `<span class="r-wd ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</span>`).join('')}
    ${'<span></span>'.repeat(pad)}
    ${days.map((d, i) => {
      const mk = rsvDayMark(d), dt = ymdDate(d.date), day = dt.getDate(), w = dt.getDay();
      const label = (i === 0 || day === 1) ? `${dt.getMonth() + 1}/${day}` : day;
      return `<label class="r-day ${mk.cls} ${w === 0 || d.holiday ? 'sun' : w === 6 ? 'sat' : ''}">
          <input type="radio" name="r-date" value="${d.date}" ${mk.ok ? '' : 'disabled'} ${rsv.date === d.date ? 'checked' : ''}>
          <span><b>${label}</b><i>${mk.m}</i></span></label>`;
    }).join('')}</div>
    <p class="hint">○ 空いています　△ 残りわずか　× 満席　休 お休み</p>`;
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

function rsvValues() {
  const dessert = $('input[name="r-dessert"]:checked')?.value === 'yes';
  return {
    people: rsv.people, date: rsv.date, time: rsv.time,
    name: $('#r-name').value.trim(), tel: toHalf($('#r-tel').value.trim()), email: $('#r-email').value.trim(),
    kids: $('#r-kids').checked, note: $('#r-note').value.trim(), website: $('#r-website').value,
    dessert, plateMsg: dessert ? $('#r-plate').value.trim() : '',
  };
}
function rsvCheck(v) {
  if (!v.people) return RSV_MSG.bad_people;
  if (!v.date || !v.time) return RSV_MSG.bad_date;
  if (!v.name) return RSV_MSG.need_name;
  if (!/^0\d{9,10}$/.test(v.tel.replace(/[^\d]/g, ''))) return RSV_MSG.bad_tel;
  if (!v.email) return RSV_MSG.need_email;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) return RSV_MSG.bad_email;
  return '';
}

function rsvSummary(v) {
  return `<dl class="info">
      <dt>日時</dt><dd>${rsvDay(v.date)} ${esc(v.time)}</dd>
      <dt>人数</dt><dd>${v.people}名</dd>
      <dt>お名前</dt><dd>${esc(v.name)} 様</dd>
      <dt>電話番号</dt><dd>${esc(v.tel)}</dd>
      ${v.email ? `<dt>メール</dt><dd>${esc(v.email)}</dd>` : ''}
      ${v.kids ? '<dt>お子様連れ</dt><dd>あり</dd>' : ''}
      ${v.dessert !== undefined ? `<dt>デザートプレート</dt><dd>${v.dessert ? `注文する（税込1,100円）${v.plateMsg ? `<br>メッセージ：「${esc(v.plateMsg)}」` : '<br>メッセージ：なし'}` : '注文しない'}</dd>` : ''}
      ${v.note ? `<dt>ご要望</dt><dd>${esc(v.note)}</dd>` : ''}
    </dl>`;
}

function rsvConfirmHtml() {
  return `<h2 class="sec">この内容で送ります</h2>
    ${rsvSummary(rsv.v)}
    <p class="hint">送ると、お店に「リクエスト」が届きます。お店が確かめて承認すると、確定のメールが届きます。</p>
    <p class="notice warn" id="r-cmsg" hidden></p>
    <div class="foot foot-2">
      <button class="btn btn-main btn-block" data-r="send" ${rsv.busy ? 'disabled' : ''}>${rsv.busy ? '送っています…' : 'この内容で送る'}</button>
      <button class="btn btn-sub btn-block" data-r="back">戻って直す</button>
    </div>`;
}

function rsvDoneHtml() {
  const r = rsv.done;
  return `<div class="thanks">${ICON.check}<div><b>リクエストを受け付けました</b><small>まだ確定していません。お店が確かめて承認すると、確定のメールが届きます</small></div></div>
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
  if (act === 'next') {
    const v = rsvValues(), err = rsvCheck(v);
    if (err) { const m = $('#r-msg'); m.textContent = err; m.hidden = false; m.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    rsv.v = v;
    rsv.rid = BaguruApi.rid();   // 確認の画面を開くたびに新しい印。送り直しのときは同じ印を使う
    rsv.step = 'confirm';
    rsvDraw();
    return window.scrollTo(0, 0);
  }
  if (act === 'back') { rsv.step = 'form'; rsvDraw(); return; }
  if (act === 'again') { rsv = { ...rsv, step: 'form', done: null, people: 0, date: '', time: '', v: null }; $('#rsv').innerHTML = '<p class="hint">空き状況を読み込んでいます…</p>'; return rsvStart(); }
  if (act === 'send' && !rsv.busy) rsvSend();
}

function rsvSend() {
  rsv.busy = true;
  rsvDraw();
  // via … どこから来たか（受け口が読めるようになったら、予約ボードの「経路」に「アプリ」と出る。いまの受け口は読まずに「ホームページ」とする）
  BaguruApi.post({ action: 'reserve', rid: rsv.rid, via: 'アプリ', ...rsv.v })
    .then(r => {
      // この端末にも控える（マイページの「ご予約のリクエスト」）。お名前・電話・メールは、次に入れる手間を省くため会員の情報に
      DB.set('reserves', [...DB.get('reserves', []), { no: r.no, date: r.date, time: r.time, people: r.people, sentAt: new Date().toISOString() }]);
      Object.assign(ME, { name: rsv.v.name, tel: rsv.v.tel, email: rsv.v.email });
      DB.set('member', ME);
      rsv = { ...rsv, step: 'done', done: r, v: null, people: 0, date: '', time: '', busy: false, avail: null };
      rsvDraw();
      window.scrollTo(0, 0);
    })
    .catch(e => {
      rsv.busy = false;
      if (['full', 'too_late', 'no_slot'].includes(e.code)) {
        // 枠が埋まったときは、空き状況を読み直して、時間を選び直してもらう
        rsv.time = '';
        rsv.step = 'form';
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

/** マイページの「ご予約のリクエスト」（この端末から送ったもの。今日より前のものは出さない） */
function reservesHtml() {
  const today = dateKey(new Date());
  const list = DB.get('reserves', []).filter(r => r.date >= today).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  if (!list.length) return '<p class="hint">まだありません。<a href="#reserve">ネット予約</a>から、席の予約のリクエストを送れます。</p>';
  return `<ul class="orders">${list.map(r => `<li><a href="#reserve">
      <span class="o-top"><b>受付番号 ${esc(r.no)}</b><em class="st st-request">リクエスト済み</em></span>
      <small>${rsvDay(r.date)} ${esc(r.time)}・${r.people}名</small>
      <small>確定・お断りは、お店からメールでお知らせします</small>
    </a></li>`).join('')}</ul>`;
}

/* =====================================================================
 *  テイクアウトの注文を、受け口（予約ボードの受け口・コード.gs）とやりとりする
 *  2026-10-30 ko-dai さんの決め：テイクアウトの注文は受け口に入り、受け付ける・進めるのは Order受付だけ（予約ボードのテイクアウトの画面は見るだけ）。
 *  予約ボードのセッションに頼まれて作った（受け口の作りは 予約ボード/引き継ぎ書.md の「4. しくみ」）
 *
 *  ・★ORDERS_ONLINE のときだけ受け口に送る（data.js の TAKEOUT.online。受け口の 2026-10-30e 以降が Google に入り、Order受付も受け口につないでから、2つ一緒に true にする）。
 *    false のあいだは、前のとおりブラウザの中だけ（試作。お店の画面を同じブラウザで開くと届く）
 *    この Mac で試すときは ?test を付けて開くと、false のままでも、にせの受け口（予約ボード/受け口/にせの受け口.py）で試せる
 *  ・受け口の場所と送り方は、ネット予約と同じ（予約ボードの公開先の config.js・api.js の BaguruApi.post）
 *  ・この端末には、自分の注文の写し（DB 'orders'。画面はこれを見る）と、注文の鍵（DB 'orderKeys'：{id: token}）を持つ。
 *    ★鍵は、その注文をあとで見るためのもの。端末の中にだけ持ち、アドレスには入れない
 *  ・進めている注文があるあいだは、画面を見ているときだけ15秒ごとに、お店が進めた様子を取り寄せる（myOrders）
 *  ・★お渡し済みになっても、スタンプは押さない（2026-11-04 ko-dai さんの指示：テイクアウトのネット注文ではポイントをためない。ためるのは店頭のQRだけ）
 *  ・★Order受付（js/store.js）も、このファイルの ORDERS_ONLINE・orderPost・fromServer を使う（2026-10-30）。
 *    名前や形を変えるときは、先に Order受付のセッションに知らせる
 * ===================================================================== */

const ORDERS_ONLINE = !!TAKEOUT.online || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /[?&]test\b/.test(location.search));
const SYNC_EVERY = 15000;   // 進めている注文の様子を取り寄せる間隔（受け口に頼まれた 10〜20秒）

const ORDER_MSG = {
  not_ready: 'ただいまアプリからの注文を準備しています。お電話でご注文ください。',
  not_accepting: 'ただいま注文を受け付けていません。お急ぎの方はお電話でどうぞ。',
  bad_input: '注文の内容を読めませんでした。カートを確かめて、もう一度お試しください。',
  need_name: 'お名前を入れてください',
  bad_tel: '電話番号を確かめてください',
  bad_date: '受け取りの日時を、もう一度選んでください',
  need_address: 'お届け先のご住所を入れてください',
  busy: 'ただいま混み合っています。少し時間を置いて、もう一度お試しください',
  offline: 'つながりませんでした。電波の良い所で、もう一度お試しください',
  no_answer: 'つながりませんでした。時間を置いてもう一度お試しいただくか、お電話でどうぞ',
  already: 'お店が受け付けた後は、お電話でご連絡ください',
  not_found: 'この注文が見つかりませんでした。お電話でお問い合わせください',
};
const orderMessage = e => ORDER_MSG[e.code] || ORDER_MSG.no_answer;

/** 予約ボードの公開先から、受け口の場所（config.js）と、やりとりの道具（api.js）を読む（ネット予約と同じもの）。
 *  2つは同時に読む（api.js は送るときに BAGURU を見るので、読む順は関係ない。2026-11-03 に、順に読むのをやめた） */
function baguruLib() {
  return Promise.all(['config.js', 'api.js'].map(f => loadScript({ src: SHOP.reserveBase + f, integrity: '' })))
    .then(() => { if (!window.BaguruApi?.ready()) throw Object.assign(new Error('not_ready'), { code: 'not_ready' }); });
}
const orderPost = payload => baguruLib().then(() => BaguruApi.post(payload));

/** 再送の印（rid）。受け口は同じ印の注文・予約を返すので、推測されないよう暗号の乱数で作る（時刻を使わない。2026-11-01 の Codex のレビュー） */
const randomRid = head => head + [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');

/** 受け口の注文を、この端末の形にする（ご要望は、受け口では note・この端末では memo）。
 *  注文番号は3桁で見せる（スプレッドシートが 001 を数の 1 にして返すため。2026-11-01 に本物で見つけた。にせの受け口では起きない）
 *  お箸・スプーンの有無は、note の頭の「カトラリーあり／なし」を読んで o.cutlery（true／false）にする。頭に無い注文は undefined */
const fromServer = o => {
  const cut = String(o.note || '').match(/^カトラリー(あり|なし)(?:／|$)/);
  return { ...o, memo: cut ? o.note.slice(cut[0].length) : o.note || '', ...(cut ? { cutlery: cut[1] === 'あり' } : {}),
    no: /^\d+$/.test(String(o.no)) ? String(o.no).padStart(3, '0') : o.no };
};
/** 受け口に送るご要望。お客さまの画面では「お箸・スプーン」、お店には「カトラリー」と出す（2026-11-01 ko-dai さんの指示）。
 *  ご要望の頭に付けて送るので、受け口の形は変えていない。台帳の「ご要望」の列にも、この字のまま残る */
const noteOf = o => [{ true: 'カトラリーあり', false: 'カトラリーなし' }[o.cutlery], o.memo].filter(Boolean).join('／');
const orderKeys = () => DB.get('orderKeys', {});

/** この端末の写しを、受け口の注文で書きかえる（無いものは足す）。
 *  お店が受け取りの時間を変えていたら、前の時間を movedFrom に控える（2026-11-01 ko-dai さんの指示：お客さまに知らせる。Order受付の「できしだい」の時間の変更）。
 *  閉じている間に変わっても、次に開いて読んだときに分かる */
let orderMoved = [];   // 時間が変わって、まだ知らせていない注文（app.js の ordersChanged が知らせる）
function mergeOrders(list) {
  const all = getOrders();
  list.forEach(s => {
    const i = all.findIndex(o => o.id === s.id);
    // 会員番号はこの端末のものを残す（受け口は、鍵の合わない番号を残さないので、空や前の番号が返る。myOrders がこの番号で絞る）
    const o = { ...(i >= 0 ? all[i] : {}), ...fromServer(s), ...(i >= 0 ? { member: all[i].member } : {}) };
    if (i >= 0 && new Date(all[i].pickupAt).getTime() !== new Date(o.pickupAt).getTime()) {
      o.movedFrom = all[i].pickupAt;
      orderMoved.push(o);
    }
    if (i >= 0) all[i] = o; else all.push(o);
  });
  saveOrders(all);
}

/** 名前をマネージで改行していても、お店には1行で届ける */
const oneLine = s => textOf(s, true).replace(/\s*\n\s*/g, ' ');

/** 注文・申請を送る。うまくいったら、この端末に写しと鍵を残して、受け口がつけた番号・合計の入った注文を返す。
 *  rid（送り直しで2つにならない印）は、この端末で作った注文の id */
async function sendOrder(o) {
  const r = await orderPost({
    action: 'order', kind: o.kind, asap: !!o.asap, pickupAt: o.pickupAt, name: o.name, tel: o.tel,
    address: o.address || '', address2: o.address2 || '', meals: o.meals, note: noteOf(o), member: o.member, memberKey: DB.get('memberAuth', null)?.key || '',
    // バグるマネージで名前を直していたら、お店にも直した名前で届くように（js/content.js の textOf）
    lines: o.lines.map(({ id, name, opts, unit, qty }) => ({ id, name: oneLine(name), opts: opts.map(oneLine), unit, qty })),
    rid: o.id, website: '',
  });
  DB.set('orderKeys', { ...orderKeys(), [r.order.id]: r.token });
  mergeOrders([{ ...r.order, member: o.member }]);
  return fromServer(r.order);
}

/** 進めている注文（受け口から来たもの）の様子を取り寄せる。変わっていたら true */
async function syncOrders() {
  const keys = orderKeys();
  const list = getOrders().filter(o => keys[o.id] && ACTIVE.includes(o.status)).slice(-30).map(o => ({ id: o.id, token: keys[o.id] }));
  if (!list.length) return false;
  const r = await orderPost({ action: 'myOrders', list });
  const before = JSON.stringify(getOrders());
  mergeOrders(r.orders || []);
  if (typeof r.accepting === 'boolean') DB.set('accepting', r.accepting);
  return JSON.stringify(getOrders()) !== before;
}

/** 受付待ち・申請中の注文を取り消す。お店がもう受け付けていたら（already）、その様子を写して知らせる */
async function cancelOrderOnline(id) {
  try {
    const r = await orderPost({ action: 'orderCancel', id, token: orderKeys()[id] });
    mergeOrders([r.order]);
  } catch (e) {
    if (e.data?.order) mergeOrders([e.data.order]);
    throw e;
  }
}

/** お店が注文を受け付けているか（受け口の設定）を、この端末の 'accepting' に写す（画面はそれを見る）。変わったら true */
let acceptingAt = 0;
async function refreshAccepting(force = false) {
  if (!force && Date.now() - acceptingAt < 60000) return false;
  acceptingAt = Date.now();
  const r = await orderPost({ action: 'orderInfo' });
  const changed = DB.get('accepting', true) !== r.accepting;
  DB.set('accepting', r.accepting);
  return changed;
}

// お渡し済みの注文にスタンプを押す stampDoneOrders は、2026-11-04 に外した（ko-dai さんの指示：ネット注文ではポイントをためない）

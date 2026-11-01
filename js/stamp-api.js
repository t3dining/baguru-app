/* =====================================================================
 *  スタンプと特典の台帳（受け口）とのやりとり（2026-11-01 ko-dai さんの指示。決まりは スタンプ台帳の決めごと.md）
 *  ・数を決めるのは受け口。この端末の bg.stamps は、受け口の答えを写して見せるだけ
 *  ・鍵は bg.memberAuth（端末の中だけ。アドレスに載せない）
 *  ・STAMP.online を切っているあいだは、今までのとおり端末の中で動く（この Mac で ?test を付けて開いたときは入る）
 *  ・★新しい action は受け口が先。受け口に無いときに呼ぶと、合言葉の失敗に数えられる
 * ===================================================================== */

const STAMPS_ONLINE = !!STAMP.online || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /[?&]test\b/.test(location.search));

const STAMP_MSG = {
  bad_member: 'この端末の会員の情報が使えなくなりました。もう一度お試しください',
  tel_used: 'この電話番号は、もう登録されています。スマホを替えた方は、マイページの引き継ぎコードをお使いください',
  bad_tel: '電話番号を確かめてください',
  need_name: 'お名前を入れてください',
  coupon_used: 'この特典は使用済みです',
  coupon_today: `特典は1日${STAMP.couponsPerDay}枚までです（今日はもう使いました）`,
  not_found: 'この特典が見つかりませんでした。お店の人に声をかけてください',
  bad_code: 'コードか電話番号が違います。もう一度確かめてください',
};
const stampMessage = e => STAMP_MSG[e.code] || ORDER_MSG[e.code] || ORDER_MSG.no_answer;

const memberAuth = () => DB.get('memberAuth', null);

/** 受け口の特典券に、画面に出す名前と選ぶものを足す（受け口は at と label だけ持つ。名前は data.js とマネージの内容から） */
function couponFill(c) {
  const r = STAMP.rewards.find(x => x.at === c.at) || (c.at ? null : STAMP.welcome);
  return { ...c, usedAt: c.usedAt || null, options: r ? r.options : [c.label], title: r ? couponTitle(r) : c.label };
}

/** 受け口の状態を、この端末の写しにする */
function keepState(st) {
  if (!st) return;
  DB.set('stamps', { total: st.total, log: (st.log || []).slice().reverse(), coupons: (st.coupons || []).map(couponFill), ...(st.lineMovedAt ? { lineMovedAt: st.lineMovedAt } : {}) });
  Object.assign(ME, { no: st.no, ...(st.registeredAt ? { name: st.name, tel: st.tel, registeredAt: st.registeredAt } : {}) });
  DB.set('member', ME);
}

/** 会員を作る。端末にたまった分があれば、1回だけ台帳へ移す。移し終わるまで鍵を残さない（途中で切れたら、次に開いたときに同じ印でやり直す） */
async function joinMember() {
  const rid = DB.get('memberRid') || randomRid('m');
  DB.set('memberRid', rid);
  const r = await orderPost({ action: 'memberJoin', rid });
  const s = getStamps(), auth = { no: r.member, key: r.key };
  if (s.total || s.coupons.length || ME.registeredAt) {
    const moved = await orderPost({
      action: 'memberMove', member: auth.no, key: auth.key, total: s.total, lineMovedAt: s.lineMovedAt || '',
      coupons: s.coupons.filter(c => !c.usedAt).map(({ at, label, earnedAt }) => ({ at, label, earnedAt })),
      log: s.log.slice(-50), name: ME.name, tel: ME.tel, registeredAt: ME.registeredAt || '',
    }).catch(e => { if (e.code === 'moved') return e.data; throw e; });
    keepState(moved.state);
  } else {
    keepState(r.state);
  }
  DB.set('memberAuth', auth);
  return auth;
}

let joining = null;
const memberReady = () => (memberAuth() ? Promise.resolve(memberAuth()) : joining ||= joinMember().finally(() => { joining = null; }));

/** ほかのスマホへ引き継いで鍵が変わったとき。この端末の写しを消して、次は新しい会員として始める */
function memberLost() {
  ['memberAuth', 'memberRid'].forEach(k => DB.set(k, null));
  DB.set('stamps', { total: 0, log: [], coupons: [] });
  delete ME.registeredAt;
  DB.set('member', ME);
}

/** 会員の鍵を付けて送り、受け口の状態を写す */
async function stampPost(action, extra = {}) {
  const a = await memberReady();
  try {
    const r = await orderPost({ action, member: a.no, key: a.key, ...extra });
    keepState(r.state);
    return { ...r, got: (r.got || []).map(couponFill) };
  } catch (e) {
    if (e.code === 'bad_member') memberLost();
    throw e;
  }
}

/** 台帳の様子を読み直す。変わっていたら true。まだ何もしていない人は台帳に行を作らない */
async function syncStamps() {
  const s = getStamps();
  if (!memberAuth() && !s.total && !s.coupons.length && !ME.registeredAt) return false;
  const before = JSON.stringify(s);
  await stampPost('stampRead');
  return JSON.stringify(getStamps()) !== before;
}

/** 新しいスマホで、前のスマホの続きを使う（鍵が新しくなり、前のスマホでは使えなくなる） */
async function takeMember(code, tel) {
  const r = await orderPost({ action: 'memberTake', code, tel });
  DB.set('memberAuth', { no: r.member, key: r.key });
  keepState(r.state);
}

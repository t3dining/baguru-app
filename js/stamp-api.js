/* =====================================================================
 *  スタンプと特典の台帳（受け口）とのやりとり（2026-11-01 ko-dai さんの指示。決まりは スタンプ台帳の決めごと.md）
 *  ・数を決めるのは受け口。この端末の bg.stamps は、受け口の答えを写して見せるだけ
 *  ・鍵は bg.memberAuth（端末の中だけ。アドレスに載せない）
 *  ・STAMP.online を切っているあいだは、今までのとおり端末の中で動く（この Mac で ?test を付けて開いたときは入る）
 *  ・★新しい action は受け口が先。受け口に無いときに呼ぶと、合言葉の失敗に数えられる
 * ===================================================================== */

const LOCAL_TEST = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /[?&]test\b/.test(location.search);
const STAMPS_ONLINE = !!STAMP.online || LOCAL_TEST;
const MEMBER_PLUS = !!STAMP.memberPlus || LOCAL_TEST;
const MEMBER_DELETE = !!STAMP.memberDelete || LOCAL_TEST;
// バグる Owner から開いたときのテスト用アカウント（js/db.js が箱を bgtest. に替えたとき。スタンプ台帳の決めごと.md の15節）
const TEST_MEMBER = DB.prefix === 'bgtest.' && STAMPS_ONLINE;
// テスト用アカウントは、端末の側でも「1日1個」「特典は1日1枚」で止めない（受け口もゆるめる）
const stampDoneToday = () => !TEST_MEMBER && stampedToday();
const couponOkToday = () => TEST_MEMBER || canUseCoupon();

const STAMP_MSG = {
  bad_member: 'この端末の会員の情報が使えなくなりました。もう一度お試しください',
  tel_used: MEMBER_PLUS ? 'この電話番号は、もう登録されています。アプリを入れ直した方は、マイページの「アプリを入れ直したとき」から前の会員に戻せます' : 'この電話番号は、もう登録されています。スマホを替えた方は、マイページの引き継ぎコードをお使いください',
  bad_tel: '電話番号を確かめてください',
  need_name: 'お名前を入れてください',
  coupon_used: 'この特典は使用済みです',
  coupon_today: `特典は1日${STAMP.couponsPerDay}枚までです（今日はもう使いました）`,
  not_found: 'この特典が見つかりませんでした。お店の人に声をかけてください',
  bad_code: 'コードか電話番号が違います。もう一度確かめてください',
  bad_back: 'お名前か電話番号が違います。登録したときと同じものを入れてください',
  need_register: 'LINEのポイントの引き継ぎは、会員登録をした方だけできます。先にお名前と電話番号を登録してください',
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
  if (st.no !== ME.no) saveOrders(getOrders().map(o => (o.member === ME.no ? { ...o, member: st.no } : o)));   // 番号が変わっても、この端末の注文が見えるように
  // メールとフリガナは、席の予約で入れた分がこの端末にあれば残す
  const more = MEMBER_PLUS ? { gender: st.gender || '', age: st.age || '', email: st.email || ME.email || '', kana: st.kana || ME.kana || '' } : {};
  Object.assign(ME, { no: st.no, ...(st.registeredAt ? { name: st.name, tel: st.tel, registeredAt: st.registeredAt, ...more } : {}) });
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
// テスト用アカウントの箱では、ふつうの会員を作らない（作るのは makeTestMember だけ）
const memberReady = () => (memberAuth() ? Promise.resolve(memberAuth())
  : TEST_MEMBER ? Promise.reject(Object.assign(new Error('need_test'), { code: 'need_test' }))
  : joining ||= joinMember().finally(() => { joining = null; }));

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
    keepState(e.data?.state);   // 断りの答えにも、今の様子が付いてくる
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

/** アプリを入れ直したとき、登録したお名前と電話番号で前の会員に戻る（鍵が新しくなる。スタンプ台帳の決めごと.md の11節） */
async function backMember(name, tel) {
  const r = await orderPost({ action: 'memberBack', name, tel, rid: randomRid('b') });
  DB.set('memberAuth', { no: r.member, key: r.key });
  keepState(r.state);
}

/** アカウントを削除する（2026-11-02 ko-dai さんの指示。スタンプ台帳の決めごと.md の14節）。
 *  受け口の会員・スタンプ・特典を全部消してから、この端末の保存も全部消す（注文・予約の記録はお店の台帳に残る）。
 *  鍵がもう使えない（bad_member）ときは、受け口に会員がいないので、端末だけ消す */
async function deleteMember() {
  const a = memberAuth();
  if (a && STAMPS_ONLINE) await orderPost({ action: 'memberDelete', member: a.no, key: a.key }).catch(e => { if (e.code !== 'bad_member') throw e; });
  DB.clearAll();
}

/** 新しいスマホで、前のスマホの続きを使う（鍵が新しくなり、前のスマホでは使えなくなる） */
async function takeMember(code, tel) {
  const r = await orderPost({ action: 'memberTake', code, tel });
  DB.set('memberAuth', { no: r.member, key: r.key });
  keepState(r.state);
}

/* ---- テスト用アカウント（バグる Owner から開いたときだけ。スタンプ台帳の決めごと.md の15節） ---- */

// ★公式アプリは、お店の合言葉を読まない・覚えない（2026-11-05 お店用アプリの引っ越しの段階1。計画書 `お店用アプリの引っ越し.md`）。
//   前は、予約ボードなどが覚えた baguru.daicho.pin を読んでいた。テスト用アカウントを作るときに、毎回入れてもらう（作るときに1回使うだけ）
const TEST_MSG = {
  bad_pin: '合言葉が違います。',
  locked: '合言葉を何度も間違えたため、しばらく使えません。時間を置いてから、もう一度お試しください。',
  need_test: 'テスト用アカウントを作ってから、お試しください。',
  not_test: 'この会員はテスト用ではありません。',
  unknown_action: '受け口がまだテスト用アカウントに対応していません。',
};
/** テスト用アカウントの知らせ。お店の人だけが見る画面なので、知らない答えのときは、受け口の答え（エラーの名前・文）もそのまま添える
 *  （2026-11-04 ko-dai さんの報告：パソコンの Owner から作ろうとすると「つながりませんでした」と出る。受け口の中のエラーも、アプリには同じ字に見えていたため） */
const testMessage = e => {
  const known = TEST_MSG[e.code] || STAMP_MSG[e.code] || (!['no_answer', 'offline'].includes(e.code) && ORDER_MSG[e.code]);
  if (known) return known;
  const why = String(e.code || e.message || '').slice(0, 80);   // offline：届かなかった・no_answer：答えが読めなかった・それ以外：受け口の中のエラー
  return `${e.code === 'offline' ? ORDER_MSG.offline : ORDER_MSG.no_answer}${why ? `（受け口の答え：${why}）` : ''}`;
};

/** テスト用の会員を作る（お店の action。合言葉が要る）。お名前「テスト」、登録済みとして返る */
async function makeTestMember(pin) {
  const rid = DB.get('memberRid') || randomRid('t');
  DB.set('memberRid', rid);
  const r = await orderPost({ action: 'memberTest', rid, pin });
  DB.set('memberAuth', { no: r.member, key: r.key });
  keepState(r.state);
}

/** テスト用の会員のスタンプ・特典・LINE の引き継ぎを0に戻す（お名前と登録は残る） */
const resetTestMember = () => stampPost('memberTestReset');

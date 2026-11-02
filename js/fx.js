/* =====================================================================
 *  演出（紙ふぶき・ハート・数字が増える・炭火の火の粉）
 *  2026-10-30 ko-dai さんの指示：「デザインがチープなので、装飾やアニメーションを増やす。ポイントがたまるときも面白く」
 *  ・外のライブラリは使わない（画面いっぱいの canvas に描いて、終わったら消す）
 *  ・スマホの設定で「動きを減らす」にしている人には、動かさない（FX.calm。app.css の最後でも、動きを止めている）
 * ===================================================================== */

const FX = {
  calm: !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  // ロゴのピンク・金・クリーム・こげ茶
  colors: ['#c7361d', '#e7792f', '#b8914b', '#f3c96b', '#fff6e8', '#1f1916'],   // 炭火の赤・だいだい・真鍮・金・白・炭（ホームページの色）

  /** 紙ふぶきとハート。x, y は飛び出す場所（画面の中の位置。省略すると画面の上のまん中）。
   *  kind … 'pop'（少し。スタンプ1個・注文）／'party'（たくさん。ゴール・初回登録） */
  confetti({ x = innerWidth / 2, y = innerHeight * 0.35, kind = 'pop' } = {}) {
    if (FX.calm) return;
    const party = kind === 'party';
    const cv = document.createElement('canvas');
    const dpr = Math.min(devicePixelRatio || 1, 2);
    cv.className = 'fx-canvas';
    cv.width = innerWidth * dpr;
    cv.height = innerHeight * dpr;
    document.body.append(cv);
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    const n = party ? 150 : 70;
    const parts = Array.from({ length: n }, (_, i) => {
      const a = (party ? Math.random() * Math.PI * 2 : -Math.PI / 2 + (Math.random() - 0.5) * 2.4);
      const v = (party ? 6 : 5) + Math.random() * (party ? 9 : 6);
      return {
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (party ? 3 : 2),
        r: 4 + Math.random() * 5, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.35,
        c: FX.colors[i % FX.colors.length], shape: i % 7 === 0 ? 'heart' : i % 3 === 0 ? 'dot' : 'rect',
        life: 0, max: (party ? 120 : 80) + Math.random() * 40,
      };
    });
    const heart = (p) => {
      g.beginPath();
      g.moveTo(0, p.r * 0.35);
      g.bezierCurveTo(-p.r * 1.2, -p.r * 0.5, -p.r * 0.4, -p.r * 1.3, 0, -p.r * 0.45);
      g.bezierCurveTo(p.r * 0.4, -p.r * 1.3, p.r * 1.2, -p.r * 0.5, 0, p.r * 0.35);
      g.fill();
    };
    const step = () => {
      g.clearRect(0, 0, innerWidth, innerHeight);
      let alive = 0;
      for (const p of parts) {
        if (p.life++ > p.max) continue;
        alive++;
        p.vy += 0.22; p.vx *= 0.985; p.vy *= 0.985;
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        g.save();
        g.globalAlpha = Math.min(1, (p.max - p.life) / 25);
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.fillStyle = p.c;
        if (p.shape === 'heart') heart(p);
        else if (p.shape === 'dot') { g.beginPath(); g.arc(0, 0, p.r * 0.55, 0, Math.PI * 2); g.fill(); }
        else g.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
        g.restore();
      }
      if (alive) requestAnimationFrame(step);
      else cv.remove();
    };
    requestAnimationFrame(step);
  },

  /** 画面の部品のまん中から、紙ふぶきを出す */
  confettiFrom(el, kind = 'pop') {
    const b = el?.getBoundingClientRect();
    if (b) FX.confetti({ x: b.left + b.width / 2, y: b.top + b.height / 2, kind });
  },

  /** 数字を from から to へ、少しずつ増やして見せる（終わると、ぽんとはねる）。fmt … 見せ方（値段なら yen） */
  count(el, from, to, ms = 650, fmt = n => n) {
    if (!el) return;
    if (FX.calm || from === to) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      el.textContent = fmt(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(tick);
      else { el.classList.remove('fx-bump'); void el.offsetWidth; el.classList.add('fx-bump'); }
    };
    requestAnimationFrame(tick);
  },

  /** スマホをぶるっと震わせる（まだ画面に触っていないページでは、ブラウザが止めるので呼ばない） */
  buzz(pattern) {
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    navigator.vibrate?.(pattern);
  },

  /** 炭火の火の粉（ホームの写真の上を、オレンジの粒がゆっくり上がる）。box の中に足す */
  embers(box, n = 16) {
    if (FX.calm || !box || box.querySelector('.ember')) return;
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span');
      s.className = 'ember';
      s.style.cssText = `left:${(i * 61) % 100}%;--d:${4 + (i % 5) * 1.3}s;--w:${(i * 37) % 9 - 4}vw;--s:${2 + (i % 3)}px;animation-delay:-${(i * 0.7) % 6}s`;
      box.append(s);
    }
  },

  /* ---- ここから 2026-11-01 ko-dai さんの指示：「もっと装飾やアニメーションを増やす」 ---- */

  /** スクロールで画面に入ったものを、上から順にふわっと出す（ホームページの出かたと同じ考え方）。画面を移ったときだけ呼ぶ */
  reveal(root) {
    FX.revealIO?.disconnect();
    if (FX.calm || !('IntersectionObserver' in window)) return;
    const io = FX.revealIO = new IntersectionObserver(list => {
      let n = 0;
      list.forEach(e => {
        if (!e.isIntersecting) return;
        e.target.style.setProperty('--rv-d', `${Math.min(n++, 6) * 55}ms`);
        e.target.classList.replace('rv', 'rv-in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -5% 0px' });
    root.querySelectorAll('.sec, .item, .link-card, .sister, .news li, .rows li, .dine details, .rewards li, .hist li, .orders li, .coupon, .cat-note, .home-foot').forEach(el => {
      el.classList.add('rv');
      io.observe(el);
    });
  },

  /** ホームの写真を、スクロールより少しゆっくり動かす */
  parallax() {
    if (FX.calm) return;
    let wait = false;
    addEventListener('scroll', () => {
      if (wait) return;
      wait = true;
      requestAnimationFrame(() => {
        wait = false;
        const img = document.querySelector('.hero > img');
        if (img && scrollY < 400) img.style.translate = `0 ${Math.round(scrollY * 0.28)}px`;
      });
    }, { passive: true });
  },

  /** 押したところから波紋を広げる（ボタン・カード） */
  ripples() {
    if (FX.calm) return;
    addEventListener('pointerdown', e => {
      const el = e.target.closest?.('.btn, .quick-btn, .link-card, .item, .cats button, .chip, .slot, .tabs a, .r-cal-move, .mode');
      if (!el || el.disabled) return;
      el.classList.add('fx-host');
      const b = el.getBoundingClientRect(), r = Math.max(b.width, b.height);
      const s = document.createElement('span');
      s.className = 'fx-rip';
      s.style.cssText = `left:${e.clientX - b.left - r / 2}px;top:${e.clientY - b.top - r / 2}px;width:${r}px;height:${r}px`;
      s.addEventListener('animationend', () => s.remove());
      el.append(s);
    }, { passive: true });
  },

  /** 商品の写真を、カートのところまで飛ばす */
  fly(from, to) {
    if (FX.calm || !from || !to) return;
    const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    if (!a.width || !b.width) return;
    const size = 72, im = document.createElement('img');
    im.src = from.currentSrc || from.src || 'img/logo.png';
    im.className = 'fx-fly';
    im.style.cssText = `left:${a.left + a.width / 2 - size / 2}px;top:${a.top + a.height / 2 - size / 2}px;width:${size}px;height:${size}px`;
    document.body.append(im);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
    im.animate([
      { transform: 'translate(0, 0) scale(1.5) rotate(0)', opacity: 1 },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.35 - 40}px) scale(1) rotate(-12deg)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(.2) rotate(-24deg)`, opacity: .4 },
    ], { duration: 650, easing: 'cubic-bezier(.4, 0, .4, 1)' }).onfinish = () => {
      im.remove();
      to.classList.remove('fx-bump'); void to.offsetWidth; to.classList.add('fx-bump');
    };
  },

  /** メニューの上のボタンのうち、いま見ている見出しのものを光らせる */
  spy(nav) {
    FX.spyIO?.disconnect();
    if (!nav || !('IntersectionObserver' in window)) return;
    const mark = id => {
      nav.querySelectorAll('button').forEach(b => {
        const on = b.dataset.arg === id;
        if (on && !b.classList.contains('on')) nav.scrollTo({ left: b.offsetLeft - 16, behavior: FX.calm ? 'auto' : 'smooth' });
        b.classList.toggle('on', on);
      });
    };
    FX.spyIO = new IntersectionObserver(list => list.forEach(e => { if (e.isIntersecting) mark(e.target.id.replace('cat-', '')); }), { rootMargin: '-30% 0px -65% 0px' });
    const secs = document.querySelectorAll('.cat-sec');
    if (secs[0]) mark(secs[0].id.replace('cat-', ''));   // 開いたときは、いちばん上の見出し
    secs.forEach(s => FX.spyIO.observe(s));
  },
};

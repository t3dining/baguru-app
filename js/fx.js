/* =====================================================================
 *  演出（紙ふぶき・ハート・数字が増える・炭火の火の粉）
 *  2026-10-30 ko-dai さんの指示：「デザインがチープなので、装飾やアニメーションを増やす。ポイントがたまるときも面白く」
 *  ・外のライブラリは使わない（画面いっぱいの canvas に描いて、終わったら消す）
 *  ・スマホの設定で「動きを減らす」にしている人には、動かさない（FX.calm。app.css の最後でも、動きを止めている）
 * ===================================================================== */

const FX = {
  calm: !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  // ロゴのピンク・金・クリーム・こげ茶
  colors: ['#d24f78', '#e8789a', '#c9973f', '#f3c96b', '#fff6e8', '#4b2a1b'],

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

  /** 数字を from から to へ、少しずつ増やして見せる（終わると、ぽんとはねる） */
  count(el, from, to, ms = 650) {
    if (!el) return;
    if (FX.calm || from === to) { el.textContent = to; return; }
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
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
};

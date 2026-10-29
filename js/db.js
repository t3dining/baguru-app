/* =====================================================================
 *  保存するところ
 *
 *  ★試作のあいだは、ブラウザの中（localStorage）に保存します。
 *    お客さまの画面（index.html）とお店の画面（order.html）を同じブラウザで開くと、
 *    同じ保存場所を見るので、注文が届く様子を1台で試せます。
 *  ★本番では、ここをサーバー（Google Apps Script など）とのやりとりに差し替えます。
 *    画面の側は DB.get / DB.set / DB.onChange だけを使うので、ほかは直さずに済みます。
 * ===================================================================== */

const DB = {
  prefix: 'bg.',

  get(key, fallback) {
    try {
      const v = localStorage.getItem(this.prefix + key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  },

  set(key, value) {
    try { localStorage.setItem(this.prefix + key, JSON.stringify(value)); } catch (e) { /* 保存できない端末では、その場だけ動く */ }
  },

  /** ほかのタブ（お店の画面など）が書き換えたら知らせる */
  onChange(fn) {
    window.addEventListener('storage', e => {
      if (e.key && e.key.startsWith(this.prefix)) fn(e.key.slice(this.prefix.length));
    });
  },

  /** 試作のデータを全部消す */
  clearAll() {
    try {
      Object.keys(localStorage).filter(k => k.startsWith(this.prefix)).forEach(k => localStorage.removeItem(k));
    } catch (e) { /* 何もしない */ }
  },
};

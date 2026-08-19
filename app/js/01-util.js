/* js/01-util.js — LC.util(仕様 §5-1)と LC.msg(仕様 §5-2)
 *
 * このファイルは全ファイルの土台。**他のどのモジュールにも依存しない。**
 * DOM の id は index.html(仕様 §4)で確定しているものだけを参照する:
 *   #statusRegion / #toastArea / #main
 *
 * 言葉の規律(仕様 §0-1。好みではなく仕様):
 *   「発音採点」「発音が間違っています」「不合格」は使わない。
 *   「伝わり度」「◯語中◯語が伝わりました」「もう一度ためしてみましょう」を使う。
 *   このアプリが測れるのは「Google の認識器に伝わったか」だけであり、発音の良し悪しではない。
 *
 * Liquid(GitHub Pages / Jekyll)対策で、二重波かっこ・波かっこ+パーセントの並びを
 * ファイル内に一切書かない。そのため文言の変数記法は %{name} を使う。
 */
window.LC = window.LC || {};
(function (LC) {
  'use strict';

  /* ============================================================
   * 1. LC.util — DOM ヘルパ・小道具
   * ============================================================ */

  /** キャメルケース → ケバブケース(data-* 属性名の生成に使う) */
  function kebab(s) {
    return String(s).replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); });
  }

  /**
   * 子ノードの追加。文字列 / 数値 / 要素 / 配列 / null を受け付ける。
   * 文字列は必ず createTextNode を通すので、外部由来の文字列でも HTML として解釈されない。
   */
  function appendChild(el, child) {
    if (child === null || child === undefined || child === false || child === true) return;
    if (Array.isArray(child)) {
      for (var i = 0; i < child.length; i++) appendChild(el, child[i]);
      return;
    }
    if (child.nodeType) { el.appendChild(child); return; }
    el.appendChild(document.createTextNode(String(child)));
  }

  /** class の値(文字列 / 配列 / null 混在)を 1 本の文字列にまとめる */
  function classString(v) {
    if (Array.isArray(v)) {
      return v.filter(function (x) { return x !== null && x !== undefined && x !== false && x !== ''; })
              .join(' ');
    }
    return v === null || v === undefined || v === false ? '' : String(v);
  }

  /** 属性を 1 つ設定。false / null / undefined は「付けない」、true は空文字属性。 */
  function setAttr(el, name, value) {
    if (value === null || value === undefined || value === false) { el.removeAttribute(name); return; }
    if (value === true) { el.setAttribute(name, ''); return; }
    el.setAttribute(name, String(value));
  }

  /**
   * 要素生成。
   * @param {string} tag
   * @param {object|string|Node|Array|null} props
   *        {class, text, html, attrs:{}, on:{}, aria:{}, data:{}, style, ...その他は属性}
   *        props の位置に文字列 / 要素 / 配列が来た場合は「最初の子」として扱う(呼び出し側の事故防止)。
   * @param {...*} children  文字列 / 要素 / 配列 / null
   * @returns {HTMLElement}
   *
   * ★ text は textContent、html は innerHTML。
   *   認識結果・自作デッキ・音声名など**外部由来の文字列には必ず text を使う**。
   *   html はこのアプリでは原則使わない(使ってよいのは自分で組み立てた定数 HTML だけ)。
   */
  function h(tag, props) {
    var el = document.createElement(tag);
    var children = Array.prototype.slice.call(arguments, 2);
    if (props && (typeof props === 'string' || typeof props === 'number' ||
                  props.nodeType || Array.isArray(props))) {
      children.unshift(props);
      props = null;
    }
    if (props) {
      for (var key in props) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
        var v = props[key];
        if (v === undefined) continue;
        if (key === 'class' || key === 'className') {
          var cs = classString(v);
          if (cs) el.setAttribute('class', cs);
        } else if (key === 'text') {
          el.textContent = v === null ? '' : String(v);
        } else if (key === 'html') {
          el.innerHTML = v === null ? '' : String(v);
        } else if (key === 'attrs') {
          for (var a in v) if (Object.prototype.hasOwnProperty.call(v, a)) setAttr(el, a, v[a]);
        } else if (key === 'aria') {
          for (var ar in v) {
            if (!Object.prototype.hasOwnProperty.call(v, ar)) continue;
            var an = ar.indexOf('aria-') === 0 ? ar : 'aria-' + kebab(ar);
            setAttr(el, an, v[ar]);
          }
        } else if (key === 'data') {
          for (var d in v) {
            if (!Object.prototype.hasOwnProperty.call(v, d)) continue;
            setAttr(el, 'data-' + kebab(d), v[d]);
          }
        } else if (key === 'on') {
          for (var ev in v) {
            if (!Object.prototype.hasOwnProperty.call(v, ev)) continue;
            var fns = Array.isArray(v[ev]) ? v[ev] : [v[ev]];
            for (var fi = 0; fi < fns.length; fi++) {
              if (typeof fns[fi] === 'function') el.addEventListener(ev, fns[fi]);
            }
          }
        } else if (key === 'style' && v && typeof v === 'object') {
          for (var sp in v) if (Object.prototype.hasOwnProperty.call(v, sp)) el.style[sp] = v[sp];
        } else {
          /* id / type / href / disabled / hidden などはそのまま属性にする */
          setAttr(el, key, v);
        }
      }
    }
    appendChild(el, children);
    return el;
  }

  /** DocumentFragment を作る。複数要素をまとめて返したいときに使う。 */
  function frag(children) {
    var f = document.createDocumentFragment();
    appendChild(f, children);
    return f;
  }

  /** querySelector。セレクタが不正でも例外を投げず null を返す。 */
  function qs(sel, root) {
    try { return (root || document).querySelector(sel); } catch (e) { return null; }
  }

  /** querySelectorAll。**配列**を返す(NodeList ではない)。 */
  function qsa(sel, root) {
    try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
    catch (e) { return []; }
  }

  /** 子要素を全部消す。innerHTML='' より安全(イベント付き要素の参照を残さない)。 */
  function clear(el) {
    if (!el) return el;
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  /** Promise<void>。reject しない。 */
  function sleep(ms) {
    var wait = Number(ms);
    if (!isFinite(wait) || wait < 0) wait = 0;
    return new Promise(function (resolve) { setTimeout(resolve, wait); });
  }

  /** lo〜hi に丸める。数値でない値は lo にする(NaN が UI に漏れないように)。 */
  function clamp(x, lo, hi) {
    var n = Number(x);
    if (lo > hi) { var t = lo; lo = hi; hi = t; }
    if (!isFinite(n)) return lo;
    return n < lo ? lo : (n > hi ? hi : n);
  }

  /** lo 以下で 0、hi 以上で 1 の線形補間。スコアの partial(仕様 §5-10)で使う。 */
  function ramp(x, lo, hi) {
    var n = Number(x);
    if (!isFinite(n)) return 0;
    if (hi <= lo) return n >= hi ? 1 : 0;
    return clamp((n - lo) / (hi - lo), 0, 1);
  }

  /** HTML エスケープ。原則は h() の text を使い、これは診断テキストなどの保険。 */
  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* --- スクリーンリーダー通知 ------------------------------------------- */

  var announceTimer = null;

  /**
   * #statusRegion(role="status" aria-live="polite")に文言を流す。
   * ★ 一度空にしてから次の tick で入れる。
   *   同じ文言を連続で入れると DOM が変化せず、読み上げられないため。
   */
  function announce(text) {
    var el = document.getElementById('statusRegion');
    if (!el) return false;
    var s = text === null || text === undefined ? '' : String(text);
    el.textContent = '';
    if (announceTimer) clearTimeout(announceTimer);
    announceTimer = setTimeout(function () {
      announceTimer = null;
      el.textContent = s;
    }, 60);
    return true;
  }

  /* --- トースト --------------------------------------------------------- */

  var TOAST_MAX = 3;

  /**
   * #toastArea に .toast を積む。自動消滅。同時表示は最大 3 件。
   * @param {string} text
   * @param {object} [opts] type: 'info'|'warn'|'error' / ms: number / announce: boolean
   * @returns {function} 手動で消すための関数(要素が作れなかった場合も no-op 関数を返す)
   */
  function toast(text, opts) {
    opts = opts || {};
    var s = text === null || text === undefined ? '' : String(text);
    var type = opts.type || 'info';
    var ms = typeof opts.ms === 'number' && isFinite(opts.ms) ? opts.ms : 3200;

    /* トーストは仕様 §12-2 の「アナウンスする」側。明示的に切りたいときだけ announce:false。 */
    if (opts.announce !== false) announce(s);

    var area = document.getElementById('toastArea');
    if (!area || !s) return function () {};

    while (area.children.length >= TOAST_MAX && area.firstChild) {
      area.removeChild(area.firstChild);
    }

    var el = h('div', {
      class: ['toast', type && type !== 'info' ? 'toast--' + type : null],
      text: s,
      attrs: { 'data-toast-type': type }
    });
    var timer = null;
    function dismiss() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    el.addEventListener('click', dismiss);
    area.appendChild(el);
    if (ms > 0) timer = setTimeout(dismiss, ms);
    return dismiss;
  }

  /* --- フォーカス ------------------------------------------------------- */

  /**
   * #main へフォーカスを移す(画面遷移のたびに呼ぶ。仕様 §12-1)。
   * @param {object} [opts] scroll:false で先頭スクロールを抑制
   */
  function focusMain(opts) {
    var el = document.getElementById('main');
    if (!el) return false;
    try { el.focus({ preventScroll: true }); }
    catch (e) { try { el.focus(); } catch (e2) { /* 握り潰す(公開関数は例外を投げない) */ } }
    if (!opts || opts.scroll !== false) {
      try { window.scrollTo(0, 0); } catch (e3) {}
    }
    return true;
  }

  /* --- クリップボード --------------------------------------------------- */

  /** textarea + execCommand('copy') によるフォールバック。戻り値は成否。 */
  function execCommandCopy(s) {
    var prev = document.activeElement;
    var ta = document.createElement('textarea');
    ta.value = s;
    ta.setAttribute('readonly', '');
    ta.setAttribute('aria-hidden', 'true');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.width = '1px';
    ta.style.height = '1px';
    ta.style.padding = '0';
    ta.style.border = 'none';
    ta.style.opacity = '0';
    var ok = false;
    try {
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { ta.setSelectionRange(0, s.length); } catch (e) {}
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    try { if (ta.parentNode) ta.parentNode.removeChild(ta); } catch (e) {}
    try { if (prev && prev.focus) prev.focus(); } catch (e) {}
    return !!ok;
  }

  /**
   * クリップボードへコピー。**reject しない。** Promise<boolean>。
   * navigator.clipboard は file:// や権限なしで失敗するので必ずフォールバックする。
   */
  function copyText(text) {
    var s = text === null || text === undefined ? '' : String(text);
    return new Promise(function (resolve) {
      var done = false;
      function finish(ok) { if (!done) { done = true; resolve(!!ok); } }
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(s).then(
            function () { finish(true); },
            function () { finish(execCommandCopy(s)); }
          );
          /* clipboard API が settle しない環境の保険 */
          setTimeout(function () { if (!done) finish(execCommandCopy(s)); }, 1500);
          return;
        }
      } catch (e) { /* 続けてフォールバックへ */ }
      finish(execCommandCopy(s));
    });
  }

  /* --- 日付・時間 ------------------------------------------------------- */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function toDate(ms) {
    var d = (ms === null || ms === undefined) ? new Date() : new Date(Number(ms));
    return isFinite(d.getTime()) ? d : new Date();
  }

  /** 'YYYY/MM/DD HH:MM'(ローカル時刻)。履歴・診断表示用。 */
  function fmtDate(ms) {
    var d = toDate(ms);
    return d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) +
           ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /** 'M/D(曜)'。週次グラフの軸ラベル用。 */
  var WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];
  function fmtDay(ms) {
    var d = toDate(ms);
    return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WEEKDAY_JA[d.getDay()] + ')';
  }

  /** 'YYYY-MM-DD'(ローカル日付)。引数なしで今日。 */
  function todayKey(ms) {
    var d = toDate(ms);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /**
   * 1970-01-01 起点の日数(**ローカルの暦日**)。wordstats の t に使う。
   * UTC 換算にすると日本時間の朝が前日扱いになるので、ローカル日付から組み立てる。
   */
  function epochDay(ms) {
    var d = toDate(ms);
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  }

  /** '6 分 12 秒' / '42 秒' / '1 時間 3 分' */
  function fmtDuration(ms) {
    var total = Math.round(Number(ms) / 1000);
    if (!isFinite(total) || total < 0) total = 0;
    var hh = Math.floor(total / 3600);
    var mm = Math.floor((total % 3600) / 60);
    var ss = total % 60;
    if (hh > 0) return hh + ' 時間 ' + mm + ' 分';
    if (mm > 0) return mm + ' 分 ' + ss + ' 秒';
    return ss + ' 秒';
  }

  /* --- 診断ログ(リングバッファ) --------------------------------------- */

  var LOG_MAX = 40;
  var logBuf = [];

  /** ログに載せる値を直列化可能な形へ落とす(診断コピーが必ず成功するように)。 */
  function safeData(obj) {
    if (obj === undefined) return null;
    if (obj === null) return null;
    if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') return obj;
    if (obj instanceof Error) return { name: obj.name, message: obj.message };
    try {
      var s = JSON.stringify(obj);
      if (typeof s !== 'string') return String(obj).slice(0, 400);
      /* 長すぎるものは「文字列」として保持する。切り詰めた JSON は parse できないため。 */
      if (s.length > 600) return s.slice(0, 600) + '…';
      return JSON.parse(s);
    } catch (e) {
      try { return String(obj).slice(0, 400); } catch (e2) { return '[unserializable]'; }
    }
  }

  /** 直近 40 件のリングバッファ。診断画面がダンプする。 */
  function log(tag, obj) {
    var entry = { at: Date.now(), tag: String(tag), data: safeData(obj) };
    logBuf.push(entry);
    if (logBuf.length > LOG_MAX) logBuf.shift();
    return entry;
  }

  /** ログの配列(コピー)を返す。 */
  function getLog() { return logBuf.slice(); }

  /** ログを 1 枚のテキストにする(診断結果コピー用)。 */
  function getLogText() {
    return logBuf.map(function (e) {
      var d = new Date(e.at);
      var head = pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
      var body;
      try { body = e.data === null ? '' : JSON.stringify(e.data); }
      catch (err) { body = '[unserializable]'; }
      return head + ' [' + e.tag + '] ' + body;
    }).join('\n');
  }

  function clearLog() { logBuf.length = 0; }

  /* --- その他 ----------------------------------------------------------- */

  var uidCounter = 0;
  /** DOM id を作る(aria-describedby / label for の結線用)。 */
  function uid(prefix) {
    uidCounter += 1;
    return (prefix || 'lc') + '-' + uidCounter;
  }

  LC.util = {
    h: h,
    frag: frag,
    qs: qs,
    qsa: qsa,
    clear: clear,
    sleep: sleep,
    clamp: clamp,
    ramp: ramp,
    escapeHtml: escapeHtml,
    announce: announce,
    toast: toast,
    focusMain: focusMain,
    copyText: copyText,
    fmtDate: fmtDate,
    fmtDay: fmtDay,
    todayKey: todayKey,
    epochDay: epochDay,
    fmtDuration: fmtDuration,
    log: log,
    getLog: getLog,
    getLogText: getLogText,
    clearLog: clearLog,
    uid: uid
  };

  /* ============================================================
   * 2. LC.msg — 日本語文言(仕様 §5-2)
   *    ユーザーに見せる日本語はここに集約する。画面ファイルに直書きしない。
   * ============================================================ */

  /* 公開ページの URL。★リポジトリを Pages で公開したらここを実 URL に差し替える。 */
  /* 公開 URL。GitHub Pages のリポジトリ名を変えたらここも直すこと。
     99-app.js 側にも同じ値があり、万一ここが古いままでも起動時に上書きされる。 */
  var PAGES_URL = 'https://kazuyan38.github.io/languageclub/app/';
  var CHROME_URL = 'https://www.google.com/chrome/';
  /* JS からは開けないので、コピーボタン付きテキストとして見せる(仕様 §5-2)。 */
  var MIC_SETTINGS_URL = 'chrome://settings/content/microphone';

  var MIC_HOWTO = 'アドレスバー左の 🔒 →「マイク」→「許可する」に変更し、ページを再読み込みしてください。';

  /* --- UI 文言 ---------------------------------------------------------- */

  var UI = {

    /* 全画面共通 */
    common: {
      appName: 'つたわる English',
      tagline: '英語を声に出す回数を増やすための練習アプリ',
      skipToMain: '本文へスキップ',
      home: 'ホームへ',
      back: 'もどる',
      next: 'つぎへ',
      prev: 'まえへ',
      close: '閉じる',
      cancel: 'やめる',
      ok: 'わかりました',
      yes: 'はい',
      no: 'いいえ',
      add: '追加する',
      edit: '編集',
      remove: '消す',
      save: '保存する',
      copy: 'コピー',
      copied: 'コピーしました。',
      copyFailed: 'コピーできませんでした。テキストを選んでコピーしてください。',
      loading: '読み込み中…',
      navStats: 'きろく',
      navSettings: 'せってい',
      navHelp: '使い方と診断',
      demoBadge: '体験モード',
      demoNotice: '体験モードです。練習の記録はこの端末に保存されません。',
      headphoneTip: '🎧 イヤホンの使用をおすすめします',
      localOnlyNotice: 'この記録はこのパソコンに保存されています。',
      tsutawari: '伝わり度',
      /* 「不合格 / 失敗」を使わないための共通の言い換え(仕様 §0-1) */
      tryAgain: 'もう一度ためしてみましょう。',
      phraseCount: '%{n} フレーズ',
      deckProgress: '%{done} / %{total}',
      deckProgressAria: '%{total} 問中 %{done} 問クリア'
    },

    /* エラーパネル・警告帯のボタンラベル。
       ASR_ERRORS / TTS_ERRORS / BLOCKERS の actions[] のキーと 1 対 1 で対応する。 */
    actions: {
      retry: 'もう一度ためす',
      diagnostics: '使い方と診断を見る',
      reload: 'ページを再読み込み',
      'permission-howto': 'マイクの許可のしかた',
      settings: 'せっていを開く',
      'browse-only': '音声なしでフレーズ集を見る',
      'copy-url': '公開ページのアドレスをコピー',
      'chrome-download': 'Chrome のダウンロードページ',
      dismiss: '閉じる'
    },

    /* 7-1. オンボーディング(初回のみ・3 画面) */
    onboarding: {
      stepAria: 'ステップ %{n} / 3',
      step1: {
        icon: '🎤',
        title: '英語を声に出して練習しよう',
        body: 'お手本を聞いて、そのまま英語で言ってみる。パソコンの「耳」がどこまで聞き取れたかを、その場で見せます。',
        note: '※ このアプリが測るのは「発音の良し悪し」ではなく「機械に伝わったか」です。機械に伝わる発音は、人間にもだいたい伝わります。',
        next: 'つぎへ →'
      },
      step2: {
        icon: '📡',
        title: '話した声は Google の音声認識サーバーに送られます',
        body: 'Chrome の音声認識は、インターネット経由で Google のサーバーが文字にしています。',
        bullets: [
          '録音データはこのアプリには保存されません',
          '学習の記録はこの端末の中だけに残ります',
          'インターネットに繋がっていないと音声認識は使えません'
        ],
        agree: '同意して続ける',
        decline: 'やめる',
        declined: 'マイクを使わずに、フレーズ集と和訳だけを見ることもできます。'
      },
      step3: {
        icon: '🎧',
        title: 'イヤホンをつけるのがおすすめです',
        body: 'スピーカーだと、お手本の読み上げをマイクが拾ってしまうことがあります。',
        allow: 'マイクの使用を許可する',
        allowing: '許可を確認しています…',
        allowed: 'マイクを使えるようになりました。声を出すとメーターが動きます。',
        denied: 'マイクの使用が許可されませんでした。あとから「使い方と診断」でやり直せます。',
        notFound: 'マイクが見つかりませんでした。接続を確認してから、もう一度お試しください。',
        meterLabel: 'マイクの入力レベル',
        skip: 'あとで設定する',
        start: 'はじめる'
      }
    },

    /* 7-2. ホーム */
    home: {
      greeting: 'こんにちは。今日は %{n} 文 話しました。',
      greetingZero: 'こんにちは。今日はまだ話していません。',
      streak: '連続 %{n} 日',
      decksTitle: 'カテゴリをえらぶ',
      addDeck: '自分でフレーズを追加する',
      deckCleared: '完了',
      deckClearedAria: 'このカテゴリはクリア済み',
      resume: 'つづきから',
      custom: '自作',
      empty: '教材を読み込めませんでした。「使い方と診断」で確認してください。',
      firstTime: 'まずは「自己紹介」から試してみましょう。'
    },

    /* 7-3. 練習画面 */
    practice: {
      counter: '%{i} / %{n}',
      counterAria: '%{n} 問中 %{i} 問め',
      deckAria: 'カテゴリ: %{title}',
      backToHome: 'ホームへもどる',

      btnStart: 'お手本を聞いて、話す',
      btnSpeaking: '🔊 読み上げ中…',
      btnGuard: 'まもなく録音します…',
      btnListening: '🔴 どうぞ、話してください',
      btnStop: '■ 話し終わり',
      btnScoring: '聞き取った文をたしかめています…',
      btnBlocked: '音声を使えません',
      btnPlayModel: 'お手本だけ',
      btnSlow: 'ゆっくり',
      btnListenOnly: '話すだけ',
      btnRetry: 'もう一度',
      btnNext: '次へ',
      btnPrev: '前へ',
      btnExclude: 'うまく拾えなかった(この回を記録から除く)',
      btnFinish: 'このカテゴリを終える',

      keyHintSpace: 'Space',
      keyHintRetry: 'R',
      keyHelp: 'Space: 話す / R: もう一度 / S: ゆっくり / N: 次へ / P: 前へ / X: 除く / Esc: 停止',

      attemptsAria: '%{max} 回中 %{n} 回、機械に伝わりました',
      remainSeconds: '残り %{n} 秒で自動終了',
      interimLabel: '聞き取り中の文字',
      levelLabel: 'マイクの入力レベル',
      tooQuiet: '⚠ 音が小さいようです。マイクに近づいてください',

      noSpeech: '声が聞こえませんでした。もう一度どうぞ。',
      timeout: '時間切れになりました。もう一度どうぞ。',
      manualListen: '「話すだけ」を押してから話してください。',
      /* 直前の録音の後始末が終わる前にもう一度押されたとき。無言で戻すと押しそこねたように見える。 */
      stillBusy: '前の録音を片付けています。少し待ってからもう一度押してください。',
      excluded: 'この回を記録から除きました。',
      ttsUnavailable: '読み上げが使えないため、文字だけで練習します。',
      ttsUnstable: '読み上げが不安定です。せっていで別の声をお試しください。',

      annSpeaking: '読み上げ中です。',
      annListening: '録音中です。話してください。',
      annScoring: 'たしかめています。',
      annReview: '結果が出ました。',
      annStopped: '停止しました。',

      cleared: 'クリアしました。',
      deckComplete: 'このカテゴリは終わりです。おつかれさまでした。',
      notFound: 'このカテゴリは見つかりませんでした。'
    },

    /* 7-3 (D). 結果表示。表示順序は 事実 → 詳細 → 総括 → テキスト要約 → 次の行動(仕様 §7-3) */
    result: {
      heardTitle: '聞こえた文',
      heardEmpty: '(何も聞き取れませんでした)',
      modelTitle: 'お手本',
      /* バンド名とコメントは LC.score.BANDS(仕様 §5-10)が持つ。ここでは重複させない。 */
      plain: '%{total} 語中 %{n} 語が伝わりました',
      scoreLine: '%{n} 点',
      scorePrev: '前回 %{prev} → %{delta}',
      scoreHidden: '点数はせっていで表示できます。',

      deletedLabel: '抜けた語',
      substitutedLabel: '違って聞こえた語',
      insertedLabel: '余分に聞こえた語',
      none: 'なし',
      wordPair: '%{ref} → %{hyp}',
      hint: 'ヒント: %{text}',
      heardAs: '%{word} と聞き取られました',
      homophoneNote: '同音のため正解',

      stateCorrect: '伝わりました',
      stateHomophone: '同音のため正解',
      stateNear: '惜しい',
      stateSubstitution: '別の語に聞こえました',
      stateDeletion: '聞き取られませんでした',
      stateInsertion: '余分に聞こえました',
      wordAria: '%{word}、%{state}。%{heard} と聞き取られました',
      wordAriaPlain: '%{word}、%{state}',

      passRemain: 'あと %{n} 回通じればクリア',
      passCleared: '%{total} 回中 %{n} 回、機械に伝わりました。クリア!',
      passOut: 'この回はここまでです。%{again}',
      retryPrompt: 'もう一度ためしてみましょう。'
    },

    /* 7-4. サマリ */
    summary: {
      icon: '🎉',
      title: '%{deck} おつかれさま',
      attempts: '話した回数 %{n} 回',
      cleared: 'クリア %{n} / %{total}',
      duration: '%{text}',
      troubleTitle: '通じにくかった語',
      troubleRow: '%{word}  %{attempts} 回中 %{pass} 回  →「%{heard}」',
      troubleRowNoHeard: '%{word}  %{attempts} 回中 %{pass} 回',
      noTrouble: '通じにくかった語はありませんでした。',
      again: 'もう一度このカテゴリ',
      home: 'ホームへ',
      notSaved: '体験モードのため、この結果は保存されていません。'
    },

    /* 7-5. きろく */
    stats: {
      title: 'きろく',
      weekTitle: '今週',
      weekLine: '話した回数 %{utterances} / 練習した日 %{days} 日 / 語数 %{words}',
      streak: '連続 %{n} 日',
      chartAria: '直近 7 日の話した回数',
      chartDayAria: '%{day} %{n} 回',
      troubleTitle: 'あなたが通じにくい語',
      troubleRow: '%{word}  %{rate}%(%{attempts}回)  →よく「%{heard}」',
      troubleRowNoHeard: '%{word}  %{rate}%(%{attempts}回)',
      troubleEmpty: 'まだ十分なデータがありません。3 回以上練習した語から表示されます。',
      focusTitle: '苦手な音',
      focusRow: '%{label}(%{n} 語)',
      focusEmpty: 'まだ集計できる音がありません。',
      deckTitle: 'カテゴリ別',
      historyTitle: '最近の練習',
      historyRow: '%{date}  %{deck}  %{attempts} 回',
      clear: '記録をすべて消す',
      clearConfirm: '本当にすべての記録を消しますか？元にはもどせません。',
      clearConfirmBtn: 'もう一度押すと消えます',
      cleared: '記録を消しました。',
      /* 体験モードや readonly では localStorage に触らないので実際には消えない。黙って戻さない。 */
      clearFailed: 'この画面では記録を消せませんでした。体験モード(?demo=1)を外して開き直してください。',
      empty: 'まだ記録がありません。練習を始めると、ここに出てきます。',
      localOnly: 'この記録はこのパソコンに保存されています。共有のパソコンでは「体験モード」をお使いください。'
    },

    /* 7-6. せってい */
    settings: {
      title: 'せってい',
      voiceTitle: '読み上げの声',
      voiceOffline: 'オフラインで使える声',
      voiceOnline: 'インターネットが必要な声(高品質)',
      voiceNone: '英語の読み上げ音声が見つかりません。文字だけで練習できます。',
      voiceLoading: '声を読み込んでいます…',
      voiceTest: '🔊 試し聞き',
      voiceTestText: 'Hello. Nice to meet you.',
      rateTitle: '読み上げの速さ',
      rateSlow: '🐢 ゆっくり',
      rateNormal: '● ふつう',
      rateFast: '🐇 速め',
      langTitle: '認識する英語',
      langUS: 'アメリカ英語(en-US)',
      langGB: 'イギリス英語(en-GB)',
      displayTitle: '表示',
      showScore: '点数(0〜100)を表示する',
      autoListen: '読み上げのあと自動で録音を始める',
      saveRecords: '学習の記録をこの端末に保存する',
      saveRecordsOff: 'これからの練習は記録されません。すでにある記録は残ります。',
      themeTitle: 'テーマ',
      themeAuto: '自動',
      themeLight: 'ライト',
      themeDark: 'ダーク',
      helpLink: '使い方と困ったとき(診断)',
      saved: 'せっていを保存しました。',
      notSaved: '体験モードのため、せっていは保存されません。'
    },

    /* 7-7. 使い方 / 診断 */
    help: {
      title: '使い方と困ったとき',
      howtoTitle: '使い方',
      steps: [
        'カテゴリをえらぶ',
        '「お手本を聞いて、話す」を押す',
        '読み上げが終わったら、同じ文を英語で言う',
        'どの語が伝わったかを見て、もう一度ためす'
      ],
      tipsTitle: 'うまくいかないときは',
      tips: [
        '静かな場所で、マイクに近づいて話してください。',
        'イヤホンを使うと、お手本の音をマイクが拾わなくなります。',
        '短く区切らず、文の最後まで一息で言うほうが認識されやすくなります。',
        '機械が拾えなかっただけのときは「うまく拾えなかった」で記録から外せます。'
      ],
      checkTitle: '動作チェック',
      rowProtocol: 'ページの配信方法',
      rowRecognition: '音声認識 API',
      rowSynthesis: '読み上げ API',
      rowVoices: '英語の読み上げ音声',
      rowMic: 'マイクの許可',
      rowStorage: '記録の保存',
      rowOnline: 'インターネット',
      rowBrowser: 'ブラウザ',
      valOk: '使えます',
      valNg: '使えません',
      valGranted: '許可済み',
      valDenied: '拒否されています',
      valPrompt: 'まだ確認していません',
      valUnknown: 'わかりません',
      valOnline: '接続中',
      valOffline: '未接続',
      valVoices: '%{n} 個(オフライン %{offline})',
      valStorageOk: '使えます(%{size})',
      valStorageMemory: 'この端末には保存されません',
      valStorageReadonly: '読み取りのみ',
      testTts: '🔊 読み上げテスト',
      testMic: '🎤 マイクテスト(5秒)',
      testAsr: '🗣「Hello」認識テスト',
      testTtsText: 'Hello. This is a test of the reading voice.',
      testAsrPrompt: '「Hello」と話してください。',
      testAsrOk: '「%{text}」と聞き取れました。',
      testAsrNg: '聞き取れませんでした。',
      testMicRunning: 'マイクを確認しています。何か話してみてください。',
      testMicOk: 'マイクは動いています(最大レベル %{peak})。',
      testMicQuiet: '音がとても小さいようです。マイクの位置か音量を確認してください。',
      testMicNg: 'マイクを使えませんでした。',
      micHowtoTitle: 'マイクを許可するには',
      micHowto: MIC_HOWTO,
      micSettingsNote: '下のアドレスをコピーして、Chrome のアドレスバーに貼り付けてください。',
      micSettingsUrl: MIC_SETTINGS_URL,
      pagesTitle: '公開ページ',
      pagesNote: 'このアドレスを開くと、どのパソコンでも同じように使えます。',
      pagesUrl: PAGES_URL,
      deckErrorsTitle: '読み込めなかった教材',
      deckErrorRow: '%{deckId}: %{errors}',
      logTitle: '診断ログ(直近 40 件)',
      copyDiag: '診断結果をコピー',
      copiedDiag: '診断結果をコピーしました。LINE などに貼り付けて送れます。'
    },

    /* 7-8. 自作デッキ */
    decks: {
      title: '自分でフレーズを追加する',
      lead: '1 行につき 1 フレーズ。英文と日本語訳を「|」で区切ってください。',
      lead2: '1 行目に「# カテゴリ名」と書くと、名前を付けられます。',
      placeholder: '# 学祭でつかう英語\nWould you like to try our curry? | カレーはいかがですか？\nIt is three hundred yen. | 300 円です。',
      textareaLabel: '追加するフレーズ',
      add: '追加する',
      added: '「%{title}」を追加しました。',
      addFailed: '追加できませんでした。下の行を確認してください。',
      myDecksTitle: '作ったカテゴリ',
      deckRow: '%{title}(%{n} フレーズ)',
      edit: '編集',
      remove: '消す',
      removeConfirm: '「%{title}」を消しますか？元にはもどせません。',
      removed: '「%{title}」を消しました。',
      empty: 'まだ自作のカテゴリはありません。',
      exportBtn: '全部を文字にして書き出す(LINE で共有できます)',
      exported: '書き出したテキストをコピーしました。',
      exportEmpty: '書き出せる自作カテゴリがありません。',
      importBtn: '貼り付けて読み込む',
      importLabel: '書き出したテキスト',
      importPlaceholder: 'ここに書き出したテキストを貼り付けてください',
      imported: '%{n} 個のカテゴリを読み込みました。',
      importFailed: '読み込めませんでした。テキストが途中で切れていないか確認してください。',
      errorTitle: '直してほしい行',
      errorLine: '%{n} 行目: %{msg}',
      errEmptyText: '英文がありません',
      errNoToken: '英文として読み取れませんでした',
      errNoPhrase: 'フレーズが 1 つもありません。',
      warnLong: '長すぎると 1 回で言い切れません(%{n} 語)',
      demoBlocked: '体験モードでは自作カテゴリを保存できません。'
    },

    /* エラー・空状態まわりの共通文言(第 2 層・第 3 層。仕様 §10) */
    error: {
      fatalTitle: '予期しないエラーが発生しました',
      fatalBody: 'ページを再読み込みすると直ることがほとんどです。',
      fatalDetail: '詳細をコピー',
      bootTitle: 'ファイルの読み込みに失敗しました',
      bootBody: 'ページを再読み込みしてください。直らない場合は部のメンテ担当に連絡してください。',
      notFound: 'ページが見つかりませんでした。ホームへもどります。',
      detailToggle: '詳細',
      storageBroken: '保存されていた記録の一部を読み取れなかったため、初期化しました。',
      storageMemory: 'この端末では記録を保存できなくなりました。練習は続けられます。',
      storageReadonly: 'アプリが古い可能性があります。Ctrl+Shift+R で再読み込みしてください。',
      deckLoad: '読み込めなかった教材が %{n} 件あります。',
      micDenied: 'マイクの使用が許可されていません。',
      micNotFound: 'マイクが見つかりませんでした。',
      micBusy: '他のアプリがマイクを使っているようです。',
      browseOnly: '音声なしでフレーズ集を見る'
    }
  };

  /* --- ASR エラー(仕様 §5-2 の表をそのまま) ---------------------------
   * ★ SpeechRecognitionErrorEvent.message は Chrome では空文字なので絶対に使わない。
   *   分岐は event.error のみで行う。
   */
  var ASR_UNKNOWN = {
    fatal: false,
    title: 'うまく認識できませんでした',
    body: 'もう一度お試しください。',
    actions: ['retry', 'diagnostics']
  };

  var ASR_ERRORS = {
    'no-speech': {
      fatal: false,
      title: '音声が聞き取れませんでした',
      body: 'マイクに近づいて、もう一度話してみてください。',
      actions: ['retry']
    },
    /* silent: 自発的な abort()(停止ボタン・画面離脱)では何も表示しない。
       仕様 §5-14 の 'aborted' → phase = IDLE(何も表示しない)に対応する。 */
    'aborted': {
      fatal: false,
      silent: true,
      title: '認識が中断されました',
      body: '認識が中断されました。',
      actions: ['retry']
    },
    'audio-capture': {
      fatal: true,
      title: 'マイクを認識できませんでした',
      body: 'マイクが接続されているか、他のアプリ(Zoom・Teams など)がマイクを使っていないか確認してください。',
      actions: ['diagnostics', 'reload']
    },
    'network': {
      fatal: false,
      title: 'ネットワークに接続できませんでした',
      body: 'Chrome の音声認識にはインターネット接続が必要です。Wi-Fi をご確認ください。',
      actions: ['retry', 'diagnostics']
    },
    'not-allowed': {
      fatal: true,
      title: 'マイクの使用が許可されていません',
      body: MIC_HOWTO,
      actions: ['permission-howto', 'reload']
    },
    'service-not-allowed': {
      fatal: true,
      title: 'このブラウザでは音声認識が使えません',
      body: 'パソコンまたは Android の Google Chrome をご利用ください。',
      actions: []
    },
    'language-not-supported': {
      fatal: true,
      /* 仕様の {lang} は Liquid 誤認を避けるため %{lang} 記法にしてある */
      title: '選択された言語(%{lang})は使えません',
      body: '設定から「アメリカ英語(en-US)」を選び直してください。',
      actions: ['settings']
    },
    'bad-grammar': ASR_UNKNOWN,
    'phrases-not-supported': ASR_UNKNOWN,
    'unknown': ASR_UNKNOWN
  };

  /* --- TTS エラー(仕様 §10-4) -----------------------------------------
   * ★ 'canceled' / 'interrupted' は正常系。エラー表示をしてはいけない。
   *   停止ボタンのたびにエラーが出る典型バグを避けるため silent:true にしてある。
   */
  var TTS_ERRORS = {
    'end': { fatal: false, silent: true, title: '', body: '', actions: [] },
    'empty': { fatal: false, silent: true, title: '', body: '', actions: [] },
    'canceled': { fatal: false, silent: true, title: '', body: '', actions: [] },
    'interrupted': { fatal: false, silent: true, title: '', body: '', actions: [] },
    /* ウォッチドッグ発火。黙って GUARD に進む。3 回連続で 'unstable' を出す。 */
    'timeout': { fatal: false, silent: true, title: '', body: '', actions: [] },
    'not-allowed': {
      fatal: false,
      title: '読み上げを始められませんでした',
      body: '画面のボタンを押してから再生されます。もう一度「お手本を聞いて、話す」を押してください。',
      actions: ['retry']
    },
    'synthesis-failed': {
      fatal: false,
      title: '読み上げができませんでした',
      body: 'せっていで別の声をお試しください。読み上げなしでも、文字を見ながら練習できます。',
      actions: ['settings', 'diagnostics']
    },
    'no-voice': {
      fatal: false,
      title: '読み上げの音声が見つかりません',
      body: '英語の読み上げ音声がこの端末にないため、お手本を読み上げられません。文字を見ながらの練習は続けられます。',
      actions: ['settings', 'diagnostics']
    },
    'unstable': {
      fatal: false,
      title: '読み上げが不安定です',
      body: 'せっていで別の声(オフラインで使える声)をお試しください。',
      actions: ['settings']
    }
  };

  /* --- ブロッカー / 縮退(仕様 §10-2) -----------------------------------
   * severity: 'fatal'(非対応画面) / 'degrade'(機能を無効化して続行) / 'warn'(警告帯のみ)
   * banner  : ヘッダ下の警告帯用の短い文
   * title/body/actions: 全画面パネル・詳細表示用
   */
  var BLOCKERS = {
    'file-protocol': {
      severity: 'warn',
      fatal: false,
      banner: '⚠ ローカルで開いています(音声認識が使えないことがあります)',
      title: 'ローカルのファイルとして開いています',
      body: 'ファイルを直接開いた状態では、Chrome がマイクの使用を許可しないことがあります。教材の閲覧と読み上げはこのまま使えます。音声認識も使いたいときは、公開ページを開いてください。',
      actions: ['copy-url'],
      url: PAGES_URL
    },
    'no-recognition': {
      severity: 'fatal',
      fatal: true,
      banner: '⚠ このブラウザは音声認識に対応していません',
      title: 'このブラウザは音声認識に対応していません',
      body: 'パソコンの Google Chrome、または Android の Chrome でお試しください。音声を使わなくても、フレーズ集と和訳はこのまま読めます。',
      actions: ['browse-only', 'chrome-download'],
      url: CHROME_URL
    },
    'ios': {
      severity: 'fatal',
      fatal: true,
      /* ★ここに来るのは iPhone・iPad の Chrome / Firefox / Edge など。
         iOS の Safari だけは音声認識が使えるので、この画面には来ない(別扱い。ios-safari 警告帯を参照)。 */
      banner: '⚠ このブラウザでは音声認識が使えません',
      title: 'このブラウザでは音声認識が使えません',
      body: 'iPhone・iPad では、Safari 以外のブラウザ(Chrome・Firefox・Edge など)は音声認識のしくみが使えません。Safari で開くか、パソコンの Google Chrome でお試しください。フレーズ集と和訳はこのまま読めます。',
      actions: ['browse-only']
    },
    'insecure': {
      severity: 'fatal',
      fatal: true,
      banner: '⚠ 安全な接続(https)ではないため、マイクが使えません',
      title: 'https でアクセスしてください',
      body: 'アドレスの先頭が https:// になっていないため、マイクを使えません。下の公開ページのアドレスからお試しください。',
      actions: ['copy-url', 'browse-only'],
      url: PAGES_URL
    },
    'other-browser': {
      severity: 'fatal',
      fatal: true,
      banner: '⚠ 音声認識は Google Chrome でのみ動きます',
      title: 'Google Chrome でお使いください',
      body: '音声認識が動くのは今のところ Google Chrome だけです。Firefox・Edge・Safari では音声を使えません。フレーズ集と和訳はこのまま読めます。',
      actions: ['chrome-download', 'browse-only'],
      url: CHROME_URL
    },
    'no-english-voice': {
      severity: 'degrade',
      fatal: false,
      banner: '⚠ 英語の読み上げ音声が見つかりません(文字だけで練習できます)',
      title: '読み上げの音声が見つかりません',
      body: '英語の読み上げ音声がこの端末に入っていません。日本語の声で英語を読み上げるとカタカナ発音になってしまうため、読み上げを止めています。Windows は「設定 → 時刻と言語 → 言語と地域 → 英語を追加 → 音声」で追加できます。',
      actions: ['settings', 'diagnostics']
    },
    'no-storage': {
      severity: 'degrade',
      fatal: false,
      banner: '⚠ この端末では学習の記録を保存できません',
      title: '記録を保存できません',
      body: 'ブラウザの設定でデータの保存が制限されているようです。練習はこのまま続けられますが、ページを閉じると記録は消えます。',
      actions: ['diagnostics']
    },
    'storage-readonly': {
      severity: 'warn',
      fatal: false,
      banner: '⚠ アプリが古い可能性があります。Ctrl+Shift+R で再読み込みしてください',
      title: 'この端末に新しい形式の記録があります',
      body: 'いま開いているアプリより新しい記録が見つかりました。記録を守るため、書き込みを止めています。Ctrl+Shift+R(Mac は ⌘+Shift+R)で再読み込みしてください。',
      actions: ['reload']
    },
    'offline': {
      severity: 'warn',
      fatal: false,
      banner: '⚠ インターネットに接続していません(音声認識が使えません)',
      title: 'インターネットに接続していません',
      body: 'Chrome の音声認識はインターネット経由で動きます。教材の閲覧と、オフラインで使える声での読み上げはこのまま使えます。',
      actions: []
    },
    'android': {
      severity: 'warn',
      fatal: false,
      banner: 'スマホでも使えますが、パソコンのほうが安定します',
      title: 'スマートフォンでも使えます',
      body: 'Android の Chrome でも練習できますが、パソコンのほうが認識が安定します。イヤホンを使うとさらに安定します。',
      actions: []
    },
    /* iPhone・iPad の Safari は音声認識が使えるが、マイクが止まらない・結果が返らない
       といった不具合が他ブラウザより多い(iOS 側の実装の制約)。塞がず先に進ませたうえで
       正直に注意を出す。パソコンの Chrome を最も安定した選択肢として案内する。 */
    'ios-safari': {
      severity: 'warn',
      fatal: false,
      banner: 'iPhone・iPad でも使えますが、動作が不安定なことがあります',
      title: 'iPhone・iPad(Safari)でも使えます',
      body: 'Safari でも音声認識・読み上げを試せますが、マイクの録音が止まりにくい・結果が返らないなど、他の環境より不安定なことがあります。イヤホンの使用と、パソコンの Google Chrome が最も安定します。',
      actions: []
    }
  };

  /* --- t() -------------------------------------------------------------- */

  /* 変数記法は %{name}。Liquid(GitHub Pages)に二重波かっこを食われないための選択。 */
  var VAR_RE = /%\{([A-Za-z0-9_]+)\}/g;

  /** ドット記法で UI をたどる。見つからなければ undefined。 */
  function lookup(key) {
    if (typeof key !== 'string' || !key) return undefined;
    var parts = key.split('.');
    var cur = UI;
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  /** '%{n}' を vars.n で置換。未定義の変数はそのまま残す(文言のバグに気づけるように)。 */
  function interpolate(tpl, vars) {
    if (!vars) return tpl;
    return tpl.replace(VAR_RE, function (whole, name) {
      var v = vars[name];
      return (v === undefined || v === null) ? whole : String(v);
    });
  }

  /**
   * 文言を引く。'home.title' のようなドット記法。
   * 未定義キー、あるいは文字列でない値(配列など)は**キー文字列をそのまま返す**。
   * 配列は list(key) で取る。
   */
  function t(key, vars) {
    var v = lookup(key);
    if (typeof v !== 'string') return String(key);
    return interpolate(v, vars);
  }

  /** 配列の文言(bullets / steps / tips)を取る。無ければ空配列。 */
  function list(key) {
    var v = lookup(key);
    return Array.isArray(v) ? v.slice() : [];
  }

  /** キーが定義されているか。 */
  function has(key) { return lookup(key) !== undefined; }

  /** エラーパネルのボタンラベル。未知のキーはキー文字列を返す。 */
  function actionLabel(actionKey) { return t('actions.' + actionKey); }

  /**
   * ASR のエラーコード → 文言。未知のコードは 'unknown' に落とす。
   * (recognizer が返す 'start-failed' などもここで拾われる)
   */
  function asrError(code, vars) {
    var e = (code && Object.prototype.hasOwnProperty.call(ASR_ERRORS, code))
      ? ASR_ERRORS[code] : ASR_ERRORS.unknown;
    return {
      code: code || 'unknown',
      fatal: !!e.fatal,
      silent: !!e.silent,
      title: interpolate(e.title, vars),
      body: interpolate(e.body, vars),
      actions: e.actions.slice()
    };
  }

  /** TTS の resolve 理由 → 文言。未知の理由は 'synthesis-failed' に落とす。 */
  function ttsError(reason, vars) {
    var e = (reason && Object.prototype.hasOwnProperty.call(TTS_ERRORS, reason))
      ? TTS_ERRORS[reason] : TTS_ERRORS['synthesis-failed'];
    return {
      code: reason || 'synthesis-failed',
      fatal: !!e.fatal,
      silent: !!e.silent,
      title: interpolate(e.title, vars),
      body: interpolate(e.body, vars),
      actions: e.actions.slice()
    };
  }

  /** ブロッカー / 縮退の文言。未知のキーは null。 */
  function blocker(key, vars) {
    if (!key || !Object.prototype.hasOwnProperty.call(BLOCKERS, key)) return null;
    var b = BLOCKERS[key];
    return {
      code: key,
      severity: b.severity,
      fatal: !!b.fatal,
      banner: interpolate(b.banner, vars),
      title: interpolate(b.title, vars),
      body: interpolate(b.body, vars),
      actions: b.actions.slice(),
      url: b.url || null
    };
  }

  LC.msg = {
    t: t,
    list: list,
    has: has,
    actionLabel: actionLabel,
    asrError: asrError,
    ttsError: ttsError,
    blocker: blocker,
    UI: UI,
    ASR_ERRORS: ASR_ERRORS,
    TTS_ERRORS: TTS_ERRORS,
    BLOCKERS: BLOCKERS,
    PAGES_URL: PAGES_URL,
    CHROME_URL: CHROME_URL,
    MIC_SETTINGS_URL: MIC_SETTINGS_URL
  };

  LC.__loaded = (LC.__loaded || []).concat(['util', 'msg']);
})(window.LC);

/* js/99-app.js
 * つたわる English — アプリ状態 / ルーター / 起動シーケンス / 第 3 層エラー
 *
 * 仕様 §6(状態管理・ルーター・体験モード・ライフサイクル)と
 * 仕様 §10(エラー処理の 4 層防御)の実装。
 *
 * このファイルの責務:
 *   - LC.state          … アプリ状態(JSON 直列化できるものだけ)
 *   - ルーター          … ハッシュルーティングと画面のマウント / アンマウント
 *   - 起動シーケンス    … モジュール確認 → 体験モード → 環境検出 → 音声 → 初回表示
 *   - 第 3 層エラー     … window.onerror / unhandledrejection(必ず音声を止めてから表示)
 *   - ライフサイクル    … visibilitychange / pagehide / beforeunload / online / offline
 *
 * このファイルは speechSynthesis / SpeechRecognition / localStorage に直接触らない。
 * すべて LC.speaker / LC.recognizer / LC.store 経由で行う(依存の向きの不変ルール)。
 */
window.LC = window.LC || {};
(function (LC) {
  'use strict';

  /* ==========================================================================
   * 0. 定数とローカル文言
   * ========================================================================== */

  var APP_VERSION = '1.0.0';

  /* GitHub Pages の公開 URL。README / 第 0 層ブートガードと同じ値を保つこと。 */
  var PAGES_URL = 'https://kazuyan38.github.io/languageclub/app/';

  /* 文言モジュール(01-util.js)が持っているプレースホルダ。起動時に実 URL へ差し替える。 */
  var PAGES_URL_PLACEHOLDER = 'https://ORG.github.io/REPO/';

  /* ルーターと起動処理だけが使う文言。
     LC.msg に該当キーがあるものは必ず LC.msg を優先し、ここはフォールバック。
     (仕様 §0-1 の語彙規律: 「失敗」「不合格」は使わない) */
  var APP_TEXT = {
    booting: '準備しています…',
    stoppedByHidden: 'タブが表示されなくなったので、いったん停止しました。',
    screenFailedTitle: 'この画面を表示できませんでした',
    screenFailedBody: 'ホームへもどってから、もう一度お試しください。',
    bootMissingLead: '読み込めなかったファイルがあります。',
    bootMissingItems: '不足しているもの: ',
    goHome: 'ホームへ'
  };

  /* 起動に必要なモジュール。
     ★ LC.__loaded は補助。実体(オブジェクトと代表的な関数)の存在で判定する。 */
  var REQUIRED_MODULES = [
    { name: 'util',       file: 'js/01-util.js',   ok: function () { return !!(LC.util && LC.util.h && LC.util.focusMain); } },
    { name: 'msg',        file: 'js/01-util.js',   ok: function () { return !!(LC.msg && LC.msg.t); } },
    { name: 'store',      file: 'js/02-store.js',  ok: function () { return !!(LC.store && LC.store.createStore && LC.store.flushAll); } },
    { name: 'env',        file: 'js/02-store.js',  ok: function () { return !!(LC.env && LC.env.detect); } },
    { name: 'settings',   file: 'js/02-store.js',  ok: function () { return !!(LC.settings && LC.settings.get); } },
    { name: 'decks',      file: 'data/decks.js',   ok: function () { return !!LC.DECKS_RAW; } },
    { name: 'normalize',  file: 'js/03-text.js',   ok: function () { return !!(LC.normalize && LC.normalize.tokenize); } },
    { name: 'similarity', file: 'js/03-text.js',   ok: function () { return !!(LC.similarity && LC.similarity.charSimilarity); } },
    { name: 'align',      file: 'js/03-text.js',   ok: function () { return !!(LC.align && LC.align.alignWords); } },
    { name: 'score',      file: 'js/03-text.js',   ok: function () { return !!(LC.score && LC.score.scoreUtterance); } },
    { name: 'catalog',    file: 'js/04-catalog.js', ok: function () { return !!(LC.catalog && LC.catalog.getDecks); } },
    { name: 'tracker',    file: 'js/04-catalog.js', ok: function () { return !!(LC.tracker && LC.tracker.recordAttempt); } },
    { name: 'speaker',    file: 'js/05-speech.js', ok: function () { return !!(LC.speaker && LC.speaker.speak); } },
    { name: 'recognizer', file: 'js/05-speech.js', ok: function () { return !!(LC.recognizer && LC.recognizer.create); } },
    { name: 'session',    file: 'js/06-session.js', ok: function () { return !!(LC.session && LC.session.create && LC.session.Phase); } },
    { name: 'ui',         file: 'js/07-ui.js',     ok: function () { return !!(LC.ui && LC.ui.renderResult); } },
    { name: 'screens',    file: 'js/08-screen-practice.js / js/09-screens.js', ok: function () { return !!(LC.screens && LC.screens.home && LC.screens.practice); } }
  ];

  /* ==========================================================================
   * 1. 小さなヘルパ(LC.util が無い場面でも動く必要があるので自前で持つ)
   * ========================================================================== */

  function has(obj, key) {
    return obj !== null && obj !== undefined && Object.prototype.hasOwnProperty.call(obj, key);
  }

  function shallowCopy(obj) {
    var out = {}, k;
    if (!obj) return out;
    for (k in obj) if (has(obj, k)) out[k] = obj[k];
    return out;
  }

  function byId(id) {
    try { return document.getElementById(id); } catch (e) { return null; }
  }

  /** 診断ログ。LC.util.log が無い(= まだ読めていない)場合は console に落とす。 */
  function log(tag, data) {
    try {
      if (LC.util && LC.util.log) { LC.util.log(tag, data); return; }
    } catch (e) { /* 握り潰す */ }
    try { if (window.console && console.warn) console.warn('[' + tag + ']', data); } catch (e2) {}
  }

  /** 想定内の失敗を記録する。★公開関数は例外を投げないので、ここで必ず止める。 */
  function logError(tag, err) {
    log(tag, { message: (err && err.message) || String(err), stack: err && err.stack ? String(err.stack).slice(0, 400) : null });
  }

  /**
   * 文言取得。LC.msg にキーがあればそれを、無ければ APP_TEXT のフォールバックを返す。
   * @param {string} key       LC.msg のドット記法キー
   * @param {string} fallback  キーが無いときの日本語
   */
  function t(key, fallback, vars) {
    try {
      if (LC.msg && typeof LC.msg.has === 'function' && LC.msg.has(key)) return LC.msg.t(key, vars);
      if (LC.msg && typeof LC.msg.t === 'function') {
        var s = LC.msg.t(key, vars);
        if (s && s !== key) return s;
      }
    } catch (e) { /* 文言が取れないだけで止めない */ }
    return fallback;
  }

  function toast(text, type) {
    try { if (LC.util && LC.util.toast) LC.util.toast(text, { type: type || 'info' }); } catch (e) {}
  }

  function h() {
    return LC.util.h.apply(null, arguments);
  }

  /* ==========================================================================
   * 2. LC.state — アプリ状態(仕様 §6-1)
   *
   * ★ JSON 直列化できるものだけを入れる。
   *   SpeechSynthesisVoice 実体・SpeechRecognition 実体・タイマー ID・Promise は
   *   speaker / recognizer / session の内部(一時状態)に置く。
   *   これを守ると (a) 診断画面が JSON.stringify(LC.state.get()) をそのままコピーでき、
   *   (b) 参照同一性バグ(画面が更新されない)が起きない。
   * ========================================================================== */

  /** 状態に入れてはいけないオブジェクトのコンストラクタ名(§6-1 の三層分離の番人)。 */
  var FORBIDDEN_CTORS = [
    'SpeechSynthesisVoice', 'SpeechSynthesis', 'SpeechSynthesisUtterance',
    'SpeechRecognition', 'webkitSpeechRecognition', 'SpeechRecognitionEvent',
    'AudioContext', 'webkitAudioContext', 'AnalyserNode',
    'MediaStream', 'MediaStreamTrack', 'Promise', 'Window'
  ];

  /**
   * 直列化できる値かを浅く(深さ 4 まで)検査する。純関数。
   * 完全な検査ではなく「よくある事故」を止めるための番人。
   */
  function isSerializable(v, depth) {
    if (v === null || v === undefined) return true;
    var type = typeof v;
    if (type === 'string' || type === 'number' || type === 'boolean') return true;
    if (type !== 'object') return false;                 /* function / symbol / bigint */
    try { if (typeof Node !== 'undefined' && v instanceof Node) return false; } catch (e) {}
    if (v === window) return false;
    var ctor = '';
    try { ctor = (v.constructor && v.constructor.name) || ''; } catch (e2) { ctor = ''; }
    for (var c = 0; c < FORBIDDEN_CTORS.length; c++) if (ctor === FORBIDDEN_CTORS[c]) return false;
    if (depth >= 4) return true;                         /* 深すぎるものは諦める(コスト優先) */
    var i, k;
    if (Array.isArray(v)) {
      for (i = 0; i < v.length; i++) if (!isSerializable(v[i], depth + 1)) return false;
      return true;
    }
    for (k in v) if (has(v, k)) { if (!isSerializable(v[k], depth + 1)) return false; }
    return true;
  }

  var INITIAL_STATE = {
    lifecycle: 'booting',                 /* 'booting' | 'ready' | 'blocked' */
    env: null,
    settings: null,
    demoMode: false,
    route: { name: 'home', params: {} },
    voice: { ready: false, total: 0, englishCount: 0, hasOfflineEnglish: false, selected: null },
    practice: null,                       /* 練習画面が持つ表示用ミラー */
    runtime: { online: true, micPermission: 'unknown', hidden: false },
    health: { storageMode: 'persistent', deckLoadErrors: [] }
  };

  var stateCurrent = INITIAL_STATE;
  var statePrev = INITIAL_STATE;
  var stateSubs = [];
  var notifyScheduled = false;

  function stateGet() { return stateCurrent; }

  /**
   * 浅いマージ。同一 tick 内の複数回の set は microtask で 1 回の通知にまとめる。
   * ★ 値自体は同期で反映する(set 直後の get が古い値を返すと必ずバグる)。
   */
  function stateSet(patch) {
    if (!patch || typeof patch !== 'object') return stateCurrent;
    var next = null, k, v;
    for (k in patch) {
      if (!has(patch, k)) continue;
      v = patch[k];
      if (!isSerializable(v, 0)) {
        /* ここに来たら設計違反。落とさずに無視して、診断ログに残す。 */
        log('state.rejected', { key: k });
        continue;
      }
      if (stateCurrent[k] === v) continue;
      if (!next) next = shallowCopy(stateCurrent);
      next[k] = v;
    }
    if (!next) return stateCurrent;
    stateCurrent = next;
    scheduleNotify();
    return stateCurrent;
  }

  function scheduleNotify() {
    if (notifyScheduled) return;
    notifyScheduled = true;
    if (typeof Promise === 'function') Promise.resolve().then(flushNotify);
    else setTimeout(flushNotify, 0);
  }

  function flushNotify() {
    notifyScheduled = false;
    if (statePrev === stateCurrent) return;
    var prev = statePrev;
    statePrev = stateCurrent;
    var list = stateSubs.slice();          /* 通知中の解除に耐えるためコピーを回す */
    for (var i = 0; i < list.length; i++) {
      try { list[i](stateCurrent, prev); } catch (e) { logError('state.subscriber', e); }
    }
  }

  /** @returns {Function} 解除関数 */
  function stateSubscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    stateSubs.push(fn);
    return function () {
      for (var i = 0; i < stateSubs.length; i++) {
        if (stateSubs[i] === fn) { stateSubs.splice(i, 1); return; }
      }
    };
  }

  /** selector の結果が変わったときだけ fn を呼ぶ。初回は呼ばない。 */
  function stateSelect(selector, fn, equals) {
    if (typeof selector !== 'function' || typeof fn !== 'function') return function () {};
    var eq = typeof equals === 'function' ? equals : function (a, b) { return a === b; };
    var last;
    try { last = selector(stateCurrent); } catch (e) { last = undefined; }
    return stateSubscribe(function (s) {
      var v;
      try { v = selector(s); } catch (e) { return; }
      if (eq(v, last)) return;
      last = v;
      try { fn(v, s); } catch (e2) { logError('state.select', e2); }
    });
  }

  LC.state = {
    get: stateGet,
    set: stateSet,
    subscribe: stateSubscribe,
    select: stateSelect
  };

  /* --- 入れ子オブジェクトの部分更新ヘルパ(浅いマージなので丸ごと作り直す) --- */

  function patchRuntime(p) {
    stateSet({ runtime: mergeInto(stateCurrent.runtime, p) });
  }
  function patchHealth(p) {
    stateSet({ health: mergeInto(stateCurrent.health, p) });
  }
  function mergeInto(base, p) {
    var out = shallowCopy(base), k;
    for (k in p) if (has(p, k)) out[k] = p[k];
    return out;
  }

  /* ==========================================================================
   * 3. 設定ミラーとテーマ
   * ========================================================================== */

  var SETTING_KEYS = ['lang', 'voice', 'rate', 'autoListen', 'showScore', 'saveRecords', 'theme'];

  function settingsEqual(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    for (var i = 0; i < SETTING_KEYS.length; i++) {
      var k = SETTING_KEYS[i];
      if (k === 'voice') {
        var av = a.voice, bv = b.voice;
        if (!av !== !bv) return false;
        if (av && bv && (av.name !== bv.name || av.lang !== bv.lang)) return false;
        continue;
      }
      if (a[k] !== b[k]) return false;
    }
    return true;
  }

  /** LC.settings の現在値を state.settings にミラーする(変化したときだけ)。 */
  function refreshSettings() {
    var s = null;
    try { s = LC.settings.get(); } catch (e) { logError('settings.get', e); }
    if (!s) return;
    if (settingsEqual(stateCurrent.settings, s)) return;
    stateSet({ settings: shallowCopy(s) });
  }

  /**
   * テーマを <html data-theme> に反映する。
   * tokens.css が :root[data-theme="dark"] / :root:not([data-theme="light"]) を見ている。
   */
  function applyTheme(theme) {
    var v = (theme === 'light' || theme === 'dark') ? theme : 'auto';
    try { document.documentElement.setAttribute('data-theme', v); } catch (e) {}
  }

  /**
   * LC.settings.update / reset を 1 枚だけ包む。
   * 画面側が state の更新を忘れても、設定ミラーとテーマが必ず追随する。
   * (アプリ層は合成の責任を持つので、他モジュールのファイルには手を入れない)
   */
  function wrapSettingsWriters() {
    ['update', 'reset'].forEach(function (name) {
      var original = LC.settings[name];
      if (typeof original !== 'function' || original.__lcWrapped) return;
      var wrapped = function () {
        var r;
        try { r = original.apply(LC.settings, arguments); }
        catch (e) { logError('settings.' + name, e); r = null; }
        try { refreshSettings(); } catch (e2) { logError('settings.mirror', e2); }
        return r;
      };
      wrapped.__lcWrapped = true;
      LC.settings[name] = wrapped;
    });
  }

  /**
   * 公開ページの URL を LC.msg に注入する。
   * 「どこに配信するか」を知っているのはアプリ層だけなので、文言モジュールには
   * プレースホルダを置いたまま、起動時に 1 回だけ実 URL へ差し替える。
   * (これをしないと file:// や insecure の案内が ORG.github.io/REPO のままになる)
   */
  function injectPagesUrl() {
    try {
      if (!LC.msg.PAGES_URL || LC.msg.PAGES_URL === PAGES_URL_PLACEHOLDER) LC.msg.PAGES_URL = PAGES_URL;
      var b = LC.msg.BLOCKERS, k;
      for (k in b) {
        if (!has(b, k)) continue;
        if (b[k] && b[k].url === PAGES_URL_PLACEHOLDER) b[k].url = PAGES_URL;
      }
      if (LC.msg.UI && LC.msg.UI.help && LC.msg.UI.help.pagesUrl === PAGES_URL_PLACEHOLDER) {
        LC.msg.UI.help.pagesUrl = PAGES_URL;
      }
    } catch (e) { logError('msg.injectPagesUrl', e); }
  }

  /* ==========================================================================
   * 4. 警告帯(仕様 §10-2 の「縮退」「警告」行)
   * ========================================================================== */

  var banners = [];        /* [{code, severity, banner, title, body, actions, url}] */

  /**
   * 警告帯を 1 件出す / 消す。
   * @param {string} code   LC.msg.BLOCKERS のキー。同じ code は 1 件だけ。
   * @param {boolean} on    false で消す
   * @param {object} [extra] 追加の上書き(actions など)
   */
  function setBanner(code, on, extra) {
    var i, changed = false;
    for (i = banners.length - 1; i >= 0; i--) {
      if (banners[i].code === code) { banners.splice(i, 1); changed = true; }
    }
    if (on) {
      var item = null;
      try { item = LC.msg.blocker(code); } catch (e) { logError('msg.blocker', e); }
      if (!item) item = { code: code, severity: 'warn', banner: code, title: code, body: '', actions: [], url: null };
      if (extra) item = mergeInto(item, extra);
      banners.push(item);
      changed = true;
    }
    if (changed) renderBanners();
  }

  function renderBanners() {
    try {
      if (LC.ui && typeof LC.ui.renderBanner === 'function') { LC.ui.renderBanner(banners.slice()); return; }
    } catch (e) { logError('ui.renderBanner', e); }
    /* LC.ui が使えないときの最小フォールバック(帯が消えるより出したほうがよい) */
    var area = byId('bannerArea');
    if (!area) return;
    while (area.firstChild) area.removeChild(area.firstChild);
    for (var i = 0; i < banners.length; i++) {
      var p = document.createElement('p');
      p.className = 'banner__item banner--warn';
      p.textContent = banners[i].banner || banners[i].title || '';
      area.appendChild(p);
    }
    area.hidden = banners.length === 0;
  }

  /** 環境検出の結果から出す帯をまとめて更新する。 */
  function updateEnvBanners(env) {
    if (!env) return;
    /* file:// は致命にしない。帯 + 公開ページのコピーボタンだけ出して練習に進ませる(§5-4)。 */
    setBanner('file-protocol', !!env.isFileProtocol, { url: PAGES_URL });
    setBanner('offline', navigator && navigator.onLine === false);
    setBanner('android', env.browserClass === 'chrome-android');
    /* browserClass === 'ios' でここまで来る(=ブロック画面に振られていない)のは
       常に iOS Safari(§10-2 判定で非 Safari は blockReason:'ios' になり別画面へ行く)。 */
    setBanner('ios-safari', env.browserClass === 'ios' && !!env.supported);
    updateStorageBanner();
  }

  function updateStorageBanner() {
    var mode = 'persistent';
    try { mode = LC.store.getMode(); } catch (e) {}
    patchHealth({ storageMode: mode });
    setBanner('no-storage', mode === 'memory');
    setBanner('storage-readonly', mode === 'readonly');
  }

  function updateVoiceBanner(summary) {
    /* 読み上げ API そのものが無い場合と、英語音声が 0 個の場合は同じ帯でよい(どちらも縮退)。 */
    var noSynthesis = !(stateCurrent.env && stateCurrent.env.hasSynthesis);
    var noEnglish = !summary || summary.englishCount === 0;
    setBanner('no-english-voice', noSynthesis || noEnglish);
  }

  /* ==========================================================================
   * 5. ルーター(仕様 §6-2)
   *
   * ハッシュルーティング。GitHub Pages で 404.html が要らなくなる。
   * ========================================================================== */

  var ROUTE_NAMES = {
    home: 1, practice: 1, summary: 1, stats: 1, settings: 1, help: 1, decks: 1, onboarding: 1
  };

  function parseQuery(str, out) {
    var parts = String(str || '').split('&');
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      var eq = parts[i].indexOf('=');
      var k = eq < 0 ? parts[i] : parts[i].slice(0, eq);
      var v = eq < 0 ? '' : parts[i].slice(eq + 1);
      try { k = decodeURIComponent(k.replace(/\+/g, ' ')); } catch (e) {}
      try { v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e2) {}
      if (k) out[k] = v;
    }
    return out;
  }

  function normalizeHash(hash) {
    var s = String(hash === null || hash === undefined ? '' : hash);
    if (!s) return '#/';
    if (s.charAt(0) !== '#') s = '#' + s;
    if (s === '#') return '#/';
    if (s.charAt(1) !== '/') s = '#/' + s.slice(1);
    return s;
  }

  /**
   * ハッシュを解決する。
   * @returns {object|null} null は「ルーターは関与しない」(#main などのページ内アンカー)
   *   {name, params, redirectTo}
   */
  function resolveRoute(rawHash, isInitial) {
    var raw = String(rawHash || '');
    if (raw === '' || raw === '#') return { name: 'home', params: {}, redirectTo: null };

    if (raw.charAt(0) === '#' && raw.charAt(1) !== '/') {
      /* '#main'(本文へスキップ)などのページ内アンカー。
         ここで home に飛ばすと、スキップリンクを押しただけで画面が吹き飛ぶ。 */
      return isInitial ? { name: 'home', params: {}, redirectTo: null } : null;
    }

    var body = raw.charAt(0) === '#' ? raw.slice(1) : raw;
    var query = {};
    var qi = body.indexOf('?');
    if (qi >= 0) { parseQuery(body.slice(qi + 1), query); body = body.slice(0, qi); }

    var segs = [];
    var rawSegs = body.split('/');
    for (var i = 0; i < rawSegs.length; i++) {
      if (!rawSegs[i]) continue;
      var s = rawSegs[i];
      try { s = decodeURIComponent(s); } catch (e) {}
      segs.push(s);
    }

    if (segs.length === 0) return { name: 'home', params: {}, redirectTo: null };

    var head = segs[0];

    if (head === 'practice') {
      if (!segs[1]) return { name: 'home', params: {}, redirectTo: '#/', notFound: true };
      var idx = parseInt(query.i, 10);
      return {
        name: 'practice',
        params: { deckId: segs[1], i: (isFinite(idx) && idx >= 0) ? idx : null },
        redirectTo: null
      };
    }
    if (head === 'summary') {
      if (!segs[1]) return { name: 'home', params: {}, redirectTo: '#/', notFound: true };
      return { name: 'summary', params: { deckId: segs[1] }, redirectTo: null };
    }
    if (head === 'home') return { name: 'home', params: {}, redirectTo: '#/' };
    if (has(ROUTE_NAMES, head) && head !== 'practice' && head !== 'summary') {
      return { name: head, params: {}, redirectTo: null };
    }
    /* その他は home に置換(仕様 §6-2) */
    return { name: 'home', params: {}, redirectTo: '#/', notFound: true };
  }

  function routeKey(r) {
    var p = '';
    try { p = JSON.stringify(r.params || {}); } catch (e) { p = ''; }
    return r.name + '|' + p;
  }

  var routerStarted = false;
  var currentScreen = null;      /* {el, title, destroy, onKey} */
  var currentRoute = null;
  var currentKey = null;

  /** location.hash を履歴を汚さずに書き換える。hashchange を起こさない経路を優先する。 */
  function replaceHash(hash) {
    var h = normalizeHash(hash);
    if ((location.hash || '') === h) return true;
    try {
      if (window.history && typeof window.history.replaceState === 'function') {
        window.history.replaceState(null, '', h);
        return true;
      }
    } catch (e) { /* file:// では SecurityError になることがある */ }
    try { location.replace(String(location.href).split('#')[0] + h); return true; } catch (e2) {}
    try { location.hash = h; return true; } catch (e3) {}
    return false;
  }

  /**
   * 画面遷移。
   * @param {string} hash  '#/stats' など
   * @param {object} [opts] {replace:true} で履歴を積まない
   */
  function navigate(hash, opts) {
    var h = normalizeHash(hash);
    var cur = location.hash || '';
    if (cur === h || (cur === '' && h === '#/')) {
      /* 同じハッシュでは hashchange が来ないので、自分で描画し直す。 */
      handleRoute(true);
      return;
    }
    if (opts && opts.replace) {
      if (replaceHash(h)) { handleRoute(false); return; }
    }
    try { location.hash = h; } catch (e) { logError('navigate', e); }
  }

  function onHashChange() { handleRoute(false); }

  function handleRoute(force) {
    if (!routerStarted) return;
    var r = resolveRoute(location.hash, currentRoute === null);
    if (!r) return;                                  /* ページ内アンカー: 何もしない */
    if (r.redirectTo) {
      /* 不明なハッシュは home に置換する。history.replaceState は hashchange を起こさないので
         ここから再入することはない。 */
      replaceHash(r.redirectTo);
      if (r.notFound) toast(t('error.notFound', 'ページが見つかりませんでした。ホームへもどります。'), 'info');
    }
    var key = routeKey(r);
    if (!force && key === currentKey && currentScreen) return;
    mountRoute(r);
  }

  /**
   * 画面を切り替える。
   * 順序は 前画面の destroy() → #main を差し替え → document.title → focusMain()。
   */
  function mountRoute(route) {
    var main = byId('main');
    if (!main) return;

    leaveCurrentScreen(route);
    refreshSettings();                                /* 設定ミラーを最新化してから描画する */
    stateSet({ route: { name: route.name, params: shallowCopy(route.params) } });

    var view = renderScreen(route);

    currentScreen = view;
    currentRoute = route;
    currentKey = routeKey(route);

    try { LC.util.clear(main); } catch (e) { while (main.firstChild) main.removeChild(main.firstChild); }
    try { main.appendChild(view.el); } catch (e2) { logError('mount.append', e2); }

    setDocumentTitle(view.title);
    try { LC.util.focusMain(); } catch (e3) { try { main.focus(); } catch (e4) {} }
    if (view.title) { try { LC.util.announce(view.title); } catch (e5) {} }
    log('route.mount', { name: route.name, params: route.params });
  }

  function renderScreen(route) {
    var mod = (LC.screens && LC.screens[route.name]) || null;
    var view = null;
    if (mod && typeof mod.render === 'function') {
      try {
        view = mod.render({
          params: shallowCopy(route.params),
          state: buildScreenState(),
          navigate: navigate,
          route: { name: route.name, params: shallowCopy(route.params) }
        });
      } catch (e) {
        logError('screen.render:' + route.name, e);
        view = null;
      }
    }
    if (!view || !view.el) return fallbackScreen(route);
    return view;
  }

  /**
   * 画面に渡す state。
   * LC.state のメソッド(get/set/subscribe/select)に加えて、
   * 描画時点の値も同じオブジェクトに載せる。
   * ctx.state.get().settings と ctx.state.settings のどちらの書き方でも動かすための保険。
   */
  function buildScreenState() {
    var view = {
      get: stateGet,
      set: stateSet,
      subscribe: stateSubscribe,
      select: stateSelect
    };
    var s = stateCurrent, k;
    for (k in s) if (has(s, k) && !has(view, k)) view[k] = s[k];
    return view;
  }

  /** 画面モジュールが無い / 描画で落ちたときの代替画面。白画面にはしない。 */
  function fallbackScreen(route) {
    var el;
    try {
      el = LC.ui.errorPanel({
        title: APP_TEXT.screenFailedTitle,
        body: APP_TEXT.screenFailedBody,
        actions: [
          { key: 'home', label: t('common.home', APP_TEXT.goHome), primary: true, onClick: function () { navigate('#/'); } },
          'reload'
        ],
        detail: '画面: ' + route.name
      });
    } catch (e) {
      el = document.createElement('section');
      el.className = 'card';
      var hd = document.createElement('h2');
      hd.textContent = APP_TEXT.screenFailedTitle;
      var p = document.createElement('p');
      p.textContent = APP_TEXT.screenFailedBody;
      el.appendChild(hd);
      el.appendChild(p);
    }
    return { el: el, title: APP_TEXT.screenFailedTitle, destroy: null, onKey: null };
  }

  function setDocumentTitle(title) {
    var appName = t('common.appName', 'つたわる English');
    var full = appName;
    if (title && String(title).indexOf(appName) < 0) full = String(title) + ' | ' + appName;
    else if (title) full = String(title);
    try { document.title = full; } catch (e) {}
  }

  /**
   * 前の画面を降ろす。
   * 練習中(SPEAKING / GUARD / LISTENING)なら必ず session.cancelAll() を呼ぶ。
   * 本来は練習画面の destroy() が担保するが、ルーター側でも二重に止める
   * (タイマーと認識の止め忘れが Web Speech アプリの死因第 1 位)。
   */
  function leaveCurrentScreen(toRoute) {
    onBeforeLeave(currentRoute, toRoute);
    var view = currentScreen;
    currentScreen = null;
    if (view && typeof view.destroy === 'function') {
      try { view.destroy(); } catch (e) { logError('screen.destroy', e); }
    }
  }

  function onBeforeLeave(from, to) {
    var s = getActiveSession();
    if (s) {
      var phase = null;
      try { phase = s.getPhase ? s.getPhase() : null; } catch (e) {}
      if (isBusyPhase(phase)) {
        try { s.cancelAll(); } catch (e2) { logError('session.cancelAll', e2); }
      }
    }
    /* 画面を離れたのに読み上げが続くのは最悪の体験なので、無条件に止める。
       'canceled' は正常系なのでエラー表示はしない(仕様 §10-4)。 */
    try { LC.speaker.stopSpeaking(); } catch (e3) {}
    log('route.leave', { from: from ? from.name : null, to: to ? to.name : null });
  }

  function isBusyPhase(phase) {
    if (!phase) return false;
    var P = (LC.session && LC.session.Phase) || null;
    if (!P) return false;
    return phase === P.SPEAKING || phase === P.GUARD || phase === P.LISTENING;
  }

  /* --- 現在の練習セッションの在りか -------------------------------------- */

  var activeSession = null;

  function setActiveSession(s) { activeSession = s || null; }

  /** 練習画面が登録してくれていればそれを、無ければ既知の置き場所を順に探す。 */
  function getActiveSession() {
    if (activeSession && typeof activeSession.cancelAll === 'function') return activeSession;
    try {
      if (LC.session && LC.session.current && typeof LC.session.current.cancelAll === 'function') return LC.session.current;
    } catch (e) {}
    try {
      if (LC.session && typeof LC.session.getActive === 'function') {
        var a = LC.session.getActive();
        if (a && typeof a.cancelAll === 'function') return a;
      }
    } catch (e2) {}
    try {
      if (LC.screens && LC.screens.practice && typeof LC.screens.practice.getSession === 'function') {
        var b = LC.screens.practice.getSession();
        if (b && typeof b.cancelAll === 'function') return b;
      }
    } catch (e3) {}
    return null;
  }

  /* --- キーボード(仕様 §7-3 / §12-1) ------------------------------------ */

  function onKeyDown(e) {
    var el = e && e.target;
    if (el && el.tagName) {
      var tag = el.tagName;
      /* 入力中はショートカットを奪わない(貼り付け欄で 'n' が次のフレーズになると事故る) */
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (el.isContentEditable) return;
    }
    if (!currentScreen || typeof currentScreen.onKey !== 'function') return;
    var handled = false;
    try { handled = currentScreen.onKey(e); } catch (err) { logError('screen.onKey', err); return; }
    if (handled === true) {
      try { e.preventDefault(); } catch (e2) {}
    }
  }

  /** 「本文へスキップ」で location.hash が '#main' になってもルーターが暴れないようにする。 */
  function wireSkipLink() {
    var link = LC.util.qs('.skip-link');
    if (!link) return;
    link.addEventListener('click', function (e) {
      try { e.preventDefault(); } catch (e2) {}
      try { LC.util.focusMain({ scroll: false }); } catch (e3) {}
    });
  }

  /* ==========================================================================
   * 6. 第 3 層 — 予期しないエラー(仕様 §10-5)
   * ========================================================================== */

  var fatalShown = false;

  function onFatal(e) {
    /* script / CSS の読み込み失敗は第 0 層(index.html)の担当。ここでは無視する。 */
    try {
      var target = e && e.target;
      if (target && target !== window && target.tagName &&
          (target.tagName === 'SCRIPT' || target.tagName === 'LINK')) return;
    } catch (x0) {}

    if (fatalShown) return;
    fatalShown = true;

    /* ★必ず音声を止めてからパネルを出す。喋り続けながらのエラー表示が最悪の体験になる。 */
    try { var s = getActiveSession(); if (s) s.cancelAll(); } catch (x1) {}
    try { LC.speaker.stopSpeaking(); } catch (x2) {}
    try { LC.store.flushAll(); } catch (x3) {}

    var detail = '';
    try { detail = buildDiagnosticsText(e); } catch (x4) { detail = 'diagnostics unavailable'; }
    log('fatal', { detail: detail.slice(0, 400) });

    try { renderFatalPanel(detail); }
    catch (x5) {
      /* パネルの描画すら通らないときの最後の砦 */
      var fb = byId('bootFallback');
      if (fb) {
        fb.textContent = t('error.fatalTitle', '予期しないエラーが発生しました');
        fb.hidden = false;
        fb.style.display = 'block';
      }
    }
  }

  function renderFatalPanel(detail) {
    var main = byId('main');
    if (!main) return;
    leaveCurrentScreen(null);
    currentKey = null;

    var el = null;
    try {
      el = LC.ui.errorPanel({
        title: t('error.fatalTitle', '予期しないエラーが発生しました'),
        body: t('error.fatalBody', 'ページを再読み込みすると直ることがほとんどです。'),
        tone: 'fatal',
        actions: [{ key: 'reload', label: t('actions.reload', 'ページを再読み込み'), primary: true,
                    onClick: function () { try { location.reload(); } catch (e) {} } }],
        detail: detail
      });
    } catch (e) { el = null; }

    if (!el) {
      el = document.createElement('section');
      el.className = 'panel-error';
      el.setAttribute('role', 'alert');
      var hd = document.createElement('h2');
      hd.textContent = t('error.fatalTitle', '予期しないエラーが発生しました');
      var p = document.createElement('p');
      p.textContent = t('error.fatalBody', 'ページを再読み込みすると直ることがほとんどです。');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--primary';
      btn.textContent = t('actions.reload', 'ページを再読み込み');
      btn.onclick = function () { try { location.reload(); } catch (e2) {} };
      var pre = document.createElement('pre');
      pre.className = 'panel-error__pre';
      pre.textContent = detail;
      el.appendChild(hd); el.appendChild(p); el.appendChild(btn); el.appendChild(pre);
    }

    try { LC.util.clear(main); } catch (e3) { while (main.firstChild) main.removeChild(main.firstChild); }
    main.appendChild(el);
    try { LC.util.focusMain(); } catch (e4) {}
  }

  /**
   * 診断テキスト。第 3 層のパネルと、診断画面(§7-7)の「診断結果をコピー」で共有する。
   * ★ LINE のスクショ 1 枚で「動かない」の切り分けが終わることが目標。
   */
  function buildDiagnosticsText(e) {
    var lines = [];
    function push(label, value) { lines.push(label + ': ' + value); }
    function json(v) {
      try { return JSON.stringify(v); } catch (err) { return '[unserializable]'; }
    }

    lines.push('--- つたわる English 診断情報 ---');
    push('日時', new Date().toISOString());
    push('appVersion', APP_VERSION);
    try { push('URL', location.href); } catch (x) {}
    try { push('UA', navigator.userAgent); } catch (x2) {}

    if (e) {
      if (e.reason !== undefined) {
        var r = e.reason;
        push('unhandledrejection', (r && r.message) ? r.message : String(r));
        if (r && r.stack) lines.push(String(r.stack).slice(0, 800));
      } else {
        push('error', String(e.message || e.type || e));
        if (e.filename) push('at', e.filename + ':' + e.lineno + ':' + e.colno);
        if (e.error && e.error.stack) lines.push(String(e.error.stack).slice(0, 800));
      }
    }

    push('state', json(stateGet()));
    try { push('loaded', ((LC.__loaded || []).join(', ')) || '(none)'); } catch (x3) {}
    try { push('storage', LC.store.getMode() + ' / ' + LC.store.estimateUsageBytes() + ' bytes'); } catch (x4) {}
    try { push('deckErrors', json(LC.catalog.getLoadErrors())); } catch (x5) {}
    try { push('tts', json(LC.speaker.getDiagnostics ? LC.speaker.getDiagnostics() : null)); } catch (x6) {}

    lines.push('--- log(直近) ---');
    try {
      if (LC.util && LC.util.getLogText) lines.push(LC.util.getLogText());
      else if (LC.util && LC.util.getLog) lines.push(json(LC.util.getLog()));
    } catch (x7) { lines.push('(log unavailable)'); }

    return lines.join('\n');
  }

  /* ==========================================================================
   * 7. ライフサイクル(仕様 §6-4)
   * ========================================================================== */

  /**
   * 音声を全部止める。
   * @returns {boolean} 実際に練習中(SPEAKING/GUARD/LISTENING)を止めたか
   */
  function stopEverything() {
    var wasBusy = false;
    var s = getActiveSession();
    if (s) {
      try { wasBusy = isBusyPhase(s.getPhase ? s.getPhase() : null); } catch (e) {}
      try { s.cancelAll(); } catch (e2) { logError('session.cancelAll', e2); }
    }
    try { LC.speaker.stopSpeaking(); } catch (e3) {}
    return wasBusy;
  }

  function flushAll() {
    /* 進行中のセッション記録があれば閉じてから書き出す(§11-3) */
    try {
      if (LC.tracker && LC.tracker.getCurrentSession && LC.tracker.getCurrentSession()) LC.tracker.endSession();
    } catch (e) { logError('tracker.endSession', e); }
    try { LC.store.flushAll(); } catch (e2) { logError('store.flushAll', e2); }
  }

  function wireLifecycle() {
    document.addEventListener('visibilitychange', function () {
      var hidden = document.hidden === true;
      patchRuntime({ hidden: hidden });
      if (!hidden) {
        refreshSettings();
        return;
      }
      /* 裏で認識・読み上げが動き続けると network エラーや暴走の原因になる。無条件で止める。 */
      var wasBusy = stopEverything();
      flushAll();
      /* 何も動いていなかったときにトーストを出すと、タブを戻すたびに邪魔になる。 */
      if (wasBusy) toast(APP_TEXT.stoppedByHidden, 'warn');
    }, false);

    /* bfcache とモバイルで確実に発火するので pagehide を主に使う。 */
    window.addEventListener('pagehide', function () {
      stopEverything();
      flushAll();
    }, false);

    window.addEventListener('beforeunload', function () {
      try { LC.speaker.stopSpeaking(); } catch (e) {}
    }, false);

    window.addEventListener('online', function () {
      patchRuntime({ online: true });
      setBanner('offline', false);
    }, false);

    window.addEventListener('offline', function () {
      patchRuntime({ online: false });
      setBanner('offline', true);
    }, false);

    window.addEventListener('error', onFatal, false);
    window.addEventListener('unhandledrejection', onFatal, false);
  }

  /* ==========================================================================
   * 8. 起動シーケンス
   * ========================================================================== */

  var booted = false;

  function findMissingModules() {
    var missing = [];
    for (var i = 0; i < REQUIRED_MODULES.length; i++) {
      var m = REQUIRED_MODULES[i];
      var ok = false;
      try { ok = m.ok() === true; } catch (e) { ok = false; }
      if (!ok) missing.push(m);
    }
    /* LC.__loaded は補助。名乗っていないだけで実体があるなら通す。 */
    return missing;
  }

  /** モジュールが足りない = 第 0 層と同じ「ファイルの読み込みに失敗しました」。 */
  function showLoadFailurePanel(missing) {
    LC.__bootFailed = true;                     /* 第 0 層の 8 秒パネルと二重表示しない */
    var names = [], files = {};
    for (var i = 0; i < missing.length; i++) {
      names.push(missing[i].name);
      files[missing[i].file] = true;
    }
    var fileList = [];
    for (var f in files) if (has(files, f)) fileList.push(f);

    var el = byId('bootFallback');
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);

    var hd = document.createElement('h1');
    hd.textContent = 'ファイルの読み込みに失敗しました';
    var p1 = document.createElement('p');
    p1.textContent = 'ページを再読み込みしてください。直らない場合は部のメンテ担当に連絡してください。';
    var p2 = document.createElement('p');
    p2.textContent = APP_TEXT.bootMissingItems + fileList.join(' / ') + '(' + names.join(', ') + ')';
    var p3 = document.createElement('p');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '再読み込み';
    btn.onclick = function () { try { location.reload(); } catch (e) {} };
    p3.appendChild(btn);
    var p4 = document.createElement('p');
    p4.textContent = '公開ページ: ' + PAGES_URL;

    el.appendChild(hd); el.appendChild(p1); el.appendChild(p2); el.appendChild(p3); el.appendChild(p4);
    el.hidden = false;
    el.style.display = 'block';
  }

  /** ?demo=1(仕様 §6-3)。判定は起動時 1 回だけで、途中変更はできない。 */
  function detectDemoMode() {
    var q = {};
    try { parseQuery(String(location.search || '').replace(/^\?/, ''), q); } catch (e) {}
    try {
      var hash = String(location.hash || '');
      var qi = hash.indexOf('?');
      if (qi >= 0) parseQuery(hash.slice(qi + 1), q);
    } catch (e2) {}
    var v = q.demo;
    return v === '1' || v === 'true' || v === 'on';
  }

  function showDemoBadge() {
    var badge = byId('hdrBadge');
    if (badge) badge.hidden = false;
  }

  function wireHeader() {
    var home = byId('hdrHome');
    if (home) home.addEventListener('click', function () { navigate('#/'); });
  }

  /** 起動中に #main が真っ白なのは不安なので、短い一言を置く。 */
  function showBootPlaceholder() {
    var main = byId('main');
    if (!main) return;
    try { LC.util.clear(main); } catch (e) { while (main.firstChild) main.removeChild(main.firstChild); }
    var p = document.createElement('p');
    p.className = 'boot-placeholder';
    p.textContent = t('common.loading', APP_TEXT.booting);
    main.appendChild(p);
  }

  /**
   * 致命的な非対応か(仕様 §10-2)。
   * ★ file: は致命にしない。警告帯だけ出して練習に進ませる。
   */
  function fatalBlockReason(env) {
    if (!env) return null;
    var reason = env.blockReason || null;
    if (env.isFileProtocol && (reason === 'file-protocol' || reason === 'insecure')) return null;
    if (reason) return reason;
    /* env が blockReason を返さない実装だった場合の保険 */
    try { if (!LC.env.getRecognitionCtor()) return 'no-recognition'; } catch (e) {}
    return null;
  }

  /** 非対応画面。§10-3 のとおり「音声なしでフレーズ集を見る」を必ず用意する。 */
  function mountBlocked(reason) {
    var main = byId('main');
    if (!main) return;
    leaveCurrentScreen(null);

    var view = null;
    if (LC.screens && LC.screens.blocked && typeof LC.screens.blocked.render === 'function') {
      try {
        view = LC.screens.blocked.render({
          params: { reason: reason },
          state: buildScreenState(),
          navigate: navigate,
          route: { name: 'blocked', params: { reason: reason } }
        });
      } catch (e) { logError('screen.blocked', e); view = null; }
    }

    if (!view || !view.el) {
      var b = null;
      try { b = LC.msg.blocker(reason); } catch (e2) {}
      if (!b) b = { title: 'このブラウザでは使えない機能があります', body: '', actions: [], url: null };
      /* browse-only は自前の onClick にする。ハッシュが既に '#/' のときは
         location.hash を書いても hashchange が来ず、何も起きないため。 */
      var rest = [];
      var srcActions = b.actions || [];
      for (var ai = 0; ai < srcActions.length; ai++) {
        if (srcActions[ai] !== 'browse-only') rest.push(srcActions[ai]);
      }
      var el;
      try {
        el = LC.ui.errorPanel({
          title: b.title,
          body: b.body,
          tone: 'fatal',
          url: b.url,
          actions: [
            { key: 'browse-only', label: t('error.browseOnly', '音声なしでフレーズ集を見る'),
              primary: true, onClick: function () { navigate('#/'); } }
          ].concat(rest)
        });
      } catch (e3) {
        el = document.createElement('section');
        el.className = 'panel-error';
        var hd = document.createElement('h2');
        hd.textContent = b.title;
        el.appendChild(hd);
      }
      view = { el: el, title: b.title, destroy: null, onKey: null };
    }

    currentScreen = view;
    currentRoute = { name: 'blocked', params: {} };
    currentKey = 'blocked';

    try { LC.util.clear(main); } catch (e4) { while (main.firstChild) main.removeChild(main.firstChild); }
    main.appendChild(view.el);
    setDocumentTitle(view.title);
    try { LC.util.focusMain(); } catch (e5) {}
  }

  /**
   * 音声の準備。
   * ★ loadVoices() を await するが、失敗しても必ず先に進む(reject しない実装だが二重に守る)。
   */
  function initSpeaker() {
    return new Promise(function (resolve) {
      var done = false;
      function finish() { if (done) return; done = true; resolve(); }
      /* loadVoices が返らない実装事故に備えた上限。3 秒タイムアウト + 余裕。 */
      var cap = setTimeout(finish, 4000);

      try { if (LC.speaker.init) LC.speaker.init(); } catch (e) { logError('speaker.init', e); }

      var p = null;
      try { p = LC.speaker.loadVoices ? LC.speaker.loadVoices({ timeout: 3000 }) : null; }
      catch (e2) { logError('speaker.loadVoices', e2); }

      if (!p || typeof p.then !== 'function') {
        applyVoices([]);
        clearTimeout(cap);
        finish();
        return;
      }
      p.then(function (voices) { applyVoices(voices || []); },
             function (err) { logError('speaker.loadVoices.reject', err); applyVoices([]); })
       .then(function () { clearTimeout(cap); finish(); },
             function () { clearTimeout(cap); finish(); });
    });
  }

  function applyVoices(voices) {
    var list = voices || [];
    try {
      var saved = null;
      try { saved = (LC.settings.get() || {}).voice || null; } catch (e0) {}
      var v = null;
      if (LC.speaker.resolveSavedVoice) v = LC.speaker.resolveSavedVoice(list, saved);
      if (!v && LC.speaker.pickDefaultVoice) {
        var lang = 'en-US';
        try { lang = (LC.settings.get() || {}).lang || 'en-US'; } catch (e1) {}
        v = LC.speaker.pickDefaultVoice(list, lang);
      }
      /* ★英語音声が 0 個なら null。日本語音声で英語を読ませることは絶対にしない。 */
      if (v && LC.speaker.setActiveVoice) LC.speaker.setActiveVoice(v);
    } catch (e) { logError('voice.resolve', e); }

    var raw = null;
    try { raw = LC.speaker.getVoiceSummary ? LC.speaker.getVoiceSummary() : null; } catch (e2) {}
    raw = raw || {};
    /* ★ SpeechSynthesisVoice の実体を state に入れない。{name, lang} に落として持つ。 */
    var summary = {
      ready: raw.ready === true,
      total: typeof raw.total === 'number' ? raw.total : list.length,
      englishCount: typeof raw.englishCount === 'number' ? raw.englishCount : 0,
      hasOfflineEnglish: raw.hasOfflineEnglish === true,
      selected: raw.selected ? { name: String(raw.selected.name || ''), lang: String(raw.selected.lang || '') } : null
    };
    stateSet({ voice: summary });
    updateVoiceBanner(summary);
  }

  /** 初回オンボーディングが必要か(lc.flags.v1 の onboardedAt)。 */
  function needsOnboarding() {
    var f = getFlags();
    return !(f && f.onboardedAt);
  }

  function getFlags() {
    try {
      var store = LC.store.stores && LC.store.stores.flags;
      if (store && typeof store.get === 'function') return store.get() || {};
    } catch (e) { logError('flags.get', e); }
    return {};
  }

  function updateFlags(patch) {
    try {
      var store = LC.store.stores && LC.store.stores.flags;
      if (store && typeof store.update === 'function') {
        return store.update(function (cur) { return mergeInto(cur || {}, patch || {}); });
      }
    } catch (e) { logError('flags.update', e); }
    return false;
  }

  /** オンボーディングを終えたときに画面側から呼べる導線(呼ばれなくても動く)。 */
  function completeOnboarding() {
    updateFlags({ onboardedAt: Date.now() });
    navigate('#/');
  }

  /** lc.meta.v1 の最終起動時刻を更新する(§11-1)。 */
  function touchMeta() {
    try {
      var store = LC.store.stores && LC.store.stores.meta;
      if (!store || typeof store.update !== 'function') return;
      store.update(function (cur) {
        var m = mergeInto(cur || {}, {});
        if (!m.createdAt) m.createdAt = Date.now();
        m.lastOpenedAt = Date.now();
        m.appVersion = APP_VERSION;
        return m;
      });
    } catch (e) { logError('meta.touch', e); }
  }

  function startRouter() {
    if (routerStarted) return;
    routerStarted = true;
    window.addEventListener('hashchange', onHashChange, false);
    document.addEventListener('keydown', onKeyDown, false);
  }

  function finishBoot() {
    LC.__bootOk = true;
    var fb = byId('bootFallback');
    if (fb) { fb.hidden = true; fb.style.display = 'none'; }
    if (stateCurrent.lifecycle === 'booting') stateSet({ lifecycle: 'ready' });
    log('app.ready', { route: stateCurrent.route, demo: stateCurrent.demoMode });
  }

  function boot() {
    if (booted) return;
    booted = true;

    /* --- 1. モジュールの存在確認(実体で判定。__loaded は補助) --- */
    var missing = findMissingModules();
    if (missing.length) {
      showLoadFailurePanel(missing);
      return;
    }

    injectPagesUrl();
    wireHeader();
    wireSkipLink();
    wireLifecycle();
    wrapSettingsWriters();

    try {
      if (LC.store.onDegraded) {
        LC.store.onDegraded(function (mode, reason) {
          log('store.degraded', { mode: mode, reason: reason });
          updateStorageBanner();
        });
      }
    } catch (e) { logError('store.onDegraded', e); }

    /* --- 2. 体験モード(§6-3) --- */
    var demo = detectDemoMode();
    if (demo) {
      try { LC.store.setDemoMode(true); } catch (e2) { logError('store.setDemoMode', e2); }
      showDemoBadge();
    }
    stateSet({ demoMode: demo });

    /* --- 設定ミラーとテーマ --- */
    refreshSettings();
    applyTheme((stateCurrent.settings || {}).theme);
    stateSelect(function (s) { return s.settings ? s.settings.theme : null; }, applyTheme);

    if (!demo) touchMeta();

    /* --- 3. 環境検出(§10-2) --- */
    var env = null;
    try { env = LC.env.detect(); } catch (e3) { logError('env.detect', e3); }
    if (env) stateSet({ env: env });
    patchRuntime({
      online: !(navigator && navigator.onLine === false),
      hidden: document.hidden === true
    });
    var deckErrors = [];
    try { deckErrors = LC.catalog.getLoadErrors() || []; } catch (e4) {}
    patchHealth({ deckLoadErrors: deckErrors });
    if (deckErrors.length) log('catalog.loadErrors', deckErrors);

    showBootPlaceholder();

    var blockReason = fatalBlockReason(env);
    if (blockReason) {
      stateSet({ lifecycle: 'blocked' });
      /* 非対応でもルーターは動かす。「音声なしでフレーズ集を見る」から先へ進めるようにするため。 */
      startRouter();
      mountBlocked(blockReason);
      updateEnvBanners(env);
      finishBoot();
      return;
    }

    updateEnvBanners(env);

    /* --- 4. 音声の準備 → 5. 初回表示 --- */
    initSpeaker().then(function () {
      startRouter();
      if (needsOnboarding()) navigate('#/onboarding', { replace: true });
      else handleRoute(true);
      finishBoot();
      queryMicPermission();
    }, function (err) {
      /* initSpeaker は reject しない実装だが、それでも起動は止めない。 */
      logError('boot.initSpeaker', err);
      startRouter();
      handleRoute(true);
      finishBoot();
    });
  }

  function queryMicPermission() {
    try {
      var p = LC.env.queryMicPermission();
      if (!p || typeof p.then !== 'function') return;
      p.then(function (statusValue) { patchRuntime({ micPermission: statusValue }); },
             function () { /* reject しない実装 */ });
    } catch (e) { logError('env.queryMicPermission', e); }
  }

  /* ==========================================================================
   * 9. 公開 API
   * ========================================================================== */

  LC.app = {
    /* ルーター */
    navigate: navigate,
    replace: function (hash) { navigate(hash, { replace: true }); },
    reRender: function () { handleRoute(true); },
    getRoute: function () { return stateCurrent.route; },
    resolveRoute: resolveRoute,            /* テスト用に公開(純関数) */

    /* 練習セッションの登録(練習画面が create したものを渡すと、
       画面遷移・タブ非表示・致命エラーのときに確実に止められる) */
    setActiveSession: setActiveSession,
    getActiveSession: getActiveSession,

    /* 警告帯 */
    setBanner: setBanner,
    refreshBanners: renderBanners,

    /* 設定・フラグ */
    refreshSettings: refreshSettings,
    applyTheme: applyTheme,
    getFlags: getFlags,
    updateFlags: updateFlags,
    completeOnboarding: completeOnboarding,

    /* 診断・エラー */
    buildDiagnosticsText: buildDiagnosticsText,
    showFatal: onFatal,

    APP_VERSION: APP_VERSION,
    PAGES_URL: PAGES_URL
  };

  LC.__loaded = (LC.__loaded || []).concat(['state', 'app']);

  /* すべての script は body 末尾で同期読み込みされるので、通常ここで DOM は完成している。
     念のため readyState も見る。 */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, false);
  } else {
    boot();
  }
})(window.LC);

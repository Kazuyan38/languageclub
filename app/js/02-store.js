/* js/02-store.js
 * 保存(LC.store)/ 環境検出(LC.env)/ 設定(LC.settings)
 *
 * 対応する仕様: §5-3(LC.store)、§5-4(LC.env)、§5-5(LC.settings)、
 *               §10-2(第 1 層の判定表)、§11(localStorage スキーマ)
 *
 * このファイルの不変ルール(§3-1):
 *   - localStorage に触れてよいのはこのファイルだけ。
 *   - DOM に一切触らない(= テスト可能に保つ)。トースト/ログは LC.util 経由。
 *   - 公開関数は例外を投げない。非同期は reject せず必ず結果オブジェクトで resolve する。
 *
 * 依存: LC.util(toast / log)、LC.msg(文言)。それ以外に依存しない。
 */
window.LC = window.LC || {};
(function (LC) {
  'use strict';

  /* =====================================================================
   * 0. 共通の小道具
   * ===================================================================== */

  var hasOwn = Object.prototype.hasOwnProperty;

  function own(obj, key) {
    return !!obj && hasOwn.call(obj, key);
  }

  /** LC.util.log があれば流す。無くても落ちない。 */
  function log(tag, obj) {
    try {
      if (LC.util && typeof LC.util.log === 'function') LC.util.log(tag, obj);
    } catch (e) { /* ログで落ちるのが一番くだらないので握り潰す */ }
  }

  /** LC.util.toast があれば出す。無くても落ちない。 */
  function toast(text, type) {
    try {
      if (LC.util && typeof LC.util.toast === 'function') {
        LC.util.toast(text, { type: type || 'info' });
      }
    } catch (e) { /* 同上 */ }
  }

  /**
   * 文言は LC.msg に集約する(絶対規則 9)が、このモジュールは 01-util.js より
   * あとに読まれるだけで、キーが定義されている保証まではない。
   * LC.msg.t() は未定義キーでキー文字列をそのまま返す仕様(§5-2)なので、
   * 「キーがそのまま返ってきた = 未定義」とみなして日本語の既定文へフォールバックする。
   * これで文言の一元管理を壊さずに、キー名がむき出しでユーザーに出る事故だけを防ぐ。
   */
  function text(key, fallbackText) {
    try {
      if (LC.msg && typeof LC.msg.t === 'function') {
        var s = LC.msg.t(key);
        if (typeof s === 'string' && s && s !== key) return s;
      }
    } catch (e) { /* noop */ }
    return fallbackText;
  }

  /** JSON 経由の素朴なディープコピー。関数・循環は落ちる代わりに安全側へ倒す。 */
  function cloneValue(v) {
    if (v === null || typeof v !== 'object') return v;
    try {
      return JSON.parse(JSON.stringify(v));
    } catch (e) {
      return Array.isArray(v) ? [] : {};
    }
  }

  /** 例外を投げない JSON.stringify。失敗したら null。 */
  function safeStringify(v) {
    try {
      var s = JSON.stringify(v);
      return typeof s === 'string' ? s : null;
    } catch (e) {
      return null;
    }
  }

  /** null / 配列 / オブジェクト の「種類」が一致するか(型の取り違えを弾く用) */
  function sameFamily(a, b) {
    if ((a === null) !== (b === null)) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    return typeof a === typeof b;
  }


  /* =====================================================================
   * 1. LC.store — localStorage 抽象(仕様 §5-3 / §11)
   * ===================================================================== */

  /* 封筒 Envelope = { v:number, at:number, data:* }(§11-2)
   * ※ JSDoc の入れ子中カッコは GitHub Pages(Jekyll/Liquid)が変数展開と誤認するため、
   *   このファイルでは `{` を 2 つ続けて書かない。 */

  /* §11-1 のキー一覧。ここ以外にキー文字列を書かない。 */
  var KEYS = {
    meta:        'lc.meta.v1',
    flags:       'lc.flags.v1',
    settings:    'lc.settings.v1',
    progress:    'lc.progress.v1',
    wordstats:   'lc.wordstats.v1',
    sessions:    'lc.sessions.v1',
    customdecks: 'lc.customdecks.v1'
  };

  var KEY_PREFIX = 'lc.';
  var PROBE_KEY = 'lc.__probe__';
  var DEFAULT_DEBOUNCE_MS = 400;   /* §11-3: progress / wordstats は 400ms デバウンス */

  /* モジュール状態 */
  var mode = 'persistent';         /* 'persistent' | 'memory' | 'readonly' */
  var modeReason = null;           /* 'unavailable' | 'quota' | 'write-failed' | 'future-version' */
  var demoMode = false;            /* §6-3 体験モード。true で全書き込みが no-op */
  var availableCache = null;       /* isAvailable() のキャッシュ */
  var memoryBox = {};              /* memory モードでの器(key → 封筒 JSON 文字列) */
  var registry = {};               /* key → store 内部オブジェクト */
  var degradedCbs = [];
  var corruptNotified = false;     /* 破損トーストは 1 回だけ(§5-3) */
  var readonlyNotified = false;
  var degradeNotified = false;

  /* --- 縮退の通知 ------------------------------------------------------ */

  /**
   * モードを縮退させる。
   * @param {'memory'|'readonly'} next
   * @param {string} reason
   * @param {boolean} notify トーストを出すか(起動時の検出では出さず、帯に任せる)
   */
  function degrade(next, reason, notify) {
    /* memory は最も強い縮退。readonly から memory への遷移は許すが逆は許さない。 */
    if (mode === 'memory' && next === 'readonly') return;
    if (mode === next && modeReason === reason) return;
    mode = next;
    modeReason = reason;
    log('store.degrade', { mode: mode, reason: reason });

    if (notify) {
      if (next === 'memory' && !degradeNotified) {
        degradeNotified = true;
        toast(text('store.memoryMode',
          'この端末では記録を保存できなくなりました。練習は続けられます。'), 'warn');
      }
      if (next === 'readonly' && !readonlyNotified) {
        readonlyNotified = true;
        toast(text('store.readonly',
          'アプリが古い可能性があります。Ctrl+Shift+R で再読み込みしてください'), 'warn');
      }
    }
    emitDegraded();
  }

  function emitDegraded() {
    for (var i = 0; i < degradedCbs.length; i++) {
      try { degradedCbs[i](mode, modeReason); } catch (e) { log('store.onDegraded.error', String(e)); }
    }
  }

  /** 破損の通知は全キー合わせて 1 回だけ(§5-3)。 */
  function notifyCorrupt(key) {
    log('store.corrupt', { key: key });
    if (corruptNotified) return;
    corruptNotified = true;
    toast(text('store.corrupted',
      '保存されていた記録の一部を読み込めませんでした。初期状態に戻しました。'), 'warn');
  }

  /* --- 生の localStorage アクセス(ここより下に localStorage を書かない) --- */

  /*
   * memoryBox は localStorage の「上書きオーバーレイ」として扱う。
   * 途中で memory モードに落ちた場合でも、まだ読み込んでいないキーは
   * localStorage 側に残っている本物の記録を読めるようにするため
   * (先に memoryBox、無ければ localStorage、の順)。
   */
  function rawGet(key) {
    if (own(memoryBox, key)) return memoryBox[key];
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      /* プライベートモードや設定でブロックされた場合。読めない = 記録なし扱い。 */
      degrade('memory', 'unavailable', false);
      return null;
    }
  }

  /** QuotaExceededError かどうか。ブラウザごとに名前・コードが違う。 */
  function isQuotaError(e) {
    if (!e) return false;
    return e.name === 'QuotaExceededError' ||
           e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
           e.code === 22 || e.code === 1014;
  }

  /** @returns {'ok'|'quota'|'fatal'} */
  function rawWrite(key, json) {
    try {
      window.localStorage.setItem(key, json);
      return 'ok';
    } catch (e) {
      return isQuotaError(e) ? 'quota' : 'fatal';
    }
  }

  function rawRemove(key) {
    try {
      window.localStorage.removeItem(key);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** アプリが所有する 'lc.' 始まりのキーを列挙する。 */
  function ownKeys() {
    var out = [];
    try {
      var ls = window.localStorage;
      for (var i = 0; i < ls.length; i++) {
        var k = ls.key(i);
        if (typeof k === 'string' && k.indexOf(KEY_PREFIX) === 0 && k !== PROBE_KEY) out.push(k);
      }
    } catch (e) { /* 読めないなら空 */ }
    return out;
  }

  /* --- 容量超過時の prune(仕様 §5-3 の順序を変えないこと) --------------- */

  /*
   * 固定順序:
   *   1. lc.sessions.v1   を最新 100 件に切り詰め
   *   2. lc.wordstats.v1  を attempts 降順で上位 300 語に
   *   3. lc.sessions.v1   を空に
   *   4. lc.wordstats.v1  を空に
   *   5. すべて失敗 → memory モードへ退避
   *
   * progress(優先度 3)と customdecks(優先度 4)は自動 prune の対象にしない。
   * どちらもユーザーが作った成果物で、黙って消すと信頼を失うため。
   * 想定合計は 90KB 程度(§11-1)で 5MB に対し十分な余裕があり、
   * ここまで来る時点で他アプリが容量を食っている異常事態である。
   */
  var PRUNE_PLAN = [
    { key: KEYS.sessions,  level: 1 },
    { key: KEYS.wordstats, level: 1 },
    { key: KEYS.sessions,  level: 2 },
    { key: KEYS.wordstats, level: 2 }
  ];

  /** sessions: 新しいものが末尾のリングバッファ(§11-2)。 */
  function pruneSessions(data, level) {
    if (!Array.isArray(data)) return null;
    if (level >= 2) return data.length ? [] : null;
    if (data.length <= 100) return null;          /* 削れない = このステップは効果なし */
    return data.slice(data.length - 100);
  }

  /** wordstats: a = attempts。挑戦回数が多い語ほど統計として価値が高いので残す。 */
  function pruneWordStats(data, level) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    if (level >= 2) {
      for (var any in data) { if (own(data, any)) return {}; }
      return null;
    }
    var words = [];
    for (var w in data) { if (own(data, w)) words.push(w); }
    if (words.length <= 300) return null;
    words.sort(function (x, y) {
      var ax = (data[x] && typeof data[x].a === 'number') ? data[x].a : 0;
      var ay = (data[y] && typeof data[y].a === 'number') ? data[y].a : 0;
      return ay - ax;
    });
    var out = {};
    for (var i = 0; i < 300; i++) out[words[i]] = data[words[i]];
    return out;
  }

  /**
   * prune を 1 段階だけ実行する。
   * ★ ここから persistNow() を呼び返してはいけない(無限再帰になる)。
   *    書き込みは rawWrite の 1 回だけに留める。
   */
  function applyPruneStep(step) {
    var st = registry[step.key];
    if (!st || typeof st.pruneFn !== 'function') return false;

    var cur = readInto(st);
    var next;
    try {
      next = st.pruneFn(cur, step.level);
    } catch (e) {
      log('store.prune.error', { key: st.key, error: String(e) });
      return false;
    }
    if (next === null || typeof next === 'undefined') return false;

    st.cache = next;
    st.loaded = true;
    var json = safeStringify({ v: st.version, at: Date.now(), data: next });
    if (json === null) return false;

    /* 先に消してから書く。書き込みに失敗しても「容量を空ける」目的は達成される。 */
    rawRemove(st.key);
    rawWrite(st.key, json);
    log('store.prune', { key: st.key, level: step.level });
    return true;
  }

  /* --- 封筒の読み書き --------------------------------------------------- */

  function resolveFallback(st) {
    var f = st.fallbackSpec;
    if (typeof f === 'function') {
      try { return f(); } catch (e) { return {}; }
    }
    return cloneValue(f);
  }

  function envelopeJson(st) {
    return safeStringify({ v: st.version, at: Date.now(), data: st.cache });
  }

  /**
   * 初回アクセス時に localStorage から読み込む。以降はキャッシュを返す。
   * 読み込みの規則(§5-3):
   *   - JSON パース失敗           → fallback で初期化しトーストで 1 回だけ通知
   *   - v < version               → migrate(data, v)。null が返れば fallback
   *   - v > version               → 触らない。readonly モードで一切書かない
   */
  function readInto(st) {
    if (st.loaded) return st.cache;
    st.loaded = true;

    var raw = rawGet(st.key);
    if (raw === null || typeof raw === 'undefined') {
      st.cache = resolveFallback(st);
      return st.cache;
    }

    var env = null;
    try {
      env = JSON.parse(raw);
    } catch (e) {
      notifyCorrupt(st.key);
      st.cache = resolveFallback(st);
      return st.cache;
    }

    /* 封筒の形をしていないものは破損扱い。 */
    if (!env || typeof env !== 'object' || Array.isArray(env) || typeof env.v !== 'number') {
      notifyCorrupt(st.key);
      st.cache = resolveFallback(st);
      return st.cache;
    }

    if (env.v > st.version) {
      /*
       * 新しいバージョンのアプリが書いた記録。
       * 古いキャッシュで開いた人が新しい記録を壊さないよう、書き込みを全面停止する。
       * 読むだけは許すが、形が違う可能性があるので種類が合わないときは fallback を返す。
       */
      degrade('readonly', 'future-version', true);
      var fb = resolveFallback(st);
      st.cache = sameFamily(env.data, fb) ? env.data : fb;
      return st.cache;
    }

    if (env.v < st.version) {
      var migrated = null;
      if (typeof st.migrate === 'function') {
        try {
          migrated = st.migrate(env.data, env.v);
        } catch (e) {
          log('store.migrate.error', { key: st.key, error: String(e) });
          migrated = null;
        }
      }
      if (migrated === null || typeof migrated === 'undefined') {
        st.cache = resolveFallback(st);
      } else {
        st.cache = migrated;
      }
      /* 移行結果を書き戻して、次回以降は移行を走らせない。失敗しても実害はない。 */
      st.dirty = true;
      persistNow(st);
      return st.cache;
    }

    /* 同一バージョン。data が undefined のものは fallback。 */
    st.cache = (typeof env.data === 'undefined') ? resolveFallback(st) : env.data;
    return st.cache;
  }

  /**
   * 現在のキャッシュを localStorage に書く。書けなければ段階的に prune する。
   * @returns {boolean} 永続化できたら true
   */
  function persistNow(st) {
    st.dirty = false;

    /* 体験モード・readonly では localStorage に一切触らない(§6-3 / §5-3)。 */
    if (demoMode || mode === 'readonly') return false;

    var json = envelopeJson(st);
    if (json === null) {
      log('store.serialize.failed', { key: st.key });
      return false;
    }

    if (mode === 'memory') {
      memoryBox[st.key] = json;
      return false;
    }

    var r = rawWrite(st.key, json);
    if (r === 'ok') {
      /* 書けたらオーバーレイの古い値を捨てる(次回の読み込みで本物を見に行かせる) */
      if (own(memoryBox, st.key)) delete memoryBox[st.key];
      return true;
    }
    if (r === 'fatal') {
      memoryBox[st.key] = json;
      degrade('memory', 'write-failed', true);
      return false;
    }

    /* ここから容量超過。§5-3 の順序どおりに 4 段階 prune し、都度書き直す。 */
    for (var i = 0; i < PRUNE_PLAN.length; i++) {
      applyPruneStep(PRUNE_PLAN[i]);
      /* ★ 自分自身が prune 対象だった場合に備え、毎回キャッシュから作り直す。
       *    使い回すと prune 前の巨大な値を書き戻してしまう。 */
      json = envelopeJson(st);
      if (json === null) break;
      r = rawWrite(st.key, json);
      if (r === 'ok') {
        if (own(memoryBox, st.key)) delete memoryBox[st.key];
        return true;
      }
      if (r === 'fatal') break;
    }

    /* 5 段階目: すべて失敗 → memory モードへ退避。練習は続けられる。 */
    memoryBox[st.key] = json === null ? '' : json;
    degrade('memory', 'quota', true);
    return false;
  }

  function cancelPending(st) {
    if (st.timer !== null) {
      clearTimeout(st.timer);
      st.timer = null;
    }
  }

  /* --- createStore ------------------------------------------------------ */

  /**
   * ストアを 1 つ作る。
   * spec = { key, version, fallback(値または生成関数), migrate(data, v), prune(data, level),
   *          priority, debounceMs }
   * 戻り値 = { get, set, update, updateDebounced, setDebounced, flush, reset,
   *            key, version, priority }
   */
  function createStore(spec) {
    spec = spec || {};
    var st = {
      key: String(spec.key || ('lc.anon.' + Math.random().toString(36).slice(2))),
      version: typeof spec.version === 'number' ? spec.version : 1,
      fallbackSpec: own(spec, 'fallback') ? spec.fallback : {},
      migrate: typeof spec.migrate === 'function' ? spec.migrate : null,
      pruneFn: typeof spec.prune === 'function' ? spec.prune : null,
      priority: typeof spec.priority === 'number' ? spec.priority : 0,
      debounceMs: typeof spec.debounceMs === 'number' ? spec.debounceMs : DEFAULT_DEBOUNCE_MS,
      cache: null,
      loaded: false,
      dirty: false,
      timer: null
    };

    var api = {
      key: st.key,
      version: st.version,
      priority: st.priority,

      /** 現在値。参照を返すので、書き換えたら必ず set/update で保存すること。 */
      get: function () {
        return readInto(st);
      },

      /**
       * 値を差し替える。
       * 戻り値は「その値が現在値として反映されたか」。
       * localStorage に実際に書けたかは LC.store.getMode() で判断する
       * (体験モード / memory / readonly では反映のみで永続化しない)。
       */
      set: function (value) {
        if (typeof value === 'undefined') return false;
        readInto(st);                 /* 先に読み込みを済ませ、後から上書きされないようにする */
        st.cache = value;
        st.loaded = true;
        cancelPending(st);
        /* 戻り値は「永続化できたか」。体験モード / readonly / memory では false になる。
         * この場では読めるので画面は動くが、呼び出し側が「保存された」と誤解しないようにする。 */
        return persistNow(st);
      },

      /** fn(現在値) の戻り値を新しい値にする。undefined を返したら in-place 変更とみなす。 */
      update: function (fn) {
        if (typeof fn !== 'function') return false;
        var cur = readInto(st);
        var next;
        try {
          next = fn(cur);
        } catch (e) {
          log('store.update.error', { key: st.key, error: String(e) });
          return false;
        }
        return api.set(typeof next === 'undefined' ? cur : next);
      },

      /** 400ms デバウンスで保存(§11-3 の progress / wordstats 用)。値は即座に反映される。 */
      setDebounced: function (value) {
        if (typeof value === 'undefined') return false;
        readInto(st);
        st.cache = value;
        st.loaded = true;
        st.dirty = true;
        cancelPending(st);
        st.timer = setTimeout(function () {
          st.timer = null;
          persistNow(st);
        }, st.debounceMs);
        return true;
      },

      /** update のデバウンス版。 */
      updateDebounced: function (fn) {
        if (typeof fn !== 'function') return false;
        var cur = readInto(st);
        var next;
        try {
          next = fn(cur);
        } catch (e) {
          log('store.update.error', { key: st.key, error: String(e) });
          return false;
        }
        return api.setDebounced(typeof next === 'undefined' ? cur : next);
      },

      /** 保留中のデバウンス書き込みを今すぐ行う。 */
      flush: function () {
        var had = st.timer !== null || st.dirty;
        cancelPending(st);
        if (!had) return false;
        return persistNow(st);
      },

      /**
       * 初期値に戻し、キーごと削除する。
       * @returns {boolean} localStorage の中身まで実際に消せたか。
       *   ★消去はユーザーの明示的な操作なので、memory モードでも実際に消しに行く。
       *     消せていないのに true を返すと、画面が「記録を消しました」と嘘をつき、
       *     共有 PC で前の人の記録が残ったままになる。
       *   体験モード(?demo=1)は「この端末に何も書かない」約束なので、
       *     他人の記録を代わりに消すこともしない。false を返して画面に伝える。
       *   readonly(= 自分より新しいバージョンが書いたデータ)も壊さない。
       */
      reset: function () {
        cancelPending(st);
        st.cache = resolveFallback(st);
        st.loaded = true;
        st.dirty = false;
        if (own(memoryBox, st.key)) delete memoryBox[st.key];
        if (demoMode || mode === 'readonly') return false;
        return rawRemove(st.key);
      }
    };

    registry[st.key] = st;
    return api;
  }

  /* --- 可用性の判定 ----------------------------------------------------- */

  /**
   * 実際に書き込みテストして判定する。
   * プライベートモードの Safari のように「localStorage は存在するが setItem が投げる」
   * 環境があるため、存在チェックだけでは足りない。
   */
  function isAvailable() {
    if (availableCache !== null) return availableCache;
    availableCache = false;
    try {
      var ls = window.localStorage;
      if (!ls) return availableCache;
      ls.setItem(PROBE_KEY, '1');
      var ok = ls.getItem(PROBE_KEY) === '1';
      ls.removeItem(PROBE_KEY);
      availableCache = ok;
    } catch (e) {
      availableCache = false;
    }
    return availableCache;
  }

  /* --- 全体操作 --------------------------------------------------------- */

  /** UTF-16 なので 1 文字 2 バイトで概算する。キー名の分も足す。 */
  function estimateUsageBytes() {
    var bytes = 0;
    var seen = {};
    try {
      var ls = window.localStorage;
      var keys = ownKeys();
      for (var i = 0; i < keys.length; i++) {
        var v = ls.getItem(keys[i]);
        seen[keys[i]] = true;
        bytes += (keys[i].length + (v === null ? 0 : v.length)) * 2;
      }
    } catch (e) { /* 読めないなら localStorage 分は 0 */ }
    for (var mk in memoryBox) {
      if (own(memoryBox, mk) && !seen[mk]) bytes += (mk.length + String(memoryBox[mk]).length) * 2;
    }
    return bytes;
  }

  function flushAll() {
    var ok = true;
    for (var k in registry) {
      if (!own(registry, k)) continue;
      var st = registry[k];
      var had = st.timer !== null || st.dirty;
      cancelPending(st);
      if (had && !persistNow(st)) ok = false;
    }
    return ok;
  }

  /**
   * アプリが持つ記録をすべて消す。
   * 体験モードでも実際に削除する。ユーザーが 2 段階確認を経て明示的に押す破壊操作であり、
   * 「保存しない」約束と「消させない」ことは別だから(§7-5 / R12)。
   */
  function clearAll() {
    var ok = true;
    for (var k in registry) {
      if (own(registry, k)) cancelPending(registry[k]);
    }
    var keys = ownKeys();
    for (var i = 0; i < keys.length; i++) {
      if (!rawRemove(keys[i])) ok = false;
    }
    memoryBox = {};
    for (var k2 in registry) {
      if (!own(registry, k2)) continue;
      registry[k2].cache = resolveFallback(registry[k2]);
      registry[k2].loaded = true;
      registry[k2].dirty = false;
    }
    settingsCache = null;   /* LC.settings のキャッシュも作り直させる */
    log('store.clearAll', { ok: ok });
    return ok;
  }

  /** 診断・引っ越し用。JSON 文字列を返す。 */
  function exportAll() {
    var out = {
      app: 'tsutawaru-english',
      exportedAt: Date.now(),
      mode: mode,
      data: {}
    };
    for (var name in KEYS) {
      if (!own(KEYS, name)) continue;
      var key = KEYS[name];
      var raw = rawGet(key);
      if (raw === null || typeof raw === 'undefined') continue;
      try {
        out.data[key] = JSON.parse(raw);
      } catch (e) { /* 壊れている封筒は書き出さない */ }
    }
    var s = safeStringify(out);
    return s === null ? '{"app":"tsutawaru-english","data":{}}' : s;
  }

  /**
   * exportAll() の出力を読み込む。文字列でもオブジェクトでも受ける。
   * 戻り値 = { ok:boolean, imported:string[], skipped:string[], errors:string[] }
   */
  function importAll(json) {
    var res = { ok: false, imported: [], skipped: [], errors: [] };
    var obj = json;
    if (typeof json === 'string') {
      try {
        obj = JSON.parse(json);
      } catch (e) {
        res.errors.push('読み込める形式ではありません(JSON として解釈できません)');
        return res;
      }
    }
    if (!obj || typeof obj !== 'object' || !obj.data || typeof obj.data !== 'object') {
      res.errors.push('このアプリの書き出しデータではありません');
      return res;
    }
    if (demoMode || mode === 'readonly') {
      res.errors.push('いまは記録を保存できない状態です');
      return res;
    }

    var known = {};
    for (var n in KEYS) { if (own(KEYS, n)) known[KEYS[n]] = true; }

    for (var key in obj.data) {
      if (!own(obj.data, key)) continue;
      if (!known[key]) { res.skipped.push(key); continue; }
      var env = obj.data[key];
      if (!env || typeof env !== 'object' || typeof env.v !== 'number') {
        res.errors.push(key + ' の形式が不正です');
        continue;
      }
      var st = registry[key];
      if (!st) { res.skipped.push(key); continue; }
      if (env.v > st.version) { res.errors.push(key + ' は新しいバージョンの記録です'); continue; }

      cancelPending(st);
      st.loaded = true;
      st.cache = (typeof env.data === 'undefined') ? resolveFallback(st) : env.data;
      /* v < version なら次回読み込み時ではなく今ここで移行しておく */
      if (env.v < st.version && typeof st.migrate === 'function') {
        try {
          var m = st.migrate(st.cache, env.v);
          st.cache = (m === null || typeof m === 'undefined') ? resolveFallback(st) : m;
        } catch (e) {
          st.cache = resolveFallback(st);
        }
      }
      persistNow(st);
      res.imported.push(key);
    }
    settingsCache = null;
    res.ok = res.imported.length > 0;
    log('store.importAll', res);
    return res;
  }

  /**
   * 縮退(memory / readonly)を購読する。
   * すでに縮退済みなら、登録直後に非同期で 1 回だけ現在の状態を通知する
   * (起動シーケンスの都合で購読が後追いになるため)。
   * @returns {function():void} 解除関数
   */
  function onDegraded(cb) {
    if (typeof cb !== 'function') return function () {};
    degradedCbs.push(cb);
    if (mode !== 'persistent') {
      setTimeout(function () {
        try { cb(mode, modeReason); } catch (e) { /* noop */ }
      }, 0);
    }
    return function () {
      var i = degradedCbs.indexOf(cb);
      if (i >= 0) degradedCbs.splice(i, 1);
    };
  }

  /**
   * 体験モード(§6-3)。true にすると全書き込みが no-op になる。
   * 読み込みは従来どおり動く(仕様どおり)。起動時 1 回だけ呼ばれ、途中変更しない。
   */
  function setDemoMode(on) {
    demoMode = !!on;
    if (demoMode) {
      /* 保留中のデバウンス書き込みを取り消す。
       * これが無いと「?demo=1 で localStorage への書き込みが 1 度も発生しない」が崩れる。 */
      for (var k in registry) {
        if (own(registry, k)) { cancelPending(registry[k]); registry[k].dirty = false; }
      }
    }
    log('store.demoMode', { on: demoMode });
    return demoMode;
  }

  /** 現在のモードを人間向けの一文にする(帯・診断画面用)。 */
  function describeMode() {
    if (mode === 'memory') {
      return modeReason === 'unavailable'
        ? text('store.unavailable', 'この端末では記録を保存できません。練習は続けられます。')
        : text('store.memoryMode', 'この端末では記録を保存できなくなりました。練習は続けられます。');
    }
    if (mode === 'readonly') {
      return text('store.readonly',
        'アプリが古い可能性があります。Ctrl+Shift+R で再読み込みしてください');
    }
    return text('store.ok', '記録はこの端末に保存されています');
  }

  /* --- 起動時のモード決定 ----------------------------------------------- */

  /*
   * ここではトーストを出さない。起動直後の縮退は §10-2 のとおり「帯」で伝えるのが仕様で、
   * 帯を出すのは 99-app / 09-screens の役目。onDegraded の replay がそれを受け取る。
   */
  if (!isAvailable()) {
    mode = 'memory';
    modeReason = 'unavailable';
  }

  /* --- 7 つのストア(§11-1)---------------------------------------------- */

  var stores = {
    /* {createdAt, lastOpenedAt, appVersion} */
    meta: createStore({
      key: KEYS.meta, version: 1, priority: 0,
      fallback: function () { return { createdAt: 0, lastOpenedAt: 0, appVersion: '' }; }
    }),

    /* {privacyAckAt, onboardedAt, headphoneNoticeSeen, ttsFailCount} */
    flags: createStore({
      key: KEYS.flags, version: 1, priority: 0,
      fallback: function () {
        return { privacyAckAt: null, onboardedAt: null, headphoneNoticeSeen: false, ttsFailCount: 0 };
      }
    }),

    /* Settings(§5-5)。fallback は必ず DEFAULTS の複製。 */
    settings: createStore({
      key: KEYS.settings, version: 1, priority: 0,
      fallback: function () { return cloneValue(SETTINGS_DEFAULTS); }
    }),

    /* {decks: {deckId: {phrases:{}, completedAt, lastIndex}}} */
    progress: createStore({
      key: KEYS.progress, version: 1, priority: 3,
      fallback: function () { return { decks: {} }; }
    }),

    /* {word: {a, g, h:{}, t}}。上限 500 語のキャップは 04-catalog の tracker 側の責務。 */
    wordstats: createStore({
      key: KEYS.wordstats, version: 1, priority: 2,
      fallback: function () { return {}; },
      prune: pruneWordStats
    }),

    /* [SessionRecord]。新しいものが末尾。最新 200 件までは tracker 側で切る。 */
    sessions: createStore({
      key: KEYS.sessions, version: 1, priority: 1,
      fallback: function () { return []; },
      prune: pruneSessions
    }),

    /* [Deck]。自作デッキ。ユーザーの成果物なので自動 prune しない。 */
    customdecks: createStore({
      key: KEYS.customdecks, version: 1, priority: 4,
      fallback: function () { return []; }
    })
  };

  LC.store = {
    KEYS: KEYS,
    stores: stores,
    createStore: createStore,
    isAvailable: isAvailable,
    getMode: function () { return mode; },
    getModeReason: function () { return modeReason; },
    describeMode: describeMode,
    setDemoMode: setDemoMode,
    isDemoMode: function () { return demoMode; },
    onDegraded: onDegraded,
    estimateUsageBytes: estimateUsageBytes,
    clearAll: clearAll,
    flushAll: flushAll,
    exportAll: exportAll,
    importAll: importAll
  };


  /* =====================================================================
   * 2. LC.env — 環境検出(仕様 §5-4 / §10-2)
   * ===================================================================== */

  var envCache = null;

  function getRecognitionCtor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  /**
   * Chrome かどうか。
   * navigator.userAgentData.brands を優先する(UA 文字列の凍結が進んでいるため)。
   * 取れなければ UA 文字列で「Chrome を含み Edg / OPR / Firefox を含まない」で判定する。
   */
  function detectIsChrome(ua) {
    var uad = navigator.userAgentData;
    if (uad && uad.brands && typeof uad.brands.length === 'number') {
      var hasChrome = false, hasOther = false;
      for (var i = 0; i < uad.brands.length; i++) {
        var b = (uad.brands[i] && uad.brands[i].brand) || '';
        if (/Google Chrome/i.test(b)) hasChrome = true;
        if (/Microsoft Edge|Opera|Brave|Vivaldi|Samsung/i.test(b)) hasOther = true;
      }
      if (hasChrome || hasOther) return hasChrome && !hasOther;
      /* Chromium しか名乗らない場合は判断材料が無いので UA 文字列へ落とす */
    }
    return /Chrome/.test(ua) && !/Edg|OPR|Firefox/.test(ua);
  }

  /** ブラウザ名とバージョン(診断画面の表示用。判定ロジックには使わない)。 */
  function detectBrowserLabel(ua) {
    var m;
    if ((m = /Edg(?:e|A|iOS)?\/([\d.]+)/.exec(ua))) return { name: 'Edge', version: m[1] };
    if ((m = /OPR\/([\d.]+)/.exec(ua)))             return { name: 'Opera', version: m[1] };
    if ((m = /Firefox\/([\d.]+)/.exec(ua)))         return { name: 'Firefox', version: m[1] };
    if ((m = /FxiOS\/([\d.]+)/.exec(ua)))           return { name: 'Firefox', version: m[1] };
    if ((m = /CriOS\/([\d.]+)/.exec(ua)))           return { name: 'Chrome', version: m[1] };
    if ((m = /Chrome\/([\d.]+)/.exec(ua)))          return { name: 'Chrome', version: m[1] };
    if ((m = /Version\/([\d.]+).*Safari/.exec(ua))) return { name: 'Safari', version: m[1] };
    return { name: 'unknown', version: '' };
  }

  function detectIsIOS(ua) {
    /* iPadOS 13 以降は Mac を名乗るので maxTouchPoints で見分ける */
    return /iPad|iPhone|iPod/.test(ua) ||
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function detectIsIOSSafari(ua) {
    return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Android/.test(ua);
  }

  /**
   * 環境を検出する。結果はキャッシュされる。
   * @param {boolean} [force] 診断画面などで取り直したいときだけ true
   * @returns {object} EnvInfo
   */
  function detect(force) {
    if (envCache && !force) return envCache;

    var ua = (navigator && navigator.userAgent) ? navigator.userAgent : '';
    var protocol = '';
    try { protocol = window.location.protocol; } catch (e) { protocol = ''; }
    var isFileProtocol = protocol === 'file:';

    var secure = (typeof window.isSecureContext === 'boolean')
      ? window.isSecureContext
      : (protocol === 'https:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname || ''));

    var hasRecognition = !!getRecognitionCtor();
    var hasSynthesis = ('speechSynthesis' in window) &&
                       (typeof window.SpeechSynthesisUtterance === 'function');
    var hasLocalStorage = isAvailable();
    var hasMediaDevices = !!(navigator.mediaDevices &&
                             typeof navigator.mediaDevices.getUserMedia === 'function');
    var hasAudioContext = !!(window.AudioContext || window.webkitAudioContext);

    var isIOS = detectIsIOS(ua);
    var isAndroid = /Android/.test(ua);
    var isChrome = detectIsChrome(ua);

    var browserClass;
    if (isIOS) browserClass = 'ios';
    else if (isChrome && isAndroid) browserClass = 'chrome-android';
    else if (isChrome) browserClass = 'chrome-desktop';
    else browserClass = 'other-browser';

    /*
     * blockReason は §10-2 の表の順に評価する。
     * ★ file: は致命にしない(§5-4)。警告帯を出して練習には進ませ、
     *   マイクが実際に取れなかった時点ではじめて Pages URL へ誘導する。
     */
    var blockReason = null;
    if (!hasRecognition) {
      blockReason = 'no-recognition';
    } else if (isIOS && !detectIsIOSSafari(ua)) {
      /* iOS のサードパーティブラウザは中身が WebKit でも service-not-allowed になる */
      blockReason = 'ios';
    } else if (!secure && !isFileProtocol) {
      blockReason = 'insecure';
    } else if (browserClass === 'other-browser') {
      blockReason = 'other-browser';
    }

    /* warnings は「コード」で返す。日本語化は画面側が LC.msg で行う(§10-2 の縮退・警告行)。 */
    var warnings = [];
    if (isFileProtocol) warnings.push('file-protocol');
    if (!hasSynthesis) warnings.push('no-synthesis');
    if (!hasLocalStorage) warnings.push('no-storage');
    if (navigator && navigator.onLine === false) warnings.push('offline');
    if (browserClass === 'chrome-android') warnings.push('android');
    if (blockReason === null && browserClass === 'other-browser') warnings.push('other-browser');

    var label = detectBrowserLabel(ua);

    envCache = {
      protocol: protocol,
      isSecureContext: secure,
      isFileProtocol: isFileProtocol,
      hasRecognition: hasRecognition,
      hasSynthesis: hasSynthesis,
      hasLocalStorage: hasLocalStorage,
      hasMediaDevices: hasMediaDevices,
      hasAudioContext: hasAudioContext,
      browserClass: browserClass,
      supported: blockReason === null,
      blockReason: blockReason,
      warnings: warnings,
      userAgent: ua,
      /* 以下は仕様の EnvInfo に無い追加フィールド。診断画面(§7-7)の表示専用。 */
      browserName: label.name,
      browserVersion: label.version,
      isAndroid: isAndroid,
      isIOS: isIOS,
      language: (navigator && navigator.language) || ''
    };
    log('env.detect', envCache);
    return envCache;
  }

  /**
   * マイク権限の現在値。Permissions API が無い / 'microphone' 未対応なら 'unknown'。
   * @returns {Promise<'granted'|'denied'|'prompt'|'unknown'>} reject しない
   */
  function queryMicPermission() {
    return new Promise(function (resolve) {
      var p;
      try {
        if (!navigator.permissions || typeof navigator.permissions.query !== 'function') {
          return resolve('unknown');
        }
        /* Firefox は name:'microphone' で TypeError を投げるので try で包む */
        p = navigator.permissions.query({ name: 'microphone' });
      } catch (e) {
        return resolve('unknown');
      }
      if (!p || typeof p.then !== 'function') return resolve('unknown');
      p.then(function (status) {
        var s = status && status.state;
        resolve(s === 'granted' || s === 'denied' || s === 'prompt' ? s : 'unknown');
      }, function () {
        resolve('unknown');
      });
    });
  }

  /** getUserMedia のエラーをアプリ側のコードに落とす。 */
  function mapMicError(err) {
    var name = (err && err.name) ? err.name : '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
      return 'not-allowed';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'not-found';
    if (name === 'NotReadableError' || name === 'TrackStartError') return 'not-readable';
    if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') return 'overconstrained';
    if (name === 'AbortError') return 'aborted';
    return 'unknown';
  }

  function stopStream(stream) {
    try {
      var tracks = stream && typeof stream.getTracks === 'function' ? stream.getTracks() : [];
      for (var i = 0; i < tracks.length; i++) {
        try { tracks[i].stop(); } catch (e) { /* noop */ }
      }
    } catch (e) { /* noop */ }
  }

  /**
   * マイクを 1 回だけ開いて即座に閉じる(§5-4)。
   * 目的は (a) 権限の確定 (b) NotAllowedError / NotFoundError / NotReadableError の区別。
   * SpeechRecognition 側ではこれらが not-allowed / audio-capture に潰れて案内できない。
   * ★ 開きっぱなしにするとタブに録音インジケータが残り続けるので必ず stop する。
   * @returns {Promise<{ok:boolean, error:string|null}>} reject しない
   */
  function warmUpMicrophone() {
    return new Promise(function (resolve) {
      var p;
      try {
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
          return resolve({ ok: false, error: 'unsupported' });
        }
        p = navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
      } catch (e) {
        return resolve({ ok: false, error: 'unsupported' });
      }
      if (!p || typeof p.then !== 'function') return resolve({ ok: false, error: 'unsupported' });

      p.then(function (stream) {
        stopStream(stream);
        log('env.warmUpMicrophone', { ok: true });
        resolve({ ok: true, error: null });
      }, function (err) {
        var code = mapMicError(err);
        log('env.warmUpMicrophone', { ok: false, error: code, name: err && err.name });
        resolve({ ok: false, error: code });
      });
    });
  }

  LC.env = {
    detect: detect,
    getRecognitionCtor: getRecognitionCtor,
    queryMicPermission: queryMicPermission,
    warmUpMicrophone: warmUpMicrophone
  };


  /* =====================================================================
   * 3. LC.settings — 設定の読み書きと矯正(仕様 §5-5)
   * ===================================================================== */

  /* ★ 上の stores.settings の fallback から参照されるので、巻き上げのある var で先に置く。 */
  var SETTINGS_DEFAULTS = {
    lang: 'en-US',
    voice: null,        /* ★ voiceURI ではなく {name, lang} で保存する(§5-5) */
    rate: 0.9,
    autoListen: true,
    showScore: false,   /* 既定で数値スコアを出さない(R13) */
    saveRecords: true,
    theme: 'auto'
  };

  var LANGS = ['en-US', 'en-GB'];
  var RATES = [0.7, 0.9, 1.1];     /* スライダーにしない。3 段固定(§7-6) */
  var THEMES = ['auto', 'light', 'dark'];

  var settingsCache = null;

  function inList(list, v) {
    for (var i = 0; i < list.length; i++) if (list[i] === v) return true;
    return false;
  }

  function coerceBool(v, def) {
    return typeof v === 'boolean' ? v : def;
  }

  function coerceRate(v) {
    if (typeof v !== 'number' || !isFinite(v)) return SETTINGS_DEFAULTS.rate;
    for (var i = 0; i < RATES.length; i++) {
      /* 浮動小数の丸め差(0.7000000000000001 など)を吸収する */
      if (Math.abs(RATES[i] - v) < 0.001) return RATES[i];
    }
    return SETTINGS_DEFAULTS.rate;
  }

  /**
   * 保存する音声は {name, lang} だけ。
   * voiceURI は環境と Chrome バージョンで変わるので永続化に使わない(§5-5)。
   * 復元(name 完全一致 → lang 一致 → 既定選択)は 05-speech.js の責務。
   */
  function coerceVoice(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    var name = typeof v.name === 'string' ? v.name : '';
    var lang = typeof v.lang === 'string' ? v.lang : '';
    if (!name || !lang) return null;
    return { name: name, lang: lang };
  }

  /**
   * 不正値を DEFAULTS に矯正する純関数(テストが直接呼ぶ)。
   * 未知のキーは落とす。入力は一切書き換えない。
   * @param {*} raw
   * @returns {object} Settings
   */
  function coerce(raw) {
    var out = cloneValue(SETTINGS_DEFAULTS);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;

    if (inList(LANGS, raw.lang)) out.lang = raw.lang;
    out.voice = coerceVoice(raw.voice);
    out.rate = coerceRate(raw.rate);
    out.autoListen = coerceBool(raw.autoListen, SETTINGS_DEFAULTS.autoListen);
    out.showScore = coerceBool(raw.showScore, SETTINGS_DEFAULTS.showScore);
    out.saveRecords = coerceBool(raw.saveRecords, SETTINGS_DEFAULTS.saveRecords);
    if (inList(THEMES, raw.theme)) out.theme = raw.theme;
    return out;
  }

  /**
   * 現在の設定。参照は安定していて、update() を呼ぶまで同じオブジェクトを返す
   * (LC.state.select の等値比較が毎回走らないようにするため)。戻り値は書き換えないこと。
   */
  function getSettings() {
    if (settingsCache) return settingsCache;
    settingsCache = coerce(stores.settings.get());
    return settingsCache;
  }

  /**
   * 差分を当てて保存する。設定は変更時に即時保存(§11-3)。
   * @param {object} patch
   * @returns {object} 矯正後の新しい Settings
   */
  function updateSettings(patch) {
    var cur = getSettings();
    var merged = {};
    var k;
    for (k in cur) { if (own(cur, k)) merged[k] = cur[k]; }
    if (patch && typeof patch === 'object' && !Array.isArray(patch)) {
      for (k in patch) { if (own(patch, k)) merged[k] = patch[k]; }
    }
    settingsCache = coerce(merged);
    /* ストアには複製を渡す。同じ参照を共有すると、後段の書き換えがキャッシュに漏れる。 */
    stores.settings.set(cloneValue(settingsCache));
    log('settings.update', settingsCache);
    return settingsCache;
  }

  /** 既定に戻す。 */
  function resetSettings() {
    settingsCache = cloneValue(SETTINGS_DEFAULTS);
    stores.settings.set(cloneValue(settingsCache));
    return settingsCache;
  }

  LC.settings = {
    DEFAULTS: SETTINGS_DEFAULTS,
    LANGS: LANGS,
    RATES: RATES,
    THEMES: THEMES,
    get: getSettings,
    update: updateSettings,
    reset: resetSettings,
    coerce: coerce
  };


  LC.__loaded = (LC.__loaded || []).concat(['store', 'env', 'settings']);
})(window.LC);

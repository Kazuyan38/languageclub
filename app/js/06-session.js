/* js/06-session.js — 練習ステートマシン(仕様 §5-14)
 * ============================================================================
 * ★このファイルは「TTS と ASR の排他」を担保する唯一の場所。
 *
 * ここが守る不変条件(仕様 §5-14。破れたらバグ):
 *   1. TTS と ASR が同時に動く経路が存在しない
 *   2. 全公開メソッドが再入ガードされ、進行中の呼び出しは no-op を返す
 *   3. どの経路も最終的に IDLE / REVIEW / BLOCKED に到達する
 *   4. 例外を投げない(非同期も reject せず、必ず結果オブジェクトで resolve する)
 *   5. document.hidden になったら即 cancelAll()
 *   6. 遷移は setPhase(next) 経由のみ。ALLOWED[from] に無ければ console.warn して無視する
 *   7. タイマー ID はすべて配列で保持し destroy() で全部 clearTimeout する
 *   8. IDLE / REVIEW 以外ではナビゲーションを禁止する(canNavigate() を画面に渡す)
 *
 * DOM には一切触らない。画面には hooks 経由でのみ伝える。
 * speechSynthesis / SpeechRecognition には触らない(触ってよいのは 05-speech.js だけ)。
 * localStorage には触らない(触ってよいのは 02-store.js だけ)。
 * ============================================================================
 */
window.LC = window.LC || {};
(function (LC) {
  'use strict';

  /* ==========================================================================
   * 1. 定数と遷移表
   * ========================================================================== */

  /** 仕様 §5-14 の 7 フェーズ。値は変更しない(画面の CSS / data 属性が依存する)。 */
  var Phase = {
    IDLE: 'idle',
    SPEAKING: 'speaking',
    GUARD: 'guard',
    LISTENING: 'listening',
    SCORING: 'scoring',
    REVIEW: 'review',
    BLOCKED: 'blocked'
  };

  /**
   * 許可された遷移。ここに無い遷移は console.warn して**無視する**。
   * 例外を投げてユーザーの前でクラッシュさせるより、1 回押しそこねるほうがましという判断。
   *
   *   IDLE ──主ボタン──▶ SPEAKING ──speak 完了/watchdog──▶ GUARD(400ms) ──▶ LISTENING
   *    ▲  ▲                  │(TTS 不可)                                      │ stop()/end
   *    │  │                  └──────────────────────────────────────────────┤
   *    │  │ no-speech / timeout / aborted                                   ▼
   *    │  └──────────────────────────────────────────────────────────  SCORING
   *    │                                                                    │
   *    │◀─────────── next() ────────────────────────────────────────── REVIEW
   *    │
   *   任意の状態 ──復帰不能エラー──▶ BLOCKED(リロード以外の出口なし)
   *
   * SPEAKING → REVIEW は「REVIEW 中に 🐢 ゆっくり / ▶ お手本だけ を押した」経路。
   * 結果表示を消さずに元のフェーズへ戻すために必要。
   * IDLE / REVIEW → GUARD は「読み上げの直後に 🎤 話すだけ を押した」経路。
   * 残響をマイクが拾わないように 400ms 挟むために必要。
   */
  var ALLOWED = {
    idle:      [Phase.SPEAKING, Phase.GUARD, Phase.LISTENING, Phase.BLOCKED],
    speaking:  [Phase.GUARD, Phase.IDLE, Phase.REVIEW, Phase.BLOCKED],
    guard:     [Phase.LISTENING, Phase.IDLE, Phase.BLOCKED],
    listening: [Phase.SCORING, Phase.IDLE, Phase.BLOCKED],
    scoring:   [Phase.REVIEW, Phase.IDLE, Phase.BLOCKED],
    review:    [Phase.SPEAKING, Phase.GUARD, Phase.LISTENING, Phase.IDLE, Phase.BLOCKED],
    blocked:   []
  };

  /** cancel() 直後の speak() は丸ごと飲み込まれる(落とし穴 10)。必ずこれだけ待つ。 */
  var CANCEL_TO_SPEAK_MS = 200;
  /** TTS 終了後のガード。end はスピーカーから音が消える瞬間より早く来る(落とし穴 12)。 */
  var GUARD_MS = 400;
  /** 認識のハードタイムアウト(仕様 §5-13 の既定と同じ)。 */
  var LISTEN_TIMEOUT_MS = 25000;
  /** ステートマシン側の保険。recognizer / speaker が固まっても必ず IDLE に落とす(不変条件 3)。 */
  var SPEAK_WATCHDOG_MS = 30000;
  var LISTEN_WATCHDOG_MS = LISTEN_TIMEOUT_MS + 8000;

  /** 🐢 ゆっくり: 1 回目 0.65、2 回目以降 0.5(仕様 §7-3 の S キー)。 */
  var SLOW_RATE_FIRST = 0.65;
  var SLOW_RATE_REPEAT = 0.5;
  /** 単語だけの読み上げは少しゆっくりにする。 */
  var WORD_RATE = 0.8;

  /** 1 フレーズの想定試行回数。3 回中 2 回で「クリア」(仕様 §5-10 の通じ率方式)。 */
  var MAX_ATTEMPTS = (LC.score && LC.score.MAX_ATTEMPTS) || 3;
  /** TTS の timeout が続いたら「読み上げが不安定です」を 1 回だけ案内する(仕様 §10-4)。 */
  var TTS_TIMEOUT_STREAK_LIMIT = 3;

  /* ==========================================================================
   * 2. 小さなヘルパ(LC.util が無くても落ちないようにする)
   * ========================================================================== */

  function clampNum(x, lo, hi) {
    if (typeof x !== 'number' || !isFinite(x)) return lo;
    return x < lo ? lo : (x > hi ? hi : x);
  }

  function logSafe(tag, obj) {
    try { if (LC.util && LC.util.log) LC.util.log(tag, obj); } catch (e) { /* 記録に失敗しても続行 */ }
  }

  function toastSafe(text, opts) {
    if (!text) return;
    try { if (LC.util && LC.util.toast) LC.util.toast(text, opts || {}); } catch (e) { /* 表示できなくても続行 */ }
  }

  function announceSafe(text) {
    if (!text) return;
    try { if (LC.util && LC.util.announce) LC.util.announce(text); } catch (e) { /* 同上 */ }
  }

  /** 文言。LC.msg が無い場合はキー文字列がそのまま返る(仕様 §5-2)。 */
  function msgText(key, vars) {
    try { if (LC.msg && LC.msg.t) return LC.msg.t(key, vars); } catch (e) { /* fallthrough */ }
    return '';
  }

  function isDemoMode() {
    try { return !!(LC.store && LC.store.isDemoMode && LC.store.isDemoMode()); } catch (e) { return false; }
  }

  /** LC.recognizer が読み込めていない環境でも練習画面が落ちないようにするスタブ。 */
  function nullRecognizer() {
    return {
      isAvailable: function () { return false; },
      isBusy: function () { return false; },
      listen: function () {
        return Promise.resolve({ status: 'unavailable', transcript: '', alternatives: [] });
      },
      stop: function () { /* no-op */ },
      cancel: function () { /* no-op */ },
      destroy: function () { /* no-op */ }
    };
  }

  /* ==========================================================================
   * 3. create() — セッション 1 個ぶんのステートマシン
   * ========================================================================== */

  /**
   * 練習セッションを作る。
   *
   * @param {Object} cfg
   *   cfg.deck        Deck(仕様 §5-6)。phrases は 1 件以上を想定
   *   cfg.startIndex  開始インデックス(既定 0)
   *   cfg.getSettings Settings を返す関数(省略時は LC.settings.get)
   *   cfg.hooks       onPhaseChange / onInterim / onAttempt / onError /
   *                   onPhraseChange / onDeckComplete
   * @returns {Object} セッション API。すべて例外を投げない。
   */
  function create(cfg) {
    cfg = cfg || {};

    var deck = cfg.deck || null;
    var phrases = (deck && Array.isArray(deck.phrases)) ? deck.phrases : [];
    var deckId = (deck && deck.id) ? deck.id : '';
    var total = phrases.length;

    var hooks = cfg.hooks || {};
    var getSettingsFn = (typeof cfg.getSettings === 'function') ? cfg.getSettings : null;

    var index = clampNum(Math.round(Number(cfg.startIndex) || 0), 0, Math.max(0, total - 1));
    var phrase = phrases[index] || null;

    var phase = Phase.IDLE;
    var destroyed = false;

    /** 現在のフレーズの試行。フレーズが変わったらリセットする。 */
    var attempts = [];
    /** 🐢 ゆっくりを押した回数(現在のフレーズ)。1 回目 0.65 → 2 回目以降 0.5。 */
    var slowCount = 0;
    /** 直近の interim。画面が取りこぼしたときのために保持する。 */
    var lastInterim = '';
    /** onspeechstart が来たか(「残り N 秒」表示を消す判断に使う)。 */
    var speechDetected = false;
    /** TTS を鳴らしている最中か。speechSynthesis.speaking は判断に使わない(落とし穴 8)。 */
    var ttsActive = false;
    /** TTS の watchdog タイムアウトの連続回数(仕様 §10-4)。 */
    var ttsTimeoutStreak = 0;
    /** 読み上げ不可の案内は 1 セッション 1 回だけ。 */
    var ttsNoticeShown = false;

    /* --- 再入ガード -------------------------------------------------------
     * 実行中の非同期チェーンには「トークン」を持たせ、cancelAll() / destroy() /
     * 新しい呼び出しでトークンを無効化する。await から戻った時点で stale(token) を
     * 見れば、キャンセル済みのチェーンが phase を書き換えてしまう事故が起きない。
     * -------------------------------------------------------------------- */
    var runSeq = 0;
    var activeToken = 0;   /* 0 = 実行中の非同期処理なし */

    function beginRun() { runSeq += 1; activeToken = runSeq; return activeToken; }
    function stale(token) { return destroyed || token !== activeToken; }
    function endRun(token) { if (activeToken === token) activeToken = 0; }
    function invalidateRuns() { runSeq += 1; activeToken = 0; }

    /* --- タイマー管理(不変条件 7)-----------------------------------------
     * setTimeout の ID をすべて配列に積み、destroy() / cancelAll() で全部消す。
     * タイマーの止め忘れが Web Speech アプリの死因第 1 位(落とし穴 33)。
     * -------------------------------------------------------------------- */
    var timers = [];
    var sleepers = [];

    function forgetTimer(id) {
      var i = timers.indexOf(id);
      if (i >= 0) timers.splice(i, 1);
    }

    /** await 可能な sleep。中断されたときは true で resolve する(永久に止まらない)。 */
    function sleepGuarded(ms) {
      return new Promise(function (resolve) {
        var id = setTimeout(function () {
          forgetTimer(id);
          for (var i = 0; i < sleepers.length; i++) {
            if (sleepers[i].id === id) { sleepers.splice(i, 1); break; }
          }
          resolve(false);
        }, ms);
        timers.push(id);
        sleepers.push({ id: id, resolve: resolve });
      });
    }

    /** フェーズごとの保険。speaker / recognizer が resolve しなくても IDLE に落ちる。 */
    function armWatchdog(token, ms, label) {
      var id = setTimeout(function () {
        forgetTimer(id);
        if (destroyed || token !== activeToken) return;
        logSafe('session.watchdog', { label: label, phase: phase });
        forceIdle('watchdog');
      }, ms);
      timers.push(id);
      return id;
    }

    function disarm(id) {
      if (id === null || id === undefined) return;
      clearTimeout(id);
      forgetTimer(id);
    }

    function clearAllTimers() {
      var i;
      for (i = 0; i < timers.length; i++) { clearTimeout(timers[i]); }
      timers.length = 0;
      /* 待機中の sleep は「中断」として即 resolve する。clearTimeout しただけだと
         await が永久に返らず、チェーンが宙ぶらりんのまま残る。 */
      var pending = sleepers.slice();
      sleepers.length = 0;
      for (i = 0; i < pending.length; i++) {
        try { pending[i].resolve(true); } catch (e) { /* 無視 */ }
      }
    }

    /* --- hooks(画面側のバグでステートマシンを壊さない)--------------------- */

    function emit(name, a, b) {
      var fn = hooks && hooks[name];
      if (typeof fn !== 'function') return;
      try {
        fn(a, b);
      } catch (e) {
        /* 画面側の例外はここで止める。ステートマシンは進み続ける。 */
        logSafe('session.hookError', { hook: name, error: String((e && e.message) || e) });
        if (window.console && console.warn) {
          console.warn('[LC.session] hooks.' + name + ' で例外が発生しました', e);
        }
      }
    }

    /* --- 設定 ------------------------------------------------------------- */

    function readSettings() {
      var s = null;
      try {
        if (getSettingsFn) s = getSettingsFn();
        else if (LC.settings && LC.settings.get) s = LC.settings.get();
      } catch (e) { s = null; }
      if (!s || typeof s !== 'object') {
        s = (LC.settings && LC.settings.DEFAULTS) ||
            { lang: 'en-US', rate: 0.9, autoListen: true, saveRecords: true };
      }
      return s;
    }

    /* --- 認識器 ------------------------------------------------------------ */

    var rec = null;
    try {
      if (LC.recognizer && typeof LC.recognizer.create === 'function') rec = LC.recognizer.create();
    } catch (e) { rec = null; }
    if (!rec) {
      rec = nullRecognizer();
      logSafe('session.noRecognizer', {});
    }

    /* ======================================================================
     * 3-1. setPhase — 遷移はここだけを通る(不変条件 6)
     * ====================================================================== */

    /**
     * @param {string} nextPhase 次のフェーズ
     * @param {Object=} extra onPhaseChange の meta に混ぜる追加情報
     * @returns {boolean} 実際に遷移したか(不正遷移は false)
     */
    function setPhase(nextPhase, extra) {
      if (destroyed) return false;
      if (nextPhase === phase) return true;            /* 同一フェーズは何もしない */

      var allowed = ALLOWED[phase] || [];
      if (allowed.indexOf(nextPhase) < 0) {
        /* ★クラッシュさせない。警告だけ出して無視する(不変条件 6) */
        if (window.console && console.warn) {
          console.warn('[LC.session] 許可されていない遷移を無視しました: ' + phase + ' -> ' + nextPhase);
        }
        logSafe('session.badTransition', { from: phase, to: nextPhase });
        return false;
      }

      var prev = phase;
      phase = nextPhase;

      var meta = {
        prev: prev,
        phase: nextPhase,
        index: index,
        total: total,
        deckId: deckId,
        phrase: phrase,
        canNavigate: canNavigate(),
        attempts: attempts.length,
        passStatus: getPassStatus(),
        notice: null,
        reason: null
      };
      if (extra) {
        for (var k in extra) {
          if (Object.prototype.hasOwnProperty.call(extra, k)) meta[k] = extra[k];
        }
      }

      logSafe('session.phase', { from: prev, to: nextPhase, reason: meta.reason });
      emit('onPhaseChange', nextPhase, meta);
      return true;
    }

    /** IDLE / REVIEW / BLOCKED のときだけナビゲーションを許す(不変条件 8)。 */
    function canNavigate() {
      return !destroyed && (phase === Phase.IDLE || phase === Phase.REVIEW);
    }

    /* ======================================================================
     * 3-2. 音声の停止(TTS と ASR を必ず同時に止める)
     * ====================================================================== */

    function haltAudio() {
      try {
        if (LC.speaker && LC.speaker.stopSpeaking) LC.speaker.stopSpeaking();
      } catch (e) { /* 停止に失敗しても続行 */ }
      ttsActive = false;
      try {
        /* intentional な abort なので error('aborted') は握り潰される(仕様 §5-13)。 */
        rec.cancel();
      } catch (e) { /* 同上 */ }
    }

    /** 進行中の処理を全部捨てて IDLE に戻す(watchdog / 復帰不能でない異常)。 */
    function forceIdle(reason) {
      invalidateRuns();
      clearAllTimers();
      haltAudio();
      lastInterim = '';
      speechDetected = false;
      if (phase !== Phase.BLOCKED) setPhase(Phase.IDLE, { reason: reason || 'force-idle' });
    }

    /* ======================================================================
     * 3-3. 試行の記録
     * ====================================================================== */

    /**
     * 試行を tracker に確定させる。
     *
     * ★仕様 §5-14 のステップ 7 は「採点直後に recordAttempt」と書かれているが、
     *   [X]「うまく拾えなかった(この回を記録から除く)」は採点の**後**に押される。
     *   採点直後に excluded:false で書き込んでしまうと、後から除外しても
     *   苦手語統計を汚したままになり、[X] が意味を持たなくなる。
     *   そこで「もう除外できなくなった時点」= 次の試行の開始 / フレーズ移動 /
     *   destroy() で確定させる。tracker.recordAttempt は 1 試行につき必ず 1 回だけ、
     *   最終的な excluded の値つきで呼ばれる。
     */
    function commitAttempts() {
      if (!attempts.length) return;
      var st = readSettings();
      var allowed = !!st.saveRecords && !isDemoMode();   /* 仕様 §5-14 ステップ 7 */
      for (var i = 0; i < attempts.length; i++) {
        var a = attempts[i];
        if (a.committed) continue;
        a.committed = true;
        if (!allowed) continue;
        try {
          if (LC.tracker && typeof LC.tracker.recordAttempt === 'function') {
            LC.tracker.recordAttempt(a.deckId, a.phrase, a.result, a.excluded);
          }
        } catch (e) {
          logSafe('session.recordError', { error: String((e && e.message) || e) });
        }
      }
    }

    function saveLastIndex(i) {
      var st = readSettings();
      if (!st.saveRecords || isDemoMode()) return;
      try {
        if (LC.tracker && typeof LC.tracker.setLastIndex === 'function') {
          LC.tracker.setLastIndex(deckId, i);
        }
      } catch (e) { /* 記録に失敗しても練習は続く */ }
    }

    /** 画面に渡す試行の形。ScoreResult をそのまま持たせる(LC.ui.renderResult 用)。 */
    function publicAttempt(a) {
      return {
        n: a.n,
        at: a.at,
        deckId: a.deckId,
        phraseId: a.phraseId,
        score: a.score,
        band: a.band,
        transcript: a.transcript,
        excluded: a.excluded,
        result: a.result
      };
    }

    function liveScores() {
      var out = [], i;
      for (i = 0; i < attempts.length; i++) {
        if (attempts[i].excluded) continue;
        out.push(attempts[i].score);
      }
      return out;
    }

    /** 仕様 §5-14: LC.score.passRate() を使って {pass, total, rate, cleared} を返す。 */
    function getPassStatus() {
      var scores = liveScores();
      try {
        if (LC.score && typeof LC.score.passRate === 'function') return LC.score.passRate(scores);
      } catch (e) { /* fallthrough */ }
      /* LC.score が読めていない環境でも画面が落ちないようにする。 */
      var pass = 0, i;
      for (i = 0; i < scores.length; i++) { if (scores[i] >= 80) pass++; }
      return {
        pass: pass,
        total: scores.length,
        rate: scores.length ? (pass / scores.length) : 0,
        cleared: pass >= 2 && scores.length >= MAX_ATTEMPTS
      };
    }

    /* ======================================================================
     * 3-4. TTS(呼び出しは必ずこの 1 箇所を通す)
     * ====================================================================== */

    /**
     * @returns {Promise<string>} speak() の reason。reject しない。
     * 'end' | 'timeout' | 'canceled' | 'interrupted' | 'not-allowed' |
     * 'empty' | 'no-voice' | 'synthesis-failed'
     */
    function speakOnce(text, rate) {
      if (!LC.speaker || typeof LC.speaker.speak !== 'function') return Promise.resolve('no-voice');

      var voice = null;
      try { voice = LC.speaker.getActiveVoice ? LC.speaker.getActiveVoice() : null; } catch (e) { voice = null; }

      ttsActive = true;
      var started = false;
      var p;
      try {
        p = LC.speaker.speak(text, {
          voice: voice,                                  /* null なら speaker が 'no-voice' を返す */
          rate: clampNum(rate, 0.5, 1.5),
          onStart: function () { started = true; }
        });
      } catch (e) {
        /* 仕様上 speak() は投げないが、保険として握る(不変条件 4)。 */
        ttsActive = false;
        return Promise.resolve('synthesis-failed');
      }
      if (!p || typeof p.then !== 'function') {
        ttsActive = false;
        return Promise.resolve('synthesis-failed');
      }
      return p.then(function (reason) {
        ttsActive = false;
        logSafe('session.tts', { reason: reason, started: started });
        return reason;
      }, function () {
        ttsActive = false;
        return 'synthesis-failed';
      });
    }

    /**
     * speak() の reason を UI 方針(仕様 §10-4)に落とす。
     * @returns {string} 'ok'(先へ進む) | 'stop'(元のフェーズへ戻す) | 'fatal-tts'
     */
    function classifySpeakReason(reason) {
      if (reason === 'end') { ttsTimeoutStreak = 0; return 'ok'; }

      /* 停止ボタン・他の発話による割り込みは正常系。エラー表示をしてはいけない(落とし穴 14)。 */
      if (reason === 'canceled' || reason === 'interrupted') return 'stop';

      if (reason === 'not-allowed') return 'fatal-tts';

      if (reason === 'timeout') {
        /* ウォッチドッグ発火。黙って次へ進む。連続したときだけ案内する。 */
        ttsTimeoutStreak += 1;
        if (ttsTimeoutStreak >= TTS_TIMEOUT_STREAK_LIMIT) {
          ttsTimeoutStreak = 0;
          toastSafe(msgText('practice.ttsUnstable'), { type: 'warn' });
        }
        return 'ok';
      }

      /* no-voice / empty / synthesis-failed:読み上げなしで練習を続行する。 */
      ttsTimeoutStreak = 0;
      if (!ttsNoticeShown) {
        ttsNoticeShown = true;
        toastSafe(msgText('practice.ttsUnavailable'), { type: 'warn' });
      }
      return 'ok';
    }

    function emitTtsError(reason, code) {
      var m = null;
      try { if (LC.msg && LC.msg.ttsError) m = LC.msg.ttsError(reason); } catch (e) { m = null; }
      var payload = {
        code: code || reason,
        source: 'tts',
        fatal: false,
        silent: m ? !!m.silent : false,
        title: m ? m.title : '',
        body: m ? m.body : '',
        actions: m ? m.actions : []
      };
      logSafe('session.ttsError', { code: payload.code });
      emit('onError', payload);
    }

    /* ======================================================================
     * 3-5. ASR エラーの扱い
     * ====================================================================== */

    function emitAsrError(code) {
      var m = null;
      try { if (LC.msg && LC.msg.asrError) m = LC.msg.asrError(code); } catch (e) { m = null; }
      var payload = {
        code: code || 'unknown',
        source: 'asr',
        fatal: m ? !!m.fatal : false,
        silent: m ? !!m.silent : false,
        title: m ? m.title : '',
        body: m ? m.body : '',
        actions: m ? m.actions : []
      };
      logSafe('session.asrError', { code: payload.code, fatal: payload.fatal });
      emit('onError', payload);
      return payload;
    }

    /* ======================================================================
     * 3-6. 採点
     * ====================================================================== */

    function scoreResultFor(listenResult) {
      var refs = [phrase.text];
      if (Array.isArray(phrase.accept)) refs = refs.concat(phrase.accept);

      var alts = (Array.isArray(listenResult.alternatives) && listenResult.alternatives.length)
        ? listenResult.alternatives
        : [listenResult.transcript || ''];

      var result = null;
      try {
        if (LC.score && typeof LC.score.scoreBest === 'function') {
          result = LC.score.scoreBest(refs, alts);
        }
      } catch (e) {
        logSafe('session.scoreError', { error: String((e && e.message) || e) });
        result = null;
      }
      if (!result || typeof result !== 'object') return null;

      /* ① 「聞こえた文」は認識器の第一候補(生テキスト)を出す。
         scoreBest は代替候補を採用することがあるので、採点に使った側は退避しておく。
         事実を最初に見せるという仕様 §7-3 の表示順序を守るための処理。 */
      result.matchedHypothesis = result.heard;
      result.heard = (listenResult.transcript || '');
      return result;
    }

    /* ======================================================================
     * 3-7. 公開: 主シーケンス playThenListen()(仕様 §5-14 の 8 ステップ)
     * ====================================================================== */

    /** 公開の非同期メソッド共通の入口ガード。@returns {?string} 弾いた理由 or null */
    function guardStart(allowedPhases) {
      if (destroyed) return 'destroyed';
      if (phase === Phase.BLOCKED) return 'blocked';
      if (activeToken !== 0) return 'busy';               /* 再入ガード(不変条件 2) */
      if (allowedPhases.indexOf(phase) < 0) return 'busy';
      return null;
    }

    /** キャンセル済みチェーンの終端。phase は触らない(横取りさせない)。 */
    function staleResult() { return { status: 'cancelled' }; }

    /**
     * ★アプリ唯一の「TTS を鳴らしてから ASR を開始する」経路。
     * 仕様 §5-14 の 8 ステップをそのまま順番に実装している。
     */
    async function playThenListen() {
      /* 1. phase が IDLE / REVIEW 以外なら no-op */
      var blocked = guardStart([Phase.IDLE, Phase.REVIEW]);
      if (blocked) return { status: blocked };
      if (!phrase) return { status: 'no-phrase' };

      var token = beginRun();
      var origin = phase;                  /* IDLE か REVIEW。TTS 失敗時に戻す先 */
      var st = readSettings();

      /* 直前の試行を確定させる。ここから先は [X] で除外できない。 */
      commitAttempts();
      lastInterim = '';
      speechDetected = false;

      /* --- 2. SPEAKING -------------------------------------------------- */
      if (!setPhase(Phase.SPEAKING, { reason: 'play-then-listen' })) { endRun(token); return { status: 'rejected' }; }
      announceSafe(msgText('practice.annSpeaking'));

      var wd = armWatchdog(token, SPEAK_WATCHDOG_MS, 'speaking');

      haltAudio();                                    /* 前セッションの残骸を掃除 + rec.cancel() */
      await sleepGuarded(CANCEL_TO_SPEAK_MS);         /* ★ cancel() 直後の speak() は飲み込まれる */
      if (stale(token)) { disarm(wd); return staleResult(); }

      var reason = await speakOnce(phrase.text, st.rate);
      disarm(wd);
      if (stale(token)) return staleResult();

      var verdict = classifySpeakReason(reason);

      if (verdict === 'fatal-tts') {
        /* 仕様 §5-14: reason === 'not-allowed' → onError({code:'tts-not-allowed'}); phase = IDLE */
        emitTtsError(reason, 'tts-not-allowed');
        setPhase(Phase.IDLE, { reason: 'tts-not-allowed' });
        endRun(token);
        return { status: 'tts-not-allowed' };
      }
      if (verdict === 'stop') {
        /* 停止ボタン等。何も表示せず元のフェーズへ戻す。 */
        setPhase(origin, { reason: 'tts-' + reason });
        endRun(token);
        return { status: 'cancelled' };
      }

      /* --- 3. GUARD(400ms)---------------------------------------------- */
      /* ★残響が消えるのを待つ。エコー(お手本を自分のマイクが拾う)対策の要。 */
      if (!setPhase(Phase.GUARD, { reason: 'tts-done' })) { endRun(token); return { status: 'rejected' }; }
      await sleepGuarded(GUARD_MS);
      if (stale(token)) return staleResult();

      /* --- 4. autoListen === false ならユーザーの 🎤 待ち ------------------ */
      if (st.autoListen === false) {
        setPhase(Phase.IDLE, { reason: 'manual-listen', notice: msgText('practice.manualListen') });
        endRun(token);
        return { status: 'awaiting-user' };
      }

      /* --- 5〜8. LISTENING → SCORING → REVIEW ---------------------------- */
      return await runListen(token, st);
    }

    /* ======================================================================
     * 3-8. LISTENING → SCORING → REVIEW(ステップ 5〜8)
     * ====================================================================== */

    async function runListen(token, st) {
      /* --- 5. LISTENING -------------------------------------------------- */
      if (!setPhase(Phase.LISTENING, { reason: 'listen' })) { endRun(token); return { status: 'rejected' }; }
      announceSafe(msgText('practice.annListening'));

      var wd = armWatchdog(token, LISTEN_WATCHDOG_MS, 'listening');
      var r;
      try {
        r = await rec.listen({
          lang: st.lang,                               /* recognizer が start() 直前に毎回代入する */
          maxAlternatives: 3,
          hardTimeoutMs: LISTEN_TIMEOUT_MS,
          onInterim: function (text) {
            if (stale(token)) return;
            lastInterim = text || '';
            emit('onInterim', lastInterim);            /* 表示専用。採点には使わない */
          },
          onSpeechStart: function () {
            if (stale(token)) return;
            speechDetected = true;
          }
        });
      } catch (e) {
        /* 仕様上 listen() は reject しないが、保険(不変条件 4)。 */
        r = { status: 'error', errorCode: 'unknown', transcript: '', alternatives: [] };
      }
      disarm(wd);
      if (stale(token)) return staleResult();
      if (!r || typeof r !== 'object') r = { status: 'error', errorCode: 'unknown' };

      /* --- 6. SCORING ---------------------------------------------------- */
      if (!setPhase(Phase.SCORING, { reason: 'listen-end' })) { endRun(token); return { status: 'rejected' }; }

      var code = r.errorCode || '';

      /* no-speech / timeout は**エラー扱いしない**(仕様 §5-14、落とし穴 15)。 */
      if (r.status === 'no-speech' || code === 'no-speech') {
        announceSafe(msgText('practice.noSpeech'));
        toastSafe(msgText('practice.noSpeech'), { type: 'info' });
        setPhase(Phase.IDLE, { reason: 'no-speech', notice: msgText('practice.noSpeech') });
        endRun(token);
        return { status: 'no-speech' };
      }
      if (r.status === 'timeout') {
        announceSafe(msgText('practice.timeout'));
        toastSafe(msgText('practice.timeout'), { type: 'info' });
        setPhase(Phase.IDLE, { reason: 'timeout', notice: msgText('practice.timeout') });
        endRun(token);
        return { status: 'timeout' };
      }
      /* aborted は自発的な中断。★何も表示しない。 */
      if (r.status === 'aborted' || code === 'aborted') {
        setPhase(Phase.IDLE, { reason: 'aborted' });
        endRun(token);
        return { status: 'aborted' };
      }
      /* 認識器そのものが使えない。ブラウザ非対応と同じ案内に寄せる。 */
      if (r.status === 'unavailable') {
        var mu = emitAsrError('service-not-allowed');
        setPhase(mu.fatal ? Phase.BLOCKED : Phase.IDLE, { reason: 'unavailable' });
        endRun(token);
        return { status: 'unavailable' };
      }
      if (r.status === 'busy') {
        setPhase(Phase.IDLE, { reason: 'busy' });
        endRun(token);
        return { status: 'busy' };
      }
      if (r.status === 'error') {
        var m = emitAsrError(code || 'unknown');
        /* fatal(not-allowed / audio-capture / service-not-allowed / language-not-supported)は
           BLOCKED。ここから自動再起動は**絶対にしない**(落とし穴 16)。 */
        setPhase(m.fatal ? Phase.BLOCKED : Phase.IDLE, { reason: 'asr-error', notice: m.title });
        endRun(token);
        return { status: 'error', code: m.code, fatal: m.fatal };
      }

      /* --- ここから 'ok'。採点する ---------------------------------------- */
      announceSafe(msgText('practice.annScoring'));
      var result = scoreResultFor(r);
      if (!result) {
        /* 採点に失敗しても練習は止めない。 */
        setPhase(Phase.IDLE, { reason: 'score-failed' });
        endRun(token);
        return { status: 'score-failed' };
      }

      /* --- 7. 記録(確定は commitAttempts。理由は同関数のコメント参照)------- */
      var attempt = {
        n: attempts.length + 1,
        at: Date.now(),
        deckId: deckId,
        phraseId: phrase.id,
        phrase: phrase,
        score: result.score,
        band: result.band,
        transcript: r.transcript || '',
        excluded: false,
        committed: false,
        result: result
      };
      attempts.push(attempt);

      /* --- 8. REVIEW ------------------------------------------------------ */
      var status = getPassStatus();
      if (!setPhase(Phase.REVIEW, { reason: 'scored' })) { endRun(token); return { status: 'rejected' }; }
      announceSafe(msgText('practice.annReview'));
      emit('onAttempt', publicAttempt(attempt), status);
      if (status.cleared) announceSafe(msgText('practice.cleared'));

      endRun(token);
      return { status: 'ok', attempt: publicAttempt(attempt), passStatus: status };
    }

    /* ======================================================================
     * 3-9. 公開: 読み上げだけ
     * ====================================================================== */

    /**
     * text を読み上げて、呼び出し前のフェーズ(IDLE / REVIEW)に戻す。
     * playThenListen() と同じく cancel → 200ms → speak の順序を守る。
     */
    async function speakStandalone(text, rate, tag) {
      var blocked = guardStart([Phase.IDLE, Phase.REVIEW]);
      if (blocked) return { status: blocked };
      if (!text || !String(text).trim()) return { status: 'empty' };

      var token = beginRun();
      var origin = phase;

      if (!setPhase(Phase.SPEAKING, { reason: tag })) { endRun(token); return { status: 'rejected' }; }
      announceSafe(msgText('practice.annSpeaking'));

      var wd = armWatchdog(token, SPEAK_WATCHDOG_MS, tag);
      haltAudio();
      await sleepGuarded(CANCEL_TO_SPEAK_MS);          /* ★ 落とし穴 10 */
      if (stale(token)) { disarm(wd); return staleResult(); }

      var reason = await speakOnce(String(text), rate);
      disarm(wd);
      if (stale(token)) return staleResult();

      var verdict = classifySpeakReason(reason);
      if (verdict === 'fatal-tts') {
        emitTtsError(reason, 'tts-not-allowed');
        setPhase(Phase.IDLE, { reason: 'tts-not-allowed' });
        endRun(token);
        return { status: 'tts-not-allowed' };
      }

      /* 読み上げただけなので、結果表示を消さないよう元のフェーズへ戻す。 */
      setPhase(origin, { reason: tag + '-done' });
      endRun(token);
      return { status: (verdict === 'stop') ? 'cancelled' : 'ok', reason: reason };
    }

    /** ▶ お手本だけ。設定の速度で読み上げる。 */
    function playModel() {
      if (!phrase) return Promise.resolve({ status: 'no-phrase' });
      return speakStandalone(phrase.text, readSettings().rate, 'play-model');
    }

    /**
     * 🐢 ゆっくり。rate を省略すると 1 回目 0.65 / 2 回目以降 0.5(仕様 §7-3 の S キー)。
     * @param {number=} rate
     */
    function playModelAt(rate) {
      if (!phrase) return Promise.resolve({ status: 'no-phrase' });
      var r;
      if (typeof rate === 'number' && isFinite(rate)) {
        r = clampNum(rate, 0.5, 1.5);
      } else {
        /* カウンタを進めるのは実際に受け付けたときだけ。
           先にガードを見ておかないと、busy で弾かれた押下でも 0.5 に進んでしまう。 */
        var rejected = guardStart([Phase.IDLE, Phase.REVIEW]);
        if (rejected) return Promise.resolve({ status: rejected });
        r = (slowCount === 0) ? SLOW_RATE_FIRST : SLOW_RATE_REPEAT;
        slowCount += 1;
      }
      return speakStandalone(phrase.text, r, 'play-slow');
    }

    /** 単語だけ読み上げる(結果表示の語をクリックしたとき)。少しゆっくりにする。 */
    function playWord(word) {
      if (!word || !String(word).trim()) return Promise.resolve({ status: 'empty' });
      return speakStandalone(String(word).trim(), WORD_RATE, 'play-word');
    }

    /* ======================================================================
     * 3-10. 公開: 🎤 話すだけ
     * ====================================================================== */

    /**
     * TTS を鳴らさずに認識だけ行う。
     * 直前まで読み上げていた場合だけ GUARD を挟む(不変条件 1 を確実にする)。
     */
    async function listenOnce() {
      var blocked = guardStart([Phase.IDLE, Phase.REVIEW]);
      if (blocked) return { status: blocked };
      if (!phrase) return { status: 'no-phrase' };

      var token = beginRun();
      var st = readSettings();

      commitAttempts();
      lastInterim = '';
      speechDetected = false;

      var wasSpeaking = ttsActive;
      haltAudio();

      if (wasSpeaking) {
        /* 読み上げの残響をマイクが拾わないように 400ms 待つ。 */
        if (!setPhase(Phase.GUARD, { reason: 'listen-only-guard' })) { endRun(token); return { status: 'rejected' }; }
        await sleepGuarded(GUARD_MS);
        if (stale(token)) return staleResult();
      }

      return await runListen(token, st);
    }

    /* ======================================================================
     * 3-11. 公開: 停止系
     * ====================================================================== */

    /**
     * ■ 話し終わり。★必ず stop()。abort() にすると認識結果が丸ごと消える(落とし穴 7)。
     * phase はここでは変えない。listen() の resolve が SCORING へ進める。
     */
    function stopListening() {
      if (destroyed) return { status: 'destroyed' };
      if (phase !== Phase.LISTENING) return { status: 'not-listening' };
      try { rec.stop(); } catch (e) { /* 失敗しても watchdog が拾う */ }
      logSafe('session.stopListening', {});
      return { status: 'ok' };
    }

    /**
     * 全停止(Esc / タブ非表示 / 画面離脱)。
     * REVIEW と IDLE のときはフェーズを変えない — タブを切り替えただけで
     * 結果表示が消えるのを避けるため。音声は必ず止める。
     */
    function cancelAll() {
      if (destroyed) return { status: 'destroyed' };
      invalidateRuns();
      clearAllTimers();
      haltAudio();
      lastInterim = '';
      speechDetected = false;
      logSafe('session.cancelAll', { phase: phase });

      if (phase === Phase.SPEAKING || phase === Phase.GUARD ||
          phase === Phase.LISTENING || phase === Phase.SCORING) {
        setPhase(Phase.IDLE, { reason: 'cancel' });
        announceSafe(msgText('practice.annStopped'));
      }
      return { status: 'ok' };
    }

    /* ======================================================================
     * 3-12. 公開: 直近の試行を記録から除外
     * ====================================================================== */

    /**
     * [X]「うまく拾えなかった(この回を記録から除く)」。
     * 直近の試行を passStatus の計算から外し、tracker にも渡さない。
     * hooks は呼ばない(画面は戻り値の passStatus / getAttempts() を見て再描画する)。
     */
    function excludeLastAttempt() {
      if (destroyed) return { status: 'destroyed', changed: false };
      if (!attempts.length) return { status: 'none', changed: false, passStatus: getPassStatus() };

      var a = attempts[attempts.length - 1];
      if (a.excluded) return { status: 'already', changed: false, passStatus: getPassStatus() };
      if (a.committed) {
        /* すでに tracker に渡した後(次の試行が始まっている)。取り消せない。 */
        return { status: 'too-late', changed: false, passStatus: getPassStatus() };
      }

      a.excluded = true;
      logSafe('session.excludeAttempt', { n: a.n, score: a.score });
      toastSafe(msgText('practice.excluded'), { type: 'info' });
      announceSafe(msgText('practice.excluded'));

      return {
        status: 'ok',
        changed: true,
        attempt: publicAttempt(a),
        passStatus: getPassStatus()
      };
    }

    /* ======================================================================
     * 3-13. 公開: フレーズ移動
     * ====================================================================== */

    function goTo(i) {
      if (destroyed) return { status: 'destroyed' };
      if (!total) return { status: 'no-phrase' };
      /* IDLE / REVIEW 以外では移動させない(不変条件 8)。 */
      if (!canNavigate()) return { status: 'busy' };

      var n = clampNum(Math.round(Number(i)), 0, total - 1);
      commitAttempts();

      index = n;
      phrase = phrases[n] || null;
      attempts = [];
      slowCount = 0;
      lastInterim = '';
      speechDetected = false;

      saveLastIndex(n);
      setPhase(Phase.IDLE, { reason: 'phrase-change' });   /* REVIEW からの復帰も含む */
      emit('onPhraseChange', index, phrase);
      return { status: 'ok', index: index, phrase: phrase };
    }

    function next() {
      if (destroyed) return { status: 'destroyed' };
      if (!canNavigate()) return { status: 'busy' };
      if (index >= total - 1) {
        /* デッキ末尾。記録を確定させてから画面に通知する。 */
        commitAttempts();
        logSafe('session.deckComplete', { deckId: deckId });
        announceSafe(msgText('practice.deckComplete'));
        emit('onDeckComplete');
        return { status: 'complete', index: index };
      }
      return goTo(index + 1);
    }

    function prev() {
      if (destroyed) return { status: 'destroyed' };
      if (!canNavigate()) return { status: 'busy' };
      if (index <= 0) return { status: 'first', index: index };
      return goTo(index - 1);
    }

    /* ======================================================================
     * 3-14. ライフサイクル
     * ====================================================================== */

    /* 不変条件 5: document.hidden になったら即 cancelAll()。
       99-app.js も同じことをするが、二重に呼ばれても cancelAll は冪等なので問題ない。
       裏で動き続けると network エラーや暴走の原因になる(落とし穴 31)。 */
    function onVisibilityChange() {
      if (document.hidden) cancelAll();
    }
    try { document.addEventListener('visibilitychange', onVisibilityChange, false); } catch (e) { /* 無視 */ }

    function destroy() {
      if (destroyed) return { status: 'destroyed' };
      commitAttempts();                       /* 未確定の試行を書き出す */
      destroyed = true;
      invalidateRuns();
      clearAllTimers();                       /* ★不変条件 7: タイマーを全部止める */
      try { if (LC.speaker && LC.speaker.stopSpeaking) LC.speaker.stopSpeaking(); } catch (e) { /* 無視 */ }
      ttsActive = false;
      try { rec.destroy(); } catch (e) { /* 無視 */ }
      try { document.removeEventListener('visibilitychange', onVisibilityChange, false); } catch (e) { /* 無視 */ }
      hooks = {};                             /* 画面が消えた後に呼び出さない */
      logSafe('session.destroy', { deckId: deckId });
      return { status: 'ok' };
    }

    /* ======================================================================
     * 3-15. 公開 API
     * ====================================================================== */

    return {
      /* --- 参照系(すべて同期・例外なし)--- */
      getPhase: function () { return phase; },
      getPhrase: function () { return phrase; },
      getIndex: function () { return index; },
      getTotal: function () { return total; },
      getDeck: function () { return deck; },
      getDeckId: function () { return deckId; },
      getAttempts: function () {
        var out = [], i;
        for (i = 0; i < attempts.length; i++) out.push(publicAttempt(attempts[i]));
        return out;
      },
      getPassStatus: getPassStatus,
      getInterim: function () { return lastInterim; },
      isSpeechDetected: function () { return speechDetected; },
      isBusy: function () { return activeToken !== 0; },
      isDestroyed: function () { return destroyed; },
      canNavigate: canNavigate,
      MAX_ATTEMPTS: MAX_ATTEMPTS,
      LISTEN_TIMEOUT_MS: LISTEN_TIMEOUT_MS,

      /* --- 音声系(Promise を返す。reject しない)--- */
      playModel: playModel,
      playModelAt: playModelAt,
      playWord: playWord,
      listenOnce: listenOnce,
      playThenListen: playThenListen,

      /* --- 制御系 --- */
      stopListening: stopListening,
      cancelAll: cancelAll,
      excludeLastAttempt: excludeLastAttempt,
      next: next,
      prev: prev,
      goTo: goTo,
      destroy: destroy
    };
  }

  LC.session = {
    Phase: Phase,
    ALLOWED: ALLOWED,                    /* テスト用に公開(遷移表の回帰確認) */
    MAX_ATTEMPTS: MAX_ATTEMPTS,
    GUARD_MS: GUARD_MS,
    CANCEL_TO_SPEAK_MS: CANCEL_TO_SPEAK_MS,
    LISTEN_TIMEOUT_MS: LISTEN_TIMEOUT_MS,
    SLOW_RATE_FIRST: SLOW_RATE_FIRST,
    SLOW_RATE_REPEAT: SLOW_RATE_REPEAT,
    create: create
  };

  LC.__loaded = (LC.__loaded || []).concat('session');
})(window.LC);

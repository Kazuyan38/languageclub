/* js/05-speech.js
 * LC.speaker(仕様 §5-12) + LC.recognizer(仕様 §5-13)
 *
 * ★このファイルは Web Speech API に触れてよい唯一の場所(仕様 §3-1 不変ルール 3)。
 *   speechSynthesis / SpeechRecognition を他のファイルから直接触らないこと。
 *
 * ★このファイルの設計方針(落とし穴チェックリスト由来。理由をすべてコメントに残す)
 *   - 公開関数は例外を投げない。非同期は reject せず必ず結果オブジェクト/理由文字列で resolve する。
 *   - continuous を true にするコードと onend 内 start() を「書かない」。
 *     書かなければ再起動ループは構造的に起きない(#17)。
 *   - 認識の確定は end イベントでのみ行う(#3)。
 *   - confidence は一切使わない。alternatives を並べ替えもしない(#5)。
 *   - SpeechRecognitionErrorEvent.message は使わない。分岐は event.error のみ(#19)。
 *   - タイマー ID はすべて配列で保持し、終了時に必ず全部 clearTimeout する(#33)。
 */
window.LC = window.LC || {};
(function (LC) {
  'use strict';

  /* ===========================================================================
   * 共通の小さなヘルパ(このファイル内だけで使う)
   * =========================================================================== */

  /** LC.util.clamp が未ロードでも落ちないようにした clamp。 */
  function clamp(x, lo, hi) {
    if (LC.util && typeof LC.util.clamp === 'function') return LC.util.clamp(x, lo, hi);
    var n = Number(x);
    if (!isFinite(n)) n = lo;
    return n < lo ? lo : (n > hi ? hi : n);
  }

  /** 診断画面がダンプするリングバッファへの記録。util が無くても落ちない。 */
  function log(tag, obj) {
    try {
      if (LC.util && typeof LC.util.log === 'function') LC.util.log(tag, obj);
    } catch (e) { /* 診断ログの失敗で本処理を止めない */ }
  }

  /**
   * 呼び出し側から渡されたフック(onStart など)を安全に呼ぶ。
   * ★フックが例外を投げても、こちらの状態機械が壊れてはいけない。
   */
  function safeCall(fn, arg) {
    if (typeof fn !== 'function') return;
    try { fn(arg); } catch (e) { log('speech-hook-error', { message: String(e && e.message) }); }
  }

  /** 'en_US' / 'en-us' などの表記ゆれを 'en-us' に寄せる(Android の一部が '_' 区切り)。 */
  function normLang(l) {
    return String(l == null ? '' : l).replace(/_/g, '-').toLowerCase();
  }

  /** 言語タグの先頭 2 文字('en-US' → 'en')。 */
  function langPrefix(l) {
    return normLang(l).slice(0, 2);
  }

  /** LC.settings は未ロード/失敗の可能性があるので必ず包んで読む。 */
  function getSettings() {
    try {
      if (LC.settings && typeof LC.settings.get === 'function') return LC.settings.get() || null;
    } catch (e) { /* 設定が読めなくても音声機能は動かす */ }
    return null;
  }

  /** 重複を除いた文字列配列を返す(alternatives 用)。 */
  function dedupe(list) {
    var out = [];
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (typeof s !== 'string') continue;
      s = s.trim();
      if (!s) continue;
      var key = '#' + s.toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;
      out.push(s);
    }
    return out;
  }

  /* ===========================================================================
   * LC.speaker — SpeechSynthesis ラッパ(仕様 §5-12 / §10-4)
   * =========================================================================== */

  var synth = (typeof window !== 'undefined' && window.speechSynthesis) ? window.speechSynthesis : null;

  var voices = [];            // 直近に取得できた音声一覧のキャッシュ
  var voicesLoaded = false;   // 一度でも loadVoices が完了したか
  var loadPromise = null;     // 進行中の loadVoices(多重に待ち合わせを作らない)
  var activeVoice = null;     // 実際に読み上げに使う音声(直列化不可なので LC.state には入れない)
  var speakerInited = false;
  var ttsDisabled = false;    // 読み上げを無効化した状態(仕様 §10-4「それでもダメなら読み上げ無効化」)
  var warmedUp = false;       // warmUp() の二重実行防止

  /* ★GC 対策(#9): 発話中の utterance をモジュールスコープに保持する。
     ローカル変数だけにすると Chrome が utterance を回収してしまい end も error も来なくなる。 */
  var currentUtterance = null;

  /* stopSpeaking() から「進行中の speak()」を確実に終わらせるための参照。
     cancel() が onerror を発火させないケースがあり、それだと speak() の Promise が永久に未解決になる。 */
  var activeFinish = null;

  /* stopSpeaking() のたびに進む世代番号。非同期の待ちを跨いだ後に
     「その間に止められていないか」を判定するために使う。 */
  var speakGeneration = 0;

  /* speechSynthesis.cancel() の直後に speak() を呼ぶと、発話が丸ごと飲み込まれ
     start も end も error も来ない(落とし穴 #10)。cancel から次の speak まで必ずこれだけ待つ。
     06-session.js の CANCEL_TO_SPEAK_MS と同じ値。 */
  var CANCEL_TO_SPEAK_MS = 200;

  /* 診断用のカウンタ(仕様 §10-4「timeout が 3 回連続なら読み上げが不安定」の判断材料)。 */
  var ttsStats = { timeouts: 0, consecutiveTimeouts: 0, fallbacks: 0, lastReason: null };

  /**
   * 起動時 1 回だけ呼ぶ。
   * - 前セッションの残骸を cancel() で掃除する(#30)
   * - pagehide / beforeunload / visibilitychange で必ず停止する(#30, #31)
   */
  function init() {
    try {
      if (speakerInited) return;
      speakerInited = true;
      if (!synth) { log('tts-unsupported', {}); return; }

      /* ★前のページの発話がキューに残ったまま新しいページで喋り出す事故を防ぐ(#30)。 */
      try { synth.cancel(); } catch (e) { /* 実装によっては投げるので握る */ }

      /* 音声一覧は後から増えることがある。増えたらキャッシュを更新する。 */
      try {
        if (typeof synth.addEventListener === 'function') {
          synth.addEventListener('voiceschanged', onVoicesChanged);
        } else {
          synth.onvoiceschanged = onVoicesChanged;
        }
      } catch (e) { /* 監視できなくても loadVoices のポーリングで拾える */ }

      window.addEventListener('pagehide', stopSpeaking);
      window.addEventListener('beforeunload', stopSpeaking);
      document.addEventListener('visibilitychange', function () {
        /* 裏に回ったら無条件で読み上げを止める(#31)。 */
        if (document.hidden) stopSpeaking();
      });

      /* 事前ロード。結果は使わない(キャッシュが温まればよい)。reject しないので catch 不要だが保険で包む。 */
      try { loadVoices(); } catch (e) { /* no-op */ }
    } catch (e) {
      log('tts-init-failed', { message: String(e && e.message) });
    }
  }

  function onVoicesChanged() {
    try {
      var list = readVoices();
      if (list.length) {
        voices = list;
        voicesLoaded = true;
        ensureActiveVoice();
      }
    } catch (e) { /* no-op */ }
  }

  function readVoices() {
    try {
      var list = synth ? synth.getVoices() : null;
      return (list && list.length) ? Array.prototype.slice.call(list) : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * 音声一覧の三重待ち(仕様 §5-12 / #25)。
   *   1) 同期で getVoices()。非空なら即 resolve
   *   2) 'voiceschanged' を待つ
   *   3) 100ms ポーリングを併用(voiceschanged が来ない Chrome バージョン対策)
   *   4) timeout(既定 3000ms)で現在値のまま resolve
   * ★ reject しない。音声が本当に 0 個の環境では voiceschanged は永久に来ないので、
   *   空配列で resolve するのが正当な結果。
   * @param {object} [opts] timeout:number(既定 3000)
   * @returns {Promise<SpeechSynthesisVoice[]>}
   */
  function loadVoices(opts) {
    var timeout = (opts && typeof opts.timeout === 'number' && opts.timeout > 0) ? opts.timeout : 3000;

    if (voicesLoaded && voices.length) return Promise.resolve(voices.slice());
    if (loadPromise) return loadPromise;

    loadPromise = new Promise(function (resolve) {
      if (!synth) {
        voicesLoaded = true;
        voices = [];
        loadPromise = null;
        resolve([]);
        return;
      }

      var done = false;
      var poll = null;
      var timer = null;

      function finish(list) {
        if (done) return;
        done = true;
        if (poll) { clearInterval(poll); poll = null; }
        if (timer) { clearTimeout(timer); timer = null; }
        try {
          if (typeof synth.removeEventListener === 'function') {
            synth.removeEventListener('voiceschanged', onChanged);
          }
        } catch (e) { /* no-op */ }
        voices = list.slice();
        voicesLoaded = true;
        ensureActiveVoice();
        /* 次回また呼ばれたときに再取得できるよう、進行中フラグは外す。
           音声が 0 個だった場合に「あとから増えた」を拾えるようにするため。 */
        loadPromise = null;
        resolve(voices.slice());
      }

      function onChanged() {
        var l = readVoices();
        if (l.length) finish(l);
      }

      /* 1) 同期取得 */
      var first = readVoices();
      if (first.length) { finish(first); return; }

      /* 2) voiceschanged */
      try {
        if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', onChanged);
      } catch (e) { /* no-op */ }

      /* 3) 100ms ポーリング */
      poll = setInterval(onChanged, 100);

      /* 4) タイムアウト。★ここで reject せず、空配列でも resolve する */
      timer = setTimeout(function () { finish(readVoices()); }, timeout);
    });

    return loadPromise;
  }

  /**
   * 英語音声をオフライン / オンラインに分けて返す。
   * @param {SpeechSynthesisVoice[]} [list] 省略時はキャッシュ
   * @param {string} [lang] 'en-US' など。完全一致を先頭に寄せるために使う
   * @returns {object} offline:SpeechSynthesisVoice[] と online:SpeechSynthesisVoice[] を持つ
   */
  function listEnglishVoices(list, lang) {
    var result = { offline: [], online: [] };
    try {
      var src = (list && list.length) ? list : voices;
      var want = normLang(lang || (getSettings() && getSettings().lang) || 'en-US');
      var prefix = want.slice(0, 2) || 'en';

      var eng = [];
      for (var i = 0; i < src.length; i++) {
        var v = src[i];
        if (!v || !v.lang) continue;
        if (langPrefix(v.lang) === prefix) eng.push(v);
      }

      /* 完全一致(en-US など)を先に、その後は名前順。表示順が毎回変わらないようにする。 */
      eng.sort(function (a, b) {
        var ea = (normLang(a.lang) === want) ? 0 : 1;
        var eb = (normLang(b.lang) === want) ? 0 : 1;
        if (ea !== eb) return ea - eb;
        var na = String(a.name || '');
        var nb = String(b.name || '');
        return na < nb ? -1 : (na > nb ? 1 : 0);
      });

      for (var j = 0; j < eng.length; j++) {
        if (eng[j].localService === true) result.offline.push(eng[j]);
        else result.online.push(eng[j]);
      }
    } catch (e) {
      log('tts-list-failed', { message: String(e && e.message) });
    }
    return result;
  }

  /**
   * 既定の音声を選ぶ。
   * ★英語音声が 0 個なら null を返す。日本語音声で英語を読ませることは絶対にしない(#27)。
   *   カタカナ英語は学習に有害なので、読み上げ機能ごと無効化するほうが正しい。
   * @returns {SpeechSynthesisVoice|null}
   */
  function pickDefaultVoice(list, lang) {
    try {
      var src = (list && list.length) ? list : voices;
      var want = normLang(lang || (getSettings() && getSettings().lang) || 'en-US');
      var prefix = want.slice(0, 2) || 'en';

      var pool = [];
      for (var i = 0; i < src.length; i++) {
        var v = src[i];
        if (v && v.lang && langPrefix(v.lang) === prefix) pool.push(v);
      }
      if (!pool.length) return null;   /* ★英語音声ゼロ → null */

      /* 完全一致があればそれだけを対象にする */
      var exact = pool.filter(function (v) { return normLang(v.lang) === want; });
      if (exact.length) pool = exact;

      /* オンラインなら高品質(リモート)優先、オフラインならローカル優先 */
      var preferLocal = !(typeof navigator !== 'undefined' && navigator.onLine !== false);
      var primary = pool.filter(function (v) { return (v.localService === true) === preferLocal; });
      if (!primary.length) primary = pool;

      /* 同格なら OS の既定音声を優先する */
      for (var k = 0; k < primary.length; k++) {
        if (primary[k] && primary[k]['default'] === true) return primary[k];
      }
      return primary[0] || null;
    } catch (e) {
      log('tts-pick-failed', { message: String(e && e.message) });
      return null;
    }
  }

  /**
   * 保存済み設定 {name, lang} から実体を復元する(#26)。
   * voiceURI は環境と Chrome バージョンで変わるので保存に使わない。
   * 復元順: name 完全一致 → lang 一致の最初の 1 つ → pickDefaultVoice
   */
  function resolveSavedVoice(list, saved) {
    try {
      var src = (list && list.length) ? list : voices;
      if (!src.length) return null;

      if (saved && saved.name) {
        for (var i = 0; i < src.length; i++) {
          if (src[i] && src[i].name === saved.name) return src[i];
        }
      }
      if (saved && saved.lang) {
        var want = normLang(saved.lang);
        for (var j = 0; j < src.length; j++) {
          if (src[j] && normLang(src[j].lang) === want) return src[j];
        }
      }
      /* 保存されていた言語で既定を選ぶ。ここで null になるのは
         「保存された lang が英語以外(古い設定・別端末からの持ち込み)」のときだけなので、
         そのときは現在の設定言語でもう一度選び直す。
         ★これをしないと、壊れた 1 件の設定値のせいで読み上げが丸ごと無効になる。 */
      var bySaved = pickDefaultVoice(src, (saved && saved.lang) || null);
      if (bySaved) return bySaved;
      var st = getSettings();
      return pickDefaultVoice(src, (st && st.lang) || 'en-US');
    } catch (e) {
      log('tts-resolve-failed', { message: String(e && e.message) });
      return null;
    }
  }

  /** 音声が未選択なら、設定 → 既定ロジックの順で 1 つ選んでおく。既に選択済みなら触らない。 */
  function ensureActiveVoice() {
    try {
      if (activeVoice || !voices.length) return;
      var st = getSettings();
      activeVoice = resolveSavedVoice(voices, st ? st.voice : null);
      if (activeVoice) log('tts-voice-auto', { name: activeVoice.name, lang: activeVoice.lang });
    } catch (e) { /* no-op */ }
  }

  /** 使う音声を差し替える(設定画面から)。null を渡すと自動選択に戻す。 */
  function setActiveVoice(voice) {
    try {
      activeVoice = voice || null;
      if (!activeVoice) ensureActiveVoice();
      /* 音声を選び直したら「読み上げ無効化」状態を解除して、もう一度チャンスを与える。 */
      if (activeVoice) ttsDisabled = false;
      return activeVoice;
    } catch (e) {
      return null;
    }
  }

  function getActiveVoice() {
    return activeVoice;
  }

  /**
   * 診断画面と LC.state.voice が使うサマリ(仕様 §6-1)。
   * ★ここで返す値はすべて JSON 直列化可能にする(音声の実体は入れない)。
   */
  function getVoiceSummary() {
    var summary = { total: 0, englishCount: 0, hasOfflineEnglish: false, selected: null, ready: false };
    try {
      var eng = listEnglishVoices(voices, (getSettings() && getSettings().lang) || 'en-US');
      summary.total = voices.length;
      summary.englishCount = eng.offline.length + eng.online.length;
      summary.hasOfflineEnglish = eng.offline.length > 0;
      summary.selected = activeVoice ? { name: String(activeVoice.name || ''), lang: String(activeVoice.lang || '') } : null;
      summary.ready = !!(synth && !ttsDisabled && activeVoice);
    } catch (e) { /* 既定値のまま返す */ }
    return summary;
  }

  /** 区切り文字を残したまま分割する。無限ループ対策つき。 */
  function splitKeeping(str, re) {
    var parts = [];
    var last = 0;
    var m;
    re.lastIndex = 0;
    while ((m = re.exec(str)) !== null) {
      var end = m.index + m[0].length;
      parts.push(str.slice(last, end));
      last = end;
      if (m[0].length === 0) re.lastIndex++;   /* 0 幅マッチでの無限ループ防止 */
    }
    if (last < str.length) parts.push(str.slice(last));
    return parts.filter(function (s) { return s.trim() !== ''; });
  }

  /** 空白位置で強制分割する(最後の手段)。 */
  function hardSplit(str, limit) {
    var out = [];
    var words = str.split(' ');
    var cur = '';
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      while (w.length > limit) {            /* 1 語が limit を超える異常データの保険 */
        if (cur.trim()) { out.push(cur.trim()); cur = ''; }
        out.push(w.slice(0, limit));
        w = w.slice(limit);
      }
      if (cur && (cur + ' ' + w).length > limit) { out.push(cur.trim()); cur = w; }
      else { cur = cur ? (cur + ' ' + w) : w; }
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  /**
   * 1 発話あたり maxLen 文字以内に分割する(#28)。
   * Google 系音声は約 15 秒で予告なく打ち切られ、rate を下げるほど閾値の文字数は短くなる。
   * 本アプリの教材は 6〜14 語なので通常は分割されないが、自作デッキ対策として必須。
   */
  function splitForSpeech(text, maxLen) {
    var limit = (typeof maxLen === 'number' && maxLen > 0) ? maxLen : 180;
    var src = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!src) return [];
    if (src.length <= limit) return [src];

    /* 文末優先で切る */
    var units = splitKeeping(src, /[.!?。！？]+\s*/g);

    /* 1 文が長すぎる場合はカンマで再分割、それでも長ければ空白で強制分割 */
    var expanded = [];
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (u.length <= limit) { expanded.push(u); continue; }
      var clauses = splitKeeping(u, /[,、;:]\s*/g);
      for (var j = 0; j < clauses.length; j++) {
        if (clauses[j].length <= limit) expanded.push(clauses[j]);
        else expanded = expanded.concat(hardSplit(clauses[j], limit));
      }
    }

    /* limit に収まる範囲で詰め直す(細切れにすると発話が不自然になるため) */
    var out = [];
    var cur = '';
    for (var k = 0; k < expanded.length; k++) {
      var p = expanded[k];
      if (cur && (cur + p).length > limit) { out.push(cur.trim()); cur = p; }
      else { cur += p; }
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  /**
   * 1 回分の発話(内部関数)。
   * @returns {Promise<{reason:string, started:boolean}>} ★ reject しない
   */
  function speakChunks(text, voice, rate, onStart) {
    return new Promise(function (resolve) {
      var settled = false;
      var started = false;      /* onstart が一度でも来たか(リモート音声フォールバックの判定に使う) */
      var current = null;
      var chunks = splitForSpeech(text, 180);
      var i = 0;
      var wd = null;

      function finish(reason) {
        if (settled) return;
        settled = true;
        if (wd) { clearTimeout(wd); wd = null; }
        current = null;
        currentUtterance = null;
        if (activeFinish === finish) activeFinish = null;
        resolve({ reason: reason, started: started });
      }
      /* stopSpeaking() から強制終了できるようにしておく(cancel で onerror が来ない実装がある) */
      activeFinish = finish;

      if (!chunks.length) { finish('empty'); return; }

      function next() {
        if (settled) return;                      /* ★cancel 後に残りのチャンクを喋らない */
        if (i >= chunks.length) { finish('end'); return; }
        var u;
        try {
          u = new SpeechSynthesisUtterance(chunks[i++]);
        } catch (e) {
          finish('synthesis-failed');
          return;
        }
        try {
          u.voice = voice;
          u.lang = voice.lang;                    /* ★voice と lang を必ず両方セット(#13) */
          u.rate = rate;
          u.pitch = 1;                            /* Google 音声では無視されるので UI にも出さない */
          u.volume = 1;
        } catch (e) { /* 一部プロパティが読み取り専用の実装があるので握る */ }

        current = u;
        currentUtterance = u;                     /* ★GC 対策(#9) */

        u.onstart = function () {
          started = true;
          if (i === 1) safeCall(onStart);         /* 最初のチャンクの開始だけを「読み上げ開始」とする */
        };
        u.onend = function () { next(); };
        u.onerror = function (e) {
          /* ★canceled / interrupted も「エラー」ではなく理由として resolve する(#14)。
             判断は呼び出し側(session)が行う。ここでエラー表示の判断はしない。 */
          finish((e && e.error) ? String(e.error) : 'synthesis-failed');
        };

        try { synth.speak(u); } catch (e) { finish('synthesis-failed'); }
      }

      /* ★ウォッチドッグ(#11)。end が来ないケースで永久に固まるのを防ぐ。 */
      var estMs = (String(text).length / 14 / rate) * 1000 * 2 + 4000;
      wd = setTimeout(function () {
        try { synth.cancel(); } catch (e) { /* no-op */ }
        finish('timeout');
      }, Math.min(20000, estMs));

      /* Chrome が内部的に paused のまま固着することがあるので resume を一度打つ。
         ★paused / speaking / pending を「判断」には使わない(#8)。resume は副作用の無い保険。 */
      try { synth.resume(); } catch (e) { /* no-op */ }

      next();
    });
  }

  /** リモート音声が沈黙したときに切り替える、ローカル(オフライン)英語音声を探す。 */
  function pickLocalEnglishVoice(exclude) {
    try {
      var st = getSettings();
      var eng = listEnglishVoices(voices, (st && st.lang) || 'en-US');
      for (var i = 0; i < eng.offline.length; i++) {
        var v = eng.offline[i];
        if (!v) continue;
        if (exclude && v.name === exclude.name) continue;
        return v;
      }
    } catch (e) { /* no-op */ }
    return null;
  }

  function recordReason(reason) {
    ttsStats.lastReason = reason;
    if (reason === 'timeout') {
      ttsStats.timeouts++;
      ttsStats.consecutiveTimeouts++;
    } else if (reason === 'end') {
      ttsStats.consecutiveTimeouts = 0;
    }
  }

  /**
   * お手本を読み上げる(仕様 §5-12 の確定実装 + §10-4 のフォールバック)。
   * @param {string} text
   * @param {object} [opts] voice:SpeechSynthesisVoice / rate:number / onStart:function
   * @returns {Promise<'end'|'timeout'|'canceled'|'interrupted'|'not-allowed'|'empty'|'no-voice'|'synthesis-failed'>}
   * ★ reject しない。'canceled' / 'interrupted' は正常系(#14)。
   */
  function speak(text, opts) {
    var o = opts || {};
    return new Promise(function (resolve) {
      try {
        if (!synth) { resolve('no-voice'); return; }
        if (!text || !String(text).trim()) { resolve('empty'); return; }  /* 空文字はキューを詰まらせる */
        if (ttsDisabled) { resolve('no-voice'); return; }                 /* 無効化後はテキストのみで練習継続 */

        var voice = o.voice || activeVoice;
        if (!voice) { resolve('no-voice'); return; }                      /* ★日本語音声で英語を読ませない(#27) */

        var st = getSettings();
        var rawRate = (typeof o.rate === 'number' && isFinite(o.rate)) ? o.rate
          : (st && typeof st.rate === 'number' ? st.rate : 0.9);
        var rate = clamp(rawRate, 0.5, 1.5);
        var myGeneration = speakGeneration;

        speakChunks(String(text), voice, rate, o.onStart).then(function (r) {
          /* リモート音声フォールバック(Chrome 130 型リグレッション対策 / 仕様 §5-12・§10-4)。
             「timeout かつ onstart が一度も来ていない」= 音声サーバから何も返ってこなかった状態。
             このときだけ localService:true の英語音声に切り替えて 1 回だけ再試行する。 */
          var needFallback = (r.reason === 'timeout' && !r.started) || r.reason === 'synthesis-failed';
          if (!needFallback) {
            recordReason(r.reason);
            resolve(r.reason);
            return;
          }

          var local = pickLocalEnglishVoice(voice);
          if (!local) {
            recordReason(r.reason);
            /* 合成そのものが失敗したなら、これ以上試しても同じなので読み上げを無効化する。
               timeout はネットワーク由来のことがあるので無効化まではしない。 */
            if (r.reason === 'synthesis-failed') {
              ttsDisabled = true;
              log('tts-disabled', { reason: r.reason });
            }
            resolve(r.reason);
            return;
          }

          ttsStats.fallbacks++;
          log('tts-fallback', { from: voice.name, to: local.name, reason: r.reason });

          /* ★ここに来る直前、ウォッチドッグが synth.cancel() を打っている(speakChunks 内)。
             cancel() の直後に speak() を呼ぶと発話が丸ごと飲み込まれ、start も end も error も
             来ない(落とし穴 #10)。待たずに再試行すると「救済のはずのフォールバックが必ず無音になり、
             2 つ目のウォッチドッグ満了後に読み上げ機能が丸ごと無効化される」という最悪の結果になる。
             他の呼び出し箇所(06-session.js / 09-screens.js)は全部 200ms 待っている。ここも合わせる。 */
          setTimeout(function () {
            /* 待っている間にユーザーが停止していたら、再試行せず素直に終わる。 */
            if (myGeneration !== speakGeneration) {
              recordReason('canceled');
              resolve('canceled');
              return;
            }

            /* 1 回目で onstart が来ていなければ、再試行側で onStart を通知する(UI の状態が進まなくなるのを防ぐ)。 */
            speakChunks(String(text), local, rate, r.started ? null : o.onStart).then(function (r2) {
              recordReason(r2.reason);
              if (r2.reason === 'end') {
                activeVoice = local;             /* 以降はローカル音声を使う */
                log('tts-fallback-ok', { name: local.name });
                resolve('end');
                return;
              }
              if (r2.reason === 'canceled' || r2.reason === 'interrupted') {
                resolve(r2.reason);              /* ユーザーが止めただけ。無効化しない */
                return;
              }
              /* 再試行も失敗 → 読み上げ機能を無効化し、テキストのみで練習を継続させる */
              ttsDisabled = true;
              log('tts-disabled', { reason: r2.reason });
              resolve(r2.reason);
            });
          }, CANCEL_TO_SPEAK_MS);
        });
      } catch (e) {
        log('tts-speak-failed', { message: String(e && e.message) });
        resolve('synthesis-failed');
      }
    });
  }

  /**
   * 読み上げを止める。
   * ★呼んだ直後に speak() を呼ばないこと(#10)。200ms 待たないと次の発話が丸ごと飲み込まれる。
   *   この待ちは session 側(§5-14 playThenListen の手順 2)が持つ。
   */
  function stopSpeaking() {
    /* 世代を進める。フォールバック再試行の 200ms 待ちの最中に止められた場合、
       待ち明けに「もう止められている」と気づけるようにするため(#14 の延長)。 */
    speakGeneration++;
    try { if (synth) synth.cancel(); } catch (e) { /* no-op */ }
    try { if (activeFinish) activeFinish('canceled'); } catch (e) { /* no-op */ }
    currentUtterance = null;
  }

  /**
   * 最初のユーザージェスチャで volume:0 の短い発話を 1 回流す(#29)。
   * ページ読み込み直後の自動読み上げは sticky activation が無く not-allowed になるため、
   * オンボーディングのボタン押下時にここを通して「初回だけ無音」を回避する。
   * ★二重実行しない。
   * @returns {Promise<'ok'|'already'|'skipped'|'failed'>} ★ reject しない
   */
  function warmUp() {
    return new Promise(function (resolve) {
      try {
        if (warmedUp) { resolve('already'); return; }
        warmedUp = true;                          /* ★先に立てて二重実行を防ぐ */
        if (!synth) { resolve('skipped'); return; }

        try { synth.resume(); } catch (e) { /* no-op */ }

        var u;
        try { u = new SpeechSynthesisUtterance('a'); } catch (e) { resolve('failed'); return; }
        u.volume = 0;                             /* 無音。耳に聞こえないウォームアップ */
        u.rate = 1;
        u.pitch = 1;
        if (activeVoice) {
          u.voice = activeVoice;
          u.lang = activeVoice.lang;
        } else {
          u.lang = 'en-US';
        }
        currentUtterance = u;                     /* ★GC 対策(#9) */

        var settled = false;
        function done(reason) {
          if (settled) return;
          settled = true;
          clearTimeout(t);
          currentUtterance = null;
          log('tts-warmup', { reason: reason });
          resolve(reason === 'end' ? 'ok' : 'failed');
        }
        var t = setTimeout(function () { done('timeout'); }, 3000);
        u.onend = function () { done('end'); };
        u.onerror = function (e) { done((e && e.error) ? String(e.error) : 'error'); };

        try { synth.speak(u); } catch (e) { done('throw'); }
      } catch (e) {
        resolve('failed');
      }
    });
  }

  /** 診断画面(§7-7)向けの内部カウンタ。仕様には無い読み取り専用の追加 API。 */
  function getDiagnostics() {
    return {
      supported: !!synth,
      disabled: ttsDisabled,
      warmedUp: warmedUp,
      voicesLoaded: voicesLoaded,
      timeouts: ttsStats.timeouts,
      consecutiveTimeouts: ttsStats.consecutiveTimeouts,
      fallbacks: ttsStats.fallbacks,
      lastReason: ttsStats.lastReason
    };
  }

  LC.speaker = {
    init: init,
    loadVoices: loadVoices,
    listEnglishVoices: listEnglishVoices,
    pickDefaultVoice: pickDefaultVoice,
    resolveSavedVoice: resolveSavedVoice,
    setActiveVoice: setActiveVoice,
    getActiveVoice: getActiveVoice,
    getVoiceSummary: getVoiceSummary,
    speak: speak,
    stopSpeaking: stopSpeaking,
    warmUp: warmUp,
    splitForSpeech: splitForSpeech,   /* テスト用に公開(純関数) */
    getDiagnostics: getDiagnostics
  };

  /* ===========================================================================
   * LC.recognizer — SpeechRecognition ラッパ(仕様 §5-13)
   * =========================================================================== */

  /** end が来ないときの保険。stop() 後に待つ時間。 */
  var STOP_GRACE_MS = 6000;
  /** abort() 後に end が来ないときの保険。 */
  var ABORT_GRACE_MS = 1200;

  function getCtor() {
    try {
      if (LC.env && typeof LC.env.getRecognitionCtor === 'function') return LC.env.getRecognitionCtor();
    } catch (e) { /* env が壊れていても下のフォールバックで拾う */ }
    return (window.SpeechRecognition || window.webkitSpeechRecognition || null);
  }

  /**
   * 認識器を 1 つ作る。
   * @returns {object} isAvailable / isBusy / listen / stop / cancel / destroy を持つ
   */
  function create() {
    var ctor = getCtor();
    var rec = null;

    var busy = false;
    var running = false;
    var settled = true;          /* listen 中でなければ true(誤って resolve しないため) */
    var intentional = false;     /* 自発的な abort かどうか。#6 の握り潰しに使う */
    var destroyed = false;

    var finalText = '';
    var alts = [];
    var lastError = null;
    var resolveCurrent = null;

    var startedAt = 0;
    var endedAt = 0;
    var speechStartAt = 0;
    var speechMs = 0;

    /* ★タイマー ID はすべて配列で保持し、終了時に必ず全部 clear する(#33)。 */
    var timers = [];

    function addTimer(fn, ms) {
      var id = setTimeout(fn, ms);
      timers.push(id);
      return id;
    }

    function clearTimers() {
      for (var i = 0; i < timers.length; i++) {
        try { clearTimeout(timers[i]); } catch (e) { /* no-op */ }
      }
      timers.length = 0;
    }

    function onVisibility() {
      /* 裏に回ったら認識を止める(#31)。裏で動き続けると network エラーや暴走の原因になる。 */
      if (document.hidden) cancel();
    }
    try { document.addEventListener('visibilitychange', onVisibility); } catch (e) { /* no-op */ }

    function ensureRec() {
      if (rec) return rec;
      if (!ctor) return null;
      try { rec = new ctor(); } catch (e) {
        log('asr-ctor-failed', { message: String(e && e.message) });
        rec = null;
      }
      return rec;
    }

    function detach(r) {
      if (!r) return;
      try {
        r.onstart = null; r.onend = null; r.onerror = null; r.onresult = null;
        r.onspeechstart = null; r.onspeechend = null;
        r.onaudiostart = null; r.onaudioend = null;
        r.onsoundstart = null; r.onsoundend = null; r.onnomatch = null;
      } catch (e) { /* no-op */ }
    }

    /**
     * インスタンスを捨てて作り直せる状態にする。
     * 保険で先に settle したあと、古いインスタンスが遅れて end を投げてきても
     * 新しい listen に混ざらないようにするため。
     */
    function recycle() {
      var old = rec;
      rec = null;
      if (!old) return;
      detach(old);                                  /* ★先にハンドラを外してから abort する */
      try { old.abort(); } catch (e) { /* no-op */ }
    }

    function buildResult(base) {
      return {
        status: base.status,
        transcript: (typeof base.transcript === 'string') ? base.transcript : '',
        alternatives: base.alternatives || [],
        errorCode: base.errorCode || null,
        startedAt: startedAt || 0,
        endedAt: endedAt || Date.now(),
        speechMs: speechMs || 0
      };
    }

    function settleWith(base) {
      if (settled) return;
      settled = true;
      busy = false;
      running = false;
      endedAt = Date.now();
      clearTimers();
      var res = resolveCurrent;
      resolveCurrent = null;
      if (res) {
        /* ★ここで必ず resolve する。reject は絶対にしない(仕様 §5)。 */
        try { res(buildResult(base)); } catch (e) { log('asr-resolve-failed', {}); }
      }
    }

    /**
     * 確定処理。★end イベントからのみ呼ばれる(#3)。
     * result が audioend より後に来ることがあるため、speechend / audioend では確定しない。
     */
    function settle() {
      if (settled) return;
      var transcript = String(finalText || '').trim();   /* ★2 文目以降の先頭スペース対策(#20) */

      if (intentional) {
        /* 自発 cancel。呼び出し側は「何も表示しない」で IDLE に戻る(仕様 §5-14 手順 6)。 */
        settleWith({ status: 'aborted', transcript: transcript });
        return;
      }
      if (lastError === 'no-speech') {
        settleWith({ status: 'no-speech', transcript: transcript });
        return;
      }
      if (lastError) {
        settleWith({ status: 'error', errorCode: lastError, transcript: transcript });
        return;
      }
      if (transcript === '') {
        /* ★nomatch には依存しない(#18)。Chrome では発火しないので
           「end まで来て final が 0 件」を no-speech と判定する。 */
        settleWith({ status: 'no-speech' });
        return;
      }
      settleWith({
        status: 'ok',
        transcript: transcript,
        alternatives: dedupe([transcript].concat(alts))
      });
    }

    /**
     * 代替候補を集める。
     * ★confidence を読まない・ソートし直さない(#5)。
     *   interim の confidence は 0.01 / 0.9 の固定ダミーで、final の alternatives も降順である保証がない。
     *   採点側(scoreBest)が全候補を総当たりするので、順序に意味を持たせる必要がない。
     */
    function collectAlternatives(item) {
      var out = [];
      try {
        var n = Math.min(item.length || 0, 5);
        for (var i = 0; i < n; i++) {
          var a = item[i];
          var t = (a && a.transcript) ? String(a.transcript).trim() : '';
          if (t) out.push(t);
        }
      } catch (e) { /* no-op */ }
      return out;
    }

    function resolveListenLang(lang) {
      if (typeof lang === 'string' && lang.trim()) return lang.trim();
      var st = getSettings();
      if (st && typeof st.lang === 'string' && st.lang.trim()) return st.lang.trim();
      return 'en-US';
    }

    function isAvailable() {
      return !!ctor && !destroyed;
    }

    function isBusy() {
      return busy;
    }

    /**
     * 1 回だけ聞き取る。
     * @param {object} [opts] lang:string / maxAlternatives:number(既定 3) /
     *        hardTimeoutMs:number(既定 25000) / onInterim / onStart / onSpeechStart
     * @returns {Promise<object>} ListenResult:
     *        status:'ok'|'no-speech'|'aborted'|'timeout'|'error'|'busy'|'unavailable',
     *        transcript:string, alternatives:string[], errorCode:string|null,
     *        startedAt:number, endedAt:number, speechMs:number
     * ★ reject しない。必ず ListenResult で resolve する。
     */
    function listen(opts) {
      var o = opts || {};
      return new Promise(function (resolve) {
        try {
          if (destroyed || !ctor) {
            resolve({ status: 'unavailable', transcript: '', alternatives: [], errorCode: null, startedAt: 0, endedAt: Date.now(), speechMs: 0 });
            return;
          }
          if (busy) {
            resolve({ status: 'busy', transcript: '', alternatives: [], errorCode: null, startedAt: 0, endedAt: Date.now(), speechMs: 0 });
            return;
          }
          var r = ensureRec();
          if (!r) {
            resolve({ status: 'unavailable', transcript: '', alternatives: [], errorCode: null, startedAt: 0, endedAt: Date.now(), speechMs: 0 });
            return;
          }

          busy = true;
          settled = false;
          intentional = false;
          running = false;
          finalText = '';
          alts = [];
          lastError = null;
          startedAt = Date.now();
          endedAt = 0;
          speechStartAt = 0;
          speechMs = 0;
          resolveCurrent = resolve;

          /* 直前の listen の遅れて来たイベントを取り違えないための世代番号。 */
          var myRec = r;
          function mine() { return rec === myRec && !settled; }

          r.onstart = function () {
            if (!mine()) return;
            running = true;
            safeCall(o.onStart);
          };
          r.onspeechstart = function () {
            if (!mine()) return;
            speechStartAt = Date.now();
            safeCall(o.onSpeechStart);
          };
          r.onspeechend = function () {
            if (!mine()) return;
            /* ★ここでは確定しない(#3)。speechMs を測るだけ。 */
            if (speechStartAt) speechMs = Date.now() - speechStartAt;
          };
          r.onresult = function (e) {
            if (!mine()) return;
            var interim = '';
            try {
              /* ★resultIndex から走査して isFinal だけ連結する(#4)。
                 results のインデックスをキーにした Map/配列に溜めてはいけない。
                 interim 2 件が final 1 件に統合されて length が減り、インデックスが再割り当てされる。 */
              for (var i = e.resultIndex; i < e.results.length; i++) {
                var item = e.results[i];
                if (!item) continue;
                var head = item[0];
                var t = (head && head.transcript) ? String(head.transcript) : '';
                if (item.isFinal) {
                  finalText += t;
                  alts = collectAlternatives(item);
                } else {
                  interim += t;
                }
              }
            } catch (err) {
              log('asr-result-error', { message: String(err && err.message) });
            }
            safeCall(o.onInterim, (finalText + interim).trim());
          };
          r.onerror = function (e) {
            if (rec !== myRec) return;
            /* ★SpeechRecognitionErrorEvent.message は Chrome では空文字。分岐は event.error のみ(#19)。 */
            var code = (e && e.error) ? String(e.error) : 'unknown';
            lastError = code;
            if (code === 'aborted' && intentional) {
              /* ★自発 abort は必ず error('aborted') を発火させる。
                 握り潰さないとユーザーに無関係なエラーが出る(#6)。 */
              lastError = null;
            }
            log('asr-error', { code: code, intentional: intentional });
            /* ★ここで再起動しない。not-allowed / audio-capture などを自動再試行すると
               3ms 周期の無限ループでタブが固まる(#16)。end を待って settle するだけ。 */
          };
          r.onend = function () {
            if (rec !== myRec) return;
            settle();                       /* ★確定は end でのみ(#3) */
          };
          /* nomatch には依存しない(#18)。ハンドラも置かない。 */

          try {
            /* ★lang は start() の直前に毎回代入する(#2)。
               既定は空文字で <html lang="ja"> を拾い、エラーも出さずに日本語認識になる。 */
            r.lang = resolveListenLang(o.lang);
            r.continuous = false;           /* ★false 固定。自動再起動ループを構造的に不可能にする(#17) */
            r.interimResults = true;        /* 表示専用。採点は isFinal のみ */
            r.maxAlternatives = (typeof o.maxAlternatives === 'number' && o.maxAlternatives > 0)
              ? o.maxAlternatives : 3;
          } catch (e) {
            log('asr-config-failed', { message: String(e && e.message) });
          }

          var hardMs = (typeof o.hardTimeoutMs === 'number' && o.hardTimeoutMs > 0) ? o.hardTimeoutMs : 25000;

          try {
            r.start();
          } catch (e) {
            /* ★running フラグと try/catch の両方で守る(#32)。
               権限拒否時は onstart が発火しないので、フラグだけでは足りない。 */
            if (e && e.name === 'InvalidStateError') {
              running = true;               /* 実はもう動いていた。end を待つ */
            } else {
              log('asr-start-failed', { message: String(e && e.message) });
              recycle();
              settleWith({ status: 'error', errorCode: 'start-failed' });
              return;
            }
          }

          /* ハードタイムアウトのウォッチドッグ。end が来ない環境でも必ず抜ける。 */
          addTimer(function () {
            if (settled) return;
            intentional = true;             /* この abort は自発なので error は握り潰される */
            try { if (rec === myRec) myRec.abort(); } catch (e) { /* no-op */ }
            recycle();
            settleWith({ status: 'timeout' });
          }, hardMs);

        } catch (e) {
          log('asr-listen-failed', { message: String(e && e.message) });
          busy = false;
          settled = true;
          resolve({ status: 'error', transcript: '', alternatives: [], errorCode: 'start-failed', startedAt: 0, endedAt: Date.now(), speechMs: 0 });
        }
      });
    }

    /**
     * 「話し終わり」。★必ずこちらを使う(#7)。
     * intentional を立てずに stop() すると、それまでの音声が認識サーバに投げられて最終結果が返る。
     * abort() にすると認識結果が丸ごと消える。
     */
    function stop() {
      try {
        if (!busy || settled) return;
        if (rec) { try { rec.stop(); } catch (e) { /* no-op */ } }

        /* stop() 後に end が来ない実装の保険。ここまで来たら諦めて timeout 扱いにする。 */
        var target = rec;
        addTimer(function () {
          if (settled) return;
          intentional = true;
          try { if (target) target.abort(); } catch (e) { /* no-op */ }
          recycle();
          settleWith({ status: 'timeout' });
        }, STOP_GRACE_MS);
      } catch (e) {
        log('asr-stop-failed', { message: String(e && e.message) });
      }
    }

    /**
     * 中断。結果は返らない(listen は status:'aborted' で resolve する)。
     * ★intentional を立ててから abort する。立てないと error('aborted') がユーザーに見えてしまう(#6)。
     */
    function cancel() {
      try {
        if (!busy || settled) {
          /* listen 中でなくても、取り残されたインスタンスがあれば止めておく */
          if (rec && running) { try { rec.abort(); } catch (e) { /* no-op */ } }
          running = false;
          return;
        }
        intentional = true;
        if (rec) { try { rec.abort(); } catch (e) { /* no-op */ } }

        /* abort 後に end が来ない実装の保険。listen の Promise を宙に浮かせない。 */
        addTimer(function () {
          if (settled) return;
          recycle();
          settleWith({ status: 'aborted' });
        }, ABORT_GRACE_MS);
      } catch (e) {
        log('asr-cancel-failed', { message: String(e && e.message) });
      }
    }

    /** 後片付け。全ハンドラ解除・全タイマー clear・保留中の listen も必ず解決する。 */
    function destroy() {
      try {
        destroyed = true;
        try { document.removeEventListener('visibilitychange', onVisibility); } catch (e) { /* no-op */ }
        intentional = true;
        var old = rec;
        rec = null;
        if (old) {
          detach(old);
          try { old.abort(); } catch (e) { /* no-op */ }
        }
        settleWith({ status: 'aborted' });   /* 保留中の listen を宙に浮かせない */
        clearTimers();
        busy = false;
        running = false;
      } catch (e) {
        log('asr-destroy-failed', { message: String(e && e.message) });
      }
    }

    return {
      isAvailable: isAvailable,
      isBusy: isBusy,
      listen: listen,
      stop: stop,
      cancel: cancel,
      destroy: destroy
    };
  }

  LC.recognizer = { create: create };

  LC.__loaded = (LC.__loaded || []).concat(['speaker', 'recognizer']);
})(window.LC);

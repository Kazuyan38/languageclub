/* js/08-screen-practice.js — 練習画面(仕様 §7-3)★このアプリの中核画面
 * ============================================================================
 * 役割
 *   デッキ 1 個ぶんの練習 UI。5 つの状態を描き分ける。
 *     (A) IDLE       お手本を読んで待っている
 *     (B) SPEAKING / GUARD  読み上げ中・残響待ち(操作を実際に disabled にする)
 *     (C) LISTENING  録音中(レベルメーター / interim / 残り秒数 / 小音量警告)
 *     (D) REVIEW     結果を同一画面の下に展開(画面遷移しない)
 *     (E) エラー     インラインパネル(モーダルにしない)
 *
 * このファイルが守る境界(仕様 §3-1)
 *   ・LC.speaker / LC.recognizer を直接呼ばない。音声はすべて LC.session 経由。
 *   ・localStorage に触らない(触ってよいのは 02-store.js だけ)。
 *   ・日本語の文言は LC.msg にあるものだけを使う(画面ファイルに直書きしない)。
 *
 * 文言の規律(仕様 §0-1)
 *   「発音採点」「発音が間違っています」「不合格」は使わない。
 *   測っているのは「Google の認識器に伝わったか」だけである。
 *
 * 画面モジュールの共通シグネチャ(仕様 §6-2)
 *   render(ctx) -> {el, title, destroy(), onKey(e):boolean}
 *   ctx = {params:{deckId, i}, state, navigate(hash)}
 * ============================================================================
 */
window.LC = window.LC || {};
(function (LC) {
  'use strict';

  /* ==========================================================================
   * 0. 定数
   * ========================================================================== */

  /** Chrome の no-speech は約 8 秒。これを「残り N 秒」として可視化する(仕様 §7-3 C)。
   *  ★ここは表示のためだけの値。実際に止めるのは認識器側であって、この値ではない。 */
  var NO_SPEECH_MS = 8000;

  /** 残り秒数・小音量判定の更新間隔。秒表示なので 200ms で十分(DOM 書き換えを減らす)。 */
  var TICK_MS = 200;

  /** 録音開始直後は暗騒音しか無いので、この時間は「音が小さい」と判定しない。 */
  var QUIET_GRACE_MS = 1500;

  /* ==========================================================================
   * 1. 小さなヘルパ
   *    LC.util は index.html の順序で必ず先に読み込まれているが、
   *    順序事故で白画面にしないため参照は毎回 LC 経由で行う(07-ui.js と同じ方針)。
   * ========================================================================== */

  function h(tag, props) {
    var u = LC.util;
    if (u && typeof u.h === 'function') return u.h.apply(null, arguments);
    var el = document.createElement(tag);
    if (props && props.text) el.textContent = String(props.text);
    if (props && props['class']) el.setAttribute('class', String(props['class']));
    return el;
  }

  function clear(el) {
    var u = LC.util;
    if (u && typeof u.clear === 'function') return u.clear(el);
    while (el && el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  /** 文言。未定義キーはキー文字列がそのまま返る(仕様 §5-2)。 */
  function t(key, vars) {
    if (LC.msg && typeof LC.msg.t === 'function') return LC.msg.t(key, vars);
    return String(key);
  }

  function announce(text) {
    if (!text) return;
    try { if (LC.util && LC.util.announce) LC.util.announce(text); } catch (e) { /* 通知できなくても続行 */ }
  }

  function log(tag, obj) {
    try { if (LC.util && LC.util.log) LC.util.log(tag, obj); } catch (e) { /* 診断ログの失敗は無視 */ }
  }

  /**
   * session の非同期メソッドは仕様上 reject しないが、万一 reject しても
   * window.unhandledrejection(第 3 層)が「予期しないエラー」を出さないように受けておく。
   */
  function ignore(p) {
    if (p && typeof p.then === 'function') {
      p.then(function () {}, function (e) { log('practice.promiseRejected', { error: String(e) }); });
    }
    return p;
  }

  /**
   * class の付け外し。classList を直接使わず class 属性で操作する。
   * 07-ui.js が className を組み立てているのと同じ流儀に揃え、
   * テスト用の簡易 DOM でも同じコードが動くようにするため。
   */
  function toggleClass(el, name, on) {
    if (!el || !name) return;
    var cur = (el.getAttribute('class') || '').split(/\s+/);
    var out = [], i, has = false;
    for (i = 0; i < cur.length; i++) {
      if (!cur[i]) continue;
      if (cur[i] === name) { has = true; if (!on) continue; }
      out.push(cur[i]);
    }
    if (on && !has) out.push(name);
    el.setAttribute('class', out.join(' '));
  }

  /** disabled と aria-disabled は必ず同時に付ける(仕様 §12-1)。 */
  function setDisabled(btn, off) {
    if (!btn) return;
    btn.disabled = !!off;
    if (off) btn.setAttribute('aria-disabled', 'true');
    else btn.removeAttribute('aria-disabled');
  }

  /** ボタンの中身を作り直す。絵文字は aria-hidden(意味はテキスト側が持つ。仕様 §12-3)。 */
  function fillBtn(btn, icon, label, kbd) {
    clear(btn);
    if (icon) btn.appendChild(h('span', { text: icon, attrs: { 'aria-hidden': 'true' } }));
    btn.appendChild(h('span', { text: label }));
    if (kbd) btn.appendChild(h('span', { 'class': 'kbd', text: kbd, attrs: { 'aria-hidden': 'true' } }));
  }

  function iconBtn(id, icon, label, cls, onClick) {
    var btn = h('button', {
      id: id,
      'class': ['btn', 'btn--sm'].concat(cls || []),
      attrs: { type: 'button' },
      on: { click: onClick }
    });
    fillBtn(btn, icon, label, null);
    return btn;
  }

  function getDeck(deckId) {
    try {
      if (LC.catalog && typeof LC.catalog.getDeck === 'function') return LC.catalog.getDeck(deckId);
    } catch (e) { /* 壊れた教材で画面ごと落とさない */ }
    return null;
  }

  function getSettings() {
    try {
      if (LC.settings && typeof LC.settings.get === 'function') return LC.settings.get();
    } catch (e) { /* fallthrough */ }
    return (LC.settings && LC.settings.DEFAULTS) || {};
  }

  /* ==========================================================================
   * 2. デッキが見つからないとき(壊れた URL / 教材の読み込み失敗)
   * ========================================================================== */

  function notFoundScreen(ctx, deckId) {
    var el = h('section', { 'class': 'practice' });
    var panel = null;
    if (LC.ui && typeof LC.ui.errorPanel === 'function') {
      panel = LC.ui.errorPanel({
        title: t('practice.notFound'),
        body: t('home.empty'),
        actions: [
          { label: t('common.home'), primary: true, onClick: function () { navigateTo(ctx, '#/'); } },
          'diagnostics'
        ]
      });
    } else {
      panel = h('p', { text: t('practice.notFound') });
    }
    el.appendChild(panel);
    log('practice.deckNotFound', { deckId: deckId });
    return {
      el: el,
      title: t('practice.notFound'),
      destroy: function () { /* 何も持っていない */ },
      onKey: function () { return false; }
    };
  }

  function navigateTo(ctx, hash) {
    if (ctx && typeof ctx.navigate === 'function') {
      try { ctx.navigate(hash); return; } catch (e) { /* 下の location にフォールバック */ }
    }
    try { location.hash = hash; } catch (e) { log('practice.navFailed', { hash: hash }); }
  }

  /* ==========================================================================
   * 3. 本体
   * ========================================================================== */

  function render(ctx) {
    ctx = ctx || {};
    var params = ctx.params || {};
    var deckId = String(params.deckId == null ? '' : params.deckId);
    var deck = getDeck(deckId);

    if (!deck || !deck.phrases || !deck.phrases.length) return notFoundScreen(ctx, deckId);
    if (!LC.session || typeof LC.session.create !== 'function') return notFoundScreen(ctx, deckId);

    var Phase = LC.session.Phase;
    var total = deck.phrases.length;
    var destroyed = false;
    var completed = false;         /* サマリへ遷移済み(二重遷移の防止) */

    /* このフレーズがこの画面でクリアされたか(進捗ドットを即時に反映するため)。
       tracker への確定は session 側で遅延されるので、画面はここを併用する。 */
    var localCleared = Object.create(null);
    var deckProgress = readDeckProgress(deckId);

    /* --- 録音中だけ動かすもの(destroy() で必ず全部止める。落とし穴 33)------- */
    var tickTimer = null;
    var listenStartedAt = 0;
    var quietNotified = false;
    var meter = null;
    var meterSeq = 0;

    /* ======================================================================
     * 3-1. DOM を組み立てる
     * ====================================================================== */

    var el = h('section', { 'class': 'practice', data: { phase: Phase.IDLE } });

    /* --- 見出し行: ← / カテゴリ名 / 2 / 6 --------------------------------- */
    var backLink = h('a', {
      'class': ['btn', 'btn--ghost', 'btn--sm', 'practice__back'],
      attrs: { href: '#/', 'aria-label': t('practice.backToHome') }
    }, h('span', { text: '←', attrs: { 'aria-hidden': 'true' } }));

    var titleEl = h('h1', {
      'class': 'practice__title',
      text: deck.title,
      attrs: { 'aria-label': t('practice.deckAria', { title: deck.title }) }
    });
    var counterEl = h('span', { 'class': ['practice__counter', 'nums'] });

    el.appendChild(h('div', { 'class': 'practice__head' }, backLink, titleEl, counterEl));

    /* --- デッキ全体の進捗ドット ------------------------------------------- */
    var progressWrap = h('div', { 'class': 'practice__progress' });
    el.appendChild(progressWrap);

    /* --- お手本カード ------------------------------------------------------
       ★英文は常時表示。隠さない(仕様 §7-3 A)。
         「隠して思い出させる」設計にすると、初めて触る 1 年生が最初の 1 回を
         声に出せずに終わる。このアプリの唯一の実効変数は発話回数である。 */
    var enEl = h('p', { 'class': 'phrase-en', attrs: { lang: 'en' } });
    var jaEl = h('p', { 'class': 'phrase-ja' });
    var noteTextEl = h('span');
    var noteEl = h('p', { 'class': 'phrase-note' },
      h('span', { text: '💡', attrs: { 'aria-hidden': 'true' } }), noteTextEl);
    var attemptWrap = h('div', { 'class': 'practice__attempts' });

    el.appendChild(h('article', { 'class': ['card', 'phrase-card'] }, enEl, jaEl, noteEl, attemptWrap));

    /* --- エラー(E)と結果(D)。どちらも同一画面の下に展開する ------------ */
    var errorArea = h('div', { 'class': 'practice__error' });
    var resultArea = h('div', { id: 'resultArea', 'class': 'practice__result' });
    el.appendChild(errorArea);
    el.appendChild(resultArea);

    /* --- 録音パネル(C)---------------------------------------------------
       録音中だけ出す。「録音中」を赤い面にしない(失敗と誤読されるため)。 */
    var meterUi = (LC.ui && typeof LC.ui.levelMeterEl === 'function')
      ? LC.ui.levelMeterEl('levelMeter')
      : { el: h('div', { 'class': 'level-meter', id: 'levelMeter' }), set: function () {}, reset: function () {} };

    var interimEl = (LC.ui && typeof LC.ui.interimEl === 'function')
      ? LC.ui.interimEl('interimText')
      /* interim には aria-live を付けない(頻繁に書き換わる。仕様 §12-2) */
      : h('p', { 'class': 'interim', id: 'interimText', attrs: { 'aria-live': 'off' } });

    /* 残り秒数はスクリーンリーダーに読ませない(仕様 §12-2)。目で見る手がかり専用。 */
    var timerEl = h('p', { 'class': ['mic-panel__timer', 'nums'], attrs: { 'aria-hidden': 'true' } });
    var quietEl = h('p', { 'class': 'mic-panel__warn', text: t('practice.tooQuiet'), hidden: true });

    /* ★ mic-panel__title の文言(🔴 どうぞ、話してください)は LC.msg が絵文字ごと持っている。
       CSS の .mic-panel__rec(点滅する丸)を併用すると赤い印が 2 つ並ぶので、ここでは使わない。 */
    var micPanel = h('div', { 'class': 'mic-panel', hidden: true },
      h('p', { 'class': 'mic-panel__title', text: t('practice.btnListening') }),
      meterUi.el, interimEl, timerEl, quietEl);

    /* --- 操作ブロック ------------------------------------------------------
       ★主ボタンは 1 つだけ。フェーズによってラベルと動作が変わる(仕様 §7-3)。
         結果(resultArea)の**下**に置くので、REVIEW では「🔁 もう一度」が
         画面の左下・大きいボタンになる(発話回数を最大化する配置)。 */
    var btnPrimary = h('button', {
      id: 'btnPrimary',
      'class': ['btn', 'btn--primary'],
      attrs: { type: 'button', 'aria-describedby': 'statusRegion' },
      on: { click: onPrimaryClick }
    });

    var btnPlayModel = iconBtn('btnPlayModel', '▶', t('practice.btnPlayModel'), null, function () {
      ignore(session.playModel());
    });
    var btnSlow = iconBtn('btnSlow', '🐢', t('practice.btnSlow'), null, doSlow);
    var btnListenOnly = iconBtn('btnListenOnly', '🎤', t('practice.btnListenOnly'), null, function () {
      ignore(session.listenOnce());
    });
    var btnPrev = iconBtn('btnPrev', '←', t('practice.btnPrev'), null, doPrev);
    var btnNext = iconBtn('btnNext', null, t('practice.btnNext'), null, doNext);

    var subRow = h('div', { 'class': ['actions', 'actions--sub'] },
      btnPlayModel, btnSlow, btnListenOnly, btnPrev, btnNext);

    /* [X] うまく拾えなかった(この回を記録から除く)。REVIEW のときだけ出す。 */
    var btnExclude = iconBtn('btnExclude', '✕', t('practice.btnExclude'), 'btn--ghost', doExclude);
    var excludeLine = h('div', { 'class': 'exclude-line', hidden: true }, btnExclude);

    /* .stack は「縦積み + 一定の間隔」の汎用ユーティリティ(css/style.css)。
       tokens.css に [hidden]{display:none !important} があるので、
       flex の子でも hidden 属性で確実に消える。 */
    el.appendChild(h('div', { 'class': ['practice__controls', 'stack'] },
      micPanel,
      btnPrimary,
      subRow,
      excludeLine,
      /* R2(エコー)対策の最終防衛線。スピーカー利用時にお手本を自分のマイクが拾う。 */
      h('p', { 'class': 'hint-line', text: t('common.headphoneTip') }),
      h('p', { 'class': ['hint-line', 'small', 'muted'], text: t('practice.keyHelp') })
    ));

    /* ======================================================================
     * 3-2. セッション(TTS↔ASR の排他はすべて session の中で起きる)
     * ====================================================================== */

    var session = LC.session.create({
      deck: deck,
      startIndex: resolveStartIndex(params.i, deckId, total),
      getSettings: getSettings,
      hooks: {
        onPhaseChange: onPhaseChange,
        onInterim: onInterim,
        onAttempt: onAttempt,
        onError: onError,
        onPhraseChange: onPhraseChange,
        onDeckComplete: onDeckComplete
      }
    });

    /* ★このセッションを 99-app.js に登録する。
       99-app.js の onBeforeLeave / stopEverything / 全域エラーハンドラは、
       ここで登録されたセッションを cancelAll() する。登録し忘れると
       「エラーパネルを出しているのにマイクが録音し続ける」状態になる。
       destroy() で必ず null に戻すこと。 */
    try { if (LC.app && LC.app.setActiveSession) LC.app.setActiveSession(session); }
    catch (e) { log('practice.registerSessionFailed', {}); }

    /* セッション履歴(§11-3)。書き込みは endSession() の 1 回だけ。
       体験モード・記録オフのときは store 側が no-op になるので、ここでは分岐しない。 */
    try { if (LC.tracker && LC.tracker.startSession) LC.tracker.startSession(deckId); }
    catch (e) { log('practice.startSessionFailed', {}); }

    refreshPhrase();
    applyPhase(session.getPhase(), null);

    /* ======================================================================
     * 3-3. hooks — session からの通知で画面を更新する
     * ====================================================================== */

    function onPhaseChange(phase, meta) {
      if (destroyed) return;

      /* 新しい試行が始まったら、前回の結果とエラーを片付ける。
         ▶ お手本だけ / 🐢 ゆっくり(reason: play-model / play-slow / play-word)では
         結果を消さない — 聞き直しながら結果を読むのが自然な使い方なので。 */
      var reason = meta && meta.reason;
      if (reason === 'play-then-listen' || reason === 'listen' || reason === 'listen-only-guard') {
        clear(resultArea);
        clear(errorArea);
      }

      applyPhase(phase, meta);
      announcePhase(phase, meta);

      /* no-speech / timeout の直後は「もう一度」にフォーカスを戻す(落とし穴 15)。
         エラー扱いにせず、次の 1 回をすぐ押せる状態にするのが目的。 */
      if (phase === Phase.IDLE && meta && meta.notice) {
        try { btnPrimary.focus(); } catch (e) { /* フォーカスできなくても続行 */ }
      }
    }

    /** 表示専用。採点には一切使わない。★アナウンスもしない(仕様 §12-2)。 */
    function onInterim(text) {
      if (destroyed) return;
      if (LC.ui && typeof LC.ui.setInterim === 'function') LC.ui.setInterim(interimEl, text);
      else interimEl.textContent = text || '';
    }

    function onAttempt(attempt, passStatus) {
      if (destroyed) return;
      if (passStatus && passStatus.cleared) {
        var ph = session.getPhrase();
        if (ph && ph.id) localCleared[ph.id] = true;
      }
      renderResult(attempt);
      refreshDots();
      renderExclude('button');
    }

    /**
     * @param {Object} payload {code, source, fatal, silent, title, body, actions}
     * インラインパネル(モーダルにしない。仕様 §12-1)。
     */
    function onError(payload) {
      if (destroyed || !payload) return;
      /* canceled / interrupted / no-speech などは silent。エラーを見せない(落とし穴 14)。 */
      if (payload.silent || !payload.title) return;

      clear(errorArea);
      if (!LC.ui || typeof LC.ui.errorPanel !== 'function') return;

      var panel = LC.ui.errorPanel({
        title: payload.title,
        body: payload.body,
        actions: payload.actions,
        tone: payload.fatal ? 'fatal' : null,
        onAction: function (key) {
          /* retry だけは「この画面の主ボタンと同じ動作」なので画面が引き受ける。
             reload / settings / diagnostics などは LC.ui 側に既定の動作がある。 */
          if (key === 'retry') { clear(errorArea); onPrimaryClick(); }
        }
      });
      errorArea.appendChild(panel);
      try { panel.focus(); } catch (e) { /* フォーカスできなくても内容は読める */ }
      log('practice.error', { code: payload.code, fatal: !!payload.fatal });
    }

    function onPhraseChange() {
      if (destroyed) return;
      clear(resultArea);
      clear(errorArea);
      renderExclude('hidden');
      refreshPhrase();
    }

    function onDeckComplete() {
      if (destroyed || completed) return;
      /* ★ 1 回だけ。ルーターが destroy() を呼ぶまでの間に「次へ」を連打されても、
         サマリへの遷移を二重に走らせない。 */
      completed = true;
      /* 記録を閉じてからサマリへ。サマリは最新のセッション記録を読む。 */
      try { if (LC.tracker && LC.tracker.endSession) LC.tracker.endSession(); }
      catch (e) { log('practice.endSessionFailed', {}); }
      navigateTo(ctx, '#/summary/' + deck.id);
    }

    /* ======================================================================
     * 3-4. フェーズ → UI
     * ====================================================================== */

    /** 主ボタンの見た目と動作(仕様 §7-3 の A〜E)。 */
    function primarySpec(phase) {
      switch (phase) {
        case Phase.SPEAKING:
          return { label: t('practice.btnSpeaking'), disabled: true };
        case Phase.GUARD:
          return { label: t('practice.btnGuard'), disabled: true };
        case Phase.LISTENING:
          /* ★ここは stopListening()(= recognizer.stop())。abort() にすると結果が消える。 */
          return { label: t('practice.btnStop'), disabled: false, kbd: t('practice.keyHintSpace') };
        case Phase.SCORING:
          return { label: t('practice.btnScoring'), disabled: true };
        case Phase.BLOCKED:
          return { label: t('practice.btnBlocked'), disabled: true };
        case Phase.REVIEW:
          return {
            icon: '🔁', label: t('practice.btnRetry'), disabled: false,
            kbd: t('practice.keyHintSpace'), retry: true
          };
        default:
          return { icon: '▶', label: t('practice.btnStart'), disabled: false, kbd: t('practice.keyHintSpace') };
      }
    }

    function applyPhase(phase, meta) {
      var spec = primarySpec(phase);
      fillBtn(btnPrimary, spec.icon, spec.label, spec.kbd);
      setDisabled(btnPrimary, spec.disabled);
      /* REVIEW の主ボタンは「もう一度」。CSS 側が大きく見せるための印。 */
      toggleClass(btnPrimary, 'btn--retry', !!spec.retry);

      /* ★SPEAKING / GUARD / LISTENING / SCORING では副ボタンを実際に disabled にする。
         TTS を鳴らしている最中に録音を始められる導線を UI に残さない(R2 対策)。 */
      var navOk = (phase === Phase.IDLE || phase === Phase.REVIEW);
      setDisabled(btnPlayModel, !navOk);
      setDisabled(btnSlow, !navOk);
      setDisabled(btnListenOnly, !navOk);
      setDisabled(btnPrev, !navOk || session.getIndex() <= 0);
      setDisabled(btnNext, !navOk);
      setDisabled(btnExclude, !navOk);

      excludeLine.hidden = !(phase === Phase.REVIEW && hasExcludable());
      el.setAttribute('data-phase', phase);

      if (phase === Phase.LISTENING) startListeningUi();
      else stopListeningUi();

      if (meta && meta.notice && phase !== Phase.LISTENING) {
        /* notice(声が聞こえませんでした 等)は session がトーストも出すので、ここでは表示しない。 */
        log('practice.notice', { phase: phase, reason: meta.reason });
      }
    }

    /** フェーズ変化を読み上げる。interim は読み上げない(仕様 §12-2)。 */
    function announcePhase(phase, meta) {
      if (meta && meta.notice) { announce(meta.notice); return; }
      if (phase === Phase.SPEAKING) announce(t('practice.annSpeaking'));
      else if (phase === Phase.LISTENING) announce(t('practice.annListening'));
      /* REVIEW は LC.ui.renderResult() が「バンド + ◯語中◯語」を通知するので二重に言わない。 */
    }

    /* ======================================================================
     * 3-5. LISTENING の UI(レベルメーター / 残り秒数 / 小音量警告)
     * ====================================================================== */

    function startListeningUi() {
      if (tickTimer) return;                 /* 二重起動しない */
      listenStartedAt = Date.now();
      quietNotified = false;

      micPanel.hidden = false;
      quietEl.hidden = true;
      if (LC.ui && typeof LC.ui.setInterim === 'function') LC.ui.setInterim(interimEl, '');
      else interimEl.textContent = '';
      meterUi.reset();
      toggleClass(meterUi.el, 'level-meter--off', false);
      timerEl.hidden = false;
      timerEl.textContent = t('practice.remainSeconds', { n: Math.round(NO_SPEECH_MS / 1000) });

      startMeter();
      tickTimer = setInterval(tick, TICK_MS);
    }

    function stopListeningUi() {
      if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
      stopMeter();
      micPanel.hidden = true;
      quietEl.hidden = true;
      timerEl.textContent = '';
    }

    function tick() {
      if (destroyed) return;
      var elapsed = Date.now() - listenStartedAt;

      /* 声が検出されたら「残り N 秒」は意味を失う(no-speech の窓は閉じた)。 */
      var speaking = false;
      try { speaking = !!session.isSpeechDetected(); } catch (e) { speaking = false; }

      if (speaking) {
        timerEl.hidden = true;
      } else {
        var left = Math.ceil((NO_SPEECH_MS - elapsed) / 1000);
        if (left < 0) left = 0;
        timerEl.hidden = false;
        timerEl.textContent = t('practice.remainSeconds', { n: left });
      }

      /* 会場が騒がしい / マイクが遠い を先に気づかせる(R11)。 */
      if (!speaking && meter && meter.available && elapsed > QUIET_GRACE_MS) {
        var quiet = false;
        try { quiet = !!meter.tooQuiet(); } catch (e) { quiet = false; }
        if (quiet && quietEl.hidden) {
          quietEl.hidden = false;
          toggleClass(meterUi.el, 'level-meter--quiet', true);
          if (!quietNotified) { quietNotified = true; announce(t('practice.tooQuiet')); }
        }
      }
    }

    /**
     * レベルメーターは「無くても練習が成立する」機能。
     * createLevelMeter() は失敗しても reject せず available:false の no-op を返す(仕様 §5-15)。
     */
    function startMeter() {
      if (!LC.ui || typeof LC.ui.createLevelMeter !== 'function') return;
      var my = ++meterSeq;
      var p = LC.ui.createLevelMeter(function (level) {
        if (my !== meterSeq || destroyed) return;
        meterUi.set(level);
      });
      if (!p || typeof p.then !== 'function') return;
      p.then(function (m) {
        /* 権限プロンプトを操作している間に録音が終わっていることがある。
           そのときは受け取った瞬間に止める(マイクを開きっぱなしにしない)。 */
        if (!m) return;
        if (my !== meterSeq || destroyed) { try { m.stop(); } catch (e) { /* 無視 */ } return; }
        meter = m;
        if (!m.available) toggleClass(meterUi.el, 'level-meter--off', true);
      }, function () { /* reject しない仕様。念のため握る */ });
    }

    function stopMeter() {
      meterSeq += 1;                          /* 遅れて解決したメーターを無効化する */
      if (meter) {
        try { meter.stop(); } catch (e) { /* 止められなくても続行 */ }
        meter = null;
      }
      meterUi.set(0);
      toggleClass(meterUi.el, 'level-meter--quiet', false);
    }

    /* ======================================================================
     * 3-6. 結果(D)の描画
     * ====================================================================== */

    function renderResult(attempt) {
      clear(resultArea);
      if (!attempt || !attempt.result) return;
      if (!LC.ui || typeof LC.ui.renderResult !== 'function') return;

      var st = getSettings();
      var panel = LC.ui.renderResult(attempt.result, {
        showScore: st.showScore === true,      /* 既定は非表示。点数を主役にしない(R13) */
        prevScore: previousScore(),
        onWordClick: function (word) { ignore(session.playWord(word)); }
      });
      resultArea.appendChild(panel);

      /* 事実(聞こえた文)から読ませたいので、パネルの先頭にフォーカスを置く。
         パネルは tabindex="-1" を持つ(07-ui.js)。 */
      try { panel.focus(); } catch (e) { /* フォーカスできなくても内容は読める */ }
    }

    /** 直前の(除外していない)試行の点数。「前回 74 → +14」の表示に使う。 */
    function previousScore() {
      var list = [];
      try { list = session.getAttempts() || []; } catch (e) { list = []; }
      var i, seen = 0;
      for (i = list.length - 1; i >= 0; i--) {
        if (list[i].excluded) continue;
        seen += 1;
        if (seen === 2) return list[i].score;   /* 1 つめは今回ぶん */
      }
      return null;
    }

    /* ======================================================================
     * 3-7. 「うまく拾えなかった」
     * ====================================================================== */

    function hasExcludable() {
      var list = [];
      try { list = session.getAttempts() || []; } catch (e) { list = []; }
      if (!list.length) return false;
      return !list[list.length - 1].excluded;
    }

    /** @param {string} mode 'button' | 'done' | 'hidden' */
    function renderExclude(mode) {
      if (mode === 'hidden') { excludeLine.hidden = true; return; }
      clear(excludeLine);
      if (mode === 'done') {
        /* 押した後はボタンを消し、除いたことだけを残す(二度押しの余地を作らない)。 */
        excludeLine.appendChild(h('span', { 'class': ['small', 'muted'], text: t('practice.excluded') }));
        excludeLine.hidden = false;
        return;
      }
      excludeLine.appendChild(btnExclude);
      excludeLine.hidden = !hasExcludable();
    }

    function doExclude() {
      var r = session.excludeLastAttempt();
      if (!r || !r.changed) return;           /* none / already / too-late は何もしない */
      renderExclude('done');
      refreshDots();
      /* 除外でクリア状態が変わることがあるので、進捗ドットの見立ても戻す。 */
      var ph = session.getPhrase();
      if (ph && ph.id && r.passStatus && !r.passStatus.cleared) delete localCleared[ph.id];
    }

    /* ======================================================================
     * 3-8. フレーズ表示の更新
     * ====================================================================== */

    function refreshPhrase() {
      var phrase = session.getPhrase();
      var index = session.getIndex();
      if (!phrase) return;

      counterEl.textContent = t('practice.counter', { i: index + 1, n: total });
      counterEl.setAttribute('aria-label', t('practice.counterAria', { i: index + 1, n: total }));

      enEl.textContent = phrase.text || '';
      jaEl.textContent = phrase.ja || '';
      jaEl.hidden = !phrase.ja;
      noteTextEl.textContent = phrase.note || '';
      noteEl.hidden = !phrase.note;

      /* 最後のフレーズでは「次へ」を「このカテゴリを終える」に変える。
         押した先がサマリであることを、押す前に分かるようにする。 */
      fillBtn(btnNext, null, (index >= total - 1) ? t('practice.btnFinish') : t('practice.btnNext'), null);
      setDisabled(btnPrev, !session.canNavigate() || index <= 0);

      refreshDots();
    }

    function refreshDots() {
      /* デッキ全体の進捗(●●○○○○) */
      clear(progressWrap);
      if (LC.ui && typeof LC.ui.progressDots === 'function') {
        progressWrap.appendChild(LC.ui.progressDots(clearedCount(), total));
      }
      /* このフレーズの通じ率(●●○ + あと 1 回通じればクリア) */
      clear(attemptWrap);
      if (LC.ui && typeof LC.ui.attemptDots === 'function') {
        var st = null;
        try { st = session.getPassStatus(); } catch (e) { st = null; }
        attemptWrap.appendChild(LC.ui.attemptDots(st));
      }
    }

    /** 記録済みのクリア + この画面でクリアしたぶん(記録は遅延確定なので画面側で足す)。 */
    function clearedCount() {
      var n = 0, i, id, done;
      for (i = 0; i < deck.phrases.length; i++) {
        id = deck.phrases[i].id;
        done = !!localCleared[id] ||
               !!(deckProgress.phrases[id] && deckProgress.phrases[id].cleared);
        if (done) n += 1;
      }
      return n;
    }

    /* ======================================================================
     * 3-9. 操作(ボタンとキーボードで同じ関数を呼ぶ)
     * ====================================================================== */

    function onPrimaryClick() {
      var phase = session.getPhase();
      if (phase === Phase.LISTENING) {
        /* ★「話し終わり」は必ず stop()。abort() だと認識結果が丸ごと消える(落とし穴 7)。 */
        session.stopListening();
        return;
      }
      if (phase === Phase.IDLE || phase === Phase.REVIEW) {
        ignore(session.playThenListen());
        return;
      }
      /* SPEAKING / GUARD / SCORING / BLOCKED では何もしない(ボタンは disabled)。 */
    }

    /** 🐢 ゆっくり。引数なしで呼ぶと 1 回目 0.65 → 2 回目以降 0.5(仕様 §7-3 の S キー)。 */
    function doSlow() { ignore(session.playModelAt()); }

    function doNext() {
      var r = session.next();
      /* complete のときは onDeckComplete フックがサマリへ送る。ここでは何もしない。 */
      if (r && r.status === 'busy') log('practice.navBusy', { dir: 'next' });
    }

    function doPrev() {
      var r = session.prev();
      if (r && r.status === 'busy') log('practice.navBusy', { dir: 'prev' });
    }

    /** Esc = パニックボタン。どの状態からでも全部止める。 */
    function doStopAll() {
      session.cancelAll();
      clear(errorArea);
    }

    /* ======================================================================
     * 3-10. キーボードショートカット(仕様 §7-3 の表)
     * ====================================================================== */

    /** input / textarea / select / contenteditable にフォーカスがあるときは無効(仕様 §12-1)。 */
    function inEditable(target) {
      if (!target || !target.tagName) return false;
      var tag = String(target.tagName).toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      return target.isContentEditable === true;
    }

    /**
     * ボタン・リンクにフォーカスがあるときの Space / Enter は**ブラウザに任せる**。
     * ここで横取りすると「フォーカス中のボタンの click」と「主ボタンの動作」が
     * 二重に走る。押した本人には理由の分からない挙動になるので必ず避ける。
     */
    function isActivatable(target) {
      if (!target || !target.tagName) return false;
      var tag = String(target.tagName).toLowerCase();
      if (tag === 'button' || tag === 'summary') return true;
      if (tag === 'a' && target.hasAttribute('href')) return true;
      return target.getAttribute && target.getAttribute('role') === 'button';
    }

    function onKey(e) {
      if (destroyed || !e) return false;
      /* 日本語入力の変換中は何もしない(keyCode 229 は IME 確定前) */
      if (e.isComposing || e.keyCode === 229) return false;

      var key = e.key;
      var target = e.target || document.activeElement;

      /* ★ Esc は常に全停止(仕様 §12-1)。編集中かどうかも問わない。 */
      if (key === 'Escape' || key === 'Esc') {
        doStopAll();
        e.preventDefault();
        return true;
      }

      if (e.ctrlKey || e.altKey || e.metaKey) return false;
      if (inEditable(target)) return false;

      if (key === ' ' || key === 'Spacebar' || key === 'Enter') {
        if (isActivatable(target)) return false;      /* ブラウザの既定動作に任せる */
        onPrimaryClick();
        e.preventDefault();
        return true;
      }

      switch (key) {
        case 'r': case 'R':                            /* もう一度 */
          if (session.canNavigate()) ignore(session.playThenListen());
          e.preventDefault();
          return true;
        case 's': case 'S':                            /* ゆっくり聞く */
          doSlow();
          e.preventDefault();
          return true;
        case 'n': case 'N': case 'ArrowRight':         /* 次のフレーズ */
          doNext();
          e.preventDefault();
          return true;
        case 'p': case 'P': case 'ArrowLeft':          /* 前のフレーズ */
          doPrev();
          e.preventDefault();
          return true;
        case 'x': case 'X':                            /* うまく拾えなかった */
          doExclude();
          e.preventDefault();
          return true;
        default:
          return false;
      }
    }

    /* ======================================================================
     * 3-11. 後始末
     * ====================================================================== */

    function destroy() {
      if (destroyed) return;
      destroyed = true;

      /* ★止め忘れが Web Speech アプリの死因第 1 位(落とし穴 33)。
         レベルメーター(getUserMedia + AudioContext + rAF)と interval を必ず止める。 */
      stopListeningUi();

      /* session.destroy() が未確定の試行を tracker に書き出す。
         セッション履歴を閉じるのはそのあと(集計に間に合わせるため順序が重要)。 */
      try { session.destroy(); } catch (e) { log('practice.destroyFailed', {}); }
      try { if (LC.tracker && LC.tracker.endSession) LC.tracker.endSession(); }
      catch (e) { log('practice.endSessionFailed', {}); }

      /* 登録の解除。破棄済みセッションを 99-app.js が掴んだままにしない。 */
      try { if (LC.app && LC.app.setActiveSession) LC.app.setActiveSession(null); }
      catch (e) { /* 無視 */ }
    }

    return {
      el: el,
      title: deck.title,
      destroy: destroy,
      onKey: onKey
    };
  }

  /* ==========================================================================
   * 4. 起動位置の決定
   * ========================================================================== */

  function readDeckProgress(deckId) {
    var empty = { lastIndex: 0, phrases: {} };
    try {
      if (LC.tracker && typeof LC.tracker.getDeckProgress === 'function') {
        var p = LC.tracker.getDeckProgress(deckId);
        if (p && typeof p === 'object') {
          return { lastIndex: p.lastIndex || 0, phrases: p.phrases || {} };
        }
      }
    } catch (e) { /* 記録が読めなくても練習はできる */ }
    return empty;
  }

  /**
   * `#/practice/intro?i=3` の i を優先し、無ければ「つづきから」(記録の lastIndex)。
   * @returns {number} 0 <= n < total
   */
  function resolveStartIndex(raw, deckId, total) {
    var n = Number(raw);
    if (raw !== undefined && raw !== null && raw !== '' && isFinite(n)) {
      n = Math.floor(n);
    } else {
      n = readDeckProgress(deckId).lastIndex;
      n = isFinite(Number(n)) ? Math.floor(Number(n)) : 0;
    }
    if (!(n >= 0)) n = 0;
    if (n > total - 1) n = total - 1;
    return n;
  }

  /* ==========================================================================
   * 5. 公開
   * ========================================================================== */

  LC.screens = LC.screens || {};
  LC.screens.practice = { render: render };

  LC.__loaded = (LC.__loaded || []).concat('screen-practice');
})(window.LC);

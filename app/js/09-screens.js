/* js/09-screens.js — 練習以外の全画面
 *   §7-1 onboarding / §7-2 home / §7-4 summary / §7-5 stats /
 *   §7-6 settings / §7-7 help / §7-8 decks / §10-3 blocked
 *
 * 画面モジュールの共通シグネチャ(全画面同じ):
 *   LC.screens.xxx = {
 *     render: function (ctx) {            // ctx = {params, state, navigate}
 *       return { el, title, destroy: function(){}, onKey: function(e){ return handled; } };
 *     }
 *   };
 *
 * 守っている規律:
 *   - 公開関数は例外を投げない。非同期は reject せず結果オブジェクトで resolve する側だけを呼ぶ。
 *   - localStorage には触らない(LC.store 経由のみ)。
 *   - speechSynthesis / SpeechRecognition には触らない(LC.speaker / LC.recognizer 経由のみ)。
 *   - 日本語の文言は LC.msg に集約。ここには直書きしない。
 *   - 絵文字アイコンは必ず aria-hidden="true"。意味はテキストで別に持つ。
 *   - Liquid(GitHub Pages / Jekyll)対策で、二重波かっこ・波かっこ+パーセントの並びを書かない。
 *
 * ★音声について: この画面群は session を介さない単発再生のために LC.speaker を直接呼ぶ。
 *   ただし「鳴らしている間は認識を開始しない」を必ず守る(§7-7 の診断テストの busy フラグ)。
 */
window.LC = window.LC || {};
(function (LC) {
  'use strict';

  var util = LC.util;
  var h = util.h;
  var qs = util.qs;
  var toast = util.toast;
  var announce = util.announce;
  var log = util.log;

  function t(key, vars) { return LC.msg.t(key, vars); }
  function list(key) { return LC.msg.list(key); }

  LC.screens = LC.screens || {};

  /* ============================================================
   * 0. 共通の小道具
   * ============================================================ */

  /** ハッシュ遷移。ctx.navigate があればそれを使う(ルーターに主導権を渡す)。 */
  function go(ctx, hash) {
    try {
      if (ctx && typeof ctx.navigate === 'function') { ctx.navigate(hash); return; }
      location.hash = hash;
    } catch (e) {
      log('screens.nav.error', { hash: hash });
    }
  }

  /** アプリ状態。ctx.state が無い場合だけ LC.state から読む(読み取り専用)。 */
  function appState(ctx) {
    if (ctx && ctx.state && typeof ctx.state === 'object') return ctx.state;
    try {
      if (LC.state && typeof LC.state.get === 'function') return LC.state.get() || {};
    } catch (e) { /* 落ちない */ }
    return {};
  }

  /** 体験モードか。state を優先し、無ければ store に聞く。 */
  function isDemo(st) {
    if (st && st.demoMode === true) return true;
    try {
      return !!(LC.store && typeof LC.store.isDemoMode === 'function' && LC.store.isDemoMode());
    } catch (e) { return false; }
  }

  function settingsNow() {
    try { return LC.settings.get() || LC.settings.DEFAULTS; }
    catch (e) { return LC.settings.DEFAULTS; }
  }

  /** 絵文字アイコン。意味は隣のテキストが持つので、必ず aria-hidden にする。 */
  function icon(ch, cls) {
    return h('span', { 'class': cls || null, attrs: { 'aria-hidden': 'true' } }, ch);
  }

  function card(children, cls) {
    return h('section', { 'class': ['card', cls || null] }, children);
  }

  /** ▍付きのセクション見出し(§7-5 のワイヤーフレーム)。 */
  function sectionTitle(text, level) {
    return h(level || 'h2', { 'class': 'section-title' }, text);
  }

  function p(text, cls) {
    return h('p', { 'class': cls || null, text: text });
  }

  function btn(label, onClick, cls, attrs) {
    var props = {
      'class': ['btn'].concat(cls || []),
      type: 'button',
      text: label,
      on: { click: onClick }
    };
    if (attrs) props.attrs = attrs;
    return h('button', props);
  }

  /** 「・」付きの箇条書き。 */
  function bullets(items, cls) {
    var ul = h('ul', { 'class': ['list'].concat(cls || []) });
    for (var i = 0; i < items.length; i++) {
      ul.appendChild(h('li', null, items[i]));
    }
    return ul;
  }

  /** コピーできるテキスト(chrome://settings/... のように JS から開けないもの用)。 */
  function codeCopy(text) {
    return h('div', { 'class': 'code-copy' },
      h('code', { 'class': 'code-copy__text', text: text }),
      btn(t('common.copy'), function () { copyAndTell(text); }, ['btn--ghost', 'btn--sm']));
  }

  function copyAndTell(text) {
    var pr = util.copyText(text);
    if (pr && typeof pr.then === 'function') {
      pr.then(function (ok) {
        toast(ok ? t('common.copied') : t('common.copyFailed'), { type: ok ? 'info' : 'warn' });
      }, function () { toast(t('common.copyFailed'), { type: 'warn' }); });
    }
  }

  function formatBytes(n) {
    var v = Number(n);
    if (!isFinite(v) || v < 0) v = 0;
    if (v < 1024) return v + ' B';
    if (v < 1024 * 1024) return Math.round(v / 1024) + ' KB';
    return (Math.round(v / 1024 / 102.4) / 10) + ' MB';
  }

  /**
   * 「%{word} …」形式の 1 行文言を、表示用の 3 つに割る。
   * ★日本語をこのファイルに直書きしないための処置。
   *   LC.msg 側のテンプレートが '%{word}' で始まり、聞き取られた語の前に '→' が入る
   *   という約束にだけ依存する。約束が崩れても 1 行がそのまま出るだけで壊れない。
   */
  function splitTroubleLine(line, word) {
    var rest = (line.indexOf(word) === 0) ? line.slice(word.length) : line;
    rest = rest.replace(/^\s+/, '');
    var at = rest.indexOf('→');   /* → */
    if (at < 0) return { rate: rest, heard: '' };
    return { rate: rest.slice(0, at).replace(/\s+$/, ''), heard: rest.slice(at) };
  }

  /**
   * 通じにくい語の 1 行(§7-4 / §7-5 共通)。
   * 画面には語 / 通じ率 / 聞き取られ方を分けて出し、
   * スクリーンリーダーには LC.msg の 1 行文言をそのまま読ませる。
   */
  function troubleItem(line, word) {
    var parts = splitTroubleLine(line, word);
    var row = h('div', {
      'class': 'trouble-item',
      attrs: { role: 'group', 'aria-label': line }
    });
    row.appendChild(h('span', { 'class': ['trouble-item__word', 'en'], attrs: { lang: 'en' }, text: word }));
    row.appendChild(h('span', { 'class': ['trouble-item__rate', 'nums'], text: parts.rate }));
    if (parts.heard) {
      row.appendChild(h('span', { 'class': 'trouble-item__heard', text: parts.heard }));
    }
    return row;
  }

  /** 「この記録はこのパソコンに保存されています」(共有 PC 配慮。§7-5)。 */
  function localNotice(text) {
    return p(text || t('common.localOnlyNotice'), 'notice-local');
  }

  /** 2 段階確認つきの危険ボタン。1 回目で確認行に化け、2 回目で実行する(§7-5)。 */
  function dangerConfirm(spec) {
    var wrap = h('div', { 'class': 'stack' });
    var armed = false;

    function paint() {
      util.clear(wrap);
      if (!armed) {
        wrap.appendChild(btn(spec.label, function () { armed = true; paint(); focusFirst(); },
          ['btn--danger']));
        return;
      }
      wrap.appendChild(p(spec.confirmText, 'muted'));
      wrap.appendChild(h('div', { 'class': 'actions' },
        btn(spec.confirmLabel, function () {
          armed = false;
          paint();
          try { spec.onConfirm(); } catch (e) { log('screens.confirm.error', { error: String(e) }); }
        }, ['btn--danger']),
        btn(t('common.cancel'), function () { armed = false; paint(); focusFirst(); }, ['btn--ghost'])));
    }

    function focusFirst() {
      var b = qs('button', wrap);
      if (b) { try { b.focus(); } catch (e) { /* 落ちない */ } }
    }

    paint();
    return {
      el: wrap,
      /** Esc で確認を取り消す。取り消したときだけ true。 */
      cancel: function () {
        if (!armed) return false;
        armed = false;
        paint();
        return true;
      }
    };
  }

  /* ============================================================
   * 0-1. フレーズ集(音声なしで読むだけ。§10-3)
   *   非対応ブラウザでも教材を読むだけなら全ブラウザで動く。
   *   非対応画面から「音声なしでフレーズ集を見る」で開く。
   * ============================================================ */

  function phraseBook() {
    var wrap = h('div', { 'class': 'stack' });
    var decks = [];
    try { decks = LC.catalog.getDecks(); } catch (e) { decks = []; }

    if (!decks.length) {
      wrap.appendChild(card(p(t('home.empty'), 'muted')));
      return wrap;
    }

    for (var i = 0; i < decks.length; i++) {
      var d = decks[i];
      var sec = card(null);
      sec.appendChild(sectionTitle([icon(d.icon), h('span', { text: d.title })], 'h2'));
      if (d.subtitle) sec.appendChild(p(d.subtitle, 'muted small'));

      var ul = h('ul', { 'class': 'stack' });
      for (var j = 0; j < d.phrases.length; j++) {
        var ph = d.phrases[j];
        var li = h('li', null);
        li.appendChild(h('p', { 'class': 'phrase-en', attrs: { lang: 'en' }, text: ph.text }));
        if (ph.ja) li.appendChild(h('p', { 'class': 'phrase-ja', text: ph.ja }));
        if (ph.note) {
          li.appendChild(h('p', { 'class': 'phrase-note' }, icon('💡'), h('span', { text: ' ' + ph.note })));
        }
        ul.appendChild(li);
      }
      sec.appendChild(ul);
      wrap.appendChild(sec);
    }
    return wrap;
  }

  /* ============================================================
   * 1. onboarding(§7-1)— 初回のみ・3 枚
   *
   *   ②プライバシーは必須。同意しないと先へ進めない。
   *   ③でマイク権限を取り切り(warmUpMicrophone)、同時に speaker.warmUp() も走らせる。
   *     ここでのボタン押下が sticky activation を確定させるので、
   *     以降 speechSynthesis.speak() が not-allowed にならない。
   * ============================================================ */

  LC.screens.onboarding = {
    render: function (ctx) {
      var root = h('div', { 'class': 'stack' });
      var step = 1;                /* 1 | 2 | 3 | 'declined' */
      var privacyAckAt = null;
      var micState = 'idle';       /* idle | asking | ok | denied | notfound | unsupported */
      var meter = null;            /* createLevelMeter の戻り */
      var meterUi = null;          /* levelMeterEl の戻り */
      var destroyed = false;

      /* ---- 記録 ---- */

      function saveFlags(withAck) {
        try {
          LC.store.stores.flags.update(function (d) {
            var data = (d && typeof d === 'object') ? d : {};
            if (withAck && privacyAckAt) data.privacyAckAt = privacyAckAt;
            data.onboardedAt = Date.now();
            return data;
          });
        } catch (e) {
          log('onboarding.flags.error', { error: String(e) });
        }
      }

      /* ---- レベルメーター ---- */

      function stopMeter() {
        if (meter) {
          try { meter.stop(); } catch (e) { /* 落ちない */ }
          meter = null;
        }
      }

      function startMeter() {
        stopMeter();
        var pr = LC.ui.createLevelMeter(function (level) {
          if (meterUi) meterUi.set(level);
        });
        if (!pr || typeof pr.then !== 'function') return;
        pr.then(function (m) {
          if (destroyed) { try { m.stop(); } catch (e) { /* 落ちない */ } return; }
          meter = m;
        });
      }

      /* ---- 各ステップの描画 ---- */

      function dots() {
        var n = (step === 'declined') ? 2 : step;
        var box = h('div', {
          'class': 'onb__dots',
          attrs: { role: 'img', 'aria-label': t('onboarding.stepAria', { n: n }) }
        });
        for (var i = 1; i <= 3; i++) {
          box.appendChild(h('span', { 'class': ['onb__dot', i === n ? 'onb__dot--active' : null] }));
        }
        return box;
      }

      function foot(actions) {
        return h('div', { 'class': 'onb__foot' }, dots(),
          h('div', { 'class': 'onb__actions' }, actions));
      }

      function step1() {
        return h('section', { 'class': 'onb' },
          icon(t('onboarding.step1.icon'), 'onb__icon'),
          h('h1', { 'class': 'onb__title', text: t('onboarding.step1.title') }),
          p(t('onboarding.step1.body'), 'onb__body'),
          p(t('onboarding.step1.note'), 'onb__note'),
          foot([btn(t('onboarding.step1.next'), function () { step = 2; paint(); }, ['btn--primary'])]));
      }

      function step2() {
        var items = list('onboarding.step2.bullets');
        return h('section', { 'class': 'onb' },
          icon(t('onboarding.step2.icon'), 'onb__icon'),
          h('h1', { 'class': 'onb__title', text: t('onboarding.step2.title') }),
          p(t('onboarding.step2.body'), 'onb__body'),
          bullets(items, ['onb__list']),
          foot([
            /* ★同意しないと先へ進めない。ここが唯一の 3 枚目への入口。 */
            btn(t('onboarding.step2.agree'), function () {
              privacyAckAt = Date.now();
              step = 3;
              paint();
            }, ['btn--primary']),
            btn(t('onboarding.step2.decline'), function () { step = 'declined'; paint(); }, ['btn--ghost'])
          ]));
      }

      /* やめるを選んだ人にも教材は渡す(§10-3)。同意の記録は残さない。 */
      function stepDeclined() {
        return h('section', { 'class': 'onb' },
          icon(t('onboarding.step2.icon'), 'onb__icon'),
          h('h1', { 'class': 'onb__title', text: t('onboarding.step2.title') }),
          p(t('onboarding.step2.declined'), 'onb__body'),
          foot([
            btn(t('actions.browse-only'), function () {
              saveFlags(false);
              go(ctx, '#/');
            }, ['btn--primary']),
            btn(t('common.back'), function () { step = 2; paint(); }, ['btn--ghost'])
          ]));
      }

      function micStatusLine() {
        if (micState === 'asking') return p(t('onboarding.step3.allowing'), 'muted');
        if (micState === 'ok') return p(t('onboarding.step3.allowed'), 'muted');
        if (micState === 'notfound') return p(t('onboarding.step3.notFound'), 'muted');
        if (micState === 'denied' || micState === 'unsupported') {
          return p(t('onboarding.step3.denied'), 'muted');
        }
        return null;
      }

      function askMic() {
        if (micState === 'asking') return;
        micState = 'asking';
        paint();

        /* ★ここはユーザージェスチャの中。volume:0 の短い発話でウォームアップして
             「初回だけ無音」を避ける。結果は待たない(失敗しても練習は続けられる)。 */
        try { LC.speaker.warmUp(); } catch (e) { /* 落ちない */ }

        var pr;
        try { pr = LC.env.warmUpMicrophone(); } catch (e) { pr = null; }
        if (!pr || typeof pr.then !== 'function') {
          micState = 'unsupported';
          paint();
          return;
        }
        pr.then(function (r) {
          if (destroyed) return;
          if (r && r.ok) {
            micState = 'ok';
            paint();
            startMeter();
            announce(t('onboarding.step3.allowed'));
          } else {
            micState = (r && r.error === 'not-found') ? 'notfound'
              : ((r && r.error === 'unsupported') ? 'unsupported' : 'denied');
            paint();
            announce(micState === 'notfound'
              ? t('onboarding.step3.notFound') : t('onboarding.step3.denied'));
          }
        });
      }

      function finish() {
        /* 「はじめる」も立派なユーザージェスチャなので、ここでも一応ウォームアップする。 */
        try { LC.speaker.warmUp(); } catch (e) { /* 落ちない */ }
        saveFlags(true);
        go(ctx, '#/');
      }

      function step3() {
        var sec = h('section', { 'class': 'onb' },
          icon(t('onboarding.step3.icon'), 'onb__icon'),
          h('h1', { 'class': 'onb__title', text: t('onboarding.step3.title') }),
          p(t('onboarding.step3.body'), 'onb__body'));

        var allowLabel = t('onboarding.step3.allow');
        var allowBtn = btn(allowLabel, askMic, ['btn--primary']);
        if (micState === 'asking') {
          allowBtn.setAttribute('disabled', '');
          allowBtn.setAttribute('aria-disabled', 'true');
        }
        sec.appendChild(allowBtn);

        var line = micStatusLine();
        if (line) sec.appendChild(line);

        /* 許可が取れたときだけメーターを出す。動作確認そのものが目的。 */
        if (micState === 'ok') {
          meterUi = LC.ui.levelMeterEl('levelMeter');
          sec.appendChild(meterUi.el);
        } else {
          meterUi = null;
        }

        sec.appendChild(foot([
          btn(t('onboarding.step3.start'), finish, ['btn--primary']),
          btn(t('onboarding.step3.skip'), finish, ['btn--ghost'])
        ]));
        return sec;
      }

      function paint() {
        if (destroyed) return;
        util.clear(root);
        if (step === 1) root.appendChild(step1());
        else if (step === 2) root.appendChild(step2());
        else if (step === 'declined') root.appendChild(stepDeclined());
        else root.appendChild(step3());
      }

      paint();

      return {
        el: root,
        title: t('common.appName'),
        destroy: function () {
          destroyed = true;
          stopMeter();
          meterUi = null;
        },
        onKey: function () { return false; }
      };
    }
  };

  /* ============================================================
   * 2. home(§7-2)
   *
   *   ★デッキカードは <button> ではなく <a href="#/practice/intro">。
   *     JS が部分的に壊れてもブラウザの標準機能で遷移できる。
   *   ★進捗は色だけでなく ●/○ の形で区別する(LC.ui.progressDots)。
   * ============================================================ */

  LC.screens.home = {
    render: function (ctx) {
      var st = appState(ctx);
      var root = h('div', { 'class': 'stack' });

      /* --- あいさつ + 今日の発話数 + 連続日数 --- */
      var weekly;
      try { weekly = LC.tracker.weeklyStats(); }
      catch (e) { weekly = { days: [0, 0, 0, 0, 0, 0, 0], streak: 0 }; }
      var today = (weekly.days && weekly.days.length === 7) ? weekly.days[6] : 0;

      var greet = h('div', { 'class': 'home-greet' },
        h('p', {
          'class': 'home-greet__main',
          text: today > 0 ? t('home.greeting', { n: today }) : t('home.greetingZero')
        }));
      if (weekly.streak > 0) {
        greet.appendChild(h('span', {
          'class': 'home-greet__streak',
          text: t('home.streak', { n: weekly.streak })
        }));
      }
      root.appendChild(greet);

      if (isDemo(st)) root.appendChild(p(t('common.demoNotice'), 'muted small'));

      /* --- デッキ一覧 --- */
      var decks = [];
      try { decks = LC.catalog.getDecks(); } catch (e) { decks = []; }

      root.appendChild(h('h2', { 'class': 'sr-only', text: t('home.decksTitle') }));

      if (!decks.length) {
        root.appendChild(card(p(t('home.empty'), 'muted')));
      } else {
        var listEl = h('div', { 'class': 'deck-list' });
        for (var i = 0; i < decks.length; i++) {
          listEl.appendChild(deckCard(decks[i]));
        }
        root.appendChild(listEl);
      }

      /* --- 末尾の「✏ 自分でフレーズを追加する →」 --- */
      root.appendChild(h('a', {
        'class': ['deck-card', 'deck-card--add'],
        attrs: { href: '#/decks' }
      },
        icon('✏', 'deck-card__icon'),
        h('span', { 'class': 'deck-card__title', text: t('home.addDeck') }),
        icon('→', 'deck-card__progress')));

      if (decks.length && !weekly.streak && !today) {
        root.appendChild(p(t('home.firstTime'), 'muted small center'));
      }

      function deckCard(deck) {
        var pr;
        try { pr = LC.tracker.getDeckProgress(deck.id); }
        catch (e) { pr = { total: deck.phrases.length, done: 0, lastIndex: 0, completedAt: null }; }

        var total = pr.total || deck.phrases.length;
        var done = pr.done || 0;
        var complete = total > 0 && done >= total;

        /* 途中まで進んでいれば「つづきから」。?i= はルーターが解釈する(§6-2)。 */
        var href = '#/practice/' + encodeURIComponent(deck.id);
        var resume = !complete && pr.lastIndex > 0;
        if (resume) href += '?i=' + pr.lastIndex;

        var progress = h('span', { 'class': 'deck-card__progress' });
        progress.appendChild(LC.ui.progressDots(done, total));
        progress.appendChild(h('span', {
          'class': 'nums',
          text: t('common.deckProgress', { done: done, total: total })
        }));
        if (complete) {
          progress.appendChild(h('span', { 'class': 'badge badge--ok' },
            icon('✓'), h('span', { text: t('home.deckCleared') })));
        } else if (resume) {
          progress.appendChild(h('span', { 'class': 'badge', text: t('home.resume') }));
        }

        var a = h('a', {
          'class': ['deck-card', complete ? 'deck-card--done' : null],
          attrs: { href: href, 'aria-label': deck.title + '。' + t('common.deckProgressAria', { done: done, total: total }) }
        },
          icon(deck.icon, 'deck-card__icon'),
          h('span', { 'class': 'deck-card__title', text: deck.title }));
        /* 補足行は 1 本だけにする(グリッドの行が増えるとカードが縦に伸びるため)。 */
        var sub = deck.subtitle || (deck.custom ? t('home.custom') : '');
        if (sub) a.appendChild(h('span', { 'class': 'deck-card__sub', text: sub }));
        a.appendChild(progress);
        return a;
      }

      return {
        el: root,
        title: t('common.appName'),
        destroy: function () { /* 保持している資源なし */ },
        onKey: function () { return false; }
      };
    }
  };

  /* ============================================================
   * 3. summary(§7-4)— デッキ完了時
   *   話した回数 / クリア数 / 所要時間 / 通じにくかった語
   * ============================================================ */

  LC.screens.summary = {
    render: function (ctx) {
      var params = (ctx && ctx.params) || {};
      var st = appState(ctx);
      var deckId = String(params.deckId || params.id || '');
      var deck = null;
      try { deck = LC.catalog.getDeck(deckId); } catch (e) { deck = null; }

      var root = h('div', { 'class': 'stack' });

      if (!deck) {
        root.appendChild(card(p(t('practice.notFound'), 'muted')));
        root.appendChild(btn(t('summary.home'), function () { go(ctx, '#/'); }, ['btn--primary']));
        return { el: root, title: t('common.appName'), destroy: function () {}, onKey: function () { return false; } };
      }

      /* --- このデッキのセッション記録を拾う ---
         練習画面が離脱時に endSession() 済みのことが多いので履歴を先に見て、
         まだ開いている場合(進行中)にも対応する。 */
      var rec = null;
      try {
        var cur = LC.tracker.getCurrentSession();
        if (cur && cur.deckId === deckId) rec = cur;
        if (!rec) {
          var recent = LC.tracker.getSessions(10);
          for (var i = 0; i < recent.length; i++) {
            if (recent[i] && recent[i].deckId === deckId) { rec = recent[i]; break; }
          }
        }
      } catch (e) { rec = null; }

      var prog;
      try { prog = LC.tracker.getDeckProgress(deckId); }
      catch (e) { prog = { total: deck.phrases.length, done: 0 }; }

      var attempts = rec ? (rec.attempts || 0) : 0;
      var startedAt = rec ? (rec.startedAt || 0) : 0;
      var endedAt = rec ? (rec.endedAt || Date.now()) : 0;
      var durationMs = (startedAt && endedAt > startedAt) ? (endedAt - startedAt) : 0;

      var sec = h('section', { 'class': 'summary' },
        icon(t('summary.icon'), 'blocker__icon'),
        h('h1', { 'class': 'summary__title', text: t('summary.title', { deck: deck.title }) }));

      var stats = h('div', { 'class': 'summary__stats' },
        h('span', { text: t('summary.attempts', { n: attempts }) }),
        h('span', {
          text: t('summary.cleared', { n: prog.done || 0, total: prog.total || deck.phrases.length })
        }));
      if (durationMs > 0) {
        stats.appendChild(h('span', { text: t('summary.duration', { text: util.fmtDuration(durationMs) }) }));
      }
      sec.appendChild(stats);
      root.appendChild(sec);

      /* --- 通じにくかった語(このデッキに出てくる語だけに絞る) --- */
      var box = card(null);
      box.appendChild(sectionTitle(t('summary.troubleTitle')));

      var words = deckWordSet(deck);
      var trouble = [];
      try {
        /* デッキ内に絞るので minAttempts は少し緩める(1 デッキ分の試行は多くない)。 */
        var all = LC.tracker.troubleWords(2, 0.8, 40);
        for (var k = 0; k < all.length && trouble.length < 8; k++) {
          if (words[all[k].word]) trouble.push(all[k]);
        }
      } catch (e) { trouble = []; }

      if (!trouble.length) {
        box.appendChild(p(t('summary.noTrouble'), 'muted'));
      } else {
        var wrap = h('div', { 'class': 'trouble-list' });
        for (var j = 0; j < trouble.length; j++) {
          var w = trouble[j];
          var line = w.mostHeardAs
            ? t('summary.troubleRow', {
              word: w.word, attempts: w.attempts, pass: w.passes, heard: w.mostHeardAs
            })
            : t('summary.troubleRowNoHeard', { word: w.word, attempts: w.attempts, pass: w.passes });
          wrap.appendChild(troubleItem(line, w.word));
        }
        box.appendChild(wrap);
      }
      root.appendChild(box);

      if (isDemo(st)) root.appendChild(p(t('summary.notSaved'), 'muted small center'));

      root.appendChild(h('div', { 'class': 'actions actions--stack' },
        btn(t('summary.again'), function () {
          go(ctx, '#/practice/' + encodeURIComponent(deckId));
        }, ['btn--primary']),
        btn(t('summary.home'), function () { go(ctx, '#/'); }, ['btn--ghost'])));

      return {
        el: root,
        title: deck.title,
        destroy: function () { /* 保持している資源なし */ },
        onKey: function () { return false; }
      };
    }
  };

  /**
   * デッキに出てくる語の集合(小文字・記号落とし)。
   * ★採点ではなく「このデッキの語かどうか」の表示フィルタなので、
   *   正規化モジュールは使わずにここで単純に切る(依存を増やさない)。
   */
  function deckWordSet(deck) {
    var set = Object.create(null);
    try {
      for (var i = 0; i < deck.phrases.length; i++) {
        var texts = [deck.phrases[i].text].concat(deck.phrases[i].accept || []);
        for (var j = 0; j < texts.length; j++) {
          var parts = String(texts[j]).toLowerCase().split(/[^a-z0-9']+/);
          for (var k = 0; k < parts.length; k++) {
            var w = parts[k].replace(/^'+|'+$/g, '');
            if (w) set[w] = true;
          }
        }
      }
    } catch (e) { /* 空集合のまま返す */ }
    return set;
  }

  /* ============================================================
   * 4. stats(§7-5)— きろく
   *
   *   ★バーチャートは CSS の高さだけで描く。canvas も外部ライブラリも使わない。
   *   ★「記録をすべて消す」は 2 段階確認。
   *   ★画面下部に「この記録はこのパソコンに保存されています」を常時表示。
   * ============================================================ */

  /* 曜日ラベル。文言ではなく暦の記号なのでここに置く(§7-5 のグラフ軸)。 */
  var WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'];

  LC.screens.stats = {
    render: function (ctx) {
      var root = h('div', { 'class': 'stack' });
      var confirm = null;

      function paint() {
        util.clear(root);

        var weekly, trouble, focus, sessions, decks;
        try { weekly = LC.tracker.weeklyStats(); }
        catch (e) { weekly = { days: [0, 0, 0, 0, 0, 0, 0], utterances: 0, words: 0, streak: 0, activeDays: 0 }; }
        try { trouble = LC.tracker.troubleWords(); } catch (e) { trouble = []; }
        try { focus = LC.tracker.focusSummary(); } catch (e) { focus = []; }
        try { sessions = LC.tracker.getSessions(5); } catch (e) { sessions = []; }
        try { decks = LC.catalog.getDecks(); } catch (e) { decks = []; }

        root.appendChild(h('h1', { text: t('stats.title') }));

        if (!weekly.utterances && !sessions.length && !trouble.length) {
          root.appendChild(card(p(t('stats.empty'), 'muted')));
        }

        /* --- 今週 --- */
        var week = card(null);
        week.appendChild(sectionTitle(t('stats.weekTitle')));
        var line = h('div', { 'class': 'stat-row' },
          h('span', {
            text: t('stats.weekLine', {
              utterances: weekly.utterances, days: weekly.activeDays, words: weekly.words
            })
          }));
        if (weekly.streak > 0) {
          line.appendChild(h('span', { 'class': 'home-greet__streak', text: t('stats.streak', { n: weekly.streak }) }));
        }
        week.appendChild(line);
        week.appendChild(barChart(weekly.days));
        root.appendChild(week);

        /* --- 通じにくい語 --- */
        var tw = card(null);
        tw.appendChild(sectionTitle(t('stats.troubleTitle')));
        if (!trouble.length) {
          tw.appendChild(p(t('stats.troubleEmpty'), 'muted'));
        } else {
          var wrap = h('div', { 'class': 'trouble-list' });
          for (var i = 0; i < trouble.length; i++) {
            var w = trouble[i];
            var pct = Math.round(w.rate * 100);
            var text = w.mostHeardAs
              ? t('stats.troubleRow', { word: w.word, rate: pct, attempts: w.attempts, heard: w.mostHeardAs })
              : t('stats.troubleRowNoHeard', { word: w.word, rate: pct, attempts: w.attempts });
            wrap.appendChild(troubleItem(text, w.word));
          }
          tw.appendChild(wrap);
        }

        /* --- 苦手な音 --- */
        tw.appendChild(sectionTitle(t('stats.focusTitle'), 'h3'));
        if (!focus.length) {
          tw.appendChild(p(t('stats.focusEmpty'), 'muted'));
        } else {
          var tags = h('div', { 'class': 'tag-list' });
          for (var f = 0; f < focus.length; f++) {
            tags.appendChild(h('span', {
              'class': 'tag',
              text: t('stats.focusRow', { label: focus[f].label, n: focus[f].words.length })
            }));
          }
          tw.appendChild(tags);
        }
        root.appendChild(tw);

        /* --- カテゴリ別 --- */
        if (decks.length) {
          var dv = card(null);
          dv.appendChild(sectionTitle(t('stats.deckTitle')));
          var dl = h('div', { 'class': 'stat-section' });
          for (var d = 0; d < decks.length; d++) {
            var pr;
            try { pr = LC.tracker.getDeckProgress(decks[d].id); }
            catch (e) { pr = { done: 0, total: decks[d].phrases.length }; }
            var row = h('div', { 'class': 'stat-row' },
              icon(decks[d].icon),
              h('span', { 'class': 'grow', text: decks[d].title }));
            row.appendChild(LC.ui.progressDots(pr.done || 0, pr.total || decks[d].phrases.length));
            dl.appendChild(row);
          }
          dv.appendChild(dl);
          root.appendChild(dv);
        }

        /* --- 最近の練習 --- */
        if (sessions.length) {
          var hv = card(null);
          hv.appendChild(sectionTitle(t('stats.historyTitle')));
          var hl = h('div', { 'class': 'stat-section' });
          for (var s = 0; s < sessions.length; s++) {
            var se = sessions[s];
            var dk = null;
            try { dk = LC.catalog.getDeck(se.deckId); } catch (e) { dk = null; }
            hl.appendChild(h('div', {
              'class': ['stat-row', 'small', 'muted'],
              text: t('stats.historyRow', {
                date: util.fmtDate(se.startedAt),
                deck: dk ? dk.title : se.deckId,
                attempts: se.attempts
              })
            }));
          }
          hv.appendChild(hl);
          root.appendChild(hv);
        }

        /* --- 記録をすべて消す(2 段階確認) --- */
        confirm = dangerConfirm({
          label: t('stats.clear'),
          confirmText: t('stats.clearConfirm'),
          confirmLabel: t('stats.clearConfirmBtn'),
          onConfirm: function () {
            var ok = false;
            try { ok = LC.tracker.clearRecords(); } catch (e) { ok = false; }
            if (ok) toast(t('stats.cleared'));
            paint();
          }
        });
        root.appendChild(confirm.el);

        /* --- 共有 PC 配慮の常時表示 --- */
        root.appendChild(localNotice(t('stats.localOnly')));
      }

      /** 直近 7 日のバーチャート。CSS の高さだけで描く(canvas を使わない)。 */
      function barChart(days) {
        var max = 1;
        var i;
        for (i = 0; i < days.length; i++) if (days[i] > max) max = days[i];

        var now = Date.now();
        var labels = [];
        var aria = [];
        for (i = 0; i < 7; i++) {
          var ms = now - (6 - i) * 86400000;
          var d = new Date(ms);
          labels.push(WEEKDAY[d.getDay()]);
          aria.push(t('stats.chartDayAria', { day: util.fmtDay(ms), n: days[i] || 0 }));
        }

        var box = h('div', {
          'class': 'bars',
          attrs: { role: 'img', 'aria-label': t('stats.chartAria') + '。' + aria.join('、') }
        });
        for (i = 0; i < 7; i++) {
          var n = days[i] || 0;
          var pct = Math.round((n / max) * 100);
          var bar = h('div', { 'class': ['bars__bar', n === 0 ? 'bars__bar--empty' : null] });
          bar.style.height = (n === 0 ? 2 : Math.max(4, pct)) + '%';
          box.appendChild(h('div', { 'class': 'bars__col' },
            h('div', { 'class': 'bars__track' }, bar),
            h('div', { 'class': 'bars__label', text: labels[i] })));
        }
        return box;
      }

      paint();

      return {
        el: root,
        title: t('stats.title'),
        destroy: function () { confirm = null; },
        onKey: function (e) {
          /* Esc で「消す」の確認を取り消せるようにする(誤爆の出口)。 */
          if (e && e.key === 'Escape' && confirm) return confirm.cancel();
          return false;
        }
      };
    }
  };

  /* ============================================================
   * 5. settings(§7-6)
   *
   *   ★速さはスライダーにしない。3 ボタン固定。
   *   ★pitch / volume は UI に出さない(Google 音声で pitch は無視されるため)。
   *   ★声は「オフラインで使える声 / インターネットが必要な声(高品質)」に分けて出す。
   * ============================================================ */

  LC.screens.settings = {
    render: function (ctx) {
      var st = appState(ctx);
      var root = h('div', { 'class': 'stack' });
      var voiceBox = h('div', { 'class': 'stack' });
      var voices = [];
      var voicesReady = false;
      var destroyed = false;

      root.appendChild(h('h1', { text: t('settings.title') }));
      if (isDemo(st)) root.appendChild(p(t('settings.notSaved'), 'muted small'));

      /* --- 読み上げの声 --- */
      var voiceField = h('div', { 'class': 'field' },
        h('h2', { 'class': 'field__label', text: t('settings.voiceTitle') }),
        voiceBox);
      root.appendChild(voiceField);

      /* --- 読み上げの速さ(3 ボタン固定) --- */
      root.appendChild(segField('settings.rateTitle', 'rate', [
        { value: 0.7, label: t('settings.rateSlow') },
        { value: 0.9, label: t('settings.rateNormal') },
        { value: 1.1, label: t('settings.rateFast') }
      ]));

      /* --- 認識する英語 --- */
      root.appendChild(segField('settings.langTitle', 'lang', [
        { value: 'en-US', label: t('settings.langUS') },
        { value: 'en-GB', label: t('settings.langGB') }
      ], function () { paintVoices(); }));

      /* --- 表示(4 項目) --- */
      var display = h('div', { 'class': 'field' },
        h('h2', { 'class': 'field__label', text: t('settings.displayTitle') }));
      display.appendChild(checkRow('showScore', t('settings.showScore')));
      display.appendChild(checkRow('autoListen', t('settings.autoListen')));
      var saveRow = checkRow('saveRecords', t('settings.saveRecords'), function (on) {
        if (!on) toast(t('settings.saveRecordsOff'), { type: 'warn' });
      });
      display.appendChild(saveRow);
      display.appendChild(h('h3', { 'class': 'field__label', text: t('settings.themeTitle') }));
      display.appendChild(segControl('theme', [
        { value: 'auto', label: t('settings.themeAuto') },
        { value: 'light', label: t('settings.themeLight') },
        { value: 'dark', label: t('settings.themeDark') }
      ], t('settings.themeTitle'), function (v) { applyTheme(v); }));
      root.appendChild(display);

      /* --- 診断への導線 --- */
      root.appendChild(btn(t('settings.helpLink'), function () { go(ctx, '#/help'); }, ['btn--ghost']));

      /* ---- 声の一覧 ---- */

      function paintVoices() {
        if (destroyed) return;
        util.clear(voiceBox);

        if (!voicesReady) {
          voiceBox.appendChild(p(t('settings.voiceLoading'), 'muted'));
          return;
        }

        var s = settingsNow();
        var groups;
        try { groups = LC.speaker.listEnglishVoices(voices, s.lang); }
        catch (e) { groups = { offline: [], online: [] }; }

        if (!groups.offline.length && !groups.online.length) {
          voiceBox.appendChild(p(t('settings.voiceNone'), 'muted'));
          return;
        }

        var active = null;
        try { active = LC.speaker.getActiveVoice(); } catch (e) { active = null; }

        voiceBox.appendChild(voiceGroup(t('settings.voiceOffline'), groups.offline, active));
        voiceBox.appendChild(voiceGroup(t('settings.voiceOnline'), groups.online, active));
        voiceBox.appendChild(btn(t('settings.voiceTest'), testVoice, ['btn--ghost']));
      }

      function voiceGroup(title, arr, active) {
        var g = h('div', { 'class': 'voice-group' });
        if (!arr.length) return g;
        g.appendChild(h('p', { 'class': 'voice-group__title', text: title }));
        var box = h('div', { 'class': 'radio-list' });
        for (var i = 0; i < arr.length; i++) {
          box.appendChild(voiceRow(arr[i], active));
        }
        g.appendChild(box);
        return g;
      }

      function voiceRow(voice, active) {
        var id = util.uid('voice');
        var checked = !!(active && active.name === voice.name && active.lang === voice.lang);
        var input = h('input', {
          type: 'radio',
          id: id,
          name: 'lc-voice',
          checked: checked ? true : false,
          on: {
            change: function () { selectVoice(voice); }
          }
        });
        return h('label', { 'class': 'radio-row', attrs: { 'for': id } },
          input,
          h('span', { 'class': 'radio-row__text' },
            h('span', { text: voice.name }),
            h('span', { 'class': 'radio-row__sub', text: voice.lang })));
      }

      function selectVoice(voice) {
        try { LC.speaker.setActiveVoice(voice); } catch (e) { /* 落ちない */ }
        /* ★保存は voiceURI ではなく {name, lang}(§5-5)。 */
        update({ voice: { name: voice.name, lang: voice.lang } });
      }

      function testVoice() {
        var s = settingsNow();
        var v = null;
        try { v = LC.speaker.getActiveVoice(); } catch (e) { v = null; }
        if (!v) { toast(t('settings.voiceNone'), { type: 'warn' }); return; }
        /* ★単発再生。認識はこの画面では一切開始しないので排他の心配はない。 */
        try {
          LC.speaker.stopSpeaking();
          util.sleep(200).then(function () {
            if (destroyed) return;
            LC.speaker.speak(t('settings.voiceTestText'), { voice: v, rate: s.rate });
          });
        } catch (e) { /* 落ちない */ }
      }

      /* ---- 設定の更新 ---- */

      function update(patch) {
        try { LC.settings.update(patch); }
        catch (e) { log('settings.update.error', { error: String(e) }); }
        /* 体験モードでは書き込みが no-op になるので「保存しました」と言わない(§6-3)。 */
        toast(isDemo(appState(ctx)) ? t('settings.notSaved') : t('settings.saved'), { ms: 1600 });
      }

      /** テーマは <html data-theme> で効く(tokens.css)。保存と同時に見た目も変える。 */
      function applyTheme(v) {
        try { document.documentElement.setAttribute('data-theme', v); }
        catch (e) { /* 落ちない */ }
      }

      /* ---- 3 ボタン固定の選択(速さ / 認識する英語 / テーマ) ---- */

      function segField(titleKey, key, options, after) {
        return h('div', { 'class': 'field' },
          h('h2', { 'class': 'field__label', text: t(titleKey) }),
          segControl(key, options, t(titleKey), after));
      }

      function segControl(key, options, label, after) {
        var box = h('div', { 'class': 'seg', attrs: { role: 'group', 'aria-label': label } });
        var buttons = [];

        function sync() {
          var cur = settingsNow()[key];
          for (var i = 0; i < buttons.length; i++) {
            var on = buttons[i].__value === cur;
            buttons[i].setAttribute('aria-pressed', on ? 'true' : 'false');
          }
        }

        for (var i = 0; i < options.length; i++) {
          (function (opt) {
            var b = h('button', {
              'class': 'seg__btn',
              type: 'button',
              text: opt.label,
              attrs: { 'aria-pressed': 'false' },
              on: {
                click: function () {
                  var patch = {};
                  patch[key] = opt.value;
                  update(patch);
                  sync();
                  if (typeof after === 'function') after(opt.value);
                }
              }
            });
            b.__value = opt.value;
            buttons.push(b);
            box.appendChild(b);
          })(options[i]);
        }
        sync();
        return box;
      }

      function checkRow(key, label, after) {
        var id = util.uid('chk');
        var input = h('input', {
          type: 'checkbox',
          id: id,
          checked: settingsNow()[key] ? true : false,
          on: {
            change: function (e) {
              var on = !!(e.target && e.target.checked);
              var patch = {};
              patch[key] = on;
              update(patch);
              if (typeof after === 'function') after(on);
            }
          }
        });
        return h('label', { 'class': 'check-row', attrs: { 'for': id } },
          input, h('span', { 'class': 'radio-row__text' }, h('span', { text: label })));
      }

      /* ---- 声の読み込み(非同期。reject しない) ---- */
      paintVoices();
      var pr = null;
      try { pr = LC.speaker.loadVoices(); } catch (e) { pr = null; }
      if (pr && typeof pr.then === 'function') {
        pr.then(function (arr) {
          if (destroyed) return;
          voices = arr || [];
          voicesReady = true;
          paintVoices();
        });
      } else {
        voicesReady = true;
        paintVoices();
      }

      return {
        el: root,
        title: t('settings.title'),
        destroy: function () {
          destroyed = true;
          /* 試し聞きの途中で画面を離れたら必ず止める。 */
          try { LC.speaker.stopSpeaking(); } catch (e) { /* 落ちない */ }
        },
        onKey: function () { return false; }
      };
    }
  };

  /* ============================================================
   * 6. help(§7-7)— 使い方 と 診断
   *
   *   ★「診断結果をコピー」の中身:
   *     EnvInfo + 音声名一覧 + 権限 + 保存モードと使用量 +
   *     デッキ読み込みエラー + LC.util.getLog() の直近 40 件
   *   ★テスト中は busy を立て、読み上げ中に認識を始めない。
   * ============================================================ */

  LC.screens.help = {
    render: function (ctx) {
      var root = h('div', { 'class': 'stack' });
      var checkBox = h('div', { 'class': 'diag-list' });
      var testResult = h('div', { 'class': 'stack' });
      var meterHost = h('div', { 'class': 'stack' });

      var destroyed = false;
      var busy = false;               /* ★読み上げ中 / 録音中は他のテストを始めない */
      var micPerm = 'unknown';
      var voiceGroups = { offline: [], online: [] };
      var voicesReady = false;
      var meter = null;
      var meterUi = null;
      var meterTimer = null;
      var rec = null;
      var testButtons = [];

      var env;
      try { env = LC.env.detect(); } catch (e) { env = {}; }

      /* ---- 見出しと使い方 ---- */
      root.appendChild(h('h1', { text: t('help.title') }));

      var howto = card(null);
      howto.appendChild(sectionTitle(t('help.howtoTitle')));
      var steps = list('help.steps');
      var ol = h('ol', { 'class': 'list' });
      for (var i = 0; i < steps.length; i++) ol.appendChild(h('li', null, steps[i]));
      howto.appendChild(ol);
      howto.appendChild(sectionTitle(t('help.tipsTitle'), 'h3'));
      howto.appendChild(bullets(list('help.tips')));
      root.appendChild(howto);

      /* ---- 動作チェック ---- */
      var check = card(null);
      check.appendChild(sectionTitle(t('help.checkTitle')));
      check.appendChild(checkBox);
      root.appendChild(check);

      /* ---- テスト ---- */
      var tests = card(null);
      var ttsBtn = btn(t('help.testTts'), testTts, ['btn--ghost']);
      var micBtn = btn(t('help.testMic'), testMic, ['btn--ghost']);
      var asrBtn = btn(t('help.testAsr'), testAsr, ['btn--ghost']);
      testButtons = [ttsBtn, micBtn, asrBtn];
      tests.appendChild(h('div', { 'class': 'diag-actions' }, ttsBtn, micBtn, asrBtn));
      tests.appendChild(meterHost);
      tests.appendChild(testResult);
      root.appendChild(tests);

      /* ---- 診断結果のコピー ---- */
      var copyBox = card(null);
      copyBox.appendChild(h('button', {
        'class': ['btn', 'btn--primary'],
        id: 'diagCopy',
        type: 'button',
        text: t('help.copyDiag'),
        on: {
          click: function () {
            var text = buildDiagnostics();
            var pr = util.copyText(text);
            if (pr && typeof pr.then === 'function') {
              pr.then(function (ok) {
                toast(ok ? t('help.copiedDiag') : t('common.copyFailed'), { type: ok ? 'info' : 'warn' });
              });
            }
          }
        }
      }));
      copyBox.appendChild(h('details', { 'class': 'stack' },
        h('summary', { text: t('help.logTitle') }),
        h('pre', { 'class': 'panel-error__detail', text: util.getLogText() })));
      root.appendChild(copyBox);

      /* ---- マイクの許可のしかた ---- */
      var howtoMic = card(null);
      howtoMic.appendChild(sectionTitle(t('help.micHowtoTitle')));
      howtoMic.appendChild(p(t('help.micHowto')));
      howtoMic.appendChild(p(t('help.micSettingsNote'), 'muted small'));
      howtoMic.appendChild(codeCopy(t('help.micSettingsUrl')));
      root.appendChild(howtoMic);

      /* ---- 公開ページ ---- */
      var pages = card(null);
      pages.appendChild(sectionTitle(t('help.pagesTitle')));
      pages.appendChild(p(t('help.pagesNote'), 'muted small'));
      pages.appendChild(codeCopy(t('help.pagesUrl')));
      root.appendChild(pages);

      /* ---- 読み込めなかった教材 ---- */
      var deckErrors = [];
      try {
        LC.catalog.getDecks();
        deckErrors = LC.catalog.getLoadErrors() || [];
      } catch (e) { deckErrors = []; }
      if (deckErrors.length) {
        var de = card(null);
        de.appendChild(sectionTitle(t('help.deckErrorsTitle')));
        var lines = h('div', { 'class': 'error-lines' });
        for (var d = 0; d < deckErrors.length; d++) {
          lines.appendChild(h('p', {
            text: t('help.deckErrorRow', {
              deckId: deckErrors[d].deckId,
              errors: (deckErrors[d].errors || []).join(' / ')
            })
          }));
        }
        de.appendChild(lines);
        root.appendChild(de);
      }

      /* ============ 動作チェックの描画 ============ */

      function diagRow(state, label, value) {
        /* 記号は ✅ / ⚠ の 2 種類だけ(§7-7)。深刻度の差は色(diag-row--err)で出す。
           記号は aria-hidden なので、意味は必ず右の値テキストが持つ。 */
        var mark = state === 'ok' ? '✅' : '⚠';
        return h('div', { 'class': ['diag-row', state === 'ok' ? null : 'diag-row--' + state] },
          icon(mark, 'diag-row__icon'),
          h('span', { 'class': 'diag-row__label', text: label }),
          h('span', { 'class': 'diag-row__value', text: value }));
      }

      function paintChecks() {
        if (destroyed) return;
        util.clear(checkBox);

        /* ページの配信方法 */
        var proto = env.protocol || '';
        var protoState = (proto === 'https:') ? 'ok' : 'warn';
        checkBox.appendChild(diagRow(protoState, t('help.rowProtocol'), proto.replace(/:$/, '')));

        /* 音声認識 API */
        checkBox.appendChild(diagRow(env.hasRecognition ? 'ok' : 'err',
          t('help.rowRecognition'), env.hasRecognition ? t('help.valOk') : t('help.valNg')));

        /* 読み上げ API */
        checkBox.appendChild(diagRow(env.hasSynthesis ? 'ok' : 'warn',
          t('help.rowSynthesis'), env.hasSynthesis ? t('help.valOk') : t('help.valNg')));

        /* 英語の読み上げ音声 */
        var total = voiceGroups.offline.length + voiceGroups.online.length;
        checkBox.appendChild(diagRow(total > 0 ? 'ok' : 'warn', t('help.rowVoices'),
          voicesReady
            ? t('help.valVoices', { n: total, offline: voiceGroups.offline.length })
            : t('settings.voiceLoading')));

        /* マイクの許可 */
        var permText = micPerm === 'granted' ? t('help.valGranted')
          : (micPerm === 'denied' ? t('help.valDenied')
            : (micPerm === 'prompt' ? t('help.valPrompt') : t('help.valUnknown')));
        checkBox.appendChild(diagRow(micPerm === 'granted' ? 'ok' : (micPerm === 'denied' ? 'err' : 'warn'),
          t('help.rowMic'), permText));

        /* 記録の保存 */
        var mode = 'persistent';
        var usage = 0;
        try { mode = LC.store.getMode(); usage = LC.store.estimateUsageBytes(); } catch (e) { /* 既定のまま */ }
        var storeText = mode === 'persistent' ? t('help.valStorageOk', { size: formatBytes(usage) })
          : (mode === 'readonly' ? t('help.valStorageReadonly') : t('help.valStorageMemory'));
        checkBox.appendChild(diagRow(mode === 'persistent' ? 'ok' : 'warn', t('help.rowStorage'), storeText));

        /* インターネット */
        var online = !(navigator && navigator.onLine === false);
        checkBox.appendChild(diagRow(online ? 'ok' : 'warn', t('help.rowOnline'),
          online ? t('help.valOnline') : t('help.valOffline')));

        /* ブラウザ */
        var label = (env.browserName || '') + ' ' + String(env.browserVersion || '').split('.')[0];
        checkBox.appendChild(diagRow(env.browserClass === 'chrome-desktop' ? 'ok' : 'warn',
          t('help.rowBrowser'), label.trim()));
      }

      /* ============ テスト ============ */

      function setBusy(on) {
        busy = on;
        for (var i = 0; i < testButtons.length; i++) {
          if (on) {
            testButtons[i].setAttribute('disabled', '');
            testButtons[i].setAttribute('aria-disabled', 'true');
          } else {
            testButtons[i].removeAttribute('disabled');
            testButtons[i].removeAttribute('aria-disabled');
          }
        }
      }

      function showResult(text, tone) {
        util.clear(testResult);
        testResult.appendChild(p(text, tone === 'warn' ? 'muted' : null));
        announce(text);
      }

      function testTts() {
        if (busy) return;
        var v = null;
        try { v = LC.speaker.getActiveVoice(); } catch (e) { v = null; }
        if (!v) { showResult(t('settings.voiceNone'), 'warn'); return; }
        setBusy(true);
        var s = settingsNow();
        try { LC.speaker.stopSpeaking(); } catch (e) { /* 落ちない */ }
        util.sleep(200).then(function () {
          if (destroyed) { setBusy(false); return; }
          var pr = LC.speaker.speak(t('help.testTtsText'), { voice: v, rate: s.rate });
          if (!pr || typeof pr.then !== 'function') { setBusy(false); return; }
          pr.then(function (reason) {
            if (destroyed) return;
            setBusy(false);
            /* canceled / interrupted は正常系。エラーにしない(§10-4)。 */
            if (reason === 'end' || reason === 'canceled' || reason === 'interrupted') return;
            var info = LC.msg.ttsError(reason);
            if (!info.silent && info.title) showResult(info.title + ' ' + info.body, 'warn');
          });
        });
      }

      function stopMeter() {
        if (meterTimer) { clearTimeout(meterTimer); meterTimer = null; }
        if (meter) {
          try { meter.stop(); } catch (e) { /* 落ちない */ }
          meter = null;
        }
        util.clear(meterHost);
        meterUi = null;
      }

      function testMic() {
        if (busy) return;
        setBusy(true);
        stopMeter();
        showResult(t('help.testMicRunning'));

        var peak = 0;
        meterUi = LC.ui.levelMeterEl('levelMeter');
        meterHost.appendChild(meterUi.el);

        var pr = LC.ui.createLevelMeter(function (level, info) {
          if (meterUi) meterUi.set(level);
          if (info && info.peak > peak) peak = info.peak;
        });
        if (!pr || typeof pr.then !== 'function') { setBusy(false); return; }

        pr.then(function (m) {
          if (destroyed) { try { m.stop(); } catch (e) { /* 落ちない */ } return; }
          meter = m;
          if (!m.available) {
            setBusy(false);
            stopMeter();
            showResult(t('help.testMicNg'), 'warn');
            return;
          }
          meterTimer = setTimeout(function () {
            meterTimer = null;
            if (destroyed) return;
            var quiet = peak < 0.01;
            stopMeter();
            setBusy(false);
            showResult(quiet ? t('help.testMicQuiet')
              : t('help.testMicOk', { peak: Math.round(peak * 100) }), quiet ? 'warn' : null);
          }, 5000);
        });
      }

      function testAsr() {
        if (busy) return;
        if (!rec) {
          try { rec = LC.recognizer.create(); } catch (e) { rec = null; }
        }
        if (!rec || !rec.isAvailable()) { showResult(t('help.testAsrNg'), 'warn'); return; }

        setBusy(true);
        /* ★読み上げが鳴っている間は認識を始めない。念のため止めてから入る。 */
        try { LC.speaker.stopSpeaking(); } catch (e) { /* 落ちない */ }
        showResult(t('help.testAsrPrompt'));

        var s = settingsNow();
        var pr = rec.listen({ lang: s.lang });
        if (!pr || typeof pr.then !== 'function') { setBusy(false); return; }
        pr.then(function (r) {
          if (destroyed) return;
          setBusy(false);
          if (r && r.status === 'ok' && r.transcript) {
            showResult(t('help.testAsrOk', { text: r.transcript }));
            return;
          }
          if (r && r.status === 'error') {
            var info = LC.msg.asrError(r.errorCode, { lang: s.lang });
            if (!info.silent) { showResult(info.title + ' ' + info.body, 'warn'); return; }
          }
          showResult(t('help.testAsrNg'), 'warn');
        });
      }

      /* ============ 診断テキスト ============ */

      function buildDiagnostics() {
        var out = [];
        var sep = '----------------------------------------';
        function push(title, body) { out.push(sep); out.push('# ' + title); out.push(body); }

        out.push(t('common.appName') + ' / ' + t('help.title'));
        out.push(util.fmtDate(Date.now()));

        push('env', safeJson(env));

        try { push('settings', safeJson(settingsNow())); }
        catch (e) { push('settings', '(error)'); }

        try {
          if (LC.state && typeof LC.state.get === 'function') push('state', safeJson(LC.state.get()));
        } catch (e) { /* 省略 */ }

        var vl = [];
        try {
          var sum = LC.speaker.getVoiceSummary();
          vl.push('selected: ' + (sum.selected ? (sum.selected.name + ' / ' + sum.selected.lang) : 'none'));
          vl.push('total: ' + sum.total + ' english: ' + sum.englishCount);
          var g = voiceGroups;
          for (var i = 0; i < g.offline.length; i++) vl.push('[offline] ' + g.offline[i].name + ' / ' + g.offline[i].lang);
          for (var j = 0; j < g.online.length; j++) vl.push('[online]  ' + g.online[j].name + ' / ' + g.online[j].lang);
          vl.push('tts: ' + safeJson(LC.speaker.getDiagnostics()));
        } catch (e) { vl.push('(error)'); }
        push('voices', vl.join('\n'));

        push('microphone', 'permission: ' + micPerm);

        var storeLines = [];
        try {
          storeLines.push('mode: ' + LC.store.getMode());
          storeLines.push('reason: ' + String(LC.store.getModeReason()));
          storeLines.push('usage: ' + formatBytes(LC.store.estimateUsageBytes()));
          storeLines.push('demo: ' + String(LC.store.isDemoMode()));
        } catch (e) { storeLines.push('(error)'); }
        push('storage', storeLines.join('\n'));

        var dl = [];
        for (var k = 0; k < deckErrors.length; k++) {
          dl.push(deckErrors[k].deckId + ': ' + (deckErrors[k].errors || []).join(' / '));
        }
        push('deck-errors', dl.length ? dl.join('\n') : 'none');

        push('log', util.getLogText());

        return out.join('\n');
      }

      function safeJson(obj) {
        try { return JSON.stringify(obj, null, 1); }
        catch (e) { return '(unserializable)'; }
      }

      /* ============ 非同期の初期化 ============ */

      paintChecks();

      try {
        var pm = LC.env.queryMicPermission();
        if (pm && typeof pm.then === 'function') {
          pm.then(function (state) {
            if (destroyed) return;
            micPerm = state;
            paintChecks();
          });
        }
      } catch (e) { /* 落ちない */ }

      try {
        var pv = LC.speaker.loadVoices();
        if (pv && typeof pv.then === 'function') {
          pv.then(function (arr) {
            if (destroyed) return;
            try { voiceGroups = LC.speaker.listEnglishVoices(arr, settingsNow().lang); }
            catch (e2) { voiceGroups = { offline: [], online: [] }; }
            voicesReady = true;
            paintChecks();
          });
        }
      } catch (e) { /* 落ちない */ }

      return {
        el: root,
        title: t('help.title'),
        destroy: function () {
          destroyed = true;
          stopMeter();
          try { LC.speaker.stopSpeaking(); } catch (e) { /* 落ちない */ }
          if (rec) {
            /* ★結果はいらないので cancel → destroy。タイマーごと畳む。 */
            try { rec.cancel(); } catch (e) { /* 落ちない */ }
            try { rec.destroy(); } catch (e) { /* 落ちない */ }
            rec = null;
          }
        },
        onKey: function () { return false; }
      };
    }
  };

  /* ============================================================
   * 7. decks(§7-8)— 自作デッキ(貼り付け追加)
   *   非エンジニア部員が 3 行貼り付けるだけでカテゴリが増えることが目標。
   * ============================================================ */

  LC.screens.decks = {
    render: function (ctx) {
      var st = appState(ctx);
      var root = h('div', { 'class': 'stack' });
      var listBox = h('div', { 'class': 'stack' });
      var errorBox = h('div', { 'class': 'stack' });
      var exportBox = h('div', { 'class': 'stack' });
      var textarea = null;
      var importArea = null;
      var editingId = null;      /* 編集中の自作デッキ id(null なら新規追加) */
      var addBtn = null;
      var confirms = [];         /* 削除の 2 段階確認(Esc で全部取り消す) */

      root.appendChild(h('h1', { text: t('decks.title') }));

      /* --- 貼り付けエディタ --- */
      var editor = card(null, 'deck-editor');
      editor.appendChild(p(t('decks.lead'), 'deck-editor__help'));
      editor.appendChild(p(t('decks.lead2'), 'deck-editor__help'));

      var taId = 'deckPasteArea';
      editor.appendChild(h('label', { 'class': 'sr-only', attrs: { 'for': taId }, text: t('decks.textareaLabel') }));
      textarea = h('textarea', {
        id: taId,
        attrs: { rows: '6', placeholder: t('decks.placeholder'), spellcheck: 'false' }
      });
      editor.appendChild(textarea);
      addBtn = btn(t('decks.add'), onAdd, ['btn--primary']);
      editor.appendChild(addBtn);
      editor.appendChild(errorBox);
      root.appendChild(editor);

      /* --- 作ったカテゴリ --- */
      var mine = card(null);
      mine.appendChild(sectionTitle(t('decks.myDecksTitle')));
      mine.appendChild(listBox);
      root.appendChild(mine);

      /* --- 書き出し / 読み込み --- */
      var io = card(null);
      io.appendChild(btn(t('decks.exportBtn'), onExport, ['btn--ghost']));
      io.appendChild(exportBox);
      var impId = util.uid('import');
      io.appendChild(h('label', { 'class': 'field__label', attrs: { 'for': impId }, text: t('decks.importLabel') }));
      importArea = h('textarea', {
        id: impId,
        attrs: { rows: '3', placeholder: t('decks.importPlaceholder'), spellcheck: 'false' }
      });
      io.appendChild(importArea);
      io.appendChild(btn(t('decks.importBtn'), onImport, ['btn--ghost']));
      root.appendChild(io);

      if (isDemo(st)) root.appendChild(p(t('decks.demoBlocked'), 'muted small'));

      /* ---- 追加 / 編集 ---- */

      function onAdd() {
        util.clear(errorBox);
        var res;
        try { res = LC.catalog.parsePasted(textarea.value); }
        catch (e) { res = { ok: false, deck: null, errors: [], warnings: [] }; }

        showLineIssues(res.errors, res.warnings);
        if (!res.ok || !res.deck) {
          toast(t('decks.addFailed'), { type: 'warn' });
          return;
        }

        /* 編集中なら id を引き継いで差し替える(新しい id で増殖させない)。 */
        if (editingId) {
          res.deck.id = editingId;
          for (var i = 0; i < res.deck.phrases.length; i++) {
            res.deck.phrases[i].id = editingId + '-' + pad2(i + 1);
          }
        }

        var saved;
        try { saved = LC.catalog.saveCustomDeck(res.deck); }
        catch (e) { saved = { ok: false, errors: [] }; }

        if (!saved.ok) {
          showMessages(saved.errors);
          toast(t('decks.addFailed'), { type: 'warn' });
          return;
        }

        toast(t('decks.added', { title: saved.deck.title }));
        announce(t('decks.added', { title: saved.deck.title }));
        textarea.value = '';
        setEditing(null);
        paintList();
      }

      function setEditing(id) {
        editingId = id;
        addBtn.textContent = id ? t('common.save') : t('decks.add');
      }

      function pad2(n) { return (n < 10 ? '0' : '') + n; }

      /** 自作デッキを貼り付け形式のテキストへ戻す(編集のため)。 */
      function deckToText(deck) {
        var lines = ['# ' + deck.title];
        for (var i = 0; i < deck.phrases.length; i++) {
          var ph = deck.phrases[i];
          lines.push(ph.ja ? (ph.text + ' | ' + ph.ja) : ph.text);
        }
        return lines.join('\n');
      }

      function showLineIssues(errors, warnings) {
        var all = (errors || []).concat(warnings || []);
        if (!all.length) return;
        var box = h('div', { 'class': 'error-lines' });
        /* 見出しは「直してほしい行」。警告だけのときは付けない(受け入れられているため)。 */
        if (errors && errors.length) box.appendChild(h('p', { text: t('decks.errorTitle') }));
        for (var i = 0; i < all.length; i++) {
          var e = all[i];
          var text = (e && e.line > 0)
            ? t('decks.errorLine', { n: e.line, msg: e.message })
            : String(e && e.message ? e.message : e);
          box.appendChild(h('p', { text: text }));
        }
        errorBox.appendChild(box);
      }

      function showMessages(msgs) {
        if (!msgs || !msgs.length) return;
        var box = h('div', { 'class': 'error-lines' });
        for (var i = 0; i < msgs.length; i++) box.appendChild(h('p', { text: String(msgs[i]) }));
        errorBox.appendChild(box);
      }

      /* ---- 一覧 ---- */

      function paintList() {
        util.clear(listBox);
        confirms = [];

        var decks = [];
        try { decks = LC.catalog.getCustomDecks(); } catch (e) { decks = []; }

        if (!decks.length) {
          listBox.appendChild(p(t('decks.empty'), 'muted'));
          return;
        }

        var wrap = h('div', { 'class': 'custom-deck-list' });
        for (var i = 0; i < decks.length; i++) {
          wrap.appendChild(deckRow(decks[i]));
        }
        listBox.appendChild(wrap);
      }

      function deckRow(deck) {
        var row = h('div', { 'class': 'custom-deck-row' },
          h('span', {
            'class': 'custom-deck-row__name',
            text: t('decks.deckRow', { title: deck.title, n: deck.phrases.length })
          }));

        row.appendChild(btn(t('decks.edit'), function () {
          textarea.value = deckToText(deck);
          setEditing(deck.id);
          util.clear(errorBox);
          try { textarea.focus(); } catch (e) { /* 落ちない */ }
        }, ['btn--ghost', 'btn--sm']));

        var conf = dangerConfirm({
          label: t('decks.remove'),
          confirmText: t('decks.removeConfirm', { title: deck.title }),
          confirmLabel: t('common.yes'),
          onConfirm: function () {
            var ok = false;
            try { ok = LC.catalog.deleteCustomDeck(deck.id); } catch (e) { ok = false; }
            if (ok) {
              toast(t('decks.removed', { title: deck.title }));
              if (editingId === deck.id) { setEditing(null); textarea.value = ''; }
            } else {
              toast(t('decks.demoBlocked'), { type: 'warn' });
            }
            paintList();
          }
        });
        confirms.push(conf);
        row.appendChild(conf.el);
        return row;
      }

      /* ---- 書き出し / 読み込み ---- */

      function onExport() {
        util.clear(exportBox);
        var decks = [];
        try { decks = LC.catalog.getCustomDecks(); } catch (e) { decks = []; }
        if (!decks.length) { toast(t('decks.exportEmpty'), { type: 'warn' }); return; }

        var text = '';
        try { text = LC.catalog.exportCustomDecks(); } catch (e) { text = ''; }
        if (!text) { toast(t('common.copyFailed'), { type: 'warn' }); return; }

        /* クリップボードに入れつつ、選んでコピーもできるように画面にも出す。 */
        var out = h('textarea', { attrs: { rows: '3', readonly: 'readonly', 'aria-label': t('decks.importLabel') } });
        out.value = text;
        exportBox.appendChild(out);

        var pr = util.copyText(text);
        if (pr && typeof pr.then === 'function') {
          pr.then(function (ok) {
            toast(ok ? t('decks.exported') : t('common.copyFailed'), { type: ok ? 'info' : 'warn' });
          });
        }
      }

      function onImport() {
        util.clear(errorBox);
        var res;
        try { res = LC.catalog.importCustomDecks(importArea.value); }
        catch (e) { res = { ok: false, added: 0, errors: [] }; }

        if (res.ok) {
          toast(t('decks.imported', { n: res.added }));
          importArea.value = '';
          paintList();
          return;
        }
        showMessages(res.errors && res.errors.length ? res.errors : [t('decks.importFailed')]);
        toast(t('decks.importFailed'), { type: 'warn' });
      }

      paintList();

      return {
        el: root,
        title: t('decks.title'),
        destroy: function () { confirms = []; },
        onKey: function (e) {
          /* input / textarea にフォーカスがあるときは何もしない(§7-3 と同じ規律)。 */
          var ae = document.activeElement;
          if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return false;
          if (e && e.key === 'Escape') {
            var handled = false;
            for (var i = 0; i < confirms.length; i++) {
              if (confirms[i].cancel()) handled = true;
            }
            return handled;
          }
          return false;
        }
      };
    }
  };

  /* ============================================================
   * 8. blocked(§10-2 / §10-3)— 非対応時の全画面
   *
   *   ★非対応ブラウザで来た部員に何も渡さないのは損失。
   *     「音声なしでフレーズ集を見る」を必ず用意し、この画面の中で完結させる
   *     (ルーターが blocked に固定していても教材が読めるようにするため)。
   * ============================================================ */

  LC.screens.blocked = {
    render: function (ctx) {
      var params = (ctx && ctx.params) || {};
      var st = appState(ctx);
      var env = st.env || {};
      var reason = params.reason || env.blockReason || 'no-recognition';

      var info = null;
      try { info = LC.msg.blocker(reason); } catch (e) { info = null; }
      if (!info) info = LC.msg.blocker('no-recognition');

      var root = h('div', { 'class': 'stack' });
      var bookBox = h('div', { 'class': 'stack' });
      var shown = false;

      var sec = h('section', { 'class': 'blocker' },
        icon('⚠', 'blocker__icon'),
        h('h1', { 'class': 'blocker__title', text: info.title }),
        p(info.body, 'blocker__body'));

      /* 「音声なしでフレーズ集を見る」は blocker の actions に無くても必ず出す。 */
      var actions = h('div', { 'class': 'actions actions--stack' });
      actions.appendChild(btn(t('actions.browse-only'), showBook, ['btn--primary']));

      for (var i = 0; i < info.actions.length; i++) {
        var key = info.actions[i];
        if (key === 'browse-only') continue;   /* 上で出し済み */
        var b = LC.ui.actionButton(key, { url: info.url });
        if (b) actions.appendChild(b);
      }
      sec.appendChild(actions);
      root.appendChild(sec);
      root.appendChild(bookBox);

      function showBook() {
        if (shown) return;
        shown = true;
        util.clear(bookBox);
        bookBox.appendChild(phraseBook());
        announce(t('actions.browse-only'));
        try { qs('.phrase-en', bookBox).scrollIntoView({ block: 'start' }); }
        catch (e) { /* 落ちない */ }
      }

      return {
        el: root,
        title: info.title,
        destroy: function () { /* 保持している資源なし */ },
        onKey: function () { return false; }
      };
    }
  };

  LC.__loaded = (LC.__loaded || []).concat('screens');
})(window.LC);

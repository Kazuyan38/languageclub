/* js/07-ui.js — LC.ui: 共通 UI 部品(仕様 §5-15 / §7-3(D) / §8-3 / §12)
 *
 * 役割
 *   ・採点結果(ScoreResult)の描画          renderResult / buildTextSummary / bandBadge
 *   ・エラーの見せ方(インラインパネル)      errorPanel
 *   ・マイク入力レベルの計測                createLevelMeter / levelMeterEl
 *   ・進捗と警告帯                          progressDots / attemptDots / renderBanner
 *
 * 依存(この 3 つだけ)
 *   LC.util … DOM ヘルパ・トースト・コピー・announce
 *   LC.msg  … ユーザーに見せる日本語(このファイルに日本語の文言を直書きしない)
 *   LC.score… BANDS / MAX_ATTEMPTS の**参照のみ**(採点はしない)
 *
 * このファイルが絶対に触らないもの
 *   speechSynthesis / SpeechRecognition(05-speech.js のみ)
 *   localStorage(02-store.js のみ)
 *   LC.session / LC.state(画面ファイルの仕事)
 *
 * 文言の規律(仕様 §0-1)
 *   「発音採点」「発音が間違っています」「不合格」は使わない。
 *   「伝わり度」「◯語中◯語が伝わりました」「もう一度ためしてみましょう」を使う。
 */
window.LC = window.LC || {};
(function (LC) {
  'use strict';

  /* ============================================================
   * 0. 小さなヘルパ
   *    LC.util は必ず先に読み込まれている(index.html の順序が依存関係)が、
   *    順序事故で白画面にしないため、参照は毎回 LC 経由で行う。
   * ============================================================ */

  function U() { return LC.util || {}; }

  /** 要素生成。LC.util.h が無い異常時でも落ちないようにフォールバックする。 */
  function h(tag, props) {
    var u = U();
    if (typeof u.h === 'function') {
      return u.h.apply(null, arguments);
    }
    var el = document.createElement(tag);
    if (props && props.text) el.textContent = String(props.text);
    if (props && props['class']) el.setAttribute('class', String(props['class']));
    return el;
  }

  /** 文言。未定義キーはキー文字列が返る仕様なので、そのまま画面に出さないよう注意する。 */
  function t(key, vars) {
    if (LC.msg && typeof LC.msg.t === 'function') return LC.msg.t(key, vars);
    return String(key);
  }

  function txt(s) { return document.createTextNode(s === null || s === undefined ? '' : String(s)); }

  function clearEl(el) {
    var u = U();
    if (typeof u.clear === 'function') return u.clear(el);
    while (el && el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  function toast(text, opts) {
    var u = U();
    if (typeof u.toast === 'function') return u.toast(text, opts);
    return function () {};
  }

  function log(tag, obj) {
    var u = U();
    if (typeof u.log === 'function') { try { u.log(tag, obj); } catch (e) { /* 診断ログの失敗は無視 */ } }
  }

  function num(x, fallback) {
    var n = Number(x);
    return isFinite(n) ? n : (fallback || 0);
  }

  function repeat(s, n) {
    var out = '', i;
    for (i = 0; i < n; i++) out += s;
    return out;
  }

  /** 呼び出し側のコールバックで画面全体を落とさない(公開関数は例外を投げない)。 */
  function safeCall(fn, args, tag) {
    if (typeof fn !== 'function') return;
    try { fn.apply(null, args || []); }
    catch (e) { log(tag || 'ui.callback.error', { message: e && e.message }); }
  }

  /* ============================================================
   * 1. バンド表示(仕様 §5-10 の BANDS を参照するだけ)
   * ============================================================ */

  /** ScoreResult からバンド情報を取り出す。BANDS が無くても落ちない。 */
  function bandInfo(result) {
    var r = result || {};
    var key = r.band || 'retry';
    var from = null;
    var list = (LC.score && LC.score.BANDS) || null;
    if (list && list.length) {
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].key === key) { from = list[i]; break; }
      }
    }
    return {
      key: key,
      emoji: r.bandEmoji || (from && from.emoji) || '',
      label: r.bandLabel || (from && from.label) || '',
      comment: r.comment || (from && from.comment) || ''
    };
  }

  /**
   * バンドのバッジ。記号(◎○△▢)は aria-hidden にして、
   * ラベル(日本語)だけをスクリーンリーダーに読ませる。
   * @param {Object} result ScoreResult
   * @returns {HTMLElement}
   */
  function bandBadge(result) {
    var info = bandInfo(result);
    var el = h('span', { 'class': ['badge', 'badge--band', 'badge--' + info.key] });
    if (info.emoji) {
      el.appendChild(h('span', { 'class': 'badge__mark', text: info.emoji, attrs: { 'aria-hidden': 'true' } }));
    }
    el.appendChild(h('span', { 'class': 'badge__label', text: info.label }));
    return el;
  }

  /* ============================================================
   * 2. 単語スパン(仕様 §8-3 の 4 つの手がかり)
   *
   *   ①記号(w__mark) ②下線/枠(w--*) ③テキスト(w__heard) ④色(CSS)
   *   色は 4 番目の手がかり。全部グレースケールにしても意味が伝わること。
   *   記号と「→ heard」は aria-hidden、代わりに aria-label に日本語を入れる。
   * ============================================================ */

  /* 採点側(03-text.js foldType)が返す型:
   * correct / homophone / near / substitution / deletion / partial / ignored
   * partial(do not のように一部だけ通った表示単位)は「惜しい」と同じ見せ方にする。 */
  var SEG_CLASS = {
    correct: 'w--correct',
    homophone: 'w--homophone',
    near: 'w--near',
    partial: 'w--near',
    substitution: 'w--substitution',
    deletion: 'w--deletion',
    ignored: 'w--ignored',
    insertion: 'w--insertion'
  };

  var SEG_MARK = {
    correct: '',
    homophone: '≈',      /* ≈ */
    near: '~',
    partial: '~',
    substitution: '✕',   /* ✕ */
    deletion: '▁',       /* ▁ */
    ignored: '',
    insertion: '＋'       /* ＋ */
  };

  var SEG_STATE_KEY = {
    correct: 'result.stateCorrect',
    homophone: 'result.stateHomophone',
    near: 'result.stateNear',
    partial: 'result.stateNear',
    substitution: 'result.stateSubstitution',
    deletion: 'result.stateDeletion',
    insertion: 'result.stateInsertion'
  };

  function segType(seg) {
    var ty = seg && seg.type;
    return SEG_CLASS[ty] ? ty : 'correct';
  }

  /** seg.hyp は「綴りが変わった語」だけの配列。表示は空白でつなぐ(do not のように複数語になる)。 */
  function hypText(seg) {
    var arr = (seg && seg.hyp) || [];
    if (!arr.length) return '';
    var out = [];
    for (var i = 0; i < arr.length; i++) if (arr[i]) out.push(String(arr[i]));
    return out.join(' ');
  }

  /** ③ テキストの手がかり(語の下に出す小さい文字)。 */
  function heardLineText(type, seg) {
    if (type === 'homophone') return t('result.homophoneNote');
    /* 抜けた語は「→ なし」。置換の「→ economic」と同じ形にして読み方を揃える。
       長い文言を語の下に置くと 1 行が縦に伸びて文が読めなくなるため短くする。 */
    if (type === 'deletion') return '→ ' + t('result.none');
    if (type === 'near' || type === 'partial' || type === 'substitution') {
      var hp = hypText(seg);
      return hp ? '→ ' + hp : t('result.stateSubstitution');
    }
    return '';
  }

  /**
   * aria-label(日本語)。正解の語には付けない
   * ——付けると英文全体が「〜、伝わりました」の連呼になって読めなくなるため。
   * 例: 「economics、惜しい。economic と聞き取られました」(仕様 §12-2)
   */
  function wordAriaLabel(type, seg, word) {
    if (type === 'correct' || type === 'ignored') return '';
    var stateKey = SEG_STATE_KEY[type];
    if (!stateKey) return '';
    var state = t(stateKey);
    var hp = hypText(seg);
    var label = hp
      ? t('result.wordAria', { word: word, state: state, heard: hp })
      : t('result.wordAriaPlain', { word: word, state: state });
    if (seg && seg.hint) label += '。' + t('result.hint', { text: seg.hint });
    return label;
  }

  /**
   * 1 表示単位のスパンを作る。
   * @param {Object} seg    ScoreResult.segments の 1 要素(または {text,type,hyp} 相当)
   * @param {Object} opts   {onWordClick}
   */
  function wordSpan(seg, opts) {
    var type = segType(seg);
    var word = (seg && seg.text) || '';
    var span = h('span', {
      'class': ['w', SEG_CLASS[type]],
      attrs: { lang: 'en' }
    });

    span.appendChild(txt(word));

    var mark = SEG_MARK[type];
    if (mark) {
      /* 記号は視覚の手がかり。読み上げは aria-label 側で日本語にする。 */
      span.appendChild(h('span', { 'class': 'w__mark', text: mark, attrs: { 'aria-hidden': 'true' } }));
    }

    var heard = heardLineText(type, seg);
    if (heard) {
      span.appendChild(h('span', { 'class': 'w__heard', text: heard, attrs: { 'aria-hidden': 'true' } }));
    }

    var label = wordAriaLabel(type, seg, word);

    if (opts && typeof opts.onWordClick === 'function' && word) {
      /* クリックでその語だけ読み上げる導線。
       * <button> にすると §8-3 の .w スタイルが効かなくなるので、
       * span のまま role/tabindex/キー操作で「ボタン」にする。 */
      span.setAttribute('role', 'button');
      span.setAttribute('tabindex', '0');
      span.className = span.className + ' w--clickable';
      span.style.cursor = 'pointer';   /* 押せることの手がかり。色や余白は CSS 側の責任 */
      /* aria-label に「押すと読み上げます」等を足さない。
         role="button" が支援技術に「ボタン」と伝えるので、説明を重ねると冗長になる。 */
      var fire = function (ev) {
        if (ev) ev.preventDefault();
        safeCall(opts.onWordClick, [word, seg], 'ui.onWordClick.error');
      };
      span.addEventListener('click', fire);
      span.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') fire(ev);
      });
    }

    if (label) span.setAttribute('aria-label', label);
    return span;
  }

  /** 余分に聞こえた語のチップ(語と語の間に差し込む)。 */
  function insertionChip(word) {
    var span = h('span', {
      'class': ['w', 'w--insertion'],
      attrs: { lang: 'en', 'aria-label': t('result.wordAriaPlain', { word: word, state: t('result.stateInsertion') }) }
    });
    span.appendChild(txt(word));
    span.appendChild(h('span', {
      'class': 'w__mark', text: SEG_MARK.insertion, attrs: { 'aria-hidden': 'true' }
    }));
    return span;
  }

  /* ============================================================
   * 3. buildTextSummary(純関数。テストが呼ぶ)
   *
   *   色分けを一切見なくても分かる冗長経路(仕様 §12-3)。
   *   ・抜けた語: a, the
   *   ・違って聞こえた語: three → free、right → light
   *   ・余分に聞こえた語: um
   *   該当が無い行は出さない(空配列もありうる)。DOM には触らない。
   * ============================================================ */

  /**
   * @param {Object} result ScoreResult
   * @returns {string[]} 0〜3 行
   */
  function buildTextSummary(result) {
    var lines = [];
    if (!result || typeof result !== 'object') return lines;

    var segs = Array.isArray(result.segments) ? result.segments : [];
    var deleted = [];
    var pairs = [];
    var i, seg, ty, hp;

    for (i = 0; i < segs.length; i++) {
      seg = segs[i];
      if (!seg || !seg.text) continue;
      ty = segType(seg);
      if (ty === 'deletion') {
        deleted.push(seg.text);
      } else if (ty === 'near' || ty === 'partial' || ty === 'substitution') {
        hp = hypText(seg);
        if (hp) pairs.push(t('result.wordPair', { ref: seg.text, hyp: hp }));
      }
    }

    var inserted = [];
    var ins = Array.isArray(result.insertions) ? result.insertions : [];
    for (i = 0; i < ins.length; i++) {
      if (ins[i] && ins[i].word) inserted.push(String(ins[i].word));
    }

    /* 区切りは仕様 §12-3 の例に合わせる(語は ", "、対は "、")。 */
    if (deleted.length) lines.push(t('result.deletedLabel') + ': ' + deleted.join(', '));
    if (pairs.length) lines.push(t('result.substitutedLabel') + ': ' + pairs.join('、'));
    if (inserted.length) lines.push(t('result.insertedLabel') + ': ' + inserted.join(', '));

    return lines;
  }

  /** 診断コピーやトースト用に 1 本の文字列で欲しいとき。 */
  function summaryText(result) {
    return buildTextSummary(result).join('\n');
  }

  /** 「ヒント: 〜」行(§7-3 ④ の 4 行目)。重複するヒントはまとめる。 */
  function hintLine(result) {
    var segs = (result && Array.isArray(result.segments)) ? result.segments : [];
    var seen = {}, hints = [], i, hn;
    for (i = 0; i < segs.length; i++) {
      hn = segs[i] && segs[i].hint;
      if (!hn || seen[hn]) continue;
      seen[hn] = true;
      hints.push(hn);
    }
    if (!hints.length) return '';
    return t('result.hint', { text: hints.join('、') });
  }

  /* ============================================================
   * 4. renderResult(仕様 §7-3 (D))
   *
   *   ★表示順序を固定する。点数を最初に出さない。
   *     ① 聞こえた文(装飾なしの生テキスト = 事実)
   *     ② お手本の色分け(詳細)
   *     ③ バンドと「◯語中◯語が伝わりました」(総括。点数は showScore のときだけ)
   *     ④ テキストサマリ(冗長経路)
   *     ⑤ 次の行動
   *   初心者は点数が最初に目に入るとそこで評価が確定し、以降を読まないため。
   * ============================================================ */

  /**
   * @param {Object} result ScoreResult
   * @param {Object=} opts {onWordClick(word, segment), showScore:boolean,
   *                        prevScore:number|null, nextText:string}
   * @returns {HTMLElement} .result(呼び出し側が appendChild する)
   *                       .result__actions を querySelector すればボタンを足せる
   */
  function renderResult(result, opts) {
    opts = opts || {};
    var root = h('div', { 'class': 'result', attrs: { tabindex: '-1' } });

    if (!result || typeof result !== 'object') {
      root.appendChild(h('p', { 'class': 'result__heard', text: t('result.heardEmpty') }));
      return root;
    }

    /* --- ① 聞こえた文 ------------------------------------------------ */
    var heard = (result.heard === null || result.heard === undefined) ? '' : String(result.heard).trim();
    root.appendChild(h('h3', { 'class': 'result__label', text: t('result.heardTitle') }));
    if (heard) {
      root.appendChild(h('p', { 'class': 'result__heard', text: heard, attrs: { lang: 'en' } }));
    } else {
      root.appendChild(h('p', {
        'class': ['result__heard', 'result__heard--empty'], text: t('result.heardEmpty')
      }));
    }

    /* --- ② お手本の色分け -------------------------------------------- */
    root.appendChild(h('h3', { 'class': 'result__label', text: t('result.modelTitle') }));
    root.appendChild(renderSentence(result, opts));

    /* --- ③ バンド + 「◯語中◯語が伝わりました」(点数はここに添えるだけ) -- */
    var info = bandInfo(result);
    var plain = plainOf(result);
    var band = h('div', { 'class': 'result__band' });
    band.appendChild(bandBadge(result));
    var plainLine = t('result.plain', { total: plain.totalWords, n: plain.deliveredWords });
    band.appendChild(h('span', { 'class': 'result__delivered', text: plainLine }));

    if (opts.showScore === true) {
      var scoreText = t('result.scoreLine', { n: num(result.score, 0) });
      if (typeof opts.prevScore === 'number' && isFinite(opts.prevScore)) {
        var delta = num(result.score, 0) - opts.prevScore;
        var deltaText = (delta > 0 ? '+' : (delta < 0 ? '' : '±')) + (delta === 0 ? '0' : String(delta));
        scoreText += '  ' + t('result.scorePrev', { prev: opts.prevScore, delta: deltaText });
      }
      band.appendChild(h('span', { 'class': 'result__score', text: scoreText }));
    }
    root.appendChild(band);
    if (info.comment) {
      root.appendChild(h('p', { 'class': 'result__comment', text: info.comment }));
    }

    /* --- ④ テキストサマリ(色分けを見なくても分かる冗長経路) ---------- */
    var summary = h('div', { 'class': 'result__summary' });
    var lines = buildTextSummary(result);
    var hl = hintLine(result);
    var i;
    for (i = 0; i < lines.length; i++) {
      summary.appendChild(h('p', { 'class': 'summary-line', text: lines[i] }));
    }
    if (hl) summary.appendChild(h('p', { 'class': ['summary-line', 'summary-line--hint'], text: hl }));
    if (lines.length || hl) root.appendChild(summary);

    /* --- ⑤ 次の行動 --------------------------------------------------- */
    var next = h('div', { 'class': 'result__next' });
    var nextText = opts.nextText;
    if (nextText === undefined) {
      if (!heard) nextText = t('practice.noSpeech');
      else if (info.key === 'excellent') nextText = '';
      else nextText = t('result.retryPrompt');
    }
    if (nextText) next.appendChild(h('p', { 'class': 'result__nextText', text: nextText }));
    /* ボタン(もう一度 / ゆっくり / 次へ / うまく拾えなかった)は
       セッションを知っている練習画面が、この枠に入れる。 */
    next.appendChild(h('div', { 'class': 'result__actions' }));
    root.appendChild(next);

    /* 結果のバンドと語数はアナウンスする(仕様 §12-2)。interim はしない。 */
    var u = U();
    if (typeof u.announce === 'function') {
      u.announce((info.label ? info.label + '。' : '') + plainLine);
    }

    return root;
  }

  /** 「◯語中◯語」。plain が無い古い結果でも壊れないようにする。 */
  function plainOf(result) {
    var p = result && result.plain;
    if (p && typeof p.totalWords === 'number') {
      return { deliveredWords: num(p.deliveredWords, 0), totalWords: num(p.totalWords, 0) };
    }
    var c = (result && result.counts) || {};
    var delivered = num(c.correct, 0) + num(c.homophone, 0);
    var total = delivered + num(c.substitution, 0) + num(c.deletion, 0);
    return { deliveredWords: delivered, totalWords: total };
  }

  /**
   * ② お手本の 1 文。表示単位のスパンを並べ、余分に聞こえた語のチップを間に挟む。
   * insertions[].afterRefIndex は**表示単位の添字**(-1 は文頭)。
   */
  function renderSentence(result, opts) {
    var p = h('p', { 'class': 'result__sentence', attrs: { lang: 'en' } });
    var segs = Array.isArray(result.segments) ? result.segments : [];
    var ins = Array.isArray(result.insertions) ? result.insertions : [];

    /* 位置ごとに「その表示単位の前に置くチップ」を集める */
    var before = {};
    var i, at;
    for (i = 0; i < ins.length; i++) {
      if (!ins[i] || !ins[i].word) continue;
      at = num(ins[i].afterRefIndex, -1) + 1;      /* -1(文頭) → 0 */
      if (at < 0) at = 0;
      if (at > segs.length) at = segs.length;
      if (!before[at]) before[at] = [];
      before[at].push(String(ins[i].word));
    }

    var first = true;
    function put(node) {
      if (!first) p.appendChild(txt(' '));   /* 語と語の間に空白(コピーしたとき読める) */
      p.appendChild(node);
      first = false;
    }
    function putChips(pos) {
      var list = before[pos];
      if (!list) return;
      for (var k = 0; k < list.length; k++) put(insertionChip(list[k]));
    }

    for (i = 0; i < segs.length; i++) {
      putChips(i);
      put(wordSpan(segs[i], opts));
    }
    putChips(segs.length);

    if (!segs.length && !ins.length) {
      p.appendChild(txt(result.matchedReference || ''));
    }
    return p;
  }

  /* ============================================================
   * 5. 進捗ドット / 試行ドット
   *    色だけでなく ●/○ の形で区別する(仕様 §7-2)。
   * ============================================================ */

  var DOTS_MAX = 24;   /* これを超えると ●●●… が読みにくいので数字表記に切り替える */

  /**
   * @param {number} done  クリア数
   * @param {number} total 全体数
   * @returns {HTMLElement} .progress-dots(role="img")
   */
  function progressDots(done, total) {
    var tot = Math.max(0, Math.floor(num(total, 0)));
    var dn = Math.floor(num(done, 0));
    if (dn < 0) dn = 0;
    if (dn > tot) dn = tot;

    var wrap = h('div', {
      'class': 'progress-dots',
      attrs: { role: 'img', 'aria-label': t('common.deckProgressAria', { done: dn, total: tot }) }
    });
    var shown = (tot > 0 && tot <= DOTS_MAX)
      ? repeat('●', dn) + repeat('○', tot - dn)
      : t('common.deckProgress', { done: dn, total: tot });
    wrap.appendChild(h('span', { text: shown, attrs: { 'aria-hidden': 'true' } }));
    return wrap;
  }

  /* 「80 点以上が 2 回でクリア」(仕様 §5-10 passRate)。
   * LC.score は数値を公開していないので、ここでは表示のためだけに持つ。 */
  var NEED_PASS = 2;

  function maxAttempts() {
    return (LC.score && LC.score.MAX_ATTEMPTS) || 3;
  }

  /** session.getPassStatus() の戻りを {pass,total,cleared} に正規化する。配列でも受ける。 */
  function normalizePassStatus(ps) {
    var maxA = maxAttempts();
    var pass = 0, total = 0, cleared = false, i, x;
    if (Array.isArray(ps)) {
      for (i = 0; i < ps.length; i++) {
        x = ps[i];
        if (x === null || x === undefined) continue;
        total++;
        if (x === true || (x && typeof x === 'object' && x.pass === true)) pass++;
      }
      cleared = pass >= NEED_PASS && total >= maxA;
    } else if (ps && typeof ps === 'object') {
      pass = Math.max(0, Math.floor(num(ps.pass, 0)));
      total = Math.max(0, Math.floor(num(ps.total, 0)));
      cleared = (ps.cleared === true) || (pass >= NEED_PASS && total >= maxA);
    }
    if (pass > maxA) pass = maxA;
    return { pass: pass, total: total, cleared: cleared, max: maxA };
  }

  /**
   * ●●○ の 3 つ + 「あと 1 回通じればクリア」。
   * @param {Object|Array} passStatus session.getPassStatus() の戻り
   * @returns {HTMLElement} .attempt-dots
   */
  function attemptDots(passStatus) {
    var st = normalizePassStatus(passStatus);
    var wrap = h('div', { 'class': 'attempt-dots' });

    wrap.appendChild(h('span', {
      'class': 'attempt-dots__dots',
      text: repeat('●', st.pass) + repeat('○', Math.max(0, st.max - st.pass)),
      attrs: { role: 'img', 'aria-label': t('practice.attemptsAria', { max: st.max, n: st.pass }) }
    }));

    var note;
    if (st.cleared) {
      note = t('result.passCleared', { total: st.total || st.max, n: st.pass });
    } else {
      var need = NEED_PASS - st.pass;
      var left = st.max - st.total;
      if (need > 0 && left >= need) note = t('result.passRemain', { n: need });
      else if (left > 0) note = t('result.passRemain', { n: Math.max(1, need) });
      else note = t('result.passOut', { again: t('common.tryAgain') });
    }
    wrap.appendChild(h('span', { 'class': 'attempt-dots__note', text: note }));
    return wrap;
  }

  /* ============================================================
   * 6. アクション(エラーパネル・警告帯 共通)
   *
   *   仕様の ASR_ERRORS / BLOCKERS は actions を**キーの配列**で持つので、
   *   文字列キーでも {label, onClick} オブジェクトでも受けられるようにする。
   *   キーだけで意味が確定するもの(reload / settings / diagnostics …)は
   *   ここで既定の動作を与え、画面ごとの実装漏れを防ぐ。
   * ============================================================ */

  function goHash(hash) { try { location.hash = hash; } catch (e) { log('ui.nav.error', { hash: hash }); } }

  /** コピーして結果をトーストで知らせる。clipboard 失敗時は util 側が textarea にフォールバックする。 */
  function copyAndTell(text) {
    var u = U();
    if (typeof u.copyText !== 'function') { toast(t('common.copyFailed'), { type: 'warn' }); return; }
    var p = u.copyText(text);
    if (p && typeof p.then === 'function') {
      p.then(function (ok) {
        toast(ok ? t('common.copied') : t('common.copyFailed'), { type: ok ? 'info' : 'warn' });
      }, function () { toast(t('common.copyFailed'), { type: 'warn' }); });
    }
  }

  /**
   * アクション 1 個をボタン(または外部リンク)にする。
   * @param {string|Object} spec 'reload' などのキー、または {label,onClick,primary,copy,href}
   * @param {Object=} ctx {url, onAction(key)}
   * @returns {HTMLElement|null} 動作を決められないキーは null(押しても何も起きないボタンを出さない)
   */
  function actionButton(spec, ctx) {
    ctx = ctx || {};
    var key = null, label = '', onClick = null, primary = false, href = null, copy = null;

    if (typeof spec === 'string') {
      key = spec;
      label = (LC.msg && typeof LC.msg.actionLabel === 'function') ? LC.msg.actionLabel(key) : key;
    } else if (spec && typeof spec === 'object') {
      key = spec.key || null;
      label = spec.label || (key && LC.msg && typeof LC.msg.actionLabel === 'function' ? LC.msg.actionLabel(key) : '');
      onClick = typeof spec.onClick === 'function' ? spec.onClick : null;
      primary = spec.primary === true;
      href = spec.href || null;
      copy = spec.copy || null;
    } else {
      return null;
    }
    if (!label) return null;

    var msgUrl = (LC.msg && LC.msg.PAGES_URL) || '';
    var chromeUrl = (LC.msg && LC.msg.CHROME_URL) || '';

    if (!onClick && !href && !copy && key) {
      switch (key) {
        case 'reload':
          onClick = function () { try { location.reload(); } catch (e) { /* 何もできない */ } };
          primary = true;
          break;
        case 'settings': onClick = function () { goHash('#/settings'); }; break;
        case 'diagnostics': onClick = function () { goHash('#/help'); }; break;
        case 'browse-only': onClick = function () { goHash('#/'); }; break;
        case 'copy-url': copy = ctx.url || msgUrl; break;
        case 'chrome-download': href = ctx.url || chromeUrl; break;
        default: break;
      }
    }
    if (!onClick && !href && !copy) {
      /* retry など、押したときの動作を画面しか知らないもの */
      if (typeof ctx.onAction === 'function' && key) {
        onClick = function () { safeCall(ctx.onAction, [key], 'ui.onAction.error'); };
      } else {
        return null;
      }
    }

    if (href) {
      return h('a', {
        'class': ['btn', primary ? 'btn--primary' : 'btn--ghost'],
        text: label,
        attrs: { href: href, target: '_blank', rel: 'noopener noreferrer' }
      });
    }

    var handler = onClick || function () { copyAndTell(copy); };
    return h('button', {
      'class': ['btn', primary ? 'btn--primary' : 'btn--ghost'],
      text: label,
      attrs: { type: 'button' },
      on: { click: function () { safeCall(handler, [], 'ui.action.error'); } }
    });
  }

  /** chrome://settings/... は JS から開けないので、コピーできるテキストとして見せる(仕様 §5-2)。 */
  function permissionHowto() {
    var url = (LC.msg && LC.msg.MIC_SETTINGS_URL) || '';
    if (!url) return null;
    var box = h('div', { 'class': 'panel-error__howto' });
    box.appendChild(h('code', { 'class': 'panel-error__url', text: url }));
    box.appendChild(h('button', {
      'class': ['btn', 'btn--ghost'],
      text: t('common.copy'),
      attrs: { type: 'button' },
      on: { click: function () { copyAndTell(url); } }
    }));
    return box;
  }

  /* ============================================================
   * 7. errorPanel(仕様 §7-3 (E) / §10)
   *    ★インラインパネル。モーダルにしない(フォーカストラップを作らない)。
   * ============================================================ */

  /**
   * @param {Object} spec {title, body, actions, detail, onAction, url, tone}
   *        body    : string / string[] / Node
   *        actions : ('retry' などのキー | {label,onClick,primary,copy,href})[]
   *        detail  : 診断テキスト(<details> に折りたたみ + コピーボタン)
   * @returns {HTMLElement} .panel-error(呼び出し側が appendChild し、必要なら focus() する)
   */
  function errorPanel(spec) {
    spec = spec || {};
    var panel = h('section', {
      'class': ['panel-error', spec.tone ? 'panel-error--' + spec.tone : null],
      attrs: { role: 'alert', tabindex: '-1' }
    });

    if (spec.title) {
      panel.appendChild(h('h2', { 'class': 'panel-error__title', text: spec.title }));
    }

    var body = h('div', { 'class': 'panel-error__body' });
    appendBody(body, spec.body);
    if (body.firstChild) panel.appendChild(body);

    var actions = Array.isArray(spec.actions) ? spec.actions : [];
    var ctx = { url: spec.url || null, onAction: spec.onAction || null };
    var row = h('div', { 'class': 'panel-error__actions' });
    var hasHowto = false;
    var i, btn;
    for (i = 0; i < actions.length; i++) {
      if (actions[i] === 'permission-howto' || (actions[i] && actions[i].key === 'permission-howto')) {
        hasHowto = true;
        continue;
      }
      btn = actionButton(actions[i], ctx);
      if (btn) row.appendChild(btn);
    }
    if (hasHowto) {
      var howto = permissionHowto();
      if (howto) panel.appendChild(howto);
    }
    if (row.firstChild) panel.appendChild(row);

    if (spec.detail) {
      panel.appendChild(detailBlock(String(spec.detail)));
    }
    return panel;
  }

  function appendBody(container, body) {
    if (!body) return;
    if (body.nodeType) { container.appendChild(body); return; }
    var lines = Array.isArray(body) ? body : String(body).split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = String(lines[i]);
      if (!line) continue;
      container.appendChild(h('p', { text: line }));
    }
  }

  /** <details> + コピーボタン。長い診断テキストで画面を埋めないための折りたたみ。 */
  function detailBlock(detail) {
    var box = h('details', { 'class': 'panel-error__detail' });
    box.appendChild(h('summary', { text: t('error.detailToggle') }));
    box.appendChild(h('pre', { 'class': 'panel-error__pre', text: detail }));
    box.appendChild(h('button', {
      'class': ['btn', 'btn--ghost'],
      text: t('error.fatalDetail'),
      attrs: { type: 'button' },
      on: { click: function () { copyAndTell(detail); } }
    }));
    return box;
  }

  /* ============================================================
   * 8. renderBanner(ヘッダ下の警告帯。仕様 §7-0 / §10-2)
   * ============================================================ */

  var SEVERITY_CLASS = { warn: 'banner--warn', degrade: 'banner--warn', fatal: 'banner--error', info: 'banner--info' };

  /**
   * #bannerArea を作り直す(冪等)。
   * @param {Array} list  [{text|banner, severity|type, actions, url, code, onAction, dismissible}]
   *                      LC.msg.blocker(key) の戻りをそのまま渡せる。
   * @returns {HTMLElement|null} #bannerArea
   */
  function renderBanner(list) {
    var area = document.getElementById('bannerArea');
    if (!area) return null;
    clearEl(area);

    var items = [];
    var i;
    if (Array.isArray(list)) {
      for (i = 0; i < list.length; i++) if (list[i]) items.push(list[i]);
    }

    if (!items.length) {
      area.hidden = true;
      area.setAttribute('data-empty', '1');
      return area;
    }
    area.hidden = false;
    area.removeAttribute('data-empty');

    for (i = 0; i < items.length; i++) area.appendChild(bannerItem(items[i]));
    return area;
  }

  function bannerItem(item) {
    var severity = item.severity || item.type || 'warn';
    var text = item.banner || item.text || item.title || '';
    var el = h('div', {
      'class': ['banner__item', SEVERITY_CLASS[severity] || SEVERITY_CLASS.warn],
      data: { code: item.code || '' }
    });
    el.appendChild(h('span', { 'class': 'banner__text', text: text }));

    var actions = Array.isArray(item.actions) ? item.actions : [];
    var ctx = { url: item.url || null, onAction: item.onAction || null };
    var row = h('span', { 'class': 'banner__actions' });
    var btn, i;
    for (i = 0; i < actions.length; i++) {
      /* 警告帯では「詳しい手順」系は出さない(帯が長くなるほど読まれなくなる)。
         コピー・リンク・遷移など 1 タップで終わるものだけ残す。 */
      if (actions[i] === 'permission-howto' || actions[i] === 'retry') continue;
      btn = actionButton(actions[i], ctx);
      if (btn) row.appendChild(btn);
    }
    if (item.dismissible) {
      row.appendChild(h('button', {
        'class': ['btn', 'btn--ghost'],
        text: t('actions.dismiss'),
        attrs: { type: 'button' },
        on: { click: function () { if (el.parentNode) el.parentNode.removeChild(el); } }
      }));
    }
    if (row.firstChild) el.appendChild(row);
    return el;
  }

  /* ============================================================
   * 9. interim(聞き取り中の文字)
   *    ★ aria-live を付けない。頻繁に書き換わるので読み上げが騒がしくなる(仕様 §12-2)。
   *      既定が off でも、後から誰かが live 属性を足さないよう明示しておく。
   * ============================================================ */

  function interimEl(id) {
    return h('p', {
      'class': 'interim',
      id: id || 'interimText',
      attrs: {
        lang: 'en',
        'aria-live': 'off',
        'aria-atomic': 'false',
        'aria-label': t('practice.interimLabel')
      }
    });
  }

  function setInterim(el, text) {
    if (!el) return;
    el.textContent = text === null || text === undefined ? '' : String(text);
  }

  /* ============================================================
   * 10. レベルメーターの DOM
   * ============================================================ */

  /**
   * @returns {Object} el(.level-meter) / set(level 0..1) / reset()
   */
  function levelMeterEl(id) {
    var bar = h('div', { 'class': 'level-meter__bar' });
    var el = h('div', {
      'class': 'level-meter',
      id: id || null,
      attrs: {
        role: 'meter',
        'aria-label': t('practice.levelLabel'),
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': '0'
      }
    }, bar);

    var lastPct = -1;
    function set(level) {
      var pct = Math.round(Math.max(0, Math.min(1, num(level, 0))) * 100);
      if (pct === lastPct) return;
      lastPct = pct;
      bar.style.width = pct + '%';
      el.style.setProperty('--level', pct + '%');
      /* 値の変化はアナウンスしない(仕様 §12-2)。role="meter" は live ではない。 */
      el.setAttribute('aria-valuenow', String(pct));
    }
    return { el: el, set: set, reset: function () { lastPct = -1; set(0); } };
  }

  /* ============================================================
   * 11. createLevelMeter(仕様 §5-15)
   *
   *   getUserMedia → AudioContext → AnalyserNode(fftSize:1024) → RMS。
   *   ★失敗しても例外を投げず reject もしない。available:false の no-op を返す。
   *     メーターが無くても練習は完全に成立するため、ここで止めない。
   *   ★stop() で rAF ループ・MediaStreamTrack・AudioContext を必ず全部閉じる。
   * ============================================================ */

  var QUIET_PEAK = 0.01;   /* 仕様: tooQuiet() は peak < 0.01 */
  var RMS_LO = 0.004;      /* この辺りから目盛りが動き出す */
  var RMS_HI = 0.20;
  var ONLEVEL_INTERVAL = 50;   /* onLevel は 20fps で十分。DOM 書き換えを減らす */
  var QUIET_MIN_FRAMES = 12;   /* 計測開始直後に「音が小さい」と誤判定しないための最低フレーム数 */

  function noopMeter(reason) {
    return {
      available: false,
      reason: reason || 'unavailable',
      stop: function () {},
      tooQuiet: function () { return false; },   /* 測れないときに警告を出さない */
      getLevel: function () { return 0; },
      resetPeak: function () {}
    };
  }

  /**
   * @param {function(number, Object)=} onLevel (level0to1, {rms, peak}) => void
   * @returns {Promise} 例外を投げず、必ず {stop, tooQuiet, available, ...} で resolve する
   */
  function createLevelMeter(onLevel) {
    return new Promise(function (resolve) {
      var nav = window.navigator;
      var Ctx = window.AudioContext || window.webkitAudioContext;

      if (!nav || !nav.mediaDevices || typeof nav.mediaDevices.getUserMedia !== 'function') {
        log('ui.meter.unavailable', { reason: 'no-getusermedia' });
        return resolve(noopMeter('no-getusermedia'));
      }
      if (!Ctx) {
        log('ui.meter.unavailable', { reason: 'no-audiocontext' });
        return resolve(noopMeter('no-audiocontext'));
      }

      var p;
      try {
        p = nav.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
      } catch (e) {
        log('ui.meter.error', { reason: 'getusermedia-throw', message: e && e.message });
        return resolve(noopMeter('getusermedia-throw'));
      }
      if (!p || typeof p.then !== 'function') return resolve(noopMeter('no-promise'));

      p.then(function (stream) {
        var meter;
        try { meter = startMeter(stream, Ctx, onLevel); }
        catch (e) {
          log('ui.meter.error', { reason: 'start-throw', message: e && e.message });
          try { stopTracks(stream); } catch (e2) { /* 何もできない */ }
          meter = noopMeter('start-failed');
        }
        resolve(meter);
      }, function (err) {
        var name = (err && err.name) || 'denied';
        log('ui.meter.denied', { name: name });
        resolve(noopMeter(name));
      });
    });
  }

  function stopTracks(stream) {
    if (!stream || typeof stream.getTracks !== 'function') return;
    var tracks = stream.getTracks();
    for (var i = 0; i < tracks.length; i++) {
      try { tracks[i].stop(); } catch (e) { /* 個々の失敗は無視して残りを止める */ }
    }
  }

  function startMeter(stream, Ctx, onLevel) {
    var ctx = new Ctx();
    var source = ctx.createMediaStreamSource(stream);
    var analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.2;
    /* ★ analyser を destination に繋がない。繋ぐとスピーカーに回り込んでハウリングする。 */
    source.connect(analyser);

    /* 一部の環境で AudioContext が suspended で生まれる(自動再生ポリシー)。
       失敗しても計測が 0 のままになるだけなので握り潰す。 */
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      var rp = ctx.resume();
      if (rp && typeof rp['catch'] === 'function') rp['catch'](function () {});
    }

    var useFloat = typeof analyser.getFloatTimeDomainData === 'function';
    var size = analyser.fftSize;
    var buf = useFloat ? new Float32Array(size) : new Uint8Array(size);

    var stopped = false;
    var raf = 0;
    var frames = 0;
    var maxPeak = 0;
    var level = 0;
    var lastEmit = 0;

    function measure() {
      var i, v, sum = 0, peak = 0;
      if (useFloat) {
        analyser.getFloatTimeDomainData(buf);
        for (i = 0; i < size; i++) {
          v = buf[i];
          sum += v * v;
          v = v < 0 ? -v : v;
          if (v > peak) peak = v;
        }
      } else {
        analyser.getByteTimeDomainData(buf);
        for (i = 0; i < size; i++) {
          v = (buf[i] - 128) / 128;
          sum += v * v;
          v = v < 0 ? -v : v;
          if (v > peak) peak = v;
        }
      }
      return { rms: Math.sqrt(sum / size), peak: peak };
    }

    function ramp(x, lo, hi) {
      var u = U();
      if (typeof u.ramp === 'function') return u.ramp(x, lo, hi);
      if (hi <= lo) return 0;
      var n = (x - lo) / (hi - lo);
      return n < 0 ? 0 : (n > 1 ? 1 : n);
    }

    function tick() {
      if (stopped) return;
      var m = measure();
      frames++;
      if (m.peak > maxPeak) maxPeak = m.peak;

      /* 立ち上がりは速く、下がりはゆっくり(バーがチカチカしない) */
      var target = ramp(m.rms, RMS_LO, RMS_HI);
      level = target > level ? target : (level * 0.85 + target * 0.15);

      var now = Date.now();
      if (typeof onLevel === 'function' && now - lastEmit >= ONLEVEL_INTERVAL) {
        lastEmit = now;
        safeCall(onLevel, [level, { rms: m.rms, peak: m.peak }], 'ui.onLevel.error');
      }
      if (!stopped) raf = requestAnimationFrame(tick);
    }

    function stop() {
      if (stopped) return;
      stopped = true;
      /* ★ rAF ループを確実に止める。止め忘れがタブを重くする最大の原因。 */
      if (raf) { try { cancelAnimationFrame(raf); } catch (e) { /* 無視 */ } raf = 0; }
      window.removeEventListener('pagehide', stop);
      document.removeEventListener('visibilitychange', onVisibility);
      safeCall(onLevel, [0, { rms: 0, peak: 0 }], 'ui.onLevel.error');
      try { source.disconnect(); } catch (e) { /* 無視 */ }
      try { analyser.disconnect(); } catch (e) { /* 無視 */ }
      stopTracks(stream);
      try {
        if (ctx.state !== 'closed' && typeof ctx.close === 'function') {
          var q = ctx.close();
          if (q && typeof q['catch'] === 'function') q['catch'](function () {});
        }
      } catch (e) { /* 無視 */ }
      buf = null;
      log('ui.meter.stop', { frames: frames, maxPeak: Math.round(maxPeak * 1000) / 1000 });
    }

    /* タブが隠れたらマイクを掴んだままにしない(録音インジケータが点きっぱなしになる)。
       戻ってきたら画面側が作り直す。 */
    function onVisibility() { if (document.hidden) stop(); }

    window.addEventListener('pagehide', stop);
    document.addEventListener('visibilitychange', onVisibility);

    raf = requestAnimationFrame(tick);

    return {
      available: true,
      reason: null,
      stop: stop,
      /* 仕様: peak < 0.01。ただし計測開始直後は判定しない(必ず true になってしまうため)。 */
      tooQuiet: function () { return frames >= QUIET_MIN_FRAMES && maxPeak < QUIET_PEAK; },
      getLevel: function () { return level; },
      resetPeak: function () { maxPeak = 0; frames = 0; }
    };
  }

  /* ============================================================
   * 公開
   * ============================================================ */

  LC.ui = {
    /* 仕様 §5-15 */
    renderResult: renderResult,
    buildTextSummary: buildTextSummary,
    errorPanel: errorPanel,
    createLevelMeter: createLevelMeter,
    bandBadge: bandBadge,
    progressDots: progressDots,
    renderBanner: renderBanner,
    /* 追加(仕様の範囲内の補助部品) */
    attemptDots: attemptDots,
    summaryText: summaryText,
    actionButton: actionButton,
    levelMeterEl: levelMeterEl,
    interimEl: interimEl,
    setInterim: setInterim,
    wordSpan: wordSpan
  };

  LC.__loaded = (LC.__loaded || []).concat('ui');
})(window.LC);

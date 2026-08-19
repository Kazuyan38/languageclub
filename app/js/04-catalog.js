/* js/04-catalog.js — 教材カタログ(LC.catalog)と学習記録(LC.tracker)
 * =====================================================================
 * 仕様 §5-6(catalog)/ §5-11(tracker)/ §7-8(貼り付け仕様)/ §11(localStorage スキーマ)
 *
 * ■ このファイルの立ち位置
 *   ・DOM に一切触らない。したがって test/test.html から素で呼べる。
 *   ・localStorage を直接触らない。読み書きは必ず LC.store 経由(不変ルール 4)。
 *   ・公開関数は例外を投げない。壊れた入力は「除外して残りを返す」で吸収する。
 *
 * ■ 依存(読み込み順で必ず先に居る)
 *   LC.util / LC.msg(01-util.js)、LC.store / LC.settings(02-store.js)、
 *   LC.DECKS_RAW(data/decks.js)、LC.normalize / LC.similarity / LC.score(03-text.js)
 *
 * ■ 設計上いちばん大事なこと(仕様リスク R8)
 *   教材データのタイポで **アプリ全体が落ちてはいけない**。
 *   validateDeck() を 1 デッキずつ回し、落ちたデッキだけを除外して
 *   エラーを getLoadErrors() に溜める。新歓ブースで白画面を出さないための要。
 *
 * ■ 言葉の規律(仕様 §0-1)
 *   「発音採点」「不合格」は使わない。ここで扱うのは「機械に伝わったか」の統計。
 * =====================================================================
 */
window.LC = window.LC || {};
(function (LC) {
  'use strict';

  /* --- 依存の取り込み。欠けていても即死しないように空オブジェクトで受ける --- */
  var util = LC.util || {};
  var msg = LC.msg || {};
  var store = LC.store || {};
  var normalize = LC.normalize || {};
  var similarity = LC.similarity || {};

  var hasOwn = Object.prototype.hasOwnProperty;
  function own(o, k) { return !!o && hasOwn.call(o, k); }

  /** 例外を絶対に外へ出さない診断ログ。 */
  function log(tag, obj) {
    try { if (typeof util.log === 'function') util.log(tag, obj); } catch (e) { /* 握り潰す */ }
  }

  /** 文言。LC.msg が無い環境でもキー文字列が返るだけで落ちない。 */
  function t(key, vars) {
    try { return (typeof msg.t === 'function') ? msg.t(key, vars) : String(key); }
    catch (e) { return String(key); }
  }

  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : 0; }

  function isNonEmptyString(v) { return typeof v === 'string' && v.trim() !== ''; }

  /**
   * オブジェクトのキーとして安全か。
   * wordstats / heard は「認識器が返した文字列」をキーにするので、
   * __proto__ などがそのまま入るとプロトタイプを壊しうる。念のため弾く。
   */
  function isSafeKey(k) {
    return typeof k === 'string' && k !== '' &&
      k !== '__proto__' && k !== 'prototype' && k !== 'constructor';
  }

  /** JSON 経由の素朴な複製。store の参照をそのまま外へ出さないために使う。 */
  function clone(v) {
    try { return (v === undefined) ? v : JSON.parse(JSON.stringify(v)); }
    catch (e) { return null; }
  }

  /**
   * LC.store.stores から 1 つ取り出す。
   * 万一 02-store.js が読めていなくても、公開関数が落ちないように no-op を返す。
   */
  var NULL_STORE = {
    get: function () { return null; },
    set: function () { return false; },
    update: function () { return false; },
    setDebounced: function () { return false; },
    updateDebounced: function () { return false; },
    flush: function () { return false; },
    reset: function () { return false; }
  };
  function st(name) {
    var s = store.stores && store.stores[name];
    return s || NULL_STORE;
  }

  /** 体験モードか。自作デッキの保存だけは「保存できません」と正直に伝えたい。 */
  function isDemo() {
    try { return (typeof store.isDemoMode === 'function') ? !!store.isDemoMode() : false; }
    catch (e) { return false; }
  }


  /* =====================================================================
   * 1. LC.catalog — 教材カタログ(仕様 §5-6 / §7-8)
   * ===================================================================== */

  /* 苦手音の集計に使う既定 7 タグ(仕様 §5-6)。
   * ★勝手に増やさないこと★ 増やすと focusSummary の集計が意味を失う。 */
  var FOCUS_TAGS = ['th', 'r-l', 'v-b', 'f-h', 'vowel-length', 'ending-vowel', 'linking'];

  var FOCUS_TAG_SET = (function () {
    var m = Object.create(null);
    for (var i = 0; i < FOCUS_TAGS.length; i++) m[FOCUS_TAGS[i]] = true;
    return m;
  })();

  /* タグ → きろく画面に出す短いラベル(仕様 §7-5 の「苦手な音: th (2語) / R・L (1語)」)。
   * LC.msg 側に 'focus.<tag>' が定義されていればそちらを優先する
   * (文言を 01-util.js に集約したくなったときに、このファイルを触らずに移せるように)。 */
  var FOCUS_LABELS = {
    'th': 'th',
    'r-l': 'R・L',
    'v-b': 'V・B',
    'f-h': 'F・H',
    'vowel-length': '長母音',
    'ending-vowel': '語末の母音',
    'linking': '音のつながり'
  };
  function focusLabel(tag) {
    try {
      if (typeof msg.has === 'function' && msg.has('focus.' + tag)) return t('focus.' + tag);
    } catch (e) { /* 握り潰す */ }
    return FOCUS_LABELS[tag] || tag;
  }

  /* デッキ検証のエラー文言。
   * これは「ユーザー向けの案内」ではなく「教材を書いた部員向けの診断」なので、
   * 画面文言(LC.msg)ではなくこのファイル内の定数に置く(担当ルール 9 の但し書き)。
   * 診断画面(§7-7)の「読み込めなかった教材」にそのまま並ぶ。 */
  var VMSG = {
    notObject: 'デッキの書き方が壊れています(オブジェクトではありません)',
    id: 'id が空です。半角英数字の名前を付けてください',
    title: 'title(画面に出る見出し)が空です',
    icon: 'icon(絵文字)が空です',
    phrasesArray: 'phrases が配列ではありません',
    phrasesEmpty: 'phrases が 1 件もありません',
    phraseNotObject: '%{i} 番目のフレーズの書き方が壊れています',
    phraseId: '%{i} 番目のフレーズに id がありません',
    phraseIdDup: 'フレーズ id が重複しています: %{id}',
    phraseText: 'フレーズ %{id} の text(英文)が空です',
    phraseNoToken: 'フレーズ %{id} の text を英文として読み取れませんでした',
    phraseAccept: 'フレーズ %{id} の accept は文字列の配列にしてください',
    phraseFocus: 'フレーズ %{id} の focus に使えないタグがあります: %{tag}',
    noValidPhrase: '読み取れるフレーズが 1 つもありませんでした',
    dupDeckId: 'デッキ id が重複しているため読み込みませんでした: %{id}',
    tooManyLines: '%{max} 行までしか読み込めないため、%{total} 行のうち後ろを読み飛ばしました',
    tooManyPhrases: '1 カテゴリは %{max} フレーズまでです。超えた分は読み飛ばしました'
  };

  /** '%{x}' を差し替えるだけの極小テンプレート(LC.msg に依存させないため)。 */
  function fill(tpl, vars) {
    if (!vars) return tpl;
    return String(tpl).replace(/%\{(\w+)\}/g, function (whole, name) {
      var v = vars[name];
      return (v === undefined || v === null) ? whole : String(v);
    });
  }

  /** 文字列配列だけを取り出す(数値や null が混ざっていても落とさない)。 */
  function stringArray(v) {
    var out = [], i;
    if (typeof v === 'string') return v.trim() ? [v] : [];
    if (!Array.isArray(v)) return out;
    for (i = 0; i < v.length; i++) if (isNonEmptyString(v[i])) out.push(v[i]);
    return out;
  }

  /** 正規化後のトークン数。0 なら「英文として読み取れない」。 */
  function tokenCount(text) {
    try {
      if (typeof normalize.tokenize !== 'function') return isNonEmptyString(text) ? 1 : 0;
      var r = normalize.tokenize(text);
      return (r && r.tokens) ? r.tokens.length : 0;
    } catch (e) { return 0; }
  }

  /**
   * デッキ 1 件を検証して、正規化済みの複製を返す。★純関数(テスト対象)★
   *
   * 検証項目(仕様 §5-6):
   *   id / title / icon が非空文字列 / phrases が 1 件以上 /
   *   各 phrase.id が一意 / text が非空かつ正規化後トークンが 1 語以上 /
   *   accept が文字列配列 / focus が既定 7 タグの部分集合
   *
   * 壊れたフレーズは「その 1 件だけ落として残りを生かす」。
   * 1 行のタイポでカテゴリごと消えるほうが被害が大きいため(R8)。
   * ただし読めるフレーズが 0 件になったらデッキごと不採用にする。
   *
   * @param {*} raw 検証対象(何が来てもよい)
   * @returns {Object} ok / deck(正規化済みの新しいオブジェクト or null)/ errors(文字列配列)
   */
  function validateDeck(raw) {
    var errors = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, deck: null, errors: [VMSG.notObject] };
    }

    var id = isNonEmptyString(raw.id) ? raw.id.trim() : '';
    var title = isNonEmptyString(raw.title) ? raw.title.trim() : '';
    var icon = isNonEmptyString(raw.icon) ? raw.icon.trim() : '';
    if (!id) errors.push(VMSG.id);
    if (!title) errors.push(VMSG.title);
    if (!icon) errors.push(VMSG.icon);

    if (!Array.isArray(raw.phrases)) {
      errors.push(VMSG.phrasesArray);
      return { ok: false, deck: null, errors: errors };
    }
    if (raw.phrases.length === 0) {
      errors.push(VMSG.phrasesEmpty);
      return { ok: false, deck: null, errors: errors };
    }

    var seenIds = Object.create(null);
    var phrases = [];
    for (var i = 0; i < raw.phrases.length; i++) {
      var p = raw.phrases[i];
      var label = String(i + 1);

      if (!p || typeof p !== 'object' || Array.isArray(p)) {
        errors.push(fill(VMSG.phraseNotObject, { i: label }));
        continue;
      }
      var pid = isNonEmptyString(p.id) ? p.id.trim() : '';
      if (!pid) { errors.push(fill(VMSG.phraseId, { i: label })); continue; }
      if (seenIds[pid]) { errors.push(fill(VMSG.phraseIdDup, { id: pid })); continue; }

      var text = isNonEmptyString(p.text) ? p.text.trim() : '';
      if (!text) { errors.push(fill(VMSG.phraseText, { id: pid })); continue; }
      if (tokenCount(text) < 1) { errors.push(fill(VMSG.phraseNoToken, { id: pid })); continue; }

      /* accept は「通じ方が同じ言い換え」。配列以外は警告して空扱いにする
       * (ここでフレーズごと落とすと、教材の 1 文字ミスで練習できなくなるため)。 */
      var accept = stringArray(p.accept);
      if (own(p, 'accept') && !Array.isArray(p.accept) && typeof p.accept !== 'string') {
        errors.push(fill(VMSG.phraseAccept, { id: pid }));
      }

      /* focus は既定 7 タグの部分集合。未知タグは落として報告する
       * (未知タグを通すと苦手音の集計が静かに狂う)。 */
      var focus = [], bad = [];
      var rawFocus = Array.isArray(p.focus) ? p.focus : (typeof p.focus === 'string' ? [p.focus] : []);
      for (var f = 0; f < rawFocus.length; f++) {
        var tag = (typeof rawFocus[f] === 'string') ? rawFocus[f].trim() : '';
        if (!tag) continue;
        if (FOCUS_TAG_SET[tag]) { if (focus.indexOf(tag) < 0) focus.push(tag); }
        else bad.push(tag);
      }
      if (bad.length) errors.push(fill(VMSG.phraseFocus, { id: pid, tag: bad.join(' / ') }));

      seenIds[pid] = true;
      phrases.push({
        id: pid,
        text: text,
        accept: accept,
        ja: isNonEmptyString(p.ja) ? p.ja.trim() : '',
        note: isNonEmptyString(p.note) ? p.note.trim() : '',
        focus: focus
      });
    }

    if (!phrases.length) {
      errors.push(VMSG.noValidPhrase);
      return { ok: false, deck: null, errors: errors };
    }
    if (!id || !title || !icon) {
      return { ok: false, deck: null, errors: errors };
    }

    var level = (raw.level === 1 || raw.level === 2 || raw.level === 3) ? raw.level : 1;
    var order = (typeof raw.order === 'number' && isFinite(raw.order)) ? raw.order : null;

    return {
      ok: true,
      errors: errors,   /* ok でも「落としたフレーズ」の報告が入りうる */
      deck: {
        id: id,
        title: title,
        subtitle: isNonEmptyString(raw.subtitle) ? raw.subtitle.trim() : '',
        icon: icon,
        level: level,
        order: order,           /* null なら getDecks 側で並び順を補う */
        phrases: phrases,
        custom: raw.custom === true
      }
    };
  }


  /* --- デッキ一覧の構築 -------------------------------------------------- */

  var deckCache = null;        /* 検証済みデッキの配列(order 昇順) */
  var loadErrors = [];         /* [{deckId, errors:[]}] */
  var focusIndexCache = null;  /* 正規化語 → focus タグ集合 */

  /** 自作デッキを足したり消したりしたら必ず呼ぶ。 */
  function invalidate() {
    deckCache = null;
    focusIndexCache = null;
  }

  /** 生の自作デッキ配列(store の中身)。壊れていても配列を返す。 */
  function rawCustomDecks() {
    var v = st('customdecks').get();
    return Array.isArray(v) ? v : [];
  }

  /**
   * 教材(data/decks.js)+ 自作デッキを検証して order 順に並べる。
   * ★ 1 デッキの失敗で全体が落ちないこと ★ が最優先(R8)。
   */
  function build() {
    var decks = [], errs = [], seen = Object.create(null);
    var builtin = Array.isArray(LC.DECKS_RAW) ? LC.DECKS_RAW : [];
    var customs = rawCustomDecks();
    var seq = 0;

    function take(raw, index, isCustom) {
      var res;
      try {
        res = validateDeck(raw);
      } catch (e) {
        /* validateDeck は投げない設計だが、想定外でもここで止める */
        res = { ok: false, deck: null, errors: ['検証中にエラーが起きました: ' + String(e)] };
      }
      var did = (raw && isNonEmptyString(raw.id)) ? raw.id.trim()
        : ((isCustom ? 'custom#' : 'deck#') + (index + 1));
      if (res.errors && res.errors.length) errs.push({ deckId: did, errors: res.errors.slice() });
      if (!res.ok || !res.deck) return;

      if (seen[res.deck.id]) {
        errs.push({ deckId: res.deck.id, errors: [fill(VMSG.dupDeckId, { id: res.deck.id })] });
        return;
      }
      seen[res.deck.id] = true;
      res.deck.custom = !!isCustom;
      /* order が無いときの既定。自作デッキは既定の教材より必ず後ろに並べる。 */
      if (res.deck.order === null) res.deck.order = (isCustom ? 1000 : 100) + index;
      res.deck.__seq = seq++;   /* 同一 order のときの安定ソート用 */
      decks.push(res.deck);
    }

    for (var i = 0; i < builtin.length; i++) take(builtin[i], i, false);
    for (var j = 0; j < customs.length; j++) take(customs[j], j, true);

    decks.sort(function (a, b) {
      if (a.order !== b.order) return a.order - b.order;
      return a.__seq - b.__seq;
    });
    for (var k = 0; k < decks.length; k++) delete decks[k].__seq;

    loadErrors = errs;
    if (errs.length) log('catalog.loadErrors', { count: errs.length });
    return decks;
  }

  /** 検証を通ったデッキだけを order 順で返す。返る配列は内部キャッシュそのもの。 */
  function getDecks() {
    try {
      if (!deckCache) deckCache = build();
      return deckCache;
    } catch (e) {
      log('catalog.getDecks.error', { error: String(e) });
      return [];
    }
  }

  function getDeck(deckId) {
    try {
      var list = getDecks(), id = String(deckId == null ? '' : deckId);
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    } catch (e) { return null; }
  }

  function getPhrase(deckId, phraseId) {
    try {
      var d = getDeck(deckId);
      if (!d) return null;
      var id = String(phraseId == null ? '' : phraseId);
      for (var i = 0; i < d.phrases.length; i++) if (d.phrases[i].id === id) return d.phrases[i];
      return null;
    } catch (e) { return null; }
  }

  /** 診断画面(§7-7)がそのまま並べる。呼ぶ前に getDecks() を一度通す。 */
  function getLoadErrors() {
    try {
      getDecks();
      return loadErrors.slice();
    } catch (e) { return []; }
  }


  /* --- 貼り付けによる自作デッキ(仕様 §7-8)------------------------------ */

  var MAX_PASTE_LINES = 400;     /* 事故で小説を貼られても固まらないための安全弁 */
  var MAX_PHRASE_WORDS = 20;     /* これを超えたら警告(受け入れはする) */
  var MAX_CUSTOM_DECKS = 50;
  var MAX_CUSTOM_PHRASES = 200;

  /**
   * 行エラー。JSON 直列化すると {line, message} になり、
   * String() すると「3 行目: 英文がありません」になる。
   * 画面側が LC.msg.UI.decks.errorLine で組み立てても、そのまま並べても壊れないようにするため。
   */
  function LineError(line, message) {
    this.line = line;
    this.message = message;
  }
  LineError.prototype.toString = function () {
    return (this.line > 0) ? (this.line + ' 行目: ' + this.message) : this.message;
  };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** 「自作 1」「自作 2」… の連番(§7-8)。既存の自作デッキ数から決める。 */
  function defaultCustomTitle() {
    return '自作 ' + (rawCustomDecks().length + 1);
  }

  /**
   * 貼り付けテキストを 1 デッキに変換する(仕様 §7-8)。
   *   ・先頭が # / ＃ の行 → デッキ名(最初の 1 つだけ採用)
   *   ・`英文 | 和訳`(全角 ｜ も可)。和訳は無くてもよい
   *   ・空行と // 始まりは無視
   *   ・英文が空 / 正規化後 0 トークンの行は行番号つきでエラー
   *   ・20 語超は警告して受け入れる(「長すぎると 1 回で言い切れません」)
   *   ・id は custom-<timestamp> / custom-<timestamp>-01
   *
   * @param {string} text
   * @returns {Object} ok / deck / errors(LineError の配列)/ warnings(同左)
   */
  function parsePasted(text) {
    var errors = [], warnings = [], phrases = [];
    try {
      var src = (text == null) ? '' : String(text);
      var lines = src.split(/\r\n|\r|\n/);
      /* ★黙って捨てない。捨てたことを必ず errors に載せる。
         「追加しました」とだけ出て 401 行目以降が消えていると、原因の分からない事故になる。 */
      if (lines.length > MAX_PASTE_LINES) {
        errors.push(fill(VMSG.tooManyLines, { max: MAX_PASTE_LINES, total: lines.length }));
        lines = lines.slice(0, MAX_PASTE_LINES);
      }

      var deckId = 'custom-' + Date.now();
      var title = '';
      var cappedReported = false;

      for (var i = 0; i < lines.length; i++) {
        var lineNo = i + 1;
        /* trim() は全角スペース(U+3000)と BOM(U+FEFF)も落とす仕様なので、
         * メモ帳や LINE からの貼り付けでもこれ 1 つで足りる。
         * ★行の途中の全角スペースは触らない★(和訳の見た目を勝手に変えないため)。 */
        var line = String(lines[i]).trim();
        if (line === '') continue;
        if (line.indexOf('//') === 0) continue;

        if (line.charAt(0) === '#' || line.charAt(0) === '＃') {
          var name = line.replace(/^[#＃]+\s*/, '').trim();
          if (!title && name) title = name;   /* 2 つめ以降の # 行は無視する */
          continue;
        }

        /* 区切りは半角 | と全角 ｜ の両方。和訳の中に | が入っていても壊れないよう、
         * 最初の 1 つで割って残りは和訳に戻す。 */
        var cut = line.search(/[|｜]/);
        var en = (cut < 0) ? line : line.slice(0, cut);
        var ja = (cut < 0) ? '' : line.slice(cut + 1);
        en = en.trim();
        ja = ja.trim();

        if (!en) { errors.push(new LineError(lineNo, t('decks.errEmptyText'))); continue; }

        var n = tokenCount(en);
        if (n < 1) { errors.push(new LineError(lineNo, t('decks.errNoToken'))); continue; }
        if (n > MAX_PHRASE_WORDS) {
          warnings.push(new LineError(lineNo, t('decks.warnLong', { n: n })));
        }
        if (phrases.length >= MAX_CUSTOM_PHRASES) {
          /* 上限に達した最初の 1 回だけ報告する(行ごとに出すと画面が埋まる)。 */
          if (!cappedReported) {
            cappedReported = true;
            errors.push(fill(VMSG.tooManyPhrases, { max: MAX_CUSTOM_PHRASES }));
          }
          continue;
        }

        phrases.push({
          id: deckId + '-' + pad2(phrases.length + 1),
          text: en,
          accept: [],
          ja: ja,
          note: '',
          focus: []
        });
      }

      if (!phrases.length) {
        errors.push(new LineError(0, t('decks.errNoPhrase')));
        return { ok: false, deck: null, errors: errors, warnings: warnings };
      }

      var candidate = {
        id: deckId,
        title: title || defaultCustomTitle(),
        subtitle: '',
        icon: '✏',            /* ✏ 自作の目印 */
        level: 1,
        order: 1000 + rawCustomDecks().length,
        phrases: phrases,
        custom: true
      };

      /* 生成物も必ず同じ検証を通す。手で作った道と貼り付けの道で
       * 別々の品質基準を持たせない(片方だけ壊れるバグを防ぐ)。 */
      var res = validateDeck(candidate);
      for (var e = 0; e < res.errors.length; e++) errors.push(new LineError(0, res.errors[e]));
      if (!res.ok) return { ok: false, deck: null, errors: errors, warnings: warnings };

      res.deck.custom = true;
      res.deck.order = candidate.order;
      return { ok: true, deck: res.deck, errors: errors, warnings: warnings };

    } catch (ex) {
      log('catalog.parsePasted.error', { error: String(ex) });
      errors.push(new LineError(0, t('decks.addFailed')));
      return { ok: false, deck: null, errors: errors, warnings: warnings };
    }
  }


  /* --- 自作デッキの保存・書き出し・読み込み ------------------------------ */

  /** 保存済みの自作デッキ(検証済み)。管理画面(§7-8)の一覧用。 */
  function getCustomDecks() {
    try {
      var list = getDecks(), out = [];
      for (var i = 0; i < list.length; i++) if (list[i].custom) out.push(list[i]);
      return out;
    } catch (e) { return []; }
  }

  /**
   * 自作デッキを保存(同じ id があれば差し替え)。
   * @returns {Object} ok / deck / errors(文字列配列)
   */
  function saveCustomDeck(deck) {
    try {
      if (isDemo()) return { ok: false, deck: null, errors: [t('decks.demoBlocked')] };

      var res = validateDeck(deck);
      if (!res.ok) return { ok: false, deck: null, errors: res.errors };
      res.deck.custom = true;

      var arr = rawCustomDecks().slice();
      var replaced = false;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].id === res.deck.id) { arr[i] = res.deck; replaced = true; break; }
      }
      if (!replaced) {
        if (arr.length >= MAX_CUSTOM_DECKS) {
          return { ok: false, deck: null, errors: [t('decks.addFailed')] };
        }
        if (res.deck.order === null) res.deck.order = 1000 + arr.length;
        arr.push(res.deck);
      }

      st('customdecks').set(arr);
      invalidate();
      log('catalog.saveCustomDeck', { id: res.deck.id, phrases: res.deck.phrases.length });
      return { ok: true, deck: res.deck, errors: res.errors };
    } catch (e) {
      log('catalog.saveCustomDeck.error', { error: String(e) });
      return { ok: false, deck: null, errors: [t('decks.addFailed')] };
    }
  }

  /** 自作デッキを消す。存在しなければ false。 */
  function deleteCustomDeck(id) {
    try {
      if (isDemo()) return false;
      var target = String(id == null ? '' : id);
      var arr = rawCustomDecks(), out = [], removed = false;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].id === target) { removed = true; continue; }
        out.push(arr[i]);
      }
      if (!removed) return false;
      st('customdecks').set(out);
      invalidate();
      log('catalog.deleteCustomDeck', { id: target });
      return true;
    } catch (e) { return false; }
  }

  /* 書き出しの封筒。読み込み側でアプリ違いのテキストを弾くために付ける。 */
  var EXPORT_APP = 'tsutawaru-english';
  var EXPORT_KIND = 'customdecks';

  /** LINE などで共有できる 1 本の JSON 文字列。失敗しても必ず文字列を返す。 */
  function exportCustomDecks() {
    try {
      var list = getCustomDecks(), out = [];
      for (var i = 0; i < list.length; i++) {
        out.push({
          id: list[i].id, title: list[i].title, subtitle: list[i].subtitle,
          icon: list[i].icon, level: list[i].level, order: list[i].order,
          phrases: clone(list[i].phrases) || []
        });
      }
      return JSON.stringify({
        app: EXPORT_APP, kind: EXPORT_KIND, v: 1, at: Date.now(), decks: out
      });
    } catch (e) {
      log('catalog.export.error', { error: String(e) });
      return JSON.stringify({ app: EXPORT_APP, kind: EXPORT_KIND, v: 1, at: 0, decks: [] });
    }
  }

  /**
   * 書き出したテキストを読み込む。既存 id と衝突したら別 id を振って両方残す
   * (人の作ったカテゴリを黙って上書きしないため)。
   * @returns {Object} ok / added(件数)/ errors(文字列配列)
   */
  function importCustomDecks(json) {
    var errors = [];
    try {
      if (isDemo()) return { ok: false, added: 0, errors: [t('decks.demoBlocked')] };

      var parsed = null;
      try { parsed = JSON.parse(String(json == null ? '' : json)); }
      catch (e) { return { ok: false, added: 0, errors: [t('decks.importFailed')] }; }

      var incoming = null;
      if (Array.isArray(parsed)) incoming = parsed;
      else if (parsed && Array.isArray(parsed.decks)) incoming = parsed.decks;
      if (!incoming) return { ok: false, added: 0, errors: [t('decks.importFailed')] };

      var arr = rawCustomDecks().slice();
      var used = Object.create(null), i;
      var all = getDecks();
      for (i = 0; i < all.length; i++) used[all[i].id] = true;
      for (i = 0; i < arr.length; i++) if (arr[i] && arr[i].id) used[arr[i].id] = true;

      var added = 0;
      for (i = 0; i < incoming.length; i++) {
        if (arr.length >= MAX_CUSTOM_DECKS) { errors.push(t('decks.addFailed')); break; }
        var res = validateDeck(incoming[i]);
        if (!res.ok) {
          for (var e = 0; e < res.errors.length; e++) errors.push(res.errors[e]);
          continue;
        }
        var newId = res.deck.id, suffix = 2;
        while (used[newId]) { newId = res.deck.id + '-' + suffix; suffix++; }
        if (newId !== res.deck.id) {
          /* フレーズ id も付け替える。デッキ内で一意でありさえすればよい。 */
          for (var p = 0; p < res.deck.phrases.length; p++) {
            res.deck.phrases[p].id = newId + '-' + pad2(p + 1);
          }
          res.deck.id = newId;
        }
        used[newId] = true;
        res.deck.custom = true;
        if (res.deck.order === null) res.deck.order = 1000 + arr.length;
        arr.push(res.deck);
        added++;
      }

      if (added > 0) {
        st('customdecks').set(arr);
        invalidate();
      }
      log('catalog.import', { added: added, errors: errors.length });
      return { ok: added > 0, added: added, errors: errors };
    } catch (ex) {
      log('catalog.import.error', { error: String(ex) });
      return { ok: false, added: 0, errors: [t('decks.importFailed')] };
    }
  }


  LC.catalog = {
    FOCUS_TAGS: FOCUS_TAGS,
    FOCUS_LABELS: FOCUS_LABELS,
    focusLabel: focusLabel,
    validateDeck: validateDeck,
    getDecks: getDecks,
    getDeck: getDeck,
    getPhrase: getPhrase,
    getLoadErrors: getLoadErrors,
    parsePasted: parsePasted,
    getCustomDecks: getCustomDecks,
    saveCustomDeck: saveCustomDeck,
    deleteCustomDeck: deleteCustomDeck,
    exportCustomDecks: exportCustomDecks,
    importCustomDecks: importCustomDecks,
    refresh: invalidate
  };


  /* =====================================================================
   * 2. LC.tracker — 進捗・苦手語・セッション履歴(仕様 §5-11 / §11)
   * ===================================================================== */

  var MAX_WORDSTATS = 500;      /* 仕様 §11-1: 語ごとの統計は 500 語まで */
  var MAX_SESSIONS = 200;       /* 仕様 §11-1: セッション履歴は最新 200 件 */
  var MAX_HEARD_PER_WORD = 6;   /* 誤認識先は上位数件で十分(容量の暴走を防ぐ) */
  var MAX_RUN = 20;             /* 1 フレーズの連続試行を数える上限 */
  var RECENT_WORD_DAYS = 30;    /* 語統計の上限で「最近さわった語」とみなす日数 */
  var STREAK_LIMIT = 3650;      /* 連続日数の走査上限(無限ループ防止) */

  /* --- 一時状態(直列化しない。仕様 §6-1 の「一時状態」層)--------------- */
  var current = null;      /* 進行中のセッション記録 */
  var seenPhrases = null;  /* このセッションで触ったフレーズ id */
  var scoreSum = 0;        /* avgScore の計算用 */
  var runs = Object.create(null);  /* 'deckId\0phraseId' → 直近の点数の並び */

  function passThreshold() {
    return (LC.score && typeof LC.score.PASS_THRESHOLD === 'number') ? LC.score.PASS_THRESHOLD : 80;
  }

  function epochDay(ms) {
    try {
      if (typeof util.epochDay === 'function') return util.epochDay(ms);
    } catch (e) { /* 握り潰す */ }
    var d = (ms === undefined || ms === null) ? new Date() : new Date(ms);
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  }

  /** 記録を保存してよいか。体験モードは store 側で no-op になるのでここでは見ない。 */
  function saveRecordsOn() {
    try {
      var s = (LC.settings && typeof LC.settings.get === 'function') ? LC.settings.get() : null;
      return !s || s.saveRecords !== false;
    } catch (e) { return true; }
  }


  /* --- 語ごとの統計(wordstats)------------------------------------------ */

  /** 誤認識先が増えすぎたら回数の少ないものから捨てる。 */
  /** 1 フレーズあたりの試行ウィンドウ。採点側の MAX_ATTEMPTS(既定 3)に合わせる。 */
  function attemptWindow() {
    var n = (LC.score && typeof LC.score.MAX_ATTEMPTS === 'number') ? LC.score.MAX_ATTEMPTS : 3;
    return (isFinite(n) && n >= 1) ? n : 3;
  }

  function capHeard(rec) {
    var keys = [], k;
    for (k in rec.h) if (own(rec.h, k)) keys.push(k);
    if (keys.length <= MAX_HEARD_PER_WORD) return;
    keys.sort(function (x, y) { return num(rec.h[y]) - num(rec.h[x]); });
    var next = {};
    for (var i = 0; i < MAX_HEARD_PER_WORD; i++) next[keys[i]] = rec.h[keys[i]];
    rec.h = next;
  }

  /**
   * 500 語を超えたら切る。
   * ★attempts 降順だけで切ると、上限に達した時点で「今日はじめて練習した語」(a=1)が
   *   毎回いちばん下に来て即座に捨てられ、以後どれだけ練習しても新しい語が一切記録されない
   *   =苦手語ランキングが古い語のまま永久に凍結する。
   *   そこで「最近さわった語」を先に守り、そのうえで attempts 降順にする。
   *   t は epochDay(1970-01-01 起点の日数)。
   */
  function capWordStats(data) {
    var keys = [], k;
    for (k in data) if (own(data, k)) keys.push(k);
    if (keys.length <= MAX_WORDSTATS) return data;

    var today = epochDay();
    function recent(w) {
      var t = num(data[w] && data[w].t);
      return (today - t) <= RECENT_WORD_DAYS ? 1 : 0;
    }
    keys.sort(function (x, y) {
      var rd = recent(y) - recent(x);              /* 最近さわった語を先に残す */
      if (rd !== 0) return rd;
      return num(data[y] && data[y].a) - num(data[x] && data[x].a);
    });
    var next = {};
    for (var i = 0; i < MAX_WORDSTATS; i++) next[keys[i]] = data[keys[i]];
    log('tracker.wordstats.capped', { from: keys.length, to: MAX_WORDSTATS });
    return next;
  }

  /**
   * 採点結果の ops から語ごとの通過率を更新する。
   * 「機械に伝わったか」の集計であって発音の採点ではない(§0-1)。
   */
  function updateWordStats(result) {
    var ops = (result && Array.isArray(result.ops)) ? result.ops : [];
    if (!ops.length) return;

    var s = st('wordstats');
    var data = s.get();
    if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};

    var day = epochDay();
    var touched = false;

    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (!op || op.type === 'insertion') continue;      /* 挿入語はお手本に無いので数えない */
      var w = (typeof op.ref === 'string') ? op.ref : '';
      if (!isSafeKey(w)) continue;

      var rec = data[w];
      if (!rec || typeof rec !== 'object') { rec = { a: 0, g: 0, h: {}, t: day }; data[w] = rec; }
      if (typeof rec.a !== 'number' || !isFinite(rec.a)) rec.a = 0;
      if (typeof rec.g !== 'number' || !isFinite(rec.g)) rec.g = 0;
      if (!rec.h || typeof rec.h !== 'object' || Array.isArray(rec.h)) rec.h = {};

      rec.a += 1;
      if (op.type === 'correct' || op.type === 'homophone') {
        rec.g += 1;                                       /* 同音異義語は「伝わった」扱い */
      } else if (op.type === 'substitution') {
        var heard = (typeof op.hyp === 'string') ? op.hyp : '';
        if (isSafeKey(heard) && heard !== w) {
          rec.h[heard] = num(rec.h[heard]) + 1;
          capHeard(rec);
        }
      }
      rec.t = day;
      touched = true;
    }

    if (!touched) return;
    data = capWordStats(data);
    s.setDebounced(data);        /* §11-3: 1 試行ごとに 400ms デバウンス */
  }


  /* --- デッキ・フレーズごとの進捗(progress)------------------------------ */

  function readProgress() {
    var data = st('progress').get();
    if (!data || typeof data !== 'object' || Array.isArray(data)) data = { decks: {} };
    if (!data.decks || typeof data.decks !== 'object' || Array.isArray(data.decks)) data.decks = {};
    return data;
  }

  function deckEntry(data, deckId) {
    var key = String(deckId == null ? '' : deckId);
    if (!isSafeKey(key)) return null;
    var dp = data.decks[key];
    if (!dp || typeof dp !== 'object' || Array.isArray(dp)) {
      dp = { phrases: {}, completedAt: null, lastIndex: 0 };
      data.decks[key] = dp;
    }
    if (!dp.phrases || typeof dp.phrases !== 'object' || Array.isArray(dp.phrases)) dp.phrases = {};
    return dp;
  }

  /**
   * 進捗を更新する。
   * クリア判定は §5-10 の通じ率方式(3 回中 2 回で cleared)。
   * 「連続した試行の並び」は練習中だけの一時状態なのでメモリに持つ
   * (localStorage のデータ形 §11-2 を増やさないため)。
   * 一度 cleared になったら false へは戻さない。
   */
  function updateProgress(deckId, phrase, result) {
    var data = readProgress();
    var dp = deckEntry(data, deckId);
    if (!dp) return;

    var pid = String(phrase.id == null ? '' : phrase.id);
    if (!isSafeKey(pid)) return;

    var pr = dp.phrases[pid];
    if (!pr || typeof pr !== 'object' || Array.isArray(pr)) {
      pr = { best: 0, cleared: false, tries: 0, lastAt: 0 };
      dp.phrases[pid] = pr;
    }

    var sc = (result && typeof result.score === 'number' && isFinite(result.score)) ? result.score : 0;
    pr.tries = num(pr.tries) + 1;
    if (sc > num(pr.best)) pr.best = sc;
    pr.lastAt = Date.now();

    var runKey = String(deckId) + '\u0000' + pid;
    var run = runs[runKey];
    if (!run) { run = []; runs[runKey] = run; }
    run.push(sc);
    if (run.length > MAX_RUN) run.shift();

    /* ★クリア判定は「直近 MAX_ATTEMPTS 回のうち 2 回通じたか」(仕様 §2-1 F3)。
       run 全体(最大 20 件)で判定すると、日をまたいで通算 2 回通じただけでクリアになり、
       画面の ●●○(今回の 3 回分)と食い違って「1 回しか通じていないのにクリア」に見える。 */
    var window_ = run.slice(-attemptWindow());
    try {
      if (LC.score && typeof LC.score.passRate === 'function') {
        if (LC.score.passRate(window_).cleared) pr.cleared = true;
      } else if (sc >= passThreshold()) {
        pr.cleared = true;
      }
    } catch (e) { /* 採点側が壊れても進捗の記録は続ける */ }

    /* デッキ完了。全フレーズが cleared になった瞬間を 1 度だけ記録する。 */
    if (!dp.completedAt) {
      var deck = getDeck(deckId);
      if (deck && deck.phrases.length) {
        var all = true;
        for (var i = 0; i < deck.phrases.length; i++) {
          var q = dp.phrases[deck.phrases[i].id];
          if (!q || !q.cleared) { all = false; break; }
        }
        if (all) dp.completedAt = Date.now();
      }
    }

    st('progress').setDebounced(data);   /* §11-3 */
  }


  /* --- 1 試行の記録 ----------------------------------------------------- */

  /**
   * 1 回の発話を記録する。
   *
   * ★ excluded === true のときは wordstats も progress も更新しない ★
   * 「うまく拾えなかった」はユーザーの拒否権であり、機械が悪いのか自分が悪いのか
   * 分からない状況で統計を汚さないための最重要の逃げ道(仕様 R14)。
   * セッションの回数にも数えない。
   *
   * @param {string} deckId
   * @param {Object} phrase  Phrase(id / text / focus …)
   * @param {Object} result  ScoreResult(§5-10)
   * @param {boolean=} excluded
   * @returns {Object} recorded / reason
   */
  function recordAttempt(deckId, phrase, result, excluded) {
    try {
      if (excluded === true) {
        log('tracker.excluded', { deckId: deckId, phraseId: phrase && phrase.id });
        return { recorded: false, reason: 'excluded' };
      }
      if (!phrase || typeof phrase !== 'object' || !isNonEmptyString(phrase.id)) {
        return { recorded: false, reason: 'no-phrase' };
      }
      if (!result || typeof result !== 'object') {
        return { recorded: false, reason: 'no-result' };
      }
      /* 呼び出し側(§5-14 手順 7)でも見ているが、記録の可否は二重に守る。 */
      if (!saveRecordsOn()) return { recorded: false, reason: 'save-off' };

      updateWordStats(result);
      updateProgress(deckId, phrase, result);

      /* セッションの集計。startSession を呼ばずに練習した場合でも落とさない。 */
      if (current) {
        var sc = (typeof result.score === 'number' && isFinite(result.score)) ? result.score : 0;
        current.attempts += 1;
        if (sc >= passThreshold()) current.passes += 1;
        /* 「語数」= 声に出したお手本の語数。伝わった語数ではない
         * (このアプリの成功指標は練習量であって点数ではない。§15)。 */
        current.words += num(result.plain && result.plain.totalWords);
        scoreSum += sc;
        if (seenPhrases && !seenPhrases[phrase.id]) {
          seenPhrases[phrase.id] = true;
          current.phrases += 1;
        }
      }
      return { recorded: true, reason: 'ok' };
    } catch (e) {
      log('tracker.recordAttempt.error', { error: String(e) });
      return { recorded: false, reason: 'error' };
    }
  }


  /* --- 進捗の読み出し --------------------------------------------------- */

  /** 進捗全体の複製。store の参照をそのまま渡すと画面側の書き換えが漏れるため。 */
  function getProgress() {
    try { return clone(readProgress()) || { decks: {} }; }
    catch (e) { return { decks: {} }; }
  }

  /**
   * 1 デッキ分の進捗。ホーム画面の「●●●○○○ 3/6」を作れるよう件数も付ける。
   * @returns {Object} deckId / lastIndex / completedAt / phrases / total / done / clearedIds
   */
  function getDeckProgress(deckId) {
    var out = {
      deckId: String(deckId == null ? '' : deckId),
      lastIndex: 0, completedAt: null, phrases: {},
      total: 0, done: 0, clearedIds: []
    };
    try {
      var data = readProgress();
      var dp = data.decks[out.deckId];
      if (dp && typeof dp === 'object') {
        out.lastIndex = num(dp.lastIndex);
        out.completedAt = (typeof dp.completedAt === 'number') ? dp.completedAt : null;
        out.phrases = clone(dp.phrases) || {};
      }
      var deck = getDeck(out.deckId);
      if (deck) {
        out.total = deck.phrases.length;
        for (var i = 0; i < deck.phrases.length; i++) {
          var pid = deck.phrases[i].id;
          var pr = out.phrases[pid];
          if (pr && pr.cleared) { out.done += 1; out.clearedIds.push(pid); }
        }
        if (out.lastIndex < 0) out.lastIndex = 0;
        if (out.lastIndex > out.total - 1) out.lastIndex = Math.max(0, out.total - 1);
      }
    } catch (e) { /* 既定値のまま返す */ }
    return out;
  }

  /** 「つづきから」用。書き込みは軽いのでデバウンスで十分。 */
  function setLastIndex(deckId, i) {
    try {
      if (!saveRecordsOn()) return false;
      var data = readProgress();
      var dp = deckEntry(data, deckId);
      if (!dp) return false;
      var idx = num(i);
      if (idx < 0) idx = 0;
      if (dp.lastIndex === idx) return true;
      dp.lastIndex = idx;
      st('progress').setDebounced(data);
      return true;
    } catch (e) { return false; }
  }


  /* --- 苦手語ランキング(このアプリ唯一の代替不能な出力。F5)------------- */

  function topHeard(h) {
    if (!h || typeof h !== 'object') return null;
    var best = null, bestN = 0, k;
    for (k in h) {
      if (!own(h, k)) continue;
      var n = num(h[k]);
      if (n > bestN) { bestN = n; best = k; }
    }
    return best;
  }

  /** 機能語(a / the / to …)は認識器が日常的に落とすので、ランキングからは外す。 */
  function isFunctionWord(w) {
    try {
      var fw = normalize.FUNCTION_WORDS;
      return !!(fw && typeof fw.has === 'function' && fw.has(w));
    } catch (e) { return false; }
  }

  /**
   * 通過率の低い語を並べる。
   * 単発の誤認識はノイズだが、何セッションも積んで three が 3 割しか通らないなら
   * それは実データ。これが本アプリ唯一の代替不能な出力(F5)。
   *
   * ★仕様からの意図的な調整★ 既定では機能語を除外する。
   * 「a」「the」が上位を埋めると、ランキングが機能語で埋まって使い物にならない
   * (§7-5 の画面例も three / right のような内容語を想定している)。
   * 機能語も見たいときは opts.includeFunctionWords = true。
   *
   * @param {number=} minAttempts 既定 3
   * @param {number=} maxRate     既定 0.7
   * @param {number=} limit       既定 10
   * @param {Object=} opts        includeFunctionWords
   * @returns {Array} [{word, rate, attempts, passes, mostHeardAs}]
   */
  function troubleWords(minAttempts, maxRate, limit, opts) {
    var out = [];
    try {
      var mn = (typeof minAttempts === 'number' && isFinite(minAttempts)) ? minAttempts : 3;
      var mx = (typeof maxRate === 'number' && isFinite(maxRate)) ? maxRate : 0.7;
      var lim = (typeof limit === 'number' && isFinite(limit) && limit > 0) ? limit : 10;
      var includeFn = !!(opts && opts.includeFunctionWords);

      var data = st('wordstats').get();
      if (!data || typeof data !== 'object' || Array.isArray(data)) return out;

      for (var w in data) {
        if (!own(data, w)) continue;
        var rec = data[w];
        if (!rec || typeof rec !== 'object') continue;
        var a = num(rec.a), g = num(rec.g);
        if (a < mn || a <= 0) continue;
        var rate = g / a;
        if (rate > mx) continue;
        if (!includeFn && isFunctionWord(w)) continue;
        out.push({
          word: w,
          rate: rate,
          attempts: a,
          passes: g,
          mostHeardAs: topHeard(rec.h)
        });
      }

      /* 通じにくい順 → 挑戦回数の多い順(データの厚い語を上に)→ 辞書順で安定化 */
      out.sort(function (x, y) {
        if (x.rate !== y.rate) return x.rate - y.rate;
        if (x.attempts !== y.attempts) return y.attempts - x.attempts;
        return (x.word < y.word) ? -1 : (x.word > y.word ? 1 : 0);
      });
      if (out.length > lim) out = out.slice(0, lim);
    } catch (e) {
      log('tracker.troubleWords.error', { error: String(e) });
    }
    return out;
  }


  /* --- 苦手音の集計 ----------------------------------------------------- */

  /**
   * 正規化語 → その語を含むフレーズの focus タグ集合。
   * 教材が変わらない限り不変なのでキャッシュする(自作デッキ追加時に invalidate)。
   */
  function phraseFocusIndex() {
    if (focusIndexCache) return focusIndexCache;
    var index = Object.create(null);
    try {
      var decks = getDecks();
      for (var d = 0; d < decks.length; d++) {
        var ps = decks[d].phrases;
        for (var p = 0; p < ps.length; p++) {
          var focus = ps[p].focus;
          if (!focus || !focus.length) continue;
          var tok = (typeof normalize.tokenize === 'function') ? normalize.tokenize(ps[p].text) : null;
          var tokens = (tok && tok.tokens) ? tok.tokens : [];
          for (var i = 0; i < tokens.length; i++) {
            var w = tokens[i] && tokens[i].norm;
            if (!isSafeKey(w)) continue;
            var bag = index[w];
            if (!bag) { bag = Object.create(null); index[w] = bag; }
            for (var f = 0; f < focus.length; f++) bag[focus[f]] = true;
          }
        }
      }
    } catch (e) {
      log('tracker.focusIndex.error', { error: String(e) });
    }
    focusIndexCache = index;
    return index;
  }

  /**
   * 苦手音のまとめ。
   * ①フレーズに付いた focus タグ ②誤認識先から推定した pronunciationHint
   * の 2 経路をタグ単位で束ねる(仕様 §5-11 / §7-5)。
   *
   * @returns {Array} [{tag, label, words:[]}] 語数の多い順
   */
  function focusSummary() {
    var out = [];
    try {
      var words = troubleWords(3, 0.7, 40);
      if (!words.length) return out;

      var index = phraseFocusIndex();
      var buckets = Object.create(null);

      for (var i = 0; i < words.length; i++) {
        var w = words[i].word;
        var tags = Object.create(null), tg;

        var fromPhrase = index[w];
        if (fromPhrase) for (tg in fromPhrase) if (own(fromPhrase, tg)) tags[tg] = true;

        var heard = words[i].mostHeardAs;
        if (heard && typeof similarity.pronunciationHint === 'function') {
          var hint = similarity.pronunciationHint(w, heard);
          if (hint && typeof similarity.hintToFocusTag === 'function') {
            var tag2 = similarity.hintToFocusTag(hint);
            if (tag2) tags[tag2] = true;
          }
        }

        for (tg in tags) {
          if (!own(tags, tg) || !FOCUS_TAG_SET[tg]) continue;
          var bucket = buckets[tg];
          if (!bucket) { bucket = []; buckets[tg] = bucket; }
          if (bucket.indexOf(w) < 0) bucket.push(w);
        }
      }

      for (var k in buckets) {
        if (!own(buckets, k)) continue;
        out.push({ tag: k, label: focusLabel(k), words: buckets[k] });
      }
      out.sort(function (x, y) {
        if (x.words.length !== y.words.length) return y.words.length - x.words.length;
        return FOCUS_TAGS.indexOf(x.tag) - FOCUS_TAGS.indexOf(y.tag);
      });
    } catch (e) {
      log('tracker.focusSummary.error', { error: String(e) });
    }
    return out;
  }


  /* --- セッション履歴 --------------------------------------------------- */

  function readSessions() {
    var arr = st('sessions').get();
    return Array.isArray(arr) ? arr : [];
  }

  /**
   * 練習セッションを開始する。取りこぼしを防ぐため、
   * 前のセッションが残っていたらここで確定させる。
   * @returns {string|null} セッション id
   */
  function startSession(deckId) {
    try {
      if (current) endSession();
      runs = Object.create(null);
      seenPhrases = Object.create(null);
      scoreSum = 0;
      current = {
        id: 's_' + Date.now(),
        startedAt: Date.now(),
        endedAt: 0,
        deckId: String(deckId == null ? '' : deckId),
        phrases: 0,
        attempts: 0,
        passes: 0,
        words: 0,
        avgScore: 0
      };
      log('tracker.session.start', { id: current.id, deckId: current.deckId });
      return current.id;
    } catch (e) {
      current = null;
      return null;
    }
  }

  /**
   * セッションを閉じて履歴へ 1 回だけ書き込む(§11-3)。
   * 1 回も話していないセッションは保存しない(履歴が空レコードで埋まるのを防ぐ)。
   * @returns {Object|null} 保存したレコード
   */
  function endSession() {
    try {
      if (!current) return null;
      var rec = current;
      var sum = scoreSum;
      current = null;
      seenPhrases = null;
      scoreSum = 0;
      runs = Object.create(null);

      if (rec.attempts <= 0) {
        log('tracker.session.empty', { id: rec.id });
        return null;
      }
      rec.endedAt = Date.now();
      rec.avgScore = Math.round(sum / rec.attempts);

      var arr = readSessions().slice();
      arr.push(rec);
      /* 新しいものが末尾のリングバッファ(§11-2)。最新 200 件だけ残す。 */
      if (arr.length > MAX_SESSIONS) arr = arr.slice(arr.length - MAX_SESSIONS);
      st('sessions').set(arr);
      log('tracker.session.end', {
        id: rec.id, attempts: rec.attempts, passes: rec.passes, avgScore: rec.avgScore
      });
      return rec;
    } catch (e) {
      log('tracker.endSession.error', { error: String(e) });
      current = null;
      seenPhrases = null;
      scoreSum = 0;
      return null;
    }
  }

  /** 進行中のセッション(複製)。サマリ画面が「今回の分」を出すのに使える。 */
  function getCurrentSession() {
    return current ? clone(current) : null;
  }

  /** 履歴。**新しい順**で返す(きろく画面の「最近の練習」がそのまま並べられる)。 */
  function getSessions(limit) {
    try {
      var arr = readSessions().slice().reverse();
      var lim = (typeof limit === 'number' && isFinite(limit) && limit > 0) ? limit : arr.length;
      return clone(arr.slice(0, lim)) || [];
    } catch (e) { return []; }
  }

  /**
   * 直近 7 日の練習量。
   * @returns {Object} days(7 要素・古い順)/ utterances / words / streak / activeDays
   *
   * 平均点は返さない。このアプリの成功指標は発話回数と継続であって点数ではない(§15)。
   */
  function weeklyStats() {
    var out = { days: [0, 0, 0, 0, 0, 0, 0], utterances: 0, words: 0, streak: 0, activeDays: 0 };
    try {
      var byDay = Object.create(null);

      function add(rec) {
        if (!rec || typeof rec !== 'object') return;
        var a = num(rec.attempts);
        if (a <= 0) return;
        var d = epochDay(num(rec.startedAt) || Date.now());
        var b = byDay[d];
        if (!b) { b = { a: 0, w: 0 }; byDay[d] = b; }
        b.a += a;
        b.w += num(rec.words);
      }

      var arr = readSessions();
      for (var i = 0; i < arr.length; i++) add(arr[i]);
      /* 進行中のセッションも足す。練習直後にきろくを開いても 0 にならないように。 */
      add(current);

      var today = epochDay();
      for (var k = 0; k < 7; k++) {
        var day = today - 6 + k;
        var bucket = byDay[day];
        var n = bucket ? bucket.a : 0;
        out.days[k] = n;
        out.utterances += n;
        out.words += bucket ? bucket.w : 0;
        if (n > 0) out.activeDays += 1;
      }

      /* 連続日数。今日まだ話していなくても、昨日まで続いていれば途切れさせない
       * (朝いちで開いた瞬間に「連続 0 日」と言われるのは体験として悪い)。 */
      var cursor = byDay[today] ? today : (today - 1);
      var streak = 0, guard = 0;
      while (byDay[cursor] && byDay[cursor].a > 0 && guard < STREAK_LIMIT) {
        streak += 1; cursor -= 1; guard += 1;
      }
      out.streak = streak;
    } catch (e) {
      log('tracker.weeklyStats.error', { error: String(e) });
    }
    return out;
  }


  /**
   * 学習の記録をすべて消す(§7-5 の 2 段階確認の先)。
   * 消すのは「記録」= 進捗 / 苦手語 / 履歴 の 3 つだけ。
   * せっていと自作デッキは記録ではなくユーザーの資産なので残す。
   */
  function clearRecords() {
    try {
      current = null;
      seenPhrases = null;
      scoreSum = 0;
      runs = Object.create(null);
      /* 3 つとも消せて初めて成功。1 つでも消せていなければ画面に「消しました」と
         出させない(体験モードや readonly では実際には消えない)。 */
      var a = st('progress').reset();
      var b = st('wordstats').reset();
      var c = st('sessions').reset();
      var ok = (a !== false) && (b !== false) && (c !== false);
      log('tracker.clearRecords', { ok: ok });
      return ok;
    } catch (e) {
      log('tracker.clearRecords.error', { error: String(e) });
      return false;
    }
  }


  LC.tracker = {
    recordAttempt: recordAttempt,
    getProgress: getProgress,
    getDeckProgress: getDeckProgress,
    setLastIndex: setLastIndex,
    troubleWords: troubleWords,
    focusSummary: focusSummary,
    startSession: startSession,
    endSession: endSession,
    getCurrentSession: getCurrentSession,
    getSessions: getSessions,
    weeklyStats: weeklyStats,
    clearRecords: clearRecords,
    MAX_WORDSTATS: MAX_WORDSTATS,
    MAX_SESSIONS: MAX_SESSIONS
  };

  LC.__loaded = (LC.__loaded || []).concat(['catalog', 'tracker']);
})(window.LC);

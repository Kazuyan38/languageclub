/* js/03-text.js
 * 採点エンジン(このアプリで最も重要な純粋ロジック)
 *
 *   LC.normalize   仕様 §5-7  正規化・トークン化
 *   LC.similarity  仕様 §5-8  文字距離・同音異義語・発音ヒント
 *   LC.align       仕様 §5-9  単語アライメント DP
 *   LC.score       仕様 §5-10 スコア算出・バンド・通じ率
 *
 * このファイルは DOM に一切触らない(= テストできる)。
 * 依存してよいのは LC.util の clamp / ramp だけ。LC.msg にも依存しない。
 *
 * 言葉の規律(§0-1): このファイルが測っているのは「発音の良し悪し」ではなく
 * 「音声認識器に伝わったか」だけである。コメントでもその前提を崩さない。
 */
window.LC = window.LC || {};
(function (LC) {
  'use strict';

  /* ============================================================
   * 0. LC.util の薄いラッパ
   *   公開関数は例外を投げない、が絶対規則なので、
   *   万一 LC.util が未読込でも落ちないようにフォールバックを持つ。
   * ============================================================ */

  function clamp(x, lo, hi) {
    if (LC.util && typeof LC.util.clamp === 'function') return LC.util.clamp(x, lo, hi);
    return x < lo ? lo : (x > hi ? hi : x);
  }

  /** lo 以下で 0、hi 以上で 1 の線形補間(仕様 §5-1) */
  function ramp(x, lo, hi) {
    if (LC.util && typeof LC.util.ramp === 'function') return LC.util.ramp(x, lo, hi);
    if (hi <= lo) return x >= hi ? 1 : 0;
    return clamp((x - lo) / (hi - lo), 0, 1);
  }

  /** プロトタイプ汚染を避けるため、辞書はすべて null プロトタイプで作る。
   *  ('constructor' や 'toString' という語が来ても誤ヒットしない) */
  function dict(pairs) {
    var o = Object.create(null), k;
    for (k in pairs) if (Object.prototype.hasOwnProperty.call(pairs, k)) o[k] = pairs[k];
    return o;
  }

  /* ============================================================
   * 1. LC.normalize(仕様 §5-7)
   *
   * 正規化の 3 段階:
   *   A. 必ず吸収 … 大文字小文字 / 句読点 / 全角半角 / アポストロフィ / 余分な空白 / U.S.A.→usa
   *   B. 吸収する … 縮約形 / 数字⇄数詞 / フィラー / 英米綴り / 同音異義語
   *   C. 絶対にやらない … 語順 / 単複 / 時制 / 冠詞の有無 / 三単現 / ステミング
   *
   * C をやらない理由: bag-of-words 比較にすると
   * 「I ate an apple」と「Apple eat I」が同点になる。
   * リピート練習の目的は「お手本の文をそのまま言えること」なので、
   * 語順と語形はスコアに効かなければならない。
   * ============================================================ */

  /** 認識器が拾いがちな言いよどみ。採点から落とす(挿入ペナルティも受けない) */
  var FILLERS = ['um', 'umm', 'ummm', 'uhm', 'uh', 'uhh', 'uhhh', 'er', 'err', 'erm', 'ehm',
                 'ah', 'ahh', 'eh', 'hmm', 'hm', 'hmmm', 'mm', 'mmm', 'mhm', 'huh'];
  var FILLER_SET = new Set(FILLERS);

  /* 機能語(重み 0.6)。仕様 §5-7 の一覧をそのまま入れている。
   * 認識器が最も落としやすい語なので、落ちても致命傷にしない。
   * ★ この一覧を勝手に増減しないこと。§5-10 の検証表の点数が変わる。 */
  var FUNCTION_WORDS_LIST = ('a an the and or but so of to in on at for with from by as ' +
    'is am are was were be been being do does did have has had ' +
    'will would can could shall should may might must ' +
    'that this these those it its not than then there here').split(' ');
  var FUNCTION_WORDS = new Set(FUNCTION_WORDS_LIST);

  /* 縮約形は★ホワイトリスト方式★。語全体が辞書に一致したときだけ展開する。
   *
   * なぜ正規表現(/'s$/ → ' is' など)にしないか:
   *   's の無条件展開は所有格を破壊する(John's book → John is book)。
   *
   * ★★ its / were / well / ill / id を「キーとして」絶対に登録してはいけない ★★
   *   its   … 所有格の its(普通の語)と it's が衝突する
   *   were  … 過去形の were(普通の語)と we're が衝突する
   *   well  … 副詞の well(普通の語)と we'll が衝突する
   *   ill   … 形容詞の ill(普通の語)と I'll が衝突する
   *   id    … 名詞の id(普通の語)と I'd が衝突する
   *   → これらはアポストロフィ付きの綴り("it's" "we're" "we'll" "i'll" "i'd")だけ登録する。
   *
   * アポストロフィ無しで登録してよいのは「普通の英単語として存在しない綴り」だけ。
   * Chrome の認識結果はアポストロフィが落ちることがあるので、
   * 曖昧でないものは無し版も登録しておく(仕様 §5-7 の一覧)。 */
  var CONTRACTIONS = dict({
    /* --- アポストロフィ無し(仕様 §5-7 の確定リスト。曖昧でない綴りだけ) --- */
    'dont': 'do not', 'doesnt': 'does not', 'didnt': 'did not',
    'cant': 'can not', 'couldnt': 'could not', 'wouldnt': 'would not',
    'shouldnt': 'should not', 'wont': 'will not',
    'isnt': 'is not', 'arent': 'are not', 'wasnt': 'was not', 'werent': 'were not',
    'havent': 'have not', 'hasnt': 'has not', 'hadnt': 'had not',
    'lets': 'let us', 'thats': 'that is', 'whats': 'what is', 'wheres': 'where is',
    'hows': 'how is', 'whos': 'who is',
    'youre': 'you are', 'theyre': 'they are',
    'weve': 'we have', 'youve': 'you have', 'ive': 'i have',
    'im': 'i am', 'hes': 'he is', 'shes': 'she is', 'theres': 'there is',

    /* --- アポストロフィ付き(曖昧さが無いので安全に登録できる) --- */
    "don't": 'do not', "doesn't": 'does not', "didn't": 'did not',
    "can't": 'can not', "cannot": 'can not', "couldn't": 'could not',
    "wouldn't": 'would not', "shouldn't": 'should not', "won't": 'will not',
    "isn't": 'is not', "aren't": 'are not', "wasn't": 'was not', "weren't": 'were not',
    "haven't": 'have not', "hasn't": 'has not', "hadn't": 'had not',
    "mustn't": 'must not', "needn't": 'need not', "shan't": 'shall not',
    "let's": 'let us', "that's": 'that is', "what's": 'what is', "where's": 'where is',
    "how's": 'how is', "who's": 'who is', "when's": 'when is', "why's": 'why is',
    "there's": 'there is', "here's": 'here is', "it's": 'it is', "he's": 'he is',
    "she's": 'she is',
    "i'm": 'i am', "i've": 'i have', "i'd": 'i would', "i'll": 'i will',
    "you're": 'you are', "you've": 'you have', "you'd": 'you would', "you'll": 'you will',
    "we're": 'we are', "we've": 'we have', "we'd": 'we would', "we'll": 'we will',
    "they're": 'they are', "they've": 'they have', "they'd": 'they would',
    "they'll": 'they will',
    "he'd": 'he would', "he'll": 'he will', "she'd": 'she would', "she'll": 'she will',
    "it'll": 'it will', "that'll": 'that will', "there'll": 'there will',
    "would've": 'would have', "could've": 'could have', "should've": 'should have',
    "might've": 'might have', "must've": 'must have'
  });

  /* 英米綴りは★正規表現ルールではなく単語リスト★で吸収する。
   * 理由: -ise → -ize のようなルールは surprise → surprize、advise → advize を壊す。
   * 綴りが違うだけで音は同じなので、両側をアメリカ綴りに寄せて比較する。 */
  var BRITISH_TO_AMERICAN = dict({
    'colour': 'color', 'colours': 'colors', 'coloured': 'colored', 'colourful': 'colorful',
    'favourite': 'favorite', 'favourites': 'favorites', 'favour': 'favor', 'favours': 'favors',
    'centre': 'center', 'centres': 'centers', 'centred': 'centered',
    'theatre': 'theater', 'theatres': 'theaters',
    'realise': 'realize', 'realised': 'realized', 'realises': 'realizes',
    'realising': 'realizing', 'realisation': 'realization',
    'organise': 'organize', 'organised': 'organized', 'organises': 'organizes',
    'organising': 'organizing', 'organisation': 'organization',
    'travelling': 'traveling', 'travelled': 'traveled', 'traveller': 'traveler',
    'travellers': 'travelers',
    'grey': 'gray', 'greyish': 'grayish',
    'aluminium': 'aluminum',
    'programme': 'program', 'programmes': 'programs',
    'catalogue': 'catalog', 'catalogues': 'catalogs',
    'dialogue': 'dialog', 'dialogues': 'dialogs',
    'defence': 'defense', 'defences': 'defenses',
    'licence': 'license', 'licences': 'licenses',
    'practise': 'practice', 'practised': 'practiced', 'practises': 'practices',
    'practising': 'practicing',
    'apologise': 'apologize', 'apologised': 'apologized', 'apologises': 'apologizes',
    'apologising': 'apologizing',
    'recognise': 'recognize', 'recognised': 'recognized', 'recognises': 'recognizes',
    'recognising': 'recognizing',
    'analyse': 'analyze', 'analysed': 'analyzed', 'analysing': 'analyzing',
    'behaviour': 'behavior', 'behaviours': 'behaviors',
    'neighbour': 'neighbor', 'neighbours': 'neighbors',
    'labour': 'labor', 'labours': 'labors',
    'humour': 'humor', 'humours': 'humors',
    'honour': 'honor', 'honours': 'honors',
    'flavour': 'flavor', 'flavours': 'flavors',
    'harbour': 'harbor', 'harbours': 'harbors',
    'rumour': 'rumor', 'rumours': 'rumors',
    'cheque': 'check', 'cheques': 'checks',
    'metre': 'meter', 'metres': 'meters',
    'litre': 'liter', 'litres': 'liters',
    'fibre': 'fiber', 'fibres': 'fibers',
    'sceptical': 'skeptical',
    'mould': 'mold', 'moulds': 'molds',
    'plough': 'plow', 'ploughs': 'plows',
    'tyre': 'tire', 'tyres': 'tires',
    'kerb': 'curb', 'kerbs': 'curbs',
    'pyjamas': 'pajamas',
    'cancelled': 'canceled', 'cancelling': 'canceling',
    'labelled': 'labeled', 'labelling': 'labeling',
    'modelling': 'modeling', 'jewellery': 'jewelry',
    'specialise': 'specialize', 'specialised': 'specialized',
    'civilisation': 'civilization', 'aeroplane': 'airplane', 'maths': 'math'
  });

  /* 同音異義語(音は同じで綴りだけ違う)。置換コスト 0 = 完全一致扱いにする。
   * 認識器がどちらを返すかは文脈次第で、話者の発音とは無関係だから。
   * 仕様 §5-7 の一覧をそのまま入れている。 */
  var HOMOPHONE_GROUPS = [
    ['two', 'to', 'too'], ['their', 'there'], ['hear', 'here'], ['for', 'four'],
    ['write', 'right'], ['buy', 'by', 'bye'], ['no', 'know'], ['week', 'weak'],
    ['sea', 'see'], ['son', 'sun'], ['won', 'one'], ['flour', 'flower'],
    ['peace', 'piece'], ['wait', 'weight'], ['meet', 'meat'], ['eight', 'ate'],
    ['our', 'hour'], ['knew', 'new'], ['brake', 'break'], ['sent', 'cent', 'scent'],
    ['made', 'maid'], ['mail', 'male'], ['plain', 'plane'], ['road', 'rode'],
    ['whole', 'hole'], ['whether', 'weather'], ['which', 'witch'],
    ['allowed', 'aloud'], ['bored', 'board'], ['passed', 'past'],
    ['principal', 'principle']
  ];

  /** 語 → グループ代表(各グループの先頭語)へのマップ */
  var HOMOPHONE_KEY = (function () {
    var m = Object.create(null), i, j, g;
    for (i = 0; i < HOMOPHONE_GROUPS.length; i++) {
      g = HOMOPHONE_GROUPS[i];
      for (j = 0; j < g.length; j++) m[g[j]] = g[0];
    }
    return m;
  })();

  /* ---------- 数詞 ---------- */

  var ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
              'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
              'seventeen', 'eighteen', 'nineteen'];
  var TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  var SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];
  var ORDINAL_OF = dict({
    'one': 'first', 'two': 'second', 'three': 'third', 'four': 'fourth', 'five': 'fifth',
    'six': 'sixth', 'seven': 'seventh', 'eight': 'eighth', 'nine': 'ninth', 'ten': 'tenth',
    'eleven': 'eleventh', 'twelve': 'twelfth', 'thirteen': 'thirteenth',
    'twenty': 'twentieth', 'thirty': 'thirtieth', 'forty': 'fortieth', 'fifty': 'fiftieth',
    'sixty': 'sixtieth', 'seventy': 'seventieth', 'eighty': 'eightieth', 'ninety': 'ninetieth',
    'hundred': 'hundredth', 'thousand': 'thousandth', 'zero': 'zeroth'
  });

  function pushUnder100(n, out) {
    if (n < 20) { out.push(ONES[n]); return; }
    out.push(TENS[Math.floor(n / 10)]);
    if (n % 10) out.push(ONES[n % 10]);
  }

  function pushUnder1000(n, out) {
    if (n >= 100) {
      out.push(ONES[Math.floor(n / 100)]);
      out.push('hundred');
      n = n % 100;
      if (n === 0) return;
    }
    pushUnder100(n, out);
  }

  /** 数値 → 数詞の配列。0〜999,999 を確実に扱えれば十分だが、上位も一応読める */
  function numberToWords(n) {
    var out = [];
    if (!isFinite(n)) return ['zero'];
    n = Math.floor(Math.abs(n));
    if (n === 0) return ['zero'];
    var groups = [], i;
    while (n > 0 && groups.length < SCALES.length) { groups.push(n % 1000); n = Math.floor(n / 1000); }
    for (i = groups.length - 1; i >= 0; i--) {
      if (groups[i] === 0) continue;
      pushUnder1000(groups[i], out);
      if (SCALES[i]) out.push(SCALES[i]);
    }
    return out.length ? out : ['zero'];
  }

  /** 年号読み。1999 → nineteen ninety nine、2024 → twenty twenty four
   *  4 桁 1100–2099 かつ下 2 桁 ≠ 00 のときだけ使う(仕様 §5-7) */
  function yearWords(n) {
    var hi = Math.floor(n / 100), lo = n % 100, out = [];
    pushUnder100(hi, out);
    if (lo < 10) { out.push('oh'); out.push(ONES[lo]); } else { pushUnder100(lo, out); }
    return out;
  }

  /** 序数 3rd → third(認識器は "3rd" を返すことがある) */
  function ordinalWords(n) {
    var w = numberToWords(n);
    var last = w[w.length - 1];
    w[w.length - 1] = ORDINAL_OF[last] || (last + 'th');
    return w;
  }

  /* ---------- 文字レベルの前処理(段階 A) ---------- */

  var APOSTROPHES = /[‘’ʼʹ´`]/g;
  /* ハイフン・各種ダッシュ・スラッシュ・中黒で分割する。
   * first-year → first / year、and/or → and / or */
  var SPLITTERS = /[\-‐‑‒–—―・\/\\]+/;

  function toHalfWidth(s) {
    return s.replace(/[！-～]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    }).replace(/　/g, ' ');
  }

  function defaultOpts(opts) {
    opts = opts || {};
    return {
      dropFillers: opts.dropFillers !== false,
      britishToAmerican: opts.britishToAmerican !== false,
      expandNumbers: opts.expandNumbers !== false,
      expandContractions: opts.expandContractions !== false,
      yearHeuristic: opts.yearHeuristic !== false
    };
  }

  /** 1 つの「部品」(ハイフン分割後)を正規化トークン列に変換して out に積む */
  function expandPart(part, o, out, fillersFound) {
    if (!part) return;
    var hasPercent = part.indexOf('%') >= 0;
    var hasDollar = part.indexOf('$') >= 0 || part.indexOf('￥') >= 0;

    /* 句読点・記号を落とす。' と . だけは意味を持つので残して個別に処理する */
    var w = part.replace(/[^a-z0-9'.]/g, '');

    if (/^(?:[a-z]\.)+[a-z]?$/.test(w)) {
      w = w.replace(/\./g, '');          /* U.S.A. → usa(段階 A) */
    } else if (!/^\d+\.\d+$/.test(w)) {
      w = w.replace(/\./g, '');          /* 文末のピリオドなど */
    }
    w = w.replace(/^'+/, '').replace(/'+$/, '');

    if (w === '') {
      if (hasPercent) out.push('percent');
      return;
    }

    if (o.expandNumbers) {
      var mo = /^(\d+)(?:st|nd|rd|th)$/.exec(w);
      if (mo) { pushAll(out, ordinalWords(parseInt(mo[1], 10))); return; }

      if (/^\d+$/.test(w)) {
        var n = parseInt(w, 10);
        var words = (o.yearHeuristic && w.length === 4 && n >= 1100 && n <= 2099 && (n % 100) !== 0)
          ? yearWords(n) : numberToWords(n);
        pushAll(out, words);
        if (hasDollar) out.push(n === 1 ? 'dollar' : 'dollars');
        if (hasPercent) out.push('percent');
        return;
      }

      if (/^\d+\.\d+$/.test(w)) {
        var half = w.split('.');
        pushAll(out, numberToWords(parseInt(half[0], 10)));
        out.push('point');
        for (var d = 0; d < half[1].length; d++) out.push(ONES[parseInt(half[1].charAt(d), 10)]);
        if (hasDollar) out.push('dollars');
        if (hasPercent) out.push('percent');
        return;
      }
    }

    /* --- 縮約形(ホワイトリスト。辞書に無ければ展開しない) --- */
    var pieces = null;
    if (o.expandContractions) {
      if (CONTRACTIONS[w]) {
        pieces = CONTRACTIONS[w].split(' ');
      } else if (w.indexOf("'") >= 0) {
        var bare = w.replace(/'/g, '');
        if (CONTRACTIONS[bare]) pieces = CONTRACTIONS[bare].split(' ');
      }
    }
    /* 辞書に無いアポストロフィ語は展開せずアポストロフィだけ落とす。
     * John's → johns。認識結果側も同じ処理になるので一致する。 */
    if (!pieces) pieces = [w.replace(/'/g, '')];

    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i];
      if (!p) continue;
      if (o.britishToAmerican && BRITISH_TO_AMERICAN[p]) p = BRITISH_TO_AMERICAN[p];
      if (o.dropFillers && FILLER_SET.has(p)) { fillersFound.push(p); continue; }
      out.push(p);
    }
  }

  function pushAll(arr, items) {
    for (var i = 0; i < items.length; i++) arr.push(items[i]);
  }

  /**
   * 表示用の語と採点用のトークンを owner で結びつけて返す。
   *
   * ★これが本エンジンの核心★
   *   don't → do / not のように 1 語が 2 トークンに割れても、
   *   owner(display の添字)を辿れば元の表示に戻せる。
   *   これが無いと採点結果を元の文のハイライトに戻せない。
   *
   * @param {string} text
   * @param {Object=} opts dropFillers / britishToAmerican / expandNumbers /
   *                       expandContractions / yearHeuristic(すべて既定 true)
   * @returns {Object} display / tokens / fillersFound を持つオブジェクト
   *   display[i] = 表示単位  text(原文のまま) / owner(自分の添字) / tokenCount
   *   tokens[k]  = 採点単位  norm(正規化済み) / owner(display の添字)
   */
  function tokenize(text, opts) {
    var out = { display: [], tokens: [], fillersFound: [] };
    if (typeof text !== 'string' || text === '') return out;
    var o = defaultOpts(opts);
    var raw = toHalfWidth(text).split(/\s+/);
    for (var i = 0; i < raw.length; i++) {
      var surface = raw[i];
      if (surface === '') continue;                       /* 先頭の半角スペース対策(段階 A) */
      var owner = out.display.length;
      var lowered = surface.replace(APOSTROPHES, "'").toLowerCase();
      var parts = lowered.split(SPLITTERS);
      var norms = [];
      for (var p = 0; p < parts.length; p++) expandPart(parts[p], o, norms, out.fillersFound);
      out.display.push({ text: surface, owner: owner, tokenCount: norms.length });
      for (var k = 0; k < norms.length; k++) out.tokens.push({ norm: norms[k], owner: owner });
    }
    return out;
  }

  /** tokenize の結果から正規化済み文字列の配列だけを取り出す(内部用) */
  function normWords(tk) {
    var a = [], i;
    for (i = 0; i < tk.tokens.length; i++) a.push(tk.tokens[i].norm);
    return a;
  }

  LC.normalize = {
    tokenize: tokenize,
    FILLERS: FILLERS,
    FUNCTION_WORDS: FUNCTION_WORDS,
    CONTRACTIONS: CONTRACTIONS,
    BRITISH_TO_AMERICAN: BRITISH_TO_AMERICAN,
    HOMOPHONE_GROUPS: HOMOPHONE_GROUPS,
    HOMOPHONE_KEY: HOMOPHONE_KEY
  };

  /* ============================================================
   * 2. LC.similarity(仕様 §5-8)
   * ============================================================ */

  /**
   * レーベンシュタイン距離(文字単位)。
   * ★2 行だけ保持する O(min(n,m)) メモリ版★
   * 認識代替候補 × 別解の総当たりで何百回も呼ばれるので、行列を確保しない。
   */
  function charDistance(a, b) {
    a = (typeof a === 'string') ? a : '';
    b = (typeof b === 'string') ? b : '';
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    if (a.length < b.length) { var t = a; a = b; b = t; }   /* 短いほうを列にする */
    var m = b.length;
    var prev = new Array(m + 1), cur = new Array(m + 1), i, j, tmp;
    for (j = 0; j <= m; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur[0] = i;
      var ca = a.charCodeAt(i - 1);
      for (j = 1; j <= m; j++) {
        var d = prev[j - 1] + (ca === b.charCodeAt(j - 1) ? 0 : 1);
        var up = prev[j] + 1;
        var left = cur[j - 1] + 1;
        if (up < d) d = up;
        if (left < d) d = left;
        cur[j] = d;
      }
      tmp = prev; prev = cur; cur = tmp;
    }
    return prev[m];
  }

  /** 0..1 の綴り類似度 */
  function charSimilarity(a, b) {
    a = (typeof a === 'string') ? a : '';
    b = (typeof b === 'string') ? b : '';
    var max = Math.max(a.length, b.length);
    if (max === 0) return 1;
    return clamp(1 - charDistance(a, b) / max, 0, 1);
  }

  /** 同じ同音異義語グループに属し、かつ綴りが違うとき true
   *  (同一語は「同音異義語」ではなく単なる正解なので false) */
  function isHomophone(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a === b) return false;
    var ka = HOMOPHONE_KEY[a];
    return !!ka && ka === HOMOPHONE_KEY[b];
  }

  /* 日本語話者に典型的な音の取り違えに絞ったルール。
   * [パターン, 置換, 日本語ラベル, focus タグ, (省略可)hyp 側に当たったときのラベル]
   * ★順序が結果を決める★ 仕様 §5-8 の検証済み期待出力
   *   (three/free, right/light, very/berry, think/sink, sit/seat, coffee/car)
   * がこの順序に依存しているので、並べ替えないこと。 */
  var TH_F = 'th (θ) が f に近く聞こえています';
  var TH_S = 'th (θ) が s に近く聞こえています';
  var TH_T = 'th (θ) が t に近く聞こえています';
  var TH_D = 'th (ð) が d に近く聞こえています';
  var TH_Z = 'th (ð) が z に近く聞こえています';
  var RL = 'R と L の区別';
  var VB = 'V と B の区別';
  var FH = 'F と H の区別';
  var SSH = 'S と SH の区別';
  var LONG_I = '長母音 (iː) が短母音に聞こえています';
  var SHORT_I = '短母音 (ɪ) が長母音に聞こえています';
  var LONG_U = '長母音 (uː) が短母音に聞こえています';
  var SHORT_U = '短母音 (ʊ) が長母音に聞こえています';
  var VOWEL_AU = '母音 a / u の区別';
  var DROP_W = 'W の音が落ちています';
  var DROP_H = 'H の音が落ちています';
  var ENDING_VOWEL = '語末に母音がついています(子音で止める)';
  var DROP_S = '語末の s が聞こえていません';
  var EXTRA_S = '語末に余分な s が聞こえています';

  var PRON_RULES = [
    [/th/g, 'f', TH_F, 'th'],
    [/th/g, 's', TH_S, 'th'],
    [/th/g, 't', TH_T, 'th'],
    [/th/g, 'd', TH_D, 'th'],
    [/th/g, 'z', TH_Z, 'th'],
    [/r/g, 'l', RL, 'r-l'],
    [/l/g, 'r', RL, 'r-l'],
    [/v/g, 'b', VB, 'v-b'],
    [/b/g, 'v', VB, 'v-b'],
    [/f/g, 'h', FH, 'f-h'],
    [/h/g, 'f', FH, 'f-h'],
    /* ★語末の s は s⇄sh より必ず先に見る★
     * economics / economic のように語末の s だけが違う場合、
     * s→sh ルールが先に当たって「S と SH の区別」という的外れなヒントが出る
     * (economics → economicsh が economic と 0.8 で似てしまうため)。
     * 仕様 §7-3 の画面例が求めている「語末の s が聞こえていません」もここで出る。
     * 向きで意味が反転するので、hyp 側に当たったときは別ラベルを使う。 */
    [/s$/, '', DROP_S, null, EXTRA_S],
    [/sh/g, 's', SSH, null],
    [/s/g, 'sh', SSH, null],
    /* ★語末の母音付加は母音ルール群より先に見る★
     * desk / desku は「語末に母音がついている」のであって a と u を取り違えたのではない。
     * a⇄u ルールを先に通すと desku → deska が 0.8 で当たってしまい、
     * focus タグ ending-vowel が拾えなくなる(苦手音の集計が狂う)。
     * 仕様 §5-8 の表では最後に載っているが、6 件の検証済み出力はこの位置でも
     * すべて変わらない(three/free・right/light・very/berry・think/sink・
     *  sit/seat は語末が [bdfgkpt] でないか、置換後の類似度が 0.8 未満)。 */
    [/([bdfgkpt])$/, '$1u', ENDING_VOWEL, 'ending-vowel'],
    [/([bdfgkpt])$/, '$1o', ENDING_VOWEL, 'ending-vowel'],
    [/ee/g, 'i', LONG_I, 'vowel-length'],
    [/ea/g, 'i', LONG_I, 'vowel-length'],
    [/i/g, 'ee', SHORT_I, 'vowel-length'],
    [/oo/g, 'u', LONG_U, 'vowel-length'],
    [/u/g, 'oo', SHORT_U, 'vowel-length'],
    [/a/g, 'u', VOWEL_AU, null],
    [/u/g, 'a', VOWEL_AU, null],
    [/w/g, '', DROP_W, null],
    [/h/g, '', DROP_H, null]
  ];

  /** ラベル → focus タグ。PRON_RULES から自動生成する */
  var HINT_TO_TAG = (function () {
    var m = Object.create(null), i;
    for (i = 0; i < PRON_RULES.length; i++) {
      if (!PRON_RULES[i][3]) continue;
      if (!m[PRON_RULES[i][2]]) m[PRON_RULES[i][2]] = PRON_RULES[i][3];
      if (PRON_RULES[i][4] && !m[PRON_RULES[i][4]]) m[PRON_RULES[i][4]] = PRON_RULES[i][3];
    }
    return m;
  })();

  /**
   * お手本の語と聞き取られた語の「音の取り違え」を推定して日本語ラベルを返す。
   * 当てはまらなければ null(無理にヒントを出さない)。
   *
   * ★実バグ注意★ ルールを適用しても綴りが変わらない場合は必ずスキップする。
   * r2 !== ref のチェックが無いと、th を含まない right / light に
   * 「th の音が…」という的外れなヒントが出てしまう(ref.replace が
   *  何も置換せずに元の文字列を返し、それが hyp と似ているため)。
   */
  function pronunciationHint(ref, hyp, threshold) {
    if (typeof ref !== 'string' || typeof hyp !== 'string') return null;
    if (!ref || !hyp || ref === hyp) return null;
    var th = (typeof threshold === 'number') ? threshold : 0.8;
    for (var i = 0; i < PRON_RULES.length; i++) {
      var pat = PRON_RULES[i][0], rep = PRON_RULES[i][1], label = PRON_RULES[i][2];
      var hypLabel = PRON_RULES[i][4] || label;
      var r2 = ref.replace(pat, rep);
      if (r2 !== ref && charSimilarity(r2, hyp) >= th) return label;      /* ★ r2 !== ref が必須 */
      var h2 = hyp.replace(pat, rep);
      if (h2 !== hyp && charSimilarity(ref, h2) >= th) return hypLabel;   /* ★ h2 !== hyp も必須 */
    }
    return null;
  }

  /** ヒントのラベル → focus タグ('th' / 'r-l' / …)。対応が無ければ null */
  function hintToFocusTag(hint) {
    if (typeof hint !== 'string' || !hint) return null;
    return HINT_TO_TAG[hint] || null;
  }

  LC.similarity = {
    charDistance: charDistance,
    charSimilarity: charSimilarity,
    isHomophone: isHomophone,
    pronunciationHint: pronunciationHint,
    hintToFocusTag: hintToFocusTag,
    PRON_RULES: PRON_RULES
  };

  /* ============================================================
   * 3. LC.align(仕様 §5-9)
   * ============================================================ */

  var MAX_HYP_WORDS = 200;   /* 安全弁。O(N×M) が暴走しないように打ち切る */
  var MAX_REF_WORDS = 200;   /* お手本側の安全弁。自作デッキに長文を貼られても固まらせない */

  /**
   * 単語単位レーベンシュタイン DP + バックトレース。
   *
   * 置換コスト:
   *   a === b または同音異義語  → 0
   *   それ以外                  → 1 - simWeight × charSimilarity(a, b)   (0.6〜1.0)
   * 綴り類似度を混ぜることで、似た語どうしが優先的に対を作り、
   * アライメントが人間の直感に合う(three と free が対になる)。
   *
   * @param {string[]} ref 正規化済みのお手本トークン
   * @param {string[]} hyp 正規化済みの認識結果トークン
   * @param {Object=} opts simWeight=0.4 / insCost=1 / delCost=1
   * @returns {Object} ops / cost / truncated
   */
  function alignWords(ref, hyp, opts) {
    opts = opts || {};
    var simWeight = (typeof opts.simWeight === 'number') ? opts.simWeight : 0.4;
    var insCost = (typeof opts.insCost === 'number') ? opts.insCost : 1;
    var delCost = (typeof opts.delCost === 'number') ? opts.delCost : 1;

    ref = Array.isArray(ref) ? ref : [];
    hyp = Array.isArray(hyp) ? hyp : [];

    /* ★安全弁: 認識器が暴走して数百語返しても固まらないようにする。
     * お手本側(ref)も切る。自作デッキは 20 語超を警告つきで受け入れるので、
     * 改行なしの長文を 1 行貼られると ref が数百語になりうる(catalog が長さを保証しない)。
     * DP は O(ref × hyp) なので、両側に上限が要る。 */
    var truncated = false;
    if (hyp.length > MAX_HYP_WORDS) { hyp = hyp.slice(0, MAX_HYP_WORDS); truncated = true; }
    if (ref.length > MAX_REF_WORDS) { ref = ref.slice(0, MAX_REF_WORDS); truncated = true; }

    var n = ref.length, m = hyp.length, w = m + 1, i, j;
    var d = new Float64Array((n + 1) * w);
    var bp = new Uint8Array((n + 1) * w);      /* 0=diag, 1=up=deletion, 2=left=insertion */

    for (j = 1; j <= m; j++) { d[j] = j * insCost; bp[j] = 2; }
    for (i = 1; i <= n; i++) { d[i * w] = i * delCost; bp[i * w] = 1; }

    for (i = 1; i <= n; i++) {
      var a = ref[i - 1];
      var base = i * w, prevBase = (i - 1) * w;
      for (j = 1; j <= m; j++) {
        var b = hyp[j - 1];
        var sub = (a === b || isHomophone(a, b)) ? 0 : (1 - simWeight * charSimilarity(a, b));
        var diag = d[prevBase + j - 1] + sub;
        var up = d[prevBase + j] + delCost;
        var left = d[base + j - 1] + insCost;
        /* 同点のときは diag を優先する。置換として対にしたほうが表示が自然になる */
        var best = diag, dir = 0;
        if (up < best) { best = up; dir = 1; }
        if (left < best) { best = left; dir = 2; }
        d[base + j] = best;
        bp[base + j] = dir;
      }
    }

    var ops = [];
    i = n; j = m;
    while (i > 0 || j > 0) {
      var dir2;
      if (i === 0) dir2 = 2;
      else if (j === 0) dir2 = 1;
      else dir2 = bp[i * w + j];
      if (dir2 === 0) {
        var ra = ref[i - 1], hb = hyp[j - 1];
        var type = (ra === hb) ? 'correct' : (isHomophone(ra, hb) ? 'homophone' : 'substitution');
        ops.push({ type: type, refIndex: i - 1, hypIndex: j - 1, ref: ra, hyp: hb });
        i--; j--;
      } else if (dir2 === 1) {
        ops.push({ type: 'deletion', refIndex: i - 1, hypIndex: -1, ref: ref[i - 1], hyp: null });
        i--;
      } else {
        /* refIndex は「この余分な語が、お手本の何語目の後ろに入ったか」 */
        ops.push({ type: 'insertion', refIndex: i - 1, hypIndex: j - 1, ref: null, hyp: hyp[j - 1] });
        j--;
      }
    }
    ops.reverse();

    return { ops: ops, cost: d[n * w + m], truncated: truncated };
  }

  LC.align = { alignWords: alignWords, MAX_HYP_WORDS: MAX_HYP_WORDS };

  /* ============================================================
   * 4. LC.score(仕様 §5-10)
   * ============================================================ */

  var PASS_THRESHOLD = 80;
  var MAX_ATTEMPTS = 3;
  var FUNCTION_WEIGHT = 0.6;    /* 機能語は落ちても致命傷にしない */
  var CONTENT_WEIGHT = 1.0;
  var INSERTION_FACTOR = 0.5;   /* 挿入ペナルティは欠落の半分 */
  var INSERTION_CAP = 0.25;     /* 挿入だけで落ちる上限は 25% */
  var HINT_PARTIAL = 0.35;      /* ヒントが出るくらい惜しいときの最低部分点 */
  var SIM_PARTIAL_MAX = 0.5;
  var SIM_LO = 0.5, SIM_HI = 0.85;
  var NEAR_THRESHOLD = 0.2;

  /* 点数は連続量、バンドは質的条件で決める二階建て。
   * 「発音採点」ではないので、バンドのラベルも評価語を避けている(§0-1)。 */
  var BANDS = [
    { key: 'excellent', min: 90, emoji: '◎', label: 'そのまま通じる',
      comment: 'ほぼお手本どおりに伝わりました。' },
    { key: 'good', min: 75, emoji: '○', label: 'だいたい通じる',
      comment: '意味は通ります。あと数語で満点です。' },
    { key: 'fair', min: 55, emoji: '△', label: 'あと少し',
      comment: '主要な語は届いています。印のある語だけ練習しましょう。' },
    { key: 'retry', min: 0, emoji: '▢', label: 'もう一度',
      comment: 'ゆっくり聞き直して、区切って言ってみましょう。' }
  ];

  function weightOf(word) {
    return FUNCTION_WORDS.has(word) ? FUNCTION_WEIGHT : CONTENT_WEIGHT;
  }

  /**
   * 点数とバンドを決める。
   * ★追加ルール★ 内容語(機能語以外)に置換または欠落が 1 つでもあれば、
   * 90 点以上でも excellent にせず good に降格する。
   * これが無いと「a が抜けただけの 90 点」と
   * 「right を light と言った 91 点」が同じ最高評価になってしまう。
   */
  function bandFor(score, contentErrors) {
    var i, b = BANDS[BANDS.length - 1];
    for (i = 0; i < BANDS.length; i++) {
      if (score >= BANDS[i].min) { b = BANDS[i]; break; }
    }
    if (b.key === 'excellent' && contentErrors > 0) {
      for (i = 0; i < BANDS.length; i++) if (BANDS[i].key === 'good') return BANDS[i];
    }
    return b;
  }

  function emptyCounts() {
    return { correct: 0, homophone: 0, substitution: 0, near: 0, deletion: 0, insertion: 0 };
  }

  /** 表示単位に畳み込んだ type を決める(1 語が 2 トークンに割れた場合の集約) */
  function foldType(c) {
    var n = c.total;
    if (n === 0) return 'ignored';
    if (c.correct === n) return 'correct';
    if (c.correct + c.homophone === n) return 'homophone';
    if (c.deletion === n) return 'deletion';
    if (c.substitution === n) return (c.near === c.substitution) ? 'near' : 'substitution';
    return 'partial';   /* do not のように一部だけ通った表示単位 */
  }

  /**
   * 1 回の発話を採点する。
   *
   * スコア式(生の WER は使わない):
   *   w(語)       = 機能語なら 0.6、それ以外 1.0
   *   totalWeight = Σ w(お手本の各語)
   *   credit      = w                 … correct / homophone
   *               = w × partial       … substitution
   *               = 0                 … deletion
   *   partial     = max( 0.5 × ramp(charSimilarity, 0.5, 0.85), hint ? 0.35 : 0 )
   *   insPenalty  = min( 挿入語数 × 0.5 × 平均重み, totalWeight × 0.25 )
   *   score       = round( 100 × clamp((Σcredit − insPenalty) / totalWeight, 0, 1) )
   *
   * @param {string} reference  お手本(原文)
   * @param {string} hypothesis 認識結果(生テキスト)
   * @param {Object=} opts simWeight / normalize(tokenize のオプション)
   * @returns {Object} ScoreResult(仕様 §5-10 の全フィールド)
   */
  function scoreUtterance(reference, hypothesis, opts) {
    opts = opts || {};
    var refText = (typeof reference === 'string') ? reference : '';
    var hypText = (typeof hypothesis === 'string') ? hypothesis.trim() : '';

    /* ★お手本側にも必ず同じ tokenize を適用する。
     * 片側だけだと数字・縮約形・英米綴りで必ず不一致になる。 */
    var refTok = tokenize(refText, opts.normalize);
    var hypTok = tokenize(hypText, opts.normalize);
    var refWords = normWords(refTok);
    var hypWords = normWords(hypTok);

    var aligned = alignWords(refWords, hypWords, opts);
    var ops = aligned.ops;
    var counts = emptyCounts();

    var totalWeight = 0, i;
    for (i = 0; i < refWords.length; i++) totalWeight += weightOf(refWords[i]);
    var avgWeight = refWords.length ? (totalWeight / refWords.length) : CONTENT_WEIGHT;

    var sumCredit = 0, insertionCount = 0, contentErrors = 0;
    var insertions = [];

    for (i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (op.type === 'insertion') {
        counts.insertion++;
        insertionCount++;
        op.weight = 0; op.credit = 0; op.near = false; op.sim = 0; op.hint = null;
        insertions.push({
          word: op.hyp,
          /* UI が語の間に描けるよう、トークン添字ではなく表示単位の添字に直す */
          afterRefIndex: (op.refIndex >= 0 && refTok.tokens[op.refIndex])
            ? refTok.tokens[op.refIndex].owner : -1
        });
        continue;
      }

      var w = weightOf(op.ref);
      op.weight = w;
      op.sim = 0;
      op.hint = null;
      op.near = false;

      if (op.type === 'correct') {
        counts.correct++;
        op.sim = 1;
        op.credit = w;
      } else if (op.type === 'homophone') {
        counts.homophone++;
        op.sim = charSimilarity(op.ref, op.hyp);
        op.credit = w;                       /* 音は同じ = 伝わっている */
      } else if (op.type === 'substitution') {
        counts.substitution++;
        op.sim = charSimilarity(op.ref, op.hyp);
        op.hint = pronunciationHint(op.ref, op.hyp);
        var partial = Math.max(SIM_PARTIAL_MAX * ramp(op.sim, SIM_LO, SIM_HI),
                               op.hint ? HINT_PARTIAL : 0);
        op.near = partial >= NEAR_THRESHOLD;
        if (op.near) counts.near++;
        op.credit = w * partial;
        if (!FUNCTION_WORDS.has(op.ref)) contentErrors++;
      } else {  /* deletion */
        counts.deletion++;
        op.credit = 0;
        if (!FUNCTION_WORDS.has(op.ref)) contentErrors++;
      }
      sumCredit += op.credit;
    }

    /* 挿入ペナルティを欠落の半分にする理由:
     * 言い直し・自己修正で語が増えるのは自然で、認識器が勝手に語を足すことも多い。
     * 上限 25% は「認識器の暴走で 0 点」という事故を防ぐため。 */
    var insPenalty = Math.min(insertionCount * INSERTION_FACTOR * avgWeight,
                              totalWeight * INSERTION_CAP);

    var score = 0;
    if (totalWeight > 0) {
      score = Math.round(100 * clamp((sumCredit - insPenalty) / totalWeight, 0, 1));
    }

    var band = bandFor(score, contentErrors);

    /* --- 表示単位への畳み込み --- */
    var byOwner = [];
    for (i = 0; i < refTok.display.length; i++) byOwner.push([]);
    for (i = 0; i < ops.length; i++) {
      var o2 = ops[i];
      if (o2.type === 'insertion') continue;
      var tk = refTok.tokens[o2.refIndex];
      if (tk && byOwner[tk.owner]) byOwner[tk.owner].push(o2);
    }

    var segments = [];
    for (i = 0; i < refTok.display.length; i++) {
      var disp = refTok.display[i];
      var list = byOwner[i];
      var c = { total: list.length, correct: 0, homophone: 0, substitution: 0, near: 0, deletion: 0 };
      var credit = 0, weight = 0, hint = null, heardWords = [], k;
      for (k = 0; k < list.length; k++) {
        var s = list[k];
        c[s.type]++;
        if (s.type === 'substitution' && s.near) c.near++;
        credit += s.credit;
        weight += s.weight;
        if (!hint && s.hint) hint = s.hint;
        /* 綴りが変わった語だけ「→ ◯◯ と聞こえました」に出す */
        if (s.hyp && s.hyp !== s.ref) heardWords.push(s.hyp);
      }
      segments.push({
        text: disp.text,
        index: i,
        type: foldType(c),
        hyp: heardWords,
        hint: hint,
        credit: credit,
        weight: weight
      });
    }

    var refLen = refWords.length;
    var wer = refLen ? ((counts.substitution + counts.deletion + counts.insertion) / refLen) : 0;

    return {
      score: score,
      band: band.key,
      bandLabel: band.label,
      bandEmoji: band.emoji,
      comment: band.comment,
      contentErrors: contentErrors,
      wer: wer,
      accuracy: clamp(1 - wer, 0, 1),
      counts: counts,
      segments: segments,
      insertions: insertions,
      heard: hypText,
      normalized: { ref: refWords, hyp: hypWords },
      ops: ops,
      matchedReference: refText,
      /* 「◯語中◯語が伝わりました」用。正解 + 同音異義語だけを「伝わった」と数える */
      plain: { deliveredWords: counts.correct + counts.homophone, totalWords: refLen },
      truncated: aligned.truncated,
      fillersHeard: hypTok.fillersFound
    };
  }

  function toStringList(v) {
    var out = [], i;
    if (typeof v === 'string') return [v];
    if (!Array.isArray(v)) return out;
    for (i = 0; i < v.length; i++) if (typeof v[i] === 'string') out.push(v[i]);
    return out;
  }

  /** 同点なら内容語の誤りが少ないほう、それも同じなら余分な語が少ないほうを採る */
  function isBetter(a, b) {
    if (!b) return true;
    if (a.score !== b.score) return a.score > b.score;
    if (a.contentErrors !== b.contentErrors) return a.contentErrors < b.contentErrors;
    return a.counts.insertion < b.counts.insertion;
  }

  /**
   * 別解(phrase.text + phrase.accept)× 認識の代替候補の総当たりで最良を採る。
   * ★初級者の点数が理不尽に下がるのを防ぐ最重要の救済★
   * 通常は最大 4×3 = 12 回。念のため 6×6 で頭打ちにしておく。
   */
  function scoreBest(references, alternatives, opts) {
    var refs = toStringList(references);
    var alts = toStringList(alternatives);
    if (!refs.length) refs = [''];
    if (!alts.length) alts = [''];
    if (refs.length > 6) refs = refs.slice(0, 6);
    if (alts.length > 6) alts = alts.slice(0, 6);

    var best = null, r, i, j;
    for (i = 0; i < refs.length; i++) {
      for (j = 0; j < alts.length; j++) {
        r = scoreUtterance(refs[i], alts[j], opts);
        r.matchedReference = refs[i];
        if (isBetter(r, best)) best = r;
      }
    }
    return best;
  }

  /**
   * 通じ率クリア判定。
   * 「3 回中 2 回、機械に伝わりました。クリア!」
   *   (1) 1 回の誤認識で落とされない
   *   (2) まぐれ 1 回でクリアにならない
   *   (3) 必然的に 3 回発話させる
   * を同時に満たす。本アプリで最も重要な単一の設計判断。
   *
   * @param {Array} scores 数値の配列でも ScoreResult の配列でもよい
   * @param {number=} threshold 既定 80
   */
  function passRate(scores, threshold) {
    var th = (typeof threshold === 'number') ? threshold : PASS_THRESHOLD;
    var pass = 0, total = 0, i, s;
    if (Array.isArray(scores)) {
      for (i = 0; i < scores.length; i++) {
        s = scores[i];
        if (s && typeof s === 'object') s = s.score;
        if (typeof s !== 'number' || !isFinite(s)) continue;   /* 除外された試行は数えない */
        total++;
        if (s >= th) pass++;
      }
    }
    return {
      pass: pass,
      total: total,
      rate: total ? (pass / total) : 0,
      cleared: pass >= 2 && total >= MAX_ATTEMPTS
    };
  }

  LC.score = {
    scoreUtterance: scoreUtterance,
    scoreBest: scoreBest,
    passRate: passRate,
    bandFor: bandFor,
    weightOf: weightOf,
    BANDS: BANDS,
    PASS_THRESHOLD: PASS_THRESHOLD,
    MAX_ATTEMPTS: MAX_ATTEMPTS
  };

  LC.__loaded = (LC.__loaded || []).concat(['normalize', 'similarity', 'align', 'score']);
})(window.LC);

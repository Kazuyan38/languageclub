/* test/cases.js — 「つたわる English」自己テストの中身
 *
 * このファイルは test/test.html からだけ読み込まれる。
 * test.html が先に定義しているミニ DSL(test / eq / near / ok / skip)を使う。
 *
 * ここでテストするのは「DOM に触らない層」だけ:
 *   LC.normalize / LC.similarity / LC.align / LC.score / LC.catalog / LC.settings / LC.store
 * 音声(speaker / recognizer)と画面(screens)は人間が手で確かめる。自動化しない。
 *
 * ★部員へ: data/decks.js にフレーズを足したら、このテストを開いてください。
 *   id の重複・語数オーバー・終止符の付け忘れは「同梱デッキの検証」で落ちます。
 */
(function () {
  'use strict';

  var LC = window.LC;

  /* ------------------------------------------------------------------ *
   * 共通ヘルパ
   * ------------------------------------------------------------------ */

  /** 依存モジュールが読み込まれているか。無ければ 1 件だけ失敗にして打ち切る */
  function requires() {
    var missing = [];
    for (var i = 0; i < arguments.length; i++) {
      if (!LC || !LC[arguments[i]]) missing.push('LC.' + arguments[i]);
    }
    if (missing.length) {
      ok(false, missing.join(' / ') + ' が読み込まれていません(担当ファイル未作成か構文エラー)');
      return false;
    }
    return true;
  }

  /** tokenize() の tokens を文字列配列にする。{norm,owner} でも素の文字列でも拾う */
  function norms(res) {
    var list = (res && res.tokens) || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      out.push(t && typeof t === 'object' ? t.norm : t);
    }
    return out;
  }

  /** align の op から語を取り出す。実装が素の文字列でもトークンオブジェクトでも壊れないように */
  function opWord(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return v.norm || v.text || '';
    return String(v);
  }

  /** op の種類ごとの件数を数える */
  function countOps(ops) {
    var c = {};
    for (var i = 0; i < (ops || []).length; i++) {
      var t = ops[i] && ops[i].type;
      c[t] = (c[t] || 0) + 1;
    }
    return c;
  }

  function words(s) {
    s = String(s).trim();
    return s === '' ? [] : s.split(/\s+/);
  }

  /** エラー報告の行番号を、実装が {line:2} でも 'L2: ...' でも拾えるようにする */
  function errLine(e) {
    if (e && typeof e === 'object') {
      if (typeof e.line === 'number') return e.line;
      if (typeof e.lineNumber === 'number') return e.lineNumber;
      if (typeof e.lineNo === 'number') return e.lineNo;
      if (typeof e.message === 'string') {
        var mm = e.message.match(/(\d+)/);
        return mm ? Number(mm[1]) : null;
      }
      return null;
    }
    var m = String(e).match(/(\d+)/);
    return m ? Number(m[1]) : null;
  }

  function hasErrLine(errors, line) {
    for (var i = 0; i < (errors || []).length; i++) {
      if (errLine(errors[i]) === line) return true;
    }
    return false;
  }

  /* ================================================================== *
   * 1. LC.score の回帰テスト(仕様 §5-10 末尾の検証表 10 ケース)
   *    点数は ±4 点の許容、バンドは完全一致。
   * ================================================================== */

  var SCORE_CASES = [
    { ref: 'I would like a cup of coffee, please.',
      hyp: 'i would like a cup of coffee please',
      score: 100, band: 'excellent', perfect: true },

    { ref: 'I would like a cup of coffee, please.',
      hyp: 'i want a coffee please',
      score: 53, band: 'retry' },

    { ref: 'There are three books on the desk.',
      hyp: 'there are free books on the desk',
      score: 88, band: 'good', hintWord: 'three', hintRe: /th/i },

    { ref: "I don't think so.",
      hyp: 'i do not think so',
      score: 100, band: 'excellent', perfect: true },

    { ref: 'I have two brothers.',
      hyp: 'i have 2 brothers',
      score: 100, band: 'excellent', perfect: true },

    { ref: 'Their car is new.',
      hyp: 'there car is new',
      score: 100, band: 'excellent', perfect: true },

    { ref: 'My favourite colour is grey.',
      hyp: 'my favorite color is gray',
      score: 100, band: 'excellent', perfect: true },

    /* 内容語(right→light)の誤りがあるので 90 点台でも excellent に上げない */
    { ref: 'Please turn right at the next corner.',
      hyp: 'please turn light at the next corner',
      score: 91, band: 'good' },

    { ref: 'She is a member of the English club.',
      hyp: 'she is member of english club',
      score: 81, band: 'good' },

    { ref: 'Nice to meet you.',
      hyp: '',
      score: 0, band: 'retry' }
  ];

  SCORE_CASES.forEach(function (c, i) {
    test('score ' + (i + 1) + ': 「' + c.ref + '」← 「' + (c.hyp || '(無音)') + '」', function () {
      if (!requires('score')) return;
      var r = LC.score.scoreUtterance(c.ref, c.hyp, {});
      if (!r || typeof r !== 'object') { ok(false, 'ScoreResult が返らない'); return; }

      near(r.score, c.score, 4, '点数(期待 ' + c.score + ' ±4)');
      eq(r.band, c.band, 'バンド');
      ok(typeof r.bandLabel === 'string' && r.bandLabel !== '', 'bandLabel が入っている');
      ok(r.plain && typeof r.plain.totalWords === 'number' && r.plain.totalWords > 0,
        'plain.totalWords が 1 以上');

      if (c.perfect) {
        eq(r.plain.deliveredWords, r.plain.totalWords, '満点なら「◯語中◯語」が全語');
        eq(r.contentErrors, 0, '内容語エラーが 0');
      }

      if (c.hintWord) {
        var seg = null;
        for (var k = 0; k < (r.segments || []).length; k++) {
          if (String(r.segments[k].text).toLowerCase() === c.hintWord) { seg = r.segments[k]; break; }
        }
        ok(seg !== null, '「' + c.hintWord + '」のセグメントがある');
        if (seg) {
          ok(!!seg.hint, '「' + c.hintWord + '」に発音ヒントが付いている');
          ok(!!seg.hint && c.hintRe.test(seg.hint), 'ヒントが期待した音の種類(' + c.hintRe + ')');
        }
      }
    });
  });

  test('score: 内容語の誤りがあると 90 点以上でも excellent に昇格しない', function () {
    if (!requires('score')) return;
    var r = LC.score.scoreUtterance('Please turn right at the next corner.',
      'please turn light at the next corner', {});
    ok(r.score >= 88, '点数は 88 以上(実際 ' + r.score + ')');
    ok(r.contentErrors >= 1, '内容語エラーが 1 以上');
    ok(r.band !== 'excellent', 'band が excellent ではない');
  });

  test('score: scoreBest が別解 × 認識代替候補の総当たりで最良を採る', function () {
    if (!requires('score')) return;
    var refs = ["I don't think so.", 'I do not think so.'];
    var alts = ['i do not sink so', 'i do not think so'];
    var r = LC.score.scoreBest(refs, alts, {});
    near(r.score, 100, 4, '最良の組み合わせで満点');
    ok(typeof r.heard === 'string', 'heard に認識結果の生テキストが入る');
  });

  test('score: 定数とバンド定義', function () {
    if (!requires('score')) return;
    eq(LC.score.PASS_THRESHOLD, 80, 'PASS_THRESHOLD は 80');
    eq(LC.score.MAX_ATTEMPTS, 3, 'MAX_ATTEMPTS は 3');
    ok(!!LC.score.BANDS, 'BANDS が公開されている');
  });

  test('score: passRate は「3 回中 2 回」でクリア', function () {
    if (!requires('score')) return;
    var a = LC.score.passRate([90, 60, 85]);
    eq(a.pass, 2, '合格回数');
    eq(a.total, 3, '試行回数');
    eq(a.cleared, true, '3 回中 2 回でクリア');

    var b = LC.score.passRate([90, 60, 40]);
    eq(b.pass, 1, '1 回だけ通った場合の合格回数');
    eq(b.cleared, false, '1 回だけではクリアにしない');

    /* まぐれ 1 回、あるいは 2 回だけの試行でクリアにしてはいけない */
    var c = LC.score.passRate([95, 92]);
    eq(c.cleared, false, '2 回しか話していなければクリアにしない');
  });

  /* ================================================================== *
   * 2. LC.similarity.pronunciationHint(仕様 §5-8 の検証済み期待出力 6 件)
   *    文言そのものではなく「どの音のヒントが出るか」を検証する。
   * ================================================================== */

  test('pronunciationHint: three / free → th のヒント', function () {
    if (!requires('similarity')) return;
    var h = LC.similarity.pronunciationHint('three', 'free');
    ok(!!h, 'ヒントが返る(null ではない)');
    ok(!!h && /th/i.test(h), 'th のヒント(実際: ' + h + ')');
    eq(LC.similarity.hintToFocusTag(h), 'th', 'focus タグは th');
  });

  test('pronunciationHint: right / light → R と L のヒント', function () {
    if (!requires('similarity')) return;
    var h = LC.similarity.pronunciationHint('right', 'light');
    ok(!!h, 'ヒントが返る');
    ok(!!h && /R/.test(h) && /L/.test(h), 'R と L のヒント(実際: ' + h + ')');
    /* ★ pronunciationHint は「ルール適用で綴りが変わったか」を確認しないと
     *   ここに th のヒントが出る(仕様 §5-8 の実バグ注意)。それを踏む回帰テスト */
    ok(!!h && !/th/i.test(h), 'th のヒントが誤って出ていない');
    eq(LC.similarity.hintToFocusTag(h), 'r-l', 'focus タグは r-l');
  });

  test('pronunciationHint: very / berry → V と B のヒント', function () {
    if (!requires('similarity')) return;
    var h = LC.similarity.pronunciationHint('very', 'berry');
    ok(!!h, 'ヒントが返る');
    ok(!!h && /V/.test(h) && /B/.test(h), 'V と B のヒント(実際: ' + h + ')');
    eq(LC.similarity.hintToFocusTag(h), 'v-b', 'focus タグは v-b');
  });

  test('pronunciationHint: think / sink → th のヒント', function () {
    if (!requires('similarity')) return;
    var h = LC.similarity.pronunciationHint('think', 'sink');
    ok(!!h, 'ヒントが返る');
    ok(!!h && /th/i.test(h), 'th のヒント(実際: ' + h + ')');
  });

  test('pronunciationHint: sit / seat → 長母音のヒント', function () {
    if (!requires('similarity')) return;
    var h = LC.similarity.pronunciationHint('sit', 'seat');
    ok(!!h, 'ヒントが返る');
    ok(!!h && /母音/.test(h), '母音の長さのヒント(実際: ' + h + ')');
  });

  test('pronunciationHint: coffee / car → null(似ていない語に無理な説明をしない)', function () {
    if (!requires('similarity')) return;
    eq(LC.similarity.pronunciationHint('coffee', 'car'), null, 'null が返る');
  });

  test('similarity: 同音異義語の判定', function () {
    if (!requires('similarity')) return;
    eq(LC.similarity.isHomophone('their', 'there'), true, 'their / there');
    eq(LC.similarity.isHomophone('two', 'too'), true, 'two / too');
    eq(LC.similarity.isHomophone('right', 'light'), false, 'right / light は同音ではない');
    eq(LC.similarity.charSimilarity('abc', 'abc'), 1, '同一文字列の類似度は 1');
  });

  /* ================================================================== *
   * 3. LC.normalize.tokenize
   * ================================================================== */

  test('tokenize: 縮約形をホワイトリストで展開する', function () {
    if (!requires('normalize')) return;
    eq(norms(LC.normalize.tokenize("I don't think so.")), ['i', 'do', 'not', 'think', 'so'],
      "I don't think so.");
    /* Chrome の認識結果はアポストロフィが落ちることがある */
    eq(norms(LC.normalize.tokenize('i dont think so')), ['i', 'do', 'not', 'think', 'so'],
      'アポストロフィ無しの dont も展開する');
    eq(norms(LC.normalize.tokenize("I'm a student.")), ['i', 'am', 'a', 'student'], "I'm → i am");
    eq(norms(LC.normalize.tokenize("We're happy.")), ['we', 'are', 'happy'], "We're → we are");
  });

  test('tokenize: its / were / well は絶対に展開しない(普通の語と衝突する)', function () {
    if (!requires('normalize')) return;
    eq(norms(LC.normalize.tokenize('The dog wagged its tail.')),
      ['the', 'dog', 'wagged', 'its', 'tail'], 'its が it is にならない');
    eq(norms(LC.normalize.tokenize('They were happy.')),
      ['they', 'were', 'happy'], 'were が we are にならない');
    eq(norms(LC.normalize.tokenize('It went well today.')),
      ['it', 'went', 'well', 'today'], 'well が we will にならない');
  });

  test("tokenize: 所有格を壊さない(John's book が John is book にならない)", function () {
    if (!requires('normalize')) return;
    var t = norms(LC.normalize.tokenize("John's book is here.")).join(' ');
    ok(!/\bjohn is\b/.test(t), "「john is」になっていない(実際: " + t + ")");
    ok(/john/.test(t), 'john が残っている');
    eq(t.split(' ').length, 4, 'トークン数は 4(john… book is here)');
  });

  test('tokenize: 数字と数詞を相互に吸収する', function () {
    if (!requires('normalize')) return;
    eq(norms(LC.normalize.tokenize('I have 2 brothers.')),
      norms(LC.normalize.tokenize('I have two brothers.')), '2 と two が同じトークン列');
    eq(norms(LC.normalize.tokenize('It costs 15 dollars.')),
      norms(LC.normalize.tokenize('It costs fifteen dollars.')), '15 と fifteen');
    /* 4 桁 1100〜2099 かつ下 2 桁 ≠ 00 は年号読み */
    eq(norms(LC.normalize.tokenize('It was 1999.')),
      ['it', 'was', 'nineteen', 'ninety', 'nine'], '1999 は年号読み');
  });

  test('tokenize: 英米綴りを単語リストで吸収する(正規表現ルールではない)', function () {
    if (!requires('normalize')) return;
    eq(norms(LC.normalize.tokenize('My favourite colour is grey.')),
      ['my', 'favorite', 'color', 'is', 'gray'], 'favourite / colour / grey');
    /* ★ -ise → -ize の正規表現ルールを書くとここが落ちる */
    var t1 = norms(LC.normalize.tokenize('What a surprise.')).join(' ');
    ok(/surprise/.test(t1) && !/surprize/.test(t1), 'surprise が surprize にならない');
    var t2 = norms(LC.normalize.tokenize('Please advise me.')).join(' ');
    ok(/advise/.test(t2) && !/advize/.test(t2), 'advise が advize にならない');
  });

  test('tokenize: フィラーを除去して fillersFound に記録する', function () {
    if (!requires('normalize')) return;
    var r = LC.normalize.tokenize('Um, I think, uh, so.');
    eq(norms(r), ['i', 'think', 'so'], 'フィラーがトークンから消える');
    var found = (r.fillersFound || []).join(' ');
    ok(/um/.test(found), 'fillersFound に um');
    ok(/uh/.test(found), 'fillersFound に uh');
  });

  test('tokenize: display と tokens が owner で結びついている', function () {
    if (!requires('normalize')) return;
    var r = LC.normalize.tokenize("I don't think so.");
    var d = r.display || [];
    ok(d.length > 0, 'display が空でない');

    /* すべてのトークンが有効な display を指している */
    var badOwner = [];
    for (var i = 0; i < r.tokens.length; i++) {
      var o = r.tokens[i].owner;
      if (typeof o !== 'number' || o < 0 || o >= d.length) badOwner.push(i + '→' + o);
    }
    eq(badOwner.join(','), '', 'tokens[].owner がすべて display の範囲内');

    /* tokenCount の合計 = トークン総数 */
    var sum = 0;
    for (var j = 0; j < d.length; j++) sum += (d[j].tokenCount || 0);
    eq(sum, r.tokens.length, 'display[].tokenCount の合計 = tokens 数');

    /* don't は 1 語が 2 トークン(do / not)に割れる */
    var di = -1;
    for (var k = 0; k < d.length; k++) {
      if (/^don'?t$/i.test(String(d[k].text).replace(/[^A-Za-z']/g, ''))) { di = k; break; }
    }
    ok(di >= 0, "display に don't がある");
    if (di >= 0) {
      eq(d[di].tokenCount, 2, "don't の tokenCount は 2");
      var owned = [];
      for (var m = 0; m < r.tokens.length; m++) if (r.tokens[m].owner === di) owned.push(r.tokens[m].norm);
      eq(owned, ['do', 'not'], "don't が所有するトークンは do / not");
    }
  });

  test('tokenize: 段階 A(大文字小文字・句読点・余分な空白)を吸収する', function () {
    if (!requires('normalize')) return;
    eq(norms(LC.normalize.tokenize('  Hello,   WORLD!  ')), ['hello', 'world'],
      '先頭スペース・連続スペース・大文字・句読点');
    eq(norms(LC.normalize.tokenize('I live in the U.S.A.')).slice(-1)[0], 'usa', 'U.S.A. → usa');
  });

  test('tokenize: お手本側にも同じ関数を適用できる(片側だけだと必ず不一致になる)', function () {
    if (!requires('normalize')) return;
    var ref = norms(LC.normalize.tokenize("I don't have 2 dollars."));
    var hyp = norms(LC.normalize.tokenize('I do not have two dollars.'));
    eq(ref, hyp, 'お手本と認識結果が同じトークン列になる');
  });

  /* ================================================================== *
   * 4. LC.align.alignWords
   * ================================================================== */

  test('alignWords: 完全一致', function () {
    if (!requires('align')) return;
    var r = LC.align.alignWords(words('the cat sat'), words('the cat sat'), {});
    eq(r.ops.length, 3, 'op は 3 件');
    eq(countOps(r.ops).correct, 3, 'すべて correct');
    eq(r.cost, 0, 'コスト 0');
    ok(!r.truncated, 'truncated ではない');
  });

  test('alignWords: 置換', function () {
    if (!requires('align')) return;
    var r = LC.align.alignWords(words('the cat sat'), words('the dog sat'), {});
    var c = countOps(r.ops);
    eq(r.ops.length, 3, 'op は 3 件');
    eq(c.substitution, 1, 'substitution が 1 件');
    eq(c.correct, 2, 'correct が 2 件');
    var sub = null;
    for (var i = 0; i < r.ops.length; i++) if (r.ops[i].type === 'substitution') sub = r.ops[i];
    eq(opWord(sub.ref), 'cat', '置換元は cat');
    eq(opWord(sub.hyp), 'dog', '置換先は dog');
  });

  test('alignWords: 欠落', function () {
    if (!requires('align')) return;
    var r = LC.align.alignWords(words('i have two books'), words('i have books'), {});
    var c = countOps(r.ops);
    eq(c.deletion, 1, 'deletion が 1 件');
    eq(c.correct, 3, 'correct が 3 件');
    ok(!c.insertion, 'insertion は無い');
    var del = null;
    for (var i = 0; i < r.ops.length; i++) if (r.ops[i].type === 'deletion') del = r.ops[i];
    eq(opWord(del.ref), 'two', '抜けたのは two');
  });

  test('alignWords: 挿入', function () {
    if (!requires('align')) return;
    var r = LC.align.alignWords(words('i like it'), words('i really like it'), {});
    var c = countOps(r.ops);
    eq(c.insertion, 1, 'insertion が 1 件');
    eq(c.correct, 3, 'correct が 3 件');
    ok(!c.deletion, 'deletion は無い');
    var ins = null;
    for (var i = 0; i < r.ops.length; i++) if (r.ops[i].type === 'insertion') ins = r.ops[i];
    eq(opWord(ins.hyp), 'really', '余分なのは really');
  });

  test('alignWords: 同音異義語は homophone として扱う(置換コスト 0)', function () {
    if (!requires('align')) return;
    var r = LC.align.alignWords(words('their car'), words('there car'), {});
    var c = countOps(r.ops);
    eq(c.homophone, 1, 'homophone が 1 件');
    ok(!c.substitution, 'substitution にはしない');
  });

  test('alignWords: 201 語で打ち切って truncated を返す(安全弁)', function () {
    if (!requires('align')) return;
    var ref = words('one two three');
    var long201 = [], long200 = [];
    for (var i = 0; i < 201; i++) { long201.push('w' + i); if (i < 200) long200.push('w' + i); }
    eq(LC.align.alignWords(ref, long201, {}).truncated, true, '201 語 → truncated:true');
    ok(!LC.align.alignWords(ref, long200, {}).truncated, '200 語 → 打ち切らない');
  });

  /* ================================================================== *
   * 5. LC.catalog.validateDeck
   * ================================================================== */

  function goodDeck() {
    return {
      id: 'zz-test', title: 'テスト用', subtitle: 'テストのためだけのデッキ',
      icon: '🧪', level: 1, order: 999,
      phrases: [
        { id: 'zz-01', text: 'This is a test sentence.', accept: [],
          ja: 'これはテスト用の文です。', focus: ['th'] },
        { id: 'zz-02', text: 'Please try it again slowly.', accept: ['Please try again slowly.'],
          ja: 'もう一度ゆっくりやってみてください。', focus: [] }
      ]
    };
  }

  test('validateDeck: 正常なデッキは通る', function () {
    if (!requires('catalog')) return;
    var r = LC.catalog.validateDeck(goodDeck());
    eq(r.ok, true, 'ok:true');
    eq((r.errors || []).length, 0, 'エラー 0 件');
    ok(!!r.deck, 'deck が返る');
  });

  /* ★壊れたフレーズが 1 件あってもデッキ全体は落とさない設計(リスク R8)。
   *   1 文字のタイポで残り 5 フレーズまで練習できなくなるほうが害が大きいため、
   *   壊れたフレーズだけを捨てて errors に理由を残す。
   *   → だから「ok:false になること」ではなく
   *     「errors に報告され、壊れたフレーズが落ちていること」を検証する。
   *   同梱デッキのタイポは、下の「全デッキが errors 0 件」で必ず落ちる。 */

  test('validateDeck: フレーズ id の重複を検出し、重複した側を落とす', function () {
    if (!requires('catalog')) return;
    var d = goodDeck();
    d.phrases[1].id = d.phrases[0].id;
    var r = LC.catalog.validateDeck(d);
    ok((r.errors || []).length >= 1, 'エラーが報告される');
    eq(r.deck ? r.deck.phrases.length : -1, 1, '重複したフレーズが落ちて 1 件になる');
  });

  test('validateDeck: text が空のフレーズを検出して落とす', function () {
    if (!requires('catalog')) return;
    var d = goodDeck();
    d.phrases[0].text = '   ';
    var r = LC.catalog.validateDeck(d);
    ok((r.errors || []).length >= 1, 'エラーが報告される');
    eq(r.deck ? r.deck.phrases.length : -1, 1, '空のフレーズが落ちて 1 件になる');
  });

  test('validateDeck: 既定タグ以外の focus を検出して取り除く', function () {
    if (!requires('catalog')) return;
    var d = goodDeck();
    d.phrases[0].focus = ['th', 'kirakira'];
    var r = LC.catalog.validateDeck(d);
    ok((r.errors || []).length >= 1, 'エラーが報告される');
    eq(r.deck ? r.deck.phrases[0].focus : null, ['th'],
       '未知タグだけ取り除かれる(苦手音の集計が静かに狂わないように)');
  });

  test('validateDeck: title / icon が空、phrases が 0 件のデッキを弾く', function () {
    if (!requires('catalog')) return;
    var noTitle = goodDeck(); noTitle.title = '';
    eq(LC.catalog.validateDeck(noTitle).ok, false, 'title が空');
    var noIcon = goodDeck(); noIcon.icon = '';
    eq(LC.catalog.validateDeck(noIcon).ok, false, 'icon が空');
    var noPhrase = goodDeck(); noPhrase.phrases = [];
    eq(LC.catalog.validateDeck(noPhrase).ok, false, 'phrases が 0 件');
    /* 落ちてもクラッシュしないこと(公開関数は例外を投げない) */
    ok(LC.catalog.validateDeck(null).ok === false, 'null を渡しても例外にならず ok:false');
  });

  /* ================================================================== *
   * 6. 同梱デッキ(data/decks.js)の全数検証
   *    ★部員がフレーズを足したとき、ここで落ちるのが狙い。
   * ================================================================== */

  test('同梱デッキ: LC.DECKS_RAW が配列で 1 件以上ある', function () {
    if (!requires('catalog')) return;
    ok(Object.prototype.toString.call(LC.DECKS_RAW) === '[object Array]', 'LC.DECKS_RAW は配列');
    ok((LC.DECKS_RAW || []).length >= 1, 'デッキが 1 件以上');
  });

  test('同梱デッキ: 全デッキが validateDeck を通り、警告も 0 件', function () {
    if (!requires('catalog') || !LC.DECKS_RAW) return;
    var bad = [];
    for (var i = 0; i < LC.DECKS_RAW.length; i++) {
      var raw = LC.DECKS_RAW[i];
      var r = LC.catalog.validateDeck(raw);
      /* ★ok:false だけでなく errors が 1 件でもあれば落とす。
       *   ok:true でも「壊れたフレーズを捨てた」報告が入りうるので、
       *   ここで errors を見ないと部員のタイポを見逃す。 */
      if (!r.ok || (r.errors || []).length) {
        var msgs = [];
        for (var j = 0; j < (r.errors || []).length; j++) {
          var e = r.errors[j];
          msgs.push(typeof e === 'string' ? e : (e && e.message) || JSON.stringify(e));
        }
        bad.push('[' + ((raw && raw.id) || '(id なし)') + '] ' + msgs.join(' / '));
      }
    }
    eq(bad.join('  ||  '), '', '検証に落ちた／警告の出たデッキ');
  });

  test('同梱デッキ: フレーズ id が全体で一意', function () {
    if (!requires('catalog') || !LC.DECKS_RAW) return;
    var seen = {}, dup = [];
    for (var i = 0; i < LC.DECKS_RAW.length; i++) {
      var ps = (LC.DECKS_RAW[i] && LC.DECKS_RAW[i].phrases) || [];
      for (var j = 0; j < ps.length; j++) {
        var id = ps[j] && ps[j].id;
        if (seen[id]) dup.push(id); else seen[id] = true;
      }
    }
    eq(dup.join(', '), '', '重複しているフレーズ id');
  });

  test('同梱デッキ: 全フレーズが 6〜20 語に収まる', function () {
    if (!requires('catalog', 'normalize') || !LC.DECKS_RAW) return;
    var bad = [];
    for (var i = 0; i < LC.DECKS_RAW.length; i++) {
      var ps = (LC.DECKS_RAW[i] && LC.DECKS_RAW[i].phrases) || [];
      for (var j = 0; j < ps.length; j++) {
        var n = norms(LC.normalize.tokenize(ps[j].text || '')).length;
        if (n < 6 || n > 20) bad.push(ps[j].id + '(' + n + ' 語)');
      }
    }
    eq(bad.join(', '), '', '語数が範囲外のフレーズ(長いと 1 回で言い切れない)');
  });

  test('同梱デッキ: 文末が . ! ? のいずれかで終わる', function () {
    if (!requires('catalog') || !LC.DECKS_RAW) return;
    var bad = [];
    for (var i = 0; i < LC.DECKS_RAW.length; i++) {
      var ps = (LC.DECKS_RAW[i] && LC.DECKS_RAW[i].phrases) || [];
      for (var j = 0; j < ps.length; j++) {
        var t = String(ps[j].text || '').trim();
        if (!/[.!?]$/.test(t)) bad.push(ps[j].id);
      }
    }
    /* 終止符が無いと TTS の抑揚が平坦になり、次の発話とつながって聞こえる */
    eq(bad.join(', '), '', '終止符が無いフレーズ');
  });

  test('同梱デッキ: ja(和訳)がすべて入っている', function () {
    if (!requires('catalog') || !LC.DECKS_RAW) return;
    var bad = [];
    for (var i = 0; i < LC.DECKS_RAW.length; i++) {
      var ps = (LC.DECKS_RAW[i] && LC.DECKS_RAW[i].phrases) || [];
      for (var j = 0; j < ps.length; j++) {
        if (!ps[j].ja || String(ps[j].ja).trim() === '') bad.push(ps[j].id);
      }
    }
    eq(bad.join(', '), '', '和訳が無いフレーズ');
  });

  /* ================================================================== *
   * 7. LC.catalog.parsePasted
   * ================================================================== */

  test('parsePasted: 正常な貼り付け', function () {
    if (!requires('catalog')) return;
    var text = 'Would you like to try our curry? | カレーはいかがですか？\n' +
               'It is three hundred yen. | 300 円です。';
    var r = LC.catalog.parsePasted(text);
    eq(r.ok, true, 'ok:true');
    eq(r.deck.phrases.length, 2, 'フレーズ 2 件');
    eq(r.deck.phrases[0].ja, 'カレーはいかがですか？', '1 行目の和訳');
    ok(/^custom-/.test(r.deck.id), 'デッキ id が custom- で始まる(実際: ' + r.deck.id + ')');
    ok(r.deck.phrases[0].id !== r.deck.phrases[1].id, 'フレーズ id が重複しない');
  });

  test('parsePasted: 先頭の # 行がカテゴリ名になる', function () {
    if (!requires('catalog')) return;
    var r = LC.catalog.parsePasted('# 学祭でつかう英語\nGood morning. | おはようございます。');
    eq(r.deck.title, '学祭でつかう英語', 'タイトル');
    eq(r.deck.phrases.length, 1, 'フレーズ 1 件(見出し行はフレーズにしない)');
  });

  test('parsePasted: 全角の｜でも区切れる', function () {
    if (!requires('catalog')) return;
    var r = LC.catalog.parsePasted('Nice to see you again.｜また会えてうれしいです。');
    eq(r.deck.phrases.length, 1, 'フレーズ 1 件');
    eq(r.deck.phrases[0].ja, 'また会えてうれしいです。', '和訳が取れている');
  });

  test('parsePasted: 空行と // 行を無視する', function () {
    if (!requires('catalog')) return;
    var text = '\n// ここはメモなので無視される\nGood night. | おやすみなさい。\n\n   \n';
    var r = LC.catalog.parsePasted(text);
    eq(r.deck.phrases.length, 1, 'フレーズ 1 件だけ');
    eq(r.deck.phrases[0].ja, 'おやすみなさい。', '和訳');
  });

  test('parsePasted: 和訳が無くても受け入れる', function () {
    if (!requires('catalog')) return;
    var r = LC.catalog.parsePasted('See you tomorrow.');
    eq(r.deck.phrases.length, 1, 'フレーズ 1 件');
  });

  test('parsePasted: エラー行を行番号つきで報告する', function () {
    if (!requires('catalog')) return;
    var text = 'Good morning. | おはようございます。\n' +   /* 1 行目 */
               '| 英文がありません\n' +                      /* 2 行目 = エラー */
               'Good night. | おやすみなさい。';             /* 3 行目 */
    var r = LC.catalog.parsePasted(text);
    ok((r.errors || []).length >= 1, 'エラーが 1 件以上');
    ok(hasErrLine(r.errors, 2), 'エラーが 2 行目を指している(実際: ' +
      JSON.stringify(r.errors) + ')');
  });

  /* ================================================================== *
   * 8. LC.settings.coerce(純関数。不正値は既定に矯正する)
   * ================================================================== */

  test('settings.coerce: 空オブジェクトは既定値になる', function () {
    if (!requires('settings')) return;
    var d = LC.settings.DEFAULTS;
    eq(LC.settings.coerce({}), d, '{} → DEFAULTS');
    eq(LC.settings.coerce(null), d, 'null → DEFAULTS');
    eq(LC.settings.coerce('こわれたデータ'), d, '文字列 → DEFAULTS');
  });

  test('settings.coerce: 列挙値の不正を既定に矯正する', function () {
    if (!requires('settings')) return;
    var d = LC.settings.DEFAULTS;
    eq(LC.settings.coerce({ lang: 'ja-JP' }).lang, d.lang, 'lang: ja-JP → 既定');
    eq(LC.settings.coerce({ lang: 'en-GB' }).lang, 'en-GB', 'lang: en-GB は通る');
    eq(LC.settings.coerce({ rate: 5 }).rate, d.rate, 'rate: 5 → 既定');
    eq(LC.settings.coerce({ rate: 1.0 }).rate, d.rate, 'rate: 1.0 は 3 段のどれでもないので既定');
    eq(LC.settings.coerce({ rate: 0.7 }).rate, 0.7, 'rate: 0.7 は通る');
    eq(LC.settings.coerce({ rate: 1.1 }).rate, 1.1, 'rate: 1.1 は通る');
    eq(LC.settings.coerce({ theme: 'neon' }).theme, d.theme, 'theme: neon → 既定');
    eq(LC.settings.coerce({ theme: 'dark' }).theme, 'dark', 'theme: dark は通る');
  });

  test('settings.coerce: 真偽値は必ず boolean になる', function () {
    if (!requires('settings')) return;
    var s = LC.settings.coerce({ showScore: 'はい', autoListen: 1, saveRecords: null });
    eq(typeof s.showScore, 'boolean', 'showScore が boolean');
    eq(typeof s.autoListen, 'boolean', 'autoListen が boolean');
    eq(typeof s.saveRecords, 'boolean', 'saveRecords が boolean');
    /* 文字列 'no' は不正値。既定(true)に矯正されるべき */
    eq(LC.settings.coerce({ saveRecords: 'no' }).saveRecords, true, "saveRecords: 'no' → 既定 true");
    eq(LC.settings.coerce({ showScore: true }).showScore, true, '正しい true は保たれる');
    eq(LC.settings.coerce({ saveRecords: false }).saveRecords, false, '正しい false は保たれる');
  });

  test('settings.coerce: voice は {name, lang} 以外を受け付けない', function () {
    if (!requires('settings')) return;
    eq(LC.settings.coerce({ voice: 'Alex' }).voice, null, '文字列 → null');
    eq(LC.settings.coerce({ voice: { name: 'X' } }).voice, null, 'lang が無い → null');
    eq(LC.settings.coerce({ voice: { name: 'Google US English', lang: 'en-US' } }).voice,
      { name: 'Google US English', lang: 'en-US' }, '正しい形は保たれる');
  });

  test('settings.coerce: 余計なキーを持ち込まない(純関数で形が確定する)', function () {
    if (!requires('settings')) return;
    var s = LC.settings.coerce({ lang: 'en-US', evil: '<script>', pitch: 2 });
    ok(!('evil' in s), '未知のキー evil が混ざらない');
    ok(!('pitch' in s), 'UI に出さない pitch が混ざらない');
    eq(Object.keys(s).sort(), Object.keys(LC.settings.DEFAULTS).sort(), 'キー集合が DEFAULTS と同じ');
  });

  /* ================================================================== *
   * 9. LC.store
   *
   * ★ここだけ localStorage を直接触る。
   *   アプリ側の規約(localStorage に触ってよいのは js/02-store.js だけ)は守るが、
   *   「壊れた JSON からの復旧」「未来バージョンの検出」は生データを書かないと再現できない。
   *   そのためテストハーネスに限り例外とし、
   *     (1) 接頭辞 lc.__test__. のキーしか使わない
   *     (2) 実行の前後で必ず後始末する
   *   の 2 点で実データを保護する。
   * ================================================================== */

  var TEST_PREFIX = 'lc.__test__.';

  function rawAvailable() {
    try {
      window.localStorage.setItem(TEST_PREFIX + 'probe', '1');
      window.localStorage.removeItem(TEST_PREFIX + 'probe');
      return true;
    } catch (e) { return false; }
  }

  function rawSet(key, value) { try { window.localStorage.setItem(key, value); } catch (e) {} }
  function rawGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }

  /** lc.__test__. で始まるキーを全部消す */
  function cleanupTestKeys() {
    try {
      var doomed = [];
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (k && k.indexOf(TEST_PREFIX) === 0) doomed.push(k);
      }
      for (var j = 0; j < doomed.length; j++) window.localStorage.removeItem(doomed[j]);
    } catch (e) {}
  }

  /* 前回の実行が途中で落ちていた場合に備えて、開始前にも掃除する */
  cleanupTestKeys();
  if (window.__TEST_CLEANUP__) window.__TEST_CLEANUP__.push(cleanupTestKeys);

  test('store: 封筒(v / at / data)で読み書きできる', function () {
    if (!requires('store')) return;
    if (!rawAvailable()) { skip('この環境では localStorage が使えないためスキップ'); return; }

    var key = TEST_PREFIX + 'envelope.v1';
    var s = LC.store.createStore({ key: key, version: 1, fallback: { n: 0 } });
    eq(s.get(), { n: 0 }, '初回は fallback');
    eq(s.set({ n: 5 }), true, 'set が true を返す');
    eq(s.get(), { n: 5 }, 'set した値が読める');

    var env = null;
    try { env = JSON.parse(rawGet(key)); } catch (e) {}
    ok(env !== null, '生の localStorage に JSON が書かれている');
    if (env) {
      eq(env.v, 1, '封筒の v');
      eq(typeof env.at, 'number', '封筒の at が数値');
      eq(env.data, { n: 5 }, '封筒の data');
    }

    s.update(function (d) { d.n = 7; return d; });
    eq(s.get().n, 7, 'update() が反映される');

    s.reset();
    eq(s.get(), { n: 0 }, 'reset() で fallback に戻る');
  });

  test('store: 壊れた JSON から fallback で復旧する', function () {
    if (!requires('store')) return;
    if (!rawAvailable()) { skip('この環境では localStorage が使えないためスキップ'); return; }

    var key = TEST_PREFIX + 'broken.v1';
    rawSet(key, '{ これは JSON ではありません');
    var s = LC.store.createStore({ key: key, version: 1, fallback: { safe: true } });
    eq(s.get(), { safe: true }, '例外を投げず fallback を返す');
    eq(s.set({ safe: false }), true, '壊れたあとも書き込める');
    eq(s.get(), { safe: false }, '書き込んだ値が読める');
  });

  test('store: v < version なら migrate が呼ばれる', function () {
    if (!requires('store')) return;
    if (!rawAvailable()) { skip('この環境では localStorage が使えないためスキップ'); return; }

    var key = TEST_PREFIX + 'migrate.v2';
    rawSet(key, JSON.stringify({ v: 1, at: 1, data: { old: true } }));
    var seen = null;
    var s = LC.store.createStore({
      key: key, version: 2, fallback: { fresh: true },
      migrate: function (data, v) { seen = v; return { migrated: true, from: v }; }
    });
    eq(s.get(), { migrated: true, from: 1 }, 'migrate の戻り値が使われる');
    eq(seen, 1, 'migrate に古い version が渡る');

    var key2 = TEST_PREFIX + 'migrate-null.v2';
    rawSet(key2, JSON.stringify({ v: 1, at: 1, data: { old: true } }));
    var s2 = LC.store.createStore({
      key: key2, version: 2, fallback: { fresh: true },
      migrate: function () { return null; }
    });
    eq(s2.get(), { fresh: true }, 'migrate が null を返したら fallback');
  });

  test('store: setDemoMode(true) の間は localStorage に書き込まない', function () {
    if (!requires('store')) return;
    if (!rawAvailable()) { skip('この環境では localStorage が使えないためスキップ'); return; }

    var key = TEST_PREFIX + 'demo.v1';
    var s = LC.store.createStore({ key: key, version: 1, fallback: { n: 0 } });
    s.set({ n: 1 });
    var before = rawGet(key);

    try {
      LC.store.setDemoMode(true);
      s.set({ n: 999 });
      s.flush();
      eq(rawGet(key), before, '体験モード中は生データが変わらない');
    } finally {
      /* 体験モードを解除し忘れると以降のテストが全部通らなくなる */
      LC.store.setDemoMode(false);
    }

    s.set({ n: 2 });
    ok(rawGet(key) !== before, '解除後は再び書き込める');
  });

  /* ★このテストは store の他のテストより後に置くこと。
   *   readonly モードは以降の書き込みを全部止める可能性がある。 */
  test('store: v > version(未来のデータ)なら readonly になり一切書き込まない', function () {
    if (!requires('store')) return;
    if (!rawAvailable()) { skip('この環境では localStorage が使えないためスキップ'); return; }

    var key = TEST_PREFIX + 'future.v1';
    var raw = JSON.stringify({ v: 99, at: 1, data: { fromFuture: true } });
    rawSet(key, raw);

    var s = LC.store.createStore({ key: key, version: 1, fallback: { n: 0 } });
    var wrote = s.set({ n: 1 });
    s.flush();

    eq(rawGet(key), raw, '未来のデータを書き換えない(古いキャッシュで開いた人が新しい記録を壊さない)');
    eq(wrote, false, 'set() が false を返す');
    eq(LC.store.getMode(), 'readonly', 'getMode() が readonly');
  });

  test('store: 後始末(テスト用キーがすべて消えている)', function () {
    if (!rawAvailable()) { skip('この環境では localStorage が使えないためスキップ'); return; }
    cleanupTestKeys();
    var left = [];
    try {
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (k && k.indexOf(TEST_PREFIX) === 0) left.push(k);
      }
    } catch (e) {}
    eq(left.join(', '), '', 'lc.__test__. で始まるキーが残っていない');
  });

})();

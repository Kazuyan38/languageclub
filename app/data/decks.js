/* data/decks.js — 教材データ
 * =====================================================================
 * ★ 部員がふだん編集するのは、このファイルだけです。
 *   ここに英文を足せば、アプリのホーム画面に自動で並びます。
 *   プログラムの知識は要りません。下の「書き方」をまねしてください。
 * =====================================================================
 *
 * ■ 全体のかたち
 *
 *   window.LC.DECKS_RAW = [ デッキ, デッキ, デッキ, ... ];
 *
 *   「デッキ」= 1 つのカテゴリ（自己紹介、キャンパスで、…）です。
 *   デッキは次の項目を持ちます。
 *
 *     id       半角英数字の名前。他のデッキと重複しないこと（例: 'intro'）
 *     title    画面に出る見出し（例: '自己紹介'）
 *     subtitle 見出しの下の 1 行説明
 *     icon     絵文字 1 つ
 *     level    1 = やさしい / 2 = ふつう / 3 = むずかしい
 *     order    ホーム画面に並ぶ順番（小さいほど上）
 *     phrases  フレーズの配列（下記）
 *
 *   「フレーズ」は次の項目を持ちます。
 *
 *     id     デッキ内で重複しない名前（例: 'intro-01'）
 *     text   お手本の英文。★これが読み上げられ、採点の基準になります
 *     accept 「言い方が違うだけで通じ方は同じ」言い換えの配列。無ければ []
 *     ja     日本語訳
 *     note   💡 として出るワンポイント（空文字でも可）
 *     focus  苦手音のタグ配列。無ければ []
 *
 *   focus に使えるタグは次の 7 種類だけです（苦手音の集計に使うため）。
 *
 *     'th'            th の音（three, think, that …）
 *     'r-l'           R と L の区別（right / light）
 *     'v-b'           V と B の区別（very / berry）
 *     'f-h'           F と H の区別（coffee, confident …）
 *     'vowel-length'  長母音と短母音（seat / sit）
 *     'ending-vowel'  語末に母音を足さない（class を「クラス」にしない）
 *     'linking'       語と語のつながり（what time → ワッタイム）
 *
 * ---------------------------------------------------------------------
 * ■ 教材を書くときのルール 7 つ（仕様 §9-2。守らないと通じにくくなります）
 *
 *   1. 文末に必ず終止符（`.` `?`）を打つ。
 *      無いと読み上げの抑揚が平坦になり、次の発話とつながって聞こえる。
 *
 *   2. 数字はできるだけ書かない。書く場合は数詞で書き、accept にアラビア
 *      数字版も入れる（認識器は "three hundred fifty" を 350 に変換する）。
 *
 *   3. 固有名詞（人名・大学名）は避ける。Waseda が waste a になるなど、
 *      ユーザーの発音と無関係に落ちる。Tokyo のような超高頻度語だけ許可。
 *
 *   4. 1 フレーズは 6〜14 語。長いと 1 回で言い切れず、音声認識の
 *      0.5〜1 秒の無音カットに引っかかる。
 *
 *   5. accept には「通じ方が同じ言い換え」だけを入れる。語順違いは入れない。
 *      （語順を許すと「単語が合っていれば何でも正解」になり練習にならない）
 *
 *   6. focus は既定 7 タグ以外を勝手に増やさない（苦手音の集計に使うため）。
 *
 *   7. フレーズを足したら test/test.html をダブルクリックして開く。
 *      validateDeck のテストが全デッキを舐めるので、id の重複やタイポは
 *      そこで落ちる。
 *
 * ---------------------------------------------------------------------
 * ■ 書くときの注意（これを外すとアプリ全体が真っ白になります）
 *
 *   ・英文にアポストロフィ（I'm, don't, What's）が入るときは、
 *     必ずダブルクォート " " で囲む。シングルクォートだと文が途中で切れる。
 *       ○  text: "I'm a first-year student."
 *       ×  text: 'I'm a first-year student.'
 *   ・各項目のうしろのカンマ , を消さない / 最後の要素以外に付ける。
 *   ・かっこ { } [ ] は必ず対で閉じる。
 *   ・迷ったら、既にある行をまるごとコピーして中身だけ書き換えるのが安全。
 *
 *   ※ 縮約形（I'm → I am）や数字の読み方はアプリ側の正規化器が吸収する
 *      ので、accept に必ずしも書く必要はありません。書いてあっても害は
 *      ありません。
 * =====================================================================
 */

window.LC = window.LC || {};

window.LC.DECKS_RAW = [

  /* ------------------------------------------------------------------
   * 👋 自己紹介
   * ---------------------------------------------------------------- */
  {
    id: 'intro',
    title: '自己紹介',
    subtitle: 'はじめまして、から始める 6 フレーズ',
    icon: '👋',
    level: 1,
    order: 1,
    phrases: [
      {
        id: 'intro-01',
        text: "Hi, nice to meet you. I'm a first-year student.",
        accept: ["Hi, nice to meet you. I am a first year student."],
        ja: 'はじめまして。1年生です。',
        note: 'first-year は 2 語をつなげて「ファースティヤー」に近く言うと通じます。',
        focus: ['linking']
      },
      {
        id: 'intro-02',
        text: "I'm studying economics at this university.",
        accept: ["I am studying economics at this university."],
        ja: 'この大学で経済学を勉強しています。',
        note: 'university の頭は「ユー」',
        focus: ['vowel-length']
      },
      {
        id: 'intro-03',
        text: "I joined this club because I want to speak English more.",
        accept: ["I joined this club because I wanted to speak English more."],
        ja: 'もっと英語を話したくてこのサークルに入りました。',
        note: 'because の c は濁らない',
        focus: []
      },
      {
        id: 'intro-04',
        text: "I'm from a small town near the sea.",
        accept: ["I am from a small town near the sea."],
        ja: '海の近くの小さな町の出身です。',
        note: 'sea は「シー」と長めに',
        focus: ['vowel-length']
      },
      {
        id: 'intro-05',
        text: "What's your name, and where are you from?",
        accept: ["What is your name, and where are you from?"],
        ja: 'お名前は？ご出身はどちらですか？',
        note: 'where の wh は息を強めに',
        focus: ['f-h']
      },
      {
        id: 'intro-06',
        text: "Please call me by my first name.",
        accept: [],
        ja: '下の名前で呼んでください。',
        note: 'first の r を落とさない',
        focus: ['r-l']
      }
    ]
  },

  /* ------------------------------------------------------------------
   * 🏫 キャンパスで
   * ---------------------------------------------------------------- */
  {
    id: 'campus',
    title: 'キャンパスで',
    subtitle: '道をたずねる・教室を探すときの 6 フレーズ',
    icon: '🏫',
    level: 1,
    order: 2,
    phrases: [
      {
        id: 'campus-01',
        text: "Excuse me, could you tell me where the library is?",
        accept: ["Excuse me, can you tell me where the library is?"],
        ja: 'すみません、図書館はどこか教えてもらえますか？',
        note: 'library の r と l を分けて',
        focus: ['r-l']
      },
      {
        id: 'campus-02',
        text: "The classroom is on the third floor, next to the elevator.",
        accept: [],
        ja: '教室は3階、エレベーターの隣です。',
        note: 'third の th は舌を軽く歯に',
        focus: ['th']
      },
      {
        id: 'campus-03',
        text: "Do you know what time the cafeteria opens?",
        accept: ["Do you know when the cafeteria opens?"],
        ja: '学食が何時に開くか知っていますか？',
        note: 'what time をつなげて「ワッタイム」',
        focus: ['linking']
      },
      {
        id: 'campus-04',
        text: "Go straight down this hallway and turn right at the corner.",
        accept: [],
        ja: 'この廊下をまっすぐ行って、角を右に曲がってください。',
        note: 'right と light を区別',
        focus: ['r-l']
      },
      {
        id: 'campus-05',
        text: "I think I'm lost. Is this the right building?",
        accept: ["I think I am lost. Is this the right building?"],
        ja: '道に迷ったみたいです。この建物で合っていますか？',
        note: 'think の th',
        focus: ['th', 'r-l']
      },
      {
        id: 'campus-06',
        text: "Are you taking this class too? Can I sit here?",
        accept: [],
        ja: 'この授業を取っているんですか？ここに座ってもいいですか？',
        note: 'class の語末に母音を足さない',
        focus: ['ending-vowel']
      }
    ]
  },

  /* ------------------------------------------------------------------
   * ☕ 学食・カフェで
   * ---------------------------------------------------------------- */
  {
    id: 'cafe',
    title: '学食・カフェで',
    subtitle: '注文と席とりで困らない 6 フレーズ',
    icon: '☕',
    level: 1,
    order: 3,
    phrases: [
      {
        id: 'cafe-01',
        text: "Can I get a small iced coffee, please?",
        accept: ["Could I get a small iced coffee, please?"],
        ja: 'スモールのアイスコーヒーをください。',
        note: 'coffee の f は下唇を噛む',
        focus: ['f-h']
      },
      {
        id: 'cafe-02',
        text: "Could I have this set meal with rice, please?",
        accept: ["Can I have this set meal with rice, please?"],
        ja: 'この定食をライスでお願いします。',
        note: 'rice と lice を区別',
        focus: ['r-l']
      },
      {
        id: 'cafe-03',
        text: "Do you take credit cards, or is it cash only?",
        accept: [],
        ja: 'カードは使えますか、それとも現金だけですか？',
        note: 'cards の語末に母音を足さない',
        focus: ['ending-vowel']
      },
      {
        id: 'cafe-04',
        text: "Excuse me, is this seat taken?",
        accept: ["Excuse me, is anyone sitting here?"],
        ja: 'すみません、この席は空いていますか？',
        note: 'seat は「シート」より長め',
        focus: ['vowel-length']
      },
      {
        id: 'cafe-05',
        text: "Can I have it to go, please?",
        accept: ["Could I have it to go, please?"],
        ja: '持ち帰りでお願いします。',
        note: 'have it をつなげて「ハヴィット」',
        focus: ['linking']
      },
      {
        id: 'cafe-06',
        text: "Could I get some water when you have a moment?",
        accept: [],
        ja: 'お手すきのときに水をいただけますか？',
        note: 'water の t は軽く弾く',
        focus: []
      }
    ]
  },

  /* ------------------------------------------------------------------
   * 💬 留学生と話す
   * ---------------------------------------------------------------- */
  {
    id: 'friends',
    title: '留学生と話す',
    subtitle: '会話を止めずに続けるための 6 フレーズ',
    icon: '💬',
    level: 2,
    order: 4,
    phrases: [
      {
        id: 'friends-01',
        text: "How was your weekend? Did you do anything fun?",
        accept: [],
        ja: '週末はどうでした？何か楽しいことをしました？',
        note: 'weekend の w を落とさない',
        focus: []
      },
      {
        /* 聞き返しは会話を続けるための命綱。困ったらこれを言えばよい。 */
        id: 'friends-02',
        text: "I'm sorry, could you say that again more slowly?",
        accept: ["Sorry, can you say that again more slowly?"],
        ja: 'すみません、もう一度ゆっくり言ってもらえますか？',
        note: '最重要フレーズ。that の th',
        focus: ['th']
      },
      {
        id: 'friends-03',
        text: "I don't know that word. What does it mean?",
        accept: ["I do not know that word. What does it mean?"],
        ja: 'その単語を知りません。どういう意味ですか？',
        note: "don't の t は聞こえなくてよい",
        focus: ['th']
      },
      {
        id: 'friends-04',
        text: "That sounds interesting. Tell me more about it.",
        accept: [],
        ja: '面白そうですね。もっと聞かせてください。',
        note: 'sounds の語末 s を落とさない',
        focus: ['th']
      },
      {
        id: 'friends-05',
        text: "What do you usually do after class?",
        accept: [],
        ja: '授業のあとはいつも何をしていますか？',
        note: 'usually の s は「ジュ」に近い',
        focus: []
      },
      {
        id: 'friends-06',
        text: "Do you want to have lunch together tomorrow?",
        accept: ["Would you like to have lunch together tomorrow?"],
        ja: '明日いっしょにお昼を食べませんか？',
        note: 'want to は「ワナ」でも通じる',
        focus: ['linking']
      }
    ]
  },

  /* ------------------------------------------------------------------
   * 🎪 サークル紹介（新歓）
   * ---------------------------------------------------------------- */
  {
    id: 'club',
    title: 'サークル紹介（新歓）',
    subtitle: '新歓ブースで自分たちを紹介する 6 フレーズ',
    icon: '🎪',
    level: 2,
    order: 5,
    phrases: [
      {
        id: 'club-01',
        text: "We're an English club, and we meet twice a week.",
        accept: ["We are an English club, and we meet twice a week."],
        ja: '英語のサークルで、週に2回集まっています。',
        note: 'twice の w を落とさない',
        focus: []
      },
      {
        id: 'club-02',
        text: "Anyone can join, even if you're not confident yet.",
        accept: ["Anyone can join, even if you are not confident yet."],
        ja: '自信がなくても、誰でも入れます。',
        note: 'confident の f',
        focus: ['f-h']
      },
      {
        id: 'club-03',
        text: "We practice conversation and sometimes watch movies together.",
        accept: [],
        ja: '会話の練習をしたり、みんなで映画を見たりします。',
        note: 'movies の v',
        focus: ['v-b']
      },
      {
        id: 'club-04',
        text: "Would you like to come to our next meeting?",
        accept: ["Do you want to come to our next meeting?"],
        ja: '次の集まりに来ませんか？',
        note: 'Would you を「ウッジュー」',
        focus: ['linking']
      },
      {
        id: 'club-05',
        text: "Please write your name and email on this sheet.",
        accept: ["Could you write your name and email on this sheet?"],
        ja: 'この用紙にお名前とメールアドレスを書いてください。',
        note: 'write と light を区別',
        focus: ['r-l']
      },
      {
        id: 'club-06',
        text: "We're always happy to have new members.",
        accept: ["We are always happy to have new members."],
        ja: '新しいメンバーはいつでも大歓迎です。',
        note: 'have の v',
        focus: ['v-b']
      }
    ]
  },

  /* ------------------------------------------------------------------
   * ✈ 旅行で
   * ---------------------------------------------------------------- */
  {
    id: 'travel',
    title: '旅行で',
    subtitle: '駅・空港・ホテルで使う 6 フレーズ',
    icon: '✈',
    level: 2,
    order: 6,
    phrases: [
      {
        id: 'travel-01',
        text: "Excuse me, how do I get to the train station?",
        accept: [],
        ja: 'すみません、駅へはどう行けばいいですか？',
        note: 'train の tr',
        focus: ['r-l']
      },
      {
        id: 'travel-02',
        text: "Is there a bus that goes to the airport?",
        accept: [],
        ja: '空港へ行くバスはありますか？',
        note: 'there の th',
        focus: ['th']
      },
      {
        id: 'travel-03',
        text: "Could you take a picture of us, please?",
        accept: ["Would you take a picture of us, please?"],
        ja: '私たちの写真を撮ってもらえますか？',
        note: 'picture の t は「チャ」に近い',
        focus: []
      },
      {
        id: 'travel-04',
        text: "I'd like to check in, please. Here is my passport.",
        accept: ["I would like to check in, please. Here is my passport."],
        ja: 'チェックインをお願いします。パスポートです。',
        note: 'check in をつなげて',
        focus: ['linking']
      },
      {
        id: 'travel-05',
        text: "What time does the last train leave?",
        accept: [],
        ja: '最終電車は何時に出ますか？',
        note: 'last の語末に母音を足さない',
        focus: ['ending-vowel']
      },
      {
        id: 'travel-06',
        text: "Is breakfast included in the room rate?",
        accept: [],
        ja: '朝食は部屋代に含まれていますか？',
        note: 'breakfast の r と l',
        focus: ['r-l']
      }
    ]
  }

];

/* 99-app.js の起動チェック（LC.__loaded と必須リストの突き合わせ）用。
 * 他の JS ファイルと同じ作法でロード済みであることを申告しておく。 */
window.LC.__loaded = (window.LC.__loaded || []).concat('decks');

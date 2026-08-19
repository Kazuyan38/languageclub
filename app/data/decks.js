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
            （「日本語→英語」モードでは、ja を見てこの文を言う形になります）
 *     accept 「言い方が違うだけで通じ方は同じ」言い換えの配列。無ければ []
 *     ja     日本語訳。★「日本語→英語」モードではこれだけを見て英語を言うので、
            直訳ではなく「その場面で実際に言う日本語」にし、英文が復元できる程度に
            具体的に書いてください
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
 *   4. 1 フレーズは 4〜14 語。長いと 1 回で言い切れず、音声認識の
 *      0.5〜1 秒の無音カットに引っかかる。逆に 3 語以下は短すぎて
 *      認識器が拾い損ねるので、相づちも 4 語以上の文の形にする。
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
  },

  /* ------------------------------------------------------------------
   * 👂 相づち・リアクション
   * 黙らずに反応して、相手にもっと話してもらえるようになる
   * ------------------------------------------------------------------ */
  {
    id: "reactions", title: "相づち・リアクション",
    subtitle: "黙らずに反応して、相手にもっと話してもらえるようになる",
    icon: "👂", level: 2, order: 10,
    phrases: [
      {
        id: "reactions-01",
        text: "Oh, really? That's interesting.",
        accept: ["Oh, really? That sounds interesting."],
        ja: "へえ、そうなんだ。それおもしろいね。",
        note: "really? は語尾を上げる。平坦だと興味がないように聞こえます。",
        focus: ["r-l", "th"]
      },
      {
        id: "reactions-02",
        text: "Wow, that's so cool!",
        accept: ["Wow, that's really cool!"],
        ja: "わあ、それすごくいいね!",
        note: "cool の l は口を閉じずに舌先を上に。「クー」で止めないこと。",
        focus: ["r-l", "th"]
      },
      {
        id: "reactions-03",
        text: "That's great! I'm happy for you.",
        accept: ["That's great! I'm so happy for you."],
        ja: "それはよかった!自分のことみたいにうれしいよ。",
        note: "happy for you は3語つなげて「ハピフォユー」。for を強く読まない。",
        focus: ["f-h", "linking"]
      },
      {
        id: "reactions-04",
        text: "Oh no, that sounds tough.",
        accept: ["Oh no, that sounds hard."],
        ja: "ええ、それは大変そうだね。",
        note: "tough は「タフ」。gh は f の音で、最後に母音を足さない。",
        focus: ["th", "f-h"]
      },
      {
        id: "reactions-05",
        text: "I know exactly what you mean.",
        accept: ["I know exactly how you feel."],
        ja: "その気持ち、すごくよくわかる。",
        note: "know の k は読まない。what you は「ワッチュー」とつなげる。",
        focus: ["linking"]
      },
      {
        id: "reactions-06",
        text: "Yeah, I feel the same way.",
        accept: ["Yeah, I think so too."],
        ja: "うん、私もまったく同じように思う。",
        note: "feel は口を横に引いて長め。fill にならないように。",
        focus: ["f-h", "vowel-length", "th"]
      },
      {
        id: "reactions-07",
        text: "No way! I had no idea.",
        accept: ["No way! I didn't know that."],
        ja: "うそでしょ!全然知らなかった。",
        note: "驚きの定番。No way! は強く短く、あとを少し落として言う。",
        focus: []
      },
      {
        id: "reactions-08",
        text: "Right, and then what happened?",
        accept: ["Right, so what happened next?"],
        ja: "うんうん、それでどうなったの?",
        note: "相手に続きを話してもらう一言。and then は「アンゼン」とつなげる。",
        focus: ["r-l", "th", "linking"]
      },
      {
        id: "reactions-09",
        text: "That makes sense. I never thought about it that way.",
        accept: ["That makes sense. I've never thought about it that way."],
        ja: "なるほどね。そんなふうに考えたことなかった。",
        note: "thought の th は舌を軽く歯に。sought や taught と混ざらないように。",
        focus: ["th"]
      },
      {
        id: "reactions-10",
        text: "That must have been really hard for you.",
        accept: ["That must've been really tough for you."],
        ja: "それは本当につらかったでしょうね。",
        note: "must have been は「マスタヴビン」と一気に。1語ずつ切らない。",
        focus: ["th", "r-l", "linking"]
      }
    ]
  },

  /* ------------------------------------------------------------------
   * ❓ 聞き返す・確認する
   * 聞き取れなくても、会話を止めずにその場で立て直せるようになる
   * ------------------------------------------------------------------ */
  {
    id: "clarify", title: "聞き返す・確認する",
    subtitle: "聞き取れなくても、会話を止めずにその場で立て直せるようになる",
    icon: "❓", level: 2, order: 11,
    phrases: [
      {
        id: "clarify-01",
        text: "Sorry, could you say that again?",
        accept: ["Sorry, could you repeat that?"],
        ja: "すみません、もう一度言ってもらえますか?",
        note: "最初に覚えるべき一文。Sorry? だけより丁寧で、相手も嫌な気がしません。",
        focus: ["th", "r-l"]
      },
      {
        id: "clarify-02",
        text: "Could you speak a little more slowly?",
        accept: ["Could you speak a bit more slowly?"],
        ja: "もう少しゆっくり話してもらえますか?",
        note: "slowly の sl は母音を入れずに。「スローリー」の r は l の音に。",
        focus: ["r-l"]
      },
      {
        id: "clarify-03",
        text: "Sorry, I didn't catch that last part.",
        accept: ["Sorry, I missed that last part."],
        ja: "ごめん、最後のところが聞き取れなかった。",
        note: "catch を「キャッチ」と伸ばさない。t で止める気持ちで。",
        focus: ["th", "ending-vowel"]
      },
      {
        id: "clarify-04",
        text: "What does that word mean?",
        accept: ["What's the meaning of that word?"],
        ja: "その単語ってどういう意味?",
        note: "does that は「ダゼァッ」とつなげる。word の r を落とさない。",
        focus: ["th", "r-l", "linking"]
      },
      {
        id: "clarify-05",
        text: "Do you mean we're meeting tomorrow?",
        accept: ["Are you saying we're meeting tomorrow?"],
        ja: "明日集まるってこと?(で合ってる?)",
        note: "Do you mean ...? は最強の確認表現。あとに自分の理解をそのまま続ければOK。",
        focus: ["r-l", "vowel-length"]
      },
      {
        id: "clarify-06",
        text: "How do you spell that?",
        accept: ["Could you spell that for me?"],
        ja: "それ、どうつづるの?",
        note: "名前や店名が聞き取れないときはこれ。spell の s に母音を入れない。",
        focus: ["th", "ending-vowel"]
      },
      {
        id: "clarify-07",
        text: "Sorry, I'm not sure I follow.",
        accept: ["Sorry, I'm not following you."],
        ja: "ごめん、話についていけてないかも。",
        note: "「わからない」を柔らかく言える形。I don't understand より角が立ちません。",
        focus: ["f-h", "r-l"]
      },
      {
        id: "clarify-08",
        text: "Can you say that in an easier way?",
        accept: ["Could you put that more simply?"],
        ja: "もっとやさしい言い方で言ってもらえる?",
        note: "easier は「イーズィアー」と最初を長く。in an は「イナン」とつなげる。",
        focus: ["vowel-length", "linking"]
      },
      {
        id: "clarify-09",
        text: "Could you write that down for me?",
        accept: ["Can you write that down for me?"],
        ja: "それ、ちょっと書いてもらえますか?",
        note: "write の w は読まない。write と right は同じ音です。",
        focus: ["r-l", "th"]
      },
      {
        id: "clarify-10",
        text: "Let me make sure I got that right.",
        accept: ["Just to make sure I got that right."],
        ja: "ちゃんと理解できたか確認させて。",
        note: "このあとに自分の理解を続けると、誤解をその場で防げます。",
        focus: ["r-l", "th", "linking"]
      }
    ]
  },

  /* ------------------------------------------------------------------
   * 💬 雑談を始める・広げる
   * 沈黙が気まずくならない。自分から話しかけて話題を広げられる
   * ------------------------------------------------------------------ */
  {
    id: "smalltalk", title: "雑談を始める・広げる",
    subtitle: "沈黙が気まずくならない。自分から話しかけて話題を広げられる",
    icon: "💬", level: 2, order: 12,
    phrases: [
      {
        id: "smalltalk-01",
        text: "It's so hot today, isn't it?",
        accept: ["It's really hot today, isn't it?"],
        ja: "今日、すごく暑いね。",
        note: "isn't it? は軽く下げて言うと同意を求める感じになります。",
        focus: ["th", "ending-vowel"]
      },
      {
        id: "smalltalk-02",
        text: "How was your weekend?",
        accept: ["How was your weekend, by the way?"],
        ja: "週末はどうだった?",
        note: "was your は「ワジョア」とつなげる。月曜の定番の入り口です。",
        focus: ["linking"]
      },
      {
        id: "smalltalk-03",
        text: "Did you do anything fun last night?",
        accept: ["Did you do anything last night?"],
        ja: "昨日の夜、何か楽しいことした?",
        note: "Did you は「ディジュ」。fun の f は下唇を軽く噛んで。",
        focus: ["f-h", "linking"]
      },
      {
        id: "smalltalk-04",
        text: "I'm just heading to class. How about you?",
        accept: ["I'm on my way to class. How about you?"],
        ja: "今から授業に行くところ。君は?",
        note: "class を「クラス」と伸ばさない。最後に母音を足さないのがコツ。",
        focus: ["ending-vowel", "f-h"]
      },
      {
        id: "smalltalk-05",
        text: "Have you been to that new cafe yet?",
        accept: ["Have you tried that new cafe yet?"],
        ja: "あの新しいカフェ、もう行った?",
        note: "Have you been は「ハヴュビン」。been は短く「ビン」でOK。",
        focus: ["th", "v-b", "linking"]
      },
      {
        id: "smalltalk-06",
        text: "What do you usually do on weekends?",
        accept: ["What do you do on weekends?"],
        ja: "週末っていつも何してるの?",
        note: "What do you は「ワッドュ」と一気に。話題が尽きたときの便利な一文。",
        focus: ["linking"]
      },
      {
        id: "smalltalk-07",
        text: "I've been really busy with my part-time job.",
        accept: ["I've been super busy with my part-time job."],
        ja: "最近バイトで本当に忙しくてさ。",
        note: "自分の近況を先に出すと相手も話しやすくなります。really の r に注意。",
        focus: ["r-l", "v-b"]
      },
      {
        id: "smalltalk-08",
        text: "Oh, that reminds me of something funny.",
        accept: ["Oh, that reminds me of a funny story."],
        ja: "あ、それで思い出した。おもしろい話があって。",
        note: "話をふくらませる合図。reminds me は「リマインヅミー」とつなげる。",
        focus: ["th", "r-l", "f-h"]
      },
      {
        id: "smalltalk-09",
        text: "By the way, how's your new class going?",
        accept: ["By the way, how's your new class?"],
        ja: "ところで、新しい授業はどんな感じ?",
        note: "By the way は話題を変えるときの合図。軽く速く言うのが自然です。",
        focus: ["th", "v-b", "ending-vowel"]
      },
      {
        id: "smalltalk-10",
        text: "Anyway, I should get going. See you later!",
        accept: ["Anyway, I have to get going. See you later!"],
        ja: "じゃあ、そろそろ行くね。またあとで!",
        note: "会話をきれいに終わらせる形。get going は「ゲッゴーイン」とつなげる。",
        focus: ["r-l", "linking"]
      }
    ]
  },

  /* ------------------------------------------------------------------
   * 😊 気持ちを言う
   * 今の気持ちをひと言で伝えられて、相手も反応しやすくなる
   * ------------------------------------------------------------------ */
  {
    id: "feelings", title: "気持ちを言う",
    subtitle: "今の気持ちをひと言で伝えられて、相手も反応しやすくなる",
    icon: "😊", level: 2, order: 13,
    phrases: [
      {
        id: "feelings-01",
        text: "I'm really tired today.",
        accept: ["I'm so tired today."],
        ja: "今日は本当に疲れた。",
        note: "tired は「タイアド」と2拍で。r を落とさないと通じやすいです。",
        focus: ["r-l"]
      },
      {
        id: "feelings-02",
        text: "I'm so happy right now!",
        accept: ["I'm really happy right now!"],
        ja: "今、すごくうれしい!",
        note: "happy の h はしっかり息を出す。f にならないように注意。",
        focus: ["f-h", "r-l"]
      },
      {
        id: "feelings-03",
        text: "I'm a little nervous about tomorrow.",
        accept: ["I'm a bit nervous about tomorrow."],
        ja: "明日のことが少し緊張するんだ。",
        note: "nervous の v は下唇を噛む。b にすると別の音に聞こえます。",
        focus: ["v-b", "r-l"]
      },
      {
        id: "feelings-04",
        text: "I'm really looking forward to it.",
        accept: ["I'm looking forward to it."],
        ja: "それ、すごく楽しみにしてる。",
        note: "forward to it は「フォワードゥイッ」とつなげる。楽しみを伝える定番。",
        focus: ["f-h", "r-l", "linking"]
      },
      {
        id: "feelings-05",
        text: "I feel much better now, thanks.",
        accept: ["I'm feeling much better now, thanks."],
        ja: "おかげでだいぶ気分がよくなった、ありがとう。",
        note: "feel は長めに、fill にしない。thanks の th は舌先を歯に軽く。",
        focus: ["f-h", "th", "vowel-length"]
      },
      {
        id: "feelings-06",
        text: "Honestly, I'm a bit stressed out.",
        accept: ["To be honest, I'm a bit stressed out."],
        ja: "正直、ちょっとストレスがたまってる。",
        note: "Honestly の h は読まない。stressed を「ストレスド」と母音だらけにしない。",
        focus: ["f-h", "ending-vowel"]
      },
      {
        id: "feelings-07",
        text: "I was kind of disappointed with the result.",
        accept: ["I was a little disappointed with the result."],
        ja: "その結果にはちょっとがっかりした。",
        note: "kind of は「カインダ」。強い否定を和らげる便利なクッションです。",
        focus: ["th", "r-l", "linking"]
      },
      {
        id: "feelings-08",
        text: "I'm not really in the mood today.",
        accept: ["I'm not in the mood today."],
        ja: "今日はちょっとそういう気分じゃないな。",
        note: "冷たく聞こえずに誘いを断れる形。not really を入れると角が立ちません。",
        focus: ["th", "r-l"]
      },
      {
        id: "feelings-09",
        text: "I felt so relieved when it was over.",
        accept: ["I was so relieved when it was over."],
        ja: "終わったとき、すごくほっとした。",
        note: "relieved は最初が r、すぐ後ろが l。順番を入れ替えないように。when it was は「ウェニッワズ」とつなげる。",
        focus: ["r-l", "v-b", "linking"]
      },
      {
        id: "feelings-10",
        text: "I'm a bit overwhelmed, but I'll be fine.",
        accept: ["It's a bit overwhelming, but I'll be fine."],
        ja: "ちょっといっぱいいっぱいだけど、大丈夫。",
        note: "overwhelmed は「オーヴァウェルムド」。h はほぼ聞こえなくてOK。",
        focus: ["v-b", "f-h"]
      }
    ]
  },

  /* ------------------------------------------------------------------
   * 🤝 賛成する・反対する
   * 角を立てずに賛成と異論を伝えて、話し合いに加われるようになる
   * ------------------------------------------------------------------ */
  {
    id: "agree", title: "賛成する・反対する",
    subtitle: "角を立てずに賛成と異論を伝えて、話し合いに加われるようになる",
    icon: "🤝", level: 2, order: 14,
    phrases: [
      {
        id: "agree-01",
        text: "I totally agree with you.",
        accept: ["I completely agree with you."],
        ja: "まったく同じ意見だよ。",
        note: "totally の l は舌先を歯ぐきにつけて。「トータリー」と伸ばしすぎない。",
        focus: ["r-l"]
      },
      {
        id: "agree-02",
        text: "That's a really good point.",
        accept: ["That's a great point."],
        ja: "それ、ほんとにいいところを突いてるね。",
        note: "point の語末に「ト」の母音を足さない。",
        focus: ["th", "ending-vowel"]
      },
      {
        id: "agree-03",
        text: "Same here. I was just thinking that.",
        accept: ["Same here. I was thinking the same thing."],
        ja: "私も同じ。ちょうどそう思ってた。",
        note: "Same here. は相づちの定番。会話が止まったときに一番使える。",
        focus: ["th", "f-h"]
      },
      {
        id: "agree-04",
        text: "Yeah, that's true most of the time.",
        accept: ["Yeah, that's true in most cases."],
        ja: "うん、たいていの場合はそうだね。",
        note: "全面賛成ではないときの安全な相づち。",
        focus: ["th"]
      },
      {
        id: "agree-05",
        text: "I kind of agree, but not completely.",
        accept: ["I sort of agree, but not completely."],
        ja: "なんとなくは賛成だけど、完全にではないかな。",
        note: "kind of はつなげて「カインダ」。区切ると不自然に聞こえる。",
        focus: ["linking"]
      },
      {
        id: "agree-06",
        text: "I'm not so sure about that.",
        accept: ["I'm not sure about that."],
        ja: "それはどうかなあ。",
        note: "No. と言わずに異論を出す一番やわらかい形。語尾を下げると強めに響く。",
        focus: ["th"]
      },
      {
        id: "agree-07",
        text: "Actually, I feel a little differently about it.",
        accept: ["Actually, I see it a little differently."],
        ja: "実は、それについては少し違う考えなんだ。",
        note: "Actually で始めると「反論します」の合図がやわらぐ。",
        focus: ["r-l", "f-h"]
      },
      {
        id: "agree-08",
        text: "That's true, but have you thought about the cost?",
        accept: ["That's true, but did you think about the cost?"],
        ja: "たしかにそうだね。でも費用のことは考えた?",
        note: "いったん認めてから質問で返すと、反論がきつく聞こえない。",
        focus: ["th", "v-b"]
      },
      {
        id: "agree-09",
        text: "I see your point, but I still disagree.",
        accept: ["I see your point, but I still don't agree."],
        ja: "言いたいことは分かるけど、やっぱり反対だな。",
        note: "disagree の語末は「ディサグリー」。ri をはっきり。",
        focus: ["r-l", "ending-vowel"]
      },
      {
        id: "agree-10",
        text: "I get where you're coming from, but I don't think it'll work.",
        accept: ["I understand where you're coming from, but I don't think it'll work."],
        ja: "気持ちは分かるけど、それはうまくいかないと思う。",
        note: "where you're はつなげて「ウェアユア」。work の r を落とさない。",
        focus: ["f-h", "r-l"]
      }
    ]
  },

  /* ------------------------------------------------------------------
   * 🙏 頼む・許可を求める
   * 相手との距離に合わせた丁寧さで、頼みごとと許可が言えるようになる
   * ------------------------------------------------------------------ */
  {
    id: "request", title: "頼む・許可を求める",
    subtitle: "相手との距離に合わせた丁寧さで、頼みごとと許可が言えるようになる",
    icon: "🙏", level: 2, order: 15,
    phrases: [
      {
        id: "request-01",
        text: "Can I ask you a quick question?",
        accept: ["Could I ask you a quick question?"],
        ja: "ちょっと質問してもいい?",
        note: "Can I はつなげて「キャナイ」。quick を入れると相手の負担が軽く伝わる。",
        focus: ["linking"]
      },
      {
        id: "request-02",
        text: "Could you say that again, please?",
        accept: ["Could you repeat that, please?"],
        ja: "もう一度言ってもらえますか?",
        note: "Could you は「クッジュ」。聞き返しはこの形が一番安全。",
        focus: ["linking", "th"]
      },
      {
        id: "request-03",
        text: "Can you help me with this for a minute?",
        accept: ["Could you help me with this for a minute?"],
        ja: "ちょっとこれ手伝ってもらえる?",
        note: "help の l を落とすと hep に聞こえる。",
        focus: ["f-h", "th"]
      },
      {
        id: "request-04",
        text: "Could I borrow your pen for a second?",
        accept: ["Can I borrow your pen for a second?"],
        ja: "ペン、ちょっと借りてもいい?",
        note: "borrow の r は舌をどこにもつけない。",
        focus: ["r-l"]
      },
      {
        id: "request-05",
        text: "Is it okay if I sit here?",
        accept: ["Do you mind if I sit here?"],
        ja: "ここに座ってもいいですか?",
        note: "sit を長く伸ばすと seat(席)に聞こえる。短く。",
        focus: ["vowel-length"]
      },
      {
        id: "request-06",
        text: "Would you mind closing the window?",
        accept: ["Would you mind shutting the window?"],
        ja: "窓を閉めてもらってもいいですか?",
        note: "Would you mind の答えは No が「いいですよ」。Yes と言うと断りになる。",
        focus: ["linking"]
      },
      {
        id: "request-07",
        text: "Do you think you could send me the file?",
        accept: ["Could you send me the file?"],
        ja: "そのファイル、送ってもらえないかな?",
        note: "file の f は下唇を軽く噛む。hile にしない。",
        focus: ["th", "f-h"]
      },
      {
        id: "request-08",
        text: "I was wondering if you could give me a hand.",
        accept: ["I was hoping you could give me a hand."],
        ja: "手を貸してもらえないかなと思って。",
        note: "give me a hand は「手伝って」。かなり丁寧な切り出し方。",
        focus: ["v-b", "f-h"]
      },
      {
        id: "request-09",
        text: "Sorry to bother you, but could I ask a favor?",
        accept: ["Sorry to bother you, but can I ask a favor?"],
        ja: "お邪魔してごめん、ひとつお願いしてもいい?",
        note: "favor の v は下唇を噛む。bother の th は舌を軽く歯に。",
        focus: ["th", "v-b"]
      },
      {
        id: "request-10",
        text: "Would it be possible to change the time a bit?",
        accept: ["Would it be possible to move the time a bit?"],
        ja: "時間を少しだけ変えてもらうことはできますか?",
        note: "Would it は「ウディット」。目上の人にも使える最上級の丁寧さ。",
        focus: ["linking"]
      }
    ]
  },

  /* ------------------------------------------------------------------
   * 📅 誘う・提案する
   * 留学生を遊びや食事に誘って、日にちと時間まで決められるようになる
   * ------------------------------------------------------------------ */
  {
    id: "invite", title: "誘う・提案する",
    subtitle: "留学生を遊びや食事に誘って、日にちと時間まで決められるようになる",
    icon: "📅", level: 2, order: 16,
    phrases: [
      {
        id: "invite-01",
        text: "Do you want to grab lunch together?",
        accept: ["Do you want to get lunch together?"],
        ja: "一緒にお昼食べに行かない?",
        note: "want to は「ワナ」。grab は「サッと食べる」感じで気軽さが出る。",
        focus: ["linking", "th"]
      },
      {
        id: "invite-02",
        text: "Let's meet in front of the station.",
        accept: ["Let's meet up in front of the station."],
        ja: "駅の前で待ち合わせしよう。",
        note: "in front of は一息で「インフロンタヴ」。meet は長めに。",
        focus: ["linking", "vowel-length"]
      },
      {
        id: "invite-03",
        text: "Are you free this weekend by any chance?",
        accept: ["Are you free this weekend?"],
        ja: "もしかして今週末、空いてたりする?",
        note: "by any chance を足すと「無理ならいいよ」の気づかいが伝わる。",
        focus: ["f-h", "th"]
      },
      {
        id: "invite-04",
        text: "How about getting coffee after class?",
        accept: ["How about coffee after class?"],
        ja: "授業のあとコーヒーでもどう?",
        note: "coffee の f をはっきり。class の語末に「ス」の母音を足さない。",
        focus: ["f-h", "ending-vowel"]
      },
      {
        id: "invite-05",
        text: "We're going to a festival. Want to join us?",
        accept: ["We're going to a festival. Do you want to join us?"],
        ja: "みんなでお祭りに行くんだけど、来ない?",
        note: "festival の f と v を両方とも下唇で。",
        focus: ["f-h", "v-b"]
      },
      {
        id: "invite-06",
        text: "Why don't you come with us next time?",
        accept: ["Why don't you join us next time?"],
        ja: "次は一緒に来ない?",
        note: "don't you は「ドンチュ」。断られた相手にもう一度声をかける形。",
        focus: ["linking"]
      },
      {
        id: "invite-07",
        text: "Would you like to join us for dinner?",
        accept: ["Do you want to join us for dinner?"],
        ja: "よかったら夕食、一緒にどうですか?",
        note: "初対面や目上の人にはこの形。Do you want to より丁寧。",
        focus: ["r-l"]
      },
      {
        id: "invite-08",
        text: "If you're busy, we could do it another day.",
        accept: ["If you're busy, we can do it another day."],
        ja: "忙しいなら、別の日でもいいよ。",
        note: "逃げ道を先に用意すると相手が断りやすくなる。",
        focus: ["th"]
      },
      {
        id: "invite-09",
        text: "Does Friday work for you, or is Saturday better?",
        accept: ["Is Friday okay for you, or is Saturday better?"],
        ja: "金曜は都合いい?それとも土曜の方がいい?",
        note: "二択で聞くと予定が一気に決まる。work for you は「都合がいい」。",
        focus: ["r-l"]
      },
      {
        id: "invite-10",
        text: "Let me know what time works best for you.",
        accept: ["Let me know what time is best for you."],
        ja: "何時が一番都合いいか教えてね。",
        note: "what time はつなげて「ワッタイム」。best の語末に母音を足さない。",
        focus: ["linking", "ending-vowel"]
      }
    ]
  },

  /* ------------------------------------------------------------------
   * 🙇 断る・謝る
   * 気まずくならずに断り、遅刻やミスをきちんと謝れるようになる
   * ------------------------------------------------------------------ */
  {
    id: "decline", title: "断る・謝る",
    subtitle: "気まずくならずに断り、遅刻やミスをきちんと謝れるようになる",
    icon: "🙇", level: 2, order: 17,
    phrases: [
      {
        id: "decline-01",
        text: "Sorry, I can't make it today.",
        accept: ["Sorry, I can't come today."],
        ja: "ごめん、今日は行けないんだ。",
        note: "make it は「行ける・間に合う」。つなげて「メイキット」。",
        focus: ["linking"]
      },
      {
        id: "decline-02",
        text: "Sorry I'm late. The train was delayed.",
        accept: ["Sorry I'm late. My train was delayed."],
        ja: "遅れてごめん。電車が遅れて。",
        note: "train の tr と delayed の l を分けて出す。",
        focus: ["r-l"]
      },
      {
        id: "decline-03",
        text: "Thanks for asking, but I'm busy tonight.",
        accept: ["Thanks for the invite, but I'm busy tonight."],
        ja: "誘ってくれてありがとう。でも今夜は忙しいんだ。",
        note: "断るときはまずお礼から。いきなり No と言わない。",
        focus: ["th", "f-h"]
      },
      {
        id: "decline-04",
        text: "Excuse me, could I get past you?",
        accept: ["Excuse me, can I get past you?"],
        ja: "すみません、ちょっと通してもらえますか?",
        note: "通してほしいときの「すみません」は Sorry ではなく Excuse me。",
        focus: ["ending-vowel"]
      },
      {
        id: "decline-05",
        text: "I'd love to, but I have class then.",
        accept: ["I'd love to, but I have a class then."],
        ja: "すごく行きたいけど、そのとき授業があるんだ。",
        note: "I'd love to を先に言うと「本当は行きたい」が伝わる。",
        focus: ["v-b", "ending-vowel"]
      },
      {
        id: "decline-06",
        text: "Maybe next time. I'm not feeling great today.",
        accept: ["Maybe next time. I'm not feeling well today."],
        ja: "また今度で。今日は体調がいまいちなんだ。",
        note: "Maybe next time. だけでも断りとして完全に通じる。",
        focus: ["r-l", "f-h"]
      },
      {
        id: "decline-07",
        text: "Sorry, that's my fault. I'll fix it right away.",
        accept: ["Sorry, that's my mistake. I'll fix it right away."],
        ja: "ごめん、私のミスです。すぐ直します。",
        note: "fault の f と fix の f をはっきり。fix it は「フィキシット」。",
        focus: ["f-h", "r-l", "th"]
      },
      {
        id: "decline-08",
        text: "I'm really sorry for keeping you waiting.",
        accept: ["I'm so sorry for keeping you waiting."],
        ja: "お待たせして本当にごめんなさい。",
        note: "軽い遅れなら Thanks for waiting. の方が自然。謝りすぎない。",
        focus: ["r-l", "vowel-length"]
      },
      {
        id: "decline-09",
        text: "That sounds fun, but I'll have to pass this time.",
        accept: ["That sounds fun, but I'll pass this time."],
        ja: "楽しそうだけど、今回は遠慮しておくね。",
        note: "pass は「今回はやめておく」。角が立たない断り方。",
        focus: ["th", "f-h", "ending-vowel"]
      },
      {
        id: "decline-10",
        text: "I'm afraid I can't help you with that today.",
        accept: ["I'm afraid I can't help with that today."],
        ja: "申し訳ないけど、今日はそれを手伝えません。",
        note: "I'm afraid は「言いにくいのですが」の合図。断りが一段やわらぐ。",
        focus: ["f-h", "th", "r-l"]
      }
    ]
  },

  /* ------------------------------------------------------------------
   * 💡 意見を言う・理由を添える
   * 「いいね」で終わらせず、理由と例まで自分の言葉で言える。
   * ------------------------------------------------------------------ */
  {
    id: "opinion", title: "意見を言う・理由を添える",
    subtitle: "「いいね」で終わらせず、理由と例まで自分の言葉で言える。",
    icon: "💡", level: 3, order: 20,
    phrases: [
      {
        id: "opinion-01",
        text: "I think that's a really good idea.",
        accept: ["I think that's a great idea."],
        ja: "それ、すごくいい考えだと思う。",
        note: "think と that's の th を落とさない。舌先を軽く歯に当てて息を出すだけで通じます。",
        focus: ["th"]
      },
      {
        id: "opinion-02",
        text: "I like it because it saves a lot of time.",
        accept: ["I like it because it saves so much time."],
        ja: "時間がすごく節約できるから、それ気に入ってます。",
        note: "because は「ビコーズ」より「ビカズ」と軽く。強く言うのは saves のほう。",
        focus: ["linking"]
      },
      {
        id: "opinion-03",
        text: "In my opinion, the second one is much better.",
        accept: ["In my opinion, the second one is a lot better."],
        ja: "私の意見では、2つ目のほうがずっといいです。",
        note: "second を「セカンドゥ」と伸ばさない。d は軽く止めるだけ。",
        focus: ["ending-vowel"]
      },
      {
        id: "opinion-04",
        text: "For example, the same thing happened to me last week.",
        accept: ["For example, the same thing happened to me last week."],
        ja: "たとえば、先週まさに同じことが私にあったんです。",
        note: "happened to は「ハプンドゥ トゥ」より「ハプントゥ」とつなげると自然。",
        focus: ["linking"]
      },
      {
        id: "opinion-05",
        text: "I see what you mean, but I see it a bit differently.",
        accept: ["I get what you're saying, but I see it a little differently."],
        ja: "言いたいことはわかるけど、私の見方は少し違います。",
        note: "真っ向から否定せずに違う意見を出す言い方。but の前で一度切ると伝わります。",
        focus: ["f-h"]
      },
      {
        id: "opinion-06",
        text: "It depends on how much time we have.",
        accept: ["It depends on how much time we've got."],
        ja: "どれくらい時間があるかによりますね。",
        note: "depends on は「ディペンゾン」とつなげる。即答を避けたいときの万能フレーズ。",
        focus: ["linking"]
      },
      {
        id: "opinion-07",
        text: "The thing is, I don't really have time for that.",
        accept: ["The thing is, I don't have time for that."],
        ja: "実はですね、それをやる時間が本当にないんです。",
        note: "The thing is, は「本音を言うとね」の合図。ここで少し間を置くと聞き手が構えてくれます。",
        focus: ["th"]
      },
      {
        id: "opinion-08",
        text: "To be honest, I'm not a big fan of that.",
        accept: ["To be honest, I'm not really into that."],
        ja: "正直に言うと、それはあまり好きじゃないです。",
        note: "honest の h は読まない。「オネスト」ではなく「アネスト」。やわらかく嫌いと言える形です。",
        focus: ["f-h"]
      },
      {
        id: "opinion-09",
        text: "What I mean is, it's not worth the money.",
        accept: ["What I mean is, it's not worth the price."],
        ja: "つまり言いたいのは、その値段の価値はないってことです。",
        note: "What I は「ワライ」とつなげる。伝わっていないと感じたら言い直しの合図に使えます。",
        focus: ["linking", "th"]
      },
      {
        id: "opinion-10",
        text: "The way I see it, we should just give it a try.",
        accept: ["The way I see it, we should just try it."],
        ja: "私の見方では、とりあえずやってみるべきだと思います。",
        note: "give it a は「ギヴィタ」と一息で。try の r をしっかり出すと通じます。",
        focus: ["linking", "r-l"]
      }
    ]
  },

  /* ------------------------------------------------------------------
   * 📖 出来事を順に話す
   * 週末の出来事を、順番に並べて最後まで話し切れるようになる。
   * ------------------------------------------------------------------ */
  {
    id: "story", title: "出来事を順に話す",
    subtitle: "週末の出来事を、順番に並べて最後まで話し切れるようになる。",
    icon: "📖", level: 3, order: 21,
    phrases: [
      {
        id: "story-01",
        text: "Last weekend I went to a concert with my friends.",
        accept: ["Last weekend I went to a concert with some friends."],
        ja: "先週末、友達とコンサートに行きました。",
        note: "went to a は「ウェントゥア」とつなげる。まず「いつ・何をしたか」を先に言うのがコツ。",
        focus: ["linking"]
      },
      {
        id: "story-02",
        text: "First, we met at the station around ten.",
        accept: ["First, we met at the station at around ten.", "First, we met at the station around 10."],
        ja: "まず、10時ごろ駅で待ち合わせしました。",
        note: "First の最後を「ファーストゥ」と伸ばさない。時系列の合図なので少し強めに。",
        focus: ["ending-vowel"]
      },
      {
        id: "story-03",
        text: "Then we walked to the park and had lunch.",
        accept: ["Then we walked to the park and ate lunch."],
        ja: "それから公園まで歩いて、お昼を食べました。",
        note: "walked の l は読まない。「ウォークト」。park の r と lunch の l を分けて。",
        focus: ["r-l"]
      },
      {
        id: "story-04",
        text: "After that, we went shopping for a couple of hours.",
        accept: ["After that, we went shopping for about two hours."],
        ja: "そのあと、2時間くらい買い物をしました。",
        note: "After の f を息だけで出す。「アハター」になると別の語に聞こえます。",
        focus: ["f-h"]
      },
      {
        id: "story-05",
        text: "While we were eating, it started to rain.",
        accept: ["While we were eating, it started raining."],
        ja: "食べている途中で、雨が降り出しました。",
        note: "eating は「イーティン」と長め。rain の r は唇を丸めてから。",
        focus: ["vowel-length", "r-l"]
      },
      {
        id: "story-06",
        text: "In the end, we stayed there until it got dark.",
        accept: ["In the end, we stayed there till it got dark."],
        ja: "結局、暗くなるまでそこにいました。",
        note: "until it は「アンティリッ」とつなげる。In the end, は話を締める合図です。",
        focus: ["th", "linking"]
      },
      {
        id: "story-07",
        text: "It was so much fun. I'd love to go again.",
        accept: ["It was really fun. I'd love to go again."],
        ja: "すごく楽しかったです。また行きたいなあ。",
        note: "fun の f を歯と唇で。感想でしめると話が完結して聞こえます。",
        focus: ["f-h"]
      },
      {
        id: "story-08",
        text: "I was going to go home, but I changed my mind.",
        accept: ["I was going to go home, but I changed my mind about it."],
        ja: "家に帰るつもりだったんですが、気が変わりました。",
        note: "going to は会話では「ゴナ」。予定と違う展開を語るときの定番です。",
        focus: ["linking"]
      },
      {
        id: "story-09",
        text: "You won't believe what happened to me yesterday.",
        accept: ["You'll never believe what happened to me yesterday."],
        ja: "昨日あったこと、聞いても信じられないと思いますよ。",
        note: "believe の v は下唇を噛む。「ビリーブ」の b と v を別々に。話を始める前ふりに便利。",
        focus: ["v-b"]
      },
      {
        id: "story-10",
        text: "I was on my way home when I lost my wallet.",
        accept: [],
        ja: "家に帰る途中で、財布をなくしたんです。",
        note: "on my way は一息で「オンマイウェイ」。when 以下で「そのとき何が起きたか」を足せます。",
        focus: ["linking"]
      }
    ]
  },

  /* ------------------------------------------------------------------
   * 🔁 説明する・言い換える
   * 単語が出てこなくても、別の言い方で伝えて会話を止めない。
   * ------------------------------------------------------------------ */
  {
    id: "explain", title: "説明する・言い換える",
    subtitle: "単語が出てこなくても、別の言い方で伝えて会話を止めない。",
    icon: "🔁", level: 3, order: 22,
    phrases: [
      {
        id: "explain-01",
        text: "It's a kind of traditional Japanese food.",
        accept: ["It's a type of traditional Japanese food."],
        ja: "日本の伝統的な食べ物の一種です。",
        note: "kind of は「カインダ」とつなげる。まず大きな分類を言うと相手が想像しやすくなります。",
        focus: ["linking"]
      },
      {
        id: "explain-02",
        text: "It's something you use when you cook.",
        accept: ["It's something you use for cooking."],
        ja: "料理するときに使うものです。",
        note: "cook を「クック」と母音を足しすぎない。名前が出ないときは用途から入るのが鉄則。",
        focus: ["ending-vowel"]
      },
      {
        id: "explain-03",
        text: "How do you say this word in English?",
        accept: ["What's this word in English?"],
        ja: "この単語、英語では何て言うんですか？",
        note: "this の th は舌先を軽く上の歯に当てて出す。「ジス」と言い切らず息を混ぜると通じます。聞き返すのは失礼ではありません。",
        focus: ["th"]
      },
      {
        id: "explain-04",
        text: "It looks like a small box with a lid.",
        accept: ["It looks kind of like a small box with a lid."],
        ja: "ふたのついた小さい箱みたいな見た目です。",
        note: "looks like の l と、lid の l をはっきり。見た目を言うと一気に伝わります。",
        focus: ["r-l"]
      },
      {
        id: "explain-05",
        text: "It's used for keeping your drink cold.",
        accept: ["It's used to keep your drink cold."],
        ja: "飲み物を冷たいままにしておくために使います。",
        note: "keeping は「キーピン」と長めに。kipping に聞こえると別語です。",
        focus: ["vowel-length"]
      },
      {
        id: "explain-06",
        text: "It's similar to a sandwich, but a bit sweeter.",
        accept: ["It's kind of like a sandwich, but a bit sweeter."],
        ja: "サンドイッチに似ていますが、もう少し甘いです。",
        note: "similar は r と l が続く難所。「シミラー」の最後の r を軽く残す。",
        focus: ["r-l"]
      },
      {
        id: "explain-07",
        text: "Sorry, I don't know the word in English.",
        accept: ["Sorry, I don't know the English word for it."],
        ja: "すみません、英語での言い方がわからないんです。",
        note: "word の母音は口を大きく開けない。日本語の「ワード」と言うと ward(ウォード)に近く聞こえます。正直に言えば相手が教えてくれます。",
        focus: ["r-l"]
      },
      {
        id: "explain-08",
        text: "What do you call the place where you buy medicine?",
        accept: ["What do you call a place where you buy medicine?"],
        ja: "薬を買う場所は何て言うんですか？",
        note: "What do you は「ワッデュユー」と一息で。この型は単語を教わる万能フレーズです。",
        focus: ["linking"]
      },
      {
        id: "explain-09",
        text: "You know, the thing you use to open cans.",
        accept: ["You know, the thing you use for opening cans."],
        ja: "ほら、缶を開けるときに使うやつです。",
        note: "the thing の th を息だけで。名前が出ない物は the thing you use to ... で押し切れます。",
        focus: ["th"]
      },
      {
        id: "explain-10",
        text: "Let me try to explain it another way.",
        accept: ["Let me explain it another way."],
        ja: "別の言い方で説明してみますね。",
        note: "another の th をはっきり。伝わっていない空気を感じたら、この一言で仕切り直せます。",
        focus: ["th"]
      }
    ]
  },

  /* ------------------------------------------------------------------
   * 🌏 経験を話す
   * 「〜したことある?」から、経験の話で盛り上がれるようになる。
   * ------------------------------------------------------------------ */
  {
    id: "experience", title: "経験を話す",
    subtitle: "「〜したことある?」から、経験の話で盛り上がれるようになる。",
    icon: "🌏", level: 3, order: 23,
    phrases: [
      {
        id: "experience-01",
        text: "I've never been abroad before.",
        accept: ["I've never been overseas before."],
        ja: "海外には行ったことがありません。",
        note: "never の v と been の b を別々に。下唇を噛むのが v です。",
        focus: ["v-b"]
      },
      {
        id: "experience-02",
        text: "Have you ever tried Japanese curry?",
        accept: ["Have you ever had Japanese curry?"],
        ja: "日本のカレーを食べたことありますか？",
        note: "Have you ever は「ハヴユエヴァ」と軽くつなげる。curry の r をしっかり。",
        focus: ["v-b", "r-l"]
      },
      {
        id: "experience-03",
        text: "I've tried it once, but I didn't really like it.",
        accept: ["I've tried it once, but I didn't like it much."],
        ja: "一度やってみたんですが、あまり好きじゃなかったです。",
        note: "tried it は「トライディッ」とつなげる。really の r と l を分けて。",
        focus: ["r-l"]
      },
      {
        id: "experience-04",
        text: "I've lived here for about three years.",
        accept: ["I've lived here for about 3 years.", "I've been living here for about three years."],
        ja: "ここに3年くらい住んでいます。",
        note: "three の th を落とすと free に聞こえます。今も続いていることは現在完了で。",
        focus: ["th"]
      },
      {
        id: "experience-05",
        text: "I haven't seen that movie yet, but I want to.",
        accept: ["I haven't watched that movie yet, but I want to."],
        ja: "その映画はまだ見てないんですが、見たいです。",
        note: "seen は「スィーン」と長めに。yet を文末に置くと「まだ」が自然に出ます。",
        focus: ["th", "vowel-length"]
      },
      {
        id: "experience-06",
        text: "I've known her since we were in high school.",
        accept: ["I've known her since high school."],
        ja: "高校のときからの知り合いです。",
        note: "known her は h を弱めて「ノウナー」。since のあとは過去の一点を置きます。",
        focus: ["linking"]
      },
      {
        id: "experience-07",
        text: "That's the best meal I've ever had.",
        accept: ["That's the best meal I've ever eaten."],
        ja: "あれは今まで食べた中でいちばんおいしかったです。",
        note: "That's の th と ever の v が難所。ほめるときの最強の一文です。",
        focus: ["th", "v-b"]
      },
      {
        id: "experience-08",
        text: "Have you ever thought about studying abroad?",
        accept: ["Have you ever thought about studying overseas?"],
        ja: "留学しようと思ったことはありますか？",
        note: "thought の th は息だけ。thought about は「ソータバウト」とつなげます。",
        focus: ["th"]
      },
      {
        id: "experience-09",
        text: "I've been playing the guitar since I was twelve.",
        accept: ["I've been playing the guitar since I was 12."],
        ja: "12歳のときからギターを弾いています。",
        note: "playing の l と guitar の r を分けて。ずっと続けていることは been -ing で。",
        focus: ["r-l"]
      },
      {
        id: "experience-10",
        text: "I've always wanted to try that, but never had the chance.",
        accept: ["I've always wanted to try that, but I never had the chance."],
        ja: "ずっとやってみたかったんですが、機会がなくて。",
        note: "wanted to は「ワニッタ」と軽く。憧れを伝えつつ話を広げられる一文です。",
        focus: ["th", "v-b"]
      }
    ]
  },

  /* ------------------------------------------------------------------
   * ⚖ 比べる・程度を言う
   * 『ちょっと』『かなり』『〜すぎる』を言い分けられる
   * ------------------------------------------------------------------ */
  {
    id: "compare", title: "比べる・程度を言う",
    subtitle: "『ちょっと』『かなり』『〜すぎる』を言い分けられる",
    icon: "⚖", level: 3, order: 24,
    phrases: [
      {
        id: "compare-01",
        text: "This one's a little cheaper than that one.",
        accept: ["This one's a bit cheaper than that one."],
        ja: "こっちのほうが、あっちより少し安いよ。",
        note: "than と that の th は舌先を軽く歯に当てる。ザ行にしない。",
        focus: ["th"]
      },
      {
        id: "compare-02",
        text: "It's kind of expensive, but it's really good.",
        accept: ["It's a bit expensive, but it's really good.", "It's kind of expensive, but it's really delicious."],
        ja: "ちょっと高いけど、すごくおいしいよ。",
        note: "kind of はつなげて「カインダ」。言い切りをやわらげる万能フレーズ。",
        focus: ["linking", "r-l"]
      },
      {
        id: "compare-03",
        text: "It's much colder today than it was yesterday.",
        accept: ["It's a lot colder today than it was yesterday."],
        ja: "今日は昨日よりずっと寒いね。",
        note: "colder の d のあとに「ア」を足さない。天気の話は雑談の定番。",
        focus: ["th", "ending-vowel"]
      },
      {
        id: "compare-04",
        text: "That's pretty good for a first try.",
        accept: ["That's really good for a first try."],
        ja: "初めてにしては、かなりいいね。",
        note: "pretty は「かわいい」ではなく「かなり」。ほめるときに毎日使う。",
        focus: ["f-h", "r-l"]
      },
      {
        id: "compare-05",
        text: "This is by far my favorite one.",
        accept: ["This is definitely my favorite one."],
        ja: "これがダントツで一番好き。",
        note: "by far で「ダントツで」。favorite の v は下唇を軽く噛む。",
        focus: ["v-b", "f-h"]
      },
      {
        id: "compare-06",
        text: "It's not as hard as it looks.",
        accept: ["It's easier than it looks."],
        ja: "見た目ほど難しくないよ。",
        note: "as it を「アズィッ」とつなげる。相手を励ますときの定番。",
        focus: ["linking"]
      },
      {
        id: "compare-07",
        text: "This coffee is way too sweet for me.",
        accept: ["This coffee is too sweet for me."],
        ja: "このコーヒー、私には甘すぎる。",
        note: "way too で「〜すぎ」を強める。sweet の ee は長めに。",
        focus: ["f-h", "vowel-length"]
      },
      {
        id: "compare-08",
        text: "It's almost the same as the one I have.",
        accept: ["It's pretty much the same as the one I have."],
        ja: "私が持ってるのと、ほとんど同じだね。",
        note: "the same as で「〜と同じ」。as をつなげて軽く言う。",
        focus: ["th", "linking"]
      },
      {
        id: "compare-09",
        text: "That's a lot better than I expected.",
        accept: ["That's much better than I expected."],
        ja: "思ってたよりずっといいね。",
        note: "than I を「ザナイ」とつなげる。感想を一言で返せる型。",
        focus: ["th", "linking"]
      },
      {
        id: "compare-10",
        text: "The more I practice, the easier it gets.",
        accept: ["The more I practice, the easier it becomes."],
        ja: "練習すればするほど、楽になっていくよ。",
        note: "the + 比較級を 2 回で「〜すればするほど」。more I をつなげる。",
        focus: ["th", "r-l"]
      }
    ]
  },

  /* ------------------------------------------------------------------
   * 🗓 予定と未来の話
   * 予定・約束・その場の思いつきを、迷わず未来形で言える
   * ------------------------------------------------------------------ */
  {
    id: "future", title: "予定と未来の話",
    subtitle: "予定・約束・その場の思いつきを、迷わず未来形で言える",
    icon: "🗓", level: 3, order: 25,
    phrases: [
      {
        id: "future-01",
        text: "I'm going to study abroad next year.",
        accept: ["I'm going to study overseas next year."],
        ja: "来年、留学するつもりです。",
        note: "going to は「ゴナ」でOK。前から決めていた予定はこの形。",
        focus: ["v-b"]
      },
      {
        id: "future-02",
        text: "What are you doing this weekend?",
        accept: ["What are your plans for this weekend?"],
        ja: "今週末は何する予定？",
        note: "進行形で「予定」を聞ける。What are you を「ワラユ」とつなげる。",
        focus: ["linking"]
      },
      {
        id: "future-03",
        text: "I'm meeting a friend at seven tonight.",
        accept: ["I'm meeting a friend at 7 tonight.", "I'm seeing a friend at seven tonight."],
        ja: "今夜7時に友達と会うことになってるんだ。",
        note: "約束済みの予定は be -ing で言う。seven の v をしっかり。",
        focus: ["v-b"]
      },
      {
        id: "future-04",
        text: "I'll call you back in a few minutes.",
        accept: ["I'll call you back in a couple of minutes."],
        ja: "数分後にかけ直すね。",
        note: "その場で決めたことは will。call you back を一息で。",
        focus: ["linking", "f-h"]
      },
      {
        id: "future-05",
        text: "I'm planning to look for a part-time job.",
        accept: ["I'm going to look for a part-time job."],
        ja: "バイトを探そうと思っています。",
        note: "planning to で「〜するつもり」。look for をつなげる。",
        focus: ["f-h", "r-l"]
      },
      {
        id: "future-06",
        text: "I'm thinking about joining another club too.",
        accept: ["I'm thinking of joining another club too."],
        ja: "もう一つサークルに入ろうかなと思ってる。",
        note: "まだ決めていないときは thinking about。th が 2 回出てくる。",
        focus: ["th"]
      },
      {
        id: "future-07",
        text: "We're supposed to meet in front of the station.",
        accept: ["We're supposed to meet outside the station."],
        ja: "駅前で待ち合わせることになってるんだ。",
        note: "be supposed to で「〜することになっている」。front of は「フロンタヴ」。",
        focus: ["f-h", "linking"]
      },
      {
        id: "future-08",
        text: "I'm about to leave, so I'll see you there.",
        accept: ["I'm just about to leave, so I'll see you there."],
        ja: "今から出るところだから、現地で会おう。",
        note: "be about to は「今まさに〜するところ」。about to をつなげる。",
        focus: ["linking", "th"]
      },
      {
        id: "future-09",
        text: "I probably won't be able to make it tomorrow.",
        accept: ["I don't think I can make it tomorrow."],
        ja: "明日はたぶん行けないと思う。",
        note: "make it で「都合をつけて行く」。断りをやわらげる probably を忘れずに。",
        focus: ["v-b", "linking"]
      },
      {
        id: "future-10",
        text: "By the time we get there, it'll be dark.",
        accept: ["By the time we arrive, it'll be dark."],
        ja: "着くころには、もう暗くなってるだろうね。",
        note: "by the time のあとは現在形。get there をつなげて「ゲッゼア」。",
        focus: ["th", "linking"]
      }
    ]
  },

  /* ------------------------------------------------------------------
   * 🌈 もし〜だったら
   * 「もし〜だったら」の話を、雑談のテンポで返せるようになる
   * ------------------------------------------------------------------ */
  {
    id: "hypothetical", title: "もし〜だったら",
    subtitle: "「もし〜だったら」の話を、雑談のテンポで返せるようになる",
    icon: "🌈", level: 3, order: 26,
    phrases: [
      {
        id: "hypothetical-01",
        text: "If it rains tomorrow, we'll just stay home.",
        accept: ["If it rains tomorrow, let's just stay home."],
        ja: "明日雨だったら、家にいようか。",
        note: "実際に起こりうる話は if + 現在形。rains の r を巻きすぎない。",
        focus: ["r-l"]
      },
      {
        id: "hypothetical-02",
        text: "If I were you, I'd take the train.",
        accept: ["If I were you, I'd go by train."],
        ja: "私があなたなら、電車で行くけどな。",
        note: "If I were は主語が I でも were。アドバイスの定番の切り出し。",
        focus: ["r-l", "linking"]
      },
      {
        id: "hypothetical-03",
        text: "I wish I could speak English like you.",
        accept: ["I wish I could speak English as well as you."],
        ja: "あなたみたいに英語が話せたらいいのに。",
        note: "wish のあとは過去形。could は「クッド」で l は聞こえなくてよい。",
        focus: ["r-l", "vowel-length"]
      },
      {
        id: "hypothetical-04",
        text: "What would you do if you were me?",
        accept: ["What would you do in my situation?"],
        ja: "もしあなたが私の立場だったら、どうする？",
        note: "would you を「ウッジュー」とつなげる。相談を振り返すときに使う。",
        focus: ["linking"]
      },
      {
        id: "hypothetical-05",
        text: "It'd be nice if we could go together.",
        accept: ["It would be great if we could go together."],
        ja: "一緒に行けたらいいね。",
        note: "It'd be nice if 〜 は押しつけない誘い方。together の th を忘れずに。",
        focus: ["th", "v-b"]
      },
      {
        id: "hypothetical-06",
        text: "If I had more time, I'd travel more.",
        accept: ["If I had more free time, I'd travel more."],
        ja: "もっと時間があったら、もっと旅行するのになあ。",
        note: "今の現実と違う話は過去形で。travel の v は下唇を軽く噛む。",
        focus: ["r-l", "v-b"]
      },
      {
        id: "hypothetical-07",
        text: "I wish I'd studied harder in high school.",
        accept: ["I should have studied harder in high school."],
        ja: "高校でもっと勉強しておけばよかった。",
        note: "I wish I'd 〜 で過去の後悔。high の h をしっかり出す。",
        focus: ["f-h", "r-l"]
      },
      {
        id: "hypothetical-08",
        text: "If I had a choice, I'd rather go on Sunday.",
        accept: ["If I could pick, I'd rather go on Sunday."],
        ja: "選べるなら、日曜のほうがいいな。",
        note: "I'd rather で「どちらかといえば〜したい」。rather の th を軽く。",
        focus: ["th", "r-l"]
      },
      {
        id: "hypothetical-09",
        text: "If I'd known, I would've helped you.",
        accept: ["If I'd known that, I would've helped you."],
        ja: "知ってたら、手伝ったのに。",
        note: "would've は「ウダヴ」と一息で。過去を悔やむときの定型。",
        focus: ["v-b", "linking"]
      },
      {
        id: "hypothetical-10",
        text: "If I hadn't joined this club, I wouldn't have met you.",
        accept: ["If I hadn't joined this club, I never would've met you."],
        ja: "このサークルに入ってなかったら、あなたに会えてなかったね。",
        note: "hadn't / wouldn't の t は飲み込むように軽く。別れぎわに効く一言。",
        focus: ["th", "ending-vowel"]
      }
    ]
  },

  /* ------------------------------------------------------------------
   * 🔍 人や物を説明する
   * 人や物の特徴を、相手が思い浮かべられるように説明できる
   * ------------------------------------------------------------------ */
  {
    id: "describe", title: "人や物を説明する",
    subtitle: "人や物の特徴を、相手が思い浮かべられるように説明できる",
    icon: "🔍", level: 3, order: 27,
    phrases: [
      {
        id: "describe-01",
        text: "She's the one with the short brown hair.",
        accept: ["She's the one with short brown hair."],
        ja: "髪が短くて茶色の、あの人だよ。",
        note: "with the をつなげて軽く。人を指すときに一番使う型。",
        focus: ["th", "r-l"]
      },
      {
        id: "describe-02",
        text: "He's tall, with glasses and a beard.",
        accept: ["He's the tall guy with glasses and a beard."],
        ja: "背が高くて、メガネをかけてて、ひげがある人。",
        note: "glasses は「グラスィズ」。最後は s で止めず「ズ」まで言うと glass と区別できる。",
        focus: ["ending-vowel", "r-l"]
      },
      {
        id: "describe-03",
        text: "He's really friendly and easy to talk to.",
        accept: ["He's very friendly and easy to talk to."],
        ja: "彼はすごく人懐っこくて、話しやすい人だよ。",
        note: "friendly の fr は下唇を軽く噛んでから r。性格を言う定番。",
        focus: ["f-h", "r-l"]
      },
      {
        id: "describe-04",
        text: "It looks kind of like a big backpack.",
        accept: ["It looks a bit like a big backpack."],
        ja: "大きなリュックみたいな見た目だよ。",
        note: "looks like で「〜みたいに見える」。名前が出てこないときの逃げ道。",
        focus: ["r-l", "ending-vowel"]
      },
      {
        id: "describe-05",
        text: "It's a small place that serves great coffee.",
        accept: ["It's a small place with great coffee."],
        ja: "おいしいコーヒーを出す、小さなお店だよ。",
        note: "place のあとに that を置いて説明を足せる。coffee の f をはっきり。",
        focus: ["f-h", "ending-vowel"]
      },
      {
        id: "describe-06",
        text: "That's the guy I was telling you about.",
        accept: ["That's the guy I told you about."],
        ja: "あれが、前に話してた人だよ。",
        note: "the guy のあとの who は省略できる。about の t は軽く落とす。",
        focus: ["th", "linking"]
      },
      {
        id: "describe-07",
        text: "She's the kind of person who always helps out.",
        accept: ["She's the type of person who always helps out."],
        ja: "彼女は、いつも人を助けてくれるタイプの人だよ。",
        note: "the kind of person who 〜 は性格を説明する型。helps out をつなげる。",
        focus: ["r-l", "linking"]
      },
      {
        id: "describe-08",
        text: "I'm looking for something light and easy to carry.",
        accept: ["I want something light and easy to carry."],
        ja: "軽くて持ち運びやすいものを探しています。",
        note: "something のあとに形容詞を置く。light と right を区別する。",
        focus: ["r-l", "vowel-length"]
      },
      {
        id: "describe-09",
        text: "It's hard to explain, but it tastes amazing.",
        accept: ["It's hard to describe, but it tastes amazing."],
        ja: "説明しづらいんだけど、すごくおいしいよ。",
        note: "It's hard to explain は言葉に詰まったときの便利な前置き。",
        focus: ["f-h", "linking"]
      },
      {
        id: "describe-10",
        text: "The people I work with are all really nice.",
        accept: ["Everyone I work with is really nice."],
        ja: "一緒に働いてる人たちは、みんなすごくいい人だよ。",
        note: "前置詞 with が主語の後ろに残る形。work with を一息で。",
        focus: ["r-l", "linking"]
      }
    ]
  },

  /* ------------------------------------------------------------------
   * ⏳ つなぎ言葉と間の取り方
   * 考えている間を英語で埋めて、会話を止めずに続けられるようになる
   * ------------------------------------------------------------------ */
  {
    id: "fillers", title: "つなぎ言葉と間の取り方",
    subtitle: "考えている間を英語で埋めて、会話を止めずに続けられるようになる",
    icon: "⏳", level: 4, order: 30,
    phrases: [
      {
        id: "fillers-01",
        text: "Let me think for a second.",
        accept: ["Let me think for a moment.", "Give me a second to think."],
        ja: "ちょっと考えさせて。",
        note: "Let me は「レッミー」とつなげる。黙り込むより、この一言を置くほうが自然。",
        focus: ["linking"]
      },
      {
        id: "fillers-02",
        text: "That's a good question.",
        accept: ["That's a really good question."],
        ja: "いい質問だね。",
        note: "答えを考える時間をつくる定番。相手をほめながら間を取れる。",
        focus: []
      },
      {
        id: "fillers-03",
        text: "Well, it depends on the situation.",
        accept: ["It depends on the situation."],
        ja: "うーん、状況によるかな。",
        note: "Well を頭に置くと「今考えている」という合図になる。",
        focus: []
      },
      {
        id: "fillers-04",
        text: "How should I put it?",
        accept: ["How do I put this?", "How can I say this?"],
        ja: "なんて言えばいいかな。",
        note: "言葉に詰まったときの定番。put it は「プティット」とつなげる。",
        focus: ["linking"]
      },
      {
        id: "fillers-05",
        text: "You know what I mean?",
        accept: ["Do you know what I mean?"],
        ja: "言いたいこと、伝わってるかな？",
        note: "確認しながら間も取れる。what I は「ワライ」に近くつながる。",
        focus: ["linking"]
      },
      {
        id: "fillers-06",
        text: "Hold on, I'm still thinking about it.",
        accept: ["Wait, I'm still thinking about it."],
        ja: "ちょっと待って、まだ考えてる。",
        note: "think の th は舌を軽く歯に。sink に聞こえると別の意味になる。",
        focus: ["th"]
      },
      {
        id: "fillers-07",
        text: "What's the word I'm looking for?",
        accept: [],
        ja: "えーっと、なんて単語だったかな。",
        note: "単語が出てこないときそのまま声に出すと、相手が教えてくれる。",
        focus: ["r-l"]
      },
      {
        id: "fillers-08",
        text: "Sorry, I lost my train of thought.",
        accept: ["Sorry, I forgot what I was saying."],
        ja: "ごめん、何を話してたか忘れちゃった。",
        note: "thought の th を落とすと別の語に聞こえる。最後まで息を通す。",
        focus: ["th"]
      },
      {
        id: "fillers-09",
        text: "I'm not sure how to say this in English.",
        accept: ["I don't know how to say this in English."],
        ja: "これ、英語でどう言えばいいかわからないな。",
        note: "黙るより口に出すほうがよい。ほぼ確実に助け船が出る。",
        focus: []
      },
      {
        id: "fillers-10",
        text: "Anyway, what I'm trying to say is pretty simple.",
        accept: ["Anyway, what I mean is pretty simple."],
        ja: "とにかく、私が言いたいのはすごく単純なことなんだ。",
        note: "話が脱線したときに本題へ戻す一言。Anyway は強く言いすぎない。",
        focus: []
      }
    ]
  },

  /* ------------------------------------------------------------------
   * 🫧 やわらげる言い方
   * 断りにくいことも角を立てずに言えて、会話の空気を保てる
   * ------------------------------------------------------------------ */
  {
    id: "softeners", title: "やわらげる言い方",
    subtitle: "断りにくいことも角を立てずに言えて、会話の空気を保てる",
    icon: "🫧", level: 4, order: 31,
    phrases: [
      {
        id: "softeners-01",
        text: "Maybe, but I'm not really sure.",
        accept: ["Maybe, but I'm not so sure."],
        ja: "たぶんね、でもはっきりとはわからない。",
        note: "言い切らずに逃げ道を作る一言。really の r をしっかり出す。",
        focus: ["r-l"]
      },
      {
        id: "softeners-02",
        text: "It's kind of hard to explain, actually.",
        accept: ["It's a little hard to explain, actually."],
        ja: "実は、ちょっと説明しづらいんだ。",
        note: "kind of は「カインダ」とつなげる。深く話したくないときにも使える。",
        focus: ["linking"]
      },
      {
        id: "softeners-03",
        text: "I'm afraid I can't make it tonight.",
        accept: ["Sorry, I can't make it tonight."],
        ja: "悪いけど、今夜は行けそうにない。",
        note: "I'm afraid は断りの前置き。afraid の f は下唇を軽く噛む。",
        focus: ["f-h"]
      },
      {
        id: "softeners-04",
        text: "Do you mind if I ask you something?",
        accept: ["Can I ask you something?"],
        ja: "ちょっと聞いてもいいかな？",
        note: "Do you mind? に Yes と答えると「ダメ」の意味になるので注意。",
        focus: []
      },
      {
        id: "softeners-05",
        text: "I'd rather stay home tonight, if that's okay.",
        accept: ["I'd rather stay home tonight, if you don't mind."],
        ja: "今夜は家にいたいかな、それでよければ。",
        note: "rather の th を落とさない。断りをやわらかく伝える形。",
        focus: ["th"]
      },
      {
        id: "softeners-06",
        text: "I was wondering if you had a minute.",
        accept: ["I was wondering if you have a minute."],
        ja: "ちょっと今、時間あるかなと思って。",
        note: "頼みごとの前置き。過去形にするだけで押しつけ感が消える。",
        focus: []
      },
      {
        id: "softeners-07",
        text: "I might be wrong, but I think it's closed.",
        accept: ["I could be wrong, but I think it's closed."],
        ja: "間違ってるかもしれないけど、たしか閉まってると思う。",
        note: "wrong の r と l を混ぜない。断定を避けると相手も話しやすい。",
        focus: ["r-l"]
      },
      {
        id: "softeners-08",
        text: "I see your point, but I'm not totally convinced.",
        accept: ["I see what you mean, but I'm not totally convinced."],
        ja: "言いたいことはわかる、でも完全には納得できていない。",
        note: "convinced の v を b にしない。反対する前にまず認めるのがコツ。",
        focus: ["v-b"]
      },
      {
        id: "softeners-09",
        text: "Correct me if I'm wrong, but that's next week.",
        accept: ["Correct me if I'm wrong, but isn't that next week?"],
        ja: "違ってたら言ってほしいんだけど、それって来週だよね。",
        note: "相手の間違いを直すときの定番の前置き。correct の r をはっきり。",
        focus: ["r-l"]
      },
      {
        id: "softeners-10",
        text: "I hate to say this, but we're running out of time.",
        accept: ["I hate to say this, but we don't have much time."],
        ja: "言いにくいんだけど、そろそろ時間がなくなってきた。",
        note: "running out of は「ラニンナウトブ」とひとつながりに言う。",
        focus: ["linking"]
      }
    ]
  },

  /* ------------------------------------------------------------------
   * 🔗 よく使う句動詞
   * 難しい単語より先に、会話で本当に使われる言い回しが身につく
   * ------------------------------------------------------------------ */
  {
    id: "phrasal", title: "よく使う句動詞",
    subtitle: "難しい単語より先に、会話で本当に使われる言い回しが身につく",
    icon: "🔗", level: 4, order: 32,
    phrases: [
      {
        id: "phrasal-01",
        text: "Let's hang out sometime next week.",
        accept: ["We should hang out sometime next week."],
        ja: "来週あたり、どこか遊びに行こうよ。",
        note: "hang out は「一緒にゆるく過ごす」。大人同士で play は使わない。",
        focus: []
      },
      {
        id: "phrasal-02",
        text: "We get along really well.",
        accept: ["We get along great."],
        ja: "私たち、すごく気が合うんだ。",
        note: "get along は「仲がいい」。along の l を最後まで出す。",
        focus: ["r-l"]
      },
      {
        id: "phrasal-03",
        text: "I'll pick you up at the station.",
        accept: ["I can pick you up at the station."],
        ja: "駅まで迎えに行くよ。",
        note: "pick you up は「ピッキューアップ」と一息でつなげる。",
        focus: ["linking"]
      },
      {
        id: "phrasal-04",
        text: "Can you turn the music down a little?",
        accept: ["Could you turn the music down a little?"],
        ja: "音楽の音、少し下げてくれる？",
        note: "turn down で「音量を下げる」。turn の r と little の l を区別。",
        focus: ["r-l"]
      },
      {
        id: "phrasal-05",
        text: "I ran into an old friend yesterday.",
        accept: ["I bumped into an old friend yesterday."],
        ja: "昨日、昔の友達にばったり会った。",
        note: "ran into an は「ラニントゥアン」とつなげる。偶然会うの意味。",
        focus: ["linking"]
      },
      {
        id: "phrasal-06",
        text: "Can you figure out how this works?",
        accept: ["Can you figure out how it works?"],
        ja: "これがどう動くのか、わかる？",
        note: "figure の f は下唇を軽く噛む。h で始めると別の音になる。",
        focus: ["f-h"]
      },
      {
        id: "phrasal-07",
        text: "Let's not put it off any longer.",
        accept: ["Let's stop putting it off."],
        ja: "これ以上、先延ばしにするのはやめよう。",
        note: "put off は「延期する」。off の f を落とすと通じない。",
        focus: ["f-h"]
      },
      {
        id: "phrasal-08",
        text: "Who came up with this idea?",
        accept: ["Who came up with that idea?"],
        ja: "これ、誰が思いついたの？",
        note: "come up with は「思いつく」。came up は「ケイマップ」に近い。",
        focus: ["linking"]
      },
      {
        id: "phrasal-09",
        text: "I'm looking forward to meeting your friends.",
        accept: ["I'm really looking forward to meeting your friends."],
        ja: "あなたの友達に会えるのを楽しみにしてる。",
        note: "forward to のあとは ing 形。to meet ではなく to meeting。",
        focus: ["r-l"]
      },
      {
        id: "phrasal-10",
        text: "We should catch up over coffee sometime.",
        accept: ["Let's catch up over coffee sometime."],
        ja: "今度コーヒーでも飲みながら、近況を話そうよ。",
        note: "catch up は「久しぶりに近況を話す」。coffee の f をはっきり。",
        focus: ["f-h"]
      }
    ]
  },

  /* ------------------------------------------------------------------
   * 😎 くだけた言い方
   * 丁寧すぎる英語から抜けて、友達との距離を縮められるようになる
   * ------------------------------------------------------------------ */
  {
    id: "casual", title: "くだけた言い方",
    subtitle: "丁寧すぎる英語から抜けて、友達との距離を縮められるようになる",
    icon: "😎", level: 4, order: 33,
    phrases: [
      {
        id: "casual-01",
        text: "Sounds good to me.",
        accept: ["That sounds good to me."],
        ja: "それでいいよ、いいね。",
        note: "Yes より自然な同意。文頭の It は言わずに始めてよい。",
        focus: []
      },
      {
        id: "casual-02",
        text: "No way! Are you serious?",
        accept: ["No way! Seriously?"],
        ja: "うそでしょ！本当に？",
        note: "驚きの定番。No way は way を強くはっきり、一息で言い切る。",
        focus: []
      },
      {
        id: "casual-03",
        text: "Let's grab something to eat.",
        accept: ["Do you want to grab something to eat?"],
        ja: "なんか食べに行こうよ。",
        note: "grab は「さっと食べる」。eat の t のあとに母音を足さない。",
        focus: ["ending-vowel"]
      },
      {
        id: "casual-04",
        text: "Long time no see! How've you been?",
        accept: ["Long time no see! How have you been?"],
        ja: "久しぶり！元気にしてた？",
        note: "再会の第一声。How've you been? は「ハウビュビン」に近い。",
        focus: ["v-b"]
      },
      {
        id: "casual-05",
        text: "That's so cool. I love it.",
        accept: ["That's really cool. I love it."],
        ja: "それすごくいいね。私、好きだな。",
        note: "love の v を b にしない。下唇を軽く噛んで息を出す。",
        focus: ["v-b"]
      },
      {
        id: "casual-06",
        text: "I'm not really into horror movies.",
        accept: ["I'm not a big fan of horror movies."],
        ja: "ホラー映画はあんまり得意じゃないんだ。",
        note: "be into 〜 は「ハマっている」。not really で角が立たない。",
        focus: ["r-l"]
      },
      {
        id: "casual-07",
        text: "My bad, I totally forgot about it.",
        accept: ["Sorry, I totally forgot about it."],
        ja: "ごめん、完全に忘れてた。",
        note: "My bad は友達同士の軽い謝り。目上の人には使わない。",
        focus: ["f-h"]
      },
      {
        id: "casual-08",
        text: "It's not a big deal, honestly.",
        accept: ["It's really not a big deal."],
        ja: "別に大したことじゃないよ、ほんとに。",
        note: "相手に気をつかわせたくないときの一言。honestly の h は発音しない。",
        focus: ["f-h"]
      },
      {
        id: "casual-09",
        text: "I'm dying to see that new movie.",
        accept: ["I really want to see that new movie."],
        ja: "あの新しい映画、めちゃくちゃ見たい。",
        note: "be dying to は「〜したくてたまらない」。大げさに言って大丈夫。",
        focus: []
      },
      {
        id: "casual-10",
        text: "That was way better than I expected.",
        accept: ["That was much better than I expected."],
        ja: "思ってたよりずっと良かった。",
        note: "way は「ずっと」の強調。than の th を落とさない。",
        focus: ["th"]
      }
    ]
  },

  /* ------------------------------------------------------------------
   * 📚 勉強・授業の話
   * 授業や課題の話を自分から切り出して続けられる
   * ------------------------------------------------------------------ */
  {
    id: "study", title: "勉強・授業の話",
    subtitle: "授業や課題の話を自分から切り出して続けられる",
    icon: "📚", level: 3, order: 40,
    phrases: [
      {
        id: "study-01",
        text: "What classes are you taking this semester?",
        accept: ["What are you taking this semester?"],
        ja: "今学期は何の授業を取ってるの？",
        note: "what class は「ワッ(ト)クラス」とつなげる。class の最後に「ウ」を足さない。",
        focus: ["linking", "ending-vowel"]
      },
      {
        id: "study-02",
        text: "I have a paper due next week.",
        accept: ["I've got a paper due next week."],
        ja: "来週レポートの締め切りがあるんだ。",
        note: "日本語の「レポート」は英語では paper。report と言うと通じにくい。",
        focus: []
      },
      {
        id: "study-03",
        text: "Did you understand today's lecture?",
        accept: ["Did you get today's lecture?"],
        ja: "今日の講義、わかった？",
        note: "Did you は「ディジュ」とつなげて言うと自然。",
        focus: ["linking"]
      },
      {
        id: "study-04",
        text: "Can I borrow your notes from last class?",
        accept: ["Could I borrow your notes from last class?"],
        ja: "この前の授業のノート、借りてもいい？",
        note: "borrow の r と l を混ぜない。ノートは note ではなく notes。",
        focus: ["r-l", "ending-vowel"]
      },
      {
        id: "study-05",
        text: "I'm majoring in economics, but I might switch.",
        accept: ["I'm an economics major, but I might switch."],
        ja: "経済学を専攻してるけど、変えるかもしれない。",
        note: "専攻を聞くときは What's your major? が定番。",
        focus: ["r-l"]
      },
      {
        id: "study-06",
        text: "That professor talks way too fast for me.",
        accept: ["That teacher talks way too fast for me."],
        ja: "あの先生、話すのが私には速すぎる。",
        note: "fast の f は下唇を軽く噛む。h の音にすると別の語に聞こえる。",
        focus: ["f-h", "th"]
      },
      {
        id: "study-07",
        text: "Could you explain that part one more time?",
        accept: ["Could you go over that part one more time?"],
        ja: "そこの部分、もう一回説明してもらえますか？",
        note: "that part は t を一度だけ。「ザッパート」くらいでよい。",
        focus: ["th", "linking"]
      },
      {
        id: "study-08",
        text: "I stayed up all night studying for the test.",
        accept: ["I was up all night studying for the test."],
        ja: "試験勉強で徹夜しちゃった。",
        note: "stayed up all を「ステイダッポール」とつなげる。",
        focus: ["linking"]
      },
      {
        id: "study-09",
        text: "I'm not really good at math, to be honest.",
        accept: ["I'm not very good at math, to be honest."],
        ja: "正直、数学はあまり得意じゃないんだ。",
        note: "math の th は舌先を軽く歯に。honest の h は読まない。",
        focus: ["th", "f-h"]
      },
      {
        id: "study-10",
        text: "I'm struggling with this assignment. Could you give me a hand?",
        accept: ["I'm having trouble with this assignment. Could you help me?"],
        ja: "この課題で行き詰まってる。ちょっと手伝ってもらえない？",
        note: "give me a hand は「手を貸して」。help より軽く頼める言い方。",
        focus: ["r-l", "th"]
      }
    ]
  },

  /* ------------------------------------------------------------------
   * 💼 アルバイトと将来の話
   * バイトと将来の夢を自分の言葉で話せるようになる
   * ------------------------------------------------------------------ */
  {
    id: "work", title: "アルバイトと将来の話",
    subtitle: "バイトと将来の夢を自分の言葉で話せるようになる",
    icon: "💼", level: 3, order: 41,
    phrases: [
      {
        id: "work-01",
        text: "Do you have a part-time job?",
        accept: ["Are you working part-time?"],
        ja: "バイトしてるの？",
        note: "「アルバイト」は英語では通じない。part-time job と言う。",
        focus: ["linking"]
      },
      {
        id: "work-02",
        text: "I work at a coffee shop on weekends.",
        accept: ["I work at a cafe on weekends."],
        ja: "週末はカフェで働いてる。",
        note: "coffee の f を h にしない。「コーヒー」ではなく「カーフィ」。",
        focus: ["f-h"]
      },
      {
        id: "work-03",
        text: "How many days a week do you work?",
        accept: [],
        ja: "週に何日働いてるの？",
        note: "days a week は「デイザウィーク」とつなげる。",
        focus: ["linking"]
      },
      {
        id: "work-04",
        text: "I have a shift tonight, so I can't come.",
        accept: ["I've got work tonight, so I can't come."],
        ja: "今夜バイトがあるから行けないんだ。",
        note: "shift の最後に「ト」の母音を足さない。",
        focus: ["ending-vowel", "f-h"]
      },
      {
        id: "work-05",
        text: "I'm saving up for a trip abroad.",
        accept: ["I'm saving money for a trip abroad."],
        ja: "海外旅行のためにお金を貯めてる。",
        note: "saving の v を b にしない。上の歯を下唇に当てる。",
        focus: ["v-b", "r-l"]
      },
      {
        id: "work-06",
        text: "The pay isn't great, but the people are nice.",
        accept: ["The money isn't great, but the people are nice."],
        ja: "給料はよくないけど、人はいいんだ。",
        note: "給料は pay。salary は正社員の年収の話に使う。",
        focus: ["th"]
      },
      {
        id: "work-07",
        text: "What kind of work do you want to do?",
        accept: ["What kind of job do you want to do?"],
        ja: "どんな仕事がしたいの？",
        note: "kind of は「カインダ」、want to は「ワナ」でよい。",
        focus: ["linking"]
      },
      {
        id: "work-08",
        text: "I'm not sure what I want to do yet.",
        accept: ["I still don't know what I want to do."],
        ja: "将来何がしたいか、まだ決まってないんだ。",
        note: "答えられないときはこれで十分。黙るより会話が続く。",
        focus: []
      },
      {
        id: "work-09",
        text: "Job hunting starts next year, and I'm kind of nervous.",
        accept: ["Job hunting starts next year, and I'm a little nervous."],
        ja: "来年就活が始まるんだけど、ちょっと不安。",
        note: "就活は job hunting。starts の ts を落とさない。",
        focus: ["ending-vowel", "v-b"]
      },
      {
        id: "work-10",
        text: "I'd love a job where I can use English every day.",
        accept: ["I want a job where I can use English every day."],
        ja: "毎日英語を使える仕事に就きたいな。",
        note: "I'd love は「〜できたら最高」。want より柔らかく響く。",
        focus: ["r-l", "v-b"]
      }
    ]
  },

  /* ------------------------------------------------------------------
   * 🆘 困ったとき・体調
   * 体調不良や忘れ物のとき、その場で助けを求められる
   * ------------------------------------------------------------------ */
  {
    id: "trouble", title: "困ったとき・体調",
    subtitle: "体調不良や忘れ物のとき、その場で助けを求められる",
    icon: "🆘", level: 3, order: 42,
    phrases: [
      {
        id: "trouble-01",
        text: "I don't feel well today.",
        accept: ["I'm not feeling well today."],
        ja: "今日は体調が悪いんだ。",
        note: "feel の l は舌を上につけたまま終える。",
        focus: ["f-h", "r-l"]
      },
      {
        id: "trouble-02",
        text: "Excuse me, could you help me for a minute?",
        accept: ["Excuse me, can you help me for a minute?"],
        ja: "すみません、ちょっと助けてもらえますか？",
        note: "困ったときの最初の一言。Excuse me をはっきり強めに。",
        focus: []
      },
      {
        id: "trouble-03",
        text: "I can't find my wallet anywhere.",
        accept: ["I can't seem to find my wallet anywhere."],
        ja: "財布がどこにも見つからない。",
        note: "wallet の l を r にしない。舌先を上の歯ぐきにつける。",
        focus: ["r-l"]
      },
      {
        id: "trouble-04",
        text: "I have a headache and a slight fever.",
        accept: ["I have a headache and a bit of a fever."],
        ja: "頭が痛くて、少し熱もあります。",
        note: "headache の h と fever の f を取り違えない。",
        focus: ["f-h", "v-b"]
      },
      {
        id: "trouble-05",
        text: "Is there a drugstore around here?",
        accept: ["Is there a pharmacy around here?"],
        ja: "この辺に薬局はありますか？",
        note: "around here を「アラウンヒア」とつなげる。there の th も忘れずに。",
        focus: ["th", "r-l"]
      },
      {
        id: "trouble-06",
        text: "Sorry, I'm running about ten minutes late.",
        accept: ["Sorry, I'm running about 10 minutes late.", "Sorry, I'll be about ten minutes late."],
        ja: "ごめん、10分くらい遅れそう。",
        note: "遅刻の連絡は running late が定番。late を強めに。",
        focus: ["r-l"]
      },
      {
        id: "trouble-07",
        text: "I think I got on the wrong train.",
        accept: ["I think I took the wrong train."],
        ja: "電車を乗り間違えたみたい。",
        note: "got on は「ガロン」のようにつながる。wrong の w は音にしない。",
        focus: ["th", "r-l", "linking"]
      },
      {
        id: "trouble-08",
        text: "Could you speak a little more slowly, please?",
        accept: ["Could you slow down a little, please?"],
        ja: "もう少しゆっくり話してもらえますか？",
        note: "聞き取れないときの最重要フレーズ。little と slowly の l を丁寧に。",
        focus: ["r-l"]
      },
      {
        id: "trouble-09",
        text: "I left my bag on the train. What should I do?",
        accept: ["I think I left my bag on the train. What should I do?"],
        ja: "電車にカバンを忘れました。どうすればいいですか？",
        note: "場所を言うときの「忘れた」は forget ではなく leave。",
        focus: ["th", "v-b"]
      },
      {
        id: "trouble-10",
        text: "I'm not feeling great, so I'll head home early.",
        accept: ["I'm not feeling well, so I'll go home early."],
        ja: "体調がよくないから、早めに帰るね。",
        note: "head home で「家に帰る」。会話ではこちらのほうがよく出る。",
        focus: ["f-h", "r-l"]
      }
    ]
  },

  /* ------------------------------------------------------------------
   * 💻 オンライン通話・メッセージ
   * 通話が乱れても止まらず、メッセージも自然に返せる
   * ------------------------------------------------------------------ */
  {
    id: "online", title: "オンライン通話・メッセージ",
    subtitle: "通話が乱れても止まらず、メッセージも自然に返せる",
    icon: "💻", level: 3, order: 43,
    phrases: [
      {
        id: "online-01",
        text: "Can you hear me okay?",
        accept: ["Can you hear me all right?"],
        ja: "ちゃんと聞こえてる？",
        note: "通話の最初の一言。hear の h に息をしっかり乗せる。",
        focus: ["f-h"]
      },
      {
        id: "online-02",
        text: "I think your mic is muted.",
        accept: ["I think you're on mute."],
        ja: "マイクがミュートになってると思うよ。",
        note: "mic の最後に「ク」の母音を足さない。think の th も忘れずに。",
        focus: ["th", "ending-vowel"]
      },
      {
        id: "online-03",
        text: "Sorry, you're breaking up a little.",
        accept: ["Sorry, you're cutting out a little."],
        ja: "ごめん、声が少し途切れてる。",
        note: "break up は通話が途切れること。up a を「アッパ」とつなげる。",
        focus: ["r-l", "linking"]
      },
      {
        id: "online-04",
        text: "My connection is really bad right now.",
        accept: ["My internet is really bad right now."],
        ja: "今、回線がすごく悪いんだ。",
        note: "really と right の r を続けて出す練習に。舌を丸めて。",
        focus: ["r-l"]
      },
      {
        id: "online-05",
        text: "Do you mind turning your camera on?",
        accept: ["Could you turn your camera on?"],
        ja: "カメラをつけてもらえる？",
        note: "Do you mind …? に「いいよ」と答えるときは No が正解。",
        focus: ["r-l"]
      },
      {
        id: "online-06",
        text: "Let me share my screen for a second.",
        accept: ["I'll share my screen for a second."],
        ja: "ちょっと画面を共有するね。",
        note: "for a second は「フォーラセカン」くらいで十分通じる。",
        focus: ["r-l", "linking"]
      },
      {
        id: "online-07",
        text: "Sorry, I didn't catch that. Could you say it again?",
        accept: ["Sorry, I missed that. Could you say it again?"],
        ja: "ごめん、聞き取れなかった。もう一回言ってくれる？",
        note: "catch は「聞き取る」。didn't catch that をひと息で言い切る。",
        focus: ["th", "linking"]
      },
      {
        id: "online-08",
        text: "I'll leave and rejoin. Give me a second.",
        accept: ["I'll drop off and rejoin. Give me a second.", "I'll leave and rejoin. Give me one second."],
        ja: "一回抜けて入り直すね。ちょっと待ってて。",
        note: "leave and を「リーヴァン」とつなげる。v を b にしない。",
        focus: ["v-b", "linking"]
      },
      {
        id: "online-09",
        text: "I'll send the link in the group chat.",
        accept: ["I'll post the link in the group chat."],
        ja: "グループチャットにリンクを送っておくね。",
        note: "link の l を r にしない。語末に「ク」の母音も足さない。",
        focus: ["r-l", "ending-vowel"]
      },
      {
        id: "online-10",
        text: "Sorry for the late reply. I just saw your message.",
        accept: ["Sorry for the slow reply. I just saw your message."],
        ja: "返信遅れてごめん。今メッセージ見たところ。",
        note: "返信が遅れたときの定番。reply の r と l を続けて丁寧に。",
        focus: ["r-l", "f-h"]
      }
    ]
  },
];

/* 99-app.js の起動チェック（LC.__loaded と必須リストの突き合わせ）用。
 * 他の JS ファイルと同じ作法でロード済みであることを申告しておく。 */
window.LC.__loaded = (window.LC.__loaded || []).concat('decks');

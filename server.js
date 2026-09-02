const express = require("express");
const path = require("path");

require("dotenv").config();

const app = express();

const PORT =
  process.env.PORT || 3000;

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY;


/* =========================================================
   Express
========================================================= */

app.use(
  express.json({
    limit: "1mb"
  })
);

app.use(
  express.static(
    path.join(
      __dirname,
      "public"
    )
  )
);


/* =========================================================
   OpenAI helpers
========================================================= */

function requireKey(
  req,
  res,
  next
) {
  if (!OPENAI_API_KEY) {
    return res
      .status(500)
      .json({
        error:
          "OPENAI_API_KEY が設定されていません。"
      });
  }

  next();
}


function outputText(data) {
  if (
    typeof data.output_text ===
    "string"
  ) {
    return data.output_text;
  }

  return (
    data.output || []
  )
    .flatMap(
      item =>
        item.content || []
    )
    .filter(
      item =>
        item.type ===
        "output_text"
    )
    .map(
      item =>
        item.text || ""
    )
    .join("\n");
}


function parseJson(text) {
  return JSON.parse(
    String(text || "")
      .replace(
        /^```json\s*/i,
        ""
      )
      .replace(
        /^```\s*/i,
        ""
      )
      .replace(
        /\s*```$/i,
        ""
      )
      .trim()
  );
}


async function generateJson(prompt) {
  const response =
    await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${OPENAI_API_KEY}`,

          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            model:
              "gpt-5.6-luna",

            input:
              prompt,

            reasoning: {
              effort: "none"
            }
          })
      }
    );


  const data =
    await response.json();


  if (!response.ok) {
    throw new Error(
      data.error?.message ||
      "OpenAI API error"
    );
  }


  return parseJson(
    outputText(data)
  );
}


/* =========================================================
   Common helpers
========================================================= */

function clampAnswerIndex(question) {
  const n =
    Number(
      question.answer_index
    );

  if (
    !Number.isInteger(n) ||
    n < 0 ||
    n > 3
  ) {
    return null;
  }

  return n;
}


function validateQuestions(
  questions,
  expected
) {
  if (
    !Array.isArray(
      questions
    ) ||
    questions.length !==
      expected
  ) {
    throw new Error(
      "問題の生成形式が不正でした。"
    );
  }


  questions.forEach(
    question => {

      if (
        !Array.isArray(
          question.options
        ) ||
        question.options.length !==
          4
      ) {
        throw new Error(
          "選択肢の生成形式が不正でした。"
        );
      }


      const answerIndex =
        clampAnswerIndex(
          question
        );


      if (
        answerIndex === null
      ) {
        throw new Error(
          "answer_index が不正です。"
        );
      }


      question.answer_index =
        answerIndex;
    }
  );
}


/* =========================================================
   Language helpers
========================================================= */

function hasJapanese(text) {
  return /[\u3040-\u30ff\u3400-\u9fff]/u
    .test(
      String(
        text || ""
      )
    );
}


function hasLatin(text) {
  return /[A-Za-z]/
    .test(
      String(
        text || ""
      )
    );
}


function looksEnglishOption(text) {
  const value =
    String(
      text || ""
    ).trim();

  return (
    value.length > 0 &&
    hasLatin(value) &&
    !hasJapanese(value)
  );
}


function looksJapaneseOption(text) {
  const value =
    String(
      text || ""
    ).trim();

  return (
    value.length > 0 &&
    hasJapanese(value)
  );
}


function normalizeWord(text) {
  return String(
    text || ""
  )
    .trim()
    .toLowerCase()
    .replace(
      /[’']/g,
      "'"
    )
    .replace(
      /[^a-z0-9' -]/g,
      ""
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


/* =========================================================
   Vocabulary candidate validation
========================================================= */

/*
  今回の重要部分です。

  問題セット全体をthrowするのではなく、
  各候補を1問ずつ検査します。

  OKなら:
  {
    ok: true,
    question: ...
  }

  NGなら:
  {
    ok: false,
    reason: ...
  }
*/

function validateVocabularyCandidate({
  rawQuestion,
  mode,
  expectedSource,
  recentSet,
  eligibleWeakSet,
  cooldownSet,
  alreadySelectedSet
}) {

  try {

    if (
      !rawQuestion ||
      typeof rawQuestion !==
        "object"
    ) {
      throw new Error(
        "question object missing"
      );
    }


    const prompt =
      String(
        rawQuestion.prompt || ""
      ).trim();


    const context =
      String(
        rawQuestion.context || ""
      ).trim();


    const word =
      String(
        rawQuestion.word || ""
      ).trim();


    const meaningJa =
      String(
        rawQuestion.meaning_ja || ""
      ).trim();


    const explanationJa =
      String(
        rawQuestion.explanation_ja || ""
      ).trim();


    const options =
      Array.isArray(
        rawQuestion.options
      )
        ? rawQuestion.options.map(
            item =>
              String(
                item || ""
              ).trim()
          )
        : [];


    /*
      基本チェック
    */

    if (!word) {
      throw new Error(
        "word is empty"
      );
    }


    const key =
      normalizeWord(
        word
      );


    if (!key) {
      throw new Error(
        "word cannot be normalized"
      );
    }


    if (
      alreadySelectedSet.has(
        key
      )
    ) {
      throw new Error(
        `duplicate in current set: ${word}`
      );
    }


    if (
      options.length !== 4
    ) {
      throw new Error(
        "options must contain exactly 4 items"
      );
    }


    if (
      options.some(
        option =>
          !option
      )
    ) {
      throw new Error(
        "empty option"
      );
    }


    /*
      選択肢内の完全重複も禁止
    */

    const normalizedOptions =
      options.map(
        option =>
          option
            .trim()
            .toLowerCase()
      );


    if (
      new Set(
        normalizedOptions
      ).size !== 4
    ) {
      throw new Error(
        "duplicate options"
      );
    }


    const answerIndex =
      clampAnswerIndex(
        rawQuestion
      );


    if (
      answerIndex === null
    ) {
      throw new Error(
        "invalid answer_index"
      );
    }


    /*
      ========================
      blank
      ========================
    */

    if (
      mode === "blank"
    ) {

      const blankCount =
        (
          prompt.match(
            /_____/g
          ) || []
        ).length;


      if (
        blankCount !== 1
      ) {
        throw new Error(
          "blank prompt must contain exactly one _____"
        );
      }


      if (
        !hasLatin(prompt) ||
        hasJapanese(prompt)
      ) {
        throw new Error(
          "blank prompt must be English"
        );
      }


      if (
        !options.every(
          looksEnglishOption
        )
      ) {
        throw new Error(
          "blank options must all be English"
        );
      }


      const correctOption =
        options[
          answerIndex
        ];


      if (
        normalizeWord(
          correctOption
        ) !== key
      ) {
        throw new Error(
          "blank correct option does not match word"
        );
      }
    }


    /*
      ========================
      en-ja
      ========================
    */

    if (
      mode === "en-ja"
    ) {

      if (
        !hasLatin(prompt) ||
        hasJapanese(prompt)
      ) {
        throw new Error(
          "en-ja prompt must be English"
        );
      }


      if (
        normalizeWord(
          prompt
        ) !== key
      ) {
        throw new Error(
          "en-ja prompt does not match word"
        );
      }


      if (
        !options.every(
          looksJapaneseOption
        )
      ) {
        throw new Error(
          "en-ja options must all be Japanese"
        );
      }
    }


    /*
      ========================
      ja-en
      ========================
    */

    if (
      mode === "ja-en"
    ) {

      if (
        !hasJapanese(prompt)
      ) {
        throw new Error(
          "ja-en prompt must be Japanese"
        );
      }


      if (
        !options.every(
          looksEnglishOption
        )
      ) {
        throw new Error(
          "ja-en options must all be English"
        );
      }


      const correctOption =
        options[
          answerIndex
        ];


      if (
        normalizeWord(
          correctOption
        ) !== key
      ) {
        throw new Error(
          "ja-en correct option does not match word"
        );
      }
    }


    /*
      ========================
      source
      ========================
    */

    if (
      expectedSource === "new"
    ) {

      /*
        新規問題は
        直近200語に含まれていたら
        その問題だけ不採用
      */

      if (
        recentSet.has(
          key
        )
      ) {
        throw new Error(
          `recent word: ${word}`
        );
      }

    } else {

      /*
        reviewは
        Eligible Weak Words限定
      */

      if (
        !eligibleWeakSet.has(
          key
        )
      ) {
        throw new Error(
          `not eligible weak word: ${word}`
        );
      }


      /*
        直近30語クールダウン
      */

      if (
        cooldownSet.has(
          key
        )
      ) {
        throw new Error(
          `review cooldown: ${word}`
        );
      }
    }


    return {
      ok: true,

      question: {
        prompt,
        context,
        options,
        answer_index:
          answerIndex,
        word,
        meaning_ja:
          meaningJa,
        explanation_ja:
          explanationJa,
        source:
          expectedSource
      }
    };

  } catch (error) {

    return {
      ok: false,
      reason:
        error.message
    };
  }
}


/* =========================================================
   Listening random categories
========================================================= */

const LISTENING_RANDOM_CATEGORIES = [

  {
    id: "restaurant",
    label:
      "restaurant, cafe, ordering food, or making a reservation"
  },

  {
    id: "work",
    label:
      "workplace, meeting, coworker, deadline, or office communication"
  },

  {
    id: "shopping",
    label:
      "shopping, returning an item, asking about a product, or paying"
  },

  {
    id: "hotel",
    label:
      "hotel, check-in, check-out, room request, or accommodation"
  },

  {
    id: "school",
    label:
      "school, class, studying, assignment, or campus life"
  },

  {
    id: "health",
    label:
      "health, pharmacy, clinic, appointment, or describing a minor symptom"
  },

  {
    id: "home",
    label:
      "home, household task, cooking, cleaning, or a small problem at home"
  },

  {
    id: "friends",
    label:
      "friends, making plans, changing plans, invitation, or social activity"
  },

  {
    id: "phone",
    label:
      "phone call, voicemail, message, or contacting someone"
  },

  {
    id: "delivery",
    label:
      "delivery, package, online order, receiving an item, or shipping"
  },

  {
    id: "bank",
    label:
      "banking, payment, ATM, bill, or simple financial service"
  },

  {
    id: "event",
    label:
      "event, concert, museum, movie, ticket, or public activity"
  },

  {
    id: "travel",
    label:
      "travel planning, sightseeing, airport, luggage, or tourist information"
  },

  {
    id: "transport",
    label:
      "public transportation, train, bus, taxi, station, or route"
  },

  {
    id: "weather",
    label:
      "weather, changing plans because of weather, or preparing for conditions"
  },

  {
    id: "service",
    label:
      "customer service, asking for help, making a request, or solving a service problem"
  },

  {
    id: "appointment",
    label:
      "appointment, schedule, rescheduling, or confirming a time"
  },

  {
    id: "technology",
    label:
      "computer, smartphone, internet, simple technical problem, or online service"
  },

  {
    id: "neighborhood",
    label:
      "neighborhood, local facility, asking for directions, or community activity"
  },

  {
    id: "daily",
    label:
      "ordinary daily life, errands, routine plans, or a small everyday decision"
  }

];


let recentRandomCategories =
  [];


function chooseListeningCategory() {

  const CATEGORY_COOLDOWN =
    5;


  const blocked =
    new Set(
      recentRandomCategories.slice(
        -CATEGORY_COOLDOWN
      )
    );


  let candidates =
    LISTENING_RANDOM_CATEGORIES
      .filter(
        category =>
          !blocked.has(
            category.id
          )
      );


  if (
    candidates.length === 0
  ) {
    candidates =
      LISTENING_RANDOM_CATEGORIES;
  }


  const selected =
    candidates[
      Math.floor(
        Math.random() *
        candidates.length
      )
    ];


  recentRandomCategories.push(
    selected.id
  );


  recentRandomCategories =
    recentRandomCategories.slice(
      -20
    );


  return selected;
}


/* =========================================================
   LISTENING
========================================================= */

app.post(
  "/api/listening",
  requireKey,
  async (
    req,
    res
  ) => {

    try {

      const mode =
        String(
          req.body.mode ||
          "dictation"
        );


      const level =
        String(
          req.body.level ||
          "B1"
        );


      const requestedTopic =
        String(
          req.body.topic ||
          "Random"
        );


      const length =
        String(
          req.body.length ||
          "short"
        );


      const recentListening =
        Array.isArray(
          req.body.recentListening
        )
          ? req.body.recentListening
              .map(
                item =>
                  String(
                    item || ""
                  ).trim()
              )
              .filter(Boolean)
              .slice(-20)
          : [];


      const veryRecentListening =
        recentListening.slice(
          -5
        );


      let selectedCategory =
        null;


      let actualTopic =
        requestedTopic;


      if (
        requestedTopic
          .trim()
          .toLowerCase() ===
        "random"
      ) {

        selectedCategory =
          chooseListeningCategory();


        actualTopic =
          selectedCategory.label;
      }


      const lengthRule =
        length === "short"
          ? "8-14 words"
          : length === "medium"
          ? "15-28 words"
          : "29-50 words";


      const recentText =
        recentListening.length
          ? recentListening
              .map(
                (sentence, index) =>
                  `${index + 1}. ${sentence}`
              )
              .join("\n")
          : "(none)";


      const veryRecentText =
        veryRecentListening.length
          ? veryRecentListening
              .map(
                (sentence, index) =>
                  `${index + 1}. ${sentence}`
              )
              .join("\n")
          : "(none)";


      const randomRule =
        selectedCategory
          ? `
This request uses RANDOM mode.

For this exercise use this broad category:

${selectedCategory.label}

Create a fresh and specific situation.

Random means variety of situations,
not merely different wording.

Do NOT simply reuse a recent scenario with
different nouns, places, vehicles, or names.
`
          : `
The learner explicitly selected this topic:

${requestedTopic}

Stay within this topic,
but make the situation meaningfully different
from the recent listening exercises.
`;


      const commonVarietyRules = `
${randomRule}

RECENT LISTENING EXERCISES:

${recentText}

FIVE MOST RECENT:

${veryRecentText}


VARIETY RULES:

- do not repeat the same basic event
- compare the underlying situation, not just words
- "missed the bus", "missed the train",
  and "arrived too late for the subway"
  count as substantially the same scenario
- avoid repeating the same combination of:
  location, problem, goal, and outcome
- prefer a different communicative purpose
  from very recent exercises
- keep the scenario natural and realistic
- if your first idea is too similar,
  silently choose another one
`;


      const prompt =
        mode === "mcq"
          ? `
Create ONE English listening comprehension exercise for a Japanese learner.

CEFR:
${level}

Actual scenario category:
${actualTopic}

Passage length:
${lengthRule}

${commonVarietyRules}

Return ONLY valid JSON:

{
  "sentence":
    "natural spoken English",

  "translation":
    "natural Japanese translation",

  "listening_tip":
    "short Japanese listening tip",

  "scenario":
    "very short English scenario description",

  "questions": [
    {
      "question":
        "English question",

      "options": [
        "option A",
        "option B",
        "option C",
        "option D"
      ],

      "answer_index":
        0,

      "explanation_ja":
        "Japanese explanation"
    },

    {
      "question":
        "English question",

      "options": [
        "option A",
        "option B",
        "option C",
        "option D"
      ],

      "answer_index":
        1,

      "explanation_ja":
        "Japanese explanation"
    },

    {
      "question":
        "English question",

      "options": [
        "option A",
        "option B",
        "option C",
        "option D"
      ],

      "answer_index":
        2,

      "explanation_ja":
        "Japanese explanation"
    }
  ]
}

Rules:

- exactly 3 questions
- exactly 4 English options per question
- exactly one correct answer
- every answer must be supported by the audio
- natural CEFR ${level} English
- no markdown
- no text outside JSON
`

          : `
Create ONE English listening dictation exercise for a Japanese learner.

CEFR:
${level}

Actual scenario category:
${actualTopic}

Length:
${lengthRule}

${commonVarietyRules}

Return ONLY valid JSON:

{
  "sentence":
    "natural English sentence or connected sentences",

  "translation":
    "natural Japanese translation",

  "listening_tip":
    "short Japanese explanation",

  "scenario":
    "very short English scenario description"
}

Rules:

- natural useful CEFR ${level} English
- respect the requested length
- avoid obscure proper nouns
- no markdown
- no text outside JSON
`;


      let data =
        null;


      let lastError =
        null;


      for (
        let attempt = 1;
        attempt <= 2;
        attempt++
      ) {

        try {

          data =
            await generateJson(
              prompt
            );


          if (
            !data ||
            !String(
              data.sentence || ""
            ).trim()
          ) {
            throw new Error(
              "Listening英文が生成されませんでした。"
            );
          }


          if (
            mode === "mcq"
          ) {
            validateQuestions(
              data.questions,
              3
            );
          }


          break;

        } catch (
          generationError
        ) {

          data =
            null;


          lastError =
            generationError;


          console.warn(
            `Listening generation attempt ${attempt} failed:`,
            generationError.message
          );
        }
      }


      if (!data) {
        throw (
          lastError ||
          new Error(
            "Listening問題の生成に失敗しました。"
          )
        );
      }


      res.json(
        data
      );

    } catch (error) {

      console.error(
        "Listening error:",
        error
      );


      res
        .status(500)
        .json({
          error:
            error.message ||
            "問題作成に失敗しました。"
        });
    }
  }
);


/* =========================================================
   VOCABULARY
========================================================= */

app.post(
  "/api/vocabulary",
  requireKey,
  async (
    req,
    res
  ) => {

    try {

      const level =
        String(
          req.body.level ||
          "B1"
        );


      const topic =
        String(
          req.body.topic ||
          "Daily conversation"
        );


      const mode =
        String(
          req.body.mode ||
          "en-ja"
        );


      if (
        ![
          "en-ja",
          "ja-en",
          "blank"
        ].includes(mode)
      ) {
        throw new Error(
          "Vocabularyの出題形式が不正です。"
        );
      }


      const count =
        Math.max(
          5,
          Math.min(
            15,
            Number(
              req.body.count
            ) || 10
          )
        );


      /*
        =========================
        履歴
        =========================
      */

      const recentWords =
        Array.isArray(
          req.body.recentWords
        )
          ? req.body.recentWords
              .map(
                word =>
                  String(
                    word || ""
                  ).trim()
              )
              .filter(Boolean)
              .slice(-200)
          : [];


      const weakWords =
        Array.isArray(
          req.body.weakWords
        )
          ? req.body.weakWords
              .map(
                item => ({
                  word:
                    String(
                      item?.word || ""
                    ).trim(),

                  meaning_ja:
                    String(
                      item?.meaning_ja || ""
                    ).trim(),

                  count:
                    Number(
                      item?.count || 1
                    )
                })
              )
              .filter(
                item =>
                  item.word
              )
              .slice(
                0,
                40
              )
          : [];


      /*
        =========================
        復習クールダウン
        =========================
      */

      const REVIEW_COOLDOWN =
        30;


      const recentCooldownWords =
        recentWords.slice(
          -REVIEW_COOLDOWN
        );


      const cooldownSet =
        new Set(
          recentCooldownWords.map(
            normalizeWord
          )
        );


      const eligibleWeakWords =
        weakWords
          .filter(
            item =>
              !cooldownSet.has(
                normalizeWord(
                  item.word
                )
              )
          )
          .sort(
            (a, b) =>
              b.count -
              a.count
          );


      const eligibleWeakSet =
        new Set(
          eligibleWeakWords.map(
            item =>
              normalizeWord(
                item.word
              )
          )
        );


      const recentSet =
        new Set(
          recentWords.map(
            normalizeWord
          )
        );


      /*
        基本は20%復習
      */

      const desiredReviewCount =
        Math.min(
          Math.round(
            count * 0.2
          ),
          eligibleWeakWords.length
        );


      /*
        採用済み
      */

      const selectedQuestions =
        [];


      const alreadySelectedSet =
        new Set();


      /*
        =========================
        モード別ルール
        =========================
      */

      const modeRule =
        mode === "blank"
          ? `
MODE = blank

Every question:

- prompt:
  one natural English sentence
  containing exactly one _____

- options:
  exactly four ENGLISH words
  or short English phrases

- word:
  the correct English word or phrase

- meaning_ja:
  Japanese meaning

- context:
  empty string

The correct option must be exactly the same
English word or phrase as "word".

Japanese options are forbidden.
`

          : mode === "ja-en"
          ? `
MODE = ja-en

Every question:

- prompt:
  Japanese meaning only

- options:
  exactly four ENGLISH words
  or short English phrases

- word:
  correct English target word

- meaning_ja:
  Japanese meaning

The correct English option must be exactly
the same word or phrase as "word".

Japanese options are forbidden.
`

          : `
MODE = en-ja

Every question:

- prompt:
  one English word or short English phrase only

- options:
  exactly four JAPANESE meanings

- word:
  exactly the same English word or phrase as prompt

- meaning_ja:
  Japanese meaning

English answer options are forbidden.
`;


      /*
        =====================================================
        候補生成関数

        source:
        "new"
        または
        "review"
        =====================================================
      */

      async function requestVocabularyCandidates({
        source,
        needed
      }) {

        /*
          必要数より少し多く候補を作る。

          例えば2問必要なら5候補程度。
          一部が重複でも残りを採用できる。
        */

        const candidateCount =
          Math.min(
            15,
            Math.max(
              5,
              needed + 3
            )
          );


        const selectedWordsText =
          Array.from(
            alreadySelectedSet
          ).length
            ? Array.from(
                alreadySelectedSet
              ).join(", ")
            : "(none)";


        let sourceRules =
          "";


        if (
          source === "review"
        ) {

          const eligibleText =
            eligibleWeakWords.length
              ? eligibleWeakWords
                  .map(
                    item =>
                      `${item.word}${
                        item.meaning_ja
                          ? ` (${item.meaning_ja})`
                          : ""
                      }`
                  )
                  .join(", ")
              : "(none)";


          sourceRules = `
SOURCE = review

Choose target words ONLY from this list:

${eligibleText}

Do not invent another review word.

Do not use a word already selected
for this current set:

${selectedWordsText}
`;

        } else {

          const recentText =
            recentWords.length
              ? recentWords.join(
                  ", "
                )
              : "(none)";


          sourceRules = `
SOURCE = new

Choose useful CEFR ${level}
vocabulary appropriate to:

${topic}

DO NOT use any target word from:

${recentText}

Also do not use any target word
already selected for this current set:

${selectedWordsText}

Prefer useful, practical,
high-frequency vocabulary.

Avoid trivial singular/plural changes
or simple inflections merely to bypass
the recent-word restriction.
`;
        }


        const prompt = `
Create ${candidateCount} CANDIDATE English vocabulary questions.

These are only candidates.
The server will filter unsuitable questions.

CEFR:
${level}

Topic:
${topic}

${modeRule}

${sourceRules}

Return ONLY valid JSON:

{
  "questions": [
    {
      "prompt":
        "string",

      "context":
        "string",

      "options": [
        "string",
        "string",
        "string",
        "string"
      ],

      "answer_index":
        0,

      "word":
        "target English word or phrase",

      "meaning_ja":
        "Japanese meaning",

      "explanation_ja":
        "short Japanese explanation"
    }
  ]
}

Rules:

- return exactly ${candidateCount} candidates
- exactly 4 options per candidate
- answer_index must be 0, 1, 2, or 3
- target words should be different from one another
- all candidates must obey MODE = ${mode}
- no markdown
- no text outside JSON
`;


        const data =
          await generateJson(
            prompt
          );


        if (
          !Array.isArray(
            data.questions
          )
        ) {
          return [];
        }


        return data.questions;
      }


      /*
        =====================================================
        候補を採用する関数
        =====================================================
      */

      function acceptCandidates({
        candidates,
        source,
        maximum
      }) {

        let accepted =
          0;


        for (
          const rawQuestion
          of candidates
        ) {

          if (
            accepted >=
            maximum
          ) {
            break;
          }


          const result =
            validateVocabularyCandidate({
              rawQuestion,
              mode,
              expectedSource:
                source,
              recentSet,
              eligibleWeakSet,
              cooldownSet,
              alreadySelectedSet
            });


          if (
            !result.ok
          ) {

            /*
              エラー画面には出さず
              Render logだけに残す
            */

            console.log(
              `Vocabulary candidate rejected (${source}):`,
              result.reason
            );

            continue;
          }


          const question =
            result.question;


          const key =
            normalizeWord(
              question.word
            );


          alreadySelectedSet.add(
            key
          );


          selectedQuestions.push(
            question
          );


          accepted++;
        }


        return accepted;
      }


      /*
        =====================================================
        まず復習問題を作る
        =====================================================
      */

      let remainingReview =
        desiredReviewCount;


      /*
        最大3回。

        1問不正でも
        他候補は保持する。
      */

      for (
        let round = 1;
        round <= 3 &&
        remainingReview > 0;
        round++
      ) {

        try {

          const candidates =
            await requestVocabularyCandidates({
              source:
                "review",
              needed:
                remainingReview
            });


          const accepted =
            acceptCandidates({
              candidates,
              source:
                "review",
              maximum:
                remainingReview
            });


          remainingReview -=
            accepted;

        } catch (error) {

          console.warn(
            `Vocabulary review candidate round ${round} failed:`,
            error.message
          );
        }
      }


      /*
        復習問題が全部作れなくても
        エラーにしない。

        不足分を新規問題へ回す。
      */

      const actualReviewCount =
        desiredReviewCount -
        remainingReview;


      /*
        =====================================================
        残りはすべて新規問題で埋める
        =====================================================
      */

      let remainingNew =
        count -
        selectedQuestions.length;


      /*
        最大5ラウンド。

        今回の方式では
        「likely 1語が重複しただけ」
        ならlikelyだけ捨てて、
        他の候補を採用する。
      */

      for (
        let round = 1;
        round <= 5 &&
        remainingNew > 0;
        round++
      ) {

        try {

          const candidates =
            await requestVocabularyCandidates({
              source:
                "new",
              needed:
                remainingNew
            });


          const accepted =
            acceptCandidates({
              candidates,
              source:
                "new",
              maximum:
                remainingNew
            });


          remainingNew -=
            accepted;

        } catch (error) {

          console.warn(
            `Vocabulary new candidate round ${round} failed:`,
            error.message
          );
        }
      }


      /*
        =====================================================
        最終チェック
        =====================================================
      */

      if (
        selectedQuestions.length <
        count
      ) {

        console.error(
          "Vocabulary generation incomplete:",
          {
            requested:
              count,
            generated:
              selectedQuestions.length,
            review:
              actualReviewCount
          }
        );


        throw new Error(
          `問題を十分に生成できませんでした。${selectedQuestions.length}/${count}問まで作成できました。もう一度お試しください。`
        );
      }


      /*
        念のため必要数だけ
      */

      const finalQuestions =
        selectedQuestions.slice(
          0,
          count
        );


      /*
        問題順を軽くシャッフル。

        復習問題が毎回最初に来るのを
        防ぐ。
      */

      for (
        let i =
          finalQuestions.length - 1;
        i > 0;
        i--
      ) {

        const j =
          Math.floor(
            Math.random() *
            (i + 1)
          );


        [
          finalQuestions[i],
          finalQuestions[j]
        ] =
        [
          finalQuestions[j],
          finalQuestions[i]
        ];
      }


      res.json({
        questions:
          finalQuestions
      });

    } catch (error) {

      console.error(
        "Vocabulary error:",
        error
      );


      res
        .status(500)
        .json({
          error:
            error.message ||
            "単語問題の作成に失敗しました。"
        });
    }
  }
);


/* =========================================================
   READING
========================================================= */

app.post(
  "/api/reading",
  requireKey,
  async (
    req,
    res
  ) => {

    try {

      const level =
        String(
          req.body.level ||
          "B1"
        );


      const topic =
        String(
          req.body.topic ||
          "Daily conversation"
        );


      const length =
        String(
          req.body.length ||
          "medium"
        );


      const count =
        Math.max(
          3,
          Math.min(
            5,
            Number(
              req.body.count
            ) || 4
          )
        );


      const wordRule =
        length === "short"
          ? "90-130"
          : length === "medium"
          ? "160-230"
          : "280-380";


      const prompt = `
Create ONE English reading comprehension exercise for a Japanese learner.

CEFR:
${level}

Topic:
${topic}

Passage length:
about ${wordRule} words.

Return ONLY valid JSON:

{
  "passage":
    "English passage",

  "translation":
    "natural Japanese translation",

  "questions": [
    {
      "question":
        "English question",

      "options": [
        "option A",
        "option B",
        "option C",
        "option D"
      ],

      "answer_index":
        0,

      "explanation_ja":
        "Japanese explanation"
    }
  ],

  "key_vocabulary": [
    {
      "word":
        "English word or phrase",

      "meaning_ja":
        "Japanese meaning"
    }
  ]
}

Rules:

- exactly ${count} comprehension questions
- exactly 4 English options for every question
- mix main idea, detail,
  vocabulary in context and inference
- every answer must be supported by the passage
- questions should fit CEFR ${level}
- key_vocabulary must contain 4 to 8 useful words or phrases
- natural CEFR ${level} English
- no markdown
- no text outside JSON
`;


      const data =
        await generateJson(
          prompt
        );


      validateQuestions(
        data.questions,
        count
      );


      res.json(
        data
      );

    } catch (error) {

      console.error(
        "Reading error:",
        error
      );


      res
        .status(500)
        .json({
          error:
            error.message ||
            "リーディング問題の作成に失敗しました。"
        });
    }
  }
);


/* =========================================================
   SPEECH
========================================================= */

app.post(
  "/api/speech",
  requireKey,
  async (
    req,
    res
  ) => {

    try {

      const text =
        String(
          req.body.text || ""
        ).trim();


      if (!text) {
        return res
          .status(400)
          .json({
            error:
              "読み上げる英文がありません。"
          });
      }


      const response =
        await fetch(
          "https://api.openai.com/v1/audio/speech",
          {
            method: "POST",

            headers: {
              Authorization:
                `Bearer ${OPENAI_API_KEY}`,

              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                model:
                  "gpt-4o-mini-tts",

                voice:
                  "alloy",

                input:
                  text,

                response_format:
                  "mp3"
              })
          }
        );


      if (!response.ok) {
        return res
          .status(
            response.status
          )
          .json({
            error:
              (
                await response.text()
              ) ||
              "音声生成に失敗しました。"
          });
      }


      res.set(
        "Content-Type",
        "audio/mpeg"
      );


      res.send(
        Buffer.from(
          await response.arrayBuffer()
        )
      );

    } catch (error) {

      console.error(
        "Speech error:",
        error
      );


      res
        .status(500)
        .json({
          error:
            error.message ||
            "音声生成に失敗しました。"
        });
    }
  }
);


/* =========================================================
   DICTATION EXPLANATION
========================================================= */

app.post(
  "/api/explain",
  requireKey,
  async (
    req,
    res
  ) => {

    try {

      const sentence =
        String(
          req.body.sentence || ""
        );


      const answer =
        String(
          req.body.answer || ""
        );


      const prompt = `
You are an English listening coach for a Japanese learner.

Correct English:

${sentence}

Learner's dictation:

${answer}

Return ONLY valid JSON:

{
  "feedback":
    "Japanese feedback in 3-5 concise sentences",

  "focus": [
    "short Japanese focus point 1",
    "short Japanese focus point 2"
  ]
}

Explain:

- what was correct
- what was missed
- likely listening causes such as
  linking, weak forms, reductions and rhythm
- one useful practice tip
- no markdown
- no text outside JSON
`;


      const data =
        await generateJson(
          prompt
        );


      res.json(
        data
      );

    } catch (error) {

      console.error(
        "Explain error:",
        error
      );


      res
        .status(500)
        .json({
          error:
            error.message ||
            "解説生成に失敗しました。"
        });
    }
  }
);


/* =========================================================
   Start
========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `English Trainer running on port ${PORT}`
    );
  }
);

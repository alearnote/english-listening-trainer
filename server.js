const express = require("express");
const path = require("path");

require("dotenv").config();

const app = express();

const PORT =
  process.env.PORT || 3000;

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY;


/* ================================
   Express
================================ */

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


/* ================================
   OpenAI helpers
================================ */

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


async function generateJson(
  prompt
) {
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


/* ================================
   Common validation
================================ */

function clampAnswerIndex(q) {
  q.answer_index =
    Math.max(
      0,
      Math.min(
        3,
        Number(
          q.answer_index
        ) || 0
      )
    );

  return q;
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
      "問題の生成形式が不正でした。もう一度お試しください。"
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


      clampAnswerIndex(
        question
      );
    }
  );
}


/* ================================
   Language helpers
================================ */

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


function looksEnglishOption(
  text
) {
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


function looksJapaneseOption(
  text
) {
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


/* ================================
   Vocabulary validation
================================ */

function validateVocabularyMode(
  question,
  mode
) {
  const prompt =
    String(
      question.prompt || ""
    ).trim();


  const options =
    Array.isArray(
      question.options
    )
      ? question.options.map(
          option =>
            String(
              option
            ).trim()
        )
      : [];


  if (
    options.length !== 4
  ) {
    throw new Error(
      "Vocabularyの選択肢は4つ必要です。"
    );
  }


  /*
    blank
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
        "blank問題の英文には _____ が1か所必要です。"
      );
    }


    if (
      !hasLatin(prompt) ||
      hasJapanese(prompt)
    ) {
      throw new Error(
        "blank問題の本文は英語である必要があります。"
      );
    }


    if (
      !options.every(
        looksEnglishOption
      )
    ) {
      throw new Error(
        "blank問題の選択肢はすべて英語である必要があります。"
      );
    }
  }


  /*
    en-ja
  */

  if (
    mode === "en-ja"
  ) {
    if (
      !hasLatin(prompt) ||
      hasJapanese(prompt)
    ) {
      throw new Error(
        "en-ja問題のpromptは英語である必要があります。"
      );
    }


    if (
      !options.every(
        looksJapaneseOption
      )
    ) {
      throw new Error(
        "en-ja問題の選択肢はすべて日本語である必要があります。"
      );
    }
  }


  /*
    ja-en
  */

  if (
    mode === "ja-en"
  ) {
    if (
      !hasJapanese(prompt)
    ) {
      throw new Error(
        "ja-en問題のpromptは日本語である必要があります。"
      );
    }


    if (
      !options.every(
        looksEnglishOption
      )
    ) {
      throw new Error(
        "ja-en問題の選択肢はすべて英語である必要があります。"
      );
    }
  }
}


/* ================================
   Listening random categories
================================ */

/*
  Randomで使用する
  シナリオカテゴリ。

  交通だけに偏らないよう、
  日常・仕事・旅行・サービスなど
  幅広く分散させる。
*/

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


/*
  サーバー内で最近選んだRandomカテゴリ。

  Renderが再起動するとリセットされるが、
  1セッション中の偏り防止には有効。
*/

let recentRandomCategories =
  [];


/*
  Randomカテゴリを選択。

  直近5カテゴリをなるべく
  避ける。
*/

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


  /*
    念のため候補がなくなった場合
  */

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


/* ================================
   LISTENING
================================ */

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


      /*
        app.jsから送られてくる
        直近20問
      */

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


      /*
        特に類似を避ける
        直近5問
      */

      const veryRecentListening =
        recentListening.slice(
          -5
        );


      /*
        Randomならサーバー側で
        カテゴリを選ぶ
      */

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


      /*
        長さ
      */

      const lengthRule =
        length === "short"
          ? "8-14 words"
          : length === "medium"
          ? "15-28 words"
          : "29-50 words";


      /*
        履歴をAIへ渡す
      */

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


      /*
        Random時の追加ルール
      */

      const randomRule =
        selectedCategory
          ? `
This request uses RANDOM mode.

For this exercise, use this scenario category:

${selectedCategory.label}

You MUST stay within that broad category,
but create a fresh and specific situation.

Do not automatically create a transportation-delay story.

In particular, avoid overusing scenarios such as:

- missing a bus
- missing a train
- being late for transportation
- asking when the next bus arrives
- losing a ticket
- changing a transportation reservation

unless the selected category specifically requires transportation
AND the recent history does not contain a similar scenario.

Random means variety of SITUATIONS,
not merely different wording.
`
          : `
The learner explicitly selected this topic:

${requestedTopic}

Stay within this topic,
but still create a situation that is meaningfully different
from the recent listening exercises.
`;


      /*
        MCQ
      */

      const prompt =
        mode === "mcq"
          ? `
Create ONE English listening comprehension exercise for a Japanese learner.

CEFR:
${level}

Requested topic:
${requestedTopic}

Actual scenario:
${actualTopic}

Passage length:
${lengthRule}


================================
VARIETY RULES
================================

${randomRule}


The learner has already received these recent listening exercises:

${recentText}


The FIVE most recent exercises are:

${veryRecentText}


STRICT VARIETY REQUIREMENTS:

1. Do NOT repeat the same event or basic story as any of the five most recent exercises.

2. Do NOT merely change nouns while keeping the same scenario.

For example, these count as the SAME basic scenario:

- missing a bus
- missing a train
- arriving too late for a subway
- being late and missing public transportation

Likewise:

- changing a hotel reservation
- changing a restaurant reservation

may still be too similar if the main listening task is simply rescheduling.

3. Compare the underlying situation, not just vocabulary.

4. Avoid repeating the same combination of:
   - location
   - problem
   - goal
   - outcome

5. Prefer a different communicative purpose from recent exercises.

Possible purposes include:

- asking for information
- making a request
- explaining a problem
- giving instructions
- confirming information
- making a suggestion
- apologizing
- changing a plan
- comparing choices
- arranging something
- reporting what happened
- asking for clarification

6. The exercise must still sound natural.

7. Do not create an unusual or unrealistic story merely to be different.

8. If any proposed scenario feels substantially similar to one of the five most recent exercises, silently choose another scenario before producing the final JSON.


================================
OUTPUT
================================

Return ONLY valid JSON:

{
  "sentence":
    "natural spoken English",

  "translation":
    "natural Japanese translation",

  "listening_tip":
    "short Japanese listening tip",

  "scenario":
    "very short English description of the scenario",

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


STRICT OUTPUT RULES:

- exactly 3 questions
- exactly 4 English options per question
- exactly one correct answer per question
- every question must be answerable from the audio
- use natural CEFR ${level} English
- vary correct-answer positions
- avoid obscure proper nouns
- no markdown
- no text outside JSON
`

          : `

Create ONE English listening dictation exercise for a Japanese learner.

CEFR:
${level}

Requested topic:
${requestedTopic}

Actual scenario:
${actualTopic}

Length:
${lengthRule}


================================
VARIETY RULES
================================

${randomRule}


The learner has already received these recent listening exercises:

${recentText}


The FIVE most recent exercises are:

${veryRecentText}


STRICT VARIETY REQUIREMENTS:

1. Do NOT repeat the same event or basic story as any of the five most recent exercises.

2. Compare the underlying situation, not just individual words.

For example:

"missed the bus"

"missed the train"

"arrived too late for the subway"

are all essentially the same scenario.

3. Do NOT simply rewrite a previous situation with different nouns.

4. Avoid repeating the same combination of:
   - location
   - problem
   - goal
   - outcome

5. Prefer a different communicative purpose from recent exercises.

6. Keep the English natural and useful.

7. Do not create unrealistic situations merely for novelty.

8. If the first scenario you think of is similar to recent history,
silently choose a different one.


================================
OUTPUT
================================

Return ONLY valid JSON:

{
  "sentence":
    "natural English sentence or connected sentences",

  "translation":
    "natural Japanese translation",

  "listening_tip":
    "short Japanese explanation of likely listening difficulty",

  "scenario":
    "very short English description of the scenario"
}


STRICT OUTPUT RULES:

- natural useful CEFR ${level} English
- respect the requested length
- avoid obscure proper nouns
- no markdown
- no text outside JSON
`;


      /*
        最大2回まで生成
      */

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


/* ================================
   VOCABULARY
================================ */

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


      /*
        問題数
      */

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
        直近200語
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


      /*
        苦手単語
      */

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
        苦手語のクールダウン。

        直近30語に出ている苦手語は
        復習対象から外す。
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


      /*
        クールダウンしていない
        苦手語だけを復習候補にする
      */

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


      /*
        約20%を復習
      */

      const desiredReviewCount =
        Math.round(
          count * 0.2
        );


      const reviewCount =
        Math.min(
          desiredReviewCount,
          eligibleWeakWords.length
        );


      const newCount =
        count -
        reviewCount;


      const recentSet =
        new Set(
          recentWords.map(
            normalizeWord
          )
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


      const recentText =
        recentWords.length
          ? recentWords.join(
              ", "
            )
          : "(none)";


      const cooldownText =
        recentCooldownWords.length
          ? recentCooldownWords.join(
              ", "
            )
          : "(none)";


      const weakText =
        eligibleWeakWords.length
          ? eligibleWeakWords
              .map(
                item =>
                  `${item.word}${
                    item.meaning_ja
                      ? ` (${item.meaning_ja})`
                      : ""
                  } [mistakes: ${item.count}]`
              )
              .join(", ")
          : "(none)";


      /*
        Vocabulary形式を固定
      */

      const modeRule =
        mode === "blank"
          ? `

MODE = blank

Every question MUST use exactly this format:

- prompt:
  one natural English sentence containing exactly one literal blank written as _____

- options:
  four ENGLISH words or short ENGLISH phrases only

- word:
  the correct English word or phrase that fills the blank

- meaning_ja:
  Japanese meaning of the target word

- context:
  empty string


VALID EXAMPLE:

{
  "prompt":
    "Could you _____ the window? It's a little cold in here.",

  "context":
    "",

  "options": [
    "close",
    "borrow",
    "repair",
    "choose"
  ],

  "answer_index":
    0,

  "word":
    "close",

  "meaning_ja":
    "閉める",

  "explanation_ja":
    "窓を閉めてもらう依頼なので close が自然です。",

  "source":
    "new"
}


IMPORTANT:

- Japanese options are NEVER allowed in blank mode.
- The prompt must contain exactly one _____.
- Do not ask the learner to choose a Japanese meaning.
- Do not mix another vocabulary question type into this set.
`

          : mode === "ja-en"
          ? `

MODE = ja-en

Every question MUST use exactly this format:

- prompt:
  Japanese meaning only

- options:
  four ENGLISH words or short ENGLISH phrases only

- word:
  correct English target word

- meaning_ja:
  Japanese meaning corresponding to the prompt

- context:
  optional short Japanese clarification or empty string


IMPORTANT:

- Japanese options are NEVER allowed.
- English sentence-completion prompts are NEVER allowed.
- Do not mix another vocabulary question type into this set.
`

          : `

MODE = en-ja

Every question MUST use exactly this format:

- prompt:
  one ENGLISH word or short ENGLISH phrase only

- options:
  four JAPANESE meanings only

- word:
  same English target word as prompt

- meaning_ja:
  correct Japanese meaning

- context:
  optional short English example sentence or empty string


IMPORTANT:

- English options are NEVER allowed.
- Sentence-completion prompts are NEVER allowed.
- Do not mix another vocabulary question type into this set.
`;


      /*
        最大3回
      */

      let finalQuestions =
        null;


      let lastError =
        null;


      for (
        let attempt = 1;
        attempt <= 3;
        attempt++
      ) {

        try {

          const prompt = `

Create exactly ${count} English vocabulary multiple-choice questions for a Japanese learner.

CEFR level:
${level}

Topic:
${topic}


================================
IMPORTANT
================================

The entire set MUST use ONE fixed question format only.

Do NOT mix question types.

${modeRule}


================================
COMPOSITION
================================

NEW questions:
${newCount}

REVIEW questions:
${reviewCount}

TOTAL:
${count}


================================
NEW QUESTION RULES
================================

For NEW questions:

- choose useful vocabulary appropriate for CEFR ${level}
- prefer practical and high-frequency vocabulary
- do NOT use target words from Recent Words
- do NOT use simple inflections of recent words to bypass the restriction
- do NOT treat plural/singular as different target words
- avoid trivial derivatives of recent words


================================
REVIEW QUESTION RULES
================================

For REVIEW questions:

- use ONLY words from Eligible Weak Words
- prioritize higher mistake counts where reasonable
- do NOT repeat a review word within the set
- do NOT use words from Review Cooldown Words


================================
RECENT WORDS
================================

${recentText}


================================
REVIEW COOLDOWN WORDS
================================

${cooldownText}


================================
ELIGIBLE WEAK WORDS
================================

${weakText}


================================
OUTPUT
================================

Return ONLY valid JSON.

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
        "short Japanese explanation",

      "source":
        "new"
    }
  ]
}


STRICT RULES:

- exactly ${count} questions
- exactly ${newCount} source "new"
- exactly ${reviewCount} source "review"
- exactly 4 options per question
- exactly one correct answer
- answer_index must be 0, 1, 2, or 3
- target words must be unique
- all questions must obey MODE = ${mode}
- never mix en-ja, ja-en and blank
- NEW words must not appear in Recent Words
- REVIEW words must come from Eligible Weak Words
- REVIEW words must not appear in Review Cooldown Words
- vary correct-answer positions
- distractors must be plausible
- explanations must be concise
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


          const seenWords =
            new Set();


          let actualNew =
            0;


          let actualReview =
            0;


          const cleaned =
            [];


          for (
            const rawQuestion
            of data.questions
          ) {

            validateVocabularyMode(
              rawQuestion,
              mode
            );


            const word =
              String(
                rawQuestion.word ||
                ""
              ).trim();


            if (!word) {
              throw new Error(
                "単語が空のVocabulary問題が生成されました。"
              );
            }


            const key =
              normalizeWord(
                word
              );


            if (!key) {
              throw new Error(
                "Vocabularyのtarget wordを判定できませんでした。"
              );
            }


            /*
              セット内重複禁止
            */

            if (
              seenWords.has(key)
            ) {
              throw new Error(
                `同じ単語が重複しました: ${word}`
              );
            }


            seenWords.add(
              key
            );


            /*
              source
            */

            let source =
              String(
                rawQuestion.source ||
                ""
              )
                .trim()
                .toLowerCase();


            if (
              source !== "new" &&
              source !== "review"
            ) {

              source =
                eligibleWeakSet.has(
                  key
                )
                  ? "review"
                  : "new";
            }


            /*
              review
            */

            if (
              source === "review"
            ) {

              if (
                !eligibleWeakSet.has(
                  key
                )
              ) {
                throw new Error(
                  `復習対象外の単語が出題されました: ${word}`
                );
              }


              if (
                cooldownSet.has(
                  key
                )
              ) {
                throw new Error(
                  `クールダウン中の苦手単語が再出題されました: ${word}`
                );
              }


              actualReview++;

            } else {

              /*
                new
              */

              if (
                recentSet.has(
                  key
                )
              ) {
                throw new Error(
                  `最近出題した単語が新規問題に再登場しました: ${word}`
                );
              }


              actualNew++;
            }


            /*
              blankチェック
            */

            if (
              mode === "blank"
            ) {

              const correctOption =
                String(
                  rawQuestion.options[
                    Number(
                      rawQuestion.answer_index
                    )
                  ] || ""
                ).trim();


              if (
                normalizeWord(
                  correctOption
                ) !== key
              ) {
                throw new Error(
                  `blank問題の正解選択肢とwordが一致しません: ${word}`
                );
              }
            }


            /*
              en-jaチェック
            */

            if (
              mode === "en-ja"
            ) {

              if (
                normalizeWord(
                  rawQuestion.prompt
                ) !== key
              ) {
                throw new Error(
                  `en-ja問題のpromptとwordが一致しません: ${word}`
                );
              }
            }


            const answerIndex =
              Number(
                rawQuestion.answer_index
              );


            if (
              ![
                0,
                1,
                2,
                3
              ].includes(
                answerIndex
              )
            ) {
              throw new Error(
                "answer_index が不正です。"
              );
            }


            cleaned.push({
              prompt:
                String(
                  rawQuestion.prompt ||
                  ""
                ),

              context:
                String(
                  rawQuestion.context ||
                  ""
                ),

              options:
                rawQuestion.options.map(
                  option =>
                    String(option)
                ),

              answer_index:
                answerIndex,

              word,

              meaning_ja:
                String(
                  rawQuestion.meaning_ja ||
                  ""
                ),

              explanation_ja:
                String(
                  rawQuestion.explanation_ja ||
                  ""
                ),

              source
            });
          }


          if (
            actualNew !==
            newCount
          ) {
            throw new Error(
              `新規問題数が不正です: ${actualNew}/${newCount}`
            );
          }


          if (
            actualReview !==
            reviewCount
          ) {
            throw new Error(
              `復習問題数が不正です: ${actualReview}/${reviewCount}`
            );
          }


          finalQuestions =
            cleaned;


          break;

        } catch (
          generationError
        ) {

          lastError =
            generationError;


          console.warn(
            `Vocabulary generation attempt ${attempt} failed:`,
            generationError.message
          );
        }
      }


      if (
        !finalQuestions
      ) {
        throw (
          lastError ||
          new Error(
            "Vocabulary generation failed."
          )
        );
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


/* ================================
   READING
================================ */

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
- use a mix of main idea, detail, vocabulary in context and inference
- every answer must be supported by the passage
- questions should fit CEFR ${level}
- key_vocabulary must contain 4 to 8 useful words or phrases
- use natural CEFR ${level} English
- no markdown
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


/* ================================
   SPEECH
================================ */

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
          req.body.text ||
          ""
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


/* ================================
   DICTATION EXPLANATION
================================ */

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
          req.body.sentence ||
          ""
        );


      const answer =
        String(
          req.body.answer ||
          ""
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
- likely listening causes such as linking, weak forms, reductions and rhythm
- one useful practice tip
- no markdown
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


/* ================================
   Start
================================ */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `English Trainer running on port ${PORT}`
    );
  }
);

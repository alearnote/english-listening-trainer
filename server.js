const express = require("express");
const path = require("path");

require("dotenv").config();

const app = express();

const PORT =
  process.env.PORT ||
  3000;

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
    data.output ||
    []
  )
    .flatMap(
      item =>
        item.content ||
        []
    )
    .filter(
      item =>
        item.type ===
        "output_text"
    )
    .map(
      item =>
        item.text ||
        ""
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
  const r =
    await fetch(
      "https://api.openai.com/v1/responses",
      {
        method:
          "POST",

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
              effort:
                "none"
            }
          })
      }
    );

  const data =
    await r.json();

  if (!r.ok) {
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

function clampAnswerIndex(
  q
) {
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
  qs,
  expected
) {
  if (
    !Array.isArray(qs) ||
    qs.length !== expected
  ) {
    throw new Error(
      "問題の生成形式が不正でした。もう一度お試しください。"
    );
  }

  qs.forEach(
    q => {

      if (
        !Array.isArray(
          q.options
        ) ||
        q.options.length !== 4
      ) {
        throw new Error(
          "選択肢の生成形式が不正でした。"
        );
      }

      clampAnswerIndex(
        q
      );
    }
  );
}


/* ================================
   Language helpers
================================ */

function hasJapanese(
  text
) {
  return /[\u3040-\u30ff\u3400-\u9fff]/u
    .test(
      String(
        text ||
        ""
      )
    );
}


function hasLatin(
  text
) {
  return /[A-Za-z]/
    .test(
      String(
        text ||
        ""
      )
    );
}


function looksEnglishOption(
  text
) {
  const s =
    String(
      text ||
      ""
    ).trim();

  return (
    s.length > 0 &&
    hasLatin(s) &&
    !hasJapanese(s)
  );
}


function looksJapaneseOption(
  text
) {
  const s =
    String(
      text ||
      ""
    ).trim();

  return (
    s.length > 0 &&
    hasJapanese(s)
  );
}


function normalizeWord(
  text
) {
  return String(
    text ||
    ""
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
   Vocabulary mode validation
================================ */

function validateVocabularyMode(
  q,
  mode
) {
  const prompt =
    String(
      q.prompt ||
      ""
    ).trim();

  const options =
    Array.isArray(
      q.options
    )
      ? q.options.map(
          x =>
            String(x)
              .trim()
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
    英文穴埋め＋英語4択
  */
  if (
    mode === "blank"
  ) {
    const blankCount =
      (
        prompt.match(
          /_____/g
        ) ||
        []
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
    英単語＋日本語4択
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
    日本語＋英語4択
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

      const topic =
        String(
          req.body.topic ||
          "Daily conversation"
        );

      const length =
        String(
          req.body.length ||
          "short"
        );


      const lengthRule =
        length === "short"
          ? "8-14 words"
          : length ===
            "medium"
          ? "15-28 words"
          : "29-50 words";


      const prompt =
        mode === "mcq"
          ? `
Create ONE English listening comprehension exercise for a Japanese learner.

CEFR:
${level}

Topic:
${topic}

Passage length:
${lengthRule}

Return ONLY valid JSON:

{
  "sentence":
    "natural spoken English",

  "translation":
    "Japanese translation",

  "listening_tip":
    "short Japanese listening tip",

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
- exactly one correct answer per question
- all questions must be answerable from the audio
- use natural CEFR ${level} English
- vary the correct-answer positions
- avoid obscure proper nouns
- no markdown
`
          : `
Create ONE English listening dictation exercise for a Japanese learner.

CEFR:
${level}

Topic:
${topic}

Length:
${lengthRule}

Return ONLY valid JSON:

{
  "sentence":
    "natural English sentence or connected sentences",

  "translation":
    "natural Japanese translation",

  "listening_tip":
    "short Japanese explanation of likely listening difficulty"
}

Rules:

- natural useful CEFR ${level} English
- avoid obscure proper nouns
- no markdown
`;


      const data =
        await generateJson(
          prompt
        );


      if (
        mode === "mcq"
      ) {
        validateQuestions(
          data.questions,
          3
        );
      }


      res.json(
        data
      );

    } catch (e) {

      console.error(
        "Listening error:",
        e
      );

      res
        .status(500)
        .json({
          error:
            e.message ||
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
        ].includes(
          mode
        )
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
        直近最大200語
      */
      const recentWords =
        Array.isArray(
          req.body.recentWords
        )
          ? req.body.recentWords
              .map(
                w =>
                  String(
                    w ||
                    ""
                  ).trim()
              )
              .filter(
                Boolean
              )
              .slice(
                -200
              )
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
                w => ({
                  word:
                    String(
                      w?.word ||
                      ""
                    ).trim(),

                  meaning_ja:
                    String(
                      w?.meaning_ja ||
                      ""
                    ).trim(),

                  count:
                    Number(
                      w?.count ||
                      1
                    )
                })
              )
              .filter(
                w =>
                  w.word
              )
              .slice(
                0,
                40
              )
          : [];


      /*
        ============================
        苦手単語のクールダウン
        ============================

        直近30語に含まれている
        苦手単語は復習対象から除外
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
        クールダウン中でない
        苦手単語のみ復習候補
      */
      const eligibleWeakWords =
        weakWords.filter(
          w =>
            !cooldownSet.has(
              normalizeWord(
                w.word
              )
            )
        );


      /*
        苦手回数が多い順
      */
      eligibleWeakWords.sort(
        (a, b) =>
          b.count -
          a.count
      );


      /*
        20%を復習枠に
      */
      const desiredReviewCount =
        Math.round(
          count *
          0.2
        );


      /*
        候補が少なければ
        復習数を減らす
      */
      const reviewCount =
        Math.min(
          desiredReviewCount,
          eligibleWeakWords.length
        );


      /*
        足りない復習分は
        新規問題にする
      */
      const newCount =
        count -
        reviewCount;


      /*
        新規問題では
        直近200語を除外
      */
      const recentSet =
        new Set(
          recentWords.map(
            normalizeWord
          )
        );


      /*
        復習対象として
        実際に使用可能な苦手語
      */
      const eligibleWeakSet =
        new Set(
          eligibleWeakWords.map(
            w =>
              normalizeWord(
                w.word
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
                w =>
                  `${w.word}${
                    w.meaning_ja
                      ? ` (${w.meaning_ja})`
                      : ""
                  } [mistakes: ${w.count}]`
              )
              .join(
                ", "
              )
          : "(none)";


      /*
        出題形式を固定
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
        最大3回まで再生成
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
- these are words the learner previously answered incorrectly
- prioritize higher mistake counts where reasonable
- do NOT repeat a review word within the set
- do NOT use words from Review Cooldown Words
- review cooldown is strict


================================
RECENT WORDS
DO NOT USE AS NEW QUESTIONS
================================

${recentText}


================================
REVIEW COOLDOWN WORDS
DO NOT USE EVEN FOR REVIEW
================================

${cooldownText}


================================
ELIGIBLE WEAK WORDS
AVAILABLE FOR REVIEW
================================

${weakText}


================================
OUTPUT FORMAT
================================

Return ONLY valid JSON.

Use exactly this structure:

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


================================
STRICT RULES
================================

- exactly ${count} questions
- exactly ${newCount} questions with source "new"
- exactly ${reviewCount} questions with source "review"
- exactly 4 options for every question
- exactly one correct answer
- answer_index must be 0, 1, 2, or 3
- target words must be unique within the set
- all questions must obey MODE = ${mode}
- never mix en-ja, ja-en, and blank
- NEW target words must not appear in Recent Words
- REVIEW target words must come only from Eligible Weak Words
- REVIEW target words must not appear in Review Cooldown Words
- vary correct-answer positions
- distractors must be plausible but clearly wrong
- concise Japanese explanations
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
            const rawQ
            of data.questions
          ) {

            /*
              出題形式を
              サーバー側でも検証
            */
            validateVocabularyMode(
              rawQ,
              mode
            );


            const word =
              String(
                rawQ.word ||
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
              同一セット内重複禁止
            */
            if (
              seenWords.has(
                key
              )
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
                rawQ.source ||
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
              復習問題
            */
            if (
              source === "review"
            ) {

              /*
                Eligible Weak Words
                にあるか
              */
              if (
                !eligibleWeakSet.has(
                  key
                )
              ) {
                throw new Error(
                  `復習対象外の単語が出題されました: ${word}`
                );
              }


              /*
                念のためサーバー側でも
                クールダウン再確認
              */
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
                新規問題
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
              blankモードでは
              正解選択肢とwordが一致するか
            */
            if (
              mode === "blank"
            ) {

              const correctOption =
                String(
                  rawQ.options[
                    Number(
                      rawQ.answer_index
                    )
                  ] ||
                  ""
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
              en-jaでは
              promptとwordが一致
            */
            if (
              mode === "en-ja"
            ) {

              if (
                normalizeWord(
                  rawQ.prompt
                ) !== key
              ) {
                throw new Error(
                  `en-ja問題のpromptとwordが一致しません: ${word}`
                );
              }
            }


            const answerIndex =
              Number(
                rawQ.answer_index
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
                  rawQ.prompt ||
                  ""
                ),

              context:
                String(
                  rawQ.context ||
                  ""
                ),

              options:
                rawQ.options.map(
                  x =>
                    String(x)
                ),

              answer_index:
                answerIndex,

              word,

              meaning_ja:
                String(
                  rawQ.meaning_ja ||
                  ""
                ),

              explanation_ja:
                String(
                  rawQ.explanation_ja ||
                  ""
                ),

              source
            });
          }


          /*
            新規・復習数チェック
          */
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


      /*
        3回とも失敗
      */
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

    } catch (e) {

      console.error(
        "Vocabulary error:",
        e
      );


      res
        .status(500)
        .json({
          error:
            e.message ||
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
          : length ===
            "medium"
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
- use a mix of main idea, detail, vocabulary in context, and inference
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

    } catch (e) {

      console.error(
        "Reading error:",
        e
      );


      res
        .status(500)
        .json({
          error:
            e.message ||
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


      const r =
        await fetch(
          "https://api.openai.com/v1/audio/speech",
          {
            method:
              "POST",

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


      if (!r.ok) {
        return res
          .status(
            r.status
          )
          .json({
            error:
              (
                await r.text()
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
          await r.arrayBuffer()
        )
      );

    } catch (e) {

      console.error(
        "Speech error:",
        e
      );


      res
        .status(500)
        .json({
          error:
            e.message ||
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
- likely listening causes such as linking, weak forms, reductions, and rhythm
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

    } catch (e) {

      console.error(
        "Explain error:",
        e
      );


      res
        .status(500)
        .json({
          error:
            e.message ||
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

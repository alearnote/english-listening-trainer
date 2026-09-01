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
      x =>
        x.content ||
        []
    )
    .filter(
      x =>
        x.type ===
        "output_text"
    )
    .map(
      x =>
        x.text ||
        ""
    )
    .join("\n");
}


function parseJson(text) {
  return JSON.parse(
    String(text)
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
   Validation helpers
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

      clampAnswerIndex(q);
    }
  );
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

      res.json(data);

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


      /*
        問題数
        最小5問〜最大15問
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
        app.jsから送られた
        直近出題単語
      */
      const recentWords =
        Array.isArray(
          req.body.recentWords
        )
          ? req.body.recentWords
              .map(
                w =>
                  String(
                    w || ""
                  ).trim()
              )
              .filter(Boolean)
              .slice(-200)
          : [];


      /*
        app.jsから送られた
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
        約20%を復習枠にする

        5問 → 1問
        10問 → 2問
        15問 → 3問
      */
      const desiredReviewCount =
        Math.round(
          count * 0.2
        );


      /*
        苦手単語が足りなければ
        その分は新規単語へ
      */
      const reviewCount =
        Math.min(
          desiredReviewCount,
          weakWords.length
        );


      const newCount =
        count -
        reviewCount;


      /*
        大文字小文字を無視して
        サーバー側でも履歴を整理
      */
      const recentSet =
        new Set(
          recentWords.map(
            w =>
              w.toLowerCase()
          )
        );


      const weakSet =
        new Set(
          weakWords.map(
            w =>
              w.word
                .toLowerCase()
          )
        );


      /*
        出題形式
      */
      const modeRule =
        mode === "ja-en"
          ? `
The prompt is the Japanese meaning.

All four options must be English words or phrases.

The correct English target word must be one of the four options.
`
          : mode ===
            "blank"
          ? `
The prompt is one natural English sentence.

Replace the target word with exactly:
_____

All four options must be English words or phrases.

The context field should normally be an empty string.
`
          : `
The prompt is the English target word or phrase.

All four options must be Japanese meanings.

Exactly one Japanese option must correctly match the target English word.
`;


      /*
        過去200語
      */
      const recentText =
        recentWords.length
          ? recentWords.join(
              ", "
            )
          : "(none)";


      /*
        苦手単語一覧
      */
      const weakText =
        weakWords.length
          ? weakWords
              .map(
                w =>
                  `${w.word}${
                    w.meaning_ja
                      ? ` (${w.meaning_ja})`
                      : ""
                  }`
              )
              .join(", ")
          : "(none)";


      /*
        最大2回生成を試みる
        AIが重複ルールに違反した場合に再生成
      */
      let finalQuestions =
        null;

      let lastError =
        null;


      for (
        let attempt = 1;
        attempt <= 2;
        attempt++
      ) {
        try {

          const prompt = `
Create exactly ${count} English vocabulary multiple-choice questions for a Japanese learner.

CEFR level:
${level}

Topic:
${topic}

Question mode:
${mode}

================================
QUESTION COMPOSITION
================================

Create exactly:

NEW questions:
${newCount}

REVIEW questions:
${reviewCount}

Total:
${count}

If REVIEW count is 0, all questions must be NEW.

================================
NEW QUESTION RULE
================================

For NEW questions:

- Choose useful vocabulary appropriate for CEFR ${level}.
- Prefer practical, high-frequency vocabulary.
- Do NOT use any target word from the Recent Words list below.
- Do NOT use a trivial inflection of a recent word merely to avoid the restriction.
- Avoid repeating essentially the same lexical item.

For example:

develop / developed / developing

should not be treated as completely different vocabulary items just to bypass the exclusion rule.

================================
REVIEW QUESTION RULE
================================

For REVIEW questions:

- Target words MUST be selected from the Weak Words list below.
- These words are intentionally allowed even if they also appear in Recent Words.
- Prefer words with higher mistake counts when useful.
- Do not use the same weak word twice in one set.

================================
RECENT WORDS TO AVOID
================================

${recentText}

================================
WEAK WORDS AVAILABLE FOR REVIEW
================================

${weakText}

================================
MODE RULE
================================

${modeRule}

================================
OUTPUT FORMAT
================================

Return ONLY valid JSON.

Use this exact structure:

{
  "questions": [
    {
      "prompt":
        "question prompt",

      "context":
        "optional short supporting context or empty string",

      "options": [
        "option A",
        "option B",
        "option C",
        "option D"
      ],

      "answer_index":
        0,

      "word":
        "target English word or phrase",

      "meaning_ja":
        "natural Japanese meaning",

      "explanation_ja":
        "concise Japanese explanation",

      "source":
        "new"
    }
  ]
}

For REVIEW questions:

"source":
"review"

For NEW questions:

"source":
"new"

================================
STRICT RULES
================================

- Return exactly ${count} questions.
- Return exactly ${newCount} questions with source "new".
- Return exactly ${reviewCount} questions with source "review".
- Each question must have exactly 4 options.
- answer_index must be 0, 1, 2, or 3.
- There must be exactly one correct option.
- Do not repeat the same target word within this set.
- Do not repeat obvious singular/plural or simple inflection variants as separate target words.
- NEW target words must NOT appear in Recent Words.
- REVIEW target words must come from Weak Words.
- Distractors should be plausible but clearly incorrect.
- Vary the position of the correct option.
- Keep Japanese explanations concise and useful.
- Do not include markdown.
- Do not include text outside the JSON.
`;


          const data =
            await generateJson(
              prompt
            );


          /*
            基本形式チェック
          */
          validateQuestions(
            data.questions,
            count
          );


          const seen =
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

            const word =
              String(
                rawQ.word ||
                ""
              ).trim();


            if (!word) {
              throw new Error(
                "単語が空の問題が生成されました。"
              );
            }


            const key =
              word.toLowerCase();


            /*
              同一セット内の
              完全一致重複を禁止
            */
            if (
              seen.has(key)
            ) {
              throw new Error(
                `同じ単語が重複しました: ${word}`
              );
            }


            seen.add(key);


            /*
              source判定
            */
            let source =
              String(
                rawQ.source ||
                ""
              )
                .trim()
                .toLowerCase();


            /*
              AIがsourceを書かなかった場合も
              苦手単語ならreviewとして判定
            */
            if (
              source !== "new" &&
              source !== "review"
            ) {
              source =
                weakSet.has(
                  key
                )
                  ? "review"
                  : "new";
            }


            /*
              REVIEW問題は
              苦手単語からのみ
            */
            if (
              source ===
              "review"
            ) {
              if (
                !weakSet.has(
                  key
                )
              ) {
                throw new Error(
                  `復習問題に苦手単語以外が含まれました: ${word}`
                );
              }

              actualReview++;

            } else {

              /*
                NEW問題では
                直近200語を禁止
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
                Number(
                  rawQ.answer_index
                ),

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
            80/20構成が守られているか
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
        2回とも失敗
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
- use a mix of:
  - main idea
  - detail
  - vocabulary in context
  - inference
- every answer must be supported by the passage
- questions should fit CEFR ${level}
- key_vocabulary must contain 4 to 8 useful words or phrases from the passage
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


      res.json(data);

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
              await r.text() ||
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
- likely listening causes such as:
  - linking
  - weak forms
  - reductions
  - rhythm
- one useful practice tip

No markdown.
`;


      const data =
        await generateJson(
          prompt
        );


      res.json(data);

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
   Start server
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

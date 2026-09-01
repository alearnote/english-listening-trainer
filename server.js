const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function requireKey(req, res, next) {
  if (!OPENAI_API_KEY) {
    return res.status(500).json({
      error: "OPENAI_API_KEY が設定されていません。.env ファイルを確認してください。"
    });
  }
  next();
}

function extractOutputText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  const chunks = [];
  for (const item of data.output || []) {
    for (const c of item.content || []) {
      if (c.type === "output_text" && typeof c.text === "string") chunks.push(c.text);
    }
  }
  return chunks.join("\n");
}

function safeJsonParse(text) {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

app.post("/api/exercise", requireKey, async (req, res) => {
  try {
    const level = String(req.body.level || "B1");
    const topic = String(req.body.topic || "Daily conversation");
    const length = String(req.body.length || "short");

    const prompt = `
Create ONE English listening dictation exercise for a Japanese learner.

CEFR level: ${level}
Topic: ${topic}
Length: ${length}

Return ONLY valid JSON in this exact shape:
{
  "sentence": "natural English sentence or 2 short connected sentences",
  "translation": "natural Japanese translation",
  "listening_tip": "short Japanese explanation of a likely listening difficulty such as weak forms, linking, reductions, or stress",
  "key_phrases": ["phrase 1", "phrase 2"]
}

Rules:
- Do not include markdown.
- Keep the English natural, useful, and appropriate for CEFR ${level}.
- Avoid obscure proper nouns.
- For short: about 8-14 English words.
- For medium: about 15-25 English words.
- For long: about 26-40 English words.
`.trim();

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        input: prompt,
        reasoning: { effort: "none" }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || "OpenAI API error" });
    }

    const text = extractOutputText(data);
    const exercise = safeJsonParse(text);
    res.json(exercise);
  } catch (err) {
    res.status(500).json({ error: err.message || "問題の作成に失敗しました。" });
  }
});

app.post("/api/speech", requireKey, async (req, res) => {
  try {
    const text = String(req.body.text || "").trim();
    const speed = Number(req.body.speed || 1);

    if (!text) return res.status(400).json({ error: "読み上げる英文がありません。" });

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        input: text,
        speed: Math.max(0.25, Math.min(4, speed)),
        response_format: "mp3"
      })
    });

    if (!response.ok) {
      const textErr = await response.text();
      return res.status(response.status).json({ error: textErr || "音声生成に失敗しました。" });
    }

    const arrayBuffer = await response.arrayBuffer();
    res.set("Content-Type", "audio/mpeg");
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    res.status(500).json({ error: err.message || "音声生成に失敗しました。" });
  }
});

app.post("/api/explain", requireKey, async (req, res) => {
  try {
    const sentence = String(req.body.sentence || "");
    const answer = String(req.body.answer || "");

    const prompt = `
You are an English listening coach for a Japanese learner.

Correct English:
${sentence}

Learner's dictation:
${answer}

In concise Japanese, explain:
1. What was heard correctly.
2. What was missed or mistaken.
3. Why the missed parts can be difficult to hear (linking, weak forms, reductions, consonants, rhythm, etc.).
4. One concrete listening practice tip.

Return ONLY valid JSON:
{
  "feedback": "Japanese feedback in 3-5 concise sentences",
  "focus": ["short focus point 1", "short focus point 2"]
}
Do not use markdown.
`.trim();

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        input: prompt,
        reasoning: { effort: "none" }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || "OpenAI API error" });
    }

    const result = safeJsonParse(extractOutputText(data));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "解説生成に失敗しました。" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("English Listening Trainer");
  console.log(`http://localhost:${PORT}`);
  console.log("");
});

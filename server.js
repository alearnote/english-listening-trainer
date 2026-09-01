const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function requireKey(req, res, next) {
  if (!OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY が設定されていません。" });
  next();
}
function outputText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  return (data.output || []).flatMap(x => x.content || []).filter(x => x.type === "output_text").map(x => x.text || "").join("\n");
}
function parseJson(text) {
  return JSON.parse(String(text).replace(/^```json\s*/i,"").replace(/^```\s*/i,"").replace(/\s*```$/i,"").trim());
}
async function generateJson(prompt) {
  const r = await fetch("https://api.openai.com/v1/responses", {
    method:"POST",
    headers:{Authorization:`Bearer ${OPENAI_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({model:"gpt-5.6-luna",input:prompt,reasoning:{effort:"none"}})
  });
  const data = await r.json();
  if(!r.ok) throw new Error(data.error?.message || "OpenAI API error");
  return parseJson(outputText(data));
}
function clampAnswerIndex(q) {
  q.answer_index = Math.max(0, Math.min(3, Number(q.answer_index) || 0));
  return q;
}
function validateQuestions(qs, expected) {
  if(!Array.isArray(qs) || qs.length !== expected) throw new Error("問題の生成形式が不正でした。もう一度お試しください。");
  qs.forEach(q=>{ if(!Array.isArray(q.options)||q.options.length!==4) throw new Error("選択肢の生成形式が不正でした。"); clampAnswerIndex(q); });
}

app.post("/api/listening", requireKey, async (req,res)=>{
  try{
    const mode=String(req.body.mode||"dictation"), level=String(req.body.level||"B1"), topic=String(req.body.topic||"Daily conversation"), length=String(req.body.length||"short");
    const lengthRule=length==="short"?"8-14 words":length==="medium"?"15-28 words":"29-50 words";
    const prompt=mode==="mcq"?`
Create ONE English listening comprehension exercise for a Japanese learner.
CEFR: ${level}. Topic: ${topic}. Passage length: ${lengthRule}.
Return ONLY valid JSON:
{"sentence":"natural spoken English","translation":"Japanese translation","listening_tip":"short Japanese listening tip","questions":[
{"question":"English question","options":["A","B","C","D"],"answer_index":0,"explanation_ja":"Japanese explanation"},
{"question":"English question","options":["A","B","C","D"],"answer_index":1,"explanation_ja":"Japanese explanation"},
{"question":"English question","options":["A","B","C","D"],"answer_index":2,"explanation_ja":"Japanese explanation"}]}
Rules: exactly 3 questions, exactly 4 English options each, one correct option, answerable from audio alone, natural CEFR ${level} English, vary correct-answer positions, no markdown.`:
`Create ONE English listening dictation exercise for a Japanese learner.
CEFR: ${level}. Topic: ${topic}. Length: ${lengthRule}.
Return ONLY valid JSON:
{"sentence":"natural English sentence or connected sentences","translation":"natural Japanese translation","listening_tip":"short Japanese explanation of likely listening difficulty"}
No markdown. Natural useful CEFR ${level} English. Avoid obscure proper nouns.`;
    const data=await generateJson(prompt);
    if(mode==="mcq")validateQuestions(data.questions,3);
    res.json(data);
  }catch(e){res.status(500).json({error:e.message||"問題作成に失敗しました。"})}
});

app.post("/api/vocabulary", requireKey, async (req,res)=>{
  try{
    const level=String(req.body.level||"B1"), topic=String(req.body.topic||"Daily conversation"), mode=String(req.body.mode||"en-ja");
    const count=Math.max(5,Math.min(15,Number(req.body.count)||10));
    const modeRule=mode==="ja-en"
      ?"prompt is Japanese meaning; four options are English words/phrases"
      :mode==="blank"
      ?"prompt is an English sentence with ONE blank shown as _____; four options are English words/phrases; context should be empty"
      :"prompt is an English word/phrase; four options are Japanese meanings";
    const prompt=`
Create ${count} English vocabulary multiple-choice questions for a Japanese learner.
CEFR: ${level}. Topic: ${topic}. Mode: ${mode}.
Mode rule: ${modeRule}
Return ONLY valid JSON:
{"questions":[{"prompt":"question prompt","context":"optional short supporting English context or empty string","options":["option A","option B","option C","option D"],"answer_index":0,"word":"target English word or phrase","meaning_ja":"Japanese meaning","explanation_ja":"concise Japanese usage explanation"}]}
Rules:
- exactly ${count} questions, exactly 4 options each, one correct answer.
- vocabulary must fit CEFR ${level}; prefer useful high-frequency items.
- distractors must be plausible but clearly wrong.
- do not repeat the same target word.
- vary correct-answer positions.
- no markdown.`;
    const data=await generateJson(prompt);validateQuestions(data.questions,count);res.json(data);
  }catch(e){res.status(500).json({error:e.message||"単語問題の作成に失敗しました。"})}
});

app.post("/api/reading", requireKey, async (req,res)=>{
  try{
    const level=String(req.body.level||"B1"), topic=String(req.body.topic||"Daily conversation"), length=String(req.body.length||"medium");
    const count=Math.max(3,Math.min(5,Number(req.body.count)||4));
    const wordRule=length==="short"?"90-130":length==="medium"?"160-230":"280-380";
    const prompt=`
Create ONE English reading comprehension exercise for a Japanese learner.
CEFR: ${level}. Topic: ${topic}. Passage length: about ${wordRule} words.
Return ONLY valid JSON:
{"passage":"English passage","translation":"natural Japanese translation","questions":[{"question":"English question","options":["A","B","C","D"],"answer_index":0,"explanation_ja":"Japanese explanation"}],"key_vocabulary":[{"word":"English word/phrase","meaning_ja":"Japanese meaning"}]}
Rules:
- exactly ${count} comprehension questions and exactly 4 English options for each.
- include a mix of main idea, detail, vocabulary-in-context, and inference appropriate to ${level}.
- every answer must be supported by the passage.
- key_vocabulary: 4 to 8 useful items from the passage.
- natural CEFR ${level} English, no markdown.`;
    const data=await generateJson(prompt);validateQuestions(data.questions,count);res.json(data);
  }catch(e){res.status(500).json({error:e.message||"リーディング問題の作成に失敗しました。"})}
});

app.post("/api/speech", requireKey, async (req,res)=>{
  try{
    const text=String(req.body.text||"").trim();if(!text)return res.status(400).json({error:"読み上げる英文がありません。"});
    const r=await fetch("https://api.openai.com/v1/audio/speech",{method:"POST",headers:{Authorization:`Bearer ${OPENAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-4o-mini-tts",voice:"alloy",input:text,response_format:"mp3"})});
    if(!r.ok)return res.status(r.status).json({error:await r.text()||"音声生成に失敗しました。"});
    res.set("Content-Type","audio/mpeg");res.send(Buffer.from(await r.arrayBuffer()));
  }catch(e){res.status(500).json({error:e.message||"音声生成に失敗しました。"})}
});

app.post("/api/explain", requireKey, async (req,res)=>{
  try{
    const sentence=String(req.body.sentence||""), answer=String(req.body.answer||"");
    const prompt=`You are an English listening coach for a Japanese learner.
Correct English: ${sentence}
Learner's dictation: ${answer}
Return ONLY valid JSON: {"feedback":"Japanese feedback in 3-5 concise sentences","focus":["short Japanese focus point 1","short Japanese focus point 2"]}
Explain what was correct, what was missed, likely listening causes such as linking/weak forms/reductions/rhythm, and one practice tip. No markdown.`;
    res.json(await generateJson(prompt));
  }catch(e){res.status(500).json({error:e.message||"解説生成に失敗しました。"})}
});

app.listen(PORT,"0.0.0.0",()=>console.log(`English Trainer running on port ${PORT}`));

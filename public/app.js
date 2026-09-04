const $ = id => document.getElementById(id);

let listening = null;
let listeningAudioUrl = null;
let listeningSpeed = 1;
let listeningMcqRevealed = false;
let vocabSet = [];
let vocabIndex = 0;
let vocabCorrect = 0;
let vocabMistakes = [];
let vocabAnswered = false;
let reading = null;
let writingSet = [];
let writingIndex = 0;
let writingCorrect = 0;
let writingMistakes = [];
let writingAnswered = false;

const STORAGE_KEY = "englishTrainerV2Progress";
const VOCAB_HISTORY_KEY = "englishTrainerV2VocabHistory";
const VOCAB_HISTORY_LIMIT = 1000;
const LISTENING_HISTORY_KEY = "englishTrainerV2ListeningHistory";
const LISTENING_HISTORY_LIMIT = 20;
const VOCAB_MASTERY_KEY = "englishTrainerV3VocabMastery";

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function postJson(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  let data = {};
  try { data = await r.json(); } catch {}
  if (!r.ok) throw new Error(data.error || "通信エラー");
  return data;
}

function commonSettings() {
  return { level: $("level").value, topic: $("topic").value };
}

function loadListeningHistory() {
  try {
    const data = JSON.parse(localStorage.getItem(LISTENING_HISTORY_KEY) || "[]");
    return Array.isArray(data) ? data.filter(Boolean).slice(-LISTENING_HISTORY_LIMIT) : [];
  } catch { return []; }
}

function rememberListening(sentence) {
  const text = String(sentence || "").trim();
  if (!text) return;
  const current = loadListeningHistory();
  const map = new Map();
  [...current, text].forEach(x => {
    const s = String(x || "").trim();
    if (s) map.set(s.toLowerCase().replace(/\s+/g, " "), s);
  });
  localStorage.setItem(LISTENING_HISTORY_KEY, JSON.stringify(Array.from(map.values()).slice(-LISTENING_HISTORY_LIMIT)));
}

function loadVocabHistory() {
  try {
    const data = JSON.parse(localStorage.getItem(VOCAB_HISTORY_KEY) || "[]");
    return Array.isArray(data) ? data.filter(Boolean).slice(-VOCAB_HISTORY_LIMIT) : [];
  } catch { return []; }
}

function rememberVocabWords(words) {
  const map = new Map();
  [...loadVocabHistory(), ...words].forEach(raw => {
    const word = String(raw || "").trim();
    if (word) map.set(word.toLowerCase(), word);
  });
  localStorage.setItem(VOCAB_HISTORY_KEY, JSON.stringify(Array.from(map.values()).slice(-VOCAB_HISTORY_LIMIT)));
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function blankProgress() {
  return { date: todayKey(), listening: 0, vocabulary: 0, writing: 0, reading: 0, correct: 0, total: 0, weakWords: {} };
}

function loadProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!p || p.date !== todayKey()) return blankProgress();
    return { ...blankProgress(), ...p, weakWords: p.weakWords || {} };
  } catch { return blankProgress(); }
}

let progress = loadProgress();
if (typeof progress.writing !== "number") progress.writing = 0;

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  renderProgress();
}

function addProgress(kind, correct=0, total=0) {
  progress[kind] = (progress[kind] || 0) + 1;
  progress.correct += correct;
  progress.total += total;
  saveProgress();
}

function addWeakWord(word, meaning="") {
  if (!word) return;
  const key = word.toLowerCase();
  const old = progress.weakWords[key] || { word, meaning, count: 0 };
  old.count += 1;
  if (meaning) old.meaning = meaning;
  progress.weakWords[key] = old;
  recordVocabWrong(word, meaning);
  saveProgress();
}


function loadVocabMastery() {
  try {
    const data = JSON.parse(localStorage.getItem(VOCAB_MASTERY_KEY) || "{}");
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function saveVocabMastery(data) {
  localStorage.setItem(VOCAB_MASTERY_KEY, JSON.stringify(data || {}));
}

function vocabMasteryKey(word) {
  return String(word || "").trim().toLowerCase();
}

function recordVocabWrong(word, meaning = "") {
  const key = vocabMasteryKey(word);
  if (!key) return;

  const data = loadVocabMastery();
  const old = data[key] || {
    word: String(word || "").trim(),
    meaning: String(meaning || ""),
    wrongCount: 0,
    correctStreak: 0,
    mastered: false
  };

  old.word = String(word || old.word || "").trim();
  if (meaning) old.meaning = String(meaning);
  old.wrongCount = (old.wrongCount || 0) + 1;
  old.correctStreak = 0;
  old.mastered = false;

  data[key] = old;
  saveVocabMastery(data);
}

function recordVocabCorrect(word, meaning = "") {
  const key = vocabMasteryKey(word);
  if (!key) return false;

  const data = loadVocabMastery();
  const old = data[key];

  // 「苦手問題」として登録済みの単語だけ連続正解を数える。
  if (!old || old.mastered || !(old.wrongCount > 0)) {
    return false;
  }

  if (meaning) old.meaning = String(meaning);
  old.correctStreak = (old.correctStreak || 0) + 1;

  if (old.correctStreak >= 3) {
    old.correctStreak = 3;
    old.mastered = true;

    // Progress画面の苦手単語表示からも外す。
    if (progress.weakWords && progress.weakWords[key]) {
      delete progress.weakWords[key];
    }
  }

  data[key] = old;
  saveVocabMastery(data);
  saveProgress();

  return Boolean(old.mastered);
}

function getWeakWordsForReview(limit = 40) {
  return Object.values(loadVocabMastery())
    .filter(w => w && !w.mastered && (w.wrongCount || 0) > 0)
    .sort((a, b) => (b.wrongCount || 0) - (a.wrongCount || 0))
    .slice(0, limit)
    .map(w => ({
      word: w.word,
      meaning_ja: w.meaning || "",
      count: w.wrongCount || 1,
      correctStreak: w.correctStreak || 0
    }));
}

function getMasteredWords(limit = 500) {
  return Object.values(loadVocabMastery())
    .filter(w => w && w.mastered)
    .slice(-limit)
    .map(w => w.word)
    .filter(Boolean);
}

function renderProgress() {
  $("statListening").textContent = progress.listening;
  $("statVocabulary").textContent = progress.vocabulary;
  $("statWriting").textContent = progress.writing || 0;
  $("statReading").textContent = progress.reading;
  $("todayTotal").textContent = progress.listening + progress.vocabulary + (progress.writing || 0) + progress.reading;
  $("statAccuracy").textContent = progress.total ? `${Math.round(progress.correct/progress.total*100)}%` : "—";
  const words = Object.values(progress.weakWords).sort((a,b)=>b.count-a.count).slice(0,30);
  $("weakWords").innerHTML = words.length
    ? words.map(w=>`<span class="weak-word">${escapeHtml(w.word)}${w.meaning?` — ${escapeHtml(w.meaning)}`:""} ×${w.count}</span>`).join("")
    : `<span class="muted">まだ記録はありません。</span>`;
}

document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
    document.querySelectorAll(".tab-page").forEach(x=>x.classList.add("hidden"));
    btn.classList.add("active");
    $(`tab-${btn.dataset.tab}`).classList.remove("hidden");
    if (btn.dataset.tab === "progress") renderProgress();
  });
});

/* Listening */
function clearListeningAudio() {
  if (listeningAudioUrl) URL.revokeObjectURL(listeningAudioUrl);
  listeningAudioUrl = null;
  $("audio").removeAttribute("src");
  $("audio").load();
}

function resetListeningMode() {
  listening = null;
  listeningMcqRevealed = false;
  clearListeningAudio();
  $("listeningResult").classList.add("hidden");
  $("dictationAnswer").value = "";
  $("dictationAnswer").disabled = true;
  $("dictationCheckBtn").disabled = true;
  $("translationAnswer").value = "";
  $("translationAnswer").disabled = true;
  $("translationCheckBtn").disabled = true;
  $("translationYourAnswer").classList.add("hidden");
  $("dictationYourAnswer").classList.add("hidden");
  $("playBtn").disabled = true;
  $("listeningMcqPanel").classList.add("hidden");
  $("listeningQuestions").innerHTML = "";
  $("listeningMcqCheckBtn").disabled = true;
  $("dictationPanel").classList.toggle("hidden", $("listeningMode").value !== "dictation");
  $("translationPanel").classList.toggle("hidden", $("listeningMode").value !== "translation");
  $("listeningStatus").textContent = "「新しい問題」を押してください";
}

$("listeningMode").addEventListener("change", resetListeningMode);
$("newListeningBtn").addEventListener("click", async () => {
  const btn = $("newListeningBtn");
  try {
    btn.disabled = true;
    resetListeningMode();
    $("listeningStatus").classList.remove("error");
    $("listeningStatus").textContent = "AIが問題を作成しています…";
    listening = await postJson("/api/listening", {
      ...commonSettings(),
      mode: $("listeningMode").value,
      length: $("listeningLength").value,
      recentListening: loadListeningHistory()
    });
    if (!listening?.sentence) throw new Error("Listening問題を生成できませんでした。");
    rememberListening(listening.sentence);
    if ($("listeningMode").value === "dictation") {
      $("dictationPanel").classList.remove("hidden");
      $("dictationAnswer").disabled = false;
      $("dictationCheckBtn").disabled = false;
      $("listeningStatus").textContent = "準備できました。音声を再生してください。";
    } else if ($("listeningMode").value === "translation") {
      $("translationPanel").classList.remove("hidden");
      $("translationAnswer").disabled = false;
      $("translationCheckBtn").disabled = false;
      $("listeningStatus").textContent = "準備できました。音声を聞いて、日本語訳を入力してください。";
    } else {
      $("listeningStatus").textContent = "準備できました。まず音声を最後まで聞いてください。";
    }
    $("playBtn").disabled = false;
  } catch(e) {
    $("listeningStatus").textContent = e.message;
    $("listeningStatus").classList.add("error");
  } finally { btn.disabled = false; }
});

async function playListening() {
  if (!listening) return;
  const play = $("playBtn"), audio = $("audio");
  try {
    play.disabled = true;
    $("listeningStatus").classList.remove("error");
    if (!listeningAudioUrl) {
      $("listeningStatus").textContent = "音声を準備しています…";
      const r = await fetch("/api/speech", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({text:listening.sentence}) });
      if (!r.ok) { let msg="音声生成に失敗しました。"; try{msg=(await r.json()).error||msg}catch{}; throw new Error(msg); }
      listeningAudioUrl = URL.createObjectURL(await r.blob());
      audio.src = listeningAudioUrl;
    }
    audio.playbackRate = listeningSpeed;
    audio.currentTime = 0;
    audio.onended = () => {
      if ($("listeningMode").value === "mcq") {
        if (!listeningMcqRevealed) {
          renderListeningQuestions();
          $("listeningMcqPanel").classList.remove("hidden");
          listeningMcqRevealed = true;
          $("listeningMcqPanel").scrollIntoView({behavior:"smooth",block:"start"});
        }
        $("listeningStatus").textContent = "内容について3問に答えてください。";
      } else if ($("listeningMode").value === "translation") {
        $("listeningStatus").textContent = "聞こえた内容を日本語に訳して入力してください。";
        $("translationAnswer").focus();
      } else $("listeningStatus").textContent = "聞こえた英文を入力してください。";
    };
    await audio.play();
    $("listeningStatus").textContent = "再生中…";
  } catch(e) {
    $("listeningStatus").textContent = e.message;
    $("listeningStatus").classList.add("error");
  } finally { play.disabled = false; }
}

$("playBtn").addEventListener("click", playListening);

document.querySelectorAll(".speed").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".speed").forEach(x=>x.classList.remove("active"));btn.classList.add("active");listeningSpeed=Number(btn.dataset.speed);}));

function questionHtml(q,i,prefix){return `<div class="question-card"><div class="question-title">Q${i+1}. ${escapeHtml(q.question)}</div><div class="option-list">${q.options.map((o,j)=>`<label class="option"><input type="radio" name="${prefix}${i}" value="${j}"><span><strong>${String.fromCharCode(65+j)}.</strong> ${escapeHtml(o)}</span></label>`).join("")}</div></div>`;}

function renderListeningQuestions(){
  $("listeningQuestions").innerHTML=(listening.questions||[]).map((q,i)=>questionHtml(q,i,"lq")).join("");
  document.querySelectorAll('input[name^="lq"]').forEach(input=>input.addEventListener("change",()=>{$("listeningMcqCheckBtn").disabled=!(listening.questions||[]).every((_,i)=>document.querySelector(`input[name="lq${i}"]:checked`));}));
}

function normalize(s){return String(s).toLowerCase().replace(/[’']/g,"'").replace(/[^\p{L}\p{N}' ]/gu," ").replace(/\s+/g," ").trim();}
function wordLevenshtein(a,b){const A=normalize(a).split(" "),B=normalize(b).split(" "),dp=Array.from({length:A.length+1},()=>Array(B.length+1).fill(0));for(let i=0;i<=A.length;i++)dp[i][0]=i;for(let j=0;j<=B.length;j++)dp[0][j]=j;for(let i=1;i<=A.length;i++)for(let j=1;j<=B.length;j++){const c=A[i-1]===B[j-1]?0:1;dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+c);}return{dist:dp[A.length][B.length],max:Math.max(A.length,B.length,1)}}
function dictationScore(correct,user){const x=wordLevenshtein(correct,user);return Math.max(0,Math.round((1-x.dist/x.max)*100));}

function showListeningBase(){
  $("listeningTranscript").textContent=listening.sentence;
  $("listeningTranslation").textContent=listening.translation;
  $("listeningTip").textContent=listening.listening_tip||"";
  $("listeningResult").classList.remove("hidden");
  $("listeningResult").scrollIntoView({behavior:"smooth",block:"start"});
}

$("dictationCheckBtn").addEventListener("click",async()=>{
  if(!listening||!$("dictationAnswer").value.trim())return;
  const user=$("dictationAnswer").value.trim(),score=dictationScore(listening.sentence,user);
  $("listeningScore").textContent=`${score}%`;$("listeningScoreLabel").textContent="Dictation score";$("listeningScoreMsg").textContent=score>=95?"Excellent!":score>=80?"かなり聞き取れています。":score>=60?"あと少しです。":"正解を確認して聞き直しましょう。";
  $("dictationYourAnswer").classList.remove("hidden");$("dictationYourAnswerText").textContent=user;$("listeningReview").classList.add("hidden");$("listeningCoach").classList.remove("hidden");showListeningBase();
  $("listeningFeedback").textContent="AIが解説を生成しています…";$("listeningFocus").innerHTML="";addProgress("listening",score>=80?1:0,1);$("dictationCheckBtn").disabled=true;
  try{const x=await postJson("/api/explain",{sentence:listening.sentence,answer:user});$("listeningFeedback").textContent=x.feedback;$("listeningFocus").innerHTML=(x.focus||[]).map(i=>`<li>${escapeHtml(i)}</li>`).join("");}catch{$("listeningFeedback").textContent="AI解説の取得に失敗しました。";}
});

$("translationCheckBtn").addEventListener("click", async () => {
  if (!listening || !$("translationAnswer").value.trim()) return;
  const user = $("translationAnswer").value.trim();
  $("translationCheckBtn").disabled = true;
  $("translationAnswer").disabled = true;
  $("listeningScore").textContent = "…";
  $("listeningScoreLabel").textContent = "Translation";
  $("listeningScoreMsg").textContent = "AIが意味を判定しています…";
  $("dictationYourAnswer").classList.add("hidden");
  $("translationYourAnswer").classList.remove("hidden");
  $("translationYourAnswerText").textContent = user;
  $("listeningReview").classList.add("hidden");
  $("listeningCoach").classList.remove("hidden");
  showListeningBase();
  $("listeningFeedback").textContent = "AIが解説を生成しています…";
  $("listeningFocus").innerHTML = "";
  try {
    const x = await postJson("/api/listening-translation-check", {
      sentence: listening.sentence,
      referenceTranslation: listening.translation,
      answer: user
    });
    const good = !!x.correct;
    $("listeningScore").textContent = good ? "✓" : "△";
    $("listeningScoreLabel").textContent = good ? "Meaning understood" : "Needs review";
    $("listeningScoreMsg").textContent = x.summary || (good ? "内容を正しく捉えています。" : "意味の取り違えがあります。");
    $("listeningFeedback").textContent = x.feedback || "";
    $("listeningFocus").innerHTML = (x.focus || []).map(i=>`<li>${escapeHtml(i)}</li>`).join("");
    addProgress("listening", good ? 1 : 0, 1);
  } catch(e) {
    $("listeningScore").textContent = "—";
    $("listeningScoreLabel").textContent = "Translation";
    $("listeningScoreMsg").textContent = "判定に失敗しました。";
    $("listeningFeedback").textContent = e.message || "AI判定の取得に失敗しました。";
    $("translationCheckBtn").disabled = false;
    $("translationAnswer").disabled = false;
  }
});

$("listeningMcqCheckBtn").addEventListener("click",()=>{
  let correctCount=0;
  const html=(listening.questions||[]).map((q,i)=>{const s=document.querySelector(`input[name="lq${i}"]:checked`);if(!s)return"";const si=Number(s.value),ai=Number(q.answer_index);if(si===ai)correctCount++;return `<div class="review-card ${si===ai?"review-correct":"review-wrong"}"><div class="question-title">Q${i+1}. ${escapeHtml(q.question)}</div><p><strong>Your answer:</strong> ${String.fromCharCode(65+si)}. ${escapeHtml(q.options[si])}</p><p><strong>Correct:</strong> ${String.fromCharCode(65+ai)}. ${escapeHtml(q.options[ai])}</p><p>${escapeHtml(q.explanation_ja||"")}</p></div>`;}).join("");
  const total=(listening.questions||[]).length;$("listeningScore").textContent=`${correctCount}/${total}`;$("listeningScoreLabel").textContent="Comprehension score";$("listeningScoreMsg").textContent=correctCount===total?"Excellent!":correctCount>=Math.ceil(total*.67)?"Good! もう一度聞くとさらに定着します。":"スクリプトを確認して聞き直しましょう。";$("dictationYourAnswer").classList.add("hidden");$("translationYourAnswer").classList.add("hidden");$("listeningReview").innerHTML=html;$("listeningReview").classList.remove("hidden");$("listeningCoach").classList.add("hidden");showListeningBase();addProgress("listening",correctCount,total);$("listeningMcqCheckBtn").disabled=true;$("listeningQuestions").querySelectorAll("input").forEach(x=>x.disabled=true);
});
$("nextListeningBtn").addEventListener("click",()=>$("newListeningBtn").click());

/* Vocabulary */
$("vocabCount").addEventListener("change",()=>{$("newVocabBtn").textContent=`＋ ${$("vocabCount").value}問作る`;});
$("newVocabBtn").addEventListener("click",generateVocab);$("vocabAgainBtn").addEventListener("click",generateVocab);

async function generateVocab(){
  const btn=$("newVocabBtn");
  try{
    btn.disabled=true;$("vocabStart").classList.remove("hidden");$("vocabStart").innerHTML=`<div class="empty-icon">⏳</div><h2>問題を作成しています…</h2>`;$("vocabQuiz").classList.add("hidden");$("vocabSummary").classList.add("hidden");
    const data=await postJson("/api/vocabulary",{...commonSettings(),mode:$("vocabMode").value,count:Number($("vocabCount").value),recentWords:loadVocabHistory(),weakWords:getWeakWordsForReview(),masteredWords:getMasteredWords()});
    vocabSet=data.questions||[];if(!vocabSet.length)throw new Error("問題を生成できませんでした。");rememberVocabWords(vocabSet.map(q=>q.word));vocabIndex=0;vocabCorrect=0;vocabMistakes=[];vocabAnswered=false;$("vocabStart").classList.add("hidden");$("vocabQuiz").classList.remove("hidden");renderVocabQuestion();$("vocabQuiz").scrollIntoView({behavior:"smooth",block:"start"});
  }catch(e){$("vocabStart").classList.remove("hidden");$("vocabStart").innerHTML=`<div class="empty-icon">⚠️</div><h2>エラー</h2><p class="error">${escapeHtml(e.message)}</p>`;}finally{btn.disabled=false;}
}

function renderVocabQuestion(){
  const q=vocabSet[vocabIndex],total=vocabSet.length,answerMode=$("vocabAnswerMode").value;vocabAnswered=false;$("vocabProgress").textContent=`${vocabIndex+1} / ${total}`;$("vocabRunningScore").textContent=`Score ${vocabCorrect}`;$("vocabBar").style.width=`${vocabIndex/total*100}%`;$("vocabPrompt").textContent=q.prompt;$("vocabContext").textContent="";$("vocabContext").classList.add("hidden");$("vocabFeedback").classList.add("hidden");$("vocabNextBtn").classList.add("hidden");$("vocabInputAnswer").value="";$("vocabInputAnswer").disabled=false;$("vocabInputSubmitBtn").disabled=false;$("vocabGiveUpBtn").disabled=false;
  if(answerMode==="choice"){
    $("vocabOptions").classList.remove("hidden");$("vocabInputArea").classList.add("hidden");$("vocabOptions").innerHTML=q.options.map((o,i)=>`<button class="option vocab-choice" data-index="${i}"><span><strong>${String.fromCharCode(65+i)}.</strong> ${escapeHtml(o)}</span></button>`).join("");document.querySelectorAll(".vocab-choice").forEach(b=>b.addEventListener("click",()=>answerVocabChoice(Number(b.dataset.index))));
  }else{
    $("vocabOptions").classList.add("hidden");$("vocabOptions").innerHTML="";$("vocabInputArea").classList.remove("hidden");setTimeout(()=>$("vocabInputAnswer").focus(),50);
  }
}

function finishVocabAnswer({good,q,feedbackText="",acceptedAnswer=""}){
  let masteredNow=false;
  if(good){
    vocabCorrect++;
    masteredNow=recordVocabCorrect(q.word,q.meaning_ja);
  }else{
    vocabMistakes.push(q);
    addWeakWord(q.word,q.meaning_ja);
  }

  const box=$("vocabFeedback");
  box.className=`feedback-box ${good?"good":"bad"}`;
  box.innerHTML=`<strong>${good?"✓ Correct!":"✕ Incorrect"}</strong><p><b>${escapeHtml(q.word||"")}</b>${q.meaning_ja?` — ${escapeHtml(q.meaning_ja)}`:""}</p>${q.context?`<div class="vocab-example"><strong>例文</strong><p>${escapeHtml(q.context)}</p></div>`:""}${feedbackText?`<p>${escapeHtml(feedbackText)}</p>`:""}${acceptedAnswer?`<p><strong>模範回答:</strong> ${escapeHtml(acceptedAnswer)}</p>`:""}${masteredNow?`<p><strong>✓ 苦手卒業:</strong> 3回連続で正解したため、今後この単語は出題しません。</p>`:""}`;
  box.classList.remove("hidden");
  $("vocabNextBtn").classList.remove("hidden");
  setTimeout(()=>$("vocabNextBtn").scrollIntoView({behavior:"smooth",block:"end"}),100);
}

function answerVocabChoice(selected){
  if(vocabAnswered)return;vocabAnswered=true;const q=vocabSet[vocabIndex],correct=Number(q.answer_index),good=selected===correct;document.querySelectorAll(".vocab-choice").forEach((b,i)=>{b.disabled=true;if(i===correct)b.classList.add("correct-choice");if(i===selected&&!good)b.classList.add("wrong-choice");});finishVocabAnswer({good,q,feedbackText:q.explanation_ja||""});
}

async function answerVocabInput(){
  if(vocabAnswered)return;const q=vocabSet[vocabIndex],userAnswer=$("vocabInputAnswer").value.trim();if(!userAnswer)return;const btn=$("vocabInputSubmitBtn");
  try{btn.disabled=true;$("vocabGiveUpBtn").disabled=true;$("vocabInputAnswer").disabled=true;const result=await postJson("/api/vocabulary-check",{mode:$("vocabMode").value,prompt:q.prompt,context:q.context||"",word:q.word,meaning_ja:q.meaning_ja,userAnswer});vocabAnswered=true;finishVocabAnswer({good:Boolean(result.correct),q,feedbackText:result.feedback_ja||q.explanation_ja||"",acceptedAnswer:result.accepted_answer||""});}
  catch(e){btn.disabled=false;$("vocabGiveUpBtn").disabled=false;$("vocabInputAnswer").disabled=false;const box=$("vocabFeedback");box.className="feedback-box bad";box.innerHTML=`<strong>判定エラー</strong><p>${escapeHtml(e.message)}</p>`;box.classList.remove("hidden");}
}

function giveUpVocabInput(){
  if(vocabAnswered)return;

  const q=vocabSet[vocabIndex];
  vocabAnswered=true;

  $("vocabInputAnswer").disabled=true;
  $("vocabInputSubmitBtn").disabled=true;
  $("vocabGiveUpBtn").disabled=true;

  finishVocabAnswer({
    good:false,
    q,
    feedbackText:q.explanation_ja||"答えを確認して、次回もう一度思い出してみましょう。",
    acceptedAnswer:$("vocabMode").value==="en-ja"?(q.meaning_ja||""):(q.word||"")
  });
}

$("vocabGiveUpBtn").addEventListener("click",giveUpVocabInput);

$("vocabInputSubmitBtn").addEventListener("click",answerVocabInput);$("vocabInputAnswer").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();answerVocabInput();}});
$("vocabNextBtn").addEventListener("click",()=>{vocabIndex++;if(vocabIndex<vocabSet.length){renderVocabQuestion();setTimeout(()=>$("vocabQuiz").scrollIntoView({behavior:"smooth",block:"start"}),50);}else{finishVocab();setTimeout(()=>$("vocabSummary").scrollIntoView({behavior:"smooth",block:"start"}),50);}});

function finishVocab(){
  $("vocabQuiz").classList.add("hidden");$("vocabSummary").classList.remove("hidden");$("vocabFinalScore").textContent=`${vocabCorrect}/${vocabSet.length}`;$("vocabSummaryMsg").textContent=vocabCorrect===vocabSet.length?"Perfect!":vocabCorrect/vocabSet.length>=.8?"Great job!":"間違えた単語をもう一度確認しましょう。";$("vocabReview").innerHTML=vocabMistakes.length?`<h3>Review</h3>${vocabMistakes.map(q=>`<div class="review-card"><strong>${escapeHtml(q.word)}</strong> — ${escapeHtml(q.meaning_ja||"")}<p>${escapeHtml(q.explanation_ja||"")}</p></div>`).join("")}`:`<div class="review-card review-correct">全問正解です！</div>`;progress.vocabulary+=vocabSet.length;progress.correct+=vocabCorrect;progress.total+=vocabSet.length;saveProgress();
}


/* Writing: Japanese -> English */
$("newWritingBtn").addEventListener("click", generateWriting);
$("writingAgainBtn").addEventListener("click", generateWriting);

async function generateWriting(){
  const btn = $("newWritingBtn");
  try{
    btn.disabled = true;
    $("writingStart").classList.remove("hidden");
    $("writingStart").innerHTML = `<div class="empty-icon">⏳</div><h2>英作文問題を作成しています…</h2>`;
    $("writingQuiz").classList.add("hidden");
    $("writingSummary").classList.add("hidden");

    const count = Number($("writingCount").value) || 5;
    const data = await postJson("/api/writing", {...commonSettings(), count});
    writingSet = Array.isArray(data.questions) ? data.questions : [];
    if(!writingSet.length) throw new Error("英作文問題を生成できませんでした。");

    writingIndex = 0;
    writingCorrect = 0;
    writingMistakes = [];
    $("writingStart").classList.add("hidden");
    $("writingQuiz").classList.remove("hidden");
    renderWritingQuestion();
    $("writingQuiz").scrollIntoView({behavior:"smooth", block:"start"});
  }catch(e){
    $("writingStart").classList.remove("hidden");
    $("writingStart").innerHTML = `<div class="empty-icon">⚠️</div><h2>エラー</h2><p class="error">${escapeHtml(e.message)}</p>`;
  }finally{
    btn.disabled = false;
  }
}

function renderWritingQuestion(){
  const q = writingSet[writingIndex];
  const total = writingSet.length;
  writingAnswered = false;
  $("writingProgress").textContent = `${writingIndex + 1} / ${total}`;
  $("writingRunningScore").textContent = `Score ${writingCorrect}`;
  $("writingBar").style.width = `${writingIndex / total * 100}%`;
  $("writingPrompt").textContent = q.japanese;
  $("writingAnswer").value = "";
  $("writingAnswer").disabled = false;
  $("writingSubmitBtn").disabled = false;
  $("writingGiveUpBtn").disabled = false;
  $("writingFeedback").classList.add("hidden");
  $("writingNextBtn").classList.add("hidden");
  setTimeout(() => $("writingAnswer").focus(), 50);
}

function finishWritingAnswer({good, result=null, gaveUp=false}){
  const q = writingSet[writingIndex];
  writingAnswered = true;

  if(good) writingCorrect++;
  else writingMistakes.push({q, result, gaveUp});

  $("writingAnswer").disabled = true;
  $("writingSubmitBtn").disabled = true;
  $("writingGiveUpBtn").disabled = true;

  const box = $("writingFeedback");
  box.className = `feedback-box ${good ? "good" : "bad"}`;

  const reference = result?.reference_answer || q.reference_answer || "";
  const feedback = result?.feedback_ja || (gaveUp ? "模範解答を確認して、語順と表現を声に出して復習しましょう。" : "");
  const natural = result?.natural_answer || "";
  const points = Array.isArray(result?.points) ? result.points : [];

  box.innerHTML = `
    <strong>${good ? "✓ Correct!" : gaveUp ? "答えを確認" : "△ 要修正"}</strong>
    ${reference ? `<p><strong>模範解答:</strong> ${escapeHtml(reference)}</p>` : ""}
    ${natural && natural !== reference ? `<p><strong>より自然な表現:</strong> ${escapeHtml(natural)}</p>` : ""}
    ${feedback ? `<p>${escapeHtml(feedback)}</p>` : ""}
    ${points.length ? `<ul>${points.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul>` : ""}
  `;
  box.classList.remove("hidden");
  $("writingNextBtn").classList.remove("hidden");
  setTimeout(() => $("writingNextBtn").scrollIntoView({behavior:"smooth", block:"end"}), 100);
}

async function submitWriting(){
  if(writingAnswered) return;
  const answer = $("writingAnswer").value.trim();
  if(!answer) return;

  const q = writingSet[writingIndex];
  try{
    $("writingSubmitBtn").disabled = true;
    $("writingGiveUpBtn").disabled = true;
    $("writingAnswer").disabled = true;

    const result = await postJson("/api/writing-check", {
      level: $("level").value,
      japanese: q.japanese,
      reference_answer: q.reference_answer || "",
      user_answer: answer
    });

    finishWritingAnswer({good:Boolean(result.correct), result});
  }catch(e){
    $("writingSubmitBtn").disabled = false;
    $("writingGiveUpBtn").disabled = false;
    $("writingAnswer").disabled = false;
    const box = $("writingFeedback");
    box.className = "feedback-box bad";
    box.innerHTML = `<strong>判定エラー</strong><p>${escapeHtml(e.message)}</p>`;
    box.classList.remove("hidden");
  }
}

$("writingSubmitBtn").addEventListener("click", submitWriting);
$("writingAnswer").addEventListener("keydown", e=>{
  if((e.ctrlKey || e.metaKey) && e.key === "Enter"){
    e.preventDefault();
    submitWriting();
  }
});

$("writingGiveUpBtn").addEventListener("click", ()=>{
  if(writingAnswered) return;
  const q = writingSet[writingIndex];
  finishWritingAnswer({
    good:false,
    gaveUp:true,
    result:{
      reference_answer:q.reference_answer || "",
      feedback_ja:q.explanation_ja || "模範解答を確認しましょう。",
      points:q.key_points || []
    }
  });
});

$("writingNextBtn").addEventListener("click", ()=>{
  writingIndex++;
  if(writingIndex < writingSet.length){
    renderWritingQuestion();
    setTimeout(()=>$("writingQuiz").scrollIntoView({behavior:"smooth",block:"start"}),50);
  }else{
    finishWriting();
  }
});

function finishWriting(){
  $("writingQuiz").classList.add("hidden");
  $("writingSummary").classList.remove("hidden");
  $("writingFinalScore").textContent = `${writingCorrect}/${writingSet.length}`;
  $("writingSummaryMsg").textContent =
    writingCorrect === writingSet.length ? "Perfect!" :
    writingCorrect / writingSet.length >= 0.8 ? "Great job!" :
    "模範解答を見ながら、語順と表現を復習しましょう。";

  $("writingReview").innerHTML = writingMistakes.length
    ? `<h3>Review</h3>${writingMistakes.map(({q,result})=>`
        <div class="review-card">
          <strong>${escapeHtml(q.japanese)}</strong>
          <p><strong>模範解答:</strong> ${escapeHtml(result?.reference_answer || q.reference_answer || "")}</p>
          ${result?.feedback_ja ? `<p>${escapeHtml(result.feedback_ja)}</p>` : ""}
        </div>`).join("")}`
    : `<div class="review-card review-correct">全問正解です！</div>`;

  progress.writing = (progress.writing || 0) + writingSet.length;
  progress.correct += writingCorrect;
  progress.total += writingSet.length;
  saveProgress();
  $("writingSummary").scrollIntoView({behavior:"smooth", block:"start"});
}


/* Reading */
$("newReadingBtn").addEventListener("click",generateReading);$("nextReadingBtn").addEventListener("click",generateReading);
async function generateReading(){
  const btn=$("newReadingBtn");try{btn.disabled=true;$("readingStart").classList.remove("hidden");$("readingStart").innerHTML=`<div class="empty-icon">⏳</div><h2>文章を作成しています…</h2>`;$("readingQuiz").classList.add("hidden");$("readingResult").classList.add("hidden");reading=await postJson("/api/reading",{...commonSettings(),length:$("readingLength").value,count:Number($("readingCount").value)});$("readingPassage").textContent=reading.passage;$("readingQuestions").innerHTML=(reading.questions||[]).map((q,i)=>questionHtml(q,i,"rq")).join("");document.querySelectorAll('input[name^="rq"]').forEach(input=>input.addEventListener("change",()=>{$("readingCheckBtn").disabled=!(reading.questions||[]).every((_,i)=>document.querySelector(`input[name="rq${i}"]:checked`));}));$("readingCheckBtn").disabled=true;$("readingStart").classList.add("hidden");$("readingQuiz").classList.remove("hidden");$("readingQuiz").scrollIntoView({behavior:"smooth",block:"start"});}catch(e){$("readingStart").classList.remove("hidden");$("readingStart").innerHTML=`<div class="empty-icon">⚠️</div><h2>エラー</h2><p class="error">${escapeHtml(e.message)}</p>`;}finally{btn.disabled=false;}
}

$("readingCheckBtn").addEventListener("click",()=>{let correctCount=0;const qs=reading.questions||[];const review=qs.map((q,i)=>{const s=document.querySelector(`input[name="rq${i}"]:checked`);if(!s)return"";const si=Number(s.value),ai=Number(q.answer_index);if(si===ai)correctCount++;return `<div class="review-card ${si===ai?"review-correct":"review-wrong"}"><div class="question-title">Q${i+1}. ${escapeHtml(q.question)}</div><p><strong>Your answer:</strong> ${String.fromCharCode(65+si)}. ${escapeHtml(q.options[si])}</p><p><strong>Correct:</strong> ${String.fromCharCode(65+ai)}. ${escapeHtml(q.options[ai])}</p><p>${escapeHtml(q.explanation_ja||"")}</p></div>`;}).join("");$("readingScore").textContent=`${correctCount}/${qs.length}`;$("readingScoreMsg").textContent=correctCount===qs.length?"Excellent!":correctCount/qs.length>=.7?"よく読めています。":"解説と日本語訳を確認して読み直しましょう。";$("readingReview").innerHTML=review;$("readingTranslation").textContent=reading.translation;$("readingVocabulary").innerHTML=(reading.key_vocabulary||[]).map(v=>`<span class="vocab-chip">${escapeHtml(v.word)} — ${escapeHtml(v.meaning_ja)}</span>`).join("");$("readingResult").classList.remove("hidden");$("readingResult").scrollIntoView({behavior:"smooth",block:"start"});$("readingCheckBtn").disabled=true;$("readingQuestions").querySelectorAll("input").forEach(x=>x.disabled=true);addProgress("reading",correctCount,qs.length);});

$("clearProgressBtn").addEventListener("click",()=>{if(confirm("今日の学習履歴と苦手単語をリセットしますか？")){progress=blankProgress();saveProgress();}});

renderProgress();
resetListeningMode();

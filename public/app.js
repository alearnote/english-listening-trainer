const $ = id => document.getElementById(id);

let listening = null;
let listeningAudioUrl = null;
let listeningSpeed = 1;
let listeningMcqRevealed = false;
let vocabSet = [];
let vocabIndex = 0;
let vocabCorrect = 0;
let vocabMistakes = [];
let reading = null;

const STORAGE_KEY = "englishTrainerV2Progress";

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function blankProgress() {
  return { date: todayKey(), listening: 0, vocabulary: 0, reading: 0, correct: 0, total: 0, weakWords: {} };
}
function loadProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!p || p.date !== todayKey()) return blankProgress();
    return { ...blankProgress(), ...p, weakWords: p.weakWords || {} };
  } catch { return blankProgress(); }
}
let progress = loadProgress();

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  renderProgress();
}
function addProgress(kind, correct = 0, total = 0) {
  progress[kind] = (progress[kind] || 0) + 1;
  progress.correct += correct;
  progress.total += total;
  saveProgress();
}
function addWeakWord(word, meaning = "") {
  if (!word) return;
  const key = word.toLowerCase();
  const old = progress.weakWords[key] || { word, meaning, count: 0 };
  old.count += 1;
  if (meaning) old.meaning = meaning;
  progress.weakWords[key] = old;
  saveProgress();
}
function renderProgress() {
  $("statListening").textContent = progress.listening;
  $("statVocabulary").textContent = progress.vocabulary;
  $("statReading").textContent = progress.reading;
  $("todayTotal").textContent = progress.listening + progress.vocabulary + progress.reading;
  $("statAccuracy").textContent = progress.total ? `${Math.round(progress.correct / progress.total * 100)}%` : "—";
  const words = Object.values(progress.weakWords).sort((a,b) => b.count-a.count).slice(0,30);
  $("weakWords").innerHTML = words.length
    ? words.map(w => `<span class="weak-word">${escapeHtml(w.word)}${w.meaning ? ` — ${escapeHtml(w.meaning)}` : ""} ×${w.count}</span>`).join("")
    : '<span class="note">まだ記録はありません。</span>';
}

function escapeHtml(s) {
  return String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
}
async function postJson(url, body) {
  const r = await fetch(url, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify(body)
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "通信エラー");
  return data;
}
function normalize(s) {
  return String(s).toLowerCase().replace(/[’']/g,"'").replace(/[^\p{L}\p{N}' ]/gu," ").replace(/\s+/g," ").trim();
}
function wordLevenshtein(a,b) {
  const A=normalize(a).split(" "), B=normalize(b).split(" ");
  const dp=Array.from({length:A.length+1},()=>Array(B.length+1).fill(0));
  for(let i=0;i<=A.length;i++)dp[i][0]=i;
  for(let j=0;j<=B.length;j++)dp[0][j]=j;
  for(let i=1;i<=A.length;i++)for(let j=1;j<=B.length;j++){
    const c=A[i-1]===B[j-1]?0:1;
    dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+c);
  }
  return {dist:dp[A.length][B.length],max:Math.max(A.length,B.length,1)};
}
function dictationScore(correct,user) {
  const x=wordLevenshtein(correct,user);
  return Math.max(0,Math.round((1-x.dist/x.max)*100));
}
function commonSettings() {
  return { level:$("level").value, topic:$("topic").value };
}

/* tabs */
document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".tab-page").forEach(x=>x.classList.add("hidden"));
  btn.classList.add("active");
  $(`tab-${btn.dataset.tab}`).classList.remove("hidden");
  if (btn.dataset.tab === "progress") renderProgress();
}));

/* LISTENING */
function clearListeningAudio() {
  if(listeningAudioUrl){ URL.revokeObjectURL(listeningAudioUrl); listeningAudioUrl=null; }
  $("audio").removeAttribute("src"); $("audio").load();
}
function resetListeningMode() {
  listening=null; listeningMcqRevealed=false; clearListeningAudio();
  $("listeningResult").classList.add("hidden");
  $("dictationAnswer").value="";
  $("dictationAnswer").disabled=true;
  $("dictationCheckBtn").disabled=true;
  $("playBtn").disabled=true;
  $("listeningMcqPanel").classList.add("hidden");
  $("listeningQuestions").innerHTML="";
  $("listeningMcqCheckBtn").disabled=true;
  $("dictationPanel").classList.toggle("hidden",$("listeningMode").value!=="dictation");
  $("listeningStatus").textContent="「新しい問題」を押してください";
}
$("listeningMode").addEventListener("change",resetListeningMode);

$("newListeningBtn").addEventListener("click", async () => {
  const btn=$("newListeningBtn");
  try{
    btn.disabled=true; resetListeningMode(); $("listeningStatus").classList.remove("error");
    $("listeningStatus").textContent="AIが問題を作成しています…";
    listening=await postJson("/api/listening",{
      ...commonSettings(), mode:$("listeningMode").value, length:$("listeningLength").value
    });
    if($("listeningMode").value==="dictation"){
      $("dictationPanel").classList.remove("hidden");
      $("dictationAnswer").disabled=false;
      $("dictationCheckBtn").disabled=false;
      $("listeningStatus").textContent="準備できました。音声を再生してください。";
    }else{
      $("listeningMcqPanel").classList.add("hidden");
      $("listeningStatus").textContent="準備できました。まず音声を最後まで聞いてください。";
    }
    $("playBtn").disabled=false;
  }catch(e){$("listeningStatus").textContent=e.message;$("listeningStatus").classList.add("error")}
  finally{btn.disabled=false}
});

async function playListening() {
  if(!listening)return;
  const play=$("playBtn"), audio=$("audio");
  try{
    play.disabled=true;$("listeningStatus").classList.remove("error");
    if(!listeningAudioUrl){
      $("listeningStatus").textContent="音声を準備しています…";
      const r=await fetch("/api/speech",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:listening.sentence})});
      if(!r.ok){let msg="音声生成に失敗しました。";try{msg=(await r.json()).error||msg}catch{}throw new Error(msg)}
      listeningAudioUrl=URL.createObjectURL(await r.blob());
      audio.src=listeningAudioUrl;
    }
    audio.playbackRate=listeningSpeed;audio.currentTime=0;
    audio.onended=()=>{
      if($("listeningMode").value==="mcq"){
        if(!listeningMcqRevealed){renderListeningQuestions();$("listeningMcqPanel").classList.remove("hidden");listeningMcqRevealed=true;$("listeningMcqPanel").scrollIntoView({behavior:"smooth",block:"start"})}
        $("listeningStatus").textContent="内容について3問に答えてください。";
      }else $("listeningStatus").textContent="聞こえた英文を入力してください。";
    };
    await audio.play();$("listeningStatus").textContent="再生中…";
  }catch(e){$("listeningStatus").textContent=e.message;$("listeningStatus").classList.add("error")}
  finally{play.disabled=false}
}
$("playBtn").addEventListener("click",playListening);$("replayBtn").addEventListener("click",playListening);
document.querySelectorAll(".speed").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".speed").forEach(x=>x.classList.remove("active"));btn.classList.add("active");listeningSpeed=Number(btn.dataset.speed);
}));

function renderListeningQuestions(){
  $("listeningQuestions").innerHTML=(listening.questions||[]).map((q,i)=>questionHtml(q,i,"lq")).join("");
  document.querySelectorAll('input[name^="lq"]').forEach(x=>x.addEventListener("change",()=>{
    $("listeningMcqCheckBtn").disabled=!(listening.questions||[]).every((_,i)=>document.querySelector(`input[name="lq${i}"]:checked`));
  }));
}
function questionHtml(q,i,prefix){
  return `<div class="question-card"><div class="question-title">Q${i+1}. ${escapeHtml(q.question)}</div><div class="option-list">${
    q.options.map((o,j)=>`<label class="option"><input type="radio" name="${prefix}${i}" value="${j}"><span><strong>${String.fromCharCode(65+j)}.</strong> ${escapeHtml(o)}</span></label>`).join("")
  }</div></div>`;
}
$("dictationCheckBtn").addEventListener("click",async()=>{
  if(!listening||!$("dictationAnswer").value.trim())return;
  const user=$("dictationAnswer").value.trim(), score=dictationScore(listening.sentence,user);
  $("listeningScore").textContent=`${score}%`;$("listeningScoreLabel").textContent="Dictation score";
  $("listeningScoreMsg").textContent=score>=95?"Excellent!":score>=80?"かなり聞き取れています。":score>=60?"あと少しです。":"正解を確認して聞き直しましょう。";
  $("dictationYourAnswer").classList.remove("hidden");$("dictationYourAnswerText").textContent=user;
  $("listeningReview").classList.add("hidden");$("listeningCoach").classList.remove("hidden");
  showListeningBase();$("listeningFeedback").textContent="AIが解説を生成しています…";$("listeningFocus").innerHTML="";
  addProgress("listening",score>=80?1:0,1);$("dictationCheckBtn").disabled=true;
  try{
    const ex=await postJson("/api/explain",{sentence:listening.sentence,answer:user});
    $("listeningFeedback").textContent=ex.feedback;$("listeningFocus").innerHTML=(ex.focus||[]).map(x=>`<li>${escapeHtml(x)}</li>`).join("");
  }catch{$("listeningFeedback").textContent="AI解説の取得に失敗しました。"}
});
$("listeningMcqCheckBtn").addEventListener("click",()=>{
  let c=0;
  const html=(listening.questions||[]).map((q,i)=>{
    const s=Number(document.querySelector(`input[name="lq${i}"]:checked`).value), a=Number(q.answer_index);if(s===a)c++;
    return `<div class="review-card ${s===a?"review-correct":"review-wrong"}"><div class="question-title">Q${i+1}. ${escapeHtml(q.question)}</div><p><strong>Your answer:</strong> ${String.fromCharCode(65+s)}. ${escapeHtml(q.options[s])}</p><p><strong>Correct:</strong> ${String.fromCharCode(65+a)}. ${escapeHtml(q.options[a])}</p><p>${escapeHtml(q.explanation_ja||"")}</p></div>`;
  }).join("");
  $("listeningScore").textContent=`${c}/3`;$("listeningScoreLabel").textContent="Comprehension score";$("listeningScoreMsg").textContent=c===3?"Excellent!":c===2?"Good! もう一度聞くとさらに定着します。":"スクリプトを確認して聞き直しましょう。";
  $("dictationYourAnswer").classList.add("hidden");$("listeningReview").innerHTML=html;$("listeningReview").classList.remove("hidden");$("listeningCoach").classList.add("hidden");
  showListeningBase();addProgress("listening",c,3);$("listeningMcqCheckBtn").disabled=true;
  $("listeningQuestions").querySelectorAll("input").forEach(x=>x.disabled=true);
});
function showListeningBase(){
  $("listeningTranscript").textContent=listening.sentence;$("listeningTranslation").textContent=listening.translation;$("listeningTip").textContent=listening.listening_tip||"";
  $("listeningResult").classList.remove("hidden");$("listeningResult").scrollIntoView({behavior:"smooth",block:"start"});
}
$("nextListeningBtn").addEventListener("click",()=> $("newListeningBtn").click());

/* VOCABULARY */
$("vocabCount").addEventListener("change",()=>{$("newVocabBtn").textContent=`＋ ${$("vocabCount").value}問作る`});
$("newVocabBtn").addEventListener("click",generateVocab);$("vocabAgainBtn").addEventListener("click",generateVocab);
async function generateVocab(){
  const btn=$("newVocabBtn");
  try{
    btn.disabled=true;$("vocabStart").classList.remove("hidden");$("vocabStart").innerHTML='<div class="empty-icon">⏳</div><h2>問題を作成しています…</h2>';
    $("vocabQuiz").classList.add("hidden");$("vocabSummary").classList.add("hidden");
    const data=await postJson("/api/vocabulary",{...commonSettings(),mode:$("vocabMode").value,count:Number($("vocabCount").value)});
    vocabSet=data.questions||[];vocabIndex=0;vocabCorrect=0;vocabMistakes=[];
    if(!vocabSet.length)throw new Error("問題を生成できませんでした。");
    $("vocabStart").classList.add("hidden");$("vocabQuiz").classList.remove("hidden");renderVocabQuestion();
  }catch(e){$("vocabStart").classList.remove("hidden");$("vocabStart").innerHTML=`<div class="empty-icon">⚠️</div><h2>エラー</h2><p class="error">${escapeHtml(e.message)}</p>`}
  finally{btn.disabled=false}
}
function renderVocabQuestion(){
  const q=vocabSet[vocabIndex], n=vocabSet.length;
  $("vocabProgress").textContent=`${vocabIndex+1} / ${n}`;$("vocabRunningScore").textContent=`Score ${vocabCorrect}`;$("vocabBar").style.width=`${vocabIndex/n*100}%`;
  $("vocabPrompt").textContent=q.prompt;$("vocabContext").textContent=q.context||"";$("vocabContext").classList.toggle("hidden",!q.context);
  $("vocabFeedback").classList.add("hidden");$("vocabNextBtn").classList.add("hidden");
  $("vocabOptions").innerHTML=q.options.map((o,i)=>`<button class="option vocab-choice" data-index="${i}"><span><strong>${String.fromCharCode(65+i)}.</strong> ${escapeHtml(o)}</span></button>`).join("");
  document.querySelectorAll(".vocab-choice").forEach(b=>b.addEventListener("click",()=>answerVocab(Number(b.dataset.index))));
}
function answerVocab(selected){
  const q=vocabSet[vocabIndex], correct=Number(q.answer_index), good=selected===correct;
  if(good)vocabCorrect++;else{vocabMistakes.push(q);addWeakWord(q.word,q.meaning_ja)}
  document.querySelectorAll(".vocab-choice").forEach((b,i)=>{b.disabled=true;if(i===correct)b.classList.add("correct-choice");if(i===selected&&!good)b.classList.add("wrong-choice")});
  const box=$("vocabFeedback");box.className=`feedback-box ${good?"good":"bad"}`;box.innerHTML=`<strong>${good?"✓ Correct!":"✕ Incorrect"}</strong><p><b>${escapeHtml(q.word||"")}</b>${q.meaning_ja?` — ${escapeHtml(q.meaning_ja)}`:""}</p><p>${escapeHtml(q.explanation_ja||"")}</p>`;
  box.classList.remove("hidden");$("vocabNextBtn").classList.remove("hidden");
}
$("vocabNextBtn").addEventListener("click",()=>{
  // Correct/total is recorded once at set completion to avoid double-counting.
  vocabIndex++;
  if(vocabIndex<vocabSet.length)renderVocabQuestion();else finishVocab();
});
function finishVocab(){
  $("vocabQuiz").classList.add("hidden");$("vocabSummary").classList.remove("hidden");
  $("vocabFinalScore").textContent=`${vocabCorrect}/${vocabSet.length}`;$("vocabSummaryMsg").textContent=vocabCorrect===vocabSet.length?"Perfect!":vocabCorrect/vocabSet.length>=.8?"Great job!":"間違えた単語をもう一度確認しましょう。";
  $("vocabReview").innerHTML=vocabMistakes.length?`<div class="label">REVIEW</div>${vocabMistakes.map(q=>`<div class="review-card"><strong>${escapeHtml(q.word)}</strong> — ${escapeHtml(q.meaning_ja||"")}<p>${escapeHtml(q.explanation_ja||"")}</p></div>`).join("")}`:'<div class="review-card review-correct">全問正解です！</div>';
  // vocabulary is counted by questions, not sets
  progress.vocabulary += vocabSet.length; progress.correct += vocabCorrect; progress.total += vocabSet.length; saveProgress();
}

/* READING */
$("newReadingBtn").addEventListener("click",generateReading);$("nextReadingBtn").addEventListener("click",generateReading);
async function generateReading(){
  const btn=$("newReadingBtn");
  try{
    btn.disabled=true;$("readingStart").classList.remove("hidden");$("readingStart").innerHTML='<div class="empty-icon">⏳</div><h2>文章を作成しています…</h2>';
    $("readingQuiz").classList.add("hidden");$("readingResult").classList.add("hidden");
    reading=await postJson("/api/reading",{...commonSettings(),length:$("readingLength").value,count:Number($("readingCount").value)});
    $("readingPassage").textContent=reading.passage;
    $("readingQuestions").innerHTML=(reading.questions||[]).map((q,i)=>questionHtml(q,i,"rq")).join("");
    document.querySelectorAll('input[name^="rq"]').forEach(x=>x.addEventListener("change",()=>{
      $("readingCheckBtn").disabled=!(reading.questions||[]).every((_,i)=>document.querySelector(`input[name="rq${i}"]:checked`));
    }));
    $("readingCheckBtn").disabled=true;$("readingStart").classList.add("hidden");$("readingQuiz").classList.remove("hidden");
  }catch(e){$("readingStart").classList.remove("hidden");$("readingStart").innerHTML=`<div class="empty-icon">⚠️</div><h2>エラー</h2><p class="error">${escapeHtml(e.message)}</p>`}
  finally{btn.disabled=false}
}
$("readingCheckBtn").addEventListener("click",()=>{
  let c=0;
  const review=(reading.questions||[]).map((q,i)=>{
    const s=Number(document.querySelector(`input[name="rq${i}"]:checked`).value),a=Number(q.answer_index);if(s===a)c++;
    return `<div class="review-card ${s===a?"review-correct":"review-wrong"}"><div class="question-title">Q${i+1}. ${escapeHtml(q.question)}</div><p><strong>Your answer:</strong> ${String.fromCharCode(65+s)}. ${escapeHtml(q.options[s])}</p><p><strong>Correct:</strong> ${String.fromCharCode(65+a)}. ${escapeHtml(q.options[a])}</p><p>${escapeHtml(q.explanation_ja||"")}</p></div>`;
  }).join("");
  $("readingScore").textContent=`${c}/${reading.questions.length}`;$("readingScoreMsg").textContent=c===reading.questions.length?"Excellent!":c/reading.questions.length>=.7?"よく読めています。":"解説と日本語訳を確認して読み直しましょう。";
  $("readingReview").innerHTML=review;$("readingTranslation").textContent=reading.translation;
  $("readingVocabulary").innerHTML=(reading.key_vocabulary||[]).map(v=>`<span class="vocab-chip">${escapeHtml(v.word)} — ${escapeHtml(v.meaning_ja)}</span>`).join("");
  $("readingResult").classList.remove("hidden");$("readingResult").scrollIntoView({behavior:"smooth",block:"start"});
  $("readingCheckBtn").disabled=true;$("readingQuestions").querySelectorAll("input").forEach(x=>x.disabled=true);
  addProgress("reading",c,reading.questions.length);
});

/* reset */
$("clearProgressBtn").addEventListener("click",()=>{
  if(confirm("今日の学習履歴と苦手単語をリセットしますか？")){progress=blankProgress();saveProgress()}
});
renderProgress();resetListeningMode();

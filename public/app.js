const $ = (id) => document.getElementById(id);

let current = null;
let speed = 1;
let audioUrl = null;
let completed = 0;

const newBtn = $("newBtn");
const playBtn = $("playBtn");
const checkBtn = $("checkBtn");
const answer = $("answer");
const statusEl = $("status");
const audio = $("audio");

function normalize(s) {
  return s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}' ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  const A = a.split(" ");
  const B = b.split(" ");
  const dp = Array.from({ length: A.length + 1 }, () => Array(B.length + 1).fill(0));
  for (let i = 0; i <= A.length; i++) dp[i][0] = i;
  for (let j = 0; j <= B.length; j++) dp[0][j] = j;
  for (let i = 1; i <= A.length; i++) {
    for (let j = 1; j <= B.length; j++) {
      const cost = A[i - 1] === B[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return { dist: dp[A.length][B.length], max: Math.max(A.length, B.length, 1) };
}

function scoreAnswer(correct, user) {
  const { dist, max } = levenshtein(normalize(correct), normalize(user));
  return Math.max(0, Math.round((1 - dist / max) * 100));
}

async function postJson(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "通信エラー");
  return data;
}

async function makeExercise() {
  try {
    newBtn.disabled = true;
    playBtn.disabled = true;
    checkBtn.disabled = true;
    answer.disabled = true;
    answer.value = "";
    $("result").classList.add("hidden");
    statusEl.classList.remove("error");
    statusEl.textContent = "AIが問題を作成しています…";

    current = await postJson("/api/exercise", {
      level: $("level").value,
      topic: $("topic").value,
      length: $("length").value
    });

    statusEl.textContent = "準備できました。再生ボタンを押してください。";
    playBtn.disabled = false;
    answer.disabled = false;
    checkBtn.disabled = false;
    answer.focus();
  } catch (e) {
    statusEl.textContent = e.message;
    statusEl.classList.add("error");
  } finally {
    newBtn.disabled = false;
  }
}

async function playSpeech() {
  if (!current) return;
  try {
    playBtn.disabled = true;
    statusEl.textContent = "音声を準備しています…";

    const r = await fetch("/api/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: current.sentence, speed })
    });

    if (!r.ok) {
      let msg = "音声生成に失敗しました。";
      try { msg = (await r.json()).error || msg; } catch {}
      throw new Error(msg);
    }

    const blob = await r.blob();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(blob);
    audio.src = audioUrl;
    await audio.play();
    statusEl.textContent = "再生中…";
    audio.onended = () => statusEl.textContent = "聞こえた英文を入力してください。";
  } catch (e) {
    statusEl.textContent = e.message;
    statusEl.classList.add("error");
  } finally {
    playBtn.disabled = false;
  }
}

async function checkAnswer() {
  if (!current || !answer.value.trim()) return;
  const user = answer.value.trim();
  const score = scoreAnswer(current.sentence, user);

  $("score").textContent = `${score}%`;
  $("scoreMsg").textContent =
    score >= 95 ? "Excellent!" :
    score >= 80 ? "かなり聞き取れています。" :
    score >= 60 ? "あと少し。聞き直して音の変化を確認しましょう。" :
    "正解を見ながら、もう一度音を確認しましょう。";
  $("yourAnswer").textContent = user;
  $("correctAnswer").textContent = current.sentence;
  $("translation").textContent = current.translation;
  $("tip").textContent = current.listening_tip;
  $("feedback").textContent = "AIが解説を生成しています…";
  $("focus").innerHTML = "";
  $("result").classList.remove("hidden");

  completed++;
  $("count").textContent = completed;
  checkBtn.disabled = true;

  try {
    const explanation = await postJson("/api/explain", {
      sentence: current.sentence,
      answer: user
    });
    $("feedback").textContent = explanation.feedback;
    $("focus").innerHTML = (explanation.focus || [])
      .map(x => `<li>${escapeHtml(x)}</li>`).join("");
  } catch (e) {
    $("feedback").textContent = "AI解説の取得に失敗しましたが、採点結果は利用できます。";
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

document.querySelectorAll(".speed").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".speed").forEach(x => x.classList.remove("active"));
    btn.classList.add("active");
    speed = Number(btn.dataset.speed);
  });
});

newBtn.addEventListener("click", makeExercise);
playBtn.addEventListener("click", playSpeech);
checkBtn.addEventListener("click", checkAnswer);
$("replayBtn").addEventListener("click", playSpeech);
$("nextBtn").addEventListener("click", makeExercise);

answer.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key === "Enter" && !checkBtn.disabled) checkAnswer();
});

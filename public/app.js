const $ = (id) => document.getElementById(id);

let current = null;
let speed = 1;
let audioUrl = null;
let completed = 0;

const newBtn = $("newBtn");
const playBtn = $("playBtn");
const checkBtn = $("checkBtn");
const mcqCheckBtn = $("mcqCheckBtn");
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

function escapeHtml(s) {
  return String(s)
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
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "通信エラー");
  return data;
}

function updateModeUI() {
  const mode = $("mode").value;
  $("dictationPanel").classList.toggle("hidden", mode !== "dictation");
  $("mcqPanel").classList.toggle("hidden", mode !== "mcq");
  $("result").classList.add("hidden");
  current = null;
  playBtn.disabled = true;
  answer.disabled = true;
  checkBtn.disabled = true;
  mcqCheckBtn.disabled = true;
  statusEl.textContent = "「新しい問題」を押してください";
  clearAudioCache();
}

function clearAudioCache() {
  if (audioUrl) {
    URL.revokeObjectURL(audioUrl);
    audioUrl = null;
  }
  audio.removeAttribute("src");
  audio.load();
}

function renderMcqQuestions() {
  const wrap = $("questions");
  wrap.innerHTML = "";
  (current.questions || []).forEach((q, qi) => {
    const card = document.createElement("div");
    card.className = "question-card";
    card.innerHTML = `
      <div class="question-title">Q${qi + 1}. ${escapeHtml(q.question)}</div>
      <div class="option-list">
        ${q.options.map((opt, oi) => `
          <label class="option">
            <input type="radio" name="q${qi}" value="${oi}">
            <span><strong>${String.fromCharCode(65 + oi)}.</strong> ${escapeHtml(opt)}</span>
          </label>
        `).join("")}
      </div>
    `;
    wrap.appendChild(card);
  });
  wrap.querySelectorAll('input[type="radio"]').forEach(input => {
    input.addEventListener("change", updateMcqCheckState);
  });
  updateMcqCheckState();
}

function updateMcqCheckState() {
  if (!current || $("mode").value !== "mcq") {
    mcqCheckBtn.disabled = true;
    return;
  }
  const answered = (current.questions || []).every((_, qi) =>
    document.querySelector(`input[name="q${qi}"]:checked`)
  );
  mcqCheckBtn.disabled = !answered;
}

async function makeExercise() {
  try {
    newBtn.disabled = true;
    playBtn.disabled = true;
    checkBtn.disabled = true;
    mcqCheckBtn.disabled = true;
    answer.disabled = true;
    answer.value = "";
    $("questions").innerHTML = "";
    $("result").classList.add("hidden");
    statusEl.classList.remove("error");
    statusEl.textContent = "AIが問題を作成しています…";

    current = await postJson("/api/exercise", {
      mode: $("mode").value,
      level: $("level").value,
      topic: $("topic").value,
      length: $("length").value
    });

    clearAudioCache();

    if ($("mode").value === "dictation") {
      answer.disabled = false;
      checkBtn.disabled = false;
      answer.focus();
      statusEl.textContent = "準備できました。再生ボタンを押してください。";
    } else {
      renderMcqQuestions();
      statusEl.textContent = "準備できました。音声を聞いて3問に答えてください。";
    }

    playBtn.disabled = false;
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
    statusEl.classList.remove("error");

    // 1問につき音声APIを呼ぶのは最初の1回だけ。
    if (!audioUrl) {
      statusEl.textContent = "音声を準備しています…";

      const r = await fetch("/api/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: current.sentence, speed: 1 })
      });

      if (!r.ok) {
        let msg = "音声生成に失敗しました。";
        try { msg = (await r.json()).error || msg; } catch {}
        throw new Error(msg);
      }

      const blob = await r.blob();
      audioUrl = URL.createObjectURL(blob);
      audio.src = audioUrl;
    }

    audio.playbackRate = speed;
    audio.currentTime = 0;
    await audio.play();
    statusEl.textContent = "再生中…";
    audio.onended = () => {
      statusEl.textContent = $("mode").value === "mcq"
        ? "内容について3問に答えてください。"
        : "聞こえた英文を入力してください。";
    };
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
  $("scoreLabel").textContent = "Dictation score";
  $("scoreMsg").textContent =
    score >= 95 ? "Excellent!" :
    score >= 80 ? "かなり聞き取れています。" :
    score >= 60 ? "あと少し。聞き直して音の変化を確認しましょう。" :
    "正解を見ながら、もう一度音を確認しましょう。";

  $("dictationResult").classList.remove("hidden");
  $("mcqResult").classList.add("hidden");
  $("coachBox").classList.remove("hidden");
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

function checkMcq() {
  if (!current || !Array.isArray(current.questions)) return;

  let correctCount = 0;
  const blocks = current.questions.map((q, qi) => {
    const selectedEl = document.querySelector(`input[name="q${qi}"]:checked`);
    const selected = Number(selectedEl?.value);
    const correct = Number(q.answer_index);
    const isCorrect = selected === correct;
    if (isCorrect) correctCount++;

    return `
      <div class="review-card ${isCorrect ? "review-correct" : "review-wrong"}">
        <div class="question-title">Q${qi + 1}. ${escapeHtml(q.question)}</div>
        <p><strong>Your answer:</strong> ${String.fromCharCode(65 + selected)}. ${escapeHtml(q.options[selected])}</p>
        <p><strong>Correct:</strong> ${String.fromCharCode(65 + correct)}. ${escapeHtml(q.options[correct])}</p>
        <p class="explanation-ja">${escapeHtml(q.explanation_ja || "")}</p>
      </div>
    `;
  }).join("");

  const score = Math.round((correctCount / current.questions.length) * 100);
  $("score").textContent = `${correctCount}/3`;
  $("scoreLabel").textContent = "Comprehension score";
  $("scoreMsg").textContent =
    correctCount === 3 ? "Excellent! 内容をよく理解できています。" :
    correctCount === 2 ? "Good! もう一度聞くとさらに定着します。" :
    correctCount === 1 ? "スクリプトを確認して、もう一度聞いてみましょう。" :
    "まずスクリプトを確認してから聞き直してみましょう。";

  $("dictationResult").classList.add("hidden");
  $("mcqResult").classList.remove("hidden");
  $("mcqResult").innerHTML = blocks;
  $("coachBox").classList.add("hidden");
  $("correctAnswer").textContent = current.sentence;
  $("translation").textContent = current.translation;
  $("tip").textContent = current.listening_tip;
  $("result").classList.remove("hidden");

  // 回答後は選択肢を固定する。
  $("questions").querySelectorAll('input[type="radio"]').forEach(x => x.disabled = true);
  mcqCheckBtn.disabled = true;

  completed++;
  $("count").textContent = completed;
}

document.querySelectorAll(".speed").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".speed").forEach(x => x.classList.remove("active"));
    btn.classList.add("active");
    speed = Number(btn.dataset.speed);
  });
});

$("mode").addEventListener("change", updateModeUI);
newBtn.addEventListener("click", makeExercise);
playBtn.addEventListener("click", playSpeech);
checkBtn.addEventListener("click", checkAnswer);
mcqCheckBtn.addEventListener("click", checkMcq);
$("replayBtn").addEventListener("click", playSpeech);
$("nextBtn").addEventListener("click", makeExercise);

answer.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key === "Enter" && !checkBtn.disabled) checkAnswer();
});

updateModeUI();

// admin.js - 管理画面
// ・票数表示
// ・理解度バランス％表示（青線）
// ・投票率％表示（緑線）
// ・コメント一覧
// ・テーマ設定
// ・想定投票人数
// ・投票リセット＋前回グラフ保存＋前回の最終値から継続

// 簡易パスワード
const ADMIN_PASSWORD = "admin123";

const lockScreen = document.getElementById("lock-screen");
const adminContent = document.getElementById("admin-content");
const pwInput = document.getElementById("admin-password");
const btnUnlock = document.getElementById("btn-unlock");
const lockMsg = document.getElementById("lock-message");

const numUnderstood = document.getElementById("num-understood");
const numNotUnderstood = document.getElementById("num-not-understood");
const numTotal = document.getElementById("num-total");
const rateUnderstood = document.getElementById("rate-understood");

const canvas = document.getElementById("sineCanvas");
const ctx = canvas.getContext("2d");

const commentList = document.getElementById("comment-list");
const timeIndicator = document.getElementById("time-indicator");

const maxInput = document.getElementById("max-participants-input");
const btnSaveMax = document.getElementById("btn-save-max");
const maxInfo = document.getElementById("max-participants-info");

const btnReset = document.getElementById("btn-reset");

const themeInput = document.getElementById("theme-input");
const btnSaveTheme = document.getElementById("btn-save-theme");
const themeInfo = document.getElementById("theme-info");

// 前回リセットまでのグラフ表示用（小さめの別キャンバス）
const prevCanvas = document.getElementById("prevChart");
const prevCtx = prevCanvas ? prevCanvas.getContext("2d") : null;
const prevNote = document.getElementById("prevChart-note");

// ========= 折れ線グラフ用の状態 =========

// 現在セッションの履歴データ
// 例: { ts: 173…, score: 60, voteRate: 40 }
let history = [];

// 前回リセットまでの履歴（理解度バランスのみ）
let prevHistory = [];

// アニメーション開始済みフラグ
let animationStarted = false;

// ========= 結果取得（1秒ごと） =========

async function fetchResults() {
  try {
    const res = await fetch("/api/results");
    if (!res.ok) {
      throw new Error("failed to fetch results");
    }
    const data = await res.json();

    const u = data.understood || 0;
    const n = data.notUnderstood || 0;
    const total = data.total || 0;
    const maxP = data.maxParticipants ?? 0;
    const theme = data.theme || "";

    numUnderstood.textContent = u;
    numNotUnderstood.textContent = n;
    numTotal.textContent = total;

    // ===== 表示用の「理解率％」（サマリーカード） =====
    // → ここは従来どおり「理解できた ÷ (理解＋わからない)」
    let rateDisplay;
    if (total > 0) {
      rateDisplay = Math.round((u / total) * 100);
    } else {
      rateDisplay = 0;
    }
    rateUnderstood.textContent = rateDisplay + "%";

    // ===== 緑線：投票率％（0〜100） =====
    // 想定人数が設定されている場合 → (理解+不理解) / 想定人数
    // 想定人数が0で投票がある場合 → 全員投票済みとみなし 100%
    let voteRate;
    if (maxP > 0) {
      voteRate = Math.round(((u + n) / maxP) * 100);
      voteRate = Math.min(100, Math.max(0, voteRate));
    } else if (total > 0) {
      voteRate = 100;
    } else if (history.length > 0) {
      voteRate = history[history.length - 1].voteRate;
    } else {
      voteRate = 0;
    }

    // ===== 青線：理解度バランス％（0〜100） =====
    // 50% を「中立」とし、
    // ・全員「理解できた」 → 100%
    // ・全員「あまり理解できなかった」 → 0%
    // ・半々 → 50%
    // 想定人数があれば分母は maxP、なければ total
    let score;
    if (maxP > 0) {
      const diff = u - n; // 理解 − 不理解
      score = Math.round(50 + (diff / maxP) * 50);
      score = Math.min(100, Math.max(0, score));
    } else if (total > 0) {
      const diff = u - n;
      score = Math.round(50 + (diff / total) * 50);
      score = Math.min(100, Math.max(0, score));
    } else if (history.length > 0) {
      score = history[history.length - 1].score;
    } else {
      score = 50; // 投票なしのときは中立
    }

    // 想定投票人数（管理者が入力中のときは上書きしない）
    if (maxInput && document.activeElement !== maxInput) {
      maxInput.value = maxP;
    }
    if (maxInfo) {
      if (maxP > 0) {
        maxInfo.textContent = `想定人数：${maxP}人中、${total}人が投票済み（投票率：${voteRate}%）`;
      } else {
        maxInfo.textContent = "想定人数は未設定です（0人）";
      }
    }

    // テーマ表示
    if (themeInfo) {
      themeInfo.textContent = theme
        ? `現在のテーマ：${theme}`
        : "現在のテーマ：未設定";
    }
    if (themeInput && document.activeElement !== themeInput) {
      themeInput.value = theme;
    }

    // コメント描画
    renderComments(data.comments || []);

    // グラフ用の履歴に追加
    addPoint(score, voteRate);
    if (!animationStarted) {
      animationStarted = true;
      requestAnimationFrame(drawLineChart);
    }

    // 現在時刻
    updateTimeLabel();
  } catch (e) {
    console.error(e);
  }
}

// ========= 折れ線グラフ用の関数 =========

// 履歴に1点追加（同じ値が続くときは追加しない）
function addPoint(score, voteRate) {
  const now = Date.now();
  const last = history[history.length - 1];

  if (last && last.score === score && last.voteRate === voteRate) return;

  history.push({ ts: now, score, voteRate });

  // 直近200点だけ残す
  if (history.length > 200) {
    history = history.slice(-200);
  }
}

// 折れ線グラフ描画（現在セッション）
function drawLineChart() {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (history.length === 0) {
    ctx.fillStyle = "#666";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("まだ投票データがありません。", w / 2, h / 2);
    requestAnimationFrame(drawLineChart);
    return;
  }

  // 余白
  const paddingLeft = 50;
  const paddingRight = 10;
  const paddingTop = 20;
  const paddingBottom = 48;

  const plotWidth = w - paddingLeft - paddingRight;
  const plotHeight = h - paddingTop - paddingBottom;

  // 軸
  ctx.strokeStyle = "#ccc";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(paddingLeft, paddingTop);
  ctx.lineTo(paddingLeft, h - paddingBottom);
  ctx.lineTo(w - paddingRight, h - paddingBottom);
  ctx.stroke();

  // Y軸（0,25,50,75,100%）
  ctx.fillStyle = "#999";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  [0, 25, 50, 75, 100].forEach((v) => {
    const y = h - paddingBottom - (v / 100) * plotHeight;
    ctx.fillText(v + "%", paddingLeft - 6, y);
    ctx.strokeStyle = "#eee";
    ctx.beginPath();
    ctx.moveTo(paddingLeft, y);
    ctx.lineTo(w - paddingRight, y);
    ctx.stroke();
  });

  // X座標
  const n = history.length;
  const stepX = n > 1 ? plotWidth / (n - 1) : 0;

  // ===== 青線：理解度バランス（0〜100、50が中立） =====
  ctx.strokeStyle = "#1976d2";
  ctx.lineWidth = 2;
  ctx.beginPath();
  history.forEach((p, i) => {
    const x = paddingLeft + stepX * i;
    const y = h - paddingBottom - (p.score / 100) * plotHeight;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // ===== 緑線：投票率（0〜100） =====
  ctx.strokeStyle = "#4caf50";
  ctx.lineWidth = 2;
  ctx.beginPath();
  history.forEach((p, i) => {
    const x = paddingLeft + stepX * i;
    const y = h - paddingBottom - (p.voteRate / 100) * plotHeight;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // 時間ラベル（直近5秒は秒単位、その後は5秒／10秒単位）
  ctx.fillStyle = "#555";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const nowMs = Date.now();
  let prevLabelKey = null;

  history.forEach((p, i) => {
    const x = paddingLeft + stepX * i;
    const ts = p.ts;
    const age = nowMs - ts;
    const d = new Date(ts);

    let label = "";
    let labelKey = "";

    if (age <= 5000) {
      // 直近5秒 → 秒単位
      label = d.toLocaleTimeString("ja-JP", { hour12: false });
      labelKey = "sec-" + label;
    } else if (age <= 10000) {
      // 5〜10秒 → 5秒刻み
      const sec = Math.floor(d.getSeconds() / 5) * 5;
      label =
        `${d.getHours().toString().padStart(2, "0")}:` +
        `${d.getMinutes().toString().padStart(2, "0")}:` +
        `${sec.toString().padStart(2, "0")}`;
      labelKey = "5sec-" + label;
    } else {
      // 10秒以上 → 10秒刻み
      const sec = Math.floor(d.getSeconds() / 10) * 10;
      label =
        `${d.getHours().toString().padStart(2, "0")}:` +
        `${d.getMinutes().toString().padStart(2, "0")}:` +
        `${sec.toString().padStart(2, "0")}`;
      labelKey = "10sec-" + label;
    }

    if (labelKey !== prevLabelKey) {
      ctx.fillText(label, x, h - paddingBottom + 4);
      prevLabelKey = labelKey;
    }
  });

  // タイトル
  ctx.fillStyle = "#888";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(
    "理解度バランス（青：50%が中立）と投票率（緑）の推移",
    paddingLeft + plotWidth / 2,
    paddingTop - 5
  );

  requestAnimationFrame(drawLineChart);
}

// ========= 前回セッションのグラフ描画 =========

function drawPrevChart() {
  if (!prevCanvas || !prevCtx) return;

  const w = prevCanvas.width;
  const h = prevCanvas.height;
  prevCtx.clearRect(0, 0, w, h);

  if (!prevHistory || prevHistory.length === 0) {
    if (prevNote) {
      prevNote.textContent = "まだ前回分のグラフはありません。";
    }
    return;
  }

  if (prevNote) {
    prevNote.textContent =
      "前回リセットまでの理解度バランス（青線：0〜100%、50%が中立）";
  }

  const paddingLeft = 40;
  const paddingRight = 10;
  const paddingTop = 15;
  const paddingBottom = 25;

  const plotWidth = w - paddingLeft - paddingRight;
  const plotHeight = h - paddingTop - paddingBottom;

  // 軸
  prevCtx.strokeStyle = "#ccc";
  prevCtx.lineWidth = 1;
  prevCtx.beginPath();
  prevCtx.moveTo(paddingLeft, paddingTop);
  prevCtx.lineTo(paddingLeft, h - paddingBottom);
  prevCtx.lineTo(w - paddingRight, h - paddingBottom);
  prevCtx.stroke();

  // Y軸
  prevCtx.fillStyle = "#999";
  prevCtx.font = "9px sans-serif";
  prevCtx.textAlign = "right";
  prevCtx.textBaseline = "middle";
  [0, 25, 50, 75, 100].forEach((v) => {
    const y = h - paddingBottom - (v / 100) * plotHeight;
    prevCtx.fillText(v + "%", paddingLeft - 4, y);
    prevCtx.strokeStyle = "#eee";
    prevCtx.beginPath();
    prevCtx.moveTo(paddingLeft, y);
    prevCtx.lineTo(w - paddingRight, y);
    prevCtx.stroke();
  });

  const n = prevHistory.length;
  const stepX = n > 1 ? plotWidth / (n - 1) : 0;

  // 折れ線（前回分の理解度バランス）
  prevCtx.strokeStyle = "#90caf9";
  prevCtx.lineWidth = 2;
  prevCtx.beginPath();
  prevHistory.forEach((p, i) => {
    const x = paddingLeft + stepX * i;
    const y = h - paddingBottom - (p.score / 100) * plotHeight;
    if (i === 0) prevCtx.moveTo(x, y);
    else prevCtx.lineTo(x, y);
  });
  prevCtx.stroke();
}

// ========= コメント表示 =========

function renderComments(comments) {
  commentList.innerHTML = "";
  if (!comments || comments.length === 0) {
    const p = document.createElement("p");
    p.className = "small-note";
    p.textContent = "まだコメントはありません。";
    commentList.appendChild(p);
    return;
  }

  const reversed = [...comments].reverse();

  reversed.forEach((c) => {
    const item = document.createElement("div");
    item.className = "comment-item";

    const meta = document.createElement("div");
    meta.className = "comment-meta";

    const tag = document.createElement("span");
    tag.className =
      "comment-tag " +
      (c.choice === "understood" ? "understood" : "not-understood");
    tag.textContent =
      c.choice === "understood" ? "理解できた" : "あまり理解できなかった";

    const time = document.createElement("span");
    let timeText = "";
    try {
      timeText = new Date(c.ts).toLocaleString("ja-JP");
    } catch (e) {
      timeText = c.ts || "";
    }
    time.textContent = timeText;

    meta.appendChild(tag);
    meta.appendChild(time);

    const body = document.createElement("div");
    body.textContent = c.text || "";

    item.appendChild(meta);
    item.appendChild(body);

    commentList.appendChild(item);
  });
}

// ========= 時刻表示 =========

function updateTimeLabel() {
  if (!timeIndicator) return;
  const now = new Date();
  const text = now.toLocaleTimeString("ja-JP", { hour12: false });
  timeIndicator.textContent = `現在時刻：${text}`;
}

// ========= 想定投票人数の保存 =========

if (btnSaveMax && maxInput) {
  btnSaveMax.addEventListener("click", async () => {
    const raw = maxInput.value;
    const num = Number(raw);

    if (!Number.isFinite(num) || num < 0 || num > 100) {
      alert("0〜100 の範囲で人数を入力してください。");
      return;
    }

    try {
      const res = await fetch("/api/admin/max-participants", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ maxParticipants: num })
      });

      if (!res.ok) {
        throw new Error("failed to update max participants");
      }

      const data = await res.json();
      if (maxInfo) {
        maxInfo.textContent = `想定人数：${data.maxParticipants}人中、現在 ${numTotal.textContent}人が投票済み`;
      }
      alert("想定投票人数を保存しました。");
    } catch (e) {
      console.error(e);
      alert("想定人数の保存に失敗しました。時間をおいて再度お試しください。");
    }
  });
}

// ========= テーマの保存 =========

if (btnSaveTheme && themeInput) {
  btnSaveTheme.addEventListener("click", async () => {
    const theme = themeInput.value.trim();

    try {
      const res = await fetch("/api/admin/theme", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ theme })
      });

      if (!res.ok) {
        throw new Error("failed to save theme");
      }

      const data = await res.json();
      if (themeInfo) {
        themeInfo.textContent = data.theme
          ? `現在のテーマ：${data.theme}`
          : "現在のテーマ：未設定";
      }
      alert("テーマを保存しました。");
    } catch (e) {
      console.error(e);
      alert("テーマの保存に失敗しました。");
    }
  });
}

// ========= 投票リセット =========

if (btnReset) {
  btnReset.addEventListener("click", async () => {
    const ok = confirm("本当に全ての投票・コメント・履歴をリセットしますか？");
    if (!ok) return;

    try {
      // ★ リセット前の履歴を退避して小さいグラフに表示（理解度バランスだけ）
      prevHistory = history.map((p) => ({
        ts: p.ts,
        score: p.score
      }));
      drawPrevChart();

      // ★ 最終値を保持（なければデフォルト）
      const last = history[history.length - 1];
      const lastScore = last ? last.score : 50;
      const lastVoteRate = last ? last.voteRate : 0;

      // サーバー側リセット
      const res = await fetch("/api/admin/reset", {
        method: "POST"
      });

      if (!res.ok) {
        throw new Error("failed to reset");
      }

      // ★ 現在セッションの履歴は一旦クリアし、
      //   「前回の最終値」から新しい時間軸でスタート
      history = [];
      history.push({
        ts: Date.now(),
        score: lastScore,
        voteRate: lastVoteRate
      });

      await fetchResults();
      alert("投票データをリセットしました。（グラフは前回の最終値から継続します）");
    } catch (e) {
      console.error(e);
      alert("リセットに失敗しました。時間をおいて再度お試しください。");
    }
  });
}

// ========= ロック画面（パスワード） =========

btnUnlock.addEventListener("click", () => {
  const input = pwInput.value.trim();
  if (input === ADMIN_PASSWORD) {
    lockScreen.style.display = "none";
    adminContent.style.display = "block";

    // 初回取得
    fetchResults();
    // 1秒ごとに更新
    setInterval(fetchResults, 1000);

    // グラフ描画開始（まだなら）
    if (!animationStarted) {
      animationStarted = true;
      requestAnimationFrame(drawLineChart);
    }

    // 前回グラフがあれば描画
    drawPrevChart();
  } else {
    lockMsg.textContent = "パスワードが違います。";
  }
});

// Enterキーでも解錠
pwInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    btnUnlock.click();
  }
});


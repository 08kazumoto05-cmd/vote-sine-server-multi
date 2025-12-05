// admin.js - 管理画面
// 線は1本のみ
// 式：
//   想定人数 > 0 のとき   (理解できた − 理解できなかった) ÷ 想定人数 ×100
//   想定人数 = 0 のとき   (理解できた − 理解できなかった) ÷ (理解+不理解) ×100
// マイナスは0にクリップ、100超えは100
// リセット回数：0回 → 青 / 1回 → 赤 / 2回以上 → 緑

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

// 前回グラフ用
const prevCanvas = document.getElementById("prevChart");
const prevCtx = prevCanvas ? prevCanvas.getContext("2d") : null;
const prevNote = document.getElementById("prevChart-note");

let history = [];      // 現在セッション { ts, rate }
let prevHistory = [];  // 前回セッション { ts, rate }
let animationStarted = false;

// ★ 何回「投票データをリセット」したか（ページを開いている間だけ記憶）
let resetCount = 0;


// ================= 結果取得 =================

async function fetchResults() {
  try {
    const res = await fetch("/api/results");
    if (!res.ok) throw new Error("failed to fetch results");

    const data = await res.json();

    const u = data.understood || 0;
    const n = data.notUnderstood || 0;
    const total = u + n;
    const maxP = data.maxParticipants ?? 0;
    const theme = data.theme || "";

    numUnderstood.textContent = u;
    numNotUnderstood.textContent = n;
    numTotal.textContent = total;

    // 表示用（従来の理解率）
    rateUnderstood.textContent =
      total > 0 ? Math.round((u / total) * 100) + "%" : "0%";

    // ======== グラフ用 1本線の計算 ========
    let rate;

    if (total === 0) {
      // まだ投票が無い
      rate = 0;
    } else if (maxP > 0) {
      // 想定人数を分母
      rate = Math.round(((u - n) / maxP) * 100);
    } else {
      // 想定人数が未設定 → 実投票数を分母
      rate = Math.round(((u - n) / total) * 100);
    }

    // 0〜100 にクリップ（マイナスは0）
    if (rate < 0) rate = 0;
    if (rate > 100) rate = 100;

    // 想定人数 UI
    if (document.activeElement !== maxInput) {
      maxInput.value = maxP;
    }

    maxInfo.textContent =
      maxP > 0
        ? `想定人数：${maxP}人中、${total}人が投票済み`
        : "想定人数は未設定です（0人）";

    // テーマ UI
    themeInfo.textContent = theme
      ? `現在のテーマ：${theme}`
      : "現在のテーマ：未設定";
    if (document.activeElement !== themeInput) {
      themeInput.value = theme;
    }

    // コメント描画
    renderComments(data.comments || []);

    // 履歴追加
    addRatePoint(rate);

    if (!animationStarted) {
      animationStarted = true;
      requestAnimationFrame(drawLineChart);
    }

    updateTimeLabel();
  } catch (e) {
    console.error(e);
  }
}


// ================= 履歴管理 =================

function addRatePoint(rate) {
  const now = Date.now();
  const last = history[history.length - 1];

  // 同じ値が続くなら追加しない
  if (last && last.rate === rate) return;

  history.push({ ts: now, rate });

  if (history.length > 200) {
    history = history.slice(-200);
  }
}


// ================= グラフ描画（現在セッション：1本線） =================

function drawLineChart() {
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  if (history.length === 0) {
    ctx.fillStyle = "#777";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("まだ投票データがありません。", w / 2, h / 2);
    requestAnimationFrame(drawLineChart);
    return;
  }

  const L = 50, R = 10, T = 20, B = 48;
  const plotW = w - L - R;
  const plotH = h - T - B;

  // 軸
  ctx.strokeStyle = "#ccc";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(L, T);
  ctx.lineTo(L, h - B);
  ctx.lineTo(w - R, h - B);
  ctx.stroke();

  // Y目盛
  ctx.fillStyle = "#666";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  [0, 25, 50, 75, 100].forEach((v) => {
    const y = h - B - (v / 100) * plotH;
    ctx.fillText(v + "%", L - 6, y);
    ctx.strokeStyle = "#eee";
    ctx.beginPath();
    ctx.moveTo(L, y);
    ctx.lineTo(w - R, y);
    ctx.stroke();
  });

  // X方向
  const n = history.length;
  const stepX = n > 1 ? plotW / (n - 1) : 0;

  // ★ リセット回数で色を変える
  let lineColor = "#1976d2"; // 初期：青
  if (resetCount === 1) {
    lineColor = "#e53935";  // 1回目リセット後：赤
  } else if (resetCount >= 2) {
    lineColor = "#43a047";  // 2回目以降：緑
  }

  // 青/赤/緑 の 1本線
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.beginPath();

  history.forEach((p, i) => {
    const x = L + i * stepX;
    const y = h - B - (p.rate / 100) * plotH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();

  // 時刻ラベル
  ctx.fillStyle = "#444";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const nowMs = Date.now();
  let lastKey = null;

  history.forEach((p, i) => {
    const x = L + i * stepX;
    const age = nowMs - p.ts;
    const d = new Date(p.ts);

    let label;
    if (age <= 5000) {
      label = d.toLocaleTimeString("ja-JP", { hour12: false });
    } else if (age <= 10000) {
      const sec = Math.floor(d.getSeconds() / 5) * 5;
      label =
        `${String(d.getHours()).padStart(2, "0")}:` +
        `${String(d.getMinutes()).padStart(2, "0")}:` +
        `${String(sec).padStart(2, "0")}`;
    } else {
      const sec = Math.floor(d.getSeconds() / 10) * 10;
      label =
        `${String(d.getHours()).padStart(2, "0")}:` +
        `${String(d.getMinutes()).padStart(2, "0")}:` +
        `${String(sec).padStart(2, "0")}`;
    }

    if (label !== lastKey) {
      ctx.fillText(label, x, h - B + 4);
      lastKey = label;
    }
  });

  ctx.font = "12px sans-serif";
  ctx.fillStyle = "#666";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(
    "理解度(理解 − 不理解) の推移（想定人数が0のときは投票人数を分母）",
    L + plotW / 2,
    T - 5
  );

  requestAnimationFrame(drawLineChart);
}


// ================= 前回セッションのグラフ描画 =================

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
    prevNote.textContent = "前回リセットまでの理解度推移（理解 − 不理解）";
  }

  const L = 40, R = 10, T = 15, B = 25;
  const plotW = w - L - R;
  const plotH = h - T - B;

  // 軸
  prevCtx.strokeStyle = "#ccc";
  prevCtx.lineWidth = 1;
  prevCtx.beginPath();
  prevCtx.moveTo(L, T);
  prevCtx.lineTo(L, h - B);
  prevCtx.lineTo(w - R, h - B);
  prevCtx.stroke();

  // Y軸
  prevCtx.fillStyle = "#999";
  prevCtx.font = "9px sans-serif";
  prevCtx.textAlign = "right";
  prevCtx.textBaseline = "middle";

  [0, 25, 50, 75, 100].forEach((v) => {
    const y = h - B - (v / 100) * plotH;
    prevCtx.fillText(v + "%", L - 4, y);
    prevCtx.strokeStyle = "#eee";
    prevCtx.beginPath();
    prevCtx.moveTo(L, y);
    prevCtx.lineTo(w - R, y);
    prevCtx.stroke();
  });

  const n = prevHistory.length;
  const stepX = n > 1 ? plotW / (n - 1) : 0;

  // 線（前回分は淡い青）
  prevCtx.strokeStyle = "#90caf9";
  prevCtx.lineWidth = 2;
  prevCtx.beginPath();

  prevHistory.forEach((p, i) => {
    const x = L + i * stepX;
    const y = h - B - (p.rate / 100) * plotH;
    if (i === 0) prevCtx.moveTo(x, y);
    else prevCtx.lineTo(x, y);
  });

  prevCtx.stroke();
}


// ================= コメント表示 =================

function renderComments(comments) {
  commentList.innerHTML = "";

  if (!comments || comments.length === 0) {
    const p = document.createElement("p");
    p.textContent = "まだコメントはありません。";
    p.className = "small-note";
    commentList.appendChild(p);
    return;
  }

  comments
    .slice()
    .reverse()
    .forEach((c) => {
      const item = document.createElement("div");
      item.className = "comment-item";

      const meta = document.createElement("div");
      meta.className = "comment-meta";

      const tag = document.createElement("span");
      tag.className =
        "comment-tag " +
        (c.choice === "understood" ? "understood" : "not-understood");
      tag.textContent =
        c.choice === "understood" ? "理解できた" : "理解できなかった";

      const time = document.createElement("span");
      time.textContent = new Date(c.ts).toLocaleString("ja-JP");

      meta.appendChild(tag);
      meta.appendChild(time);

      const body = document.createElement("div");
      body.textContent = c.text || "";

      item.appendChild(meta);
      item.appendChild(body);

      commentList.appendChild(item);
    });
}


// ================= 時刻表示 =================

function updateTimeLabel() {
  timeIndicator.textContent =
    "現在時刻：" +
    new Date().toLocaleTimeString("ja-JP", { hour12: false });
}


// ================= 想定人数保存 =================

if (btnSaveMax) {
  btnSaveMax.addEventListener("click", async () => {
    const num = Number(maxInput.value);

    if (!Number.isFinite(num) || num < 0 || num > 100) {
      alert("0〜100 の範囲で人数を入力してください。");
      return;
    }

    await fetch("/api/admin/max-participants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxParticipants: num }),
    });

    alert("想定投票人数を保存しました。");
  });
}


// ================= テーマ保存 =================

if (btnSaveTheme) {
  btnSaveTheme.addEventListener("click", async () => {
    const theme = themeInput.value.trim();

    await fetch("/api/admin/theme", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme }),
    });

    alert("テーマを保存しました。");
  });
}


// ================= 投票リセット =================

if (btnReset) {
  btnReset.addEventListener("click", async () => {
    const ok = confirm("本当に全ての投票・コメント・履歴をリセットしますか？");
    if (!ok) return;

    try {
      // リセット前の履歴を前回グラフ用に退避
      prevHistory = history.map((p) => ({
        ts: p.ts,
        rate: p.rate,
      }));
      drawPrevChart();

      // サーバー側リセット
      const res = await fetch("/api/admin/reset", { method: "POST" });
      if (!res.ok) throw new Error("failed to reset");

      // 現在セッションの履歴はクリア → 線が消える
      history = [];

      // ★ リセット回数をカウントアップ
      resetCount += 1;

      // 表示を最新に
      await fetchResults();

      alert("投票データをリセットしました。");
    } catch (e) {
      console.error(e);
      alert("リセットに失敗しました。時間をおいて再度お試しください。");
    }
  });
}


// ================= ログイン =================

btnUnlock.addEventListener("click", unlock);
pwInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") unlock();
});

function unlock() {
  if (pwInput.value.trim() !== ADMIN_PASSWORD) {
    lockMsg.textContent = "パスワードが違います。";
    return;
  }

  lockScreen.style.display = "none";
  adminContent.style.display = "block";

  fetchResults();
  setInterval(fetchResults, 1000);

  if (!animationStarted) {
    animationStarted = true;
    requestAnimationFrame(drawLineChart);
  }

  drawPrevChart();
}


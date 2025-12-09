// ===============================
// admin.js（大文字・太線・大キャンバス対応版）
// ===============================

// ● 全体改善ポイント
// ・軸フォント大型化（26〜30px）
// ・線の太さを統一して極太(6px)
// ・キャンバス高さ 1200px に最適化
// ・目盛り線も太く明確に
// ・セッション0スタート / 色A / 連結仕様 / 保存仕様はそのまま維持

const ADMIN_PASSWORD = "admin123";

// ===============================
// DOM 取得
// ===============================

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
const btnResetAll = document.getElementById("btn-reset-all");

const themeInput = document.getElementById("theme-input");
const btnSaveTheme = document.getElementById("btn-save-theme");
const themeInfo = document.getElementById("theme-info");

// 過去3セッション
const prevCanvases = [
  document.getElementById("prevChart1"),
  document.getElementById("prevChart2"),
  document.getElementById("prevChart3")
];
const prevNotes = [
  document.getElementById("prevChart-note1"),
  document.getElementById("prevChart-note2"),
  document.getElementById("prevChart-note3")
];
const prevRateLabels = [
  document.getElementById("prevChart-rate1"),
  document.getElementById("prevChart-rate2"),
  document.getElementById("prevChart-rate3")
];

const prevCtxs = prevCanvases.map(c => c ? c.getContext("2d") : null);

// 連結グラフ
const sessionChainCanvas = document.getElementById("sessionChain");
const sessionChainCtx = sessionChainCanvas ? sessionChainCanvas.getContext("2d") : null;


// ===============================
// 状態管理
// ===============================

let history = []; // 現在セッション
let prevSessions = []; // 過去3件
let resetCount = 0;

// セッション色（Aの指定）
const SESSION_COLORS = ["#4fc3f7", "#ff5252", "#66bb6a"];

// 描画ループフラグ
let animationStarted = false;


// ===============================
// ユーティリティ
// ===============================

function getCurrentColor() {
  return SESSION_COLORS[Math.min(resetCount, SESSION_COLORS.length - 1)];
}

// 値を Y 座標へ（太線用に幅を大きめに計算）
function valueToY(value, canvasHeight, bottomPadding, plotHeight) {
  let v = Math.max(0, Math.min(100, value));
  const ratio = v / 100;
  return canvasHeight - bottomPadding - ratio * plotHeight;
}
// ===============================
// 結果取得（サーバーから毎秒）
// ===============================
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

    const rateDisplay = total > 0 ? Math.round((u / total) * 100) : 0;
    rateUnderstood.textContent = rateDisplay + "%";

    let rate = null;
    if (maxP > 0) {
      if (total === 0 && history.length > 0) {
        rate = history[history.length - 1].rate;
      } else if (total === 0 && history.length === 0) {
        rate = null;
      } else {
        rate = ((u - n) / maxP) * 100;
        if (rate < 0) rate = 0;
        if (rate > 100) rate = 100;
      }
    }

    if (document.activeElement !== maxInput) {
      maxInput.value = maxP;
    }
    maxInfo.textContent =
      maxP > 0
        ? `想定人数：${maxP}人中、${total}人が投票済み`
        : "想定人数が未設定です（グラフは表示されません）";

    themeInfo.textContent = theme
      ? `現在のテーマ：${theme}`
      : "現在のテーマ：未設定";
    if (document.activeElement !== themeInput) {
      themeInput.value = theme;
    }

    renderComments(data.comments || []);
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

// ===============================
// 履歴追加
// ===============================
function addRatePoint(rate) {
  if (rate === null) return;
  const now = Date.now();

  const last = history[history.length - 1];
  if (last && last.rate === rate) return;

  history.push({ ts: now, rate });

  if (history.length > 300) {
    history = history.slice(-300);
  }
}

// ===============================
// 現在セッションのグラフ描画
// ★ 線太め（6px）・フォント大きめ（26px）
// ★ キャンバスは 1200px 高さ想定
// ===============================
function drawLineChart() {
  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);

  const maxP = Number(maxInput.value || "0");

  if (maxP <= 0) {
    ctx.fillStyle = "#ccc";
    ctx.font = "32px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("想定人数が未設定です。", w / 2, h / 2);
    requestAnimationFrame(drawLineChart);
    return;
  }

  if (history.length === 0) {
    ctx.fillStyle = "#ccc";
    ctx.font = "32px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("データがありません。", w / 2, h / 2);
    requestAnimationFrame(drawLineChart);
    return;
  }

  const L = 60, R = 40, T = 40, B = 80;
  const plotW = w - L - R;
  const plotH = h - T - B;

  // 外枠
  ctx.strokeStyle = "#FFF";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(L, T);
  ctx.lineTo(L, h - B);
  ctx.lineTo(w - R, h - B);
  ctx.stroke();

  // 目盛り
  const yTicks = [0, 25, 50, 75, 100];
  ctx.font = "28px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  yTicks.forEach(v => {
    const y = valueToY(v, h, B, plotH);

    ctx.strokeStyle = v === 0 ? "#FFF" : "#666";
    ctx.lineWidth = v === 0 ? 4 : 2;
    ctx.setLineDash(v === 0 ? [] : [10, 10]);

    ctx.beginPath();
    ctx.moveTo(L, y);
    ctx.lineTo(w - R, y);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = "#FFF";
    ctx.fillText(v + "%", L - 10, y);
  });

  const stepX = history.length > 1 ? plotW / (history.length - 1) : 0;

  ctx.strokeStyle = getCurrentColor();
  ctx.lineWidth = 6;
  ctx.setLineDash([]);
  ctx.beginPath();

  history.forEach((p, i) => {
    const disp = i === 0 ? 0 : p.rate;
    const x = L + i * stepX;
    const y = valueToY(disp, h, B, plotH);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();

  ctx.font = "32px sans-serif";
  ctx.fillStyle = "#FFF";
  ctx.textAlign = "left";
  ctx.fillText("現在セッション理解度推移（0〜100%）", L, T - 30);

  requestAnimationFrame(drawLineChart);
}
// ===============================
// 過去セッションのグラフ描画（大サイズ版）
// ★ キャンバスは 1000×200 → 実表示 2倍（CSS拡大前提）
// ★ 線太め 5px、フォント28px
// ★ 1点目は 0スタート
// ★ 右側に最終理解度％を表示
// ===============================

function drawPrevSessions() {
  for (let i = 0; i < 3; i++) {
    const session = prevSessions[i];
    const c = prevCanvases[i];
    const note = prevNotes[i];
    const rateLabel = prevRateLabels[i];
    const pctx = prevCtxs[i];

    if (!c || !pctx) continue;

    const w = c.width;
    const h = c.height;

    pctx.fillStyle = "#000";
    pctx.fillRect(0, 0, w, h);

    if (!session || !session.points || session.points.length === 0) {
      const label = i === 0 ? "1つ前" : i === 1 ? "2つ前" : "3つ前";
      note.textContent = `${label}のセッション：まだグラフはありません。`;
      rateLabel.textContent = "";
      continue;
    }

    const hist = session.points;
    const color = session.color;

    const label = i === 0 ? "1つ前" : i === 1 ? "2つ前" : "3つ前";
    note.textContent = `${label}のセッション：理解度推移`;

    // 最終理解度表示
    const lastRate = Math.max(0, Math.min(100, hist[hist.length - 1].rate));
    rateLabel.textContent = `（最終理解度：${Math.round(lastRate)}%）`;

    const L = 60, R = 40, T = 40, B = 60;
    const plotW = w - L - R;
    const plotH = h - T - B;

    // 外枠
    pctx.strokeStyle = "#FFF";
    pctx.lineWidth = 4;
    pctx.beginPath();
    pctx.moveTo(L, T);
    pctx.lineTo(L, h - B);
    pctx.lineTo(w - R, h - B);
    pctx.stroke();

    // Y軸目盛（0〜100）
    const yTicks = [0, 25, 50, 75, 100];
    pctx.font = "26px sans-serif";
    pctx.textAlign = "right";
    pctx.textBaseline = "middle";

    yTicks.forEach(v => {
      const y = valueToY(v, h, B, plotH);

      pctx.strokeStyle = v === 0 ? "#FFF" : "#666";
      pctx.lineWidth = v === 0 ? 4 : 2;
      pctx.setLineDash(v === 0 ? [] : [10, 10]);

      pctx.beginPath();
      pctx.moveTo(L, y);
      pctx.lineTo(w - R, y);
      pctx.stroke();

      pctx.setLineDash([]);
      pctx.fillStyle = "#FFF";
      pctx.fillText(v + "%", L - 10, y);
    });

    // X補助線
    pctx.strokeStyle = "#666";
    pctx.lineWidth = 2;
    pctx.setLineDash([10, 10]);
    [0.25, 0.5, 0.75].forEach(r => {
      const x = L + plotW * r;
      pctx.beginPath();
      pctx.moveTo(x, T);
      pctx.lineTo(x, h - B);
      pctx.stroke();
    });
    pctx.setLineDash([]);

    // 線の描画（太線 5px）
    const stepX = hist.length > 1 ? plotW / (hist.length - 1) : 0;

    pctx.strokeStyle = color;
    pctx.lineWidth = 5;
    pctx.beginPath();

    hist.forEach((p, idx) => {
      const disp = idx === 0 ? 0 : p.rate;
      let clipped = Math.max(0, Math.min(100, disp));
      const x = L + idx * stepX;
      const y = valueToY(clipped, h, B, plotH);

      if (idx === 0) pctx.moveTo(x, y);
      else pctx.lineTo(x, y);
    });

    pctx.stroke();
  }
}
// =====================================
// セッション1〜3 連結グラフ（巨大版）
// ・キャンバス 1800×1200 を想定
// ・線：太め 6px
// ・フォント：30px
// ・前セッションの終点と次のセッション開始が “完全にズレなく結合”
// =====================================

function drawSessionChain() {
  if (!sessionChainCanvas || !sessionChainCtx) return;

  const w = sessionChainCanvas.width;
  const h = sessionChainCanvas.height;

  sessionChainCtx.fillStyle = "#000";
  sessionChainCtx.fillRect(0, 0, w, h);

  // 最新→古い順 → 古い順に並べ替え
  const sessionsNewest = prevSessions.slice(0, 3);
  const sessions = sessionsNewest
    .slice()
    .reverse()
    .filter(s => s && s.points && s.points.length > 0);

  if (sessions.length === 0) {
    sessionChainCtx.fillStyle = "#CCC";
    sessionChainCtx.font = "40px sans-serif";
    sessionChainCtx.textAlign = "center";
    sessionChainCtx.textBaseline = "middle";
    sessionChainCtx.fillText("まだセッションがありません", w / 2, h / 2);
    return;
  }

  const totalPoints = sessions.reduce(
    (sum, s) => sum + (s.points ? s.points.length : 0),
    0
  );
  if (totalPoints < 2) return;

  // 大きな余白（太軸向け）
  const L = 120, R = 80, T = 120, B = 150;
  const plotW = w - L - R;
  const plotH = h - T - B;

  // ---- 外枠 ----
  sessionChainCtx.strokeStyle = "#FFF";
  sessionChainCtx.lineWidth = 6;
  sessionChainCtx.setLineDash([]);
  sessionChainCtx.beginPath();
  sessionChainCtx.moveTo(L, T);
  sessionChainCtx.lineTo(L, h - B);
  sessionChainCtx.lineTo(w - R, h - B);
  sessionChainCtx.stroke();

  // ---- Y軸 ----
  const yTicks = [0, 25, 50, 75, 100];
  sessionChainCtx.font = "30px sans-serif";
  sessionChainCtx.textAlign = "right";
  sessionChainCtx.textBaseline = "middle";

  yTicks.forEach(v => {
    const y = valueToY(v, h, B, plotH);

    sessionChainCtx.strokeStyle = v === 0 ? "#FFF" : "#666";
    sessionChainCtx.lineWidth = v === 0 ? 6 : 3;
    sessionChainCtx.setLineDash(v === 0 ? [] : [20, 20]);

    sessionChainCtx.beginPath();
    sessionChainCtx.moveTo(L, y);
    sessionChainCtx.lineTo(w - R, y);
    sessionChainCtx.stroke();

    sessionChainCtx.setLineDash([]);
    sessionChainCtx.fillStyle = "#FFF";
    sessionChainCtx.fillText(v + "%", L - 20, y);
  });

  // ---- X補助線 ----
  sessionChainCtx.strokeStyle = "#666";
  sessionChainCtx.lineWidth = 3;
  sessionChainCtx.setLineDash([20, 20]);
  [0.25, 0.5, 0.75].forEach(r => {
    const x = L + plotW * r;
    sessionChainCtx.beginPath();
    sessionChainCtx.moveTo(x, T);
    sessionChainCtx.lineTo(x, h - B);
    sessionChainCtx.stroke();
  });
  sessionChainCtx.setLineDash([]);

  // ---- 線描画 ----
  const stepX = totalPoints > 1 ? plotW / (totalPoints - 1) : 0;
  let globalIndex = 0;
  let lastAdjRate = null;
  let lastX = null;
  let lastY = null;

  sessions.forEach((session, idxS) => {
    const hist = session.points;
    if (!hist || hist.length === 0) return;

    const firstRateOrig = Math.max(0, Math.min(100, hist[0].rate));

    // ★ 前のセッション最終点とピッタリつなぐ補正値
    let offset = 0;
    if (idxS > 0 && lastAdjRate != null) {
      offset = lastAdjRate - firstRateOrig;
    }

    const color = session.color || SESSION_COLORS[idxS];

    sessionChainCtx.strokeStyle = color;
    sessionChainCtx.lineWidth = 6;
    sessionChainCtx.beginPath();

    hist.forEach((p, idx) => {
      let base = Math.max(0, Math.min(100, p.rate));
      let adj = base + offset;
      if (adj < 0) adj = 0;
      if (adj > 100) adj = 100;

      const x = L + globalIndex * stepX;
      const y = valueToY(adj, h, B, plotH);

      if (globalIndex === 0) {
        sessionChainCtx.moveTo(x, y);
      } else if (idx === 0) {
        // ★ 前の点と完全に接続
        sessionChainCtx.moveTo(lastX, lastY);
        sessionChainCtx.lineTo(x, y);
      } else {
        sessionChainCtx.lineTo(x, y);
      }

      lastAdjRate = adj;
      lastX = x;
      lastY = y;
      globalIndex++;
    });

    sessionChainCtx.stroke();
  });

  // ---- タイトル ----
  sessionChainCtx.font = "40px sans-serif";
  sessionChainCtx.fillStyle = "#FFF";
  sessionChainCtx.fillText("セッション1→2→3 連結グラフ（太線 / 大フォント）", L, 60);
}


// ========================================================
// コメント表示
// ========================================================

function renderComments(comments) {
  commentList.innerHTML = "";

  if (!comments || comments.length === 0) {
    const p = document.createElement("p");
    p.textContent = "まだコメントはありません。";
    p.className = "small-note";
    commentList.appendChild(p);
    return;
  }

  comments.slice().reverse().forEach(c => {
    const div = document.createElement("div");
    div.className = "comment-item";

    const meta = document.createElement("div");
    meta.className = "comment-meta";

    const tag = document.createElement("span");
    tag.className =
      "comment-tag " + (c.choice === "understood" ? "understood" : "not-understood");
    tag.textContent = c.choice === "understood" ? "理解できた" : "理解できなかった";

    const time = document.createElement("span");
    time.textContent = new Date(c.ts).toLocaleString("ja-JP");

    meta.appendChild(tag);
    meta.appendChild(time);

    const body = document.createElement("div");
    body.textContent = c.text;

    div.appendChild(meta);
    div.appendChild(body);
    commentList.appendChild(div);
  });
}


// ========================================================
// 時刻更新
// ========================================================

function updateTimeLabel() {
  const now = new Date();
  timeIndicator.textContent =
    "現在時刻：" +
    now.toLocaleTimeString("ja-JP", { hour12: false });
}


// ========================================================
// 想定人数保存
// ========================================================

btnSaveMax.addEventListener("click", async () => {
  const num = Number(maxInput.value);
  if (!Number.isFinite(num) || num < 1 || num > 100) {
    alert("1〜100 の範囲で人数を入力してください。");
    return;
  }

  const res = await fetch("/api/admin/max-participants", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ maxParticipants: num })
  });

  if (!res.ok) return alert("保存に失敗しました。");

  alert("想定人数を保存しました。");
});


// ========================================================
// セッション単位リセット（過去セッション保存）
// ========================================================

btnReset.addEventListener("click", async () => {
  if (!confirm("現在セッションをリセットしますか？")) return;

  const sessionColor = getCurrentColor();

  if (history.length > 0) {
    prevSessions.unshift({
      color: sessionColor,
      points: history.map(p => ({ ts: p.ts, rate: p.rate }))
    });

    if (prevSessions.length > 3) prevSessions.pop();
  }

  resetCount++;
  history = [];

  await fetch("/api/admin/reset", { method: "POST" });

  drawPrevSessions();
  drawSessionChain();
  fetchResults();

  alert("リセットしました。");
});


// ========================================================
// 全データ完全リセット
// ========================================================

btnResetAll.addEventListener("click", async () => {
  if (!confirm("全データを完全リセットしますか？")) return;

  prevSessions = [];
  history = [];
  resetCount = 0;

  await fetch("/api/admin/reset-all", { method: "POST" });

  drawPrevSessions();
  drawSessionChain();
  fetchResults();

  alert("完全リセットしました。");
});


// ========================================================
// ログイン
// ========================================================

btnUnlock.addEventListener("click", unlock);
pwInput.addEventListener("keydown", e => {
  if (e.key === "Enter") unlock();
});

function unlock() {
  if (pwInput.value !== ADMIN_PASSWORD) {
    lockMsg.textContent = "パスワードが違います。";
    return;
  }

  lockScreen.style.display = "none";
  adminContent.style.display = "block";

  fetchResults();
  setInterval(fetchResults, 1000);

  requestAnimationFrame(drawLineChart);
  drawPrevSessions();
  drawSessionChain();
}

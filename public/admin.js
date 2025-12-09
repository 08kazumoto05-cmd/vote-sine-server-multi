// =======================================
// admin.js  最新版（グラフ反映修正版）
// =======================================
//
// ● 仕様
// ・パスワード: cpa1968
// ・現在 / 過去セッションのグラフ: 1点目は0として描画（0スタート）
// ・投票リセット時:
//    - history を prevSessions に保存（最大3件）
//    - その時点の「理解率」カードの値を finalDisplayRate として保存
// ・セッション1〜3連結グラフ:
//    - x=0: 0%
//    - x=1: セッション1の finalDisplayRate
//    - x=2: セッション2の finalDisplayRate ... を折れ線で結ぶ
// ・想定人数はサーバーの /api/results の maxParticipants を基準に使用

const ADMIN_PASSWORD = "cpa1968";

// ========== DOM 取得 ==========
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
const ctx = canvas ? canvas.getContext("2d") : null;

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

// 過去3セッション用
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
const prevCtxs = prevCanvases.map(c => (c ? c.getContext("2d") : null));

// 連結グラフ
const sessionChainCanvas = document.getElementById("sessionChain");
const sessionChainCtx = sessionChainCanvas
  ? sessionChainCanvas.getContext("2d")
  : null;

// ========== 状態 ==========
let history = [];      // 現在セッション [{ts, rate}]
let prevSessions = []; // 過去セッション [{color, points, finalDisplayRate}]
let resetCount = 0;

// サーバーから取得した最新の想定人数（グラフ用はこれを使う）
let currentMaxParticipants = 0;

const SESSION_COLORS = ["#4fc3f7", "#ff5252", "#66bb6a"];

let animationStarted = false;

// ========== ユーティリティ ==========
function getCurrentColor() {
  const idx = Math.min(resetCount, SESSION_COLORS.length - 1);
  return SESSION_COLORS[idx];
}

// 0〜100 の値 → Y座標（0が下端）
function valueToY(value, canvasHeight, bottomPadding, plotHeight) {
  let v = Math.max(0, Math.min(100, value));
  const ratio = v / 100;
  return canvasHeight - bottomPadding - ratio * plotHeight;
}

// ========== サーバーから結果取得 ==========
async function fetchResults() {
  try {
    const res = await fetch("/api/results");
    if (!res.ok) throw new Error("failed to fetch results");

    const data = await res.json();
    const u = data.understood || 0;
    const n = data.notUnderstood || 0;
    const total = u + n;

    // サーバーが持っている想定人数をそのまま採用（グラフもこれ基準）
    const maxP = data.maxParticipants ?? 0;
    currentMaxParticipants = maxP;

    const theme = data.theme || "";

    // 票数
    numUnderstood.textContent = u;
    numNotUnderstood.textContent = n;
    numTotal.textContent = total;

    // 表示用の理解率（u/total）
    const rateDisplay = total > 0 ? Math.round((u / total) * 100) : 0;
    rateUnderstood.textContent = rateDisplay + "%";

    // グラフ用の値 (理解 − 不理解) / 想定人数
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
    } else {
      rate = null;
    }

    // 想定人数 UI（サーバー値を常に反映）
    if (maxInput) {
      maxInput.value = maxP; // ← 常に同期させる
    }
    if (maxP > 0) {
      maxInfo.textContent = `想定人数：${maxP}人中、${total}人が投票済み`;
    } else {
      maxInfo.textContent = "想定人数が未設定です（グラフは表示されません）";
    }

    // テーマ UI
    themeInfo.textContent = theme
      ? `現在のテーマ：${theme}`
      : "現在のテーマ：未設定";
    if (document.activeElement !== themeInput) {
      themeInput.value = theme;
    }

    // コメント
    renderComments(data.comments || []);

    // 履歴更新
    addRatePoint(rate);

    // 描画開始
    if (!animationStarted) {
      animationStarted = true;
      if (canvas && ctx) {
        requestAnimationFrame(drawLineChart);
      }
    }

    updateTimeLabel();
  } catch (e) {
    console.error(e);
  }
}

// ========== 履歴管理 ==========
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

// ========== 現在セッションのグラフ ==========
function drawLineChart() {
  if (!canvas || !ctx) return;

  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);

  const maxP = currentMaxParticipants; // ← サーバー値を使用

  if (maxP <= 0) {
    ctx.fillStyle = "#ccc";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("想定人数が未設定のため、グラフは表示されません。", w / 2, h / 2);
    requestAnimationFrame(drawLineChart);
    return;
  }

  if (history.length === 0) {
    ctx.fillStyle = "#ccc";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("データがありません。", w / 2, h / 2);
    requestAnimationFrame(drawLineChart);
    return;
  }

  const L = 50, R = 20, T = 20, B = 40;
  const plotW = w - L - R;
  const plotH = h - T - B;

  // 枠
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(L, T);
  ctx.lineTo(L, h - B);
  ctx.lineTo(w - R, h - B);
  ctx.stroke();

  // Y目盛
  const yTicks = [0, 25, 50, 75, 100];
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  yTicks.forEach(v => {
    const y = valueToY(v, h, B, plotH);

    if (v === 0) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
    }

    ctx.beginPath();
    ctx.moveTo(L, y);
    ctx.lineTo(w - R, y);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(v + "%", L - 6, y);
  });

  // X補助線
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  [0.25, 0.5, 0.75].forEach(ratio => {
    const x = L + plotW * ratio;
    ctx.beginPath();
    ctx.moveTo(x, T);
    ctx.lineTo(x, h - B);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  const stepX = history.length > 1 ? plotW / (history.length - 1) : 0;

  // 線
  ctx.strokeStyle = getCurrentColor();
  ctx.lineWidth = 2.5;
  ctx.setLineDash([]);
  ctx.beginPath();

  history.forEach((p, i) => {
    const dispRate = i === 0 ? 0 : p.rate; // 1点目だけ0表示
    const x = L + i * stepX;
    const y = valueToY(dispRate, h, B, plotH);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();

  ctx.font = "12px sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(
    "理解度(理解 − 不理解) の推移（想定人数を分母 / 0〜100％で表示）",
    L + 4,
    4
  );

  requestAnimationFrame(drawLineChart);
}

// ========== 過去セッションのグラフ ==========
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

    pctx.fillStyle = "#000000";
    pctx.fillRect(0, 0, w, h);

    const labelBase = i === 0 ? "1つ前" : i === 1 ? "2つ前" : "3つ前";

    if (!session || !session.points || session.points.length === 0) {
      if (note) {
        note.textContent = `${labelBase}のセッション：まだグラフはありません。`;
      }
      if (rateLabel) rateLabel.textContent = "";
      continue;
    }

    const hist = session.points;
    const color = session.color || "#4fc3f7";
    const finalRate = session.finalDisplayRate ?? 0;

    if (note) {
      note.textContent = `${labelBase}のセッション：理解度の推移（0〜100％）`;
    }
    if (rateLabel) {
      rateLabel.textContent = `（最終理解度：${Math.round(finalRate)}%）`;
    }

    const L = 40, R = 15, T = 15, B = 25;
    const plotW = w - L - R;
    const plotH = h - T - B;

    // 枠
    pctx.strokeStyle = "#ffffff";
    pctx.lineWidth = 1.5;
    pctx.setLineDash([]);
    pctx.beginPath();
    pctx.moveTo(L, T);
    pctx.lineTo(L, h - B);
    pctx.lineTo(w - R, h - B);
    pctx.stroke();

    // Y軸
    const yTicks = [0, 25, 50, 75, 100];
    pctx.font = "9px sans-serif";
    pctx.textAlign = "right";
    pctx.textBaseline = "middle";

    yTicks.forEach(v => {
      const y = valueToY(v, h, B, plotH);

      if (v === 0) {
        pctx.strokeStyle = "#ffffff";
        pctx.lineWidth = 1.5;
        pctx.setLineDash([]);
      } else {
        pctx.strokeStyle = "#ffffff";
        pctx.lineWidth = 1;
        pctx.setLineDash([4, 4]);
      }

      pctx.beginPath();
      pctx.moveTo(L, y);
      pctx.lineTo(w - R, y);
      pctx.stroke();

      pctx.setLineDash([]);
      pctx.fillStyle = "#ffffff";
      pctx.fillText(v + "%", L - 4, y);
    });

    // X補助線
    pctx.strokeStyle = "#ffffff";
    pctx.lineWidth = 1;
    pctx.setLineDash([4, 4]);
    [0.25, 0.5, 0.75].forEach(ratio => {
      const x = L + plotW * ratio;
      pctx.beginPath();
      pctx.moveTo(x, T);
      pctx.lineTo(x, h - B);
      pctx.stroke();
    });
    pctx.setLineDash([]);

    // 線
    const stepX = hist.length > 1 ? plotW / (hist.length - 1) : 0;

    pctx.strokeStyle = color;
    pctx.lineWidth = 2;
    pctx.setLineDash([]);
    pctx.beginPath();

    hist.forEach((p, idx) => {
      const disp = idx === 0 ? 0 : p.rate; // 1点目は0
      const x = L + idx * stepX;
      const y = valueToY(disp, h, B, plotH);
      if (idx === 0) pctx.moveTo(x, y);
      else pctx.lineTo(x, y);
    });

    pctx.stroke();
  }
}

// ========== セッション1〜3 連結グラフ ==========
// x=0 を 0%、その後 各セッションの finalDisplayRate を折れ線で結ぶ
function drawSessionChain() {
  if (!sessionChainCanvas || !sessionChainCtx) return;

  const w = sessionChainCanvas.width;
  const h = sessionChainCanvas.height;

  sessionChainCtx.fillStyle = "#000000";
  sessionChainCtx.fillRect(0, 0, w, h);

  // 最新→古い順の prevSessions を、古い順に並べ替え
  const sessions = prevSessions
    .slice(0, 3)
    .slice()
    .reverse()
    .filter(s => s && typeof s.finalDisplayRate === "number");

  if (sessions.length === 0) {
    sessionChainCtx.fillStyle = "#cccccc";
    sessionChainCtx.font = "14px sans-serif";
    sessionChainCtx.textAlign = "center";
    sessionChainCtx.textBaseline = "middle";
    sessionChainCtx.fillText("まだセッションが保存されていません。", w / 2, h / 2);
    return;
  }

  const L = 50, R = 20, T = 20, B = 35;
  const plotW = w - L - R;
  const plotH = h - T - B;

  // 枠
  sessionChainCtx.strokeStyle = "#ffffff";
  sessionChainCtx.lineWidth = 2;
  sessionChainCtx.setLineDash([]);
  sessionChainCtx.beginPath();
  sessionChainCtx.moveTo(L, T);
  sessionChainCtx.lineTo(L, h - B);
  sessionChainCtx.lineTo(w - R, h - B);
  sessionChainCtx.stroke();

  // Y軸
  const yTicks = [0, 25, 50, 75, 100];
  sessionChainCtx.font = "10px sans-serif";
  sessionChainCtx.textAlign = "right";
  sessionChainCtx.textBaseline = "middle";

  yTicks.forEach(v => {
    const y = valueToY(v, h, B, plotH);

    if (v === 0) {
      sessionChainCtx.strokeStyle = "#ffffff";
      sessionChainCtx.lineWidth = 1.5;
      sessionChainCtx.setLineDash([]);
    } else {
      sessionChainCtx.strokeStyle = "#ffffff";
      sessionChainCtx.lineWidth = 1;
      sessionChainCtx.setLineDash([4, 4]);
    }

    sessionChainCtx.beginPath();
    sessionChainCtx.moveTo(L, y);
    sessionChainCtx.lineTo(w - R, y);
    sessionChainCtx.stroke();

    sessionChainCtx.setLineDash([]);
    sessionChainCtx.fillStyle = "#ffffff";
    sessionChainCtx.fillText(v + "%", L - 6, y);
  });

  // X補助線
  sessionChainCtx.strokeStyle = "#ffffff";
  sessionChainCtx.lineWidth = 1;
  sessionChainCtx.setLineDash([4, 4]);
  [0.25, 0.5, 0.75].forEach(ratio => {
    const x = L + plotW * ratio;
    sessionChainCtx.beginPath();
    sessionChainCtx.moveTo(x, T);
    sessionChainCtx.lineTo(x, h - B);
    sessionChainCtx.stroke();
  });
  sessionChainCtx.setLineDash([]);

  // 折れ線用ポイント:
  // point0: 0%
  // point1〜: 各セッションの finalDisplayRate
  const pointCount = sessions.length + 1;
  const stepX = pointCount > 1 ? plotW / (pointCount - 1) : 0;

  sessionChainCtx.lineWidth = 2.5;
  sessionChainCtx.setLineDash([]);
  sessionChainCtx.strokeStyle = SESSION_COLORS[0];
  sessionChainCtx.beginPath();

  for (let i = 0; i < pointCount; i++) {
    let rate;
    if (i === 0) {
      rate = 0; // スタートは0%
    } else {
      rate = sessions[i - 1].finalDisplayRate ?? 0;
      if (rate < 0) rate = 0;
      if (rate > 100) rate = 100;
    }

    const x = L + stepX * i;
    const y = valueToY(rate, h, B, plotH);

    if (i === 0) sessionChainCtx.moveTo(x, y);
    else sessionChainCtx.lineTo(x, y);
  }

  sessionChainCtx.stroke();

  // タイトル
  sessionChainCtx.font = "12px sans-serif";
  sessionChainCtx.fillStyle = "#ffffff";
  sessionChainCtx.textAlign = "left";
  sessionChainCtx.textBaseline = "top";
  sessionChainCtx.fillText(
    "セッション1→2→3 連結グラフ（0％からスタートし各セッションの最終理解率を結んだ折れ線）",
    L + 4,
    4
  );
}

// ========== コメント表示 ==========
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
    .forEach(c => {
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
      let timeText = "";
      try {
        timeText = new Date(c.ts).toLocaleString("ja-JP");
      } catch {
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

// ========== 時刻表示 ==========
function updateTimeLabel() {
  if (!timeIndicator) return;
  const now = new Date();
  const text = now.toLocaleTimeString("ja-JP", { hour12: false });
  timeIndicator.textContent = `現在時刻：${text}`;
}

// ========== 想定人数保存 ==========
if (btnSaveMax && maxInput) {
  btnSaveMax.addEventListener("click", async () => {
    const num = Number(maxInput.value);

    if (!Number.isFinite(num) || num < 1 || num > 100) {
      alert("1〜100 の範囲で人数を入力してください。");
      return;
    }

    try {
      const res = await fetch("/api/admin/max-participants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxParticipants: num })
      });

      if (!res.ok) throw new Error("failed to update max participants");

      const data = await res.json();
      currentMaxParticipants = data.maxParticipants ?? num;
      maxInfo.textContent =
        `想定人数：${currentMaxParticipants}人中、` +
        `${numTotal.textContent}人が投票済み`;
      alert("想定投票人数を保存しました。");
    } catch (e) {
      console.error(e);
      alert(
        "想定人数の保存に失敗しました。時間をおいて再度お試しください。"
      );
    }
  });
}

// ========== テーマ保存 ==========
if (btnSaveTheme && themeInput) {
  btnSaveTheme.addEventListener("click", async () => {
    const theme = themeInput.value.trim();

    try {
      const res = await fetch("/api/admin/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme })
      });

      if (!res.ok) throw new Error("failed to save theme");

      const data = await res.json();
      themeInfo.textContent = data.theme
        ? `現在のテーマ：${data.theme}`
        : "現在のテーマ：未設定";
      alert("テーマを保存しました。");
    } catch (e) {
      console.error(e);
      alert("テーマの保存に失敗しました。");
    }
  });
}

// ========== 投票リセット（セッション単位） ==========
if (btnReset) {
  btnReset.addEventListener("click", async () => {
    const ok = confirm(
      "現在セッションの票・コメント・グラフをリセットします。\n本当に実行しますか？"
    );
    if (!ok) return;

    try {
      const currentColor = getCurrentColor();

      // 現在の「理解率」カードの値を finalDisplayRate として取得
      let finalDisplayRate = 0;
      try {
        const txt = (rateUnderstood.textContent || "").replace("%", "");
        finalDisplayRate = Number(txt) || 0;
      } catch {
        finalDisplayRate = 0;
      }

      // 現在セッションを過去セッションに保存
      if (history.length > 0) {
        const copy = history.map(p => ({ ts: p.ts, rate: p.rate }));
        prevSessions.unshift({
          color: currentColor,
          points: copy,
          finalDisplayRate
        });
        if (prevSessions.length > 3) prevSessions = prevSessions.slice(0, 3);
        drawPrevSessions();
        drawSessionChain();
      }

      // サーバー側リセット
      const res = await fetch("/api/admin/reset", { method: "POST" });
      if (!res.ok) throw new Error("failed to reset");

      // リセット回数（色を進める）
      resetCount++;

      // 新しいセッションの履歴をクリア
      history = [];

      await fetchResults();
      alert("投票データをリセットしました。");
    } catch (e) {
      console.error(e);
      alert("リセットに失敗しました。時間をおいて再度お試しください。");
    }
  });
}

// ========== 全投票データ完全リセット ==========
if (btnResetAll) {
  btnResetAll.addEventListener("click", async () => {
    const ok = confirm(
      "現在セッション＋過去3セッションのグラフをすべて削除します。\n本当に完全リセットしますか？"
    );
    if (!ok) return;

    try {
      const res = await fetch("/api/admin/reset-all", { method: "POST" });
      if (!res.ok) throw new Error("failed to reset all");

      history = [];
      prevSessions = [];
      resetCount = 0;
      currentMaxParticipants = 0;

      drawPrevSessions();
      drawSessionChain();
      await fetchResults();

      alert("全投票データを完全リセットしました。");
    } catch (e) {
      console.error(e);
      alert("完全リセットに失敗しました。時間をおいて再度お試しください。");
    }
  });
}

// ========== ログイン ==========
btnUnlock.addEventListener("click", unlock);
pwInput.addEventListener("keydown", e => {
  if (e.key === "Enter") unlock();
});

function unlock() {
  const input = pwInput.value.trim();
  if (input !== ADMIN_PASSWORD) {
    lockMsg.textContent = "パスワードが違います。";
    return;
  }

  lockScreen.style.display = "none";
  adminContent.style.display = "block";

  fetchResults();
  setInterval(fetchResults, 1000);

  if (!animationStarted && canvas && ctx) {
    animationStarted = true;
    requestAnimationFrame(drawLineChart);
  }

  drawPrevSessions();
  drawSessionChain();
}

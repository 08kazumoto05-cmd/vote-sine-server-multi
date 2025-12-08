// admin.js - 管理画面
// ● 各セッションのグラフ：0〜100% のプラスのみ、必ず 0 からスタート
//   値 = (理解できた − 理解できなかった) ÷ 想定人数 × 100
//   想定人数が 0 のときはグラフ非表示
// ● 過去セッションは最大3つ保存
// ● セッション1〜3連結グラフ：
//   「一番古いセッション」→「……」→「いちばん新しいセッション（現在含む）」を
//   1 本の線の形でつなげるが、色は
//   1本目: 青, 2本目: 赤, 3本目: 緑 で表示

const ADMIN_PASSWORD = "admin123";

// ==== DOM ====
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

// 過去3セッション用キャンバス
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
const prevCtxs = prevCanvases.map((c) => (c ? c.getContext("2d") : null));

// セッション1〜3連結グラフ用
const sessionChainCanvas = document.getElementById("sessionChain");
const sessionChainCtx = sessionChainCanvas
  ? sessionChainCanvas.getContext("2d")
  : null;

// ==== 状態 ====

// 現在セッションの履歴 [{ ts, rate }]
let history = [];

// 過去セッション（最大3つ）
// [{ color: "#xxxxxx", points: [{ts, rate}, ...] }, ...]
// 先頭が一番新しいセッション
let prevSessions = [];

// リセット回数（0:初回, 1:1回目リセット後, 2:2回目リセット後…）
let resetCount = 0;

// セッションごとの色（通常表示用）
const SESSION_COLORS = ["#4fc3f7", "#ff5252", "#66bb6a"];

// 連結グラフ用の色（古い順に 1→2→3）
const CHAIN_COLORS = ["#4fc3f7", "#ff5252", "#66bb6a"];

// 描画ループ開始済みか
let animationStarted = false;

// ==== ユーティリティ ====

function getCurrentColor() {
  const idx = Math.min(resetCount, SESSION_COLORS.length - 1);
  return SESSION_COLORS[idx];
}

// 0〜100 をキャンバスY座標に変換（0:下端, 100:上端）
function valueToYPos(value, canvasHeight, bottomPadding, plotHeight) {
  let v = Math.max(0, Math.min(100, value));
  return canvasHeight - bottomPadding - (v / 100) * plotHeight;
}

// ==== 結果取得 ====

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

    // 票数表示
    numUnderstood.textContent = u;
    numNotUnderstood.textContent = n;
    numTotal.textContent = total;

    // 表示用理解率（普通の％）
    const rateDisplay = total > 0 ? Math.round((u / total) * 100) : 0;
    rateUnderstood.textContent = rateDisplay + "%";

    // ---- グラフ用の値（0〜100, マイナスなし） ----
    let rate = null;

    if (maxP > 0) {
      if (total === 0 && history.length > 0) {
        rate = history[history.length - 1].rate;
      } else if (total === 0 && history.length === 0) {
        rate = null;
      } else {
        rate = ((u - n) / maxP) * 100;
      }
    } else {
      rate = null; // 想定人数未設定 → 描画しない
    }

    if (rate !== null) {
      rate = Math.round(Math.max(0, Math.min(100, rate)));
    }

    // 想定人数UI
    if (document.activeElement !== maxInput) {
      maxInput.value = maxP;
    }
    if (maxP > 0) {
      maxInfo.textContent = `想定人数：${maxP}人中、${total}人が投票済み`;
    } else {
      maxInfo.textContent =
        "想定人数が未設定です（グラフは表示されません）";
    }

    // テーマUI
    themeInfo.textContent = theme
      ? `現在のテーマ：${theme}`
      : "現在のテーマ：未設定";
    if (document.activeElement !== themeInput) {
      themeInput.value = theme;
    }

    // コメント
    renderComments(data.comments || []);

    // 履歴更新（各セッションは必ず 0 からスタート）
    addRatePoint(rate);

    if (!animationStarted) {
      animationStarted = true;
      requestAnimationFrame(drawLineChart);
    }

    drawSessionChain(); // 連結グラフも更新
    updateTimeLabel();
  } catch (e) {
    console.error(e);
  }
}

// ==== 履歴管理 ====

function addRatePoint(rate) {
  const now = Date.now();
  if (rate === null) return;

  // セッション開始時は 0 を1点入れる
  if (history.length === 0) {
    history.push({ ts: now, rate: 0 });
  }

  const last = history[history.length - 1];
  if (last && last.rate === rate) return;

  history.push({ ts: now, rate });

  if (history.length > 200) {
    history = history.slice(-200);
  }
}

// ==== 現在セッションのグラフ ====

function drawLineChart() {
  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, w, h);

  const maxP = Number(maxInput.value || "0");
  if (!Number.isFinite(maxP) || maxP <= 0) {
    ctx.fillStyle = "#CCCCCC";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      "想定人数が未設定のため、グラフは表示されません。",
      w / 2,
      h / 2
    );
    requestAnimationFrame(drawLineChart);
    return;
  }

  if (history.length === 0) {
    ctx.fillStyle = "#CCCCCC";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("データがありません。", w / 2, h / 2);
    requestAnimationFrame(drawLineChart);
    return;
  }

  const L = 50,
    R = 20,
    T = 20,
    B = 40;
  const plotW = w - L - R;
  const plotH = h - T - B;

  // 外枠
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(L, T);
  ctx.lineTo(L, h - B);
  ctx.lineTo(w - R, h - B);
  ctx.stroke();

  // Y軸（0,25,50,75,100）
  const yTicks = [0, 25, 50, 75, 100];
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  yTicks.forEach((v) => {
    const y = valueToYPos(v, h, B, plotH);

    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = v === 0 ? 1.5 : 1;
    ctx.setLineDash(v === 0 ? [] : [4, 4]);

    ctx.beginPath();
    ctx.moveTo(L, y);
    ctx.lineTo(w - R, y);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(v + "%", L - 6, y);
  });

  // X方向補助線
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  [0.25, 0.5, 0.75].forEach((ratio) => {
    const x = L + plotW * ratio;
    ctx.beginPath();
    ctx.moveTo(x, T);
    ctx.lineTo(x, h - B);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  const stepX = history.length > 1 ? plotW / (history.length - 1) : 0;

  const currentColor = getCurrentColor();

  ctx.strokeStyle = currentColor;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([]);
  ctx.beginPath();
  history.forEach((p, i) => {
    const x = L + i * stepX;
    const y = valueToYPos(p.rate, h, B, plotH);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.font = "12px sans-serif";
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(
    "理解度(理解 − 不理解) の推移（0〜100%, 各セッションは0からスタート）",
    L + 4,
    4
  );

  requestAnimationFrame(drawLineChart);
}

// ==== 過去セッションのグラフ ====

function drawPrevSessions() {
  for (let i = 0; i < 3; i++) {
    const session = prevSessions[i];
    const c = prevCanvases[i];
    const note = prevNotes[i];
    const pctx = prevCtxs[i];

    if (!c || !pctx) continue;

    const w = c.width;
    const h = c.height;

    pctx.fillStyle = "#000000";
    pctx.fillRect(0, 0, w, h);

    if (!session || !session.points || session.points.length === 0) {
      if (note) {
        note.textContent = `${i + 1}つ前のセッション：まだグラフはありません。`;
      }
      continue;
    }

    const hist = session.points;
    const color = session.color;

    if (note) {
      note.textContent = `${i + 1}つ前のセッション：理解度の推移（0〜100%）`;
    }

    const L = 40,
      R = 15,
      T = 15,
      B = 25;
    const plotW = w - L - R;
    const plotH = h - T - B;

    pctx.strokeStyle = "#FFFFFF";
    pctx.lineWidth = 1.5;
    pctx.setLineDash([]);
    pctx.beginPath();
    pctx.moveTo(L, T);
    pctx.lineTo(L, h - B);
    pctx.lineTo(w - R, h - B);
    pctx.stroke();

    const yTicks = [0, 25, 50, 75, 100];
    pctx.font = "9px sans-serif";
    pctx.textAlign = "right";
    pctx.textBaseline = "middle";

    yTicks.forEach((v) => {
      const y = valueToYPos(v, h, B, plotH);

      pctx.strokeStyle = "#FFFFFF";
      pctx.lineWidth = v === 0 ? 1.5 : 1;
      pctx.setLineDash(v === 0 ? [] : [4, 4]);

      pctx.beginPath();
      pctx.moveTo(L, y);
      pctx.lineTo(w - R, y);
      pctx.stroke();

      pctx.setLineDash([]);
      pctx.fillStyle = "#FFFFFF";
      pctx.fillText(v + "%", L - 4, y);
    });

    pctx.strokeStyle = "#FFFFFF";
    pctx.lineWidth = 1;
    pctx.setLineDash([4, 4]);
    [0.25, 0.5, 0.75].forEach((ratio) => {
      const x = L + plotW * ratio;
      pctx.beginPath();
      pctx.moveTo(x, T);
      pctx.lineTo(x, h - B);
      pctx.stroke();
    });
    pctx.setLineDash([]);

    const stepX = hist.length > 1 ? plotW / (hist.length - 1) : 0;

    pctx.strokeStyle = color || "#FFA726";
    pctx.lineWidth = 2;
    pctx.setLineDash([]);
    pctx.beginPath();
    hist.forEach((p, idx) => {
      const x = L + idx * stepX;
      const y = valueToYPos(p.rate, h, B, plotH);
      if (idx === 0) pctx.moveTo(x, y);
      else pctx.lineTo(x, y);
    });
    pctx.stroke();
  }
}

// ==== セッション1〜3 連結グラフ ====
// 古い順に最大3セッションを 1 本の線の形で連結し、
// 区間ごとに CHAIN_COLORS[0], [1], [2] の色で描画

function drawSessionChain() {
  if (!sessionChainCanvas || !sessionChainCtx) return;

  const w = sessionChainCanvas.width;
  const h = sessionChainCanvas.height;

  sessionChainCtx.fillStyle = "#000000";
  sessionChainCtx.fillRect(0, 0, w, h);

  // 古い順にセッションを作る
  const list = [];

  const orderedPast = prevSessions
    .slice()
    .reverse()
    .filter((s) => s && s.points && s.points.length > 0);

  orderedPast.forEach((s) => {
    list.push({
      type: "past",
      points: s.points
    });
  });

  if (history && history.length > 0) {
    list.push({
      type: "current",
      points: history
    });
  }

  if (list.length === 0) {
    sessionChainCtx.fillStyle = "#CCCCCC";
    sessionChainCtx.font = "14px sans-serif";
    sessionChainCtx.textAlign = "center";
    sessionChainCtx.textBaseline = "middle";
    sessionChainCtx.fillText(
      "まだセッションが保存されていません。",
      w / 2,
      h / 2
    );
    return;
  }

  // 古い方から最大3つ
  const sessions = list.slice(-3);

  // 全ポイント数（連結用）
  let totalPoints = 0;
  sessions.forEach((s) => {
    if (s.points && s.points.length > 0) {
      totalPoints += s.points.length;
    }
  });

  if (totalPoints === 0) {
    sessionChainCtx.fillStyle = "#CCCCCC";
    sessionChainCtx.font = "14px sans-serif";
    sessionChainCtx.textAlign = "center";
    sessionChainCtx.textBaseline = "middle";
    sessionChainCtx.fillText(
      "まだセッションが保存されていません。",
      w / 2,
      h / 2
    );
    return;
  }

  const L = 50,
    R = 20,
    T = 20,
    B = 35;
  const plotW = w - L - R;
  const plotH = h - T - B;

  // 外枠
  sessionChainCtx.strokeStyle = "#FFFFFF";
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

  yTicks.forEach((v) => {
    const y = valueToYPos(v, h, B, plotH);

    sessionChainCtx.strokeStyle = "#FFFFFF";
    sessionChainCtx.lineWidth = v === 0 ? 1.5 : 1;
    sessionChainCtx.setLineDash(v === 0 ? [] : [4, 4]);

    sessionChainCtx.beginPath();
    sessionChainCtx.moveTo(L, y);
    sessionChainCtx.lineTo(w - R, y);
    sessionChainCtx.stroke();

    sessionChainCtx.setLineDash([]);
    sessionChainCtx.fillStyle = "#FFFFFF";
    sessionChainCtx.fillText(v + "%", L - 6, y);
  });

  // X補助線
  sessionChainCtx.strokeStyle = "#FFFFFF";
  sessionChainCtx.lineWidth = 1;
  sessionChainCtx.setLineDash([4, 4]);
  [0.25, 0.5, 0.75].forEach((ratio) => {
    const x = L + plotW * ratio;
    sessionChainCtx.beginPath();
    sessionChainCtx.moveTo(x, T);
    sessionChainCtx.lineTo(x, h - B);
    sessionChainCtx.stroke();
  });
  sessionChainCtx.setLineDash([]);

  const stepX =
    totalPoints > 1 ? plotW / (totalPoints - 1) : 0;

  let globalIndex = 0;
  let prevLastRate = null;

  sessions.forEach((session, sIdx) => {
    const raw = session.points;
    if (!raw || raw.length === 0) return;

    // このセッションのコピー（前セッション最終値に合わせるため）
    const adjusted = raw.map((p) => ({ ts: p.ts, rate: p.rate }));

    if (prevLastRate !== null && adjusted.length > 0) {
      const offset = prevLastRate - adjusted[0].rate;
      adjusted.forEach((p) => {
        let v = p.rate + offset;
        if (v < 0) v = 0;
        if (v > 100) v = 100;
        p.rate = v;
      });
    }

    // ★ 色はインデックスで固定：0=青,1=赤,2=緑
    const color = CHAIN_COLORS[Math.min(sIdx, CHAIN_COLORS.length - 1)];

    sessionChainCtx.strokeStyle = color;
    sessionChainCtx.lineWidth = 2.5;
    sessionChainCtx.setLineDash([]);
    sessionChainCtx.beginPath();

    adjusted.forEach((p) => {
      const x = L + stepX * globalIndex;
      const y = valueToYPos(p.rate, h, B, plotH);

      if (globalIndex === 0) {
        sessionChainCtx.moveTo(x, y);
      } else {
        sessionChainCtx.lineTo(x, y);
      }

      globalIndex++;
    });

    sessionChainCtx.stroke();

    const lastPoint = adjusted[adjusted.length - 1];
    if (lastPoint) prevLastRate = lastPoint.rate;
  });

  sessionChainCtx.font = "12px sans-serif";
  sessionChainCtx.fillStyle = "#FFFFFF";
  sessionChainCtx.textAlign = "left";
  sessionChainCtx.textBaseline = "top";
  sessionChainCtx.fillText(
    "セッション1 → 2 → 3 連結グラフ（1本の線の形／色は 青→赤→緑）",
    L + 4,
    4
  );
}

// ==== コメント表示 ====

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

// ==== 時刻表示 ====

function updateTimeLabel() {
  if (!timeIndicator) return;
  const now = new Date();
  const text = now.toLocaleTimeString("ja-JP", { hour12: false });
  timeIndicator.textContent = `現在時刻：${text}`;
}

// ==== 想定人数保存 ====

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
      maxInfo.textContent =
        `想定人数：${data.maxParticipants}人中、` +
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

// ==== テーマ保存 ====

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

// ==== 投票リセット（セッション単位） ====

if (btnReset) {
  btnReset.addEventListener("click", async () => {
    const ok = confirm(
      "現在セッションの票・コメント・グラフをリセットします。\n本当に実行しますか？"
    );
    if (!ok) return;

    try {
      const currentColor = getCurrentColor();

      if (history.length > 0) {
        const copy = history.map((p) => ({ ts: p.ts, rate: p.rate }));
        prevSessions.unshift({ color: currentColor, points: copy });
        if (prevSessions.length > 3) prevSessions = prevSessions.slice(0, 3);
        drawPrevSessions();
        drawSessionChain();
      }

      const res = await fetch("/api/admin/reset", { method: "POST" });
      if (!res.ok) throw new Error("failed to reset");

      resetCount++;
      history = [];

      await fetchResults();
      alert("投票データをリセットしました。");
    } catch (e) {
      console.error(e);
      alert("リセットに失敗しました。時間をおいて再度お試しください。");
    }
  });
}

// ==== 全投票データ完全リセット ====

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

// ==== ログイン ====

btnUnlock.addEventListener("click", unlock);
pwInput.addEventListener("keydown", (e) => {
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

  if (!animationStarted) {
    animationStarted = true;
    requestAnimationFrame(drawLineChart);
  }

  drawPrevSessions();
  drawSessionChain();
}

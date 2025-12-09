// =======================================
// admin.js（パスワード cpa1968 版）
// ・現在セッション/過去セッション：0〜100%表示、0スタート演出
// ・最終理解度％：投票リセット時の「理解率」を保存して表示
// ・連結グラフ：左端0%からスタートし、各セッションの最終理解度％を頂点にした折れ線
// ・連結グラフ：セッション1は0%からスタートし、その理解率まで上昇
//   以降、各セッションの最終理解度％を結ぶ折れ線
// =======================================

const ADMIN_PASSWORD = "cpa1968";

// ==== DOM取得 ====
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

// 連結グラフ用
const sessionChainCanvas = document.getElementById("sessionChain");
const sessionChainCtx = sessionChainCanvas
  ? sessionChainCanvas.getContext("2d")
  : null;

// ==== 状態 ====

// 現在セッションの履歴 [{ ts, rate }]  ※rate は (理解−不理解)/想定人数×100 を 0〜100 にクリップした値
let history = [];

// 過去セッション（最大3件）
// { color: "#xxxxxx", points: [{ts, rate}, ...], finalDisplayRate: number }
let prevSessions = [];

// リセット回数（0:1セッション目,1:2セッション目,2:3セッション目…）
let resetCount = 0;

// セッション色（青→赤→緑）
const SESSION_COLORS = ["#4fc3f7", "#ff5252", "#66bb6a"];

// 描画ループフラグ
let animationStarted = false;

// ==== ユーティリティ ====

// 現在セッションの色
function getCurrentColor() {
  const idx = Math.min(resetCount, SESSION_COLORS.length - 1);
  return SESSION_COLORS[idx];
}

// 0〜100 の値をキャンバスY座標に変換（0:下端, 100:上端）
function valueToY(value, canvasHeight, bottomPadding, plotHeight) {
  let v = Math.max(0, Math.min(100, value)); // 0〜100 にクリップ
  const ratio = v / 100;
  return canvasHeight - bottomPadding - ratio * plotHeight;
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

    // ★画面右側の「理解率」＝理解できた / (理解できた + あまり理解できなかった)
    // 画面右側の「理解率」＝理解できた / (理解できた + あまり理解できなかった)
    const rateDisplay = total > 0 ? Math.round((u / total) * 100) : 0;
    rateUnderstood.textContent = rateDisplay + "%";

    // --- グラフ用の値（0〜100） ---  ※(理解 − 不理解)/想定人数 × 100
    let rate = null;

    if (maxP > 0) {
      if (total === 0 && history.length > 0) {
        // 投票が 0 でも履歴があるときは前回値を維持
        rate = history[history.length - 1].rate;
      } else if (total === 0 && history.length === 0) {
        rate = null; // まだ何も描かない
      } else {
        rate = ((u - n) / maxP) * 100;
        if (rate < 0) rate = 0;
        if (rate > 100) rate = 100;
      }
    } else {
      rate = null; // 想定人数未設定
    }

    // 想定人数 UI
    if (document.activeElement !== maxInput) {
      maxInput.value = maxP;
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

    // グラフ描画開始
    if (!animationStarted) {
      animationStarted = true;
      requestAnimationFrame(drawLineChart);
    }

    updateTimeLabel();
  } catch (e) {
    console.error(e);
  }
}

// ==== 履歴管理 ====

function addRatePoint(rate) {
  const now = Date.now();
  if (rate === null) return;

  const last = history[history.length - 1];
  if (last && last.rate === rate) return; // 同じ値は追加しない

  history.push({ ts: now, rate });

  if (history.length > 300) {
    history = history.slice(-300);
  }
}

// ==== 現在セッションのグラフ描画 ====
// 表示上：1点目を必ず 0 として描画（0スタート演出）

function drawLineChart() {
  const w = canvas.width;
  const h = canvas.height;

  // 背景
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, w, h);

  const maxP = Number(maxInput.value || "0");

  if (maxP <= 0) {
    ctx.fillStyle = "#CCCCCC";
    ctx.font = "20px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("想定人数が未設定のため、グラフは表示されません。", w / 2, h / 2);
    requestAnimationFrame(drawLineChart);
    return;
  }

  if (history.length === 0) {
    ctx.fillStyle = "#CCCCCC";
    ctx.font = "20px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("データがありません。", w / 2, h / 2);
    requestAnimationFrame(drawLineChart);
    return;
  }

  const L = 60, R = 30, T = 30, B = 60;
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

  // Y軸目盛（0,25,50,75,100）
  const yTicks = [0, 25, 50, 75, 100];
  ctx.font = "14px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  yTicks.forEach(v => {
    const y = valueToY(v, h, B, plotH);

    if (v === 0) {
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = "#555555";
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
    }

    ctx.beginPath();
    ctx.moveTo(L, y);
    ctx.lineTo(w - R, y);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(v + "%", L - 8, y);
  });

  // X方向補助線
  ctx.strokeStyle = "#555555";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  [0.25, 0.5, 0.75].forEach(ratio => {
    const x = L + plotW * ratio;
    ctx.beginPath();
    ctx.moveTo(x, T);
    ctx.lineTo(x, h - B);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  // X座標
  const stepX = history.length > 1 ? plotW / (history.length - 1) : 0;

  // 線色
  const currentColor = getCurrentColor();

  ctx.strokeStyle = currentColor;
  ctx.lineWidth = 3;
  ctx.setLineDash([]);
  ctx.beginPath();

  history.forEach((p, i) => {
    const displayRate = i === 0 ? 0 : p.rate; // 1点目だけ0
    const x = L + i * stepX;
    const y = valueToY(displayRate, h, B, plotH);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // タイトル
  ctx.font = "15px sans-serif";
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(
    "理解度(理解 − 不理解) の推移（想定人数を分母 / 0〜100％で表示）",
    L + 4,
    6
  );

  requestAnimationFrame(drawLineChart);
}

// ==== 過去セッションのグラフ描画 ====
// ・各セッション 1 点目は 0 として描画（0スタート）
// ・右横に「最終理解度：◯◯％」を表示
//   ※この最終理解度は「投票リセット時の理解率（u/(u+n))」

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

    // 背景
    pctx.fillStyle = "#000000";
    pctx.fillRect(0, 0, w, h);

    if (!session || !session.points || session.points.length === 0) {
      if (note) {
        const label = i === 0 ? "1つ前" : i === 1 ? "2つ前" : "3つ前";
        note.textContent = `${label}のセッション：まだグラフはありません。`;
      }
      if (rateLabel) {
        rateLabel.textContent = "";
      }
      continue;
    }

    const hist = session.points;
    const color = session.color || "#4fc3f7";

    if (note) {
      const label = i === 0 ? "1つ前" : i === 1 ? "2つ前" : "3つ前";
      note.textContent = `${label}のセッション：理解度の推移（0〜100％）`;
    }

    // ★ 最終理解度％（リセット時の理解率）を表示
    if (rateLabel) {
      let finalRate =
        typeof session.finalDisplayRate === "number"
          ? session.finalDisplayRate
          : (hist.length > 0 ? hist[hist.length - 1].rate : 0);

      if (finalRate < 0) finalRate = 0;
      if (finalRate > 100) finalRate = 100;
      rateLabel.textContent = `（最終理解度：${Math.round(finalRate)}%）`;
    }

    const L = 50, R = 20, T = 25, B = 40;
    const plotW = w - L - R;
    const plotH = h - T - B;

    // 外枠
    pctx.strokeStyle = "#FFFFFF";
    pctx.lineWidth = 2;
    pctx.setLineDash([]);
    pctx.beginPath();
    pctx.moveTo(L, T);
    pctx.lineTo(L, h - B);
    pctx.lineTo(w - R, h - B);
    pctx.stroke();

    // Y軸（0〜100）
    const yTicks = [0, 25, 50, 75, 100];
    pctx.font = "12px sans-serif";
    pctx.textAlign = "right";
    pctx.textBaseline = "middle";

    yTicks.forEach(v => {
      const y = valueToY(v, h, B, plotH);

      if (v === 0) {
        pctx.strokeStyle = "#FFFFFF";
        pctx.lineWidth = 2;
        pctx.setLineDash([]);
      } else {
        pctx.strokeStyle = "#555555";
        pctx.lineWidth = 1;
        pctx.setLineDash([6, 4]);
      }

      pctx.beginPath();
      pctx.moveTo(L, y);
      pctx.lineTo(w - R, y);
      pctx.stroke();

      pctx.setLineDash([]);
      pctx.fillStyle = "#FFFFFF";
      pctx.fillText(v + "%", L - 6, y);
    });

    // X補助線
    pctx.strokeStyle = "#555555";
    pctx.lineWidth = 1;
    pctx.setLineDash([6, 4]);
    [0.25, 0.5, 0.75].forEach(ratio => {
      const x = L + plotW * ratio;
      pctx.beginPath();
      pctx.moveTo(x, T);
      pctx.lineTo(x, h - B);
      pctx.stroke();
    });
    pctx.setLineDash([]);

    const stepX = hist.length > 1 ? plotW / (hist.length - 1) : 0;

    // セッションごとの色で線を描画（1点目は0）
    pctx.strokeStyle = color;
    pctx.lineWidth = 2.5;
    pctx.setLineDash([]);
    pctx.beginPath();

    hist.forEach((p, idx) => {
      const displayRate = idx === 0 ? 0 : p.rate;
      const x = L + idx * stepX;
      const y = valueToY(displayRate, h, B, plotH);
      if (idx === 0) pctx.moveTo(x, y);
      else pctx.lineTo(x, y);
    });
    pctx.stroke();
  }
}

// ==== セッション1〜3 連結グラフ ====
// ・左端のスタート地点は必ず 0%（セッション前）
// ・1回目のリセット以降は、各セッションの最終理解度％をその後の頂点として表示
//   例： [0%, セッション1最終％, セッション2最終％, …] を折れ線で結ぶ
// ==== セッション別 最終理解度 連結グラフ ====
// ・左端の点：セッション1のスタート 0%
// ・その右：セッション1の最終理解度％
// ・さらに右：セッション2, 3 … の最終理解度％

function drawSessionChain() {
  if (!sessionChainCanvas || !sessionChainCtx) return;

  const w = sessionChainCanvas.width;
  const h = sessionChainCanvas.height;

  sessionChainCtx.fillStyle = "#000000";
  sessionChainCtx.fillRect(0, 0, w, h);

  // 最新から最大3件を取り出し、古い順に並べ替え
  const sessionsNewestFirst = prevSessions.slice(0, 3);
  const sessions = sessionsNewestFirst
    .slice()
    .reverse()
    .filter(s => s && s.points && s.points.length > 0);

  if (sessions.length === 0) {
    // セッションがまだ1つもないときは「0％だけ」のラインにせず、メッセージ表示
    sessionChainCtx.fillStyle = "#CCCCCC";
    sessionChainCtx.font = "16px sans-serif";
    sessionChainCtx.textAlign = "center";
    sessionChainCtx.textBaseline = "middle";
    sessionChainCtx.fillText("まだセッションが保存されていません。", w / 2, h / 2);
    return;
  }

  // 各セッションの最終理解度％（finalDisplayRate）を配列化
  const finalRates = sessions.map(s => {
    if (typeof s.finalDisplayRate === "number") {
      let v = s.finalDisplayRate;
      if (v < 0) v = 0;
      if (v > 100) v = 100;
      return v;
    }
    // finalDisplayRate が無い古いデータ向けフォールバック
    const hist = s.points || [];
    if (hist.length === 0) return 0;
    let v = hist[hist.length - 1].rate;
    if (v < 0) v = 0;
    if (v > 100) v = 100;
    return v;
  });

  // ★スタート地点 0% を先頭に追加して表示用配列を作る
  // ★表示用配列：最初は0（第1セッションのスタート）、続いて各セッション最終理解度
  const displayRates = [0, ...finalRates];

  const L = 60, R = 30, T = 40, B = 70;
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

  // Y軸（0〜100）
  const yTicks = [0, 25, 50, 75, 100];
  sessionChainCtx.font = "13px sans-serif";
  sessionChainCtx.textAlign = "right";
  sessionChainCtx.textBaseline = "middle";

  yTicks.forEach(v => {
    const y = valueToY(v, h, B, plotH);

    if (v === 0) {
      sessionChainCtx.strokeStyle = "#FFFFFF";
      sessionChainCtx.lineWidth = 2;
      sessionChainCtx.setLineDash([]);
    } else {
      sessionChainCtx.strokeStyle = "#555555";
      sessionChainCtx.lineWidth = 1;
      sessionChainCtx.setLineDash([6, 4]);
    }

    sessionChainCtx.beginPath();
    sessionChainCtx.moveTo(L, y);
    sessionChainCtx.lineTo(w - R, y);
    sessionChainCtx.stroke();

    sessionChainCtx.setLineDash([]);
    sessionChainCtx.fillStyle = "#FFFFFF";
    sessionChainCtx.fillText(v + "%", L - 8, y);
  });

  // X軸方向：スタート＋セッション数分を等間隔に配置
  const pointCount = displayRates.length; // 0スタートを含めた点の数
  const pointCount = displayRates.length; // 0スタート＋各セッション
  const stepX = pointCount > 1 ? plotW / (pointCount - 1) : 0;

  const xPositions = [];
  for (let i = 0; i < pointCount; i++) {
    xPositions.push(L + stepX * i);
  }

  // 折れ線（全体）を描画
  sessionChainCtx.lineWidth = 3;
  sessionChainCtx.setLineDash([]);
  sessionChainCtx.beginPath();
  displayRates.forEach((rate, idx) => {
    const x = xPositions[idx];
    const y = valueToY(rate, h, B, plotH);
    if (idx === 0) sessionChainCtx.moveTo(x, y);
    else sessionChainCtx.lineTo(x, y);
  });
  sessionChainCtx.strokeStyle = "#ffffff88";
  sessionChainCtx.stroke();

  // 各セッションの頂点とラベル（スタート0は点だけ or ラベルだけにする）
  // 各点（セッションカラー＆ラベル）
  displayRates.forEach((rate, idx) => {
    const x = xPositions[idx];
    const y = valueToY(rate, h, B, plotH);

    if (idx === 0) {
      // スタート0点（色はグレー系）
      sessionChainCtx.fillStyle = "#9ca3af";
      // ★第1セッションのスタート（0%）もセッション1の色で表示
      const color =
        sessions[0].color ||
        SESSION_COLORS[Math.min(0, SESSION_COLORS.length - 1)];
      sessionChainCtx.fillStyle = color;
      sessionChainCtx.beginPath();
      sessionChainCtx.arc(x, y, 5, 0, Math.PI * 2);
      sessionChainCtx.fill();

      sessionChainCtx.font = "12px sans-serif";
      sessionChainCtx.fillStyle = "#9ca3af";
      sessionChainCtx.fillStyle = "#FFFFFF";
      sessionChainCtx.textAlign = "center";
      sessionChainCtx.textBaseline = "bottom";
      sessionChainCtx.fillText("0%", x, y - 6);
      return;
    }

    // セッションの点
    const sessionIndex = idx - 1; // displayRates[1] がセッション1
    const sessionIndex = idx - 1; // displayRates[1] がセッション1の最終理解度
    const color =
      sessions[sessionIndex].color ||
      SESSION_COLORS[Math.min(sessionIndex, SESSION_COLORS.length - 1)];

    // 点
    sessionChainCtx.fillStyle = color;
    sessionChainCtx.beginPath();
    sessionChainCtx.arc(x, y, 5, 0, Math.PI * 2);
    sessionChainCtx.fill();

    // パーセント表示
    sessionChainCtx.font = "14px sans-serif";
    sessionChainCtx.fillStyle = "#FFFFFF";
    sessionChainCtx.textAlign = "center";
    sessionChainCtx.textBaseline = "bottom";
    sessionChainCtx.fillText(`${Math.round(rate)}%`, x, y - 8);
  });

  // セッション番号ラベル（下に 1,2,3 のように表示）
  // 下側のラベル（左から セッション1, セッション2, ...）
  sessionChainCtx.font = "12px sans-serif";
  sessionChainCtx.fillStyle = "#9CA3AF";
  sessionChainCtx.textAlign = "center";
  sessionChainCtx.textBaseline = "top";

  // スタート位置
  sessionChainCtx.fillText("スタート", xPositions[0], h - B + 10);

  // 各セッション
  for (let i = 0; i < sessions.length; i++) {
    const x = xPositions[i + 1]; // 0番目はスタート
    const labelIdx = i + 1;
  for (let i = 0; i < displayRates.length; i++) {
    const x = xPositions[i];
    const labelIdx = i + 1; // i=0 → セッション1
    sessionChainCtx.fillText(`セッション${labelIdx}`, x, h - B + 10);
  }

  // タイトル
  sessionChainCtx.font = "15px sans-serif";
  sessionChainCtx.fillStyle = "#FFFFFF";
  sessionChainCtx.textAlign = "left";
  sessionChainCtx.textBaseline = "top";
  sessionChainCtx.fillText(
    "セッション別 最終理解度 推移（スタート0％ → 各セッションのリセット時理解率）",
    "セッション別 最終理解度 推移（第1セッションは0％スタート → 各セッションのリセット時理解率）",
    L + 4,
    6
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
// ・現在セッションを prevSessions に保存
// ・finalDisplayRate には「リセット時の理解率(u/(u+n))」を保存

if (btnReset) {
  btnReset.addEventListener("click", async () => {
    const ok = confirm(
      "現在セッションの票・コメント・グラフをリセットします。\n本当に実行しますか？"
    );
    if (!ok) return;

    try {
      const currentColor = getCurrentColor();

      if (history.length > 0) {
        // ★ リセット時点の理解率（画面右端の「理解率」と同じ計算）
        // リセット時点の理解率（画面右端の「理解率」と同じ計算）
        const u = Number(numUnderstood.textContent) || 0;
        const n = Number(numNotUnderstood.textContent) || 0;
        const total = u + n;
        let finalDisplayRate =
          total > 0 ? Math.round((u / total) * 100) : 0;
        if (finalDisplayRate < 0) finalDisplayRate = 0;
        if (finalDisplayRate > 100) finalDisplayRate = 100;

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

  if (!animationStarted) {
    animationStarted = true;
    requestAnimationFrame(drawLineChart);
  }

  drawPrevSessions();
  drawSessionChain();
}

// ===============================
// admin.js（パスワード cpa1968 / 太線・大文字版）
// ===============================
//
// ● 現在セッション & 過去セッションのグラフ
//   ・値 = (理解できた − 理解できなかった) ÷ 想定人数 × 100
//   ・範囲は 0〜100（マイナスは 0 にクリップ）
//   ・各セッションのグラフは「必ず 0 からスタート」して見せる
// ● 過去セッション
//   ・history（rate推移）に加えて
//     「リセット時の理解率（理解できた ÷ 合計）」を finalDisplayRate として保存
// ● 連結グラフ
//   ・各セッション 1 点のみ（finalDisplayRate）をプロット
//   ・セッション1→2→3 を折れ線でつなぐ
// ● パスワード
//   ・ADMIN_PASSWORD = "cpa1968"

const ADMIN_PASSWORD = "cpa1968";

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
const prevRateLabels = [
  document.getElementById("prevChart-rate1"),
  document.getElementById("prevChart-rate2"),
  document.getElementById("prevChart-rate3")
];
const prevCtxs = prevCanvases.map(c => (c ? c.getContext("2d") : null));

// セッション1〜3連結グラフ用キャンバス
const sessionChainCanvas = document.getElementById("sessionChain");
const sessionChainCtx = sessionChainCanvas
  ? sessionChainCanvas.getContext("2d")
  : null;

// ===============================
// 状態管理
// ===============================

// 現在セッションの履歴 [{ ts, rate }]
let history = [];

// 過去セッション（最大3件）
// 先頭: 一番新しいセッション
// { color: "#xxxxxx", points: [{ts, rate}, ...], finalDisplayRate: number }
let prevSessions = [];

// リセット回数（0:初回, 1:1回目リセット後, 2:2回目…）
let resetCount = 0;

// セッション色（Aの指定）
const SESSION_COLORS = ["#4fc3f7", "#ff5252", "#66bb6a"];

// 描画ループフラグ
let animationStarted = false;

// ===============================
// ユーティリティ
// ===============================

// 現在セッションの色
function getCurrentColor() {
  const idx = Math.min(resetCount, SESSION_COLORS.length - 1);
  return SESSION_COLORS[idx];
}

// 0〜100 の値をキャンバスY座標に変換（0:下端, 100:上端）
function valueToY(value, canvasHeight, bottomPadding, plotHeight) {
  let v = Math.max(0, Math.min(100, value)); // 0〜100 にクリップ
  const ratio = v / 100; // 0〜1
  return canvasHeight - bottomPadding - ratio * plotHeight;
}

// ===============================
// 結果取得（サーバーから）
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

    // 票数表示
    numUnderstood.textContent = u;
    numNotUnderstood.textContent = n;
    numTotal.textContent = total;

    // 表示用理解率（普通の％）= understood / total
    const rateDisplay = total > 0 ? Math.round((u / total) * 100) : 0;
    rateUnderstood.textContent = rateDisplay + "%";

    // --- グラフ用の値（0〜100） ---
    // (理解 − 不理解) / maxP * 100 を使用
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
      // 想定人数が未設定 → グラフは描かない
      rate = null;
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

    // 描画スタート
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
// 履歴管理
// ===============================

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

// ===============================
// 現在セッションのグラフ描画
// （0スタート演出 / 太線・大フォント）
// ===============================

function drawLineChart() {
  const w = canvas.width;
  const h = canvas.height;

  // 背景
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, w, h);

  const maxP = Number(maxInput.value || "0");

  if (maxP <= 0) {
    ctx.fillStyle = "#CCCCCC";
    ctx.font = "32px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("想定人数が未設定のため、グラフは表示されません。", w / 2, h / 2);
    requestAnimationFrame(drawLineChart);
    return;
  }

  if (history.length === 0) {
    ctx.fillStyle = "#CCCCCC";
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
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 4;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(L, T);
  ctx.lineTo(L, h - B);
  ctx.lineTo(w - R, h - B);
  ctx.stroke();

  // Y軸目盛（0,25,50,75,100）
  const yTicks = [0, 25, 50, 75, 100];
  ctx.font = "28px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  yTicks.forEach(v => {
    const y = valueToY(v, h, B, plotH);

    ctx.strokeStyle = v === 0 ? "#FFFFFF" : "#666666";
    ctx.lineWidth = v === 0 ? 4 : 2;
    ctx.setLineDash(v === 0 ? [] : [10, 10]);

    ctx.beginPath();
    ctx.moveTo(L, y);
    ctx.lineTo(w - R, y);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(v + "%", L - 10, y);
  });

  // X方向補助線
  ctx.strokeStyle = "#666666";
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 10]);
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
  ctx.lineWidth = 6;
  ctx.setLineDash([]);
  ctx.beginPath();

  history.forEach((p, i) => {
    // 1点目だけは 0 として描画（0スタート演出）
    const displayRate = i === 0 ? 0 : p.rate;
    const x = L + i * stepX;
    const y = valueToY(displayRate, h, B, plotH);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // タイトル
  ctx.font = "32px sans-serif";
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(
    "現在セッション理解度推移（0〜100％）",
    L,
    8
  );

  requestAnimationFrame(drawLineChart);
}

// ===============================
// 過去セッションのグラフ描画
// ・各セッション 1 点目は 0 として描画（0スタート）
// ・右横に「最終理解度：◯◯％」を表示
//  ※最終理解度は「リセット時の理解率（理解できた ÷ 合計）」
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
    const color = session.color;

    if (note) {
      const label = i === 0 ? "1つ前" : i === 1 ? "2つ前" : "3つ前";
      note.textContent = `${label}のセッション：理解度の推移（0〜100％）`;
    }

    // ★ 最終理解度％を表示
    let finalRate;
    if (typeof session.finalDisplayRate === "number") {
      finalRate = Math.max(0, Math.min(100, session.finalDisplayRate));
    } else {
      // 古いデータで finalDisplayRate が無い場合は最後の rate を使用
      const lastPoint = hist[hist.length - 1];
      let lastRate = lastPoint ? lastPoint.rate : 0;
      finalRate = Math.max(0, Math.min(100, lastRate));
    }

    if (rateLabel) {
      rateLabel.textContent = `（最終理解度：${Math.round(finalRate)}%）`;
    }

    const L = 60, R = 40, T = 40, B = 60;
    const plotW = w - L - R;
    const plotH = h - T - B;

    // 外枠
    pctx.strokeStyle = "#FFFFFF";
    pctx.lineWidth = 4;
    pctx.setLineDash([]);
    pctx.beginPath();
    pctx.moveTo(L, T);
    pctx.lineTo(L, h - B);
    pctx.lineTo(w - R, h - B);
    pctx.stroke();

    // Y軸（0〜100）
    const yTicks = [0, 25, 50, 75, 100];
    pctx.font = "26px sans-serif";
    pctx.textAlign = "right";
    pctx.textBaseline = "middle";

    yTicks.forEach(v => {
      const y = valueToY(v, h, B, plotH);

      pctx.strokeStyle = v === 0 ? "#FFFFFF" : "#666666";
      pctx.lineWidth = v === 0 ? 4 : 2;
      pctx.setLineDash(v === 0 ? [] : [10, 10]);

      pctx.beginPath();
      pctx.moveTo(L, y);
      pctx.lineTo(w - R, y);
      pctx.stroke();

      pctx.setLineDash([]);
      pctx.fillStyle = "#FFFFFF";
      pctx.fillText(v + "%", L - 10, y);
    });

    // X補助線
    pctx.strokeStyle = "#666666";
    pctx.lineWidth = 2;
    pctx.setLineDash([10, 10]);
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
    pctx.strokeStyle = color || "#4fc3f7";
    pctx.lineWidth = 5;
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

// ===============================
// セッション1〜3 連結グラフ
// ・各セッションの「最終理解度(finalDisplayRate)」を1点として表示
// ・セッション1→2→3を太線で結ぶ
// ===============================

function drawSessionChain() {
  if (!sessionChainCanvas || !sessionChainCtx) return;

  const w = sessionChainCanvas.width;
  const h = sessionChainCanvas.height;

  sessionChainCtx.fillStyle = "#000000";
  sessionChainCtx.fillRect(0, 0, w, h);

  // 最新→古い順 → 古い順に並べ替え
  const sessionsNewest = prevSessions.slice(0, 3);
  const sessions = sessionsNewest
    .slice()
    .reverse()
    .filter(s => s && s.points && s.points.length > 0);

  if (sessions.length === 0) {
    sessionChainCtx.fillStyle = "#CCCCCC";
    sessionChainCtx.font = "40px sans-serif";
    sessionChainCtx.textAlign = "center";
    sessionChainCtx.textBaseline = "middle";
    sessionChainCtx.fillText("まだセッションがありません", w / 2, h / 2);
    return;
  }

  // 各セッションの最終理解度（リセット時の理解率）を取得
  const finalRates = sessions.map(s => {
    if (typeof s.finalDisplayRate === "number") {
      return Math.max(0, Math.min(100, s.finalDisplayRate));
    }
    const last = s.points[s.points.length - 1];
    const base = last ? last.rate : 0;
    return Math.max(0, Math.min(100, base));
  });

  const L = 120, R = 80, T = 120, B = 150;
  const plotW = w - L - R;
  const plotH = h - T - B;

  // 外枠
  sessionChainCtx.strokeStyle = "#FFFFFF";
  sessionChainCtx.lineWidth = 6;
  sessionChainCtx.setLineDash([]);
  sessionChainCtx.beginPath();
  sessionChainCtx.moveTo(L, T);
  sessionChainCtx.lineTo(L, h - B);
  sessionChainCtx.lineTo(w - R, h - B);
  sessionChainCtx.stroke();

  // Y軸
  const yTicks = [0, 25, 50, 75, 100];
  sessionChainCtx.font = "30px sans-serif";
  sessionChainCtx.textAlign = "right";
  sessionChainCtx.textBaseline = "middle";

  yTicks.forEach(v => {
    const y = valueToY(v, h, B, plotH);

    sessionChainCtx.strokeStyle = v === 0 ? "#FFFFFF" : "#666666";
    sessionChainCtx.lineWidth = v === 0 ? 6 : 3;
    sessionChainCtx.setLineDash(v === 0 ? [] : [20, 20]);

    sessionChainCtx.beginPath();
    sessionChainCtx.moveTo(L, y);
    sessionChainCtx.lineTo(w - R, y);
    sessionChainCtx.stroke();

    sessionChainCtx.setLineDash([]);
    sessionChainCtx.fillStyle = "#FFFFFF";
    sessionChainCtx.fillText(v + "%", L - 20, y);
  });

  // X補助線
  sessionChainCtx.strokeStyle = "#666666";
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

  // セッション数ぶん均等配置
  const count = finalRates.length;
  const stepX = count > 1 ? plotW / (count - 1) : 0;

  // 折れ線として描画
  sessionChainCtx.lineWidth = 8;

  sessions.forEach((session, idx) => {
    const rate = finalRates[idx];
    const x = L + idx * stepX;
    const y = valueToY(rate, h, B, plotH);
    const color =
      session.color ||
      SESSION_COLORS[Math.min(idx, SESSION_COLORS.length - 1)];

    sessionChainCtx.strokeStyle = color;

    if (idx === 0) {
      sessionChainCtx.beginPath();
      sessionChainCtx.moveTo(x, y);
    } else {
      sessionChainCtx.lineTo(x, y);
    }
  });

  sessionChainCtx.stroke();

  // 各セッションの点を大きく描画 & ラベル（セッション番号）
  sessions.forEach((session, idx) => {
    const rate = finalRates[idx];
    const x = L + idx * stepX;
    const y = valueToY(rate, h, B, plotH);
    const color =
      session.color ||
      SESSION_COLORS[Math.min(idx, SESSION_COLORS.length - 1)];

    // 点
    sessionChainCtx.fillStyle = color;
    sessionChainCtx.beginPath();
    sessionChainCtx.arc(x, y, 16, 0, Math.PI * 2);
    sessionChainCtx.fill();

    // 数値ラベル
    sessionChainCtx.font = "28px sans-serif";
    sessionChainCtx.fillStyle = "#FFFFFF";
    sessionChainCtx.textAlign = "center";
    sessionChainCtx.textBaseline = "bottom";
    sessionChainCtx.fillText(`${Math.round(rate)}%`, x, y - 20);
  });

  // タイトル
  sessionChainCtx.font = "40px sans-serif";
  sessionChainCtx.fillStyle = "#FFFFFF";
  sessionChainCtx.textAlign = "left";
  sessionChainCtx.textBaseline = "top";
  sessionChainCtx.fillText(
    "セッション別 最終理解度 推移（リセット時の理解率）",
    L,
    60
  );
}

// ===============================
// コメント表示
// ===============================

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

// ===============================
// 時刻表示
// ===============================

function updateTimeLabel() {
  if (!timeIndicator) return;
  const now = new Date();
  const text = now.toLocaleTimeString("ja-JP", { hour12: false });
  timeIndicator.textContent = `現在時刻：${text}`;
}

// ===============================
// 想定人数保存
// ===============================

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

// ===============================
// テーマ保存
// ===============================

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

// ===============================
// 投票リセット（セッション単位）
// ★ このタイミングで「リセット時の理解率」を計算して保存
// ===============================

if (btnReset) {
  btnReset.addEventListener("click", async () => {
    const ok = confirm(
      "現在セッションの票・コメント・グラフをリセットします。\n本当に実行しますか？"
    );
    if (!ok) return;

    try {
      const currentColor = getCurrentColor();

      // ★ リセット時の理解率（表示の rate-understood と同じ式）
      const u = Number(numUnderstood.textContent) || 0;
      const n = Number(numNotUnderstood.textContent) || 0;
      const total = u + n;
      let finalDisplayRate =
        total > 0 ? Math.round((u / total) * 100) : 0;
      if (finalDisplayRate < 0) finalDisplayRate = 0;
      if (finalDisplayRate > 100) finalDisplayRate = 100;

      // 現在セッションを過去セッションに保存（先頭に追加）
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

// ===============================
// 全投票データ完全リセット
// ===============================

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

// ===============================
// ログイン
// ===============================

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

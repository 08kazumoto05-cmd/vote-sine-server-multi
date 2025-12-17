// ===============================
// admin.js（興味率：カード/現在/過去/連結 + コメント保存＆色分け）
// ===============================
//
// ✅ 平均スコア方式（普通でもグラフが動く） + ✅ 0地点スタート
// ✅ 管理画面キャンバス：白ベース（CSSと同じ見た目）
//
// - 気になる: +1
// - 普通: 0
// - 気にならない: -1
// - 平均スコア = (気になる - 気にならない) / 全投票数
// - 表示% = (平均スコア + 1) / 2 * 100 （0〜100に丸め）
// - グラフは 0% から開始（投票前の基準点）
// - /api/results 互換: understood=気になる, notUnderstood=気にならない, neutral=普通
// - コメントchoice互換: interested/neutral/not-interested, understood/not-understood も吸収
//
// ==== パスワード ====
// 管理パスワード: cpa1968

const ADMIN_PASSWORD = "cpa1968";

// ==== 白テーマ（キャンバス描画用） ====
const CHART_THEME = {
  bg: "#ffffff",          // 背景
  axis: "#111827",        // 枠・軸・主要文字（黒）
  grid: "#d1d5db",        // 罫線（薄グレー）
  gridZero: "#111827",    // 0%ライン（強調）
  text: "#111827",
  muted: "#6b7280",       // サブ文字
};

// ==== DOM取得 ====
const lockScreen = document.getElementById("lock-screen");
const adminContent = document.getElementById("admin-content");
const pwInput = document.getElementById("admin-password");
const btnUnlock = document.getElementById("btn-unlock");
const lockMsg = document.getElementById("lock-message");

const numUnderstood = document.getElementById("num-understood");          // (表示) 気になる
const numNotUnderstood = document.getElementById("num-not-understood");  // (表示) 気にならない
const numTotal = document.getElementById("num-total");
const rateUnderstood = document.getElementById("rate-understood");        // 興味度(カード)

const numNeutral = document.getElementById("num-neutral");

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

// 過去セッション用キャンバス（4枠）
const prevCanvases = [
  document.getElementById("prevChart1"),
  document.getElementById("prevChart2"),
  document.getElementById("prevChart3"),
  document.getElementById("prevChart4"),
];
const prevNotes = [
  document.getElementById("prevChart-note1"),
  document.getElementById("prevChart-note2"),
  document.getElementById("prevChart-note3"),
  document.getElementById("prevChart-note4"),
];
const prevRateLabels = [
  document.getElementById("prevChart-rate1"),
  document.getElementById("prevChart-rate2"),
  document.getElementById("prevChart-rate3"),
  document.getElementById("prevChart-rate4"),
];
const prevCtxs = prevCanvases.map(c => (c ? c.getContext("2d") : null));

// 連結グラフ用キャンバス
const sessionChainCanvas = document.getElementById("sessionChain");
const sessionChainCtx = sessionChainCanvas ? sessionChainCanvas.getContext("2d") : null;

// ==== 状態 ====
// 現在セッションの履歴 [{ ts, rate }]
let history = [];

// prevSessions は「新しい順（0番が最新）」で保存される（unshift）
let prevSessions = [];

let resetCount = 0;

// ★ 4つ目を黄色に
const SESSION_COLORS = ["#4fc3f7", "#ff5252", "#66bb6a", "#ffd600"];

let animationStarted = false;

// ★ 最新取得した「現在セッションのコメント」（リセット直前に退避する）
let latestCurrentComments = [];

// ★ 0地点スタート用：初期点を入れたか
let basePointInserted = false;

// ==== ユーティリティ ====
function getCurrentColor() {
  const idx = Math.min(resetCount, SESSION_COLORS.length - 1);
  return SESSION_COLORS[idx];
}

function clamp100(x) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 100) return 100;
  return x;
}

function valueToY(value, canvasHeight, bottomPadding, plotHeight) {
  const v = clamp100(value);
  return canvasHeight - bottomPadding - (v / 100) * plotHeight;
}

function safeTs(x) {
  const t = Number(x);
  return Number.isFinite(t) ? t : Date.now();
}

// choice の互換吸収
function normalizeChoice(choice) {
  if (choice === "interested") return "positive";
  if (choice === "neutral") return "neutral";
  if (choice === "not-interested") return "negative";

  if (choice === "positive") return "positive";
  if (choice === "negative") return "negative";

  if (choice === "understood") return "positive";
  if (choice === "not-understood") return "negative";

  return "neutral";
}

function normalizeComments(comments) {
  if (!Array.isArray(comments)) return [];
  return comments
    .map(c => ({
      ts: safeTs(c?.ts),
      text: String(c?.text ?? ""),
      choice: normalizeChoice(c?.choice),
    }))
    .filter(c => c.text.trim().length > 0 || c.ts);
}

// ✅ 平均スコア方式（0〜100%）
function calcInterestRateAvg(pos, neu, neg) {
  const totalVotes = (Number(pos) || 0) + (Number(neu) || 0) + (Number(neg) || 0);
  if (totalVotes <= 0) return null;

  const scoreSum = (Number(pos) || 0) - (Number(neg) || 0);
  const avg = scoreSum / totalVotes; // -1..+1
  const pct = (avg + 1) / 2; // 0..1
  return clamp100(pct * 100);
}

// ✅ 0地点スタート：まだ点が無いときに 0% を1点入れる
function ensureBasePoint() {
  if (basePointInserted) return;
  if (history.length > 0) return;
  history.push({ ts: Date.now(), rate: 0 });
  basePointInserted = true;
}

// ==== 結果取得 ====
async function fetchResults() {
  try {
    const res = await fetch("/api/results", { cache: "no-store" });
    if (!res.ok) throw new Error("failed to fetch results");

    const data = await res.json();

    const pos = Number(data.interested ?? data.positive ?? data.understood ?? 0);
    const neu = Number(data.neutral ?? 0);
    const neg = Number(data.notInterested ?? data.negative ?? data.notUnderstood ?? 0);

    const total = pos + neu + neg;

    numUnderstood.textContent = String(pos);
    numNotUnderstood.textContent = String(neg);
    numTotal.textContent = String(total);
    if (numNeutral) numNeutral.textContent = String(neu);

    const rate = calcInterestRateAvg(pos, neu, neg);
    rateUnderstood.textContent = rate === null ? "--%" : `${Math.round(rate)}%`;

    const maxP = Number(data.maxParticipants ?? 0);
    if (document.activeElement !== maxInput) maxInput.value = maxP;

    if (Number(maxP) > 0) {
      maxInfo.textContent = `想定人数：${maxP}人中、${total}人が投票済み`;
    } else {
      maxInfo.textContent = `想定人数が未設定です（先に人数を保存してください）`;
    }

    const theme = data.theme || "";
    themeInfo.textContent = theme ? `現在のテーマ：${theme}` : "現在のテーマ：未設定";
    if (document.activeElement !== themeInput) themeInput.value = theme;

    latestCurrentComments = normalizeComments(data.comments || []);
    renderCommentTimeline(latestCurrentComments);

    if (total === 0) {
      ensureBasePoint();
    } else {
      addRatePoint(rate);
    }

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
  if (rate === null) return;
  const last = history[history.length - 1];
  if (last && last.rate === rate) return;

  history.push({ ts: Date.now(), rate });
  if (history.length > 300) history = history.slice(-300);
}

// ==== 1枚のチャート枠を描く（白テーマ共通化） ====
function drawChartFrame(pctx, w, h, L, R, T, B, titleText, titleSizePx) {
  const plotW = w - L - R;
  const plotH = h - T - B;

  // 背景
  pctx.fillStyle = CHART_THEME.bg;
  pctx.fillRect(0, 0, w, h);

  // 枠（軸）
  pctx.strokeStyle = CHART_THEME.axis;
  pctx.lineWidth = 3;
  pctx.setLineDash([]);
  pctx.beginPath();
  pctx.moveTo(L, T);
  pctx.lineTo(L, h - B);
  pctx.lineTo(w - R, h - B);
  pctx.stroke();

  // 横線＆ラベル
  const yTicks = [0, 25, 50, 75, 100];
  pctx.font = `${titleSizePx - 8}px sans-serif`;
  pctx.textAlign = "right";
  pctx.textBaseline = "middle";

  yTicks.forEach(v => {
    const y = valueToY(v, h, B, plotH);

    const isZero = v === 0;
    pctx.strokeStyle = isZero ? CHART_THEME.gridZero : CHART_THEME.grid;
    pctx.lineWidth = isZero ? 3 : 1.5;
    pctx.setLineDash(isZero ? [] : [10, 10]);

    pctx.beginPath();
    pctx.moveTo(L, y);
    pctx.lineTo(w - R, y);
    pctx.stroke();

    pctx.setLineDash([]);
    pctx.fillStyle = CHART_THEME.text;
    pctx.fillText(v + "%", L - 10, y);
  });

  // 縦点線
  pctx.strokeStyle = CHART_THEME.grid;
  pctx.lineWidth = 1.5;
  pctx.setLineDash([10, 10]);
  [0.25, 0.5, 0.75].forEach(ratio => {
    const x = L + plotW * ratio;
    pctx.beginPath();
    pctx.moveTo(x, T);
    pctx.lineTo(x, h - B);
    pctx.stroke();
  });
  pctx.setLineDash([]);

  // タイトル
  if (titleText) {
    pctx.font = `${titleSizePx}px sans-serif`;
    pctx.fillStyle = CHART_THEME.text;
    pctx.textAlign = "left";
    pctx.textBaseline = "top";
    pctx.fillText(titleText, L + 4, 8);
  }

  return { plotW, plotH };
}

// ==== 現在セッション描画 ====
function drawLineChart() {
  const w = canvas.width;
  const h = canvas.height;

  if (history.length === 0) ensureBasePoint();

  const L = 60, R = 40, T = 40, B = 80;
  const { plotW, plotH } = drawChartFrame(
    ctx, w, h, L, R, T, B,
    "現在セッション興味度推移（0%スタート / 平均スコア方式）",
    28
  );

  // 線
  const stepX = history.length > 1 ? plotW / (history.length - 1) : 0;
  const currentColor = getCurrentColor();

  ctx.strokeStyle = currentColor;
  ctx.lineWidth = 5;
  ctx.beginPath();

  history.forEach((p, i) => {
    const x = L + i * stepX;
    const y = valueToY(p.rate, h, B, plotH);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  requestAnimationFrame(drawLineChart);
}

// ==== 過去セッション描画（グラフ） ====
function drawPrevSessions() {
  const maxSlots = prevCanvases.length;
  const sessionsForDisplay = prevSessions.slice(0, maxSlots);

  for (let i = 0; i < maxSlots; i++) {
    const session = sessionsForDisplay[i];
    const c = prevCanvases[i];
    const note = prevNotes[i];
    const rateLabel = prevRateLabels[i];
    const pctx = prevCtxs[i];

    if (!c || !pctx) continue;

    const w = c.width;
    const h = c.height;

    const shownResetNo = session?.resetNo ?? (resetCount - i > 0 ? (resetCount - i) : "—");

    if (!session || !session.points || session.points.length === 0) {
      // 背景だけ白に
      pctx.fillStyle = CHART_THEME.bg;
      pctx.fillRect(0, 0, w, h);
      if (note) note.textContent = `${shownResetNo}回目のリセットセッション：まだグラフはありません。`;
      if (rateLabel) rateLabel.textContent = "";
      continue;
    }

    if (note) note.textContent = `${session.resetNo}回目のリセットセッション：興味度の推移（0〜100％）`;
    if (rateLabel) {
      const lastRate = clamp100(Number(session.finalRate ?? 0));
      rateLabel.textContent = `（最終興味度：${Math.round(lastRate)}%）`;
    }

    const orig = session.points || [];
    const hist = [{ ts: orig[0]?.ts ?? Date.now(), rate: 0 }, ...orig];
    const color = session.color || "#4fc3f7";

    const L = 60, R = 40, T = 40, B = 60;
    const { plotW, plotH } = drawChartFrame(pctx, w, h, L, R, T, B, "", 24);

    const stepX = hist.length > 1 ? plotW / (hist.length - 1) : 0;

    pctx.strokeStyle = color;
    pctx.lineWidth = 4;
    pctx.beginPath();

    hist.forEach((p, idx) => {
      const x = L + idx * stepX;
      const y = valueToY(p.rate, h, B, plotH);
      if (idx === 0) pctx.moveTo(x, y);
      else pctx.lineTo(x, y);
    });
    pctx.stroke();
  }
}

// ==== 連結グラフ（最大4件） ====
function drawSessionChain() {
  if (!sessionChainCanvas || !sessionChainCtx) return;

  const w = sessionChainCanvas.width;
  const h = sessionChainCanvas.height;

  const sessionsNewestFirst = prevSessions.slice(0, 4);
  const sessionsOldestFirst = sessionsNewestFirst
    .slice()
    .reverse()
    .filter(s => s && s.points && s.points.length > 0);

  if (sessionsOldestFirst.length === 0) {
    sessionChainCtx.fillStyle = CHART_THEME.bg;
    sessionChainCtx.fillRect(0, 0, w, h);
    sessionChainCtx.fillStyle = CHART_THEME.muted;
    sessionChainCtx.font = "26px sans-serif";
    sessionChainCtx.textAlign = "center";
    sessionChainCtx.textBaseline = "middle";
    sessionChainCtx.fillText("まだセッションが保存されていません。", w / 2, h / 2);
    return;
  }

  const chainPoints = [];
  const firstSessionColor = sessionsOldestFirst[0].color || SESSION_COLORS[0];

  chainPoints.push({ rate: 0, color: firstSessionColor, isSessionPoint: false });

  sessionsOldestFirst.forEach((session, idx) => {
    const r = clamp100(Number(session.finalRate ?? 0));
    const color = session.color || SESSION_COLORS[Math.min(idx, SESSION_COLORS.length - 1)];
    chainPoints.push({ rate: r, color, isSessionPoint: true });
  });

  const L = 120, R = 80, T = 120, B = 150;
  const { plotW, plotH } = drawChartFrame(
    sessionChainCtx, w, h, L, R, T, B,
    "セッション1→2→3→4 最終興味度 連結グラフ（0%スタート）",
    30
  );

  const stepX = plotW / Math.max(1, chainPoints.length - 1);

  let lastX = null;
  let lastY = null;

  chainPoints.forEach((pt, idx) => {
    const x = L + stepX * idx;
    const y = valueToY(pt.rate, h, B, plotH);

    if (idx === 0) {
      lastX = x; lastY = y;
      return;
    }

    sessionChainCtx.strokeStyle = pt.color;
    sessionChainCtx.lineWidth = 5;
    sessionChainCtx.beginPath();
    sessionChainCtx.moveTo(lastX, lastY);
    sessionChainCtx.lineTo(x, y);
    sessionChainCtx.stroke();

    lastX = x; lastY = y;
  });

  // ポイント
  const pointRadius = 9;
  chainPoints.forEach((pt, idx) => {
    if (!pt.isSessionPoint) return;

    const x = L + stepX * idx;
    const y = valueToY(pt.rate, h, B, plotH);

    sessionChainCtx.beginPath();
    sessionChainCtx.arc(x, y, pointRadius + 2, 0, Math.PI * 2);
    sessionChainCtx.fillStyle = CHART_THEME.bg;
    sessionChainCtx.fill();
    sessionChainCtx.lineWidth = 2;
    sessionChainCtx.strokeStyle = CHART_THEME.axis;
    sessionChainCtx.stroke();

    sessionChainCtx.beginPath();
    sessionChainCtx.arc(x, y, pointRadius, 0, Math.PI * 2);
    sessionChainCtx.fillStyle = pt.color;
    sessionChainCtx.fill();

    sessionChainCtx.font = "22px sans-serif";
    sessionChainCtx.textAlign = "center";
    sessionChainCtx.textBaseline = "bottom";
    sessionChainCtx.fillStyle = CHART_THEME.text;
    sessionChainCtx.fillText(`${Math.round(pt.rate)}%`, x, y - pointRadius - 10);
  });
}

// ==== コメント表示（現在 + 過去保存分を統合） ====
function renderCommentTimeline(currentComments) {
  commentList.innerHTML = "";

  const currentColor = getCurrentColor();

  const nowItems = (normalizeComments(currentComments) || []).map(c => ({
    ...c,
    sessionLabel: "現在セッション",
    sessionColor: currentColor,
    sessionOrder: 999999,
  }));

  const pastItems = [];
  prevSessions.forEach(s => {
    const label = `${s.resetNo}回目のリセットセッション`;
    const color = s.color || "#888";
    const comments = normalizeComments(s.comments || []);
    comments.forEach(c => {
      pastItems.push({
        ...c,
        sessionLabel: label,
        sessionColor: color,
        sessionOrder: s.resetNo ?? 0,
      });
    });
  });

  const all = [...nowItems, ...pastItems];

  if (all.length === 0) {
    const p = document.createElement("p");
    p.textContent = "まだコメントはありません。";
    p.className = "small-note";
    commentList.appendChild(p);
    return;
  }

  all.sort((a, b) => safeTs(b.ts) - safeTs(a.ts));

  all.forEach(c => {
    const item = document.createElement("div");
    item.className = "comment-item";
    item.style.borderLeft = `6px solid ${c.sessionColor}`;

    const meta = document.createElement("div");
    meta.className = "comment-meta";

    const dot = document.createElement("span");
    dot.style.display = "inline-block";
    dot.style.width = "10px";
    dot.style.height = "10px";
    dot.style.borderRadius = "50%";
    dot.style.background = c.sessionColor;
    dot.style.marginRight = "8px";
    dot.style.verticalAlign = "middle";

    const sessionSpan = document.createElement("span");
    sessionSpan.textContent = c.sessionLabel;
    sessionSpan.style.marginRight = "10px";
    sessionSpan.style.color = c.sessionColor;
    sessionSpan.style.fontWeight = "700";

    const tag = document.createElement("span");
    const ch = normalizeChoice(c.choice);
    if (ch === "positive") {
      tag.className = "comment-tag understood";
      tag.textContent = "気になる";
    } else if (ch === "neutral") {
      tag.className = "comment-tag neutral";
      tag.textContent = "普通";
    } else {
      tag.className = "comment-tag not-understood";
      tag.textContent = "気にならない";
    }

    const time = document.createElement("span");
    let timeText = "";
    try { timeText = new Date(safeTs(c.ts)).toLocaleString("ja-JP"); }
    catch { timeText = String(c.ts || ""); }
    time.textContent = timeText;

    meta.appendChild(dot);
    meta.appendChild(sessionSpan);
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
  timeIndicator.textContent = `現在時刻：${now.toLocaleTimeString("ja-JP", { hour12: false })}`;
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
      alert("想定投票人数を保存しました。");
      await fetchResults();
    } catch (e) {
      console.error(e);
      alert("想定人数の保存に失敗しました。時間をおいて再度お試しください。");
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
      alert("テーマを保存しました。");
      await fetchResults();
    } catch (e) {
      console.error(e);
      alert("テーマの保存に失敗しました。");
    }
  });
}

// ==== 投票リセット（セッション単位） ====
if (btnReset) {
  btnReset.addEventListener("click", async () => {
    const ok = confirm("現在セッションの票・コメント・グラフをリセットします。\n本当に実行しますか？");
    if (!ok) return;

    try {
      const currentColor = getCurrentColor();

      if (history.length > 0) {
        const lastRate = clamp100(history[history.length - 1].rate);
        const copy = history.map(p => ({ ts: p.ts, rate: p.rate }));

        const resetNo = resetCount + 1;
        const savedComments = normalizeComments(latestCurrentComments);

        prevSessions.unshift({
          resetNo,
          color: currentColor,
          points: copy,
          finalRate: lastRate,
          comments: savedComments,
        });

        if (prevSessions.length > 4) prevSessions = prevSessions.slice(0, 4);

        drawPrevSessions();
        drawSessionChain();
        renderCommentTimeline([]);
      }

      const res = await fetch("/api/admin/reset", { method: "POST" });
      if (!res.ok) throw new Error("failed to reset");

      resetCount++;
      history = [];
      latestCurrentComments = [];
      basePointInserted = false;

      await fetchResults();
      drawPrevSessions();
      drawSessionChain();

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
    const ok = confirm("現在セッション＋過去のセッションのグラフ/コメントをすべて削除します。\n本当に完全リセットしますか？");
    if (!ok) return;

    try {
      const res = await fetch("/api/admin/reset-all", { method: "POST" });
      if (!res.ok) throw new Error("failed to reset all");

      history = [];
      prevSessions = [];
      resetCount = 0;
      latestCurrentComments = [];
      basePointInserted = false;

      drawPrevSessions();
      drawSessionChain();
      renderCommentTimeline([]);

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

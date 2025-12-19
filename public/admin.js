// ===============================
// admin.js（興味率：カード/現在/過去/連結 + コメント保存＆色分け + スマホ高解像度 + スマホだけ過去グラフ拡大）
// ===============================
//
// 修正点（重要）
// ✅ 過去セッション保存が消える原因を修正：fetchのたびに history を初期化しない
//    → sessionId 同期は「増えた時だけ」行う（reset/reset-all 直後のみ）
// ✅ 全リセット後の色継続を完全に消す：resetCount / prevSessions / chain起点色 を初期化
//
// ==== パスワード ====
// 管理パスワード: cpa1968

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
const numNeutral = document.getElementById("num-neutral");

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
// 現在セッションの履歴 [{ ts, rate, choice }]
let history = [];

// prevSessions は「新しい順（0番が最新）」
// { resetNo, color, points:[{ts,rate,choice}], finalRate, comments:[{ts,text,choice}] }
let prevSessions = [];

// resetCount = これまでのリセット回数（= sessionId - 1）
let resetCount = 0;

// server sessionId（増えた時だけ同期する）
let currentServerSessionId = null;

// 直近投票判定用
let lastCounts = null; // { pos, neu, neg, total }
let lastActionChoice = null;

// 現在セッションのコメント（リセット時に保存する用）
let latestCurrentComments = [];

// 0地点スタート用
let basePointInserted = false;

const SESSION_COLORS = ["#4fc3f7", "#ff5252", "#66bb6a", "#ffd600"];
let animationStarted = false;

const CHOICE_COLORS = {
  positive: "#22c55e",
  neutral:  "#334155",
  negative: "#ec4899",
  none:     "#94a3b8",
};

const CANVAS_THEME = {
  bg: "#ffffff",
  axis: "#111827",
  grid: "#e5e7eb",
  gridStrong: "#cbd5e1",
  text: "#111827",
  subText: "#475569",
};

// =======================================
// ✅ スマホ判定（PCは一切変えない）
// =======================================
function isMobileView() {
  return window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
}

// =======================================
// ✅ Canvas DPR対応 + CSSサイズ取得
// =======================================
function getCssPxSize(el) {
  if (!el) return { w: 0, h: 0 };
  const rect = el.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  return { w, h };
}

function setupHiDPICanvas(el, context) {
  if (!el || !context) return;

  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const { w, h } = getCssPxSize(el);
  if (!w || !h) return;

  const targetW = Math.floor(w * dpr);
  const targetH = Math.floor(h * dpr);

  if (el.width !== targetW || el.height !== targetH) {
    el.width = targetW;
    el.height = targetH;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

// =======================================
// ✅ スマホだけ「過去セッションcanvas」を拡大
// =======================================
const MOBILE_PREV_SCALE_W = 1.5;
const MOBILE_PREV_SCALE_H = 2.0;

function applyMobilePrevChartSizing() {
  if (!isMobileView()) {
    prevCanvases.forEach(c => {
      if (!c) return;
      c.style.width = "";
      c.style.height = "";
      c.style.maxWidth = "";
      c.style.display = "";
    });
    return;
  }

  prevCanvases.forEach(c => {
    if (!c) return;
    const before = c.getBoundingClientRect();
    const baseW = Math.max(1, Math.floor(before.width));
    const baseH = Math.max(1, Math.floor(before.height));

    const newW = Math.round(baseW * MOBILE_PREV_SCALE_W);
    const newH = Math.round(baseH * MOBILE_PREV_SCALE_H);

    c.style.display = "block";
    c.style.width = `${newW}px`;
    c.style.height = `${newH}px`;
    c.style.maxWidth = "none";
  });
}

function setupAllCanvasesHiDPI() {
  applyMobilePrevChartSizing();
  setupHiDPICanvas(canvas, ctx);
  prevCanvases.forEach((c, i) => setupHiDPICanvas(c, prevCtxs[i]));
  setupHiDPICanvas(sessionChainCanvas, sessionChainCtx);
}

window.addEventListener("resize", () => {
  setupAllCanvasesHiDPI();
  drawPrevSessions();
  drawSessionChain();
});

// ==== ユーティリティ ====
function sessionNoToColor(sessionNo) {
  const idx = Math.max(0, (Number(sessionNo) || 1) - 1) % SESSION_COLORS.length;
  return SESSION_COLORS[idx];
}
function getCurrentColor() {
  return sessionNoToColor(resetCount + 1);
}
function clamp100(x) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 100) return 100;
  return x;
}
function valueToY(value, canvasCssHeight, bottomPadding, plotHeight) {
  const v = clamp100(value);
  return canvasCssHeight - bottomPadding - (v / 100) * plotHeight;
}
function safeTs(x) {
  const t = Number(x);
  return Number.isFinite(t) ? t : Date.now();
}
function choiceToLabel(choice) {
  if (choice === "positive") return "気になる";
  if (choice === "neutral") return "普通";
  if (choice === "negative") return "気にならない";
  return "—";
}
function choiceToColor(choice) {
  if (choice === "positive") return CHOICE_COLORS.positive;
  if (choice === "neutral") return CHOICE_COLORS.neutral;
  if (choice === "negative") return CHOICE_COLORS.negative;
  return CHOICE_COLORS.none;
}
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
function calcInterestRateAvg(pos, neu, neg) {
  const totalVotes = (Number(pos) || 0) + (Number(neu) || 0) + (Number(neg) || 0);
  if (totalVotes <= 0) return null;
  const scoreSum = (Number(pos) || 0) - (Number(neg) || 0);
  const avg = scoreSum / totalVotes; // -1..+1
  const pct = (avg + 1) / 2; // 0..1
  return clamp100(pct * 100);
}
function ensureBasePoint() {
  if (basePointInserted) return;
  if (history.length > 0) return;
  history.push({ ts: Date.now(), rate: 0, choice: null });
  basePointInserted = true;
}
function detectLastActionChoice(pos, neu, neg) {
  if (!lastCounts) return null;

  const dPos = pos - lastCounts.pos;
  const dNeu = neu - lastCounts.neu;
  const dNeg = neg - lastCounts.neg;

  const inc = dPos + dNeu + dNeg;
  if (inc <= 0) return null;

  let choice = null;
  let maxDelta = 0;

  if (dPos > maxDelta) { maxDelta = dPos; choice = "positive"; }
  if (dNeu > maxDelta) { maxDelta = dNeu; choice = "neutral"; }
  if (dNeg > maxDelta) { maxDelta = dNeg; choice = "negative"; }

  return choice;
}

// ✅ sessionId 同期：増えた時だけ「現在セッション追跡」だけ初期化する
function onServerSessionAdvanced(newSid) {
  const sid = Number(newSid);
  if (!Number.isFinite(sid) || sid < 1) return;

  resetCount = Math.max(0, sid - 1);

  // 現在セッション追跡のみ初期化
  history = [];
  latestCurrentComments = [];
  basePointInserted = false;

  lastCounts = null;
  lastActionChoice = null;

  ensureBasePoint();
}

// ==== 結果取得 ====
async function fetchResults() {
  try {
    const res = await fetch("/api/results", { cache: "no-store" });
    if (!res.ok) throw new Error("failed to fetch results");
    const data = await res.json();

    // ✅ sessionId は「増えた時だけ」同期（重要：毎回historyを消さない）
    const sid = Number(data.sessionId);
    if (Number.isFinite(sid) && sid >= 1) {
      if (currentServerSessionId == null) {
        currentServerSessionId = sid;
        // 初回は“消さない”。表示開始のために basePoint だけ保証
        ensureBasePoint();
      } else if (sid !== currentServerSessionId) {
        // sessionが進んだ（管理者reset/reset-allが走った）
        currentServerSessionId = sid;
        onServerSessionAdvanced(sid);
      }
    }

    // /api/results 互換
    const pos = Number(data.interested ?? data.positive ?? data.understood ?? 0);
    const neu = Number(data.neutral ?? 0);
    const neg = Number(data.notInterested ?? data.negative ?? data.notUnderstood ?? 0);
    const total = pos + neu + neg;

    if (numUnderstood) numUnderstood.textContent = String(pos);
    if (numNotUnderstood) numNotUnderstood.textContent = String(neg);
    if (numTotal) numTotal.textContent = String(total);
    if (numNeutral) numNeutral.textContent = String(neu);

    const rate = calcInterestRateAvg(pos, neu, neg);
    if (rateUnderstood) rateUnderstood.textContent = rate === null ? "--%" : `${Math.round(rate)}%`;

    const maxP = Number(data.maxParticipants ?? 0);
    if (maxInput && document.activeElement !== maxInput) maxInput.value = maxP;
    if (maxInfo) {
      if (Number(maxP) > 0) maxInfo.textContent = `想定人数：${maxP}人中、${total}人が投票済み`;
      else maxInfo.textContent = `想定人数が未設定です（先に人数を保存してください）`;
    }

    const theme = data.theme || "";
    if (themeInfo) themeInfo.textContent = theme ? `現在のテーマ：${theme}` : "現在のテーマ：未設定";
    if (themeInput && document.activeElement !== themeInput) themeInput.value = theme;

    // コメント
    latestCurrentComments = normalizeComments(data.comments || []);
    renderCommentTimeline(latestCurrentComments);

    // 直近投票推定
    const detected = detectLastActionChoice(pos, neu, neg);
    if (detected) lastActionChoice = detected;
    lastCounts = { pos, neu, neg, total };

    if (total === 0) {
      ensureBasePoint();
      lastActionChoice = null;
    } else {
      addRatePoint(rate, detected);
    }

    setupAllCanvasesHiDPI();

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
function addRatePoint(rate, choice) {
  if (rate === null) return;
  const last = history[history.length - 1];
  if (last && last.rate === rate && (choice == null || last.choice === choice)) return;
  history.push({ ts: Date.now(), rate, choice: choice ?? null });
  if (history.length > 300) history = history.slice(-300);
}

// ==== 現在セッション描画 ====
function drawLineChart() {
  if (!canvas || !ctx) {
    requestAnimationFrame(drawLineChart);
    return;
  }

  const { w, h } = getCssPxSize(canvas);
  if (!w || !h) {
    requestAnimationFrame(drawLineChart);
    return;
  }

  ctx.fillStyle = CANVAS_THEME.bg;
  ctx.fillRect(0, 0, w, h);

  if (history.length === 0) ensureBasePoint();

  const L = 70, R = 30, T = 44, B = 82;
  const plotW = w - L - R;
  const plotH = h - T - B;

  // 軸
  ctx.strokeStyle = CANVAS_THEME.axis;
  ctx.lineWidth = 3;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(L, T);
  ctx.lineTo(L, h - B);
  ctx.lineTo(w - R, h - B);
  ctx.stroke();

  // 横線
  const yTicks = [0, 25, 50, 75, 100];
  ctx.font = "22px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  yTicks.forEach(v => {
    const y = valueToY(v, h, B, plotH);
    ctx.strokeStyle = v === 0 ? CANVAS_THEME.gridStrong : CANVAS_THEME.grid;
    ctx.lineWidth = v === 0 ? 2.5 : 1.5;
    ctx.setLineDash(v === 0 ? [] : [8, 8]);

    ctx.beginPath();
    ctx.moveTo(L, y);
    ctx.lineTo(w - R, y);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = CANVAS_THEME.subText;
    ctx.fillText(v + "%", L - 10, y);
  });

  // 縦点線
  ctx.strokeStyle = CANVAS_THEME.grid;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([8, 8]);
  [0.25, 0.5, 0.75].forEach(ratio => {
    const x = L + plotW * ratio;
    ctx.beginPath();
    ctx.moveTo(x, T);
    ctx.lineTo(x, h - B);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  // 区間（p1.choice色）
  const stepX = history.length > 1 ? plotW / (history.length - 1) : 0;
  for (let i = 1; i < history.length; i++) {
    const p0 = history[i - 1];
    const p1 = history[i];
    const x0 = L + (i - 1) * stepX;
    const y0 = valueToY(p0.rate, h, B, plotH);
    const x1 = L + i * stepX;
    const y1 = valueToY(p1.rate, h, B, plotH);

    ctx.strokeStyle = choiceToColor(p1.choice);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  // 点
  const r = 4;
  for (let i = 0; i < history.length; i++) {
    const p = history[i];
    const x = L + i * stepX;
    const y = valueToY(p.rate, h, B, plotH);

    ctx.beginPath();
    ctx.arc(x, y, r + 2, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = choiceToColor(p.choice);
    ctx.fill();
  }

  // タイトル
  ctx.font = "24px sans-serif";
  ctx.fillStyle = CANVAS_THEME.text;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("現在セッション興味度推移（直近票で色変化 / 0%スタート）", L, 10);

  // 直近票
  const label = `直近の投票：${choiceToLabel(lastActionChoice)}`;
  ctx.font = "20px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillStyle = CANVAS_THEME.subText;
  ctx.fillText(label, w - R, 12);

  const chipW = 14, chipH = 10;
  ctx.fillStyle = choiceToColor(lastActionChoice);
  ctx.fillRect(w - R - chipW - 8, 16, chipW, chipH);
  ctx.strokeStyle = CANVAS_THEME.gridStrong;
  ctx.lineWidth = 1;
  ctx.strokeRect(w - R - chipW - 8, 16, chipW, chipH);

  requestAnimationFrame(drawLineChart);
}

// ==== 過去セッション描画 ====
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

    const { w, h } = getCssPxSize(c);
    if (!w || !h) continue;

    pctx.fillStyle = "#ffffff";
    pctx.fillRect(0, 0, w, h);

    if (!session || !Array.isArray(session.points) || session.points.length === 0) {
      if (note) note.textContent = `—：まだグラフはありません。`;
      if (rateLabel) rateLabel.textContent = "";
      continue;
    }

    if (note) note.textContent = `${session.resetNo}回目セッション：興味度の推移（直近票で色変化）`;
    if (rateLabel) {
      const lastRate = clamp100(Number(session.finalRate ?? 0));
      rateLabel.textContent = `（最終興味度：${Math.round(lastRate)}%）`;
    }

    const orig = session.points || [];
    const firstTs = orig[0]?.ts ?? Date.now();
    const hist = [{ ts: firstTs, rate: 0, choice: null }, ...orig.map(p => ({
      ts: safeTs(p?.ts),
      rate: clamp100(Number(p?.rate ?? 0)),
      choice: p?.choice ?? null,
    }))];

    const mobile = isMobileView();
    const L = mobile ? 72 : 60;
    const R = mobile ? 36 : 30;
    const T = mobile ? 40 : 34;
    const B = mobile ? 60 : 52;

    const plotW = w - L - R;
    const plotH = h - T - B;

    // 軸
    pctx.strokeStyle = "#111827";
    pctx.lineWidth = 2.5;
    pctx.setLineDash([]);
    pctx.beginPath();
    pctx.moveTo(L, T);
    pctx.lineTo(L, h - B);
    pctx.lineTo(w - R, h - B);
    pctx.stroke();

    const yTicks = [0, 25, 50, 75, 100];
    pctx.font = mobile ? "18px sans-serif" : "16px sans-serif";
    pctx.textAlign = "right";
    pctx.textBaseline = "middle";

    yTicks.forEach(v => {
      const y = valueToY(v, h, B, plotH);
      pctx.strokeStyle = v === 0 ? "#cbd5e1" : "#e5e7eb";
      pctx.lineWidth = v === 0 ? 2 : 1;
      pctx.setLineDash(v === 0 ? [] : [6, 6]);
      pctx.beginPath();
      pctx.moveTo(L, y);
      pctx.lineTo(w - R, y);
      pctx.stroke();

      pctx.setLineDash([]);
      pctx.fillStyle = "#475569";
      pctx.fillText(v + "%", L - (mobile ? 10 : 8), y);
    });

    // 線（choice色）
    const stepX = hist.length > 1 ? plotW / (hist.length - 1) : 0;
    for (let k = 1; k < hist.length; k++) {
      const p0 = hist[k - 1];
      const p1 = hist[k];
      const x0 = L + (k - 1) * stepX;
      const y0 = valueToY(p0.rate, h, B, plotH);
      const x1 = L + k * stepX;
      const y1 = valueToY(p1.rate, h, B, plotH);

      pctx.strokeStyle = choiceToColor(p1.choice);
      pctx.lineWidth = mobile ? 4.2 : 3.5;
      pctx.beginPath();
      pctx.moveTo(x0, y0);
      pctx.lineTo(x1, y1);
      pctx.stroke();
    }
  }
}

// ==== 連結グラフ ====
// ✅ 全リセット後の色残り対策：起点(0%)の色は「必ず 1回目=青」に固定
function drawSessionChain() {
  if (!sessionChainCanvas || !sessionChainCtx) return;

  const { w, h } = getCssPxSize(sessionChainCanvas);
  if (!w || !h) return;

  sessionChainCtx.fillStyle = "#ffffff";
  sessionChainCtx.fillRect(0, 0, w, h);

  const sessionsNewestFirst = prevSessions.slice(0, 4);
  const sessionsOldestFirst = sessionsNewestFirst
    .slice()
    .reverse()
    .filter(s => s && s.points && s.points.length > 0);

  if (sessionsOldestFirst.length === 0) {
    sessionChainCtx.fillStyle = "#64748b";
    sessionChainCtx.font = "28px sans-serif";
    sessionChainCtx.textAlign = "center";
    sessionChainCtx.textBaseline = "middle";
    sessionChainCtx.fillText("まだセッションが保存されていません。", w / 2, h / 2);
    return;
  }

  const chainPoints = [];

  // ★起点は常に「1回目=青」（全リセット後に色が残らない）
  chainPoints.push({ rate: 0, color: sessionNoToColor(1), isSessionPoint: false });

  sessionsOldestFirst.forEach(session => {
    const r = clamp100(Number(session.finalRate ?? 0));
    const color = session.color || sessionNoToColor(session.resetNo || 1);
    chainPoints.push({ rate: r, color, isSessionPoint: true });
  });

  const L = 90, R = 40, T = 80, B = 90;
  const plotW = w - L - R;
  const plotH = h - T - B;

  sessionChainCtx.strokeStyle = "#111827";
  sessionChainCtx.lineWidth = 3;
  sessionChainCtx.setLineDash([]);
  sessionChainCtx.beginPath();
  sessionChainCtx.moveTo(L, T);
  sessionChainCtx.lineTo(L, h - B);
  sessionChainCtx.lineTo(w - R, h - B);
  sessionChainCtx.stroke();

  const yTicks = [0, 25, 50, 75, 100];
  sessionChainCtx.font = "18px sans-serif";
  sessionChainCtx.textAlign = "right";
  sessionChainCtx.textBaseline = "middle";

  yTicks.forEach(v => {
    const y = valueToY(v, h, B, plotH);

    sessionChainCtx.strokeStyle = v === 0 ? "#cbd5e1" : "#e5e7eb";
    sessionChainCtx.lineWidth = v === 0 ? 2.5 : 1.5;
    sessionChainCtx.setLineDash(v === 0 ? [] : [10, 10]);

    sessionChainCtx.beginPath();
    sessionChainCtx.moveTo(L, y);
    sessionChainCtx.lineTo(w - R, y);
    sessionChainCtx.stroke();

    sessionChainCtx.setLineDash([]);
    sessionChainCtx.fillStyle = "#475569";
    sessionChainCtx.fillText(v + "%", L - 10, y);
  });

  const stepX = plotW / Math.max(1, chainPoints.length - 1);

  let lastX = null, lastY = null;
  chainPoints.forEach((pt, idx) => {
    const x = L + stepX * idx;
    const y = valueToY(pt.rate, h, B, plotH);

    if (idx === 0) { lastX = x; lastY = y; return; }

    sessionChainCtx.strokeStyle = pt.color;
    sessionChainCtx.lineWidth = 4;
    sessionChainCtx.beginPath();
    sessionChainCtx.moveTo(lastX, lastY);
    sessionChainCtx.lineTo(x, y);
    sessionChainCtx.stroke();

    lastX = x; lastY = y;
  });

  const pointRadius = 7;
  chainPoints.forEach((pt, idx) => {
    if (!pt.isSessionPoint) return;

    const x = L + stepX * idx;
    const y = valueToY(pt.rate, h, B, plotH);

    sessionChainCtx.beginPath();
    sessionChainCtx.arc(x, y, pointRadius + 2, 0, Math.PI * 2);
    sessionChainCtx.fillStyle = "#ffffff";
    sessionChainCtx.fill();

    sessionChainCtx.beginPath();
    sessionChainCtx.arc(x, y, pointRadius, 0, Math.PI * 2);
    sessionChainCtx.fillStyle = pt.color;
    sessionChainCtx.fill();

    sessionChainCtx.font = "16px sans-serif";
    sessionChainCtx.textAlign = "center";
    sessionChainCtx.textBaseline = "bottom";
    sessionChainCtx.fillStyle = pt.color;
    sessionChainCtx.fillText(`${Math.round(pt.rate)}%`, x, y - pointRadius - 8);
  });

  sessionChainCtx.font = "22px sans-serif";
  sessionChainCtx.fillStyle = "#111827";
  sessionChainCtx.textAlign = "left";
  sessionChainCtx.textBaseline = "top";
  sessionChainCtx.fillText("セッション1→2→3→4 最終興味度 連結グラフ（0%スタート）", L, 22);
}

// ==== コメント表示 ====
function renderCommentTimeline(currentComments) {
  if (!commentList) return;
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
    const label = `${s.resetNo}回目セッション`;
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
    if (ch === "positive") { tag.className = "comment-tag understood"; tag.textContent = "気になる"; }
    else if (ch === "neutral") { tag.className = "comment-tag neutral"; tag.textContent = "普通"; }
    else { tag.className = "comment-tag not-understood"; tag.textContent = "気にならない"; }

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
      if (!res.ok) throw new Error("failed");
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
      if (!res.ok) throw new Error("failed");
      alert("テーマを保存しました。");
      await fetchResults();
    } catch (e) {
      console.error(e);
      alert("テーマの保存に失敗しました。");
    }
  });
}

// ==== 投票リセット（セッション単位） ====
// ✅ 保存→描画→サーバreset の順。fetchポーリングでhistoryが消えないように安全化。
if (btnReset) {
  btnReset.addEventListener("click", async () => {
    const ok = confirm("現在セッションの票・コメント・グラフをリセットします。\n本当に実行しますか？");
    if (!ok) return;

    try {
      // 「いま終わるセッション番号」
      const endedSessionNo = resetCount + 1;

      // ✅ 過去セッション保存（0%開始点だけのセッションは保存しない）
      const meaningfulPoints = history.filter(p => !(p.rate === 0 && p.choice == null));
      if (meaningfulPoints.length > 0) {
        const lastRate = clamp100(history[history.length - 1].rate);

        const copy = history.map(p => ({
          ts: safeTs(p.ts),
          rate: clamp100(p.rate),
          choice: p.choice ?? null,
        }));

        const savedComments = normalizeComments(latestCurrentComments);

        prevSessions.unshift({
          resetNo: endedSessionNo,
          color: sessionNoToColor(endedSessionNo),
          points: copy,
          finalRate: lastRate,
          comments: savedComments,
        });

        if (prevSessions.length > 4) prevSessions = prevSessions.slice(0, 4);
      }

      // 先にローカル描画（すぐ見える）
      setupAllCanvasesHiDPI();
      drawPrevSessions();
      drawSessionChain();
      renderCommentTimeline([]);

      // サーバリセット（sessionIdが進むのが理想）
      const res = await fetch("/api/admin/reset", { method: "POST" });
      if (!res.ok) throw new Error("failed");

      // ローカル側も即初期化（次のfetchでsid増分を見て同期される）
      history = [];
      latestCurrentComments = [];
      basePointInserted = false;
      lastCounts = null;
      lastActionChoice = null;
      ensureBasePoint();

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
// ✅ 色も完全初期化：prevSessions消去 + resetCount=0 + chain起点色固定で色残りなし
if (btnResetAll) {
  btnResetAll.addEventListener("click", async () => {
    const ok = confirm("現在セッション＋過去のセッションのグラフ/コメントをすべて削除します。\n本当に完全リセットしますか？");
    if (!ok) return;

    try {
      const res = await fetch("/api/admin/reset-all", { method: "POST" });
      if (!res.ok) throw new Error("failed");

      // ✅ ローカル完全初期化
      history = [];
      prevSessions = [];
      latestCurrentComments = [];
      basePointInserted = false;

      lastCounts = null;
      lastActionChoice = null;

      // 色も初期化（次回セッションは1回目扱い）
      resetCount = 0;
      // serverのsessionIdは次回fetchで再同期（ここで無理に触らない）
      currentServerSessionId = null;

      ensureBasePoint();

      setupAllCanvasesHiDPI();
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
if (btnUnlock) btnUnlock.addEventListener("click", unlock);
if (pwInput) {
  pwInput.addEventListener("keydown", e => {
    if (e.key === "Enter") unlock();
  });
}

function unlock() {
  const input = (pwInput?.value || "").trim();
  if (input !== ADMIN_PASSWORD) {
    if (lockMsg) lockMsg.textContent = "パスワードが違います。";
    return;
  }

  if (lockScreen) lockScreen.style.display = "none";
  if (adminContent) adminContent.style.display = "block";

  setupAllCanvasesHiDPI();
  ensureBasePoint();

  fetchResults();
  setInterval(fetchResults, 1000);

  if (!animationStarted) {
    animationStarted = true;
    requestAnimationFrame(drawLineChart);
  }

  drawPrevSessions();
  drawSessionChain();
}

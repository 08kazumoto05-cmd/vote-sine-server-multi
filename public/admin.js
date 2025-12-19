// ===============================
// admin.js（興味率：カード/現在/過去/連結 + コメント保存＆色分け）
// ===============================
//
// ✅ 平均スコア方式（普通でもグラフが動く） + ✅ 0地点スタート
// ✅ 現在セッション：直近投票（差分）で線分を色分け（緑/暗グレー/ピンク）
// ✅ 過去セッション：1回目=青,2回目=赤,3回目=緑,4回目=黄 で保存（前の仕様に戻す）
// ✅ 連結グラフ：上記セッション色で線を引き、最終興味度の点＋%表示（前の仕様）
// ✅ server.js の sessionId を監視して resetCount を同期（sessionId-1）
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

const numUnderstood = document.getElementById("num-understood");          // (表示) 気になる
const numNotUnderstood = document.getElementById("num-not-understood");  // (表示) 気にならない
const numTotal = document.getElementById("num-total");
const rateUnderstood = document.getElementById("rate-understood");        // 興味度(カード)
const numNeutral = document.getElementById("num-neutral");                // （任意）普通の票数

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
// 現在セッションの履歴 [{ ts, rate, choice }]
let history = [];

// prevSessions は「新しい順（0番が最新）」で保存される（unshift）
// { resetNo, color, points:[{ts,rate,choice?}], finalRate, comments:[{ts,text,choice}] }
let prevSessions = [];

// resetCount = これまでの「リセット回数」（現在セッション番号-1）
let resetCount = 0;

// ★ 前のシステムと同じ：1回目青 / 2回目赤 / 3回目緑 / 4回目黄
const SESSION_COLORS = ["#4fc3f7", "#ff5252", "#66bb6a", "#ffd600"];

let animationStarted = false;

// ★ 最新取得した「現在セッションのコメント」（リセット直前に退避する）
let latestCurrentComments = [];

// ★ 0地点スタート用：初期点を入れたか
let basePointInserted = false;

// ★ 直近投票判定用（前回の集計値）
let lastCounts = null; // { pos, neu, neg, total }

// ★ 直近投票の表示用（任意）
let lastActionChoice = null; // 'positive' | 'neutral' | 'negative' | null

// ✅ サーバセッションID監視（server.js が /api/results で返す）
let currentServerSessionId = null;

// ==== 色（直近投票の色：ユーザー指定） ====
const CHOICE_COLORS = {
  positive: "#22c55e", // 気になる＝緑
  neutral:  "#334155", // 普通＝暗めグレー
  negative: "#ec4899", // 気にならない＝ピンク
  none:     "#94a3b8", // 未確定
};

// 白ベースのキャンバステーマ（見やすさ）
const CANVAS_THEME = {
  bg: "#ffffff",
  axis: "#111827",
  grid: "#e5e7eb",
  gridStrong: "#cbd5e1",
  text: "#111827",
  subText: "#475569",
};

// ==== ユーティリティ ====
function sessionNoToColor(sessionNo) {
  // sessionNo: 1,2,3,4,... を青赤緑黄に割り当て（4以降は繰り返し）
  const idx = Math.max(0, (Number(sessionNo) || 1) - 1) % SESSION_COLORS.length;
  return SESSION_COLORS[idx];
}

function getCurrentColor() {
  // 現在セッションの色（resetCount=0なら1回目=青）
  return sessionNoToColor(resetCount + 1);
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

// choice の互換吸収（旧/新どっちでも動くように）
function normalizeChoice(choice) {
  // 新：投票側/サーバ側想定
  if (choice === "interested") return "positive";
  if (choice === "neutral") return "neutral";
  if (choice === "not-interested") return "negative";

  // 旧：admin側で使ってた表現
  if (choice === "positive") return "positive";
  if (choice === "negative") return "negative";

  // 旧々：2択互換
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

  history.push({ ts: Date.now(), rate: 0, choice: null });
  basePointInserted = true;
}

// ✅ 「直近で何が押されたか」を前回集計との差分で推定
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

// ✅ server の sessionId が変わった時に、現在セッション系の内部状態だけ初期化（色順は sessionId に同期）
function syncWithServerSessionId(newSid) {
  const sid = Number(newSid);
  if (!Number.isFinite(sid) || sid < 1) return;

  // sessionId=1 => resetCount=0（1回目セッション）
  resetCount = Math.max(0, sid - 1);

  // 現在セッションの追跡だけ初期化
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

    // ✅ sessionId 同期（別端末のリセットでも色順ズレを防ぐ）
    const sid = Number(data.sessionId);
    if (Number.isFinite(sid)) {
      if (currentServerSessionId == null) {
        currentServerSessionId = sid;
        syncWithServerSessionId(sid);
      } else if (sid !== currentServerSessionId) {
        currentServerSessionId = sid;
        syncWithServerSessionId(sid);
      }
    }

    // /api/results 互換：understood=気になる, notUnderstood=気にならない, neutral=普通
    const pos = Number(data.interested ?? data.positive ?? data.understood ?? 0);
    const neu = Number(data.neutral ?? 0);
    const neg = Number(data.notInterested ?? data.negative ?? data.notUnderstood ?? 0);

    const total = pos + neu + neg;

    // 表示
    numUnderstood.textContent = String(pos);
    numNotUnderstood.textContent = String(neg);
    numTotal.textContent = String(total);
    if (numNeutral) numNeutral.textContent = String(neu);

    // 興味度%（平均スコア方式）
    const rate = calcInterestRateAvg(pos, neu, neg);
    rateUnderstood.textContent = rate === null ? "--%" : `${Math.round(rate)}%`;

    // 想定人数（進捗）
    const maxP = Number(data.maxParticipants ?? 0);
    if (document.activeElement !== maxInput) maxInput.value = maxP;

    if (Number(maxP) > 0) {
      maxInfo.textContent = `想定人数：${maxP}人中、${total}人が投票済み`;
    } else {
      maxInfo.textContent = `想定人数が未設定です（先に人数を保存してください）`;
    }

    // テーマ
    const theme = data.theme || "";
    themeInfo.textContent = theme ? `現在のテーマ：${theme}` : "現在のテーマ：未設定";
    if (document.activeElement !== themeInput) themeInput.value = theme;

    // コメント
    latestCurrentComments = normalizeComments(data.comments || []);
    renderCommentTimeline(latestCurrentComments);

    // ✅ 直近投票を差分で推定
    const detected = detectLastActionChoice(pos, neu, neg);
    if (detected) lastActionChoice = detected;

    // 次回の差分判定用に更新
    lastCounts = { pos, neu, neg, total };

    // ✅ 0地点スタート
    if (total === 0) {
      ensureBasePoint();
      lastActionChoice = null;
    } else {
      addRatePoint(rate, detected);
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
function addRatePoint(rate, choice) {
  if (rate === null) return;

  const last = history[history.length - 1];

  // rateが同じでも「直近票の種類」が変わったら点を追加して色変化させる
  if (last && last.rate === rate && (choice == null || last.choice === choice)) return;

  history.push({ ts: Date.now(), rate, choice: choice ?? null });
  if (history.length > 300) history = history.slice(-300);
}

// ==== 現在セッション描画（直近票で区間色分け） ====
function drawLineChart() {
  const w = canvas.width;
  const h = canvas.height;

  // 白ベース
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

  // 区間ごと色分け（p1.choice）
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

  // 直近投票表示
  const label = `直近の投票：${choiceToLabel(lastActionChoice)}`;
  ctx.font = "20px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillStyle = CANVAS_THEME.subText;
  ctx.fillText(label, w - R, 12);

  // 色チップ
  const chipW = 14, chipH = 10;
  ctx.fillStyle = choiceToColor(lastActionChoice);
  ctx.fillRect(w - R - chipW - 8, 16, chipW, chipH);
  ctx.strokeStyle = CANVAS_THEME.gridStrong;
  ctx.lineWidth = 1;
  ctx.strokeRect(w - R - chipW - 8, 16, chipW, chipH);

  requestAnimationFrame(drawLineChart);
}

// ==== 過去セッション描画（区間ごと色分け） ====
function drawPrevSessions() {
  const maxSlots = prevCanvases.length; // 4
  const sessionsForDisplay = prevSessions.slice(0, maxSlots); // 新しい→古い

  for (let i = 0; i < maxSlots; i++) {
    const session = sessionsForDisplay[i];
    const c = prevCanvases[i];
    const note = prevNotes[i];
    const rateLabel = prevRateLabels[i];
    const pctx = prevCtxs[i];

    if (!c || !pctx) continue;

    const w = c.width;
    const h = c.height;

    // 白ベース
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

    // 0%開始点を追加
    const orig = session.points || [];
    const firstTs = orig[0]?.ts ?? Date.now();
    const hist = [{ ts: firstTs, rate: 0, choice: null }, ...orig.map(p => ({
      ts: safeTs(p?.ts),
      rate: clamp100(Number(p?.rate ?? 0)),
      choice: p?.choice ?? null,
    }))];

    const L = 60, R = 30, T = 34, B = 52;
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
    pctx.font = "16px sans-serif";
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
      pctx.fillText(v + "%", L - 8, y);
    });

    // 区間ごと色分け（p1.choice）
    const stepX = hist.length > 1 ? plotW / (hist.length - 1) : 0;

    for (let k = 1; k < hist.length; k++) {
      const p0 = hist[k - 1];
      const p1 = hist[k];

      const x0 = L + (k - 1) * stepX;
      const y0 = valueToY(p0.rate, h, B, plotH);
      const x1 = L + k * stepX;
      const y1 = valueToY(p1.rate, h, B, plotH);

      pctx.strokeStyle = choiceToColor(p1.choice);
      pctx.lineWidth = 3.5;
      pctx.beginPath();
      pctx.moveTo(x0, y0);
      pctx.lineTo(x1, y1);
      pctx.stroke();
    }
  }
}

// ==== 連結グラフ（最大4件）※セッション色で線＋最終点表示（前の仕様） ====
function drawSessionChain() {
  if (!sessionChainCanvas || !sessionChainCtx) return;

  const w = sessionChainCanvas.width;
  const h = sessionChainCanvas.height;

  // 白ベース
  sessionChainCtx.fillStyle = "#ffffff";
  sessionChainCtx.fillRect(0, 0, w, h);

  // 最大4件の「過去セッション」
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

  // 0%スタート + 各セッション最終値
  const chainPoints = [];
  const firstColor = sessionsOldestFirst[0].color || SESSION_COLORS[0];
  chainPoints.push({ rate: 0, color: firstColor, isSessionPoint: false });

  sessionsOldestFirst.forEach(session => {
    const r = clamp100(Number(session.finalRate ?? 0));
    const color = session.color || SESSION_COLORS[0];
    chainPoints.push({ rate: r, color, isSessionPoint: true });
  });

  const L = 90, R = 40, T = 80, B = 90;
  const plotW = w - L - R;
  const plotH = h - T - B;

  // 軸
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

  // セッション色で線を引く（次点の色）
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
    sessionChainCtx.lineWidth = 4;
    sessionChainCtx.beginPath();
    sessionChainCtx.moveTo(lastX, lastY);
    sessionChainCtx.lineTo(x, y);
    sessionChainCtx.stroke();

    lastX = x; lastY = y;
  });

  // 最終興味度点＋%表示（前の仕様）
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
      // いま終わるセッション番号（= resetCount+1）
      const endedSessionNo = resetCount + 1;

      // ✅ 過去セッション保存（前の仕様：1青2赤3緑4黄）
      if (history.length > 0) {
        const lastRate = clamp100(history[history.length - 1].rate);

        const copy = history.map(p => ({
          ts: safeTs(p.ts),
          rate: clamp100(p.rate),
          choice: p.choice ?? null,
        }));

        const savedComments = normalizeComments(latestCurrentComments);

        prevSessions.unshift({
          resetNo: endedSessionNo,
          color: sessionNoToColor(endedSessionNo), // ★固定の色順
          points: copy,
          finalRate: lastRate,
          comments: savedComments,
        });

        if (prevSessions.length > 4) prevSessions = prevSessions.slice(0, 4);

        drawPrevSessions();
        drawSessionChain();
        renderCommentTimeline([]);
      }

      // サーバリセット（sessionId が進む）
      const res = await fetch("/api/admin/reset", { method: "POST" });
      if (!res.ok) throw new Error("failed to reset");

      // server sessionId 同期（これで resetCount も正しく次へ進む）
      let newSid = null;
      try {
        const j = await res.json();
        newSid = Number(j?.sessionId);
      } catch {}
      if (Number.isFinite(newSid)) {
        currentServerSessionId = newSid;
        syncWithServerSessionId(newSid);
      } else {
        // もし sessionId が返らない場合でも最低限動く
        resetCount++;
        history = [];
        latestCurrentComments = [];
        basePointInserted = false;
        lastCounts = null;
        lastActionChoice = null;
        ensureBasePoint();
      }

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

      let sid = null;
      try {
        const j = await res.json();
        sid = Number(j?.sessionId);
      } catch {}

      history = [];
      prevSessions = [];
      latestCurrentComments = [];
      basePointInserted = false;

      lastCounts = null;
      lastActionChoice = null;

      drawPrevSessions();
      drawSessionChain();
      renderCommentTimeline([]);

      if (Number.isFinite(sid)) {
        currentServerSessionId = sid;
        syncWithServerSessionId(sid); // => resetCount = sid-1（通常 0）
      } else {
        currentServerSessionId = null;
        resetCount = 0;
        ensureBasePoint();
      }

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

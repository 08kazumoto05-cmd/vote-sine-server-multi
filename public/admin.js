// ===============================
// admin.js（興味率：カード/現在/過去/連結 + コメント保存＆色分け）
// ===============================
//
// 変更点（3択対応）
// - 気になる: +1（positive）
// - 普通: 0（neutral）
// - 気にならない: -1（negative）
// - 計算式は従来前提：((+1票) - (-1票)) / 想定人数 * 100 を 0〜100 に丸め
// - コメント表示も3択ラベル対応
// - 旧choice（understood / not-understood）も互換で表示
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

const numUnderstood = document.getElementById("num-understood");           // (表示) 気になる
const numNotUnderstood = document.getElementById("num-not-understood");   // (表示) 気にならない
const numTotal = document.getElementById("num-total");
const rateUnderstood = document.getElementById("rate-understood");         // 興味率(カード)

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

// （任意）普通の票数を表示したい場合に備えて。HTMLに id="num-neutral" があれば表示される
const numNeutral = document.getElementById("num-neutral");

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
// { resetNo, color, points:[{ts,rate}], finalRate, comments:[{ts,text,choice}] }
let prevSessions = [];

let resetCount = 0;

// ★ 4つ目を黄色に
const SESSION_COLORS = ["#4fc3f7", "#ff5252", "#66bb6a", "#ffd600"];

let animationStarted = false;

// ★ 最新取得した「現在セッションのコメント」（リセット直前に退避する）
let latestCurrentComments = [];

// ==== ユーティリティ ====
function getCurrentColor() {
  const idx = Math.min(resetCount, SESSION_COLORS.length - 1);
  return SESSION_COLORS[idx];
}

function valueToY(value, canvasHeight, bottomPadding, plotHeight) {
  const v = Math.max(0, Math.min(100, value));
  return canvasHeight - bottomPadding - (v / 100) * plotHeight;
}

// ★ 3択：従来前提の計算（差分 / 想定人数）
// 気になる(+1)を pos、気にならない(-1)を neg として、普通は計算に影響なし（0）
function calcInterestRate(pos, neg, maxP) {
  if (!Number.isFinite(maxP) || maxP <= 0) return null;

  let rate = ((pos - neg) / maxP) * 100;
  if (rate < 0) rate = 0;
  if (rate > 100) rate = 100;
  return rate;
}

function safeTs(x) {
  const t = Number(x);
  return Number.isFinite(t) ? t : Date.now();
}

// choice の互換吸収（旧: understood/not-understood）
function normalizeChoice(choice) {
  if (choice === "positive") return "positive";
  if (choice === "neutral") return "neutral";
  if (choice === "negative") return "negative";

  // 旧互換
  if (choice === "understood") return "positive";
  if (choice === "not-understood") return "negative";

  // コメントのみ等で null/undefined の場合は neutral 扱いにしておく
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

// ==== 結果取得 ====
async function fetchResults() {
  try {
    const res = await fetch("/api/results", { cache: "no-store" });
    if (!res.ok) throw new Error("failed to fetch results");

    const data = await res.json();

    // ★ 3択対応（サーバがまだ2択なら understood/notUnderstood を拾う）
    const pos = Number(data.positive ?? data.understood ?? 0);         // 気になる
    const neu = Number(data.neutral ?? 0);                              // 普通
    const neg = Number(data.negative ?? data.notUnderstood ?? 0);       // 気にならない

    const total = pos + neu + neg;

    // 既存の表示欄は維持（num-understood = 気になる、num-not-understood = 気にならない）
    numUnderstood.textContent = String(pos);
    numNotUnderstood.textContent = String(neg);
    numTotal.textContent = String(total);

    // 普通の表示欄がHTMLにある場合のみ反映
    if (numNeutral) numNeutral.textContent = String(neu);

    const maxP = Number(data.maxParticipants ?? 0);
    const theme = data.theme || "";

    const rate = calcInterestRate(pos, neg, maxP);
    rateUnderstood.textContent = rate === null ? "--%" : `${Math.round(rate)}%`;

    if (document.activeElement !== maxInput) maxInput.value = maxP;
    if (Number(maxP) > 0) {
      maxInfo.textContent = `想定人数：${maxP}人中、${total}人が投票済み`;
    } else {
      maxInfo.textContent = `想定人数が未設定です（先に人数を保存してください）`;
    }

    themeInfo.textContent = theme ? `現在のテーマ：${theme}` : "現在のテーマ：未設定";
    if (document.activeElement !== themeInput) themeInput.value = theme;

    // ★ 現在セッションのコメントを保持（リセット直前の保存に使う）
    latestCurrentComments = normalizeComments(data.comments || []);

    // ★ タイムライン描画（現在 + 過去保存分）
    renderCommentTimeline(latestCurrentComments);

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

// ==== 履歴管理 ====
function addRatePoint(rate) {
  if (rate === null) return;

  const last = history[history.length - 1];
  if (last && last.rate === rate) return;

  history.push({ ts: Date.now(), rate });
  if (history.length > 300) history = history.slice(-300);
}

// ==== 現在セッション描画 ====
function drawLineChart() {
  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, w, h);

  const maxP = Number(maxInput.value || "0");
  if (maxP <= 0) {
    ctx.fillStyle = "#CCCCCC";
    ctx.font = "32px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("想定人数を設定してください（左の『人数を保存』）", w / 2, h / 2);
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

  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 4;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(L, T);
  ctx.lineTo(L, h - B);
  ctx.lineTo(w - R, h - B);
  ctx.stroke();

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

  const stepX = history.length > 1 ? plotW / (history.length - 1) : 0;
  const currentColor = getCurrentColor();

  ctx.strokeStyle = currentColor;
  ctx.lineWidth = 6;
  ctx.beginPath();

  history.forEach((p, i) => {
    const displayRate = i === 0 ? 0 : p.rate;
    const x = L + i * stepX;
    const y = valueToY(displayRate, h, B, plotH);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.font = "32px sans-serif";
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("現在セッション興味率推移（(気になる−気にならない)/想定人数）", L + 4, 8);

  requestAnimationFrame(drawLineChart);
}

// ==== 過去セッション描画（グラフ） ====
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

    pctx.fillStyle = "#000000";
    pctx.fillRect(0, 0, w, h);

    const shownResetNo = session?.resetNo ?? (resetCount - i > 0 ? (resetCount - i) : "—");

    if (!session || !session.points || session.points.length === 0) {
      if (note) note.textContent = `${shownResetNo}回目のリセットセッション：まだグラフはありません。`;
      if (rateLabel) rateLabel.textContent = "";
      continue;
    }

    if (note) note.textContent = `${session.resetNo}回目のリセットセッション：興味率の推移（0〜100％）`;

    if (rateLabel) {
      const lastRate = Math.max(0, Math.min(100, Number(session.finalRate ?? 0)));
      rateLabel.textContent = `（最終興味率：${Math.round(lastRate)}%）`;
    }

    const hist = session.points;
    const color = session.color || "#4fc3f7";

    const L = 60, R = 40, T = 40, B = 60;
    const plotW = w - L - R;
    const plotH = h - T - B;

    pctx.strokeStyle = "#FFFFFF";
    pctx.lineWidth = 4;
    pctx.setLineDash([]);
    pctx.beginPath();
    pctx.moveTo(L, T);
    pctx.lineTo(L, h - B);
    pctx.lineTo(w - R, h - B);
    pctx.stroke();

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

    pctx.strokeStyle = color;
    pctx.lineWidth = 5;
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

// ==== 連結グラフ（最大4件） ====
function drawSessionChain() {
  if (!sessionChainCanvas || !sessionChainCtx) return;

  const w = sessionChainCanvas.width;
  const h = sessionChainCanvas.height;

  sessionChainCtx.fillStyle = "#000000";
  sessionChainCtx.fillRect(0, 0, w, h);

  const sessionsNewestFirst = prevSessions.slice(0, 4);
  const sessionsOldestFirst = sessionsNewestFirst.slice().reverse().filter(s => s && s.points && s.points.length > 0);

  if (sessionsOldestFirst.length === 0) {
    sessionChainCtx.fillStyle = "#CCCCCC";
    sessionChainCtx.font = "40px sans-serif";
    sessionChainCtx.textAlign = "center";
    sessionChainCtx.textBaseline = "middle";
    sessionChainCtx.fillText("まだセッションが保存されていません。", w / 2, h / 2);
    return;
  }

  const chainPoints = [];
  const firstSessionColor = sessionsOldestFirst[0].color || SESSION_COLORS[0];
  chainPoints.push({ rate: 0, color: firstSessionColor, isSessionPoint: false });

  sessionsOldestFirst.forEach((session, idx) => {
    const r = Math.max(0, Math.min(100, Number(session.finalRate ?? 0)));
    const color = session.color || SESSION_COLORS[Math.min(idx, SESSION_COLORS.length - 1)];
    chainPoints.push({ rate: r, color, isSessionPoint: true });
  });

  const L = 120, R = 80, T = 120, B = 150;
  const plotW = w - L - R;
  const plotH = h - T - B;

  sessionChainCtx.strokeStyle = "#FFFFFF";
  sessionChainCtx.lineWidth = 6;
  sessionChainCtx.setLineDash([]);
  sessionChainCtx.beginPath();
  sessionChainCtx.moveTo(L, T);
  sessionChainCtx.lineTo(L, h - B);
  sessionChainCtx.lineTo(w - R, h - B);
  sessionChainCtx.stroke();

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
    sessionChainCtx.lineWidth = 6;
    sessionChainCtx.beginPath();
    sessionChainCtx.moveTo(lastX, lastY);
    sessionChainCtx.lineTo(x, y);
    sessionChainCtx.stroke();

    lastX = x; lastY = y;
  });

  const pointRadius = 10;
  chainPoints.forEach((pt, idx) => {
    if (!pt.isSessionPoint) return;

    const x = L + stepX * idx;
    const y = valueToY(pt.rate, h, B, plotH);

    sessionChainCtx.beginPath();
    sessionChainCtx.arc(x, y, pointRadius + 2, 0, Math.PI * 2);
    sessionChainCtx.fillStyle = "#FFFFFF";
    sessionChainCtx.fill();

    sessionChainCtx.beginPath();
    sessionChainCtx.arc(x, y, pointRadius, 0, Math.PI * 2);
    sessionChainCtx.fillStyle = pt.color;
    sessionChainCtx.fill();

    sessionChainCtx.font = "28px sans-serif";
    sessionChainCtx.textAlign = "center";
    sessionChainCtx.textBaseline = "bottom";
    sessionChainCtx.fillStyle = pt.color;
    sessionChainCtx.fillText(`${Math.round(pt.rate)}%`, x, y - pointRadius - 10);
  });

  sessionChainCtx.font = "40px sans-serif";
  sessionChainCtx.fillStyle = "#FFFFFF";
  sessionChainCtx.textAlign = "left";
  sessionChainCtx.textBaseline = "top";
  sessionChainCtx.fillText("セッション1→2→3→4 最終興味率 連結グラフ", L, 60);
}

// ==== コメント表示（現在 + 過去保存分を統合） ====
// ★ セッション色で判別できるように「左線＆丸」を色付け
function renderCommentTimeline(currentComments) {
  commentList.innerHTML = "";

  const currentColor = getCurrentColor();

  // 1) 現在セッション分
  const nowItems = (normalizeComments(currentComments) || []).map(c => ({
    ...c,
    sessionLabel: "現在セッション",
    sessionColor: currentColor,
    sessionOrder: 999999,
  }));

  // 2) 過去セッション分（保存済み）
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

  // 新しい順に並べる
  all.sort((a, b) => safeTs(b.ts) - safeTs(a.ts));

  all.forEach(c => {
    const item = document.createElement("div");
    item.className = "comment-item";
    item.style.borderLeft = `6px solid ${c.sessionColor}`;

    const meta = document.createElement("div");
    meta.className = "comment-meta";

    // セッション色の丸
    const dot = document.createElement("span");
    dot.style.display = "inline-block";
    dot.style.width = "10px";
    dot.style.height = "10px";
    dot.style.borderRadius = "50%";
    dot.style.background = c.sessionColor;
    dot.style.marginRight = "8px";
    dot.style.verticalAlign = "middle";

    // セッション名
    const sessionSpan = document.createElement("span");
    sessionSpan.textContent = c.sessionLabel;
    sessionSpan.style.marginRight = "10px";
    sessionSpan.style.color = c.sessionColor;
    sessionSpan.style.fontWeight = "700";

    // ★ 3択タグ
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

    // 時刻
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
// ★ resetNo と「その時点のコメント」も保存する
if (btnReset) {
  btnReset.addEventListener("click", async () => {
    const ok = confirm("現在セッションの票・コメント・グラフをリセットします。\n本当に実行しますか？");
    if (!ok) return;

    try {
      const currentColor = getCurrentColor();

      if (history.length > 0) {
        const lastRate = Math.max(0, Math.min(100, history[history.length - 1].rate));
        const copy = history.map(p => ({ ts: p.ts, rate: p.rate }));

        const resetNo = resetCount + 1;

        // ★ リセット直前の「現在コメント」を保存
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

        // ★ サーバ消去前に過去分として反映
        renderCommentTimeline([]);
      }

      const res = await fetch("/api/admin/reset", { method: "POST" });
      if (!res.ok) throw new Error("failed to reset");

      resetCount++;
      history = [];
      latestCurrentComments = [];

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

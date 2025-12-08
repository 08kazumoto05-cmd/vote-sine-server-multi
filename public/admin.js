// admin.js - 管理画面
// ● グラフは 0〜100% のプラスのみ（マイナスなし）
//   ・値 = (理解できた − 理解できなかった) ÷ 分母 × 100
//   ・分母 = 想定人数 > 0 のときは想定人数、なければ投票人数
//   ・最後に 0〜100 にクリップ
// ● 各セッションのグラフ（現在＋過去3つ）は 0 からスタート（最初の点は 0%）
// ● セッション1〜3連結グラフだけ、
//   前セッションの「最終値」から次セッションの「最初の値」がピッタリつながるように
//   縦方向のオフセットをかけて描画する
// ● セッションごとの色
//   0回目(初回) : 青, 1回目リセット後 : 赤, 2回目リセット後 : 緑

const ADMIN_PASSWORD = "admin123";

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

// セッション1〜3連結グラフ
const sessionChainCanvas = document.getElementById("sessionChain");
const sessionChainCtx = sessionChainCanvas
  ? sessionChainCanvas.getContext("2d")
  : null;

// ==== 状態 ====

// 現在セッションの履歴 [{ ts, rate }]
let history = [];

// 過去セッション（最大3つ）
// [{ color: "#xxxxxx", points: [{ts, rate}, ...] }, ...]
// 先頭が「一番最近のセッション」
let prevSessions = [];

// リセット回数（0:初回, 1:1回目リセット後, 2:2回目リセット後…）
let resetCount = 0;

// セッションごとの色
const SESSION_COLORS = ["#4fc3f7", "#ff5252", "#66bb6a"];

// 描画ループ開始済みか
let animationStarted = false;

// ==== ユーティリティ ====

// 現在セッションの色を取得
function getCurrentColor() {
  const idx = Math.min(resetCount, SESSION_COLORS.length - 1);
  return SESSION_COLORS[idx];
}

// 0〜100 の値をキャンバスY座標に変換（下が0, 上が100）
function valueToYPos(value, canvasHeight, bottomPadding, plotHeight) {
  let v = Math.max(0, Math.min(100, value));
  // 0 → 下端, 100 → 上端
  const ratio = v / 100; // 0〜1
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

    // 表示用理解率（普通の％）
    const rateDisplay = total > 0 ? Math.round((u / total) * 100) : 0;
    rateUnderstood.textContent = rateDisplay + "%";

    // --- グラフ用の値（0〜100） ---
    let rate = null;

    // 分母の決め方：想定人数 > 0 なら想定人数、それ以外は投票人数
    let denom = 0;
    if (maxP > 0) {
      denom = maxP;
    } else if (total > 0) {
      denom = total;
    }

    if (denom > 0) {
      rate = ((u - n) / denom) * 100;
    } else {
      // 投票も想定人数も 0 のとき
      if (history.length > 0) {
        rate = history[history.length - 1].rate;
      } else {
        rate = null;
      }
    }

    if (rate !== null) {
      rate = Math.round(rate);
      if (rate < 0) rate = 0;
      if (rate > 100) rate = 100;
    }

    // 想定人数UI
    if (document.activeElement !== maxInput) {
      maxInput.value = maxP;
    }
    if (maxP > 0) {
      maxInfo.textContent = `想定人数：${maxP}人中、${total}人が投票済み`;
    } else {
      maxInfo.textContent =
        "想定人数が未設定です（投票人数を分母にして計算します）";
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

// ==== 履歴管理 ====

// 各セッションは 0 からスタート：
// ・history が空のときに初めて rate が来たら、
//   1点目は rate=0 として保存し、2点目以降から実際の値を入れていく
function addRatePoint(rate) {
  const now = Date.now();
  if (rate === null) return;

  if (history.length === 0) {
    // セッション開始の1点目は 0 からスタート
    history.push({ ts: now, rate: 0 });
    return;
  }

  const last = history[history.length - 1];
  if (last && last.rate === rate) return; // 同じ値が続くときは追加しない

  history.push({ ts: now, rate });

  if (history.length > 200) {
    history = history.slice(-200);
  }
}

// ==== 現在セッションのグラフ描画 ====

function drawLineChart() {
  const w = canvas.width;
  const h = canvas.height;

  // 背景を黒で塗る
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, w, h);

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

  // 外枠（白）
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(L, T);
  ctx.lineTo(L, h - B);
  ctx.lineTo(w - R, h - B);
  ctx.stroke();

  // Y軸目盛（0, 25, 50, 75, 100）
  const yTicks = [0, 25, 50, 75, 100];
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  yTicks.forEach((v) => {
    const y = valueToYPos(v, h, B, plotH);

    ctx.strokeStyle = v === 0 ? "#FFFFFF" : "#FFFFFF";
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

  // X方向補助線（1/4,1/2,3/4に白点線）
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

  // X座標
  const stepX = history.length > 1 ? plotW / (history.length - 1) : 0;

  // 現在セッションの色（初回:青 / 1回目リセット後:赤 / 2回目以降:緑）
  const currentColor = getCurrentColor();

  // 折れ線
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

  // タイトル
  ctx.font = "12px sans-serif";
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(
    "理解度バランス（0〜100%, 0からスタート）",
    L + 4,
    4
  );

  requestAnimationFrame(drawLineChart);
}

// ==== 過去セッションのグラフ描画 ====

function drawPrevSessions() {
  for (let i = 0; i < 3; i++) {
    const session = prevSessions[i];
    const c = prevCanvases[i];
    const note = prevNotes[i];
    const pctx = prevCtxs[i];

    if (!c || !pctx) continue;

    const w = c.width;
    const h = c.height;

    // 背景黒
    pctx.fillStyle = "#000000";
    pctx.fillRect(0, 0, w, h);

    if (!session || !session.points || session.points.length === 0) {
      if (note) {
        note.textContent = `セッション${i + 1}：まだグラフはありません。`;
      }
      continue;
    }

    const hist = session.points;
    const color = session.color;

    if (note) {
      note.textContent = `セッション${i + 1}：理解度バランスの推移（0〜100%）`;
    }

    const L = 40,
      R = 15,
      T = 15,
      B = 25;
    const plotW = w - L - R;
    const plotH = h - T - B;

    // 外枠
    pctx.strokeStyle = "#FFFFFF";
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

    yTicks.forEach((v) => {
      const y = valueToYPos(v, h, B, plotH);

      pctx.strokeStyle = v === 0 ? "#FFFFFF" : "#FFFFFF";
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

    // X補助線
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

    // セッションごとの色で線を描画
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

function drawSessionChain() {
  if (!sessionChainCanvas || !sessionChainCtx) return;

  const w = sessionChainCanvas.width;
  const h = sessionChainCanvas.height;

  // 背景黒
  sessionChainCtx.fillStyle = "#000000";
  sessionChainCtx.fillRect(0, 0, w, h);

  const sessions = prevSessions.slice(0, 3);
  if (sessions.length === 0) {
    sessionChainCtx.fillStyle = "#CCCCCC";
    sessionChainCtx.font = "14px sans-serif";
    sessionChainCtx.textAlign = "center";
    sessionChainCtx.textBaseline = "middle";
    sessionChainCtx.fillText("まだセッションが保存されていません。", w / 2, h / 2);
    return;
  }

  // 古い順に並べる（配列末尾が一番古いので reverse）
  const ordered = sessions.slice().reverse();

  // 合計ポイント数（0なら何も描かない）
  let totalPoints = 0;
  ordered.forEach((s) => {
    if (s && s.points) totalPoints += s.points.length;
  });

  if (totalPoints === 0) {
    sessionChainCtx.fillStyle = "#CCCCCC";
    sessionChainCtx.font = "14px sans-serif";
    sessionChainCtx.textAlign = "center";
    sessionChainCtx.textBaseline = "middle";
    sessionChainCtx.fillText("まだセッションが保存されていません。", w / 2, h / 2);
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

  // Y軸目盛 (0, 25, 50, 75, 100)
  const yTicks = [0, 25, 50, 75, 100];
  sessionChainCtx.font = "10px sans-serif";
  sessionChainCtx.textAlign = "right";
  sessionChainCtx.textBaseline = "middle";

  yTicks.forEach((v) => {
    const y = valueToYPos(v, h, B, plotH);

    sessionChainCtx.strokeStyle = v === 0 ? "#FFFFFF" : "#FFFFFF";
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

  const stepX = totalPoints > 1 ? plotW / (totalPoints - 1) : 0;

  // セッション1→2→3 が 1本の線としてつながるように、
  // 各セッションに「縦方向オフセット」をかけて、
  // 「後ろのセッションの1点目」が「前セッションの最終値」と一致するようにする
  let globalIndex = 0;
  let prevLastRate = null;

  ordered.forEach((session, sIdx) => {
    if (!session || !session.points || session.points.length === 0) return;

    const rawHist = session.points;
    const color =
      session.color ||
      SESSION_COLORS[Math.min(sIdx, SESSION_COLORS.length - 1)];

    // このセッション用のレート配列をコピー
    const adjusted = rawHist.map((p) => ({ ts: p.ts, rate: p.rate }));

    if (prevLastRate !== null && adjusted.length > 0) {
      // オフセット = 前の最終値 − このセッションの先頭の値
      const offset = prevLastRate - adjusted[0].rate;
      adjusted.forEach((p) => {
        let v = p.rate + offset;
        if (v < 0) v = 0;
        if (v > 100) v = 100;
        p.rate = v;
      });
    }

    // このセッションの最後の値を次のセッション用に保持
    const lastPoint = adjusted[adjusted.length - 1];
    prevLastRate = lastPoint ? lastPoint.rate : prevLastRate;

    // 描画
    sessionChainCtx.strokeStyle = color;
    sessionChainCtx.lineWidth = 2.5;
    sessionChainCtx.setLineDash([]);
    sessionChainCtx.beginPath();

    adjusted.forEach((p, idx) => {
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
  });

  // タイトル
  sessionChainCtx.font = "12px sans-serif";
  sessionChainCtx.fillStyle = "#FFFFFF";
  sessionChainCtx.textAlign = "left";
  sessionChainCtx.textBaseline = "top";
  sessionChainCtx.fillText(
    "セッション1 → 2 → 3 連結グラフ（前セッションの最終値からピッタリ連結・0〜100%）",
    L + 4,
    4
  );

  // 凡例
  sessionChainCtx.font = "10px sans-serif";
  sessionChainCtx.textBaseline = "middle";

  const legendY = h - 18;
  ordered.forEach((session, idx) => {
    const color =
      session.color ||
      SESSION_COLORS[Math.min(idx, SESSION_COLORS.length - 1)];
    const label = `セッション${idx + 1}`;
    const x = L + idx * 120;

    sessionChainCtx.fillStyle = color;
    sessionChainCtx.fillRect(x, legendY - 4, 18, 8);

    sessionChainCtx.fillStyle = "#FFFFFF";
    sessionChainCtx.fillText(label, x + 24, legendY);
  });
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
      // 現在セッションの最後の値
      const last = history[history.length - 1];
      const currentColor = getCurrentColor();

      // 現在セッションを過去セッションに保存（先頭に追加）
      if (history.length > 0) {
        const copy = history.map((p) => ({ ts: p.ts, rate: p.rate }));
        prevSessions.unshift({ color: currentColor, points: copy });
        if (prevSessions.length > 3) prevSessions = prevSessions.slice(0, 3);
        drawPrevSessions();
        drawSessionChain();
      }

      // サーバー側の投票リセット
      const res = await fetch("/api/admin/reset", { method: "POST" });
      if (!res.ok) throw new Error("failed to reset");

      // リセット回数を増やす（次のセッションの色が変わる）
      resetCount++;

      // 新しいセッション：0からスタートするため、履歴は空にする
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

      // すべての履歴をクリア
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

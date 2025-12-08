// admin.js - 管理画面
// ● グラフは真ん中が 0 のプラス/マイナス表示
//   ・値 = (理解できた − 理解できなかった) ÷ 想定人数 × 100
//   ・想定人数が 0 のときは、(理解 − 不理解) ÷ 投票人数 ×100
// ● セッションごとに線の色を変える（現在セッションの大きなグラフ）
//   0回目(初回) : 青
//   1回目リセット後 : 赤
//   2回目リセット後 : 緑
// ● 「投票データをリセット」
//   その時点までの線を過去セッションに保存するが、
//   次のセッションのグラフとは“連結させない”（新しい線としてスタート）
// ● 「全投票データを完全リセット」
//   現在セッション＋過去セッションの履歴を全部削除
// ● 下の「セッション1〜3連結グラフ」は、過去セッションだけを
//   1本の時間軸として連結して表示する（現在セッションとは別）

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

// ★ セッション1〜3連結グラフ用キャンバス
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

// セッションごとの色（現在セッション用）
const SESSION_COLORS = ["#4fc3f7", "#ff5252", "#66bb6a"];

// 描画ループ開始済みか
let animationStarted = false;

// ==== ユーティリティ ====

// 現在セッションの色を取得（初回:青 / 1回目リセット後:赤 / 2回目以降:緑）
function getCurrentColor() {
  const idx = Math.min(resetCount, SESSION_COLORS.length - 1);
  return SESSION_COLORS[idx];
}

// -100〜100 の値をキャンバスY座標に変換
function valueToY(value, canvasHeight, bottomPadding, plotHeight) {
  let v = Math.max(-100, Math.min(100, value));
  // -100 → 下端, 0 → 中央, 100 → 上端
  const ratio = (v + 100) / 200; // 0〜1
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

    // 表示用理解率（普通の％：理解できた / 合計）
    const rateDisplay = total > 0 ? Math.round((u / total) * 100) : 0;
    rateUnderstood.textContent = rateDisplay + "%";

    // --- グラフ用の値（-100〜100） ---
    let rate = null;

    if (maxP > 0) {
      if (total === 0 && history.length > 0) {
        // 投票が0でも履歴があるときは前回値を維持
        rate = history[history.length - 1].rate;
      } else if (total === 0 && history.length === 0) {
        rate = null; // 何も描かない
      } else {
        // ★ 今まで通りの計算式（＋/−方式）
        rate = ((u - n) / maxP) * 100;
      }
    } else {
      // 想定人数が0 → 投票人数を分母
      if (total > 0) {
        rate = ((u - n) / total) * 100;
      } else if (history.length > 0) {
        rate = history[history.length - 1].rate;
      } else {
        rate = null;
      }
    }

    if (rate !== null) {
      // -100〜100 にクリップ
      rate = Math.max(-100, Math.min(100, Math.round(rate)));
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

function addRatePoint(rate) {
  const now = Date.now();
  if (rate === null) return;

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

  // 背景黒
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

  // 外枠
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(L, T);
  ctx.lineTo(L, h - B);
  ctx.lineTo(w - R, h - B);
  ctx.stroke();

  // Y軸目盛（-100, -50, 0, 50, 100）
  const yTicks = [-100, -50, 0, 50, 100];
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  yTicks.forEach((v) => {
    const y = valueToY(v, h, B, plotH);

    if (v === 0) {
      // 0ラインは太めの実線
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
    } else {
      // 他は点線
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
    }

    ctx.beginPath();
    ctx.moveTo(L, y);
    ctx.lineTo(w - R, y);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(v + "%", L - 6, y);
  });

  // X方向補助線（1/4,1/2,3/4）
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

  // 現在セッションの色
  const currentColor = getCurrentColor();

  // 折れ線
  ctx.strokeStyle = currentColor;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([]);
  ctx.beginPath();
  history.forEach((p, i) => {
    const x = L + i * stepX;
    const y = valueToY(p.rate, h, B, plotH);
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
    "理解度バランス（+側：理解できた ／ −側：理解できなかった）",
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
      note.textContent = `セッション${i + 1}：理解度バランスの推移`;
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
    const yTicks = [-100, -50, 0, 50, 100];
    pctx.font = "9px sans-serif";
    pctx.textAlign = "right";
    pctx.textBaseline = "middle";

    yTicks.forEach((v) => {
      const y = valueToY(v, h, B, plotH);

      if (v === 0) {
        pctx.strokeStyle = "#FFFFFF";
        pctx.lineWidth = 1.5;
        pctx.setLineDash([]);
      } else {
        pctx.strokeStyle = "#FFFFFF";
        pctx.lineWidth = 1;
        pctx.setLineDash([4, 4]);
      }

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
      const y = valueToY(p.rate, h, B, plotH);
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

  // 古い順：[セッション1, セッション2, セッション3]
  const ordered = sessions.slice().reverse();

  // 合計ポイント数
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

  // Y軸目盛
  const yTicks = [-100, -50, 0, 50, 100];
  sessionChainCtx.font = "10px sans-serif";
  sessionChainCtx.textAlign = "right";
  sessionChainCtx.textBaseline = "middle";

  yTicks.forEach((v) => {
    const y = valueToY(v, h, B, plotH);

    if (v === 0) {
      sessionChainCtx.strokeStyle = "#FFFFFF";
      sessionChainCtx.lineWidth = 1.5;
      sessionChainCtx.setLineDash([]);
    } else {
      sessionChainCtx.strokeStyle = "#FFFFFF";
      sessionChainCtx.lineWidth = 1;
      sessionChainCtx.setLineDash([4, 4]);
    }

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

  // セッション1→2→3 を連続した1本の線として描画（色はセッションごと）
  let globalIndex = 0;

  ordered.forEach((session, sIdx) => {
    if (!session || !session.points || session.points.length === 0) return;

    const hist = session.points;
    const color =
      session.color ||
      SESSION_COLORS[Math.min(sIdx, SESSION_COLORS.length - 1)];

    sessionChainCtx.strokeStyle = color;
    sessionChainCtx.lineWidth = 2.5;
    sessionChainCtx.setLineDash([]);
    sessionChainCtx.beginPath();

    hist.forEach((p, idx) => {
      const x = L + stepX * globalIndex;
      const y = valueToY(p.rate, h, B, plotH);

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
    "セッション1 → 2 → 3 の連結グラフ（+：理解 ／ −：不理解）",
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
// ※ここで「前セッションの最終点からつなげる」をやめる

if (btnReset) {
  btnReset.addEventListener("click", async () => {
    const ok = confirm(
      "現在セッションの票・コメント・グラフをリセットします。\n本当に実行しますか？"
    );
    if (!ok) return;

    try {
      // 現在セッションの最後の値（過去セッション保存用にだけ使う）
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

      // リセット回数を増やす（次のセッションの色だけ変わる）
      resetCount++;

      // ★ 新しいセッション：前回の値は引き継がず、完全にゼロから
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
      "現在セッション＋過去セッションのグラフをすべて削除します。\n本当に完全リセットしますか？"
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

// admin.js - 管理画面
// 中央 0 の + / - グラフ（スロットの差枚グラフ風）
// 値 = (理解できた − 理解できなかった) ÷ 想定人数 × 100
// 想定人数 0 のときは (理解 − 不理解) ÷ 投票人数 ×100
// セッションごとに線の色を変える
//   0回目(初回) : 青
//   1回目リセット後 : 赤
//   2回目リセット後 : 緑
// 「投票データをリセット」:
//   その時点までの線を過去セッションに保存し，
//   最新値から次のセッションをスタート
// 「全投票データを完全リセット」:
//   現在セッション＋過去セッションの履歴を全部削除

const ADMIN_PASSWORD = "admin123";

// ===== DOM =====
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

// 過去セッション用キャンバス
const prevCanvases = [
  document.getElementById("prevChart1"),
  document.getElementById("prevChart2"),
  document.getElementById("prevChart3"),
];
const prevNotes = [
  document.getElementById("prevChart-note1"),
  document.getElementById("prevChart-note2"),
  document.getElementById("prevChart-note3"),
];
const prevCtxs = prevCanvases.map((c) => (c ? c.getContext("2d") : null));

// ===== 状態 =====

// 現在セッションの履歴 [{ ts, rate }]
let history = [];

// 過去セッション（最大3つ）
// [{ color: "#xxxxxx", points: [{ts, rate}, ...] }, ...]
// prevSessions[0] が 1つ前、[1] が 2つ前、[2] が3つ前
let prevSessions = [];

// リセット回数（0: 初回セッション, 1:2本目(赤), 2:3本目(緑)…）
let resetCount = 0;

// セッションごとの色
const SESSION_COLORS = ["#4fc3f7", "#ff5252", "#66bb6a"];

// 描画ループ開始フラグ
let animationStarted = false;

// ===== ユーティリティ =====

// 現在セッションの色
function getCurrentColor() {
  const idx = Math.min(resetCount, SESSION_COLORS.length - 1);
  return SESSION_COLORS[idx];
}

// -100〜100 の値をキャンバスY座標に変換（中央が0）
function valueToY(value, canvasHeight, bottomPadding, plotHeight) {
  let v = Math.max(-100, Math.min(100, value));
  // -100 → 下端, 0 → 中央, 100 → 上端
  const ratio = (v + 100) / 200; // 0〜1
  return canvasHeight - bottomPadding - ratio * plotHeight;
}

// ===== 結果取得 =====

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

    // 票数
    numUnderstood.textContent = u;
    numNotUnderstood.textContent = n;
    numTotal.textContent = total;

    // 普通の理解率表示
    const rateDisplay = total > 0 ? Math.round((u / total) * 100) : 0;
    rateUnderstood.textContent = rateDisplay + "%";

    // ---- グラフ用の値（-100〜100） ----
    let rate = null;

    if (maxP > 0) {
      if (total === 0 && history.length > 0) {
        // 投票0でも履歴があるなら前回値を維持
        rate = history[history.length - 1].rate;
      } else if (total === 0 && history.length === 0) {
        rate = null; // 何も描かない
      } else {
        rate = ((u - n) / maxP) * 100;
      }
    } else {
      // 想定人数0 → 投票人数を分母
      if (total > 0) {
        rate = ((u - n) / total) * 100;
      } else if (history.length > 0) {
        rate = history[history.length - 1].rate;
      } else {
        rate = null;
      }
    }

    if (rate !== null) {
      rate = Math.round(rate);
      rate = Math.max(-100, Math.min(100, rate));
    }

    // 想定人数 UI
    if (document.activeElement !== maxInput) {
      maxInput.value = maxP;
    }
    if (maxP > 0) {
      maxInfo.textContent = `想定人数：${maxP}人中、${total}人が投票済み`;
    } else {
      maxInfo.textContent =
        "想定人数が未設定です（投票人数を分母にして計算します）";
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

    // 履歴追加
    addRatePoint(rate);

    // 描画開始
    if (!animationStarted) {
      animationStarted = true;
      requestAnimationFrame(drawLineChart);
    }

    updateTimeLabel();
  } catch (e) {
    console.error(e);
  }
}

// ===== 履歴管理 =====

function addRatePoint(rate) {
  const now = Date.now();
  if (rate === null) return;

  const last = history[history.length - 1];
  if (last && last.rate === rate) return; // 同じ値は追加しない

  history.push({ ts: now, rate });

  if (history.length > 200) {
    history = history.slice(-200);
  }
}

// ===== 現在セッションのグラフ描画（スロット風） =====

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

  const L = 50;
  const R = 20;
  const T = 20;
  const B = 40;
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

  // Y目盛 (-100, -50, 0, 50, 100)
  const yTicks = [-100, -50, 0, 50, 100];
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  yTicks.forEach((v) => {
    const y = valueToY(v, h, B, plotH);

    if (v === 0) {
      // 0ラインは実線
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

  // X方向の縦の補助線
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

// ===== 過去セッションのグラフ描画 =====

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

    const L = 40;
    const R = 15;
    const T = 15;
    const B = 25;
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

    // Y目盛
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

    // X方向補助線
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

    // セッションごとの色
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

// ===== コメント表示 =====

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

// ===== 時刻表示 =====

function updateTimeLabel() {
  if (!timeIndicator) return;
  const now = new Date();
  const text = now.toLocaleTimeString("ja-JP", { hour12: false });
  timeIndicator.textContent = `現在時刻：${text}`;
}

// ===== 想定人数保存 =====

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
        body: JSON.stringify({ maxParticipants: num }),
      });

      if (!res.ok) throw new Error("failed to update max participants");

      const data = await res.json();
      maxInfo.textContent =
        `想定人数：${data.maxParticipants}人中、` +
        `${numTotal.textContent}人が投票済み`;
      alert("想定投票人数を保存しました。");
    } catch (e) {
      console.error(e);
      alert("想定人数の保存に失敗しました。時間をおいて再度お試しください。");
    }
  });
}

// ===== テーマ保存 =====

if (btnSaveTheme && themeInput) {
  btnSaveTheme.addEventListener("click", async () => {
    const theme = themeInput.value.trim();

    try {
      const res = await fetch("/api/admin/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme }),
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

// ===== 投票リセット（セッション単位） =====

if (btnReset) {
  btnReset.addEventListener("click", async () => {
    const ok = confirm(
      "現在セッションの票・コメント・グラフをリセットします。\n本当に実行しますか？"
    );
    if (!ok) return;

    try {
      // 現在セッションの最後の値
      const last = history[history.length - 1];
      const lastRate = last ? last.rate : 0;
      const currentColor = getCurrentColor();

      // 現在セッションを過去セッションへ保存（先頭に追加）
      if (history.length > 0) {
        const copy = history.map((p) => ({ ts: p.ts, rate: p.rate }));
        prevSessions.unshift({ color: currentColor, points: copy });
        if (prevSessions.length > 3) prevSessions = prevSessions.slice(0, 3);
        drawPrevSessions();
      }

      // サーバー側の投票データリセット
      const res = await fetch("/api/admin/reset", { method: "POST" });
      if (!res.ok) throw new Error("failed to reset");

      // リセット回数を増やす → 次セッションの線の色が変わる
      resetCount++;

      // 新しいセッションを、前回の最新値からスタート
      history = [];
      if (last) {
        history.push({ ts: Date.now(), rate: lastRate });
      }

      await fetchResults();
      alert("投票データをリセットしました。");
    } catch (e) {
      console.error(e);
      alert("リセットに失敗しました。時間をおいて再度お試しください。");
    }
  });
}

// ===== 全投票データ完全リセット =====

if (btnResetAll) {
  btnResetAll.addEventListener("click", async () => {
    const ok = confirm(
      "現在セッション＋過去セッションのグラフをすべて削除します。\n本当に完全リセットしますか？"
    );
    if (!ok) return;

    try {
      // server.js 側に /api/admin/reset-all がある前提
      const res = await fetch("/api/admin/reset-all", { method: "POST" });
      if (!res.ok) throw new Error("failed to reset all");

      // 全履歴クリア（クライアント側）
      history = [];
      prevSessions = [];
      resetCount = 0;

      drawPrevSessions();
      await fetchResults();

      alert("全投票データを完全リセットしました。");
    } catch (e) {
      console.error(e);
      alert("完全リセットに失敗しました。時間をおいて再度お試しください。");
    }
  });
}

// ===== ログイン =====

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
}

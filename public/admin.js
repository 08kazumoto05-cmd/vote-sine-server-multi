// admin.js - 管理画面
// ・線は1本のみ（青）
// ・値 = (理解できた − 理解できなかった) ÷ 想定人数 × 100（マイナスは0）
// ・投票が0のときは前回値を維持
// ・「投票データをリセット」するたびに、その時点の最新値から次のセッションがスタート
// ・過去セッションは最大3つまで保存して下の3つのグラフに表示
// ・「全投票データを完全リセット」で全ての履歴削除

const ADMIN_PASSWORD = "admin123";

// DOM
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
const prevCtxs = prevCanvases.map(c => (c ? c.getContext("2d") : null));

// ========== 状態 ==========

// 現在セッションの履歴（{ts, rate}）
let history = [];

// 過去セッション（最大3つ分）。それぞれ [ {ts, rate}, ... ]
let prevSessions = [[], [], []];

// アニメーションフラグ
let animationStarted = false;

// ========== 結果取得 ==========

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

    // 表示用の「理解率」: ふつうの understood / (u + n)
    const rateDisplay =
      total > 0 ? Math.round((u / total) * 100) : 0;
    rateUnderstood.textContent = rateDisplay + "%";

    // ---------- グラフ用1本線の値 ----------
    let rate = null;

    if (maxP > 0) {
      if (total === 0 && history.length > 0) {
        // 投票が0でも、履歴があるときは最新値を維持
        rate = history[history.length - 1].rate;
      } else if (total === 0 && history.length === 0) {
        // 完全に何も無いとき
        rate = null; // 何も描かない
      } else {
        // (理解 − 不理解) ÷ 想定人数 ×100
        rate = Math.round(((u - n) / maxP) * 100);
        if (rate < 0) rate = 0;
        if (rate > 100) rate = 100;
      }
    } else {
      // 想定人数が0 → グラフは非表示
      rate = null;
    }

    // 想定人数UI
    if (document.activeElement !== maxInput) {
      maxInput.value = maxP;
    }
    if (maxP > 0) {
      maxInfo.textContent = `想定人数：${maxP}人中、${total}人が投票済み`;
    } else {
      maxInfo.textContent = "想定人数が未設定です（グラフは表示されません）";
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

    // 描画開始
    if (!animationStarted) {
      animationStarted = true;
      requestAnimationFrame(drawLineChart);
    }

    // 時刻
    updateTimeLabel();
  } catch (e) {
    console.error(e);
  }
}

// ========== 履歴管理 ==========

function addRatePoint(rate) {
  const now = Date.now();

  // 想定人数が0などで「描かない」場合
  if (rate === null) return;

  const last = history[history.length - 1];
  if (last && last.rate === rate) return;

  history.push({ ts: now, rate });
  if (history.length > 200) {
    history = history.slice(-200);
  }
}

// ========== 現在セッションのグラフ描画 ==========

function drawLineChart() {
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  if (history.length === 0) {
    ctx.fillStyle = "#777";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillText("データがありません。", w / 2, h / 2);
    requestAnimationFrame(drawLineChart);
    return;
  }

  // 想定人数0の場合はメッセージだけ
  const maxP = Number(maxInput.value || "0");
  if (!Number.isFinite(maxP) || maxP <= 0) {
    ctx.fillStyle = "#d32f2f";
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

  // 余白
  const L = 50, R = 10, T = 20, B = 48;
  const plotW = w - L - R;
  const plotH = h - T - B;

  // 軸
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(L, T);
  ctx.lineTo(L, h - B);
  ctx.lineTo(w - R, h - B);
  ctx.stroke();

  // Y軸目盛
  ctx.fillStyle = "#888";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  [0, 25, 50, 75, 100].forEach(v => {
    const y = h - B - (v / 100) * plotH;
    ctx.fillText(v + "%", L - 6, y + 2);

    ctx.strokeStyle = "#222";
    ctx.beginPath();
    ctx.moveTo(L, y);
    ctx.lineTo(w - R, y);
    ctx.stroke();
  });

  // X座標
  const stepX = history.length > 1 ? plotW / (history.length - 1) : 0;

  // 青線1本
  ctx.strokeStyle = "#4fc3f7";
  ctx.lineWidth = 2;
  ctx.beginPath();
  history.forEach((p, i) => {
    const x = L + i * stepX;
    const y = h - B - (p.rate / 100) * plotH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // 時刻ラベル
  ctx.fillStyle = "#aaa";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const nowMs = Date.now();
  let lastKey = null;

  history.forEach((p, i) => {
    const x = L + i * stepX;
    const age = nowMs - p.ts;
    const d = new Date(p.ts);

    let label = "";
    if (age <= 5000) {
      label = d.toLocaleTimeString("ja-JP", { hour12: false });
    } else if (age <= 10000) {
      const sec = Math.floor(d.getSeconds() / 5) * 5;
      label =
        `${String(d.getHours()).padStart(2, "0")}:` +
        `${String(d.getMinutes()).padStart(2, "0")}:` +
        `${String(sec).padStart(2, "0")}`;
    } else {
      const sec = Math.floor(d.getSeconds() / 10) * 10;
      label =
        `${String(d.getHours()).padStart(2, "0")}:` +
        `${String(d.getMinutes()).padStart(2, "0")}:` +
        `${String(sec).padStart(2, "0")}`;
    }

    if (label !== lastKey) {
      ctx.fillText(label, x, h - B + 4);
      lastKey = label;
    }
  });

  // タイトル
  ctx.font = "12px sans-serif";
  ctx.fillStyle = "#ccc";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(
    "理解度(理解 − 不理解) の推移（想定人数を分母、マイナスは0として表示）",
    L + plotW / 2,
    T - 4
  );

  requestAnimationFrame(drawLineChart);
}

// ========== 過去セッションのグラフ描画 ==========

function drawPrevSessions() {
  for (let i = 0; i < 3; i++) {
    const hist = prevSessions[i];
    const c = prevCanvases[i];
    const note = prevNotes[i];
    const pctx = prevCtxs[i];

    if (!c || !pctx) continue;

    const w = c.width;
    const h = c.height;

    pctx.clearRect(0, 0, w, h);

    if (!hist || hist.length === 0) {
      if (note) {
        note.textContent = `${i + 1}つ前のセッション：まだグラフはありません。`;
      }
      continue;
    }

    if (note) {
      note.textContent = `${i + 1}つ前のセッション：理解度(理解 − 不理解) の推移`;
    }

    const L = 40, R = 10, T = 15, B = 25;
    const plotW = w - L - R;
    const plotH = h - T - B;

    // 軸
    pctx.strokeStyle = "#444";
    pctx.lineWidth = 1;
    pctx.beginPath();
    pctx.moveTo(L, T);
    pctx.lineTo(L, h - B);
    pctx.lineTo(w - R, h - B);
    pctx.stroke();

    // Y目盛
    pctx.fillStyle = "#aaa";
    pctx.font = "9px sans-serif";
    pctx.textAlign = "right";
    pctx.textBaseline = "middle";

    [0, 25, 50, 75, 100].forEach(v => {
      const y = h - B - (v / 100) * plotH;
      pctx.fillText(v + "%", L - 4, y + 2);
      pctx.strokeStyle = "#222";
      pctx.beginPath();
      pctx.moveTo(L, y);
      pctx.lineTo(w - R, y);
      pctx.stroke();
    });

    const stepX = hist.length > 1 ? plotW / (hist.length - 1) : 0;

    pctx.strokeStyle = "#90caf9";
    pctx.lineWidth = 2;
    pctx.beginPath();
    hist.forEach((p, idx) => {
      const x = L + idx * stepX;
      const y = h - B - (p.rate / 100) * plotH;
      if (idx === 0) pctx.moveTo(x, y);
      else pctx.lineTo(x, y);
    });
    pctx.stroke();
  }
}

// ========== コメント表示 ==========

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

// ========== 時刻表示 ==========

function updateTimeLabel() {
  if (!timeIndicator) return;
  const now = new Date();
  const text = now.toLocaleTimeString("ja-JP", { hour12: false });
  timeIndicator.textContent = `現在時刻：${text}`;
}

// ========== 想定人数保存 ==========

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
      alert("想定人数の保存に失敗しました。時間をおいて再度お試しください。");
    }
  });
}

// ========== テーマ保存 ==========

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

// ========== 投票リセット（セッション単位） ==========

if (btnReset) {
  btnReset.addEventListener("click", async () => {
    const ok = confirm(
      "現在セッションの票・コメント・グラフをリセットします。\n本当に実行しますか？"
    );
    if (!ok) return;

    try {
      // 現在セッションの最後の値を取得
      const last = history[history.length - 1];
      const lastRate = last ? last.rate : 0;

      // 現在セッションを過去セッションに保存（先頭に追加）
      if (history.length > 0) {
        const copy = history.map(p => ({ ts: p.ts, rate: p.rate }));
        prevSessions.unshift(copy);
        if (prevSessions.length > 3) prevSessions = prevSessions.slice(0, 3);
        drawPrevSessions();
      }

      // サーバー側の投票リセット
      const res = await fetch("/api/admin/reset", { method: "POST" });
      if (!res.ok) throw new Error("failed to reset");

      // 新しいセッションのスタート：前回の最新値からスタート
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

// ========== 全投票データ完全リセット ==========

if (btnResetAll) {
  btnResetAll.addEventListener("click", async () => {
    const ok = confirm(
      "現在セッション＋過去3セッションのグラフをすべて削除します。\n本当に完全リセットしますか？"
    );
    if (!ok) return;

    try {
      const res = await fetch("/api/admin/reset-all", { method: "POST" });
      if (!res.ok) throw new Error("failed to reset all");

      // 全履歴クリア
      history = [];
      prevSessions = [[], [], []];
      drawPrevSessions();

      await fetchResults();
      alert("全投票データを完全リセットしました。");
    } catch (e) {
      console.error(e);
      alert("完全リセットに失敗しました。時間をおいて再度お試しください。");
    }
  });
}

// ========== ログイン ==========

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
}

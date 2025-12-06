// admin.js - 管理画面
// ・現在セッションの線：青 1本のみ
// ・値 = (理解できた − 理解できなかった) ÷ 想定人数 × 100
// ・Y軸は -100% 〜 +100% で、中央の0%が基準線（無回答/差ゼロ）
// ・理解できたが多いほど +方向、理解できなかったが多いほど -方向に伸びる
// ・投票が0のときは baselineRate を維持
// ・「投票データをリセット」でそのセッションを保存し、新しいセッションは
//    直前の最新値（baselineRate）からスタート
// ・過去セッション最大3つ保存：セッション1=青, 2=赤, 3=緑
// ・「全投票データを完全リセット」で全履歴削除（/api/admin/reset のみ利用）

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

// セッション1,2,3 の線色
const SESSION_COLORS = [
  "#4fc3f7", // セッション1: 青
  "#e57373", // セッション2: 赤
  "#81c784"  // セッション3: 緑
];

// ===== 状態 =====

// 現在セッションの履歴 [{ts, rate}]
let history = [];

// 過去セッション（最大3つ）
// prevSessions[0] = セッション1 (青)
// prevSessions[1] = セッション2 (赤)
// prevSessions[2] = セッション3 (緑)
let prevSessions = [];

// 描画アニメーションフラグ
let animationStarted = false;

// 次セッションのスタート値（投票が入るたび更新）
let baselineRate = 0;

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

    // 票数表示
    numUnderstood.textContent = u;
    numNotUnderstood.textContent = n;
    numTotal.textContent = total;

    // 表示用「理解率」 = understood / total (0〜100%)
    const rateDisplay = total > 0 ? Math.round((u / total) * 100) : 0;
    rateUnderstood.textContent = rateDisplay + "%";

    // ----- グラフ用値（-100〜+100） -----
    let rate = null;

    if (maxP > 0) {
      if (total === 0) {
        // 投票が0件のあいだは baselineRate をそのまま表示
        rate = baselineRate;
      } else {
        // (理解 − 不理解) ÷ 想定人数 ×100 → -100〜+100 にクリップ
        let raw = ((u - n) / maxP) * 100;
        if (raw > 100) raw = 100;
        if (raw < -100) raw = -100;
        rate = Math.round(raw);

        // 投票があれば baselineRate 更新
        baselineRate = rate;
      }
    } else {
      // 想定人数が0 → グラフ非表示
      rate = null;
    }

    // 想定人数 UI
    if (document.activeElement !== maxInput) {
      maxInput.value = maxP;
    }
    maxInfo.textContent =
      maxP > 0
        ? `想定人数：${maxP}人中、${total}人が投票済み`
        : "想定人数が未設定です（グラフは表示されません）";

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

    // 時刻
    updateTimeLabel();
  } catch (e) {
    console.error(e);
  }
}

// ===== 履歴管理 =====

function addRatePoint(rate) {
  const now = Date.now();

  if (rate === null) return; // 想定人数0のときなど

  const last = history[history.length - 1];
  if (last && last.rate === rate) return;

  history.push({ ts: now, rate });
  if (history.length > 200) {
    history = history.slice(-200);
  }
}

// ===== Y座標変換（-100〜+100 → キャンバスY） =====

function valueToY(v, h, B, plotH) {
  // v: -100〜+100
  // -100 → 一番下, +100 → 一番上, 0 → ちょうど真ん中
  const ratio = (v + 100) / 200; // -100 → 0, 0 → 0.5, +100 → 1
  return h - B - ratio * plotH;
}

// ===== 現在セッションのグラフ描画（青1本） =====

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

  // Y軸目盛（-100, -50, 0, 50, 100）
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  const yTicks = [-100, -50, 0, 50, 100];
  yTicks.forEach(v => {
    const y = valueToY(v, h, B, plotH);

    // 0% の線は少し太め＆明るめ
    if (v === 0) {
      ctx.strokeStyle = "#888";
      ctx.lineWidth = 1.5;
    } else {
      ctx.strokeStyle = "#222";
      ctx.lineWidth = 1;
    }

    // グリッド線
    ctx.beginPath();
    ctx.moveTo(L, y);
    ctx.lineTo(w - R, y);
    ctx.stroke();

    // ラベル
    ctx.fillStyle = "#ccc";
    ctx.fillText(v + "%", L - 6, y + 2);
  });

  const stepX = history.length > 1 ? plotW / (history.length - 1) : 0;

  // 青線（現在セッション）
  ctx.strokeStyle = "#4fc3f7";
  ctx.lineWidth = 2;
  ctx.beginPath();
  history.forEach((p, i) => {
    const x = L + i * stepX;
    const y = valueToY(p.rate, h, B, plotH);
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

    let label;
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
    "理解度のバランス（+側：理解できた が多い / −側：理解できなかった が多い）",
    L + plotW / 2,
    T - 4
  );

  requestAnimationFrame(drawLineChart);
}

// ===== 過去セッションのグラフ描画 =====

function drawPrevSessions() {
  for (let i = 0; i < 3; i++) {
    const hist = prevSessions[i] || [];
    const c = prevCanvases[i];
    const note = prevNotes[i];
    const pctx = prevCtxs[i];

    if (!c || !pctx) continue;

    const w = c.width;
    const h = c.height;

    pctx.clearRect(0, 0, w, h);

    if (!hist || hist.length === 0) {
      if (note) {
        note.textContent = `セッション${i + 1}：まだグラフはありません。`;
      }
      continue;
    }

    if (note) {
      note.textContent = `セッション${i + 1}：理解度バランスの推移`;
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

    // Y軸（-100, -50, 0, 50, 100）
    pctx.font = "9px sans-serif";
    pctx.textAlign = "right";
    pctx.textBaseline = "middle";

    const yTicks = [-100, -50, 0, 50, 100];
    yTicks.forEach(v => {
      const y = valueToY(v, h, B, plotH);

      if (v === 0) {
        pctx.strokeStyle = "#888";
        pctx.lineWidth = 1.5;
      } else {
        pctx.strokeStyle = "#222";
        pctx.lineWidth = 1;
      }

      pctx.beginPath();
      pctx.moveTo(L, y);
      pctx.lineTo(w - R, y);
      pctx.stroke();

      pctx.fillStyle = "#ccc";
      pctx.fillText(v + "%", L - 4, y + 2);
    });

    const stepX = hist.length > 1 ? plotW / (hist.length - 1) : 0;

    // セッションごとの色
    const color = SESSION_COLORS[i] || "#90caf9";
    pctx.strokeStyle = color;
    pctx.lineWidth = 2;
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

// ===== テーマ保存 =====

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

// ===== 投票リセット（セッション単位） =====

if (btnReset) {
  btnReset.addEventListener("click", async () => {
    const ok = confirm(
      "現在セッションの票・コメント・グラフをリセットします。\n本当に実行しますか？"
    );
    if (!ok) return;

    try {
      const last = history[history.length - 1];

      // 「最後の値」があればそれを、なければ baselineRate
      let lastRate = 0;
      if (last && typeof last.rate === "number") {
        lastRate = last.rate;
      } else if (typeof baselineRate === "number") {
        lastRate = baselineRate;
      }

      // 現在セッションを保存（末尾に追加、最大3つ）
      if (history.length > 0) {
        const copy = history.map(p => ({ ts: p.ts, rate: p.rate }));
        prevSessions.push(copy);
        if (prevSessions.length > 3) {
          prevSessions = prevSessions.slice(prevSessions.length - 3);
        }
        drawPrevSessions();
      }

      // サーバー側リセット（票・コメントの実データ）
      const res = await fetch("/api/admin/reset", { method: "POST" });
      if (!res.ok) throw new Error("failed to reset");

      // 次セッションの基準値
      baselineRate = lastRate;

      // 新セッション開始：前回の最新値を1点だけ入れておく
      history = [];
      const maxPNow = Number(maxInput.value || "0");
      if (maxPNow > 0) {
        history.push({ ts: Date.now(), rate: baselineRate });
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
      "現在セッション＋過去3セッションのグラフをすべて削除します。\n本当に完全リセットしますか？"
    );
    if (!ok) return;

    try {
      // サーバー側も通常の reset API を利用
      const res = await fetch("/api/admin/reset", { method: "POST" });
      if (!res.ok) throw new Error("failed to reset all");

      // クライアント側の履歴を完全クリア
      history = [];
      prevSessions = [];
      baselineRate = 0;
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

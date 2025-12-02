// admin.js - 管理画面
// ・票数表示
// ・理解率％表示（折れ線グラフ：理解できた/理解できなかったの2本）
// ・コメント一覧
// ・テーマ設定
// ・想定投票人数
// ・投票リセット＋前回グラフ保存＋前回の最終値から継続

// 簡易パスワード
const ADMIN_PASSWORD = "admin123";

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

const themeInput = document.getElementById("theme-input");
const btnSaveTheme = document.getElementById("btn-save-theme");
const themeInfo = document.getElementById("theme-info");

// 前回リセットまでのグラフ表示用（小さめの別キャンバス）
const prevCanvas = document.getElementById("prevChart");
const prevCtx = prevCanvas ? prevCanvas.getContext("2d") : null;
const prevNote = document.getElementById("prevChart-note");

// ========= 折れ線グラフ用の状態 =========

// 現在セッションの理解度％の履歴データ
// 例: { ts: 173…, rateU: 80, rateN: 20 }
let history = [];

// 前回リセットまでの履歴（理解できた％だけ使って描画）
let prevHistory = [];

// アニメーション開始済みフラグ
let animationStarted = false;

// ========= 結果取得（1秒ごと） =========

async function fetchResults() {
  try {
    const res = await fetch("/api/results");
    if (!res.ok) {
      throw new Error("failed to fetch results");
    }
    const data = await res.json();

    const u = data.understood || 0;
    const n = data.notUnderstood || 0;
    const total = data.total || 0;
    const ratio = data.rateUnderstood || 0; // 0〜1（バックアップ用）
    const maxP = data.maxParticipants ?? 0;
    const theme = data.theme || "";

    numUnderstood.textContent = u;
    numNotUnderstood.textContent = n;
    numTotal.textContent = total;

    // ===== 理解度％の計算 =====
    // ・想定人数が設定されているとき → 想定人数ベース
    //    青線(理解できた%) = understood / maxP
    //    赤線(理解できなかった%) = notUnderstood / maxP
    // ・想定人数が0のとき → 今までどおり「理解できた ÷ (理解 + わからない)」
    // ・投票が0のとき → 前回値を維持（グラフが急に0%に落ちないように）
    let rateU; // 理解できた％
    let rateN; // 理解できなかった％

    if (maxP > 0) {
      rateU = Math.round((u / maxP) * 100);
      rateN = Math.round((n / maxP) * 100);

      // 念のため 0〜100 にクリップ
      rateU = Math.min(100, Math.max(0, rateU));
      rateN = Math.min(100, Math.max(0, rateN));
    } else if (total > 0) {
      // 想定人数が無い場合は従来計算
      rateU = Math.round(ratio * 100);
      rateN = Math.round((n / total) * 100);
    } else if (history.length > 0) {
      // 投票なし → 前回の値を維持
      const last = history[history.length - 1];
      rateU = last.rateU;
      rateN = last.rateN;
    } else {
      rateU = 0;
      rateN = 0;
    }

    // 表示用は「理解できた％」をそのまま利用
    rateUnderstood.textContent = rateU + "%";

    // 想定投票人数（管理者が入力中のときは上書きしない）
    if (maxInput && document.activeElement !== maxInput) {
      maxInput.value = maxP;
    }
    if (maxInfo) {
      if (maxP > 0) {
        maxInfo.textContent = `想定人数：${maxP}人中、${total}人が投票済み`;
      } else {
        maxInfo.textContent = "想定人数は未設定です（0人）";
      }
    }

    // テーマ表示
    if (themeInfo) {
      themeInfo.textContent = theme
        ? `現在のテーマ：${theme}`
        : "現在のテーマ：未設定";
    }
    if (themeInput && document.activeElement !== themeInput) {
      themeInput.value = theme;
    }

    // コメント描画
    renderComments(data.comments || []);

    // グラフ用の履歴に追加
    addRatePoint(rateU, rateN);
    if (!animationStarted) {
      animationStarted = true;
      requestAnimationFrame(drawLineChart);
    }

    // 現在時刻
    updateTimeLabel();
  } catch (e) {
    console.error(e);
  }
}

// ========= 折れ線グラフ用の関数 =========

// 履歴に1点追加（同じ値が続くときは追加しない）
function addRatePoint(rateU, rateN) {
  const now = Date.now();
  const last = history[history.length - 1];

  if (last && last.rateU === rateU && last.rateN === rateN) return;

  history.push({ ts: now, rateU, rateN });

  // 直近200点だけ残す
  if (history.length > 200) {
    history = history.slice(-200);
  }
}

// 折れ線グラフ描画（現在セッション）
function drawLineChart() {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (history.length === 0) {
    ctx.fillStyle = "#666";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("まだ投票データがありません。", w / 2, h / 2);
    requestAnimationFrame(drawLineChart);
    return;
  }

  // 余白
  const paddingLeft = 50;
  const paddingRight = 10;
  const paddingTop = 20;
  const paddingBottom = 48;

  const plotWidth = w - paddingLeft - paddingRight;
  const plotHeight = h - paddingTop - paddingBottom;

  // 軸
  ctx.strokeStyle = "#ccc";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(paddingLeft, paddingTop);
  ctx.lineTo(paddingLeft, h - paddingBottom);
  ctx.lineTo(w - paddingRight, h - paddingBottom);
  ctx.stroke();

  // Y軸（0,25,50,75,100%）
  ctx.fillStyle = "#999";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  [0, 25, 50, 75, 100].forEach((v) => {
    const y = h - paddingBottom - (v / 100) * plotHeight;
    ctx.fillText(v + "%", paddingLeft - 6, y);
    ctx.strokeStyle = "#eee";
    ctx.beginPath();
    ctx.moveTo(paddingLeft, y);
    ctx.lineTo(w - paddingRight, y);
    ctx.stroke();
  });

  // X座標
  const n = history.length;
  const stepX = n > 1 ? plotWidth / (n - 1) : 0;

  // ===== 折れ線（理解できた％：青） =====
  ctx.strokeStyle = "#1976d2"; // 青
  ctx.lineWidth = 2;
  ctx.beginPath();
  history.forEach((p, i) => {
    const x = paddingLeft + stepX * i;
    const y = h - paddingBottom - (p.rateU / 100) * plotHeight;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // ===== 折れ線（理解できなかった％：赤） =====
  ctx.strokeStyle = "#e53935"; // 赤
  ctx.lineWidth = 2;
  ctx.beginPath();
  history.forEach((p, i) => {
    const x = paddingLeft + stepX * i;
    const y = h - paddingBottom - (p.rateN / 100) * plotHeight;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // 時間ラベル（直近5秒は秒単位、その後は5秒／10秒単位）
  ctx.fillStyle = "#555";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const nowMs = Date.now();
  let prevLabelKey = null;

  history.forEach((p, i) => {
    const x = paddingLeft + stepX * i;
    const ts = p.ts;
    const age = nowMs - ts;
    const d = new Date(ts);

    let label = "";
    let labelKey = "";

    if (age <= 5000) {
      // 直近5秒 → 秒単位
      label = d.toLocaleTimeString("ja-JP", { hour12: false });
      labelKey = "sec-" + label;
    } else if (age <= 10000) {
      // 5〜10秒 → 5秒刻み
      const sec = Math.floor(d.getSeconds() / 5) * 5;
      label =
        `${d.getHours().toString().padStart(2, "0")}:` +
        `${d.getMinutes().toString().padStart(2, "0")}:` +
        `${sec.toString().padStart(2, "0")}`;
      labelKey = "5sec-" + label;
    } else {
      // 10秒以上 → 10秒刻み
      const sec = Math.floor(d.getSeconds() / 10) * 10;
      label =
        `${d.getHours().toString().padStart(2, "0")}:` +
        `${d.getMinutes().toString().padStart(2, "0")}:` +
        `${sec.toString().padStart(2, "0")}`;
      labelKey = "10sec-" + label;
    }

    if (labelKey !== prevLabelKey) {
      ctx.fillText(label, x, h - paddingBottom + 4);
      prevLabelKey = labelKey;
    }
  });

  // タイトル＋凡例
  ctx.fillStyle = "#888";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(
    "理解度％の推移（青：理解できた／赤：理解できなかった）",
    paddingLeft + plotWidth / 2,
    paddingTop - 5
  );

  requestAnimationFrame(drawLineChart);
}

// ========= 前回セッションのグラフ描画 =========

function drawPrevChart() {
  if (!prevCanvas || !prevCtx) return;

  const w = prevCanvas.width;
  const h = prevCanvas.height;
  prevCtx.clearRect(0, 0, w, h);

  if (!prevHistory || prevHistory.length === 0) {
    if (prevNote) {
      prevNote.textContent = "まだ前回分のグラフはありません。";
    }
    return;
  }

  if (prevNote) {
    prevNote.textContent = "前回リセットまでの理解度推移（理解できた％）";
  }

  const paddingLeft = 40;
  const paddingRight = 10;
  const paddingTop = 15;
  const paddingBottom = 25;

  const plotWidth = w - paddingLeft - paddingRight;
  const plotHeight = h - paddingTop - paddingBottom;

  // 軸
  prevCtx.strokeStyle = "#ccc";
  prevCtx.lineWidth = 1;
  prevCtx.beginPath();
  prevCtx.moveTo(paddingLeft, paddingTop);
  prevCtx.lineTo(paddingLeft, h - paddingBottom);
  prevCtx.lineTo(w - paddingRight, h - paddingBottom);
  prevCtx.stroke();

  // Y軸
  prevCtx.fillStyle = "#999";
  prevCtx.font = "9px sans-serif";
  prevCtx.textAlign = "right";
  prevCtx.textBaseline = "middle";
  [0, 25, 50, 75, 100].forEach((v) => {
    const y = h - paddingBottom - (v / 100) * plotHeight;
    prevCtx.fillText(v + "%", paddingLeft - 4, y);
    prevCtx.strokeStyle = "#eee";
    prevCtx.beginPath();
    prevCtx.moveTo(paddingLeft, y);
    prevCtx.lineTo(w - paddingRight, y);
    prevCtx.stroke();
  });

  const n = prevHistory.length;
  const stepX = n > 1 ? plotWidth / (n - 1) : 0;

  // 折れ線（前回分は少し淡い色／理解できた％のみ）
  prevCtx.strokeStyle = "#90caf9";
  prevCtx.lineWidth = 2;
  prevCtx.beginPath();
  prevHistory.forEach((p, i) => {
    const x = paddingLeft + stepX * i;
    const y = h - paddingBottom - (p.rateU / 100) * plotHeight;
    if (i === 0) prevCtx.moveTo(x, y);
    else prevCtx.lineTo(x, y);
  });
  prevCtx.stroke();
}

// ========= コメント表示 =========

function renderComments(comments) {
  commentList.innerHTML = "";
  if (!comments || comments.length === 0) {
    const p = document.createElement("p");
    p.className = "small-note";
    p.textContent = "まだコメントはありません。";
    commentList.appendChild(p);
    return;
  }

  const reversed = [...comments].reverse();

  reversed.forEach((c) => {
    const item = document.createElement("div");
    item.className = "comment-item";

    const meta = document.createElement("div");
    meta.className = "comment-meta";

    const tag = document.createElement("span");
    tag.className =
      "comment-tag " +
      (c.choice === "understood" ? "understood" : "not-understood");
    tag.textContent =
      c.choice === "understood" ? "理解できた" : "あまり理解できなかった";

    const time = document.createElement("span");
    let timeText = "";
    try {
      timeText = new Date(c.ts).toLocaleString("ja-JP");
    } catch (e) {
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

// ========= 時刻表示 =========

function updateTimeLabel() {
  if (!timeIndicator) return;
  const now = new Date();
  const text = now.toLocaleTimeString("ja-JP", { hour12: false });
  timeIndicator.textContent = `現在時刻：${text}`;
}

// ========= 想定投票人数の保存 =========

if (btnSaveMax && maxInput) {
  btnSaveMax.addEventListener("click", async () => {
    const raw = maxInput.value;
    const num = Number(raw);

    if (!Number.isFinite(num) || num < 0 || num > 100) {
      alert("0〜100 の範囲で人数を入力してください。");
      return;
    }

    try {
      const res = await fetch("/api/admin/max-participants", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ maxParticipants: num })
      });

      if (!res.ok) {
        throw new Error("failed to update max participants");
      }

      const data = await res.json();
      if (maxInfo) {
        maxInfo.textContent = `想定人数：${data.maxParticipants}人中、現在 ${numTotal.textContent}人が投票済み`;
      }
      alert("想定投票人数を保存しました。");
    } catch (e) {
      console.error(e);
      alert("想定人数の保存に失敗しました。時間をおいて再度お試しください。");
    }
  });
}

// ========= テーマの保存 =========

if (btnSaveTheme && themeInput) {
  btnSaveTheme.addEventListener("click", async () => {
    const theme = themeInput.value.trim();

    try {
      const res = await fetch("/api/admin/theme", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ theme })
      });

      if (!res.ok) {
        throw new Error("failed to save theme");
      }

      const data = await res.json();
      if (themeInfo) {
        themeInfo.textContent = data.theme
          ? `現在のテーマ：${data.theme}`
          : "現在のテーマ：未設定";
      }
      alert("テーマを保存しました。");
    } catch (e) {
      console.error(e);
      alert("テーマの保存に失敗しました。");
    }
  });
}

// ========= 投票リセット =========

if (btnReset) {
  btnReset.addEventListener("click", async () => {
    const ok = confirm("本当に全ての投票・コメント・履歴をリセットしますか？");
    if (!ok) return;

    try {
      // ★ リセット前の履歴を退避して小さいグラフに表示（理解できた％だけ）
      prevHistory = history.map((p) => ({
        ts: p.ts,
        rateU: p.rateU
      }));
      drawPrevChart();

      // ★ 最終理解度％を保持（なければ0）
      const last = history[history.length - 1];
      const lastRateU = last ? last.rateU : 0;
      const lastRateN = last ? last.rateN : 0;

      // サーバー側リセット
      const res = await fetch("/api/admin/reset", {
        method: "POST"
      });

      if (!res.ok) {
        throw new Error("failed to reset");
      }

      // ★ 現在セッションの履歴は一旦クリアし、
      //   「前回の最終値」から新しい時間軸でスタート
      history = [];
      if (last) {
        history.push({ ts: Date.now(), rateU: lastRateU, rateN: lastRateN });
      }

      await fetchResults();
      alert("投票データをリセットしました。（グラフは前回の最終値から継続します）");
    } catch (e) {
      console.error(e);
      alert("リセットに失敗しました。時間をおいて再度お試しください。");
    }
  });
}

// ========= ロック画面（パスワード） =========

btnUnlock.addEventListener("click", () => {
  const input = pwInput.value.trim();
  if (input === ADMIN_PASSWORD) {
    lockScreen.style.display = "none";
    adminContent.style.display = "block";

    // 初回取得
    fetchResults();
    // 1秒ごとに更新
    setInterval(fetchResults, 1000);

    // グラフ描画開始（まだなら）
    if (!animationStarted) {
      animationStarted = true;
      requestAnimationFrame(drawLineChart);
    }

    // 前回グラフがあれば描画
    drawPrevChart();
  } else {
    lockMsg.textContent = "パスワードが違います。";
  }
});

// Enterキーでも解錠
pwInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    btnUnlock.click();
  }
});

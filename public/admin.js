// admin.js - 管理画面
// 線は1本のみ
// 式：
//   想定人数 > 0 のとき   (理解できた − 理解できなかった) ÷ 想定人数 ×100
//   想定人数 = 0 のとき   (理解できた − 理解できなかった) ÷ (理解+不理解) ×100
// マイナスは0にクリップ、100超えは100
// 線の色：セッション番号 0回目=青 / 1回目=赤 / 2回目以降=緑
// 終了したセッションを最大3回まで保存して小さいグラフに表示
// さらに「全投票データ完全リセット」ボタンで全部まっさらにする

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
const btnResetAll = document.getElementById("btn-reset-all");

const themeInput = document.getElementById("theme-input");
const btnSaveTheme = document.getElementById("btn-save-theme");
const themeInfo = document.getElementById("theme-info");

// 過去3セッション用
const prevCanvas1 = document.getElementById("prevChart1");
const prevCanvas2 = document.getElementById("prevChart2");
const prevCanvas3 = document.getElementById("prevChart3");
const prevCtx1 = prevCanvas1 ? prevCanvas1.getContext("2d") : null;
const prevCtx2 = prevCanvas2 ? prevCanvas2.getContext("2d") : null;
const prevCtx3 = prevCanvas3 ? prevCanvas3.getContext("2d") : null;
const prevNote1 = document.getElementById("prevChart-note1");
const prevNote2 = document.getElementById("prevChart-note2");
const prevNote3 = document.getElementById("prevChart-note3");

// 現在セッションの履歴
let history = []; // { ts, rate }
// 過去セッション（最大3件）: 先頭が一番新しい
// { index: セッション番号, color: 線の色, data: [{ts,rate}] }
let pastHistories = [];

let animationStarted = false;
// fetch が重なるのを防ぐフラグ
let isFetchingResults = false;

// リセット回数：localStorage から読み込み
let resetCount = 0;
try {
  const stored = localStorage.getItem("vote_reset_count");
  if (stored !== null) {
    const parsed = Number(stored);
    if (Number.isFinite(parsed) && parsed >= 0) {
      resetCount = parsed;
    }
  }
} catch (e) {
  console.warn("resetCount の読み込みに失敗:", e);
}

// セッション番号から線の色を決める
function getLineColor(sessionIndex) {
  if (sessionIndex === 0) return "#1976d2"; // 青
  if (sessionIndex === 1) return "#e53935"; // 赤
  return "#43a047"; // 緑
}

// ================ 結果取得 ================

async function fetchResults() {
  if (isFetchingResults) return;
  isFetchingResults = true;

  try {
    const res = await fetch("/api/results");
    if (!res.ok) throw new Error("failed to fetch results");
    const data = await res.json();

    const u = data.understood || 0;
    const n = data.notUnderstood || 0;
    const total = u + n;
    const maxP = data.maxParticipants ?? 0;
    const theme = data.theme || "";

    numUnderstood.textContent = u;
    numNotUnderstood.textContent = n;
    numTotal.textContent = total;

    // 表示用理解率（従来通り）
    rateUnderstood.textContent =
      total > 0 ? Math.round((u / total) * 100) + "%" : "0%";

    // グラフ用1本線：(理解−不理解)/分母×100
    let rate;
    if (total === 0) {
      rate = 0;
    } else if (maxP > 0) {
      rate = Math.round(((u - n) / maxP) * 100);
    } else {
      rate = Math.round(((u - n) / total) * 100);
    }
    if (rate < 0) rate = 0;
    if (rate > 100) rate = 100;

    // 想定人数 UI
    if (document.activeElement !== maxInput) {
      maxInput.value = maxP;
    }
    maxInfo.textContent =
      maxP > 0
        ? `想定人数：${maxP}人中、${total}人が投票済み`
        : "想定人数は未設定です（0人）";

    // テーマ UI
    themeInfo.textContent = theme
      ? `現在のテーマ：${theme}`
      : "現在のテーマ：未設定";
    if (document.activeElement !== themeInput) {
      themeInput.value = theme;
    }

    // コメント
    renderComments(data.comments || []);

    // 履歴に追加
    addRatePoint(rate);

    if (!animationStarted) {
      animationStarted = true;
      requestAnimationFrame(drawLineChart);
    }

    updateTimeLabel();
  } catch (e) {
    console.error(e);
  } finally {
    isFetchingResults = false;
  }
}

// ================ 履歴管理 ================

function addRatePoint(rate) {
  const now = Date.now();
  const last = history[history.length - 1];
  if (last && last.rate === rate) return;

  history.push({ ts: now, rate });
  if (history.length > 200) {
    history = history.slice(-200);
  }
}

// ================ 現在セッションのグラフ描画 ================

function drawLineChart() {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (history.length === 0) {
    ctx.fillStyle = "#777";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("まだ投票データがありません。", w / 2, h / 2);
    requestAnimationFrame(drawLineChart);
    return;
  }

  const L = 50, R = 10, T = 20, B = 48;
  const plotW = w - L - R;
  const plotH = h - T - B;

  // 軸
  ctx.strokeStyle = "#ccc";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(L, T);
  ctx.lineTo(L, h - B);
  ctx.lineTo(w - R, h - B);
  ctx.stroke();

  // Y目盛
  ctx.fillStyle = "#666";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  [0, 25, 50, 75, 100].forEach((v) => {
    const y = h - B - (v / 100) * plotH;
    ctx.fillText(v + "%", L - 6, y);
    ctx.strokeStyle = "#eee";
    ctx.beginPath();
    ctx.moveTo(L, y);
    ctx.lineTo(w - R, y);
    ctx.stroke();
  });

  const n = history.length;
  const stepX = n > 1 ? plotW / (n - 1) : 0;

  // 線の色（リセット回数で決定）
  const lineColor = getLineColor(resetCount);

  ctx.strokeStyle = lineColor;
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
  ctx.fillStyle = "#444";
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

  ctx.font = "12px sans-serif";
  ctx.fillStyle = "#666";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(
    "理解度(理解 − 不理解) の推移（想定人数が0のときは投票人数を分母）",
    L + plotW / 2,
    T - 5
  );

  requestAnimationFrame(drawLineChart);
}

// ================ 過去3セッションのグラフ描画 ================

function drawPastCharts() {
  const slots = [
    { canvas: prevCanvas1, ctx: prevCtx1, note: prevNote1, index: 0 },
    { canvas: prevCanvas2, ctx: prevCtx2, note: prevNote2, index: 1 },
    { canvas: prevCanvas3, ctx: prevCtx3, note: prevNote3, index: 2 },
  ];

  slots.forEach((slot) => {
    const { canvas, ctx, note, index } = slot;
    if (!canvas || !ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const hist = pastHistories[index];

    if (!hist || !hist.data || hist.data.length === 0) {
      if (note) {
        if (index === 0) {
          note.textContent = "1つ前のセッション：まだグラフはありません。";
        } else if (index === 1) {
          note.textContent = "2つ前のセッション：まだグラフはありません。";
        } else {
          note.textContent = "3つ前のセッション：まだグラフはありません。";
        }
      }
      return;
    }

    const L = 40, R = 10, T = 15, B = 25;
    const plotW = w - L - R;
    const plotH = h - T - B;

    // 軸
    ctx.strokeStyle = "#ccc";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(L, T);
    ctx.lineTo(L, h - B);
    ctx.lineTo(w - R, h - B);
    ctx.stroke();

    // Y軸
    ctx.fillStyle = "#999";
    ctx.font = "9px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    [0, 25, 50, 75, 100].forEach((v) => {
      const y = h - B - (v / 100) * plotH;
      ctx.fillText(v + "%", L - 4, y);
      ctx.strokeStyle = "#eee";
      ctx.beginPath();
      ctx.moveTo(L, y);
      ctx.lineTo(w - R, y);
      ctx.stroke();
    });

    const n = hist.data.length;
    const stepX = n > 1 ? plotW / (n - 1) : 0;

    ctx.strokeStyle = hist.color;
    ctx.lineWidth = 2;
    ctx.beginPath();

    hist.data.forEach((p, i) => {
      const x = L + i * stepX;
      const y = h - B - (p.rate / 100) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    if (note) {
      const labelIndex = hist.index + 1;
      const colorLabel =
        hist.color === "#1976d2"
          ? "青"
          : hist.color === "#e53935"
          ? "赤"
          : "緑";
      note.textContent = `セッション${labelIndex} の推移（${colorLabel}の線）`;
    }
  });
}

// ================ コメント表示 ================

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
      time.textContent = new Date(c.ts).toLocaleString("ja-JP");

      meta.appendChild(tag);
      meta.appendChild(time);

      const body = document.createElement("div");
      body.textContent = c.text || "";

      item.appendChild(meta);
      item.appendChild(body);

      commentList.appendChild(item);
    });
}

// ================ 時刻表示 ================

function updateTimeLabel() {
  timeIndicator.textContent =
    "現在時刻：" +
    new Date().toLocaleTimeString("ja-JP", { hour12: false });
}

// ================ 想定人数保存 ================

if (btnSaveMax) {
  btnSaveMax.addEventListener("click", async () => {
    const num = Number(maxInput.value);
    if (!Number.isFinite(num) || num < 0 || num > 100) {
      alert("0〜100 の範囲で人数を入力してください。");
      return;
    }

    await fetch("/api/admin/max-participants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxParticipants: num }),
    });

    alert("想定投票人数を保存しました。");
  });
}

// ================ テーマ保存 ================

if (btnSaveTheme) {
  btnSaveTheme.addEventListener("click", async () => {
    const theme = themeInput.value.trim();

    await fetch("/api/admin/theme", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme }),
    });

    alert("テーマを保存しました。");
  });
}

// ================ セッションリセット（過去セッションに保存） ================

if (btnReset) {
  btnReset.addEventListener("click", async () => {
    const ok = confirm(
      "本当に全ての投票・コメント・履歴をリセットしますか？（過去3セッションの保存は残ります）"
    );
    if (!ok) return;

    try {
      // 現在セッションを pastHistories に保存
      if (history.length > 0) {
        const sessionIndex = resetCount;
        const color = getLineColor(sessionIndex);
        const copyData = history.map((p) => ({ ts: p.ts, rate: p.rate }));

        pastHistories.unshift({
          index: sessionIndex,
          color,
          data: copyData,
        });
        if (pastHistories.length > 3) {
          pastHistories = pastHistories.slice(0, 3);
        }
        drawPastCharts();
      }

      // サーバー側リセット
      const res = await fetch("/api/admin/reset", { method: "POST" });
      if (!res.ok) throw new Error("failed to reset");

      // 現在セッションを空に
      history = [];

      // リセット回数アップ＋保存
      resetCount += 1;
      try {
        localStorage.setItem("vote_reset_count", String(resetCount));
      } catch (e) {
        console.warn("resetCount の保存に失敗:", e);
      }

      await fetchResults();

      alert("投票データをリセットしました。（過去セッションに保存されました）");
    } catch (e) {
      console.error(e);
      alert("リセットに失敗しました。時間をおいて再度お試しください。");
    }
  });
}

// ================ 全投票データ完全リセット ================

if (btnResetAll) {
  btnResetAll.addEventListener("click", async () => {
    const ok = confirm(
      "【注意】すべての投票データ・コメント・履歴・過去3セッションのグラフを完全に削除します。よろしいですか？"
    );
    if (!ok) return;

    try {
      const res = await fetch("/api/admin/reset-all", {
        method: "POST",
      });
      if (!res.ok) throw new Error("failed to reset-all");

      // クライアント側データも全クリア
      history = [];
      pastHistories = [];
      resetCount = 0;
      try {
        localStorage.removeItem("vote_reset_count");
      } catch (e) {
        console.warn("resetCount の削除に失敗:", e);
      }

      // 小さいグラフもクリア
      drawPastCharts();

      // メインキャンバスもクリア
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      await fetchResults();

      alert("全ての投票データを完全にリセットしました。");
    } catch (e) {
      console.error(e);
      alert("完全リセットに失敗しました。時間をおいて再度お試しください。");
    }
  });
}

// ================ ログイン処理 ================

btnUnlock.addEventListener("click", unlock);
pwInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") unlock();
});

function unlock() {
  if (pwInput.value.trim() !== ADMIN_PASSWORD) {
    lockMsg.textContent = "パスワードが違います。";
    return;
  }

  lockScreen.style.display = "none";
  adminContent.style.display = "block";

  fetchResults();
  // 500msごとに更新（1秒より遅延を少なく）
  setInterval(fetchResults, 500);

  if (!animationStarted) {
    animationStarted = true;
    requestAnimationFrame(drawLineChart);
  }

  drawPastCharts();
}

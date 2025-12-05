// admin.js - 管理画面
// 線は1本のみ
// 式：
//   想定人数 > 0 のとき   (理解できた − 理解できなかった) ÷ 想定人数 ×100
//   想定人数 = 0 のとき   (理解できた − 理解できなかった) ÷ (理解+不理解) ×100
// マイナスは0にクリップ、100超えは100
// 線の色：セッション番号 0回目=青 / 1回目=赤 / 2回目以降=緑
// さらに、終了したセッションを最大3回分まで保存して小さいグラフに表示

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

// ★ 過去3セッション表示用キャンバス
const prevCanvas1 = document.getElementById("prevChart1");
const prevCanvas2 = document.getElementById("prevChart2");
const prevCanvas3 = document.getElementById("prevChart3");
const prevCtx1 = prevCanvas1 ? prevCanvas1.getContext("2d") : null;
const prevCtx2 = prevCanvas2 ? prevCanvas2.getContext("2d") : null;
const prevCtx3 = prevCanvas3 ? prevCanvas3.getContext("2d") : null;
const prevNote1 = document.getElementById("prevChart-note1");
const prevNote2 = document.getElementById("prevChart-note2");
const prevNote3 = document.getElementById("prevChart-note3");

// 現在セッション
let history = []; // { ts, rate }
// 過去セッション: 先頭が一番新しい終了セッション
// 要素: { index: セッション番号(0,1,2,...), color: 線の色, data: [{ts,rate}] }
let pastHistories = [];

let animationStarted = false;

// ★ リセット回数：localStorage から読み込む（なければ 0）
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

// 線の色をセッション番号から決める
function getLineColor(sessionIndex) {
  if (sessionIndex === 0) return "#1976d2"; // 青
  if (sessionIndex === 1) return "#e53935"; // 赤
  return "#43a047"; // 緑（2回目以降）
}

// ================= 結果取得 =================

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

    numUnderstood.textContent = u;
    numNotUnderstood.textContent = n;
    numTotal.textContent = total;

    // 表示用（従来の理解率）
    rateUnderstood.textContent =
      total > 0 ? Math.round((u / total) * 100) + "%" : "0%";

    // ======== グラフ用 1本線の計算 ========
    let rate;

    if (total === 0) {
      // まだ投票が無い
      rate = 0;
    } else if (maxP > 0) {
      // 想定人数を分母
      rate = Math.round(((u - n) / maxP) * 100);
    } else {
      // 想定人数が未設定 → 実投票数を分母
      rate = Math.round(((u - n) / total) * 100);
    }

    // 0〜100 にクリップ（マイナスは0）
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

    // コメント描画
    renderComments(data.comments || []);

    // 履歴追加
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

// ================= 履歴管理 =================

function addRatePoint(rate) {
  const now = Date.now();
  const last = history[history.length - 1];

  // 同じ値が続くなら追加しない
  if (last && last.rate === rate) return;

  history.push({ ts: now, rate });

  if (history.length > 200) {
    history = history.slice(-200);
  }
}

// ================= グラフ描画（現在セッション：1本線） =================

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

  // X方向
  const n = history.length;
  const stepX = n > 1 ? plotW / (n - 1) : 0;

  // ★ 現在セッションの線の色（リセット回数で決める）
  const lineColor = getLineColor(resetCount);

  // 線を描画
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

// ================= 過去3セッションのグラフ描画 =================

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

    // 線（そのセッションの色）
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
      const labelIndex = hist.index + 1; // 1,2,3,...
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

// ================= コメント表示 =================

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

// ================= 時刻表示 =================

function updateTimeLabel() {
  timeIndicator.textContent =
    "現在時刻：" +
    new Date().toLocaleTimeString("ja-JP", { hour12: false });
}

// ================= 想定人数保存 =================

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

// ================= テーマ保存 =================

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

// ================= 投票リセット =================

if (btnReset) {
  btnReset.addEventListener("click", async () => {
    const ok = confirm("本当に全ての投票・コメント・履歴をリセットしますか？");
    if (!ok) return;

    try {
      // ★ 今までのセッションを pastHistories に保存
      if (history.length > 0) {
        const sessionIndex = resetCount; // このセッションの番号
        const color = getLineColor(sessionIndex);
        const copyData = history.map((p) => ({ ts: p.ts, rate: p.rate }));

        // 先頭に追加（直近の終了セッションが index 0）
        pastHistories.unshift({
          index: sessionIndex,
          color,
          data: copyData,
        });

        // 最大3件まで
        if (pastHistories.length > 3) {
          pastHistories = pastHistories.slice(0, 3);
        }

        // 小さいグラフを再描画
        drawPastCharts();
      }

      // サーバー側リセット
      const res = await fetch("/api/admin/reset", { method: "POST" });
      if (!res.ok) throw new Error("failed to reset");

      // 現在セッションの履歴はクリア
      history = [];

      // ★ リセット回数をカウントアップ＆localStorageに保存
      resetCount += 1;
      try {
        localStorage.setItem("vote_reset_count", String(resetCount));
      } catch (e) {
        console.warn("resetCount の保存に失敗:", e);
      }

      // 表示を最新に
      await fetchResults();

      alert("投票データをリセットしました。");
    } catch (e) {
      console.error(e);
      alert("リセットに失敗しました。時間をおいて再度お試しください。");
    }
  });
}

// ================= ログイン =================

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
  setInterval(fetchResults, 1000);

  if (!animationStarted) {
    animationStarted = true;
    requestAnimationFrame(drawLineChart);
  }

  // 過去セッション（初回は空なので「まだありません」表示）
  drawPastCharts();
}

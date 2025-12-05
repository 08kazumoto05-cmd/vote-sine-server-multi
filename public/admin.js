// admin.js - 管理画面
// 線は1本のみ（青）
// 式：(理解できた − 理解できなかった) ÷ 想定人数 ×100
// マイナスは0にクリップ
// 想定人数が0ならグラフは描画しない＆メッセージ表示

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

let history = [];
let prevHistory = [];
let animationStarted = false;


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
    rateUnderstood.textContent = total > 0 ? Math.round((u / total) * 100) + "%" : "0%";

    // ======== グラフ用 1本線の計算 ========
    let rate;

    if (maxP <= 0) {
      // 想定人数が未設定
      rate = null; // グラフ非表示フラグ
    } else {
      // (理解できた − 理解できなかった) ÷ 想定人数 × 100
      rate = Math.round(((u - n) / maxP) * 100);

      // マイナスは0にクリップ
      if (rate < 0) rate = 0;
      if (rate > 100) rate = 100;
    }

    // 想定人数 UI
    if (document.activeElement !== maxInput)
      maxInput.value = maxP;

    maxInfo.textContent = maxP > 0
      ? `想定人数：${maxP}人中、${total}人が投票済み`
      : "想定人数が未設定です（グラフは表示されません）";

    // テーマ UI
    themeInfo.textContent = theme ? `現在のテーマ：${theme}` : "現在のテーマ：未設定";
    if (document.activeElement !== themeInput)
      themeInput.value = theme;

    // コメント描画
    renderComments(data.comments || []);

    // 履歴を更新
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

  if (rate === null) return; // 想定人数が0 → 履歴追加しない

  if (last && last.rate === rate) return;

  history.push({ ts: now, rate });

  if (history.length > 200)
    history = history.slice(-200);
}


// ================= グラフ描画（1本線） =================

function drawLineChart() {
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  if (history.length === 0) {
    ctx.fillStyle = "#777";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";

    ctx.fillText(
      "データがありません。",
      w / 2,
      h / 2
    );

    requestAnimationFrame(drawLineChart);
    return;
  }

  const latest = history[history.length - 1];

  if (latest.rate === null || maxInput.value === "0") {
    // 想定人数未設定
    ctx.fillStyle = "#d32f2f";
    ctx.font = "16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("想定人数が未設定のため、グラフは表示されません。", w / 2, h / 2);
    requestAnimationFrame(drawLineChart);
    return;
  }

  // 余白
  const L = 50, R = 10, T = 20, B = 48;
  const plotW = w - L - R;
  const plotH = h - T - B;

  // 軸
  ctx.strokeStyle = "#ccc";
  ctx.beginPath();
  ctx.moveTo(L, T);
  ctx.lineTo(L, h - B);
  ctx.lineTo(w - R, h - B);
  ctx.stroke();

  // Y目盛
  ctx.fillStyle = "#666";
  ctx.font = "10px sans-serif";

  [0, 25, 50, 75, 100].forEach(v => {
    const y = h - B - (v / 100) * plotH;
    ctx.fillText(v + "%", L - 6, y + 3);

    ctx.strokeStyle = "#eee";
    ctx.beginPath();
    ctx.moveTo(L, y);
    ctx.lineTo(w - R, y);
    ctx.stroke();
  });

  // X軸ポイント
  const stepX = history.length > 1 ? plotW / (history.length - 1) : 0;

  // ======== 青線 1本 ========
  ctx.strokeStyle = "#1976d2";
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
  ctx.fillText("理解度(理解 − 不理解) の推移（想定人数を分母）", w / 2, T - 5);

  requestAnimationFrame(drawLineChart);
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

  comments.slice().reverse().forEach(c => {
    const item = document.createElement("div");
    item.className = "comment-item";

    const meta = document.createElement("div");
    meta.className = "comment-meta";

    const tag = document.createElement("span");
    tag.className = "comment-tag " + (c.choice === "understood" ? "understood" : "not-understood");
    tag.textContent = c.choice === "understood" ? "理解できた" : "理解できなかった";

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

btnSaveMax.addEventListener("click", async () => {
  const num = Number(maxInput.value);

  if (!Number.isFinite(num) || num < 1 || num > 100) {
    alert("1〜100 の範囲で人数を入力してください。");
    return;
  }

  await fetch("/api/admin/max-participants", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ maxParticipants: num })
  });

  alert("想定投票人数を保存しました。");
});


// ================= テーマ保存 =================

btnSaveTheme.addEventListener("click", async () => {
  const theme = themeInput.value.trim();

  await fetch("/api/admin/theme", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theme })
  });

  alert("テーマを保存しました。");
});


// ================= 投票リセット =================

btnReset.addEventListener("click", async () => {
  const ok = confirm("本当にリセットしますか？");
  if (!ok) return;

  const last = history[history.length - 1];
  const lastRate = last ? last.rate : 0;

  await fetch("/api/admin/reset", { method: "POST" });

  prevHistory = history.map(p => ({ ts: p.ts, rate: p.rate }));
  history = [{ ts: Date.now(), rate: lastRate }];

  alert("投票データをリセットしました。");
});


// ================= ログイン =================

btnUnlock.addEventListener("click", unlock);
pwInput.addEventListener("keydown", e => { if (e.key === "Enter") unlock(); });

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
}

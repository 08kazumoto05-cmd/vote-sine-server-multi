// server.js
// 投票結果＋コメント＋履歴（理解度グラフ用）＋秘密キー付きURL制限

const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");

const app = express();
const PORT = process.env.PORT || 3000;

// ★ URL に付ける秘密キー
const ACCESS_KEY = "class2025-secret";

// ===== メモリ上のデータ =====
const store = {
  understood: 0,
  notUnderstood: 0,
  comments: [],       // { choice, text, ts }
  history: [],        // { ts, understood, notUnderstood }
  theme: ""
};

// 管理者が設定する想定投票人数
let adminSettings = {
  maxParticipants: 0
};

app.use(bodyParser.json());

// 静的ファイル
app.use(express.static(path.join(__dirname, "public")));

// ===== アクセスキー制御 =====
function checkAccessKey(req, res, next) {
  const key = req.query.key;
  if (key !== ACCESS_KEY) {
    return res.status(403).send("アクセス権がありません（URLが正しくありません）。");
  }
  next();
}

// ルートで投票ページへリダイレクト
app.get("/", (req, res) => {
  res.redirect(`/vote.html?key=${ACCESS_KEY}`);
});

// 投票画面（key 必須）
app.get("/vote.html", checkAccessKey, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "vote.html"));
});

// 管理画面
app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ===== API =====

// ------------------------
// 投票 API
// ------------------------
function recordVote(choice, commentText) {
  if (choice === "understood") {
    store.understood++;
  } else if (choice === "not-understood") {
    store.notUnderstood++;
  } else {
    throw new Error("invalid choice");
  }

  const now = new Date().toISOString();

  if (commentText && typeof commentText === "string" && commentText.trim()) {
    store.comments.push({
      choice,
      text: commentText.trim(),
      ts: now
    });
  }

  store.history.push({
    ts: now,
    understood: store.understood,
    notUnderstood: store.notUnderstood
  });
}

app.post("/api/vote/understood", (req, res) => {
  try {
    recordVote("understood", null);
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false });
  }
});

app.post("/api/vote/not-understood", (req, res) => {
  try {
    recordVote("not-understood", null);
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false });
  }
});

// コメント専用 API
app.post("/api/comment", (req, res) => {
  const { text } = req.body || {};
  try {
    recordVote("comment-only", text);
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false });
  }
});

// 結果取得
app.get("/api/results", (req, res) => {
  const total = store.understood + store.notUnderstood;
  const rate = total > 0 ? store.understood / total : 0;

  res.json({
    understood: store.understood,
    notUnderstood: store.notUnderstood,
    total,
    rateUnderstood: rate,
    comments: store.comments.slice(-100),
    history: store.history.slice(-100),
    maxParticipants: adminSettings.maxParticipants,
    theme: store.theme
  });
});

// 想定人数保存
app.post("/api/admin/max-participants", (req, res) => {
  const { maxParticipants } = req.body;
  const num = Number(maxParticipants);

  if (!Number.isFinite(num) || num < 0 || num > 100) {
    return res.status(400).json({ success: false });
  }
  adminSettings.maxParticipants = num;
  res.json({ success: true, maxParticipants: num });
});

// 現在セッションだけリセット
app.post("/api/admin/reset", (_, res) => {
  store.understood = 0;
  store.notUnderstood = 0;
  store.comments = [];
  store.history = [];
  res.json({ success: true });
});

// 全データ完全リセット
app.post("/api/admin/reset-all", (_, res) => {
  store.understood = 0;
  store.notUnderstood = 0;
  store.comments = [];
  store.history = [];
  store.theme = "";
  adminSettings.maxParticipants = 0;
  res.json({ success: true });
});

// テーマ保存
app.post("/api/admin/theme", (req, res) => {
  store.theme = (req.body.theme || "").trim();
  res.json({ success: true, theme: store.theme });
});

// テーマ取得
app.get("/api/theme", (_, res) => {
  res.json({ theme: store.theme });
});

// ===== 起動 =====
app.listen(PORT, () => {
  console.log("Server started on port", PORT);
});

// server.js
// 投票結果＋コメント＋履歴（理解度％の推移グラフ用）＋秘密キー付きURL制限

const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");

const app = express();
const PORT = process.env.PORT || 3000;

// ★ URLに付ける秘密キー
const ACCESS_KEY = "class2025-secret";

// 投票データの保存用（メモリ上）
const store = {
  understood: 0,
  notUnderstood: 0,
  comments: [],
  history: [], // 投票ごとの履歴
  theme: ""
};

// 管理者が設定する想定投票人数（0〜100）
let adminSettings = {
  maxParticipants: 0
};

app.use(bodyParser.json());

// 静的ファイル（/public 以下）はそのまま公開
app.use(express.static(path.join(__dirname, "public")));

// ---------- アクセスキー制御 ----------

// 秘密キーをチェックする共通関数（投票ページ用）
function checkAccessKey(req, res, next) {
  const key = req.query.key;
  if (key !== ACCESS_KEY) {
    return res
      .status(403)
      .send("アクセス権がありません（URLが正しくありません）。");
  }
  next();
}

// ルートに来たら自動で投票ページへリダイレクト
app.get("/", (req, res) => {
  res.redirect(`/vote.html?key=${ACCESS_KEY}`);
});

// 投票画面（key必須）
app.get("/vote.html", checkAccessKey, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "vote.html"));
});

// 管理画面（URL制限はせず、画面内パスワードで保護）
app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ---------- API ----------

// 投票API
app.post("/api/vote", (req, res) => {
  const { choice, comment } = req.body || {};

  if (choice === "understood") {
    store.understood += 1;
  } else if (choice === "not-understood") {
    store.notUnderstood += 1;
  } else {
    return res.status(400).json({ success: false, error: "invalid choice" });
  }

  const now = new Date().toISOString();

  // コメント保存
  if (comment && typeof comment === "string" && comment.trim().length > 0) {
    store.comments.push({
      choice,
      text: comment.trim(),
      ts: now
    });
  }

  // 履歴に「今の累計」を記録
  store.history.push({
    ts: now,
    understood: store.understood,
    notUnderstood: store.notUnderstood
  });

  res.json({ success: true });
});

// 管理者用：想定投票人数（0〜100）を更新するAPI
app.post("/api/admin/max-participants", (req, res) => {
  const { maxParticipants } = req.body || {};

  const num = Number(maxParticipants);
  if (!Number.isFinite(num) || num < 0 || num > 100) {
    return res
      .status(400)
      .json({ success: false, error: "maxParticipants must be 0–100" });
  }

  adminSettings.maxParticipants = num;
  res.json({ success: true, maxParticipants: num });
});

// ★ 管理者用：全投票・コメント・履歴をリセットするAPI
app.post("/api/admin/reset", (req, res) => {
  store.understood = 0;
  store.notUnderstood = 0;
  store.comments = [];
  store.history = [];

  res.json({ success: true });
});

// 結果取得API（管理画面用）
app.get("/api/results", (req, res) => {
  const total = store.understood + store.notUnderstood;
  const rateUnderstood = total > 0 ? store.understood / total : 0;

  // 直近のコメント・履歴だけ返す
  const comments = store.comments.slice(-100);
  const history = store.history.slice(-200);

  res.json({
    understood: store.understood,
    notUnderstood: store.notUnderstood,
    total,
    rateUnderstood,
    comments,
    history,
    maxParticipants: adminSettings.maxParticipants,
    theme: store.theme
  });
});

// ★ 管理者用：アンケートテーマの設定API
app.post("/api/admin/theme", (req, res) => {
  const { theme } = req.body || {};

  if (typeof theme !== "string") {
    return res
      .status(400)
      .json({ success: false, error: "theme must be a string" });
  }

  store.theme = theme.trim();
  res.json({ success: true, theme: store.theme });
});

// ---------- API：投票者・管理者共通でテーマ取得 ----------

// ★ テーマ取得API（投票者側・管理者側どちらからでも利用）
app.get("/api/theme", (req, res) => {
  res.json({ theme: store.theme });
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(
    `投票ページURLの例: http://localhost:${PORT}/vote.html?key=${ACCESS_KEY}`
  );
});

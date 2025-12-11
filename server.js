// server.js
// 投票結果＋コメント＋履歴（興味度グラフ用）＋秘密キー付きURL制限

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
  comments: [],          // { choice, text, ts }
  history: [],           // { ts, understood, notUnderstood }
  theme: ""              // アンケートテーマ
};

// 管理者が設定する想定投票人数（0〜100）
let adminSettings = {
  maxParticipants: 0
};

app.use(bodyParser.json());

// 静的ファイル（/public 以下）
app.use(express.static(path.join(__dirname, "public")));

// ===== アクセスキー制御 =====

// 投票ページ用ミドルウェア
function checkAccessKey(req, res, next) {
  const key = req.query.key;
  if (key !== ACCESS_KEY) {
    return res
      .status(403)
      .send("アクセス権がありません（URLが正しくありません）。");
  }
  next();
}

// ルートに来たら投票ページへリダイレクト
app.get("/", (req, res) => {
  res.redirect(`/vote.html?key=${ACCESS_KEY}`);
});

// 投票画面（key 必須）
app.get("/vote.html", checkAccessKey, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "vote.html"));
});

// 管理画面（管理パスワードで保護する想定。URL制限なし）
app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ===== API =====

// 投票 API
app.post("/api/vote", (req, res) => {
  try {
    const { choice, comment } = req.body || {};

    if (choice === "understood") {
      store.understood += 1;
    } else if (choice === "not-understood") {
      store.notUnderstood += 1;
    } else {
      return res.status(400).json({ success: false, error: "invalid choice" });
    }

    const now = new Date().toISOString();

    // コメント保存（任意）
    if (comment && typeof comment === "string" && comment.trim().length > 0) {
      store.comments.push({
        choice,
        text: comment.trim(),
        ts: now
      });
    }

    // 履歴に「累計値」を記録（管理画面のグラフ用）
    store.history.push({
      ts: now,
      understood: store.understood,
      notUnderstood: store.notUnderstood
    });

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: "internal error" });
  }
});

// ★ コメント単体送信用 API（client.js の /api/comment 用）
// POST /api/comment  { text: "～～～" }
app.post("/api/comment", (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "empty comment" });
    }

    const now = new Date().toISOString();

    // choice は「コメントのみ」の場合は null にしておく
    store.comments.push({
      choice: null,
      text: text.trim(),
      ts: now
    });

    return res.json({ success: true });
  } catch (e) {
    console.error(e);
    return res
      .status(500)
      .json({ success: false, error: "internal error" });
  }
});

// 管理者用：想定投票人数(0〜100) 更新
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

// 管理者用：投票データをリセット（現在セッションのみ）
app.post("/api/admin/reset", (req, res) => {
  // 票・コメント・履歴のみ消す（想定人数とテーマは残す）
  store.understood = 0;
  store.notUnderstood = 0;
  store.comments = [];
  store.history = [];
  res.json({ success: true });
});

// ★ 管理者用：全投票データを完全リセット
//   現在セッション＋過去セッション用のデータをすべてクリアする想定
app.post("/api/admin/reset-all", (req, res) => {
  // 票・コメント・履歴をクリア
  store.understood = 0;
  store.notUnderstood = 0;
  store.comments = [];
  store.history = [];
  store.theme = "";

  // 想定人数もゼロに戻す
  adminSettings.maxParticipants = 0;

  res.json({ success: true });
});

// 結果取得 API（管理画面用）
app.get("/api/results", (req, res) => {
  const total = store.understood + store.notUnderstood;
  const rateUnderstood =
    total > 0 ? store.understood / total : 0;

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

// 管理者用：アンケートテーマ設定
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

// 投票者・管理者共通：テーマ取得
app.get("/api/theme", (req, res) => {
  res.json({ theme: store.theme });
});

// ===== サーバー起動 =====
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(
    `投票ページURLの例: http://localhost:${PORT}/vote.html?key=${ACCESS_KEY}`
  );
});

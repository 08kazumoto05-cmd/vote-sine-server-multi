// server.js
// 投票結果＋コメント＋履歴（興味度グラフ用）＋秘密キー付きURL制限
// ★ 3択 canonical：interested / neutral / not-interested
// ★ 互換：understood / not-understood / positive / negative / notInterested も受ける
// ★ /api/results は admin.js 互換で understood / notUnderstood / neutral を返す
// ★ sessionId を返す（resetで増える）
// ★ reset-all は「色も完全リセット」目的で sessionId を 1 に戻す（重要）
// ★ comments.ts は数値(ms)

const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");

const app = express();
const PORT = process.env.PORT || 3000;

// ★ URL に付ける秘密キー
const ACCESS_KEY = "class2025-secret";

// ===== メモリ上のデータ =====
const store = {
  interested: 0,      // 気になる（+1）
  neutral: 0,         // 普通（0）
  notInterested: 0,   // 気にならない（-1）

  // コメント { choice, text, ts } choice: canonical or null
  comments: [],

  // 履歴（累計） { ts, interested, neutral, notInterested }
  history: [],

  theme: "",

  // ✅ 管理者リセット検知用（resetで増える）
  sessionId: 1,
};

let adminSettings = {
  maxParticipants: 0,
};

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// ===== アクセスキー制御 =====
function checkAccessKey(req, res, next) {
  const key = req.query.key;
  if (key !== ACCESS_KEY) {
    return res.status(403).send("アクセス権がありません（URLが正しくありません）。");
  }
  next();
}

app.get("/", (req, res) => {
  res.redirect(`/vote.html?key=${ACCESS_KEY}`);
});

app.get("/vote.html", checkAccessKey, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "vote.html"));
});

app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ===== ユーティリティ =====
const CANONICAL_CHOICES = ["interested", "neutral", "not-interested"];

function normalizeIncomingChoice(choice) {
  if (choice == null) return null;
  const c = String(choice).trim();

  // canonical
  if (CANONICAL_CHOICES.includes(c)) return c;

  // 旧2択互換
  if (c === "understood") return "interested";
  if (c === "not-understood") return "not-interested";

  // admin.js系互換
  if (c === "positive") return "interested";
  if (c === "negative") return "not-interested";

  // 例：notInterested
  if (c === "notInterested") return "not-interested";

  return "__INVALID__";
}

// admin.js互換へ（adminは normalizeChoice で吸えるが、ここも揃える）
function toAdminChoice(canonicalChoice) {
  if (canonicalChoice === "interested") return "understood";
  if (canonicalChoice === "not-interested") return "not-understood";
  if (canonicalChoice === "neutral") return "neutral";
  return null;
}

function nowMs() {
  return Date.now();
}

function pushHistory(ts) {
  store.history.push({
    ts,
    interested: store.interested,
    neutral: store.neutral,
    notInterested: store.notInterested,
  });
  // 念のため上限
  if (store.history.length > 5000) store.history = store.history.slice(-5000);
}

function pushComment(choiceCanonicalOrNull, text, ts) {
  store.comments.push({
    choice: choiceCanonicalOrNull,
    text,
    ts,
  });
  if (store.comments.length > 5000) store.comments = store.comments.slice(-5000);
}

// ===== API =====

// 投票 API（3択）
// ※ choice が無い場合は「コメントのみ」
app.post("/api/vote", (req, res) => {
  try {
    const { choice, comment } = req.body || {};
    const ts = nowMs();

    const normalized = normalizeIncomingChoice(choice);

    // choiceがある＝投票としてカウント
    if (choice != null) {
      if (normalized === "__INVALID__") {
        return res.status(400).json({
          success: false,
          error: "invalid choice",
          allowed: ["interested", "neutral", "not-interested", "understood", "not-understood", "positive", "negative"],
        });
      }

      if (normalized === "interested") store.interested += 1;
      else if (normalized === "neutral") store.neutral += 1;
      else if (normalized === "not-interested") store.notInterested += 1;

      pushHistory(ts);
    }

    // コメント保存（任意）
    if (typeof comment === "string" && comment.trim().length > 0) {
      const safeText = comment.trim();
      const safeChoice = (normalized === "__INVALID__" ? null : normalized) ?? null;
      pushComment(safeChoice, safeText, ts);
    }

    return res.json({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, error: "internal error" });
  }
});

// コメント単体送信用（互換）
app.post("/api/comment", (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return res.status(400).json({ success: false, error: "empty comment" });
    }

    const ts = nowMs();
    pushComment(null, text.trim(), ts);
    return res.json({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, error: "internal error" });
  }
});

// 管理者用：想定投票人数(0〜100)
app.post("/api/admin/max-participants", (req, res) => {
  const { maxParticipants } = req.body || {};
  const num = Number(maxParticipants);

  if (!Number.isFinite(num) || num < 0 || num > 100) {
    return res.status(400).json({ success: false, error: "maxParticipants must be 0–100" });
  }

  adminSettings.maxParticipants = num;
  return res.json({ success: true, maxParticipants: num });
});

// 管理者用：テーマ
app.post("/api/admin/theme", (req, res) => {
  const { theme } = req.body || {};
  if (typeof theme !== "string") {
    return res.status(400).json({ success: false, error: "theme must be a string" });
  }
  store.theme = theme.trim();
  return res.json({ success: true, theme: store.theme });
});

app.get("/api/theme", (req, res) => {
  return res.json({ theme: store.theme });
});

// 管理者用：現在セッションだけリセット（sessionId増加）
app.post("/api/admin/reset", (req, res) => {
  store.interested = 0;
  store.neutral = 0;
  store.notInterested = 0;

  store.comments = [];
  store.history = [];

  store.sessionId += 1;

  return res.json({ success: true, sessionId: store.sessionId });
});

// 管理者用：完全リセット（色も完全初期化したいので sessionId を 1 に戻す）
app.post("/api/admin/reset-all", (req, res) => {
  store.interested = 0;
  store.neutral = 0;
  store.notInterested = 0;

  store.comments = [];
  store.history = [];
  store.theme = "";

  adminSettings.maxParticipants = 0;

  // ✅ ここがポイント：完全リセット＝ sessionId を初期値へ戻す
  store.sessionId = 1;

  return res.json({ success: true, sessionId: store.sessionId });
});

// 結果取得 API（管理画面/投票者共通）
app.get("/api/results", (req, res) => {
  const total = store.interested + store.neutral + store.notInterested;

  // admin互換
  const understood = store.interested;
  const notUnderstood = store.notInterested;
  const neutral = store.neutral;

  const comments = store.comments.slice(-200).map(c => ({
    choice: toAdminChoice(c.choice), // admin互換
    text: String(c.text ?? ""),
    ts: Number.isFinite(Number(c.ts)) ? Number(c.ts) : nowMs(),
    rawChoice: c.choice ?? null,     // デバッグ用
  }));

  const history = store.history.slice(-400).map(h => ({
    ts: Number.isFinite(Number(h.ts)) ? Number(h.ts) : nowMs(),
    interested: h.interested ?? 0,
    neutral: h.neutral ?? 0,
    notInterested: h.notInterested ?? 0,
  }));

  const rateUnderstood = total > 0 ? understood / total : 0;

  return res.json({
    // admin互換キー
    understood,
    notUnderstood,
    neutral,

    // 追加（新UI互換にも）
    interested: store.interested,
    notInterested: store.notInterested,

    total,
    rateUnderstood,

    comments,
    history,

    maxParticipants: adminSettings.maxParticipants,
    theme: store.theme,

    // ✅ リセット検知用
    sessionId: store.sessionId,
  });
});

// ===== サーバー起動 =====
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`投票ページURLの例: http://localhost:${PORT}/vote.html?key=${ACCESS_KEY}`);
});

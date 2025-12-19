// server.js
// 投票結果＋コメント＋履歴（興味度グラフ用）＋秘密キー付きURL制限
// ★ 3択対応（内部は canonical）：interested / neutral / not-interested
// ★ 互換：understood / not-understood でも投票可能（自動変換）
// ★ /api/results は管理画面互換で understood / notUnderstood / neutral を返す
// ★ sessionId を返す（管理者resetで増える → 投票者側がリセット検知可能）
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
  // 3択カウント（canonical）
  interested: 0,       // 気になる（+1）
  neutral: 0,          // 普通（0）
  notInterested: 0,    // 気にならない（-1）

  // コメント { choice, text, ts }
  // choice: "interested" | "neutral" | "not-interested" | null
  comments: [],

  // 履歴（累計値） { ts, interested, neutral, notInterested }
  history: [],

  theme: "",

  // ✅ 管理者リセット検知用（reset/reset-allで増加）
  sessionId: 1
};

// 管理者が設定する想定投票人数（0〜100）
let adminSettings = {
  maxParticipants: 0
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

// canonical（サーバ内部で使う正規のchoice）
const CANONICAL_CHOICES = ["interested", "neutral", "not-interested"];

// 互換入力を canonical に寄せる
function normalizeIncomingChoice(choice) {
  if (choice == null) return null;

  // 文字列化
  const c = String(choice).trim();

  // まず canonical をそのまま許可
  if (CANONICAL_CHOICES.includes(c)) return c;

  // ✅ 互換（2択UI/旧仕様）
  if (c === "understood") return "interested";
  if (c === "not-understood") return "not-interested";

  // ✅ 互換（あなたの admin.js 系で出てくる表現が混ざっても落ちないように）
  if (c === "positive") return "interested";
  if (c === "negative") return "not-interested";

  // ✅ 互換（例：notInterested など）
  if (c === "notInterested") return "not-interested";

  return "__INVALID__";
}

// 管理画面の既存 admin.js が理解しやすい choice へ変換
function toAdminChoice(canonicalChoice) {
  if (canonicalChoice === "interested") return "understood";
  if (canonicalChoice === "not-interested") return "not-understood";
  if (canonicalChoice === "neutral") return "neutral";
  return null; // コメントのみ等
}

function nowMs() {
  return Date.now();
}

// ===== API =====

// 投票 API（3択）
// ※ choice が無い場合は「コメントのみ」として扱う
app.post("/api/vote", (req, res) => {
  try {
    const { choice, comment } = req.body || {};
    const ts = nowMs();

    const normalized = normalizeIncomingChoice(choice);

    // choice がある場合のみ投票としてカウント
    if (choice != null) {
      if (normalized === "__INVALID__") {
        return res.status(400).json({
          success: false,
          error: "invalid choice",
          allowed: ["interested", "neutral", "not-interested", "understood", "not-understood"]
        });
      }

      if (normalized === "interested") store.interested += 1;
      else if (normalized === "neutral") store.neutral += 1;
      else if (normalized === "not-interested") store.notInterested += 1;

      // 履歴（累計値）
      store.history.push({
        ts,
        interested: store.interested,
        neutral: store.neutral,
        notInterested: store.notInterested
      });
    }

    // コメント保存（任意）
    if (comment && typeof comment === "string" && comment.trim().length > 0) {
      store.comments.push({
        choice: (normalized === "__INVALID__" ? null : normalized) ?? null,
        text: comment.trim(),
        ts
      });
    }

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: "internal error" });
  }
});

// コメント単体送信用 API（互換用）
app.post("/api/comment", (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return res.status(400).json({ success: false, error: "empty comment" });
    }

    const ts = nowMs();

    store.comments.push({
      choice: null,
      text: text.trim(),
      ts
    });

    return res.json({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, error: "internal error" });
  }
});

// 管理者用：想定投票人数(0〜100) 更新
app.post("/api/admin/max-participants", (req, res) => {
  const { maxParticipants } = req.body || {};
  const num = Number(maxParticipants);

  if (!Number.isFinite(num) || num < 0 || num > 100) {
    return res.status(400).json({ success: false, error: "maxParticipants must be 0–100" });
  }

  adminSettings.maxParticipants = num;
  res.json({ success: true, maxParticipants: num });
});

// 管理者用：投票データをリセット（現在セッションのみ）
app.post("/api/admin/reset", (req, res) => {
  store.interested = 0;
  store.neutral = 0;
  store.notInterested = 0;

  store.comments = [];
  store.history = [];

  // ✅ セッション更新（投票者側がリセットを検知できる）
  store.sessionId += 1;

  res.json({ success: true, sessionId: store.sessionId });
});

// 管理者用：全投票データを完全リセット
app.post("/api/admin/reset-all", (req, res) => {
  store.interested = 0;
  store.neutral = 0;
  store.notInterested = 0;

  store.comments = [];
  store.history = [];
  store.theme = "";

  adminSettings.maxParticipants = 0;

  // ✅ セッション更新
  store.sessionId += 1;

  res.json({ success: true, sessionId: store.sessionId });
});

// 結果取得 API（管理画面用/投票者側も使う）
app.get("/api/results", (req, res) => {
  const total = store.interested + store.neutral + store.notInterested;

  // 管理画面互換：understood / notUnderstood
  const understood = store.interested;
  const notUnderstood = store.notInterested;
  const neutral = store.neutral;

  const comments = store.comments.slice(-200).map(c => ({
    choice: toAdminChoice(c.choice),
    text: String(c.text ?? ""),
    ts: Number.isFinite(Number(c.ts)) ? Number(c.ts) : nowMs(),
    rawChoice: c.choice ?? null
  }));

  const history = store.history.slice(-400).map(h => ({
    ts: Number.isFinite(Number(h.ts)) ? Number(h.ts) : nowMs(),
    interested: h.interested ?? 0,
    neutral: h.neutral ?? 0,
    notInterested: h.notInterested ?? 0
  }));

  const rateUnderstood = total > 0 ? understood / total : 0;

  res.json({
    understood,
    notUnderstood,
    neutral,

    total,
    rateUnderstood,

    comments,
    history,

    maxParticipants: adminSettings.maxParticipants,
    theme: store.theme,

    // ✅ 投票者側が「リセットされたか」検知するため
    sessionId: store.sessionId
  });
});

// 管理者用：アンケートテーマ設定
app.post("/api/admin/theme", (req, res) => {
  const { theme } = req.body || {};
  if (typeof theme !== "string") {
    return res.status(400).json({ success: false, error: "theme must be a string" });
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
  console.log(`投票ページURLの例: http://localhost:${PORT}/vote.html?key=${ACCESS_KEY}`);
});


// server.js
// 投票結果＋コメント＋履歴（興味度グラフ用）＋秘密キー付きURL制限
// ★ 3択対応：interested / neutral / not-interested
// ★ 管理画面互換のため /api/results は understood=interested, notUnderstood=not-interested を返す
// ★ 重要：comments.ts は "数値(ms)" で返す（admin.js の safeTs が Number() 前提）
// ★ NEW：1セッションにつき投票は1回だけ（cookie voterId × sessionId でサーバ側拒否）
// ★ NEW：/api/results に sessionId を返す（vote.js がセッション判定に使える）

const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// ★ URL に付ける秘密キー
const ACCESS_KEY = "class2025-secret";

// ===== メモリ上のデータ =====
const store = {
  // セッションID（管理リセットごとに+1）
  sessionId: 1,

  // 3択カウント
  interested: 0,     // 気になる（+1）
  neutral: 0,        // 普通（0）
  notInterested: 0,  // 気にならない（-1）

  // コメント { choice, text, ts }
  // choice: "interested" | "neutral" | "not-interested" | null
  comments: [],

  // 履歴（累計値） { ts, interested, neutral, notInterested }
  history: [],

  theme: ""
};

// 管理者が設定する想定投票人数（0〜100）
let adminSettings = {
  maxParticipants: 0
};

// ===== 1セッション1票制：投票済み管理 =====
// sessionId ごとに Set(voterId) を持つ
const votedBySession = new Map(); // Map<string, Set<string>>

function getVotedSet(sessionId) {
  const key = String(sessionId);
  if (!votedBySession.has(key)) votedBySession.set(key, new Set());
  return votedBySession.get(key);
}

app.use(bodyParser.json());

// 静的ファイル（/public 以下）
app.use(express.static(path.join(__dirname, "public")));

// ===== Cookie（voterId）ユーティリティ（外部ライブラリ不要） =====
function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;

  header.split(";").forEach(part => {
    const i = part.indexOf("=");
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) return;
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function newVoterId() {
  return crypto.randomBytes(16).toString("hex");
}

function ensureVoterId(req, res) {
  const cookies = parseCookies(req);
  let voterId = cookies.voterId;

  // フォーマット軽くチェック（変なのは作り直す）
  if (!voterId || typeof voterId !== "string" || voterId.length < 16) {
    voterId = newVoterId();
    // HttpOnly でOK（JSから読む必要なし）
    // SameSite=Lax で同一サイト利用の通常範囲で送られる
    res.setHeader("Set-Cookie", [
      `voterId=${encodeURIComponent(voterId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}`
    ]);
  }

  return voterId;
}

// ===== アクセスキー制御 =====

// 投票ページ用ミドルウェア
function checkAccessKey(req, res, next) {
  const key = req.query.key;
  if (key !== ACCESS_KEY) {
    return res.status(403).send("アクセス権がありません（URLが正しくありません）。");
  }
  next();
}

// ルートに来たら投票ページへリダイレクト
app.get("/", (req, res) => {
  res.redirect(`/vote.html?key=${ACCESS_KEY}`);
});

// 投票画面（key 必須）＋ voterId cookie を必ず発行
app.get("/vote.html", checkAccessKey, (req, res) => {
  ensureVoterId(req, res);
  res.sendFile(path.join(__dirname, "public", "vote.html"));
});

// 管理画面
app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ===== ユーティリティ =====
const VALID_CHOICES = ["interested", "neutral", "not-interested"];

// 管理画面の既存 admin.js が理解しやすい choice へ変換
function toAdminChoice(choice) {
  if (choice === "interested") return "understood";
  if (choice === "not-interested") return "not-understood";
  if (choice === "neutral") return "neutral";
  return null; // コメントのみ等
}

function nowMs() {
  return Date.now();
}

// ===== API =====

// 投票 API（3択）
// ✅ 1セッション1票：同一 voterId は同一 sessionId で投票不可
// ※ choice が無い場合は「コメントのみ」として扱える（堅牢化）
// ※ コメントのみ送信（isCommentOnly=true）も投票扱いしない
app.post("/api/vote", (req, res) => {
  try {
    const { choice, comment, sessionId: clientSessionId, isCommentOnly } = req.body || {};
    const ts = nowMs();

    // voterId を確保（API直叩きでも発行される）
    const voterId = ensureVoterId(req, res);

    // サーバのセッションIDを正とする（クライアント値は参考程度）
    const sessionId = store.sessionId;

    // コメントのみ扱いなら投票判定をスキップ
    const commentOnly = Boolean(isCommentOnly) || choice == null;

    // ---- 投票（choiceあり＆コメントのみでない） ----
    if (!commentOnly) {
      if (!VALID_CHOICES.includes(choice)) {
        return res.status(400).json({ success: false, error: "invalid choice" });
      }

      // ✅ 1セッション1票チェック
      const set = getVotedSet(sessionId);
      if (set.has(voterId)) {
        return res.status(409).json({
          success: false,
          error: "already voted in this session",
          sessionId
        });
      }

      // 投票登録（先に mark して二重送信も防ぐ）
      set.add(voterId);

      // カウント
      if (choice === "interested") store.interested += 1;
      else if (choice === "neutral") store.neutral += 1;
      else if (choice === "not-interested") store.notInterested += 1;

      // 履歴（累計値）
      store.history.push({
        ts,
        interested: store.interested,
        neutral: store.neutral,
        notInterested: store.notInterested
      });
    }

    // ---- コメント保存（任意） ----
    if (comment && typeof comment === "string" && comment.trim().length > 0) {
      // choice はコメントにも紐づけたいので、投票時はそのchoice、コメントのみ時は null でもOK
      const savedChoice = commentOnly ? (VALID_CHOICES.includes(choice) ? choice : null) : choice;

      store.comments.push({
        choice: savedChoice ?? null,
        text: comment.trim(),
        ts
      });
    }

    res.json({ success: true, sessionId });
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
    return res
      .status(400)
      .json({ success: false, error: "maxParticipants must be 0–100" });
  }

  adminSettings.maxParticipants = num;
  res.json({ success: true, maxParticipants: num });
});

// 管理者用：投票データをリセット（現在セッションのみ）
// ✅ sessionId を +1 して「新セッション開始」
// ✅ 投票済みセットも新セッションに切り替わる
app.post("/api/admin/reset", (req, res) => {
  store.interested = 0;
  store.neutral = 0;
  store.notInterested = 0;

  store.comments = [];
  store.history = [];

  // NEW: セッションを進める
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

  // NEW: セッションを初期化（好みで 1 に戻す）
  store.sessionId = 1;

  // NEW: 投票済み記録も全削除
  votedBySession.clear();

  res.json({ success: true, sessionId: store.sessionId });
});

// 結果取得 API（管理画面用 / 投票側も参照）
app.get("/api/results", (req, res) => {
  const total = store.interested + store.neutral + store.notInterested;

  // ★ 管理画面互換：understood / notUnderstood
  const understood = store.interested;        // +1側
  const notUnderstood = store.notInterested;  // -1側
  const neutral = store.neutral;              // 0側

  // ★ admin.js が扱いやすい形に整形して返す
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

    // NEW: vote.js が「セッションごとに1回」を判断するために返す
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

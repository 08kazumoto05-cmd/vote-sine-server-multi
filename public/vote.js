// vote.js（興味度アンケート用・無制限投票版）
// ✅ 1人何票でも投票可能
// ✅ confirm は毎回表示
// ✅ ボタンID違い耐性あり
// ✅ aタグ / form 誤作動防止
// ✅ 3択サーバ（interested / neutral / not-interested）対応
// ✅ コメントのみ送信可
// ✅ key を API に引き継ぐ

document.addEventListener("DOMContentLoaded", () => {
  // -----------------------------
  // DOM
  // -----------------------------
  const message      = document.getElementById("message");
  const commentInput = document.getElementById("comment-input");
  const themeTitle   = document.getElementById("theme-title");

  const btnSendComment =
    document.getElementById("btn-send-comment") ||
    document.querySelector("[data-comment-send='1']");

  const btnInterested =
    document.getElementById("btn-interested") ||
    document.getElementById("btn-understood") ||
    document.querySelector("[data-choice='interested'],[data-choice='understood']");

  const btnNeutral =
    document.getElementById("btn-neutral") ||
    document.querySelector("[data-choice='neutral']");

  const btnNotInterested =
    document.getElementById("btn-not-interested") ||
    document.getElementById("btn-not-understood") ||
    document.querySelector("[data-choice='not-interested'],[data-choice='not-understood']");

  // -----------------------------
  // key を URL から取得
  // -----------------------------
  const urlParams = new URLSearchParams(window.location.search);
  const accessKey = urlParams.get("key");

  function apiUrl(path) {
    if (!accessKey) return path;
    const sep = path.includes("?") ? "&" : "?";
    return `${path}${sep}key=${encodeURIComponent(accessKey)}`;
  }

  // -----------------------------
  // UI
  // -----------------------------
  function setMessage(text) {
    if (message) message.textContent = text;
  }

  // -----------------------------
  // テーマ取得（表示のみ）
  // -----------------------------
  async function fetchTheme() {
    try {
      const res = await fetch(apiUrl("/api/results"), { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data.theme === "string" && themeTitle) {
        themeTitle.textContent = data.theme;
      }
    } catch (e) {
      console.error(e);
    }
  }

  fetchTheme();

  // -----------------------------
  // choice 正規化
  // -----------------------------
  function normalizeChoice(choice) {
    if (choice === "understood") return "interested";
    if (choice === "not-understood") return "not-interested";
    if (choice === "interested") return "interested";
    if (choice === "neutral") return "neutral";
    if (choice === "not-interested") return "not-interested";
    return null;
  }

  // -----------------------------
  // 投票送信（毎回OK）
  // -----------------------------
  async function postVote(rawChoice, confirmText, successText) {
    const choice = normalizeChoice(rawChoice);
    if (!choice) {
      setMessage("投票の種類が不正です。");
      return;
    }

    const ok = confirm(confirmText);
    if (!ok) return;

    try {
      const res = await fetch(apiUrl("/api/vote"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          choice,
          comment: (commentInput?.value || "").trim()
        })
      });

      if (!res.ok) {
        let extra = "";
        try {
          const ct = (res.headers.get("content-type") || "").toLowerCase();
          if (ct.includes("application/json")) {
            const j = await res.json();
            extra = j?.error ? String(j.error) : JSON.stringify(j);
          } else {
            extra = (await res.text()).slice(0, 200);
          }
        } catch {}
        setMessage(`送信エラー（${res.status}）${extra ? "：" + extra : ""}`);
        return;
      }

      setMessage(successText);
      if (commentInput) commentInput.value = "";
    } catch (e) {
      console.error(e);
      setMessage("送信エラーが発生しました。");
    }
  }

  // -----------------------------
  // ボタンイベント付与（確実版）
  // -----------------------------
  function bindVoteButton(btn, rawChoice, confirmText, successText) {
    if (!btn) return;

    btn.disabled = false;

    btn.addEventListener(
      "click",
      async (e) => {
        e.preventDefault?.();
        e.stopPropagation?.();
        await postVote(rawChoice, confirmText, successText);
      },
      { passive: false }
    );
  }

  bindVoteButton(
    btnInterested,
    "interested",
    "本当に『気になる』で投票しますか？",
    "『気になる』で投票しました。"
  );

  bindVoteButton(
    btnNeutral,
    "neutral",
    "本当に『普通』で投票しますか？",
    "『普通』で投票しました。"
  );

  bindVoteButton(
    btnNotInterested,
    "not-interested",
    "本当に『気にならない』で投票しますか？",
    "『気にならない』で投票しました。"
  );

  // -----------------------------
  // コメントのみ送信
  // -----------------------------
  if (btnSendComment && commentInput) {
    btnSendComment.addEventListener("click", async (e) => {
      e.preventDefault?.();
      e.stopPropagation?.();

      const text = commentInput.value.trim();
      if (!text) {
        setMessage("コメントが空です。");
        return;
      }

      try {
        const res = await fetch(apiUrl("/api/vote"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            choice: null,
            comment: text
          })
        });

        if (!res.ok) {
          setMessage("コメント送信に失敗しました。");
          return;
        }

        setMessage("コメントを送信しました。");
        commentInput.value = "";
      } catch (e2) {
        console.error(e2);
        setMessage("送信エラーが発生しました。");
      }
    });
  }

  // -----------------------------
  // デバッグ表示
  // -----------------------------
  if (!(btnInterested || btnNeutral || btnNotInterested)) {
    setMessage("投票ボタンが見つかりません（IDを確認してください）。");
  } else if (!accessKey) {
    setMessage("URLに key がありません。正しいURLで開いてください。");
  }
});

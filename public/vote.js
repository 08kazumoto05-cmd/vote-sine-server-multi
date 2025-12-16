// vote.js（興味度アンケート用・API対応版：3択）
// ・投票ボタン3つ（気になる / 普通 / 気にならない）
// ・confirm で再確認
// ・/api/vote に { choice, comment } をPOST
//
// choice 仕様（このJS側）
// - interested      : 気になる（+1）
// - neutral         : 普通（ 0）
// - not-interested  : 気にならない（-1）
//
// ※サーバ側がこのchoice文字列を受け取れる実装になっている必要があります

document.addEventListener("DOMContentLoaded", () => {
  const btnInterested    = document.getElementById("btn-interested");      // 「気になる」
  const btnNeutral       = document.getElementById("btn-neutral");         // 「普通」
  const btnNotInterested = document.getElementById("btn-not-interested");  // 「気にならない」
  const btnSendComment   = document.getElementById("btn-send-comment");    // コメントのみ送信

  const message      = document.getElementById("message");
  const commentInput = document.getElementById("comment-input");
  const themeTitle   = document.getElementById("theme-title");

  // -----------------------------
  // メッセージ表示
  // -----------------------------
  function setMessage(text) {
    if (!message) return;
    message.textContent = text;
  }

  // -----------------------------
  // テーマ取得
  // -----------------------------
  async function fetchTheme() {
    try {
      const res = await fetch("/api/results", { cache: "no-store" });
      if (!res.ok) throw new Error("failed to fetch theme");
      const data = await res.json();
      if (data.theme && themeTitle) themeTitle.textContent = data.theme;
    } catch (e) {
      console.error(e);
    }
  }
  fetchTheme();

  // -----------------------------
  // 共通：投票送信
  // -----------------------------
  async function postVote(choice, confirmText, successText) {
    const ok = confirm(confirmText);
    if (!ok) return;

    try {
      const res = await fetch("/api/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          choice,
          comment: (commentInput?.value || "").trim()
        })
      });

      if (!res.ok) throw new Error("vote failed");

      setMessage(successText);
      if (commentInput) commentInput.value = "";
    } catch (e) {
      console.error(e);
      setMessage("送信エラーが発生しました。");
    }
  }

  // -----------------------------
  // 「気になる」
  // -----------------------------
  if (btnInterested) {
    btnInterested.addEventListener("click", async () => {
      await postVote(
        "interested",
        "本当に『気になる』で回答しますか？",
        "『気になる』で回答しました。ありがとうございました！"
      );
    });
  }

  // -----------------------------
  // 「普通」
  // -----------------------------
  if (btnNeutral) {
    btnNeutral.addEventListener("click", async () => {
      await postVote(
        "neutral",
        "本当に『普通』で回答しますか？",
        "『普通』で回答しました。ありがとうございました！"
      );
    });
  }

  // -----------------------------
  // 「気にならない」
  // -----------------------------
  if (btnNotInterested) {
    btnNotInterested.addEventListener("click", async () => {
      await postVote(
        "not-interested",
        "本当に『気にならない』で回答しますか？",
        "『気にならない』で回答しました。ありがとうございました！"
      );
    });
  }

  // -----------------------------
  // コメントのみ送信
  // -----------------------------
  if (btnSendComment && commentInput) {
    btnSendComment.addEventListener("click", async () => {
      const text = commentInput.value.trim();
      if (!text) {
        setMessage("コメントが空です。");
        return;
      }

      try {
        const res = await fetch("/api/vote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // choice 必須の想定なので、0扱いになる "neutral" をダミーで送る
            choice: "neutral",
            comment: text
          })
        });

        if (!res.ok) throw new Error("comment failed");

        setMessage("コメントを送信しました。");
        commentInput.value = "";
      } catch (e) {
        console.error(e);
        setMessage("送信エラーが発生しました。");
      }
    });
  }
});

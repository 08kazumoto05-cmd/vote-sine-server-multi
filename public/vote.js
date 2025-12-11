// vote.js（興味度アンケート用・API完全対応版）
// ・投票ボタン2つとも confirm で再確認
// ・サーバーの /api/vote に { choice, comment } をPOSTする

document.addEventListener("DOMContentLoaded", () => {
  const btnUnderstood    = document.getElementById("btn-understood");      // 「興味がある」
  const btnNotUnderstood = document.getElementById("btn-not-understood");  // 「あまり興味がない」
  const btnSendComment   = document.getElementById("btn-send-comment");    // コメントのみ送信
  const message          = document.getElementById("message");
  const commentInput     = document.getElementById("comment-input");
  const themeTitle       = document.getElementById("theme-title");

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
      const res = await fetch("/api/results");
      if (!res.ok) throw new Error("failed to fetch theme");
      const data = await res.json();
      if (data.theme && themeTitle) {
        themeTitle.textContent = data.theme;
      }
    } catch (e) {
      console.error(e);
    }
  }
  fetchTheme();

  // -----------------------------
  // 「興味がある」ボタン
  // -----------------------------
  if (btnUnderstood) {
    btnUnderstood.addEventListener("click", async () => {
      // ★ 再確認
      const ok = confirm("本当に『興味がある』で回答しますか？");
      if (!ok) return;

      try {
        const res = await fetch("/api/vote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            choice: "understood",
            comment: commentInput.value.trim()
          })
        });

        if (!res.ok) throw new Error("vote failed");

        setMessage("『興味がある』で回答しました。ありがとうございました！");
        commentInput.value = "";
      } catch (e) {
        console.error(e);
        setMessage("送信エラーが発生しました。");
      }
    });
  }

  // -----------------------------
  // 「あまり興味がない」ボタン
  // -----------------------------
  if (btnNotUnderstood) {
    btnNotUnderstood.addEventListener("click", async () => {
      // ★ こちらも再確認を追加
      const ok = confirm("本当に『あまり興味がない』で回答しますか？");
      if (!ok) return;

      try {
        const res = await fetch("/api/vote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            choice: "not-understood",
            comment: commentInput.value.trim()
          })
        });

        if (!res.ok) throw new Error("vote failed");

        setMessage("『あまり興味がない』で回答しました。ありがとうございました！");
        commentInput.value = "";
      } catch (e) {
        console.error(e);
        setMessage("送信エラーが発生しました。");
      }
    });
  }

  // -----------------------------
  // コメントのみ送信ボタン
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
            // サーバー側で choice 必須なのでダミーで "understood" を送る
            choice: "understood",
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

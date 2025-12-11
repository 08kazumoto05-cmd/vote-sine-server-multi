// vote.js（興味度アンケート用・API完全対応版）

document.addEventListener("DOMContentLoaded", () => {
  const btnUnderstood     = document.getElementById("btn-understood");      // 興味がある
  const btnNotUnderstood  = document.getElementById("btn-not-understood");  // あまり興味がない
  const btnSendComment    = document.getElementById("btn-send-comment");    // コメントのみ
  const message           = document.getElementById("message");
  const commentInput      = document.getElementById("comment-input");
  const themeTitle        = document.getElementById("theme-title");

  // メッセージ
  function setMessage(text) {
    if (message) message.textContent = text;
  }

  // テーマ表示
  async function fetchTheme() {
    try {
      const res = await fetch("/api/results");
      const data = await res.json();
      if (data.theme && themeTitle) themeTitle.textContent = data.theme;
    } catch (e) {
      console.error(e);
    }
  }
  fetchTheme();

  // ---- 興味がある ----
  if (btnUnderstood) {
    btnUnderstood.addEventListener("click", async () => {
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

        if (!res.ok) throw new Error();

        setMessage("『興味がある』で回答しました。ありがとうございました！");
        commentInput.value = "";
      } catch (e) {
        console.error(e);
        setMessage("送信エラーが発生しました。");
      }
    });
  }

  // ---- あまり興味がない ----
  if (btnNotUnderstood) {
    btnNotUnderstood.addEventListener("click", async () => {
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

        if (!res.ok) throw new Error();

        setMessage("『あまり興味がない』で回答しました。ありがとうございました！");
        commentInput.value = "";
      } catch (e) {
        console.error(e);
        setMessage("送信エラーが発生しました。");
      }
    });
  }

  // ---- コメントのみ送信 ----
  if (btnSendComment) {
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
            choice: "understood", // choice 必須のためダミー
            comment: text
          })
        });

        if (!res.ok) throw new Error();

        setMessage("コメントを送信しました。");
        commentInput.value = "";
      } catch (e) {
        console.error(e);
        setMessage("送信エラーが発生しました。");
      }
    });
  }
});

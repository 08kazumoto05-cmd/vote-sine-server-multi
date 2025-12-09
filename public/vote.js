// vote.js（興味度アンケート用・シンプル版）

document.addEventListener("DOMContentLoaded", () => {
  const btnUnderstood    = document.getElementById("btn-understood");      // 「興味がある」
  const btnNotUnderstood = document.getElementById("btn-not-understood");  // 「あまり興味がない」
  const btnSendComment   = document.getElementById("btn-send-comment");
  const message          = document.getElementById("message");
  const commentInput     = document.getElementById("comment-input");
  const themeTitle       = document.getElementById("theme-title");

  // メッセージ表示
  function setMessage(text) {
    if (!message) return;
    message.textContent = text;
  }

  // テーマ取得
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

  // 「興味がある」
  if (btnUnderstood) {
    btnUnderstood.addEventListener("click", async () => {
      const ok = confirm("本当に『興味がある』で回答しますか？");
      if (!ok) return;

      try {
        const res = await fetch("/api/vote/understood", { method: "POST" });
        if (!res.ok) throw new Error("vote failed");
        setMessage("『興味がある』で回答しました。ありがとうございました！");
      } catch (e) {
        console.error(e);
        setMessage("送信エラーが発生しました。");
      }
    });
  }

  // 「あまり興味がない」
  if (btnNotUnderstood) {
    btnNotUnderstood.addEventListener("click", async () => {
      try {
        const res = await fetch("/api/vote/not-understood", { method: "POST" });
        if (!res.ok) throw new Error("vote failed");
        setMessage("『あまり興味がない』で回答しました。ありがとうございました！");
      } catch (e) {
        console.error(e);
        setMessage("送信エラーが発生しました。");
      }
    });
  }

  // コメントのみ送信
  if (btnSendComment && commentInput) {
    btnSendComment.addEventListener("click", async () => {
      const text = commentInput.value.trim();
      if (!text) {
        setMessage("コメントが空です。");
        return;
      }

      try {
        const res = await fetch("/api/comment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text })
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

// ===========================
// client.js（興味度アンケート用・安全版）
// ===========================
//
// ・「興味度アンケート」用文言
// ・「興味がある」ボタン押下時は confirm で再確認
// ・DOM読み込み後に要素取得
// ・要素が存在しない場合はエラーにならないようにガード

document.addEventListener("DOMContentLoaded", () => {
  // DOM参照
  const btnUnderstood    = document.getElementById("btn-understood");      // 「興味がある」
  const btnNotUnderstood = document.getElementById("btn-not-understood");  // 「あまり興味がない」
  const btnSendComment   = document.getElementById("btn-send-comment");
  const message          = document.getElementById("message");
  const commentInput     = document.getElementById("comment-input");
  const themeTitle       = document.getElementById("theme-title");

  // ----------------------------
  // テーマを取得（管理画面側で設定）
  // ----------------------------
  async function fetchTheme() {
    try {
      const res = await fetch("/api/results");
      if (!res.ok) throw new Error("failed to fetch theme");

      const data = await res.json();
      if (data.theme && themeTitle) {
        // タイトルは「興味度アンケート」などの前後にテーマを入れる想定
        themeTitle.textContent = data.theme;
      }
    } catch (e) {
      console.error(e);
    }
  }
  fetchTheme();

  // ----------------------------
  // メッセージ表示用ヘルパー
  // ----------------------------
  function setMessage(text) {
    if (!message) return;
    message.textContent = text;
  }

  // ----------------------------
  // 興味がある（旧: 理解できた）
  // ----------------------------
  if (btnUnderstood) {
    btnUnderstood.addEventListener("click", async () => {
      // ★ 再確認を促す
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
  } else {
    console.warn("btn-understood が見つかりませんでした");
  }

  // ----------------------------
  // あまり興味がない（旧: 理解できなかった）
  // ----------------------------
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
  } else {
    console.warn("btn-not-understood が見つかりませんでした");
  }

  // ----------------------------
  // コメント送信
  // ----------------------------
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
  } else {
    console.warn("btn-send-comment もしくは comment-input が見つかりませんでした");
  }
});

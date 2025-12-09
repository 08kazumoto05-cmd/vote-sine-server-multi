// client.js - 投票者用画面（興味バージョン）
//
// ・ボタン表示：
//    「興味がある」         → choice: "understood"
//    「あまり興味がない」   → choice: "not-understood"
// ・コメントだけ送ることも可能
// ・サーバ側 API 仕様は admin 側と同じ（/api/vote）

const btnUnderstood = document.getElementById("btn-understood");
const btnNotUnderstood = document.getElementById("btn-not-understood");
const btnSendComment = document.getElementById("btn-send-comment");
const messageEl = document.getElementById("message");
const commentInput = document.getElementById("comment-input");

// メッセージ表示用ヘルパー
function showMessage(text, isError = false) {
  if (!messageEl) return;
  messageEl.textContent = text;
  messageEl.style.color = isError ? "#e53935" : "#1976d2";
}

// 投票送信
async function sendVote(choice) {
  const comment = commentInput ? commentInput.value.trim() : "";

  try {
    const res = await fetch("/api/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        choice,      // "understood" or "not-understood"
        text: comment || null
      })
    });

    if (!res.ok) throw new Error("サーバーエラー");

    showMessage("ご回答ありがとうございました。", false);

    // 送信後はコメント欄だけ空にしておく
    if (commentInput) {
      commentInput.value = "";
    }
  } catch (e) {
    console.error(e);
    showMessage(
      "送信に失敗しました。通信環境をご確認のうえ、もう一度お試しください。",
      true
    );
  }
}

// コメントのみ送信
async function sendCommentOnly() {
  const comment = commentInput ? commentInput.value.trim() : "";
  if (!comment) {
    showMessage("コメントを入力してください。", true);
    return;
  }

  try {
    const res = await fetch("/api/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        choice: null,   // 票は増やさず、コメントだけ残したい場合
        text: comment
      })
    });

    if (!res.ok) throw new Error("サーバーエラー");

    showMessage("コメントを送信しました。ありがとうございます。", false);
    if (commentInput) commentInput.value = "";
  } catch (e) {
    console.error(e);
    showMessage(
      "コメントの送信に失敗しました。時間をおいて再度お試しください。",
      true
    );
  }
}

// イベント登録
if (btnUnderstood) {
  btnUnderstood.addEventListener("click", () => {
    // 「興味がある」 → understood 側にカウント
    sendVote("understood");
  });
}

if (btnNotUnderstood) {
  btnNotUnderstood.addEventListener("click", () => {
    // 「あまり興味がない」 → not-understood 側にカウント
    sendVote("not-understood");
  });
}

if (btnSendComment) {
  btnSendComment.addEventListener("click", () => {
    sendCommentOnly();
  });
}

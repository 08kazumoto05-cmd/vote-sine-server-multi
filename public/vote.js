// ===========================
// client.js（興味度アンケート用）
// ===========================

// DOM参照
const btnUnderstood = document.getElementById("btn-understood");
const btnNotUnderstood = document.getElementById("btn-not-understood");
const btnSendComment = document.getElementById("btn-send-comment");
const message = document.getElementById("message");
const commentInput = document.getElementById("comment-input");
const themeTitle = document.getElementById("theme-title");

// ----------------------------
// テーマを取得（管理画面側で設定）
// ----------------------------
async function fetchTheme() {
  try {
    const res = await fetch("/api/results");
    const data = await res.json();
    if (data.theme) {
      themeTitle.textContent = data.theme;
    }
  } catch (e) {
    console.error(e);
  }
}
fetchTheme();


// ----------------------------
// 興味あり（理解できた）
// ----------------------------
btnUnderstood.addEventListener("click", async () => {

  // ★ 再確認を促す
  const ok = confirm("本当に『興味がある』で回答しますか？");
  if (!ok) return;

  try {
    const res = await fetch("/api/vote/understood", { method: "POST" });
    if (!res.ok) throw new Error("vote failed");

    message.textContent = "『興味がある』で回答しました。ありがとうございました！";
  } catch (e) {
    console.error(e);
    message.textContent = "送信エラーが発生しました。";
  }
});


// ----------------------------
// あまり興味がない（理解できなかった）
// ----------------------------
btnNotUnderstood.addEventListener("click", async () => {
  try {
    const res = await fetch("/api/vote/not-understood", { method: "POST" });
    if (!res.ok) throw new Error("vote failed");

    message.textContent = "『あまり興味がない』で回答しました。ありがとうございました！";
  } catch (e) {
    console.error(e);
    message.textContent = "送信エラーが発生しました。";
  }
});


// ----------------------------
// コメント送信
// ----------------------------
btnSendComment.addEventListener("click", async () => {
  const text = commentInput.value.trim();
  if (!text) {
    message.textContent = "コメントが空です。";
    return;
  }

  try {
    const res = await fetch("/api/comment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });

    if (!res.ok) throw new Error("comment failed");

    message.textContent = "コメントを送信しました。";
    commentInput.value = "";
  } catch (e) {
    console.error(e);
    message.textContent = "送信エラーが発生しました。";
  }
});

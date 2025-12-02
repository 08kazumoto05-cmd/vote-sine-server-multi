// vote.js
// ・投票は何回でも可能
// ・投票ボタンを押したときに確認ダイアログを表示
// ・サーバーに choice（理解できた/あまり理解できなかった）とコメントを送信
// ・/api/theme を読んで、画面上部にテーマを表示

const btnUnderstood    = document.getElementById("btn-understood");
const btnNotUnderstood = document.getElementById("btn-not-understood");
const msg              = document.getElementById("message");
const commentInput     = document.getElementById("comment-text");

let isSending = false;

// ★ テーマ取得＆表示
async function loadTheme() {
  try {
    const res = await fetch("/api/theme");
    if (!res.ok) throw new Error("failed to load theme");
    const data = await res.json();
    const h = document.getElementById("theme-title");
    if (h) {
      h.textContent = data.theme
        ? `【テーマ】${data.theme}`
        : "【テーマ】（未設定）";
    }
  } catch (e) {
    console.error("テーマ取得エラー:", e);
  }
}

// 初回ロード時
loadTheme();
// 10秒ごとにテーマを再取得（管理者が途中で変えた場合に追従）
setInterval(loadTheme, 10000);

// 共通：投票送信処理
async function sendVote(choice) {
  if (isSending) {
    return; // 連打防止
  }

  if (choice !== "understood" && choice !== "not-understood") {
    alert("「理解できた」か「あまり理解できなかった」を選択してください。");
    return;
  }

  // 確認ダイアログ
  const choiceText =
    choice === "understood" ? "理解できた" : "あまり理解できなかった";
  const ok = confirm(`「${choiceText}」で投票します。よろしいですか？`);
  if (!ok) {
    return;
  }

  const comment = commentInput ? commentInput.value.trim() : "";

  isSending = true;
  if (msg) {
    msg.textContent = "送信中です...";
  }

  try {
    const res = await fetch("/api/vote", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ choice, comment })
    });

    if (!res.ok) {
      throw new Error("投票に失敗しました");
    }

    const data = await res.json();
    if (data.success) {
      if (msg) {
        msg.textContent = "投票ありがとうございました。";
      }
      if (commentInput) {
        commentInput.value = "";
      }
    } else {
      if (msg) {
        msg.textContent = "投票でエラーが発生しました。";
      }
    }
  } catch (e) {
    console.error(e);
    if (msg) {
      msg.textContent =
        "通信エラーが発生しました。時間をおいて再度お試しください。";
    }
  } finally {
    isSending = false;
  }
}

// ボタンにイベントを紐づけ
if (btnUnderstood) {
  btnUnderstood.addEventListener("click", () => sendVote("understood"));
}
if (btnNotUnderstood) {
  btnNotUnderstood.addEventListener("click", () => sendVote("not-understood"));
}

// ===========================
// client.js（興味度アンケート用・互換版）
// ===========================
//
// ・「興味度アンケート」用の文言
// ・「興味がある」ボタン押下時は confirm で再確認
// ・DOMContentLoaded 後に DOM を取得
// ・サーバー側の URL が
//      /api/results /api/vote/... /api/comment
//    なのか
//      /results /vote/... /comment
//    なのか分からなくても動くように、両方を順番に試す
//

document.addEventListener("DOMContentLoaded", () => {
  // --------------------------------------------------
  // 共通：安全な fetch（404 のとき別パスで再トライ）
  // --------------------------------------------------
  async function safeFetch(primaryUrl, options = {}, fallbackUrl) {
    // 1回目：primaryUrl
    try {
      const res = await fetch(primaryUrl, options);
      if (res.ok || !fallbackUrl) {
        return res;
      }
      // 404 などで失敗 → fallback へ
    } catch (e) {
      // ネットワークエラーの場合も fallback を試す
      if (!fallbackUrl) throw e;
    }

    // 2回目：fallbackUrl
    if (fallbackUrl) {
      const res2 = await fetch(fallbackUrl, options);
      if (res2.ok) return res2;
      throw new Error(
        `Both ${primaryUrl} and ${fallbackUrl} failed: ${res2.status}`
      );
    }
  }

  // --------------------------------------------------
  // DOM 参照
  // --------------------------------------------------
  const btnUnderstood     = document.getElementById("btn-understood");      // 「興味がある」
  const btnNotUnderstood  = document.getElementById("btn-not-understood");  // 「あまり興味がない」
  const btnSendComment    = document.getElementById("btn-send-comment");
  const message           = document.getElementById("message");
  const commentInput      = document.getElementById("comment-input");
  const themeTitle        = document.getElementById("theme-title");

  // メッセージ表示ヘルパー
  function setMessage(text) {
    if (!message) return;
    message.textContent = text;
  }

  // --------------------------------------------------
  // テーマ取得（管理画面で設定したテーマを表示）
  // --------------------------------------------------
  async function fetchTheme() {
    try {
      // /api/results → 404 なら /results を試す
      const res = await safeFetch("/api/results", {}, "/results");
      const data = await res.json();
      if (data.theme && themeTitle) {
        themeTitle.textContent = data.theme;
      }
    } catch (e) {
      console.error("テーマ取得に失敗しました:", e);
    }
  }
  fetchTheme();

  // --------------------------------------------------
  // 興味がある（旧: 理解できた）
  // --------------------------------------------------
  if (btnUnderstood) {
    btnUnderstood.addEventListener("click", async () => {
      const ok = confirm("本当に『興味がある』で回答しますか？");
      if (!ok) return;

      try {
        // /api/vote/understood → 404 なら /vote/understood を試す
        const res = await safeFetch(
          "/api/vote/understood",
          { method: "POST" },
          "/vote/understood"
        );
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

  // --------------------------------------------------
  // あまり興味がない（旧: 理解できなかった）
  // --------------------------------------------------
  if (btnNotUnderstood) {
    btnNotUnderstood.addEventListener("click", async () => {
      try {
        // /api/vote/not-understood → 404 なら /vote/not-understood
        const res = await safeFetch(
          "/api/vote/not-understood",
          { method: "POST" },
          "/vote/not-understood"
        );
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

  // --------------------------------------------------
  // コメント送信
  // --------------------------------------------------
  if (btnSendComment && commentInput) {
    btnSendComment.addEventListener("click", async () => {
      const text = commentInput.value.trim();
      if (!text) {
        setMessage("コメントが空です。");
        return;
      }

      try {
        // /api/comment → 404 なら /comment
        const res = await safeFetch(
          "/api/comment",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text })
          },
          "/comment"
        );
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

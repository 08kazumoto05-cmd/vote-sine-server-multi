// vote.js（興味度アンケート用・API完全対応版）
// ✅ 同一セッション内は「1回だけ投票」（= このページ表示中は1回のみ）
// ✅ 「ページ更新したら投票可能に戻す」（= メモリ管理なのでリロードで解除）
// ✅ 「管理者がリセットしたら投票可能に戻す」（= server sessionId を監視して解除）
//
// ・投票ボタン2つとも confirm で再確認
// ・サーバーの /api/vote に { choice, comment } をPOSTする
//
// 注意：server.js 側は /api/results で sessionId を返すこと

document.addEventListener("DOMContentLoaded", () => {
  const btnUnderstood     = document.getElementById("btn-understood");       // 「興味がある」
  const btnNotUnderstood  = document.getElementById("btn-not-understood");   // 「あまり興味がない」
  const btnSendComment    = document.getElementById("btn-send-comment");     // コメントのみ送信

  const message           = document.getElementById("message");
  const commentInput      = document.getElementById("comment-input");
  const themeTitle        = document.getElementById("theme-title");

  // =============================
  // 重要：投票済みは「メモリだけ」で管理
  // → リロードしたら必ず投票可能に戻る
  // =============================
  let votedInThisPage = false;

  // sessionId は「管理者リセット検知」にだけ使う（これは保持してOK）
  let currentSessionId = null;
  let lastSeenSessionId = null;

  function setMessage(text) {
    if (!message) return;
    message.textContent = text;
  }

  function setButtonsEnabled(enabled) {
    const dis = !enabled;
    if (btnUnderstood) btnUnderstood.disabled = dis;
    if (btnNotUnderstood) btnNotUnderstood.disabled = dis;
  }

  function applyVoteLockUI() {
    if (votedInThisPage) {
      setButtonsEnabled(false);
      setMessage("このセッションでは投票済みです。（ページ更新、または管理者のリセットで再投票できます）");
    } else {
      setButtonsEnabled(true);
      // ここでメッセージを毎回消すとUXが悪いので、基本は触らない
    }
  }

  // =============================
  // /api/results からテーマ＆sessionId取得
  // =============================
  async function fetchThemeAndSession() {
    try {
      const res = await fetch("/api/results", { cache: "no-store" });
      if (!res.ok) throw new Error("failed to fetch results");

      const data = await res.json();

      // テーマ
      if (data.theme && themeTitle) themeTitle.textContent = data.theme;

      // sessionId（管理者リセットで増える想定）
      const sid = Number(data.sessionId);

      if (Number.isFinite(sid) && sid >= 1) {
        currentSessionId = sid;

        if (lastSeenSessionId == null) {
          // 初回
          lastSeenSessionId = sid;
        } else if (lastSeenSessionId !== sid) {
          // ✅ 管理者がリセットした：投票可能に戻す
          lastSeenSessionId = sid;
          votedInThisPage = false;
          setButtonsEnabled(true);
          setMessage("管理者がセッションをリセットしました。投票が再び可能です。");
        }
      }

      applyVoteLockUI();
    } catch (e) {
      console.error(e);
      // 取得失敗してもUIは止めない
      applyVoteLockUI();
    }
  }

  // 初回取得
  fetchThemeAndSession();
  // 監視（リセット検知用）
  setInterval(fetchThemeAndSession, 1500);

  // =============================
  // 投票送信（共通）
  // =============================
  async function postVote(choice, confirmText, successText) {
    // 既に投票済みならブロック
    if (votedInThisPage) {
      applyVoteLockUI();
      return;
    }

    const ok = confirm(confirmText);
    if (!ok) return;

    try {
      // 投票直前にも同期（リセット直後のズレ防止）
      await fetchThemeAndSession();

      if (votedInThisPage) {
        applyVoteLockUI();
        return;
      }

      const res = await fetch("/api/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          choice,
          comment: (commentInput?.value || "").trim()
        })
      });

      if (!res.ok) {
        // サーバ側が already voted を返す場合にも対応
        let msg = "送信エラーが発生しました。";
        try {
          const j = await res.json();
          if (j?.error === "already voted") {
            votedInThisPage = true;
            applyVoteLockUI();
            setMessage("このセッションでは既に投票済みです。（ページ更新、または管理者のリセットで再投票できます）");
            return;
          }
        } catch {}
        throw new Error(msg);
      }

      // ✅ 成功：このページ表示中は投票不可
      votedInThisPage = true;
      applyVoteLockUI();

      setMessage(successText);
      if (commentInput) commentInput.value = "";
    } catch (e) {
      console.error(e);
      setMessage("送信エラーが発生しました。");
    }
  }

  // =============================
  // 「興味がある」
  // =============================
  if (btnUnderstood) {
    btnUnderstood.addEventListener("click", async () => {
      await postVote(
        "understood",
        "本当に『興味がある』で回答しますか？",
        "『興味がある』で回答しました。ありがとうございました！"
      );
    });
  }

  // =============================
  // 「あまり興味がない」
  // =============================
  if (btnNotUnderstood) {
    btnNotUnderstood.addEventListener("click", async () => {
      await postVote(
        "not-understood",
        "本当に『あまり興味がない』で回答しますか？",
        "『あまり興味がない』で回答しました。ありがとうございました！"
      );
    });
  }

  // =============================
  // コメントのみ送信
  // =============================
  // 仕様：コメント送信は投票ロックを掛けない
  if (btnSendComment && commentInput) {
    btnSendComment.addEventListener("click", async () => {
      const text = commentInput.value.trim();
      if (!text) {
        setMessage("コメントが空です。");
        return;
      }

      try {
        await fetchThemeAndSession();

        const res = await fetch("/api/vote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // サーバ側でchoice必須ならダミー
            // ※サーバで commentOnly を分けられるなら差し替えてOK
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

  // 初期UI
  applyVoteLockUI();
});

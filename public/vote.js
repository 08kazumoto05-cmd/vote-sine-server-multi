// vote.js（興味度アンケート用・API完全対応版）
// ✅ 同一セッション内は「1回だけ投票」
// ✅ ただし「ページ更新したら投票可能に戻す」(sessionStorageを使う)
// ✅ さらに「管理者がリセットしたら投票可能に戻す」(server sessionId を監視)
//
// ・投票ボタン2つとも confirm で再確認
// ・サーバーの /api/vote に { choice, comment } をPOSTする
//
// 注意：server.js 側は choice を understood/not-understood を受け付ける実装であること

document.addEventListener("DOMContentLoaded", () => {
  const btnUnderstood     = document.getElementById("btn-understood");       // 「興味がある」
  const btnNotUnderstood  = document.getElementById("btn-not-understood");   // 「あまり興味がない」
  const btnSendComment    = document.getElementById("btn-send-comment");     // コメントのみ送信

  const message           = document.getElementById("message");
  const commentInput      = document.getElementById("comment-input");
  const themeTitle        = document.getElementById("theme-title");

  // =============================
  // セッション内1回投票 制御
  // =============================
  // sessionStorageは「ページ更新で消える」ので、
  // → 更新したら投票可になる（要件通り）
  const SS_KEY_VOTED = "vote_once_voted";
  const SS_KEY_SID   = "vote_once_session_id";

  let currentSessionId = null;

  function setMessage(text) {
    if (!message) return;
    message.textContent = text;
  }

  function setButtonsEnabled(enabled) {
    const dis = !enabled;
    if (btnUnderstood) btnUnderstood.disabled = dis;
    if (btnNotUnderstood) btnNotUnderstood.disabled = dis;
  }

  function markVoted() {
    sessionStorage.setItem(SS_KEY_VOTED, "1");
  }

  function clearVoted() {
    sessionStorage.removeItem(SS_KEY_VOTED);
  }

  function hasVoted() {
    return sessionStorage.getItem(SS_KEY_VOTED) === "1";
  }

  function saveSessionId(sid) {
    sessionStorage.setItem(SS_KEY_SID, String(sid));
  }

  function loadSessionId() {
    const v = sessionStorage.getItem(SS_KEY_SID);
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function applyVoteLockUI() {
    if (hasVoted()) {
      setButtonsEnabled(false);
      setMessage("このセッションでは投票済みです。（ページ更新、または管理者のリセットで再投票できます）");
    } else {
      setButtonsEnabled(true);
      // メッセージは上書きしない（自由入力のため）
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

        // 初回 or 管理者リセット検知
        const prevSid = loadSessionId();
        if (prevSid == null) {
          // 初回：保存だけ
          saveSessionId(sid);
        } else if (prevSid !== sid) {
          // ✅ 管理者がリセットした：投票状態を解除
          clearVoted();
          saveSessionId(sid);
          setMessage("管理者がセッションをリセットしました。投票が再び可能です。");
          setButtonsEnabled(true);
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
    // 既に投票済みならブロック（念のため）
    if (hasVoted()) {
      applyVoteLockUI();
      return;
    }

    const ok = confirm(confirmText);
    if (!ok) return;

    try {
      // 投票直前にもセッション同期（ズレ防止）
      await fetchThemeAndSession();

      if (hasVoted()) {
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

      // サーバ側が「既に投票済み」を返す実装の場合も想定
      if (!res.ok) {
        let msg = "送信エラーが発生しました。";
        try {
          const j = await res.json();
          if (j?.error === "already voted") {
            msg = "このセッションでは既に投票済みです。（ページ更新、または管理者のリセットで再投票できます）";
            markVoted();
            applyVoteLockUI();
            setMessage(msg);
            return;
          }
        } catch {}
        throw new Error(msg);
      }

      // ✅ 成功したらこのページ表示中は投票不可
      markVoted();
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
  // 仕様：コメントだけは投票回数に含めない（＝投票ロックを掛けない）
  if (btnSendComment && commentInput) {
    btnSendComment.addEventListener("click", async () => {
      const text = commentInput.value.trim();
      if (!text) {
        setMessage("コメントが空です。");
        return;
      }

      try {
        // コメント送信前にセッション同期（リセット表示を反映）
        await fetchThemeAndSession();

        const res = await fetch("/api/vote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // サーバー側で choice 必須なのでダミー（投票にカウントしない実装が望ましい）
            // ※あなたの server.js 側が commentOnly を判定できるならそれに合わせてください
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

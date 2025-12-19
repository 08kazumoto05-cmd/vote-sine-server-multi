// vote.js（興味度アンケート用・API対応版：3択）
// ✅ 1セッションにつき投票は1回だけ（localStorage + sessionId）
// - /api/results から sessionId を取得して鍵にする
// - voted:<sessionId> を localStorage に保存
// - 投票済みなら投票ボタンを無効化＆メッセージ表示
//
// choice 仕様
// - interested     : 気になる（+1）
// - neutral        : 普通（ 0）
// - not-interested : 気にならない（-1）
//
// 注意：厳密に不正防止するならサーバ側でも二重投票を拒否してください（これはフロント側制御）

document.addEventListener("DOMContentLoaded", () => {
  const btnInterested    = document.getElementById("btn-interested");      // 「気になる」
  const btnNeutral       = document.getElementById("btn-neutral");         // 「普通」
  const btnNotInterested = document.getElementById("btn-not-interested");  // 「気にならない」
  const btnSendComment   = document.getElementById("btn-send-comment");    // コメントのみ送信

  const message      = document.getElementById("message");
  const commentInput = document.getElementById("comment-input");
  const themeTitle   = document.getElementById("theme-title");

  // ========= セッション管理（1セッション=1票） =========
  let currentSessionId = "default"; // /api/results が返さない場合のフォールバック
  let votedKey = makeVotedKey(currentSessionId);

  function makeVotedKey(sessionId) {
    return `voted:${String(sessionId ?? "default")}`;
  }

  function getVotedChoice(sessionId) {
    try {
      const raw = localStorage.getItem(makeVotedKey(sessionId));
      return raw ? String(raw) : null; // 'interested' | 'neutral' | 'not-interested'
    } catch {
      return null;
    }
  }

  function setVotedChoice(sessionId, choice) {
    try {
      localStorage.setItem(makeVotedKey(sessionId), String(choice));
    } catch {
      // localStorage使えない環境でも動作は続ける（ただし制限は弱くなる）
    }
  }

  function setMessage(text) {
    if (!message) return;
    message.textContent = text;
  }

  function setVoteButtonsEnabled(enabled) {
    const disabled = !enabled;
    if (btnInterested)    btnInterested.disabled = disabled;
    if (btnNeutral)       btnNeutral.disabled = disabled;
    if (btnNotInterested) btnNotInterested.disabled = disabled;
  }

  function choiceLabel(choice) {
    if (choice === "interested") return "気になる";
    if (choice === "neutral") return "普通";
    if (choice === "not-interested") return "気にならない";
    return "（不明）";
  }

  function applyVotedUIIfNeeded() {
    const already = getVotedChoice(currentSessionId);
    if (already) {
      setVoteButtonsEnabled(false);
      setMessage(`このセッションでは既に「${choiceLabel(already)}」で回答済みです。ありがとうございました！`);
      return true;
    }
    setVoteButtonsEnabled(true);
    return false;
  }

  // ========= テーマ＆sessionId取得 =========
  async function fetchThemeAndSession() {
    try {
      const res = await fetch("/api/results", { cache: "no-store" });
      if (!res.ok) throw new Error("failed to fetch results");
      const data = await res.json();

      // テーマ表示
      if (data.theme && themeTitle) themeTitle.textContent = data.theme;

      // ✅ sessionId（admin側でリセット時に進める想定）
      const sid = (data.sessionId != null) ? data.sessionId : "default";

      // セッションが変わったらキー更新＆UI再判定
      if (String(sid) !== String(currentSessionId)) {
        currentSessionId = String(sid);
        votedKey = makeVotedKey(currentSessionId);
      }

      applyVotedUIIfNeeded();
    } catch (e) {
      console.error(e);
      // sessionIdが取れなくても最低限動かす
      applyVotedUIIfNeeded();
    }
  }

  fetchThemeAndSession();
  // セッション切替に追従したいので定期更新（軽め）
  setInterval(fetchThemeAndSession, 3000);

  // ========= 共通：投票送信 =========
  async function postVote(choice, confirmText, successText) {
    // まずローカルで「投票済み」判定
    if (getVotedChoice(currentSessionId)) {
      applyVotedUIIfNeeded();
      return;
    }

    const ok = confirm(confirmText);
    if (!ok) return;

    // 送信中は二重クリック防止
    setVoteButtonsEnabled(false);

    try {
      const res = await fetch("/api/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          choice,
          // コメントは任意：投票と一緒に送る
          comment: (commentInput?.value || "").trim(),
          // ✅ サーバ側で使えるなら sessionId も渡す（無視されてもOK）
          sessionId: currentSessionId,
        }),
      });

      if (!res.ok) throw new Error("vote failed");

      // ✅ 投票成功したらこのセッションは投票済みにする
      setVotedChoice(currentSessionId, choice);

      setMessage(successText);
      if (commentInput) commentInput.value = "";

      // 念のためUIも固定
      applyVotedUIIfNeeded();
    } catch (e) {
      console.error(e);
      setMessage("送信エラーが発生しました。");

      // 失敗時は再投票できるよう戻す（投票済み判定は付けない）
      applyVotedUIIfNeeded();
    }
  }

  // ========= 各ボタン =========
  if (btnInterested) {
    btnInterested.addEventListener("click", async () => {
      await postVote(
        "interested",
        "本当に『気になる』で回答しますか？",
        "『気になる』で回答しました。ありがとうございました！"
      );
    });
  }

  if (btnNeutral) {
    btnNeutral.addEventListener("click", async () => {
      await postVote(
        "neutral",
        "本当に『普通』で回答しますか？",
        "『普通』で回答しました。ありがとうございました！"
      );
    });
  }

  if (btnNotInterested) {
    btnNotInterested.addEventListener("click", async () => {
      await postVote(
        "not-interested",
        "本当に『気にならない』で回答しますか？",
        "『気にならない』で回答しました。ありがとうございました！"
      );
    });
  }

  // ========= コメントのみ送信 =========
  // 方針：投票済みでもコメント送信はOK（1票制と両立）
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
            // サーバが choice 必須の場合のダミー（0扱い）
            choice: "neutral",
            comment: text,
            sessionId: currentSessionId,
            isCommentOnly: true,
          }),
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

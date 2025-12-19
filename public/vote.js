// vote.js（興味度アンケート用・耐性版）
// ✅ 投票ボタンIDが違っても動くように複数候補から拾う
// ✅ confirm が出ない問題（イベント未付与 / aタグ遷移 / form送信）を潰す
// ✅ 3択サーバ（interested/neutral/not-interested）に合わせて送る
// ✅ コメントのみ送信は choice=null で送る
// ✅ key を API にも引き継ぐ（?key=...）
//
// 重要：vote.html 側のボタンIDがどれでも動くようにしている

document.addEventListener("DOMContentLoaded", () => {
  // -----------------------------
  // DOM
  // -----------------------------
  const message      = document.getElementById("message");
  const commentInput = document.getElementById("comment-input");
  const themeTitle   = document.getElementById("theme-title");

  // コメント送信ボタンは id がこれの想定（違っても data-comment-send でも拾う）
  const btnSendComment =
    document.getElementById("btn-send-comment") ||
    document.querySelector("[data-comment-send='1']");

  // ✅ 投票ボタン候補（あなたの過去コード分も全部拾う）
  const btnInterested =
    document.getElementById("btn-interested") ||        // 3択版
    document.getElementById("btn-understood") ||        // 2択版（興味あり）
    document.querySelector("[data-choice='interested'],[data-choice='understood']");

  const btnNeutral =
    document.getElementById("btn-neutral") ||
    document.querySelector("[data-choice='neutral']");

  const btnNotInterested =
    document.getElementById("btn-not-interested") ||    // 3択版
    document.getElementById("btn-not-understood") ||    // 2択版（興味なし）
    document.querySelector("[data-choice='not-interested'],[data-choice='not-understood']");

  // -----------------------------
  // key を現在URLから取得して API に付与
  // -----------------------------
  const urlParams = new URLSearchParams(window.location.search);
  const accessKey = urlParams.get("key");

  function apiUrl(path) {
    if (!accessKey) return path;
    const sep = path.includes("?") ? "&" : "?";
    return `${path}${sep}key=${encodeURIComponent(accessKey)}`;
  }

  // -----------------------------
  // UI
  // -----------------------------
  function setMessage(text) {
    if (!message) return;
    message.textContent = text;
  }

  function disableVoteButtons(disabled) {
    const dis = !!disabled;
    if (btnInterested) btnInterested.disabled = dis;
    if (btnNeutral) btnNeutral.disabled = dis;
    if (btnNotInterested) btnNotInterested.disabled = dis;
  }

  // -----------------------------
  // sessionId 監視（管理者リセットで投票可能に戻す）
  // ※「ページ更新で投票可能に戻す」はメモリ管理なので自動で満たす
  // -----------------------------
  let votedInThisPage = false;
  let lastSeenSessionId = null;

  async function fetchThemeAndSession() {
    try {
      const res = await fetch(apiUrl("/api/results"), { cache: "no-store" });
      if (!res.ok) return;

      const data = await res.json();

      if (typeof data.theme === "string" && themeTitle) {
        themeTitle.textContent = data.theme;
      }

      const sid = Number(data.sessionId);
      if (Number.isFinite(sid) && sid >= 1) {
        if (lastSeenSessionId == null) {
          lastSeenSessionId = sid;
        } else if (lastSeenSessionId !== sid) {
          lastSeenSessionId = sid;
          votedInThisPage = false;
          disableVoteButtons(false);
          setMessage("管理者がセッションをリセットしました。投票が再び可能です。");
        }
      }

      // UI反映
      if (votedInThisPage) {
        disableVoteButtons(true);
        setMessage("このページ表示中は投票済みです。（更新 or 管理者リセットで再投票できます）");
      } else {
        disableVoteButtons(false);
      }
    } catch (e) {
      console.error(e);
    }
  }

  fetchThemeAndSession();
  setInterval(fetchThemeAndSession, 1500);

  // -----------------------------
  // choice 正規化：2択表記が来ても 3択サーバに合わせる
  // -----------------------------
  function normalizeChoice(choice) {
    if (choice === "understood") return "interested";
    if (choice === "not-understood") return "not-interested";
    if (choice === "interested") return "interested";
    if (choice === "neutral") return "neutral";
    if (choice === "not-interested") return "not-interested";
    return null;
  }

  async function postVote(rawChoice, confirmText, successText) {
    if (votedInThisPage) {
      disableVoteButtons(true);
      setMessage("このページ表示中は投票済みです。（更新 or 管理者リセットで再投票できます）");
      return;
    }

    const choice = normalizeChoice(rawChoice);
    if (!choice) {
      setMessage("投票の種類が不正です（ボタン設定を確認してください）。");
      return;
    }

    // ✅ iOSで aタグ/フォーム送信があると confirm 前に遷移することがあるので、
    // ハンドラ側で必ず preventDefault/stopPropagation を入れる（後述）

    const ok = confirm(confirmText);
    if (!ok) return;

    try {
      // 念のため同期
      await fetchThemeAndSession();

      const res = await fetch(apiUrl("/api/vote"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          choice, // interested / neutral / not-interested
          comment: (commentInput?.value || "").trim()
        })
      });

      if (!res.ok) {
        // 失敗理由をできるだけ出す
        let extra = "";
        try {
          const ct = (res.headers.get("content-type") || "").toLowerCase();
          if (ct.includes("application/json")) {
            const j = await res.json();
            extra = j?.error ? String(j.error) : JSON.stringify(j);
          } else {
            extra = (await res.text()).slice(0, 200);
          }
        } catch {}
        setMessage(`送信エラーが発生しました。（${res.status}）${extra ? "：" + extra : ""}`);
        return;
      }

      votedInThisPage = true;
      disableVoteButtons(true);
      setMessage(successText);

      if (commentInput) commentInput.value = "";
    } catch (e) {
      console.error(e);
      setMessage("送信エラーが発生しました。");
    }
  }

  // -----------------------------
  // ✅ クリックイベントを確実に付与（aタグ/フォームでもOK）
  // -----------------------------
  function bindVoteButton(btn, rawChoice, confirmText, successText) {
    if (!btn) return;

    // 既にdisabledになってるなら解除（「押せない」を潰す）
    btn.disabled = false;

    btn.addEventListener(
      "click",
      async (e) => {
        // ✅ ここが重要：リンク遷移やフォーム送信を止める
        e.preventDefault?.();
        e.stopPropagation?.();

        await postVote(rawChoice, confirmText, successText);
      },
      { passive: false }
    );
  }

  // 「気になる / 興味がある」
  bindVoteButton(
    btnInterested,
    "interested",
    "本当に『気になる（興味がある）』で回答しますか？",
    "『気になる（興味がある）』で回答しました。ありがとうございました！"
  );

  // 「普通」
  bindVoteButton(
    btnNeutral,
    "neutral",
    "本当に『普通』で回答しますか？",
    "『普通』で回答しました。ありがとうございました！"
  );

  // 「気にならない / あまり興味がない」
  bindVoteButton(
    btnNotInterested,
    "not-interested",
    "本当に『気にならない（あまり興味がない）』で回答しますか？",
    "『気にならない（あまり興味がない）』で回答しました。ありがとうございました！"
  );

  // -----------------------------
  // コメントのみ送信（投票ロックは掛けない）
  // -----------------------------
  if (btnSendComment && commentInput) {
    btnSendComment.addEventListener("click", async (e) => {
      e.preventDefault?.();
      e.stopPropagation?.();

      const text = commentInput.value.trim();
      if (!text) {
        setMessage("コメントが空です。");
        return;
      }

      try {
        await fetchThemeAndSession();

        const res = await fetch(apiUrl("/api/vote"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            choice: null,
            comment: text
          })
        });

        if (!res.ok) {
          let extra = "";
          try {
            const ct = (res.headers.get("content-type") || "").toLowerCase();
            if (ct.includes("application/json")) {
              const j = await res.json();
              extra = j?.error ? String(j.error) : JSON.stringify(j);
            } else {
              extra = (await res.text()).slice(0, 200);
            }
          } catch {}
          setMessage(`送信エラーが発生しました。（${res.status}）${extra ? "：" + extra : ""}`);
          return;
        }

        setMessage("コメントを送信しました。");
        commentInput.value = "";
      } catch (e2) {
        console.error(e2);
        setMessage("送信エラーが発生しました。");
      }
    });
  }

  // -----------------------------
  // ✅ ボタンが拾えてない場合に明示する（原因特定）
  // -----------------------------
  const foundVoteButtons = !!(btnInterested || btnNeutral || btnNotInterested);
  if (!foundVoteButtons) {
    setMessage("投票ボタンが見つかりません。vote.html のボタンID（btn-...）を確認してください。");
  } else if (!accessKey) {
    setMessage("URLに key がありません。正しい投票URL（?key=...）で開いてください。");
  }
});

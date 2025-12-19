// vote.js（興味度アンケート用・API完全対応版）
// ✅ 同一セッション内は「1回だけ投票」（= このページ表示中は1回のみ）
// ✅ 「ページ更新したら投票可能に戻す」（= メモリ管理なのでリロードで解除）
// ✅ 「管理者がリセットしたら投票可能に戻す」（= server sessionId を監視して解除）
//
// ✅ 修正点：URLの ?key=... を API にも必ず付けて送信（403/404対策）
// ✅ 送信失敗時に、サーバからのエラー本文もできるだけ表示して原因特定しやすくする
//
// 注意：server.js 側は /api/results で sessionId を返すこと

document.addEventListener("DOMContentLoaded", () => {
  const btnUnderstood      = document.getElementById("btn-understood");       // 「興味がある」
  const btnNotUnderstood   = document.getElementById("btn-not-understood");   // 「あまり興味がない」
  const btnSendComment     = document.getElementById("btn-send-comment");     // コメントのみ送信

  const message            = document.getElementById("message");
  const commentInput       = document.getElementById("comment-input");
  const themeTitle         = document.getElementById("theme-title");

  // =============================
  // 重要：投票済みは「メモリだけ」で管理 → リロードしたら必ず投票可能に戻る
  // =============================
  let votedInThisPage = false;

  // sessionId は「管理者リセット検知」にだけ使う
  let lastSeenSessionId = null;

  // =============================
  // ✅ key を現在URLから取得して、APIにも付ける
  // =============================
  const urlParams = new URLSearchParams(window.location.search);
  const accessKey = urlParams.get("key"); // vote.html?key=...
  function apiUrl(path) {
    // /api/vote などに key を付けて叩く（サーバ側がkey不要でも害はない）
    if (!accessKey) return path;
    const sep = path.includes("?") ? "&" : "?";
    return `${path}${sep}key=${encodeURIComponent(accessKey)}`;
  }

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
    }
  }

  // =============================
  // 失敗時にレスポンス本文をなるべく読む（原因が見える）
  // =============================
  async function readErrorText(res) {
    try {
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json")) {
        const j = await res.json();
        if (j && typeof j === "object") {
          if (j.error) return String(j.error);
          return JSON.stringify(j);
        }
      }
      const t = await res.text();
      return t ? t.slice(0, 300) : "";
    } catch {
      return "";
    }
  }

  // =============================
  // /api/results からテーマ＆sessionId取得
  // =============================
  async function fetchThemeAndSession() {
    try {
      const res = await fetch(apiUrl("/api/results"), { cache: "no-store" });
      if (!res.ok) {
        const extra = await readErrorText(res);
        throw new Error(`results fetch failed: ${res.status} ${extra}`);
      }

      const data = await res.json();

      // テーマ
      if (typeof data.theme === "string" && themeTitle) {
        themeTitle.textContent = data.theme;
      }

      // sessionId（管理者リセットで増える想定）
      const sid = Number(data.sessionId);
      if (Number.isFinite(sid) && sid >= 1) {
        if (lastSeenSessionId == null) {
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

  // 初回取得 + 監視
  fetchThemeAndSession();
  setInterval(fetchThemeAndSession, 1500);

  // =============================
  // 投票送信（共通）
  // =============================
  async function postVote(choice, confirmText, successText) {
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

      const res = await fetch(apiUrl("/api/vote"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          choice, // "understood" / "not-understood" を送ってOK（server側で互換変換）
          comment: (commentInput?.value || "").trim()
        })
      });

      if (!res.ok) {
        const extra = await readErrorText(res);
        setMessage(`送信エラーが発生しました。（${res.status}）${extra ? "：" + extra : ""}`);
        return;
      }

      votedInThisPage = true;
      applyVoteLockUI();

      setMessage(successText);
      if (commentInput) commentInput.value = "";
    } catch (e) {
      console.error(e);
      setMessage("送信エラーが発生しました。");
    }
  }

  // 「興味がある」
  if (btnUnderstood) {
    btnUnderstood.addEventListener("click", async () => {
      await postVote(
        "understood",
        "本当に『興味がある』で回答しますか？",
        "『興味がある』で回答しました。ありがとうございました！"
      );
    });
  }

  // 「あまり興味がない」
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
  // コメントのみ送信（投票ロックは掛けない）
  // =============================
  if (btnSendComment && commentInput) {
    btnSendComment.addEventListener("click", async () => {
      const text = commentInput.value.trim();
      if (!text) {
        setMessage("コメントが空です。");
        return;
      }

      try {
        await fetchThemeAndSession();

        // コメントだけ送る：server.js は choice なしでもOK（あなたの現在のserverならOK）
        const res = await fetch(apiUrl("/api/vote"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            choice: null,
            comment: text
          })
        });

        if (!res.ok) {
          const extra = await readErrorText(res);
          setMessage(`送信エラーが発生しました。（${res.status}）${extra ? "：" + extra : ""}`);
          return;
        }

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

  // ✅ key が無いと投票ページとして成立しない想定なので注意表示
  if (!accessKey) {
    setMessage("URLに key がありません。正しい投票URL（?key=...）で開いてください。");
  }
});

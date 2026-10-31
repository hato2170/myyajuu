import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAR70h-R2ZvqIM5WZ-z5Dov3aXqasR6P2I",
  authDomain: "schoolsns-9d994.firebaseapp.com",
  projectId: "schoolsns-9d994",
  storageBucket: "schoolsns-9d994.firebasestorage.app",
  messagingSenderId: "1047321126149",
  appId: "1:1047321126149:web:9a495d5d74dfb0ea15836c",
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);

// Cloudflare Worker API URL
const WORKER_URL = window.MYYAJUU_AI_WORKER_URL || "https://myyajuu-ai-worker.harumei-260329.workers.dev";

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const errorEl = $("error");
const promptEl = $("prompt");
const sendButton = $("sendButton");
const clearButton = $("clearButton");
const messagesEl = $("messages");
const welcomeEl = $("welcome");
const authGateEl = $("authGate");
const authMessageEl = $("authMessage");

// 会話データはメモリ上にのみ保持（LocalStorage, SessionStorage, IndexedDB, Cache API には一切保存しない）
let history = [];
let currentUser = null;
let currentUid = null;
let generating = false;
let loadingHistory = false;

// 過去のlocalStorage/sessionStorage上のAIキャッシュを完全消去（Firebaseログイン状態のキーは保持）
function purgeLegacyLocalData() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.startsWith("myyajuu_ai") || key.includes("ai_test_history"))) {
        localStorage.removeItem(key);
      }
    }
    sessionStorage.clear();
  } catch {}
}
purgeLegacyLocalData();

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function syncUI() {
  const signedIn = Boolean(currentUid);
  authGateEl.hidden = signedIn;
  clearButton.disabled = !signedIn || generating || loadingHistory || history.length === 0;
  promptEl.disabled = !signedIn || generating || loadingHistory;
  sendButton.disabled = !signedIn || generating || loadingHistory;

  if (!signedIn) {
    welcomeEl.hidden = true;
  }
}

function appendMessage(role, text) {
  const row = document.createElement("div");
  row.className = `message ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  row.appendChild(bubble);
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  return bubble;
}

function renderHistory() {
  messagesEl.replaceChildren();
  if (!currentUid) {
    welcomeEl.hidden = true;
    return;
  }
  for (const item of history) {
    appendMessage(item.role, item.content);
  }
  welcomeEl.hidden = history.length > 0;
}

// Cloudflare D1からログイン中アカウントの会話履歴を取得（別端末でも同期）
async function fetchD1History(user) {
  if (!user) return [];
  loadingHistory = true;
  statusEl.textContent = "会話履歴をD1サーバーから同期しています…";
  try {
    const token = await user.getIdToken();
    const response = await fetch(`${WORKER_URL}/v1/chat/history`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) throw new Error("認証の有効期限が切れました。ログインし直してください。");
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.message || `履歴の取得に失敗しました (${response.status})`);
    }

    const data = await response.json();
    return Array.isArray(data.messages) ? data.messages : [];
  } catch (error) {
    showError("会話履歴の同期に失敗しました。\n" + (error?.message || error));
    return [];
  } finally {
    loadingHistory = false;
  }
}

// メッセージ送信（D1サーバーへ保存・AI生成）
async function sendMessage(text) {
  if (!currentUser || generating || loadingHistory) return;
  const sendUid = currentUid;
  generating = true;
  syncUI();
  errorEl.hidden = true;
  welcomeEl.hidden = true;

  // メモリ上および画面上にユーザーメッセージを即座に反映
  history.push({ role: "user", content: text });
  appendMessage("user", text);

  const assistantBubble = appendMessage("assistant", "AIが回答を生成しています…");
  statusEl.textContent = "AIが回答を生成しています…";

  try {
    const token = await currentUser.getIdToken();
    const response = await fetch(`${WORKER_URL}/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ message: text }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      let msg = errData.message || `エラーが発生しました (${response.status})`;
      if (response.status === 429) {
        if (errData.error === "user_daily_limit") {
          msg = "本日の利用上限（20回）に達しました。明日またご利用ください。";
        } else if (errData.error === "daily_budget_reached") {
          msg = "本日のAI無料枠上限に達しました。時間を置いてお試しください。";
        } else if (errData.error === "request_in_progress") {
          msg = "前回の回答を処理中です。少し待ってから送信してください。";
        }
      }
      throw new Error(msg);
    }

    const data = await response.json();
    const replyText = data.reply || "";

    if (currentUid !== sendUid) return;

    assistantBubble.textContent = replyText;
    history.push({ role: "assistant", content: replyText });
    statusEl.textContent = "準備完了。会話はCloudflare D1にサーバー保存されています。";
  } catch (error) {
    if (currentUid !== sendUid) return;
    history.pop(); // エラー時は未送信のユーザー発言をメモリからロールバック
    assistantBubble.textContent = "回答の取得に失敗しました。";
    showError(error?.message || "通信エラーが発生しました。");
    statusEl.textContent = "エラーが発生しました。";
  } finally {
    if (currentUid === sendUid) {
      generating = false;
      syncUI();
      promptEl.focus();
    }
  }
}

$("chatForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = promptEl.value.trim();
  if (!text || !currentUser || generating || loadingHistory) return;
  promptEl.value = "";
  promptEl.style.height = "auto";
  await sendMessage(text);
});

promptEl.addEventListener("input", () => {
  promptEl.style.height = "auto";
  promptEl.style.height = `${Math.min(promptEl.scrollHeight, 140)}px`;
});

promptEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("chatForm").requestSubmit();
  }
});

// 会話履歴の全削除（D1サーバーから削除）
clearButton.addEventListener("click", async () => {
  if (!currentUser || generating || loadingHistory) return;
  if (!window.confirm("Cloudflare D1に保存された会話履歴をすべて削除しますか？\n（同じアカウントの全端末で消去されます）")) return;

  statusEl.textContent = "履歴を削除しています…";
  clearButton.disabled = true;
  try {
    const token = await currentUser.getIdToken();
    const response = await fetch(`${WORKER_URL}/v1/chat/history`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error("履歴の削除に失敗しました。");
    }

    history = [];
    renderHistory();
    statusEl.textContent = "会話履歴を削除しました。";
  } catch (error) {
    showError(error?.message || "履歴の削除に失敗しました。");
    statusEl.textContent = "削除に失敗しました。";
  } finally {
    syncUI();
  }
});

renderHistory();
syncUI();

// 認証状態の監視（Firebaseログイン状態だけは維持、ログアウト時にメモリ上の会話を消去）
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  const nextUid = user?.uid || null;

  if (nextUid !== currentUid) {
    currentUid = nextUid;
    // ログアウトまたは別ユーザーへの切り替え時にメモリ上の会話を完全消去
    history = [];
    renderHistory();
  }

  if (!currentUid) {
    authMessageEl.textContent = "AIチャットを利用するには、SNSにログインしてください。ログイン後、このページに戻ってください。";
    errorEl.hidden = true;
    statusEl.textContent = "SNSへのログインが必要です。";
    syncUI();
    return;
  }

  authMessageEl.textContent = "SNSのログインを確認しました。";
  syncUI();

  // D1から履歴を同期取得
  const fetched = await fetchD1History(user);
  if (currentUid === user.uid) {
    history = fetched;
    renderHistory();
    statusEl.textContent = "準備完了。会話はCloudflare D1にサーバー保存されています。";
    syncUI();
    promptEl.focus();
  }
}, (error) => {
  currentUser = null;
  currentUid = null;
  history = [];
  renderHistory();
  authMessageEl.textContent = "ログイン状態を確認できませんでした。通信環境を確認し、SNSにログインし直してください。";
  statusEl.textContent = "Firebase Authenticationの確認に失敗しました。";
  showError(error?.message || "認証状態を確認できませんでした。");
  syncUI();
});

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

const MODEL_CATALOG = {
  "@cf/meta/llama-3.2-3b-instruct": {
    name: "Llama 3.2 3B",
    provider: "Meta",
    badge: "超高速レスポンス · 低消費",
    desc: "高速・軽量で自然な日本語対応。日常の会話や素早い質問に最適です。",
  },
  "@cf/openai/gpt-oss-20b": {
    name: "GPT-OSS 20B",
    provider: "OpenAI",
    badge: "思考・論理推論 · バランス型",
    desc: "OpenAIのオープンモデル。論理的推論やステップごとの思考に強みがあります。",
  },
  "@cf/google/gemma-4-26b-a4b-it": {
    name: "Gemma 4 26B",
    provider: "Google",
    badge: "高知識 · 知的対話",
    desc: "Google最新のGemma 4ファミリー。知識・推論能力が高く知的な受け答えが得意です。",
  },
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": {
    name: "Llama 3.3 70B",
    provider: "Meta",
    badge: "最高峰品質 · 高度な分析",
    desc: "700億パラメータの高性能フラグシップ。複雑な文章作成や高度な分析に対応します。",
  },
  "@cf/qwen/qwen3-30b-a3b-fp8": {
    name: "Qwen3 30B",
    provider: "Qwen",
    badge: "多言語対応 · MoE高効率",
    desc: "最新のQwen3 MoEモデル。優れた多言語理解力と長文要約力を備えています。",
  },
};

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
const modelSelectEl = $("modelSelect");
const modelBadgeEl = $("modelBadge");
const modelInfoTextEl = $("modelInfoText");

// 会話データはメモリ上にのみ保持（LocalStorage, SessionStorage, IndexedDB, Cache API には一切保存しない）
let history = [];
let currentUser = null;
let currentUid = null;
let generating = false;
let loadingHistory = false;
let selectedModelId = "@cf/meta/llama-3.2-3b-instruct";

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

function updateModelUI() {
  const info = MODEL_CATALOG[selectedModelId] || MODEL_CATALOG["@cf/meta/llama-3.2-3b-instruct"];
  if (modelBadgeEl) modelBadgeEl.textContent = info.badge;
  if (modelInfoTextEl) modelInfoTextEl.textContent = info.desc;
}

if (modelSelectEl) {
  modelSelectEl.addEventListener("change", (e) => {
    selectedModelId = e.target.value;
    updateModelUI();
    // モデルを切り替えても会話履歴はそのまま維持され、同じ文脈で継続可能
  });
}
updateModelUI();

function syncUI() {
  const signedIn = Boolean(currentUid);
  authGateEl.hidden = signedIn;
  clearButton.disabled = !signedIn || generating || loadingHistory || history.length === 0;
  promptEl.disabled = !signedIn || generating || loadingHistory;
  sendButton.disabled = !signedIn || generating || loadingHistory;
  if (modelSelectEl) modelSelectEl.disabled = !signedIn || generating;

  if (!signedIn) {
    welcomeEl.hidden = true;
  }
}

function appendMessage(role, text, modelName = null) {
  const row = document.createElement("div");
  row.className = `message ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if (role === "assistant" && modelName) {
    const tag = document.createElement("span");
    tag.className = "model-tag";
    tag.textContent = `✦ ${modelName}`;
    bubble.appendChild(tag);
  }

  const textNode = document.createElement("div");
  textNode.className = "text-content";
  textNode.textContent = text;
  bubble.appendChild(textNode);

  row.appendChild(bubble);
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  return textNode;
}

function renderHistory() {
  messagesEl.replaceChildren();
  if (!currentUid) {
    welcomeEl.hidden = true;
    return;
  }
  for (const item of history) {
    let mName = null;
    if (item.role === "assistant") {
      const info = item.model ? MODEL_CATALOG[item.model] : null;
      mName = info ? info.name : null;
    }
    appendMessage(item.role, item.content, mName);
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

// メッセージ送信（D1サーバーへ保存・選択したモデルでAI生成）
async function sendMessage(text) {
  if (!currentUser || generating || loadingHistory) return;
  const sendUid = currentUid;
  const targetModelId = selectedModelId;
  const targetModelInfo = MODEL_CATALOG[targetModelId] || MODEL_CATALOG["@cf/meta/llama-3.2-3b-instruct"];

  generating = true;
  syncUI();
  errorEl.hidden = true;
  welcomeEl.hidden = true;

  // メモリ上および画面上にユーザーメッセージを即座に反映
  history.push({ role: "user", content: text });
  appendMessage("user", text);

  const assistantBubble = appendMessage("assistant", `${targetModelInfo.name} が回答を生成しています…`, targetModelInfo.name);
  statusEl.textContent = `${targetModelInfo.name} に送信中…`;

  try {
    const token = await currentUser.getIdToken();
    const response = await fetch(`${WORKER_URL}/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ message: text, model: targetModelId }),
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
    history.push({ role: "assistant", content: replyText, model: targetModelId });
    statusEl.textContent = `準備完了（${targetModelInfo.name} で回答）。会話はD1に保存されています。`;
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

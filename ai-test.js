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
  "@cf/meta/llama-3.2-3b-instruct": { name: "Llama 3.2 3B" },
  "@cf/openai/gpt-oss-20b": { name: "GPT-OSS 20B" },
  "@cf/google/gemma-4-26b-a4b-it": { name: "Gemma 4 26B" },
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { name: "Llama 3.3 70B" },
  "@cf/qwen/qwen3-30b-a3b-fp8": { name: "Qwen3 30B" },
};

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const errorEl = $("error");
const promptEl = $("prompt");
const sendButton = $("sendButton");
const messagesEl = $("messages");
const welcomeEl = $("welcome");
const authGateEl = $("authGate");
const authMessageEl = $("authMessage");
const modelSelectEl = $("modelSelect");

// Sessions / Project elements
const sessionTitleDisplay = $("sessionTitleDisplay");
const sessionsBtn = $("sessionsBtn");
const newChatBtn = $("newChatBtn");
const sessionsDrawer = $("sessionsDrawer");
const drawerOverlay = $("drawerOverlay");
const closeDrawerBtn = $("closeDrawerBtn");
const drawerNewChatBtn = $("drawerNewChatBtn");
const sessionsList = $("sessionsList");

// Toolbar elements
const webSearchToggle = $("webSearchToggle");
const webSearchState = $("webSearchState");
const imageGenBtn = $("imageGenBtn");
const attachBtn = $("attachBtn");
const fileInput = $("fileInput");
const clearChatBtn = $("clearChatBtn");
const attachmentPreviewArea = $("attachmentPreviewArea");
const attachmentName = $("attachmentName");
const removeAttachmentBtn = $("removeAttachmentBtn");

// 会話データ・セッションデータはメモリ上にのみ保持（LocalStorage, SessionStorage, IndexedDB, Cache API には一切保存しない）
let history = [];
let sessions = [];
let currentSessionId = "default";
let currentSessionTitle = "AIアシスタント";
let currentUser = null;
let currentUid = null;
let generating = false;
let loadingHistory = false;
let selectedModelId = "@cf/meta/llama-3.2-3b-instruct";
let isWebSearchOn = false;
let currentAttachment = null; // { name, type, content, isImage }

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

if (modelSelectEl) {
  modelSelectEl.addEventListener("change", (e) => {
    selectedModelId = e.target.value;
  });
}

// Web検索トグル
if (webSearchToggle) {
  webSearchToggle.addEventListener("click", () => {
    isWebSearchOn = !isWebSearchOn;
    webSearchState.textContent = isWebSearchOn ? "ON 🟢" : "OFF";
    webSearchToggle.classList.toggle("active", isWebSearchOn);
  });
}

// 画像生成ボタン（プロンプトに `/image ` を挿入）
if (imageGenBtn) {
  imageGenBtn.addEventListener("click", () => {
    promptEl.value = "/image ";
    promptEl.focus();
  });
}

// ファイル添付ボタン
if (attachBtn && fileInput) {
  attachBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      alert("ファイルサイズは2MB以内で指定してください。");
      fileInput.value = "";
      return;
    }

    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        currentAttachment = {
          name: file.name,
          type: "image",
          content: evt.target.result,
        };
        showAttachmentPreview(file.name, "🖼️");
      };
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = (evt) => {
        currentAttachment = {
          name: file.name,
          type: "text",
          content: evt.target.result,
        };
        showAttachmentPreview(file.name, "📄");
      };
      reader.readAsText(file);
    }
  });
}

function showAttachmentPreview(name, icon) {
  attachmentName.textContent = `${icon} ${name}`;
  attachmentPreviewArea.hidden = false;
}

function clearAttachment() {
  currentAttachment = null;
  attachmentPreviewArea.hidden = true;
  if (fileInput) fileInput.value = "";
}

if (removeAttachmentBtn) {
  removeAttachmentBtn.addEventListener("click", clearAttachment);
}

// ドロワー開閉
function openDrawer() {
  sessionsDrawer.hidden = false;
  drawerOverlay.hidden = false;
  renderSessionsList();
}

function closeDrawer() {
  sessionsDrawer.hidden = true;
  drawerOverlay.hidden = true;
}

if (sessionsBtn) sessionsBtn.addEventListener("click", openDrawer);
if (closeDrawerBtn) closeDrawerBtn.addEventListener("click", closeDrawer);
if (drawerOverlay) drawerOverlay.addEventListener("click", closeDrawer);

// 新しいチャット作成
async function startNewChat() {
  if (!currentUser) return;
  closeDrawer();
  statusEl.textContent = "新しいチャットを作成しています…";
  try {
    const token = await currentUser.getIdToken();
    const res = await fetch(`${WORKER_URL}/v1/chat/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "新しいチャット" }),
    });

    if (res.ok) {
      const data = await res.json();
      currentSessionId = data.session.id;
      currentSessionTitle = data.session.title;
    } else {
      currentSessionId = `session-${Date.now()}`;
      currentSessionTitle = "新しいチャット";
    }

    sessionTitleDisplay.textContent = currentSessionTitle;
    history = [];
    renderHistory();
    clearAttachment();
    statusEl.textContent = "新しい会話を開始しました。";
    await fetchSessionsList(currentUser);
    promptEl.focus();
  } catch (err) {
    currentSessionId = `session-${Date.now()}`;
    currentSessionTitle = "新しいチャット";
    sessionTitleDisplay.textContent = currentSessionTitle;
    history = [];
    renderHistory();
  }
}

if (newChatBtn) newChatBtn.addEventListener("click", startNewChat);
if (drawerNewChatBtn) drawerNewChatBtn.addEventListener("click", startNewChat);

async function fetchSessionsList(user) {
  if (!user) return;
  try {
    const token = await user.getIdToken();
    const res = await fetch(`${WORKER_URL}/v1/chat/sessions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      sessions = Array.isArray(data.sessions) ? data.sessions : [];
      renderSessionsList();
    }
  } catch {}
}

function renderSessionsList() {
  if (!sessionsList) return;
  sessionsList.replaceChildren();

  // デフォルトセッションがリストに無ければ先頭に配置
  const hasDefault = sessions.some((s) => s.id === "default");
  const allSessions = hasDefault ? sessions : [{ id: "default", title: "メインの会話" }, ...sessions];

  for (const s of allSessions) {
    const li = document.createElement("li");
    li.className = `session-item ${s.id === currentSessionId ? "active" : ""}`;

    const titleSpan = document.createElement("span");
    titleSpan.className = "session-title-text";
    titleSpan.textContent = `💬 ${s.title || "チャット"}`;
    titleSpan.addEventListener("click", () => switchSession(s.id, s.title));
    li.appendChild(titleSpan);

    if (s.id !== "default") {
      const delBtn = document.createElement("button");
      delBtn.className = "session-del-btn";
      delBtn.textContent = "🗑️";
      delBtn.title = "この会話を削除";
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`「${s.title}」を削除しますか？`)) return;
        await deleteSession(s.id);
      });
      li.appendChild(delBtn);
    }

    sessionsList.appendChild(li);
  }
}

async function switchSession(id, title) {
  if (id === currentSessionId) {
    closeDrawer();
    return;
  }
  closeDrawer();
  currentSessionId = id;
  currentSessionTitle = title || "チャット";
  sessionTitleDisplay.textContent = currentSessionTitle;

  if (currentUser) {
    const fetched = await fetchD1History(currentUser, id);
    history = fetched;
    renderHistory();
    statusEl.textContent = `会話「${currentSessionTitle}」を開きました。`;
    promptEl.focus();
  }
}

async function deleteSession(id) {
  if (!currentUser) return;
  try {
    const token = await currentUser.getIdToken();
    await fetch(`${WORKER_URL}/v1/chat/sessions?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    sessions = sessions.filter((s) => s.id !== id);
    if (currentSessionId === id) {
      await switchSession("default", "メインの会話");
    } else {
      renderSessionsList();
    }
  } catch {}
}

function syncUI() {
  const signedIn = Boolean(currentUid);
  authGateEl.hidden = signedIn;
  promptEl.disabled = !signedIn || generating || loadingHistory;
  sendButton.disabled = !signedIn || generating || loadingHistory;
  if (modelSelectEl) modelSelectEl.disabled = !signedIn || generating;
  if (attachBtn) attachBtn.disabled = !signedIn || generating;
  if (imageGenBtn) imageGenBtn.disabled = !signedIn || generating;
  if (webSearchToggle) webSearchToggle.disabled = !signedIn || generating;

  if (!signedIn) {
    welcomeEl.hidden = true;
  }
}

function appendMessage(role, text, modelName = null, imageUrl = null) {
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

  if (imageUrl) {
    const imgContainer = document.createElement("div");
    imgContainer.className = "generated-image-container";
    const img = document.createElement("img");
    img.src = imageUrl;
    img.alt = "生成された画像";
    img.className = "generated-img";
    imgContainer.appendChild(img);
    bubble.appendChild(imgContainer);
  }

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
    appendMessage(item.role, item.content, mName, item.image);
  }
  welcomeEl.hidden = history.length > 0;
}

// Cloudflare D1からセッション履歴を取得
async function fetchD1History(user, sessionId = currentSessionId) {
  if (!user) return [];
  loadingHistory = true;
  statusEl.textContent = "会話履歴をD1サーバーから同期しています…";
  try {
    const token = await user.getIdToken();
    const response = await fetch(`${WORKER_URL}/v1/chat/history?session_id=${encodeURIComponent(sessionId)}`, {
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

// 画像生成の実行
async function generateImage(prompt) {
  if (!currentUser || generating) return;
  generating = true;
  syncUI();
  errorEl.hidden = true;
  welcomeEl.hidden = true;

  history.push({ role: "user", content: `🎨 画像生成: ${prompt}` });
  appendMessage("user", `🎨 画像生成: ${prompt}`);

  const assistantBubble = appendMessage("assistant", "FLUXモデルで画像を生成しています（約2〜3秒）…", "FLUX.1 Schnell");
  statusEl.textContent = "FLUX画像生成中…";

  try {
    const token = await currentUser.getIdToken();
    const response = await fetch(`${WORKER_URL}/v1/images/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.message || `画像生成エラー (${response.status})`);
    }

    const data = await response.json();
    assistantBubble.textContent = `「${prompt}」の画像を生成しました！`;

    // 画像コンテナを追加
    const container = assistantBubble.parentElement;
    const imgBox = document.createElement("div");
    imgBox.className = "generated-image-container";
    const img = document.createElement("img");
    img.src = data.image;
    img.alt = prompt;
    img.className = "generated-img";
    imgBox.appendChild(img);
    container.appendChild(imgBox);

    history.push({ role: "assistant", content: `「${prompt}」の画像`, model: "flux-schnell", image: data.image });
    statusEl.textContent = "画像生成完了。";
  } catch (err) {
    assistantBubble.textContent = "画像の生成に失敗しました。";
    showError(err?.message || "画像生成エラーが発生しました。");
    statusEl.textContent = "エラーが発生しました。";
  } finally {
    generating = false;
    syncUI();
    promptEl.focus();
  }
}

// メッセージ送信
async function sendMessage(text) {
  if (!currentUser || generating || loadingHistory) return;

  // `/image ` コマンドの検知
  if (text.startsWith("/image ") || text.startsWith("画像生成:") || text.startsWith("画像生成：")) {
    const imgPrompt = text.replace(/^(\/image|画像生成[:：])\s*/, "").trim();
    if (imgPrompt) {
      await generateImage(imgPrompt);
      return;
    }
  }

  const sendUid = currentUid;
  const sendSessionId = currentSessionId;
  const targetModelId = selectedModelId;
  const targetModelInfo = MODEL_CATALOG[targetModelId] || MODEL_CATALOG["@cf/meta/llama-3.2-3b-instruct"];

  // 添付ファイルがある場合はプロンプトに統合
  let fullMessageText = text;
  if (currentAttachment) {
    if (currentAttachment.type === "text") {
      fullMessageText += `\n\n【添付テキストファイル: ${currentAttachment.name}】\n${currentAttachment.content}`;
    } else if (currentAttachment.type === "image") {
      fullMessageText += `\n\n【添付画像: ${currentAttachment.name}（画像データを解析してください）】`;
    }
  }

  generating = true;
  syncUI();
  errorEl.hidden = true;
  welcomeEl.hidden = true;

  const displayUserText = currentAttachment ? `📎 [${currentAttachment.name}]\n${text}` : text;
  history.push({ role: "user", content: displayUserText });
  appendMessage("user", displayUserText);
  clearAttachment();

  const assistantBubble = appendMessage("assistant", `${targetModelInfo.name} が回答を生成しています…`, targetModelInfo.name);
  statusEl.textContent = isWebSearchOn ? "Web検索と回答生成中…" : `${targetModelInfo.name} に送信中…`;

  try {
    const token = await currentUser.getIdToken();
    const response = await fetch(`${WORKER_URL}/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        message: fullMessageText,
        model: targetModelId,
        session_id: sendSessionId,
        webSearch: isWebSearchOn,
      }),
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

    if (currentUid !== sendUid || currentSessionId !== sendSessionId) return;

    assistantBubble.textContent = replyText;
    history.push({ role: "assistant", content: replyText, model: targetModelId });
    statusEl.textContent = `準備完了（${targetModelInfo.name} で回答）。会話はD1に保存されています。`;

    // セッション一覧を再同期（タイトル自動更新を反映）
    fetchSessionsList(currentUser);
  } catch (error) {
    if (currentUid !== sendUid || currentSessionId !== sendSessionId) return;
    history.pop();
    assistantBubble.textContent = "回答の取得に失敗しました。";
    showError(error?.message || "通信エラーが発生しました。");
    statusEl.textContent = "エラーが発生しました。";
  } finally {
    if (currentUid === sendUid && currentSessionId === sendSessionId) {
      generating = false;
      syncUI();
      promptEl.focus();
    }
  }
}

$("chatForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = promptEl.value.trim();
  if ((!text && !currentAttachment) || !currentUser || generating || loadingHistory) return;
  promptEl.value = "";
  promptEl.style.height = "auto";
  await sendMessage(text || "ファイルを解析してください。");
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

// この会話の履歴削除
if (clearChatBtn) {
  clearChatBtn.addEventListener("click", async () => {
    if (!currentUser || generating || loadingHistory) return;
    if (!confirm("現在の会話履歴をCloudflare D1から削除しますか？")) return;

    statusEl.textContent = "履歴を削除しています…";
    try {
      const token = await currentUser.getIdToken();
      await fetch(`${WORKER_URL}/v1/chat/history?session_id=${encodeURIComponent(currentSessionId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      history = [];
      renderHistory();
      statusEl.textContent = "この会話の履歴を削除しました。";
    } catch {
      showError("履歴の削除に失敗しました。");
    } finally {
      syncUI();
    }
  });
}

renderHistory();
syncUI();

// 認証監視
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  const nextUid = user?.uid || null;

  if (nextUid !== currentUid) {
    currentUid = nextUid;
    history = [];
    sessions = [];
    currentSessionId = "default";
    currentSessionTitle = "AIアシスタント";
    sessionTitleDisplay.textContent = currentSessionTitle;
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

  // D1からセッション一覧とメッセージ履歴を同期
  await fetchSessionsList(user);
  const fetched = await fetchD1History(user, currentSessionId);
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
  authMessageEl.textContent = "ログイン状態を確認できませんでした。SNSにログインし直してください。";
  syncUI();
});

import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm";
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

const MODEL_ID = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
const HISTORY_KEY = "myyajuu_ai_test_history_v1";
const MAX_SAVED_MESSAGES = 60;
const MAX_CONTEXT_MESSAGES = 20;
const SYSTEM_MESSAGE = "あなたは親切な日本語AIアシスタントです。自然で簡潔な日本語で回答してください。確実でない情報は断定しないでください。";

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const progressEl = $("progress");
const errorEl = $("error");
const loadButton = $("loadButton");
const promptEl = $("prompt");
const sendButton = $("sendButton");
const clearButton = $("clearButton");
const messagesEl = $("messages");
const welcomeEl = $("welcome");
const authGateEl = $("authGate");
const authMessageEl = $("authMessage");
let engine = null;
let history = [];
let currentUid = null;
let authStateVersion = 0;
let activeRequestUid = null;
let generating = false;
let webGPUChecked = false;
let webGPUReady = false;

function historyStorageKey(uid) {
  return `${HISTORY_KEY}_${uid}`;
}

function loadHistory(uid) {
  if (!uid) return [];
  try {
    const value = JSON.parse(localStorage.getItem(historyStorageKey(uid)) || "[]");
    return Array.isArray(value) ? value.filter((item) =>
      item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string"
    ).slice(-MAX_SAVED_MESSAGES) : [];
  } catch (error) {
    return [];
  }
}

function saveHistory(uid) {
  if (!uid || uid !== currentUid) return;
  try {
    history = history.slice(-MAX_SAVED_MESSAGES);
    localStorage.setItem(historyStorageKey(uid), JSON.stringify(history));
  } catch (error) {
    showError("端末内に会話を保存できませんでした。ブラウザーの保存容量をご確認ください。\n" + error.message);
  }
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function syncAuthUI() {
  const signedIn = Boolean(currentUid);
  authGateEl.hidden = signedIn;
  clearButton.disabled = !signedIn;
  loadButton.hidden = !signedIn || !webGPUReady || Boolean(engine);
  loadButton.disabled = !signedIn || generating;
  promptEl.disabled = !signedIn || !engine || generating;
  sendButton.disabled = !signedIn || !engine || generating;

  if (!signedIn) {
    progressEl.hidden = true;
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
  for (const item of history) appendMessage(item.role, item.content);
  welcomeEl.hidden = history.length > 0;
}

async function checkWebGPU() {
  if (!currentUid) return false;
  webGPUChecked = true;
  if (!navigator.gpu) {
    webGPUReady = false;
    statusEl.textContent = "このブラウザーではWebGPUを利用できません。対応ブラウザー・OSで開いてください。";
    showError("WebLLMはWebGPUが必要です。ブラウザーとOSを最新版にし、WebGPU対応端末で再度お試しください。iPhone Safariでの動作はOS・端末により異なります。");
    syncAuthUI();
    return false;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("WebGPU adapterを取得できませんでした。");
    if (!currentUid) {
      webGPUChecked = false;
      return false;
    }
    webGPUReady = true;
    statusEl.textContent = "WebGPUアダプターを確認しました。モデルの読み込みが必要です。";
    syncAuthUI();
    return true;
  } catch (error) {
    if (!currentUid) {
      webGPUChecked = false;
      return false;
    }
    webGPUReady = false;
    statusEl.textContent = "WebGPUを初期化できませんでした。";
    showError(`WebGPUアダプターを利用できません。対応ブラウザー・端末か確認してください。\n${error?.message || error}`);
    syncAuthUI();
    return false;
  }
}

async function loadModel() {
  if (!currentUid || !webGPUReady || engine) return;
  const loadUid = currentUid;
  loadButton.disabled = true;
  loadButton.hidden = true;
  errorEl.hidden = true;
  progressEl.hidden = false;
  progressEl.removeAttribute("value");
  statusEl.textContent = "モデルをダウンロード・準備しています。初回は約300 MBの通信が発生します…";
  try {
    engine = await CreateMLCEngine(MODEL_ID, {
      initProgressCallback: (report) => {
        if (currentUid !== loadUid) return;
        statusEl.textContent = report.text || "モデルを準備しています…";
        if (typeof report.progress === "number") {
          progressEl.value = Math.max(0, Math.min(100, report.progress * 100));
        } else {
          progressEl.removeAttribute("value");
        }
      },
    });
    progressEl.hidden = true;
    if (currentUid === loadUid) {
      statusEl.textContent = "準備完了。会話はこの端末内に保存されます。";
      syncAuthUI();
      promptEl.focus();
    } else {
      syncAuthUI();
    }
  } catch (error) {
    engine = null;
    progressEl.hidden = true;
    if (currentUid === loadUid) {
      statusEl.textContent = "モデルを読み込めませんでした。";
      showError(`モデルの読み込みに失敗しました。WebGPU対応、通信環境、端末の空きメモリ・保存容量を確認してください。\n\n詳細: ${error?.message || error}`);
      loadButton.textContent = "もう一度読み込む（初回は約300 MB）";
    }
    syncAuthUI();
  }
}

async function sendMessage(text) {
  if (!engine || !currentUid || generating) return;
  const requestUid = currentUid;
  const requestAuthVersion = authStateVersion;
  generating = true;
  activeRequestUid = requestUid;
  syncAuthUI();
  errorEl.hidden = true;
  welcomeEl.hidden = true;

  history.push({ role: "user", content: text });
  appendMessage("user", text);
  saveHistory(requestUid);
  const answerBubble = appendMessage("assistant", "");
  let answer = "";
  statusEl.textContent = "回答を生成しています…";

  try {
    const recent = history.slice(-MAX_CONTEXT_MESSAGES).map(({ role, content }) => ({ role, content }));
    const chunks = await engine.chat.completions.create({
      messages: [{ role: "system", content: SYSTEM_MESSAGE }, ...recent],
      stream: true,
      temperature: 0.7,
      max_tokens: 512,
    });
    for await (const chunk of chunks) {
      if (currentUid !== requestUid || authStateVersion !== requestAuthVersion) break;
      answer += chunk.choices?.[0]?.delta?.content || "";
      answerBubble.textContent = answer;
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    }
    if (currentUid !== requestUid || authStateVersion !== requestAuthVersion) return;
    if (!answer.trim()) answer = await engine.getMessage();
    if (currentUid !== requestUid || authStateVersion !== requestAuthVersion) return;
    answerBubble.textContent = answer;
    history.push({ role: "assistant", content: answer });
    saveHistory(requestUid);
    statusEl.textContent = "準備完了。";
  } catch (error) {
    if (currentUid !== requestUid || authStateVersion !== requestAuthVersion) return;
    answerBubble.textContent = answer || "回答の生成に失敗しました。もう一度お試しください。";
    if (!answer) history.pop();
    showError("回答の生成中にエラーが発生しました。端末のメモリやWebGPUの状態を確認してください。\n" + (error?.message || error));
    statusEl.textContent = "生成に失敗しました。";
  } finally {
    if (activeRequestUid === requestUid) {
      generating = false;
      activeRequestUid = null;
      syncAuthUI();
      if (currentUid) promptEl.focus();
    }
  }
}

loadButton.addEventListener("click", loadModel);
$("chatForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = promptEl.value.trim();
  if (!text || !currentUid || !engine || generating) return;
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
clearButton.addEventListener("click", () => {
  if (!currentUid || !window.confirm("この端末に保存された会話履歴を削除しますか？")) return;
  const uid = currentUid;
  history = [];
  try {
    localStorage.removeItem(historyStorageKey(uid));
  } catch (error) {
    showError("保存済み履歴を削除できませんでした。");
  }
  renderHistory();
});

renderHistory();
syncAuthUI();
onAuthStateChanged(auth, (user) => {
  const nextUid = user?.uid || null;
  if (nextUid !== currentUid) {
    authStateVersion += 1;
    currentUid = nextUid;
    history = currentUid ? loadHistory(currentUid) : [];
    renderHistory();
  }

  if (!currentUid) {
    authMessageEl.textContent = "AIチャットを利用するには、SNSにログインしてください。ログイン後、このページに戻ってください。";
    errorEl.hidden = true;
    statusEl.textContent = "SNSへのログインが必要です。";
    syncAuthUI();
    return;
  }

  authMessageEl.textContent = "SNSのログインを確認しました。";
  syncAuthUI();
  if (engine) {
    statusEl.textContent = "準備完了。会話はこの端末内に保存されます。";
  } else if (!webGPUChecked) {
    statusEl.textContent = "WebGPUを確認しています…";
    checkWebGPU();
  }
}, (error) => {
  currentUid = null;
  history = [];
  renderHistory();
  authMessageEl.textContent = "ログイン状態を確認できませんでした。通信環境を確認し、SNSにログインし直してください。";
  statusEl.textContent = "Firebase Authenticationの確認に失敗しました。";
  showError(error?.message || "認証状態を確認できませんでした。");
  syncAuthUI();
});

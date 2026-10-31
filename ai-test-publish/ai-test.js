import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm";

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
const messagesEl = $("messages");
const welcomeEl = $("welcome");
let engine = null;
let history = loadHistory();
let generating = false;

function loadHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(value) ? value.filter((item) =>
      item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string"
    ).slice(-MAX_SAVED_MESSAGES) : [];
  } catch (error) {
    return [];
  }
}

function saveHistory() {
  try {
    history = history.slice(-MAX_SAVED_MESSAGES);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (error) {
    showError("端末内に会話を保存できませんでした。ブラウザーの保存容量をご確認ください。\n" + error.message);
  }
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
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
  for (const item of history) appendMessage(item.role, item.content);
  welcomeEl.hidden = history.length > 0;
}

async function checkWebGPU() {
  if (!navigator.gpu) {
    statusEl.textContent = "このブラウザーではWebGPUを利用できません。対応ブラウザー・OSで開いてください。";
    showError("WebLLMはWebGPUが必要です。ブラウザーとOSを最新版にし、WebGPU対応端末で再度お試しください。iPhone Safariでの動作はOS・端末により異なります。");
    return false;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("WebGPU adapterを取得できませんでした。");
    statusEl.textContent = "WebGPUアダプターを確認しました。モデルの読み込みが必要です。";
    loadButton.hidden = false;
    return true;
  } catch (error) {
    statusEl.textContent = "WebGPUを初期化できませんでした。";
    showError(`WebGPUアダプターを利用できません。対応ブラウザー・端末か確認してください。\n${error?.message || error}`);
    return false;
  }
}

async function loadModel() {
  if (engine) return;
  loadButton.disabled = true;
  loadButton.hidden = true;
  errorEl.hidden = true;
  progressEl.hidden = false;
  progressEl.removeAttribute("value");
  statusEl.textContent = "モデルをダウンロード・準備しています。初回は約300 MBの通信が発生します…";
  try {
    engine = await CreateMLCEngine(MODEL_ID, {
      initProgressCallback: (report) => {
        statusEl.textContent = report.text || "モデルを準備しています…";
        if (typeof report.progress === "number") {
          progressEl.value = Math.max(0, Math.min(100, report.progress * 100));
        } else {
          progressEl.removeAttribute("value");
        }
      },
    });
    progressEl.hidden = true;
    statusEl.textContent = "準備完了。会話はこの端末内に保存されます。";
    promptEl.disabled = false;
    sendButton.disabled = false;
    promptEl.focus();
  } catch (error) {
    engine = null;
    progressEl.hidden = true;
    statusEl.textContent = "モデルを読み込めませんでした。";
    showError(`モデルの読み込みに失敗しました。WebGPU対応、通信環境、端末の空きメモリ・保存容量を確認してください。\n\n詳細: ${error?.message || error}`);
    loadButton.textContent = "もう一度読み込む（初回は約300 MB）";
    loadButton.hidden = false;
    loadButton.disabled = false;
  }
}

async function sendMessage(text) {
  if (!engine || generating) return;
  generating = true;
  sendButton.disabled = true;
  promptEl.disabled = true;
  errorEl.hidden = true;
  welcomeEl.hidden = true;

  history.push({ role: "user", content: text });
  appendMessage("user", text);
  saveHistory();
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
      answer += chunk.choices?.[0]?.delta?.content || "";
      answerBubble.textContent = answer;
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    }
    if (!answer.trim()) answer = await engine.getMessage();
    answerBubble.textContent = answer;
    history.push({ role: "assistant", content: answer });
    saveHistory();
    statusEl.textContent = "準備完了。";
  } catch (error) {
    answerBubble.textContent = answer || "回答の生成に失敗しました。もう一度お試しください。";
    if (!answer) history.pop();
    showError("回答の生成中にエラーが発生しました。端末のメモリやWebGPUの状態を確認してください。\n" + (error?.message || error));
    statusEl.textContent = "生成に失敗しました。";
  } finally {
    generating = false;
    promptEl.disabled = false;
    sendButton.disabled = false;
    promptEl.focus();
  }
}

loadButton.addEventListener("click", loadModel);
$("chatForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = promptEl.value.trim();
  if (!text || !engine || generating) return;
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
$("clearButton").addEventListener("click", () => {
  if (!window.confirm("この端末に保存された会話履歴を削除しますか？")) return;
  history = [];
  try { localStorage.removeItem(HISTORY_KEY); } catch (error) { showError("保存済み履歴を削除できませんでした。"); }
  renderHistory();
});

renderHistory();
checkWebGPU();

const chatHistory = [];

function appendChatMessage(role, text) {
  const messagesEl = document.getElementById("chatMessages");
  const messageEl = document.createElement("div");
  messageEl.className = `chat-message chat-message-${role}`;
  messageEl.textContent = text;
  messagesEl.appendChild(messageEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return messageEl;
}

function createAssistantMessage() {
  const messagesEl = document.getElementById("chatMessages");
  const messageEl = document.createElement("div");
  messageEl.className = "chat-message chat-message-assistant chat-message-loading";
  messageEl.innerHTML =
    '<span class="chat-loading-dots" aria-label="Loading"><span></span><span></span><span></span></span>';
  messagesEl.appendChild(messageEl);
  scrollChatToBottom();
  return messageEl;
}

function clearAssistantLoading(assistantEl) {
  if (!assistantEl.classList.contains("chat-message-loading")) return;
  assistantEl.classList.remove("chat-message-loading");
  assistantEl.replaceChildren();
}

function setAssistantContent(assistantEl, text) {
  clearAssistantLoading(assistantEl);
  assistantEl.textContent = text;
  scrollChatToBottom();
}

function appendAssistantToken(assistantEl, token) {
  clearAssistantLoading(assistantEl);
  assistantEl.textContent += token;
  scrollChatToBottom();
}

function scrollChatToBottom() {
  const messagesEl = document.getElementById("chatMessages");
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setChatLoading(isLoading) {
  const sendBtn = document.getElementById("chatSendBtn");
  const input = document.getElementById("chatInput");
  sendBtn.disabled = isLoading;
  input.disabled = isLoading;
  sendBtn.textContent = isLoading ? "..." : "Send";
}

function parseSseEvents(chunk, onEvent) {
  const lines = chunk.split("\n");
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (!payload || payload === "[DONE]") continue;
    onEvent(JSON.parse(payload));
  }
}

function handleStreamEvent(event, assistantEl, state) {
  if (event.type === "token") {
    state.fullReply += event.content;
    appendAssistantToken(assistantEl, event.content);
  } else if (event.type === "done") {
    state.fullReply = event.content;
    setAssistantContent(assistantEl, state.fullReply);
  } else if (event.type === "error") {
    throw new Error(event.content);
  }
}

async function sendChatMessage() {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text) return;

  input.value = "";
  appendChatMessage("user", text);
  chatHistory.push({ role: "user", content: text });
  setChatLoading(true);

  const assistantEl = createAssistantMessage();
  const state = { fullReply: "" };

  try {
    const res = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: chatHistory }),
    });

    if (!res.ok) {
      let message = "Failed to get a response.";
      try {
        const data = await res.json();
        message = data.detail || message;
      } catch {
        message = `${res.status} ${res.statusText}`.trim() || message;
      }
      throw new Error(message);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        let streamError = null;
        parseSseEvents(part, (event) => {
          try {
            handleStreamEvent(event, assistantEl, state);
          } catch (error) {
            streamError = error;
          }
        });
        if (streamError) throw streamError;
      }
    }

    if (buffer.trim()) {
      let streamError = null;
      parseSseEvents(buffer, (event) => {
        try {
          handleStreamEvent(event, assistantEl, state);
        } catch (error) {
          streamError = error;
        }
      });
      if (streamError) throw streamError;
    }

    if (!state.fullReply.trim()) {
      state.fullReply = "No response received.";
      setAssistantContent(assistantEl, state.fullReply);
    }

    chatHistory.push({ role: "assistant", content: state.fullReply });
  } catch (error) {
    setAssistantContent(assistantEl, error.message || "Something went wrong.");
    if (state.fullReply) {
      chatHistory.push({ role: "assistant", content: state.fullReply });
    }
  } finally {
    setChatLoading(false);
    scrollChatToBottom();
    input.focus();
  }
}

function setupChatbot() {
  const panel = document.getElementById("chatPanel");
  const toggleBtn = document.getElementById("chatToggleBtn");
  const closeBtn = document.getElementById("chatCloseBtn");
  const sendBtn = document.getElementById("chatSendBtn");
  const input = document.getElementById("chatInput");
  const form = document.getElementById("chatForm");

  toggleBtn.addEventListener("click", () => {
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) {
      input.focus();
    }
  });

  closeBtn.addEventListener("click", () => {
    panel.classList.remove("open");
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendChatMessage();
  });

  sendBtn.addEventListener("click", sendChatMessage);

  appendChatMessage(
    "assistant",
    "Hi! Ask me about test quantities, yield rates, daily volume, or recent test records."
  );
}

document.addEventListener("DOMContentLoaded", setupChatbot);

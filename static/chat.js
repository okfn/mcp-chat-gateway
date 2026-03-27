const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");

let conversation = [];

function buildTable(rows) {
  const table = document.createElement("table");
  rows.forEach((row, i) => {
    const tr = document.createElement("tr");
    row.forEach((cell) => {
      const el = document.createElement(i === 0 ? "th" : "td");
      el.textContent = cell;
      tr.appendChild(el);
    });
    table.appendChild(tr);
  });
  return table;
}

function buildChart(chartData) {
  const wrapper = document.createElement("div");
  wrapper.style.height = "600px";
  const canvas = document.createElement("canvas");
  wrapper.appendChild(canvas);
  const beginAtZero = chartData.beginAtZero !== false;
  // Chart.js needs the canvas in the DOM to size correctly, so we defer init
  setTimeout(() => {
    new Chart(canvas, {
      type: chartData.type || "bar",
      data: {
        labels: chartData.labels || [],
        datasets: [{
          label: chartData.title || "",
          data: chartData.values || [],
          backgroundColor: chartData.color || "#4e79a7",
          borderColor: chartData.borderColor || chartData.color || "#3b6490",
          borderWidth: 1,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: !!chartData.title },
        },
        scales: {
          y: { beginAtZero: beginAtZero },
        },
      },
    });
  }, 0);
  return wrapper;
}

function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = "msg " + role;
  if (role === "force" || role === "table" || role === "chart") {
    const title = document.createElement("div");
    title.className = "force-title";
    const titles = { table: "MCP Tool (human) Table", chart: "MCP Tool (human) Chart", force: "MCP Tool (human) Message" };
    title.textContent = titles[role];
    div.appendChild(title);
  }
  if (role === "table" && Array.isArray(text)) {
    div.appendChild(buildTable(text));
  } else if (role === "chart" && typeof text === "object") {
    div.appendChild(buildChart(text));
  } else {
    div.appendChild(document.createTextNode(text));
  }
  // Insert before the typing indicator so it always stays at the bottom
  const typing = document.getElementById("typing");
  if (typing) {
    messagesEl.insertBefore(div, typing);
  } else {
    messagesEl.appendChild(div);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function showTyping() {
  const div = document.createElement("div");
  div.className = "typing";
  div.id = "typing";
  const label = document.createElement("span");
  label.textContent = "Thinking...";
  const bar = document.createElement("div");
  bar.className = "typing-bar";
  div.appendChild(label);
  div.appendChild(bar);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function hideTyping() {
  const el = document.getElementById("typing");
  if (el) el.remove();
}

function setEnabled(enabled) {
  sendBtn.disabled = !enabled;
  inputEl.disabled = !enabled;
}

async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text) return;

  inputEl.value = "";
  inputEl.style.height = "auto";
  addMessage("user", text);
  conversation.push({ role: "user", content: text });

  setEnabled(false);
  showTyping();

  try {
    const resp = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: conversation }),
    });

    await readSSE(resp);

  } catch (err) {
    hideTyping();
    addMessage("error", "Connection error: " + err.message);
  }

  setEnabled(true);
  inputEl.focus();

}

sendBtn.addEventListener("click", sendMessage);

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

inputEl.addEventListener("input", () => {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
});

// ---------------------------------------------------------------------------
// SSE stream parser — reads events as they arrive
// ---------------------------------------------------------------------------

async function readSSE(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Process complete events (separated by double newline)
    const parts = buffer.split("\n\n");
    buffer = parts.pop(); // keep incomplete tail

    for (const part of parts) {
      if (!part.trim()) continue;
      let eventType = "message";
      let data = "";
      for (const line of part.split("\n")) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          data = line.slice(6);
        }
      }
      if (!data) continue;
      try {
        const parsed = JSON.parse(data);
        handleSSEEvent(eventType, parsed);
      } catch (e) {
        // ignore malformed events
      }
    }
  }
}

function handleSSEEvent(eventType, data) {
  // We received a internal event from the server (tool call, error, or final result).
  if (eventType === "tool_call") {
    addToolCall(data);
  } else if (eventType === "error") {
    hideTyping();
    addMessage("error", data.error || "Unknown error");
  } else if (eventType === "result") {
    hideTyping();
    const reply = data.reply || "(no response)";
    addMessage("assistant", reply);
    conversation.push({ role: "assistant", content: reply });
  } else if (eventType === "force") {
    // The MCP tool forces us to display something to the user (display-only, not part of conversation).
    const forced_message = data.message || "(no response)";
    addMessage("force", forced_message);
  } else if (eventType === "table") {
    // The MCP tool provides a table to display (display-only, not part of conversation).
    const table_data = data.data || [];
    const table_error = data.error || null;
    if (table_error) {
      addMessage("error", table_error);
    } else {
      addMessage("table", table_data);
    }
  } else if (eventType === "chart") {
    // The MCP tool provides a chart to display (display-only, not part of conversation).
    const chart_data = data.data || {};
    const chart_error = data.error || null;
    if (chart_error) {
      addMessage("error", chart_error);
    } else {
      addMessage("chart", chart_data);
    }
  } else {
    // Unknown event type — show
    hideTyping();
    addMessage("error", `Unknown event type: ${eventType}`);
  }
}

function addToolCall(tc) {
  // Add a internall tool call to the chat.
  const entry = document.createElement("div");
  entry.className = "debug-entry";
  const args = Object.keys(tc.arguments).length
    ? JSON.stringify(tc.arguments)
    : "(no args)";
  entry.textContent = `[${tc.timestamp}] ${tc.tool}  ${args}`;
  const typing = document.getElementById("typing");
  if (typing) {
    messagesEl.insertBefore(entry, typing);
  } else {
    messagesEl.appendChild(entry);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

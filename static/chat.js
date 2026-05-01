const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");

let conversation = [];

function linkify(text) {
  const urlRe = /(https?:\/\/[^\s<]+)/g;
  const str = String(text);
  if (!urlRe.test(str)) return null;
  const frag = document.createDocumentFragment();
  let last = 0;
  str.replace(urlRe, (match, url, offset) => {
    if (offset > last) frag.appendChild(document.createTextNode(str.slice(last, offset)));
    const a = document.createElement("a");
    a.href = url;
    a.textContent = url;
    a.target = "_blank";
    a.rel = "noopener";
    frag.appendChild(a);
    last = offset + match.length;
  });
  if (last < str.length) frag.appendChild(document.createTextNode(str.slice(last)));
  return frag;
}

function buildTable(rows) {
  const table = document.createElement("table");
  rows.forEach((row, i) => {
    const tr = document.createElement("tr");
    row.forEach((cell) => {
      const el = document.createElement(i === 0 ? "th" : "td");
      const linked = linkify(cell);
      if (linked) { el.appendChild(linked); } else { el.textContent = cell; }
      tr.appendChild(el);
    });
    table.appendChild(tr);
  });
  return table;
}

const CHART_COLORS = [
  "#4e79a7", "#f28e2b", "#e15759", "#76b7b2",
  "#59a14f", "#edc948", "#b07aa1", "#ff9da7",
  "#9c755f", "#bab0ac", "#a0cbe8", "#ffbe7d",
  "#8cd17d", "#b6992d", "#f1ce63", "#499894",
];

function buildChart(chartData) {
  const wrapper = document.createElement("div");
  wrapper.style.height = "600px";
  const canvas = document.createElement("canvas");
  wrapper.appendChild(canvas);
  const beginAtZero = chartData.beginAtZero !== false;
  const isStacked = chartData.stacked && Array.isArray(chartData.datasets);
  const chartType = chartData.type || "bar";
  const isLine = chartType === "line";

  let datasets;
  if (isStacked) {
    datasets = chartData.datasets.map((ds, i) => ({
      label: ds.label || "",
      data: ds.data || [],
      backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
      borderWidth: 1,
    }));
  } else if (Array.isArray(chartData.datasets) && chartData.datasets.length > 0) {
    datasets = chartData.datasets.map((ds, i) => {
      const color = CHART_COLORS[i % CHART_COLORS.length];
      const base = {
        label: ds.label || chartData.title || "",
        data: ds.data || [],
      };
      if (isLine) {
        base.borderColor = color;
        base.backgroundColor = color + "33";
        base.borderWidth = 2;
        base.pointRadius = 4;
        base.tension = 0.3;
        base.fill = false;
      } else {
        base.backgroundColor = ds.color || color;
        base.borderColor = ds.borderColor || color;
        base.borderWidth = 1;
      }
      return base;
    });
  } else {
    const base = {
      label: chartData.title || "",
      data: chartData.values || [],
    };
    if (isLine) {
      base.borderColor = "#04498f";
      base.backgroundColor = "#04498f33";
      base.borderWidth = 2;
      base.pointRadius = 4;
      base.tension = 0.3;
      base.fill = false;
    } else {
      base.backgroundColor = chartData.color || "#04498f";
      base.borderColor = chartData.borderColor || chartData.color || "#090824";
      base.borderWidth = 1;
    }
    datasets = [base];
  }

  // Chart.js needs the canvas in the DOM to size correctly, so we defer init
  setTimeout(() => {
    new Chart(canvas, {
      type: chartType,
      data: {
        labels: chartData.labels || [],
        datasets: datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: chartData.title ? {
            display: true,
            text: chartData.title,
            font: { size: 14 },
          } : { display: false },
          legend: { display: isStacked || datasets.length > 1 || !!chartData.title },
        },
        scales: isStacked ? {
          x: { stacked: true },
          y: { stacked: true, beginAtZero: beginAtZero },
        } : {
          y: { beginAtZero: beginAtZero },
        },
      },
    });
  }, 0);
  return wrapper;
}

function addMessage(role, text) {
  const div = document.createElement("details");
  div.className = "msg " + role;
  div.open = true;

  const title = document.createElement("summary");
  if (role === "force" || role === "table" || role === "chart") {
    const titles = { table: "MCP Tool (human) Table", chart: "MCP Tool (human) Chart", force: "MCP Tool (human) Message" };
    title.textContent = titles[role];
  } else {
    const labels = { user: "You", assistant: "Assistant", error: "Error" };
    title.className = "msg-summary msg-summary-" + role;
    title.textContent = labels[role] || role;
  }
  div.appendChild(title);
  if (role === "table" && Array.isArray(text)) {
    div.appendChild(buildTable(text));
  } else if (role === "chart" && typeof text === "object") {
    div.appendChild(buildChart(text));
  } else if ((role === "assistant" || role === "force") && typeof marked !== "undefined") {
    const html = marked.parse(String(text));
    const content = document.createElement("div");
    content.className = "markdown";
    content.innerHTML = html;
    // Make all links open in new tab
    content.querySelectorAll("a").forEach(a => { a.target = "_blank"; a.rel = "noopener"; });
    div.appendChild(content);
  } else {
    const linked = linkify(text);
    if (linked) { div.appendChild(linked); } else { div.appendChild(document.createTextNode(text)); }
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

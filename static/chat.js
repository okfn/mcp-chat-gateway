const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const vizContent = document.getElementById("viz-content");
const vizPlaceholder = document.getElementById("viz-placeholder");

let conversation = [];
let debugAllToolCalls = false;

// Fetch config on load
fetch("/config")
  .then(r => r.json())
  .then(cfg => { debugAllToolCalls = cfg.debug_all_tool_calls || false; })
  .catch(() => {});

function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = "msg " + role;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function showVizPanel() {
  vizPlaceholder.style.display = "none";
  vizContent.style.display = "flex";
}

const COLORS = [
  "#4e79a7", "#f28e2b", "#e15759", "#76b7b2",
  "#59a14f", "#edc948", "#b07aa1", "#ff9da7",
  "#9c755f", "#bab0ac", "#a0cbe8", "#ffbe7d",
  "#8cd17d", "#b6992d", "#f1ce63", "#499894",
];

function addToolCall(tc) {
  if (!debugAllToolCalls) return;
  showVizPanel();
  const entry = document.createElement("div");
  entry.className = "debug-entry";
  const args = Object.keys(tc.arguments).length
    ? JSON.stringify(tc.arguments)
    : "(no args)";
  entry.textContent = `[${tc.timestamp}] ${tc.tool}  ${args}`;
  vizContent.appendChild(entry);
  vizContent.parentElement.scrollTop = vizContent.parentElement.scrollHeight;
}

function addChart(chartData) {
  showVizPanel();

  const div = document.createElement("div");
  div.className = "viz-item chart-item";
  const canvas = document.createElement("canvas");
  div.appendChild(canvas);

  vizContent.appendChild(div);

  const isStacked = chartData.stacked && chartData.datasets;
  let datasets;

  if (isStacked) {
    // Multi-dataset stacked chart
    datasets = chartData.datasets.map((ds, i) => ({
      label: ds.label,
      data: ds.data,
      backgroundColor: COLORS[i % COLORS.length],
    }));
  } else if (chartData.datasets) {
    // Single dataset in datasets array format
    datasets = chartData.datasets.map(ds => ({
      ...ds,
      backgroundColor: COLORS.slice(0, chartData.labels.length),
    }));
  } else {
    // Legacy single-series format
    datasets = [{
      label: chartData.label || "",
      data: chartData.data,
      backgroundColor: COLORS.slice(0, chartData.labels.length),
    }];
  }

  new Chart(canvas, {
    type: chartData.type || "bar",
    data: {
      labels: chartData.labels,
      datasets: datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: isStacked },
      },
      scales: isStacked ? {
        x: { stacked: true },
        y: { stacked: true },
      } : {},
    },
  });

  vizContent.parentElement.scrollTop = vizContent.parentElement.scrollHeight;
}

function addTable(tableData) {
  showVizPanel();

  // Outer wrapper groups table + button
  const wrapper = document.createElement("div");
  wrapper.className = "viz-item table-wrapper";

  // Scrollable table container
  const scrollDiv = document.createElement("div");
  scrollDiv.className = "table-scroll";

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  tableData.headers.forEach(h => {
    const th = document.createElement("th");
    th.textContent = h;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  tableData.rows.forEach(row => {
    const tr = document.createElement("tr");
    row.forEach(cell => {
      const td = document.createElement("td");
      td.textContent = cell;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  scrollDiv.appendChild(table);
  wrapper.appendChild(scrollDiv);

  // CSV download button — outside the scroll area, always visible
  const dlBtn = document.createElement("button");
  dlBtn.className = "csv-download-btn";
  dlBtn.textContent = "Descargar CSV";
  dlBtn.addEventListener("click", () => {
    const csvRows = [tableData.headers.join(",")];
    tableData.rows.forEach(row => {
      csvRows.push(row.map(cell => {
        const s = String(cell);
        return s.includes(",") || s.includes('"') || s.includes("\n")
          ? '"' + s.replace(/"/g, '""') + '"'
          : s;
      }).join(","));
    });
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "datos.csv";
    a.click();
    URL.revokeObjectURL(url);
  });
  wrapper.appendChild(dlBtn);

  vizContent.appendChild(wrapper);
  vizContent.parentElement.scrollTop = vizContent.parentElement.scrollHeight;
}

function showTyping() {
  const div = document.createElement("div");
  div.className = "typing";
  div.id = "typing";
  div.textContent = "Thinking...";
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

    if (data.tables) {
      data.tables.forEach(addTable);
    }
    if (data.charts) {
      data.charts.forEach(addChart);
    }
  }
}

// ---------------------------------------------------------------------------

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

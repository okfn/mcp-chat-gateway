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

// Chart.js plugin: draw percentage labels on top of pie/doughnut slices.
// Skips slices smaller than 3% to avoid clutter. White text with a dark
// outline so it stays readable on any slice color.
const piePercentPlugin = {
  id: "piePercent",
  afterDatasetsDraw(chart) {
    const type = chart.config.type;
    if (type !== "pie" && type !== "doughnut") return;
    const dataset = chart.data.datasets[0];
    if (!dataset) return;
    const values = (dataset.data || []).map((v) => Number(v) || 0);
    const total = values.reduce((s, v) => s + v, 0);
    if (!total) return;
    const meta = chart.getDatasetMeta(0);
    const { ctx } = chart;
    ctx.save();
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    meta.data.forEach((arc, i) => {
      const pct = (values[i] / total) * 100;
      if (pct < 3) return;
      const { x, y, startAngle, endAngle, outerRadius, innerRadius } = arc.getProps(
        ["x", "y", "startAngle", "endAngle", "outerRadius", "innerRadius"],
        true,
      );
      const midAngle = (startAngle + endAngle) / 2;
      const radius = (innerRadius + outerRadius) / 2;
      const labelX = x + Math.cos(midAngle) * radius;
      const labelY = y + Math.sin(midAngle) * radius;
      const text = pct.toFixed(1) + "%";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.65)";
      ctx.strokeText(text, labelX, labelY);
      ctx.fillStyle = "#fff";
      ctx.fillText(text, labelX, labelY);
    });
    ctx.restore();
  },
};
if (typeof Chart !== "undefined") {
  Chart.register(piePercentPlugin);
}

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
      const fallback = CHART_COLORS[i % CHART_COLORS.length];
      const base = {
        label: ds.label || chartData.title || "",
        data: ds.data || [],
      };
      if (isLine) {
        const lineColor = ds.borderColor || ds.color || fallback;
        base.borderColor = lineColor;
        // For lines, fade the fill if backgroundColor wasn't explicit.
        base.backgroundColor = ds.backgroundColor
          || (typeof lineColor === "string" ? lineColor + "33" : lineColor);
        base.borderWidth = 2;
        base.pointRadius = 4;
        base.tension = 0.3;
        base.fill = false;
      } else {
        // For pie/doughnut, ds.backgroundColor is an array (one color per
        // slice). For bar, it's a string. Honor whatever the tool sent.
        base.backgroundColor = ds.backgroundColor || ds.color || fallback;
        base.borderColor = ds.borderColor || ds.color || fallback;
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

// ---------------------------------------------------------------------------
// Tools drawer
// ---------------------------------------------------------------------------

const toolsToggle = document.getElementById("tools-toggle");
const toolsClose = document.getElementById("tools-close");
const toolsDrawer = document.getElementById("tools-drawer");
const toolsOverlay = document.getElementById("tools-overlay");
const toolsContent = document.getElementById("tools-content");

let toolsLoaded = false;

function prettyPluginName(plugin) {
  if (plugin === "core") return "Core";
  return plugin
    .replace(/^mcp_ckan_/, "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Normalise a URL label to a CSS-class-safe slug so per-label styling
// (different colour per badge kind) can hook off the rendered class.
function labelSlug(label) {
  return String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "other";
}

function renderToolsCatalog(catalog) {
  toolsContent.innerHTML = "";
  if (!catalog.groups || catalog.groups.length === 0) {
    const empty = document.createElement("p");
    empty.className = "tools-empty";
    empty.textContent = "No tools available. Is the MCP server running?";
    toolsContent.appendChild(empty);
    return;
  }
  catalog.groups.forEach((group) => {
    const section = document.createElement("section");
    section.className = "tools-group";

    const header = document.createElement("header");
    header.className = "tools-group-header";
    const title = document.createElement("h3");
    title.textContent = prettyPluginName(group.plugin);
    header.appendChild(title);
    section.appendChild(header);

    if (Array.isArray(group.urls) && group.urls.length > 0) {
      const badges = document.createElement("div");
      badges.className = "tools-group-badges";
      group.urls.forEach((u) => {
        if (!u.url) return;
        const link = document.createElement("a");
        link.href = u.url;
        link.target = "_blank";
        link.rel = "noopener";
        link.className = `tools-badge tools-badge--${labelSlug(u.label)}`;
        link.textContent = u.label;
        link.title = u.url;
        badges.appendChild(link);
      });
      if (badges.childNodes.length > 0) section.appendChild(badges);
    }

    const list = document.createElement("ul");
    list.className = "tools-list";
    group.tools.forEach((tool) => {
      const item = document.createElement("li");
      const details = document.createElement("details");
      details.className = "tools-tool";
      const summary = document.createElement("summary");
      const pretty = tool.display_name.replace(/_/g, " ");
      summary.textContent = pretty.charAt(0).toUpperCase() + pretty.slice(1);
      details.appendChild(summary);
      const desc = document.createElement("pre");
      desc.className = "tools-tool-desc";
      desc.textContent = tool.description || "(no description)";
      details.appendChild(desc);
      item.appendChild(details);
      list.appendChild(item);
    });
    section.appendChild(list);
    toolsContent.appendChild(section);
  });
}

async function loadToolsCatalog() {
  try {
    const resp = await fetch("/tools");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const catalog = await resp.json();
    renderToolsCatalog(catalog);
    toolsLoaded = true;
  } catch (err) {
    toolsContent.innerHTML = "";
    const error = document.createElement("p");
    error.className = "tools-error";
    error.textContent = `Failed to load tools: ${err.message}`;
    toolsContent.appendChild(error);
  }
}

function openToolsDrawer() {
  toolsDrawer.classList.add("open");
  toolsDrawer.setAttribute("aria-hidden", "false");
  toolsToggle.setAttribute("aria-expanded", "true");
  toolsOverlay.hidden = false;
  if (!toolsLoaded) loadToolsCatalog();
}

function closeToolsDrawer() {
  toolsDrawer.classList.remove("open");
  toolsDrawer.setAttribute("aria-hidden", "true");
  toolsToggle.setAttribute("aria-expanded", "false");
  toolsOverlay.hidden = true;
}

if (toolsToggle && toolsClose && toolsDrawer && toolsOverlay) {
  toolsToggle.addEventListener("click", () => {
    if (toolsDrawer.classList.contains("open")) closeToolsDrawer();
    else openToolsDrawer();
  });
  toolsClose.addEventListener("click", closeToolsDrawer);
  toolsOverlay.addEventListener("click", closeToolsDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && toolsDrawer.classList.contains("open")) closeToolsDrawer();
  });
}

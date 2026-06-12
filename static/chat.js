const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");

let conversation = [];

// i18n: gateway-owned strings live in /static/i18n/*.yaml.
// Logic and the language switcher are in /static/i18n.js (loaded before
// this file in each template). We just alias the public API.
const t = window.i18n.t;
const applyI18n = window.i18n.applyAll;

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

// Number of data rows (excluding the header) shown before collapsing the rest
// behind a "show all" button. Collapsing is display-only: the CSV download
// always exports every row.
const TABLE_ROW_LIMIT = 5;

// Two "download as CSV" links covering ALL rows, regardless of how many are
// currently visible: a standard RFC 4180 file and an Excel/Windows variant.
// Used in the table message header. Serialization lives in /static/csv.js,
// the link builder in /static/download.js.
function buildCSVDownload(rows) {
  const frag = document.createDocumentFragment();
  frag.appendChild(DownloadUtil.buildDownloadLink(
    CSVExport.toCSV(rows), "text/csv;charset=utf-8", "table.csv",
    t("chat.table.download") || "Download CSV"));
  frag.appendChild(DownloadUtil.buildDownloadLink(
    CSVExport.toExcelCSV(rows), "text/csv;charset=utf-8", "table-excel.csv",
    t("chat.table.downloadExcel") || "Download CSV for Excel/Windows"));
  return frag;
}

function buildTable(rows) {
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";

  const table = document.createElement("table");
  rows.forEach((row, i) => {
    const tr = document.createElement("tr");
    // i === 0 is the header row; data rows beyond the limit start hidden.
    if (i > TABLE_ROW_LIMIT) tr.className = "table-row-hidden";
    row.forEach((cell) => {
      const el = document.createElement(i === 0 ? "th" : "td");
      const linked = linkify(cell);
      if (linked) { el.appendChild(linked); } else { el.textContent = cell; }
      tr.appendChild(el);
    });
    table.appendChild(tr);
  });
  wrap.appendChild(table);

  const dataRows = Math.max(0, rows.length - 1);
  if (dataRows > TABLE_ROW_LIMIT) {
    const hiddenCount = dataRows - TABLE_ROW_LIMIT;
    const showAll = () => (t("chat.table.showAll") || "Show all") + " (" + hiddenCount + ")";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "table-toggle";
    toggle.textContent = showAll();
    toggle.addEventListener("click", () => {
      const expanded = table.classList.toggle("show-all");
      toggle.textContent = expanded ? (t("chat.table.showLess") || "Show less") : showAll();
    });
    wrap.appendChild(toggle);
  }

  return wrap;
}

// Render a chart message. The chartData -> Chart.js config translation lives
// in /static/chart-render.js, shared with the chart exports.
function buildChart(chartData) {
  const wrapper = document.createElement("div");
  wrapper.style.height = "600px";
  const canvas = document.createElement("canvas");
  wrapper.appendChild(canvas);
  // Chart.js needs the canvas in the DOM to size correctly, so we defer init
  setTimeout(() => {
    new Chart(canvas, ChartRender.buildConfig(chartData));
  }, 0);
  return wrapper;
}

function buildSources(sources) {
  const div = document.createElement('div')
  div.className = "msg sources"
  sources.forEach(el => {
    const _label = document.createElement("span");
    _label.innerText = t("chat.sourceLabel") || "Source:";
    div.appendChild(_label);
    try {
      const _url = new URL(el);
      const _link = document.createElement("a");
      _link.href = _url;
      _link.innerText = _url;
      _link.target = "_blank";
      div.appendChild(_link);
    } catch (error) {
      div.append(el);
    }
  });
  return div;
}

function addMessage(role, text, sources) {
  const div = document.createElement("details");
  div.className = "msg " + role;
  div.open = true;

  const title = document.createElement("summary");
  if (role === "force" || role === "table" || role === "chart") {
    const titles = { table: "MCP Tool (human) Table", chart: "MCP Tool (human) Chart", force: "MCP Tool (human) Message" };
    title.textContent = titles[role];
    if (role === "table" && Array.isArray(text) && text.length) {
      title.appendChild(buildCSVDownload(text));
    }
    if (role === "chart" && text && typeof text === "object") {
      title.appendChild(ChartExports.buildMenu(text, sources));
    }
  } else {
    const labels = { user: "You", assistant: "Assistant", error: "Error" };
    title.className = "msg-summary msg-summary-" + role;
    title.textContent = labels[role] || role;
  }
  div.appendChild(title);
  if (role === "table" && Array.isArray(text)) {
    div.appendChild(buildTable(text));
    div.appendChild(buildSources(sources));
  } else if (role === "chart" && typeof text === "object") {
    div.appendChild(buildChart(text));
    div.appendChild(buildSources(sources));
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
    const table_sources = data.sources || []
    if (table_error) {
      addMessage("error", table_error);
    } else {
      addMessage("table", table_data, table_sources);
    }
  } else if (eventType === "chart") {
    // The MCP tool provides a chart to display (display-only, not part of conversation).
    const chart_data = data.data || {};
    const chart_error = data.error || null;
    const chart_sources = data.sources || [];
    if (chart_error) {
      addMessage("error", chart_error);
    } else {
      addMessage("chart", chart_data, chart_sources);
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

// ---------------------------------------------------------------------------
// Resources drawer - same pattern as tools, but for MCP resources (docs/PDFs).
// Each plugin can register reference documents the user can browse/download.
// The LLM does NOT autodiscover them; this drawer is the human surface.
// ---------------------------------------------------------------------------

const resourcesToggle = document.getElementById("resources-toggle");
const resourcesClose = document.getElementById("resources-close");
const resourcesDrawer = document.getElementById("resources-drawer");
const resourcesOverlay = document.getElementById("resources-overlay");
const resourcesContent = document.getElementById("resources-content");

let resourcesLoaded = false;

function humanSize(bytes) {
  if (bytes == null) return "";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function renderResourcesCatalog(catalog) {
  resourcesContent.innerHTML = "";
  const groups = catalog.groups || [];
  if (!groups.length) {
    const empty = document.createElement("p");
    empty.className = "tools-empty";
    empty.textContent =
      (window.i18n && window.i18n.t("resourcesDrawer.empty")) ||
      "No reference documents available yet.";
    resourcesContent.appendChild(empty);
    return;
  }
  groups.forEach((group) => {
    const section = document.createElement("section");
    section.className = "tools-group";

    const header = document.createElement("header");
    header.className = "tools-group-header";
    const title = document.createElement("h3");
    title.textContent = prettyPluginName(group.plugin);
    header.appendChild(title);
    section.appendChild(header);

    const list = document.createElement("ul");
    list.className = "tools-list";
    group.resources.forEach((r) => {
      const item = document.createElement("li");
      const details = document.createElement("details");
      details.className = "tools-tool";

      const summary = document.createElement("summary");
      summary.textContent = r.name;
      details.appendChild(summary);

      if (r.description) {
        const desc = document.createElement("pre");
        desc.className = "tools-tool-desc";
        desc.textContent = r.description;
        details.appendChild(desc);
      }

      // Read-only facts about the resource (publisher, year, type, size) stay
      // as small grey tags — they are metadata, not actions.
      const metaRow = document.createElement("div");
      metaRow.className = "tools-group-badges";
      const facts = [];
      if (r.publisher) facts.push(r.publisher);
      if (r.year) facts.push(String(r.year));
      if (r.mime_type) facts.push(r.mime_type);
      if (r.size != null) facts.push(humanSize(r.size));
      facts.forEach((text) => {
        const badge = document.createElement("span");
        badge.className = "tools-badge tools-badge--meta";
        badge.textContent = text;
        metaRow.appendChild(badge);
      });
      if (facts.length) details.appendChild(metaRow);

      // Actions live in their own row. The primary one is a clear download
      // button (not a tag), so users recognise the resource is downloadable.
      const actionsRow = document.createElement("div");
      actionsRow.className = "resource-actions";

      const downloadLink = document.createElement("a");
      downloadLink.href = `/resource?uri=${encodeURIComponent(r.uri)}`;
      downloadLink.target = "_blank";
      downloadLink.rel = "noopener";
      // Hint the browser to download rather than navigate; the empty value
      // lets it fall back to the server-provided filename.
      downloadLink.setAttribute("download", "");
      downloadLink.className = "resource-download";
      const icon = document.createElement("span");
      icon.className = "resource-download-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML =
        '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" ' +
        'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ' +
        'stroke-linejoin="round"><path d="M8 1.5v8.5M4.5 7 8 10.5 11.5 7"/>' +
        '<path d="M2.5 12.5v1a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1"/></svg>';
      downloadLink.appendChild(icon);
      const label = document.createElement("span");
      label.textContent =
        (window.i18n && window.i18n.t("resourcesDrawer.download")) || "Download";
      downloadLink.appendChild(label);
      actionsRow.appendChild(downloadLink);

      if (r.source_url) {
        const src = document.createElement("a");
        src.href = r.source_url;
        src.target = "_blank";
        src.rel = "noopener";
        src.className = "resource-source";
        src.textContent =
          (window.i18n && window.i18n.t("resourcesDrawer.source")) || "Original source";
        actionsRow.appendChild(src);
      }

      details.appendChild(actionsRow);
      item.appendChild(details);
      list.appendChild(item);
    });
    section.appendChild(list);
    resourcesContent.appendChild(section);
  });
}

async function loadResourcesCatalog() {
  try {
    const resp = await fetch("/resources");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const catalog = await resp.json();
    renderResourcesCatalog(catalog);
    resourcesLoaded = true;
  } catch (err) {
    resourcesContent.innerHTML = "";
    const error = document.createElement("p");
    error.className = "tools-error";
    error.textContent = `Failed to load resources: ${err.message}`;
    resourcesContent.appendChild(error);
  }
}

function openResourcesDrawer() {
  resourcesDrawer.classList.add("open");
  resourcesDrawer.setAttribute("aria-hidden", "false");
  resourcesToggle.setAttribute("aria-expanded", "true");
  resourcesOverlay.hidden = false;
  if (!resourcesLoaded) loadResourcesCatalog();
}

function closeResourcesDrawer() {
  resourcesDrawer.classList.remove("open");
  resourcesDrawer.setAttribute("aria-hidden", "true");
  resourcesToggle.setAttribute("aria-expanded", "false");
  resourcesOverlay.hidden = true;
}

if (resourcesToggle && resourcesClose && resourcesDrawer && resourcesOverlay) {
  resourcesToggle.addEventListener("click", () => {
    if (resourcesDrawer.classList.contains("open")) closeResourcesDrawer();
    else openResourcesDrawer();
  });
  resourcesClose.addEventListener("click", closeResourcesDrawer);
  resourcesOverlay.addEventListener("click", closeResourcesDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && resourcesDrawer.classList.contains("open")) closeResourcesDrawer();
  });
}

// ---------------------------------------------------------------------------
// Landing screen — centered welcome, sample questions, mode transition.
// On the first send we swap body class from "landing" to "chat" and let the
// existing chat layout take over. The landing input forwards its text to the
// docked chat input and reuses sendMessage().
// ---------------------------------------------------------------------------

const landingEl = document.getElementById("landing");
const landingForm = document.getElementById("landing-form");
const landingInput = document.getElementById("landing-input");
const landingPlugins = document.getElementById("landing-plugins");
const landingOpenTools = document.getElementById("landing-open-tools");

function enterChatMode() {
  document.body.classList.remove("landing");
  document.body.classList.add("chat");
  // Focus the docked input so subsequent typing lands there.
  if (inputEl) {
    inputEl.focus();
  }
}

function submitFromLanding(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return;
  // Hand the text to the docked input and trigger the existing flow.
  inputEl.value = trimmed;
  enterChatMode();
  sendMessage();
}

if (landingForm && landingInput) {
  landingInput.addEventListener("input", () => {
    landingInput.style.height = "auto";
    landingInput.style.height = Math.min(landingInput.scrollHeight, 160) + "px";
  });

  landingInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitFromLanding(landingInput.value);
    }
  });

  landingForm.addEventListener("submit", (e) => {
    e.preventDefault();
    submitFromLanding(landingInput.value);
  });
}

if (landingOpenTools) {
  landingOpenTools.addEventListener("click", (e) => {
    e.preventDefault();
    openToolsDrawer();
  });
}

// The footer link is rendered via i18n innerHTML, so we delegate from the
// landing root to catch the click regardless of re-renders.
if (landingEl) {
  landingEl.addEventListener("click", (e) => {
    const target = e.target;
    if (target && target.id === "landing-footer-tools") {
      e.preventDefault();
      openToolsDrawer();
    }
  });
}

// Render plugin cards on the landing from /tools (groups + sample_questions).

function renderLandingPlugins(catalog) {
  if (!landingPlugins) return;
  landingPlugins.innerHTML = "";
  const groups = (catalog && catalog.groups) || [];

  // Skip the synthetic "core" group on the landing — it carries no plugin
  // metadata and would render as an empty card. It still shows in the drawer.
  const visible = groups.filter((g) => g.plugin !== "core");

  if (visible.length === 0) {
    const empty = document.createElement("p");
    empty.className = "landing-plugins-loading";
    empty.textContent = t("landing.plugins.empty");
    landingPlugins.appendChild(empty);
    return;
  }

  visible.forEach((group) => {
    const card = document.createElement("article");
    card.className = "plugin-card";

    const head = document.createElement("header");
    head.className = "plugin-card-head";
    const title = document.createElement("h3");
    title.className = "plugin-card-title";
    title.textContent = prettyPluginName(group.plugin);
    head.appendChild(title);

    const toolCount = Array.isArray(group.tools) ? group.tools.length : 0;
    if (toolCount > 0) {
      const count = document.createElement("span");
      count.className = "plugin-card-count";
      count.textContent = toolCount === 1
        ? t("landing.plugins.toolsCountOne")
        : t("landing.plugins.toolsCount", { n: toolCount });
      head.appendChild(count);
    }
    card.appendChild(head);

    if (group.description) {
      const desc = document.createElement("p");
      desc.className = "plugin-card-desc";
      desc.textContent = group.description;
      card.appendChild(desc);
    }

    const samples = Array.isArray(group.sample_questions) ? group.sample_questions : [];
    if (samples.length > 0) {
      const label = document.createElement("p");
      label.className = "plugin-card-section-label";
      label.textContent = t("landing.plugins.sampleLabel");
      card.appendChild(label);

      const chips = document.createElement("div");
      chips.className = "plugin-card-chips";
      samples.forEach((q) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip";
        chip.textContent = q;
        chip.addEventListener("click", () => submitFromLanding(q));
        chips.appendChild(chip);
      });
      card.appendChild(chips);
    }

    if (Array.isArray(group.urls) && group.urls.length > 0) {
      const footer = document.createElement("div");
      footer.className = "plugin-card-footer";
      group.urls.forEach((u) => {
        if (!u.url) return;
        const link = document.createElement("a");
        link.href = u.url;
        link.target = "_blank";
        link.rel = "noopener";
        link.className = `tools-badge tools-badge--${labelSlug(u.label)}`;
        link.textContent = u.label;
        link.title = u.url;
        footer.appendChild(link);
      });
      if (footer.childNodes.length > 0) card.appendChild(footer);
    }

    landingPlugins.appendChild(card);
  });
}

async function loadLandingPlugins() {
  if (!landingPlugins) return;
  try {
    const resp = await fetch("/tools");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const catalog = await resp.json();
    renderLandingPlugins(catalog);
  } catch (err) {
    landingPlugins.innerHTML = "";
    const error = document.createElement("p");
    error.className = "landing-plugins-error";
    error.textContent = t("landing.plugins.error");
    landingPlugins.appendChild(error);
  }
}

// Wait for i18n to finish loading so chip labels / loading text are translated
// the first time the cards appear, not after a flash of English.
if (landingEl) window.i18n.ready.then(loadLandingPlugins);

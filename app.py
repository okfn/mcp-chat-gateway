"""
Webchat - Simple chat UI that bridges an AI provider with MCP tools.

Dependencies: flask, httpx

AI provider is configurable via environment variables.
Any OpenAI-compatible API works (DeepSeek, OpenAI, Ollama, etc).
"""

import base64
from datetime import datetime, timezone
import json
import os
from urllib.parse import urlparse

import httpx
from flask import (
    Flask,
    Response,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
)

import settings
from utils.debug import logger


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


# Maximum tool-call rounds to prevent infinite loops
MAX_TOOL_ROUNDS = 10

app = Flask(__name__, static_folder="static")

# ---------------------------------------------------------------------------
# MCP client helpers
# ---------------------------------------------------------------------------

# Session ID obtained after MCP initialize handshake
_mcp_session_id = None

# `instructions`, a field of the MCP spec, describes what a plugin's
# tools are about. It's merged into the system prompt.
_mcp_instructions = ""

# Cached MCP tool catalog: (fetched_at_epoch, tools_list). Tools are static
# for the life of the MCP server, so we cache them. Calling /tools will
# force a refresh.
_mcp_tools_cache = None


def _mcp_headers():
    """Common headers for MCP streamable HTTP requests."""
    headers = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream, application/json",
    }
    if _mcp_session_id:
        headers["Mcp-Session-Id"] = _mcp_session_id
    return headers


def _parse_mcp_response(resp):
    """Parse an MCP response, handling both JSON and SSE* formats.
    * Server-sent events https://en.wikipedia.org/wiki/Server-sent_events
    """
    content_type = resp.headers.get("content-type", "")
    if "text/event-stream" in content_type:
        # Parse SSE: find the last "data:" line with JSON
        result = None
        for line in resp.text.splitlines():
            if line.startswith("data:"):
                try:
                    result = json.loads(line[5:].strip())
                except json.JSONDecodeError:
                    pass
        return result or {}
    else:
        return resp.json()


def mcp_initialize():
    """Perform MCP initialize handshake and store session ID."""
    global _mcp_session_id, _mcp_instructions
    req_body = {
        "jsonrpc": "2.0",
        "id": 0,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-03-26",
            # capabilities:
            # - "roots": client can provide file system roots
            # - "sampling": client can handle LLM sampling requests from the server
            #   It's when the MCP server asks the client to call an LLM on its behalf. The reverse of the normal flow.
            #   Use case example: an MCP tool that generates a summary. Instead of doing it itself, the server says
            #   "send this text to your AI model and return what it says." This way the server
            #   doesn't need its own AI API key — it borrows the client's.
            "capabilities": {},
            "clientInfo": {"name": "OKFN MCP gateway", "version": "0.1"},
        },
    }
    req_headers = _mcp_headers()
    resp = httpx.post(settings.MCP_URL, json=req_body, headers=req_headers, timeout=30)

    # Store session ID from response header
    session_id = resp.headers.get("mcp-session-id")
    if session_id:
        _mcp_session_id = session_id
        logger.info(f"MCP session initialized: {_mcp_session_id}")

    parsed = _parse_mcp_response(resp)
    # Capture the server's `instructions` (the toolset doctrine). Previously
    # parsed and thrown away; now fed into the system prompt by chat().
    _mcp_instructions = parsed.get("result", {}).get("instructions", "") or ""
    logger.debug({
        "label": "mcp_initialize",
        "request": {"url": settings.MCP_URL, "headers": req_headers, "body": req_body},
        "response": {"status": resp.status_code, "headers": dict(resp.headers), "body": parsed},
    })

    # Send initialized notification
    notif_body = {"jsonrpc": "2.0", "method": "notifications/initialized"}
    resp2 = httpx.post(settings.MCP_URL, json=notif_body, headers=_mcp_headers(), timeout=10)
    logger.debug({
        "label": "mcp_initialized_notification",
        "request": {"url": settings.MCP_URL, "headers": _mcp_headers(), "body": notif_body},
        "response": {"status": resp2.status_code, "headers": dict(resp2.headers), "body": resp2.text},
    })

    return parsed


def mcp_list_tools():
    """Fetch the tool list from the MCP server using streamable HTTP."""
    global _mcp_session_id
    # Initialize session if needed
    if not _mcp_session_id:
        mcp_initialize()

    req_body = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
    req_headers = _mcp_headers()
    resp = httpx.post(settings.MCP_URL, json=req_body, headers=req_headers, timeout=30)
    data = _parse_mcp_response(resp)

    logger.debug({
        "label": "mcp_list_tools",
        "request": {"url": settings.MCP_URL, "headers": req_headers, "body": req_body},
        "response": {"status": resp.status_code, "headers": dict(resp.headers), "body": data},
    })

    return data.get("result", {}).get("tools", [])


def get_mcp_tools(force_refresh=False):
    """Return the MCP tool catalog, cached with a TTL.

    The tool list is static for the life of the MCP server, so we cache it
    rather than calling ``tools/list`` on every request. Pass
    ``force_refresh=True`` to invalidate the cache.
    """
    global _mcp_tools_cache
    if not force_refresh and _mcp_tools_cache is not None:
        return _mcp_tools_cache
    tools = mcp_list_tools()
    _mcp_tools_cache = tools
    return tools


def mcp_call_tool(name, arguments):
    """Call a tool on the MCP server and return its result."""
    logger.info(f"MCP tool call: {name}({arguments})")
    req_body = {
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/call",
        "params": {"name": name, "arguments": arguments},
    }
    req_headers = _mcp_headers()
    resp = httpx.post(settings.MCP_URL, json=req_body, headers=req_headers, timeout=60)
    data = _parse_mcp_response(resp)

    logger.debug({
        "label": f"mcp_call_tool_{name}",
        "request": {"url": settings.MCP_URL, "headers": req_headers, "body": req_body},
        "response": {"status": resp.status_code, "headers": dict(resp.headers), "body": data},
    })

    result = data.get("result", {})
    return result


def mcp_list_resources():
    """Fetch the resource catalog from the MCP server.

    Resources are documents/PDFs/CSVs each plugin exposes via the MCP
    ``resources/list`` method. They are NOT auto-consumed by the LLM —
    the gateway lists them for users to browse and download.
    """
    global _mcp_session_id
    if not _mcp_session_id:
        mcp_initialize()

    req_body = {"jsonrpc": "2.0", "id": 3, "method": "resources/list", "params": {}}
    req_headers = _mcp_headers()
    resp = httpx.post(settings.MCP_URL, json=req_body, headers=req_headers, timeout=30)
    data = _parse_mcp_response(resp)

    logger.debug({
        "label": "mcp_list_resources",
        "request": {"url": settings.MCP_URL, "headers": req_headers, "body": req_body},
        "response": {"status": resp.status_code, "headers": dict(resp.headers), "body": data},
    })

    return data.get("result", {}).get("resources", [])


def mcp_read_resource(uri):
    """Fetch a resource's contents from the MCP server (lazy).

    Returns the list of ``contents`` blocks from ``resources/read``: each is
    a dict with either a ``text`` field (for text mime types) or a ``blob``
    field (base64-encoded bytes) plus its ``mimeType``.
    """
    global _mcp_session_id
    if not _mcp_session_id:
        mcp_initialize()

    req_body = {"jsonrpc": "2.0", "id": 4, "method": "resources/read", "params": {"uri": uri}}
    req_headers = _mcp_headers()
    resp = httpx.post(settings.MCP_URL, json=req_body, headers=req_headers, timeout=120)
    data = _parse_mcp_response(resp)

    logger.debug({
        "label": f"mcp_read_resource_{uri}",
        "request": {"url": settings.MCP_URL, "headers": req_headers, "body": req_body},
        "response": {"status": resp.status_code, "headers": dict(resp.headers)},
    })

    return data.get("result", {}).get("contents", [])


def mcp_tools_to_openai_format(mcp_tools):
    """Convert MCP tool definitions to OpenAI-compatible function format."""
    openai_tools = []
    for tool in mcp_tools:
        openai_tools.append(
            {
                "type": "function",
                "function": {
                    "name": tool["name"],
                    "description": tool.get("description", ""),
                    "parameters": tool.get("inputSchema", {"type": "object", "properties": {}}),
                },
            }
        )
    return openai_tools


# ---------------------------------------------------------------------------
# AI provider helpers
# ---------------------------------------------------------------------------


def ai_chat_completion(messages, tools=None, tool_choice="auto"):
    """Send a chat completion request to the AI provider.

    tool_choice:
      - "required": force the model to call at least one tool. Use on the
        first turn so the model never improvises without grounding.
      - "auto": let the model decide. Use after a tool result is in the
        history so the model can synthesise a final text reply.
    """
    payload = {
        "model": settings.AI_MODEL,
        "messages": messages,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = tool_choice

    url = f"{settings.AI_BASE_URL}/chat/completions"
    req_headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {settings.AI_API_KEY[:8]}...hidden",
    }
    resp = httpx.post(
        url,
        json=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.AI_API_KEY}",
        },
        timeout=120,
    )
    resp.raise_for_status()
    data = resp.json()

    logger.debug({
        "label": "ai_chat_completion",
        "request": {"url": url, "headers": req_headers, "body": payload},
        "response": {"status": resp.status_code, "headers": dict(resp.headers), "body": data},
    })

    return data


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


def sse_event(event, data):
    """Format a single SSE event string."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@app.route("/")
def index():
    """Serve the chat HTML page."""
    return send_from_directory(os.path.dirname(__file__), "templates/index.html")


@app.route("/chat", methods=["POST"])
def chat():
    """Handle a chat request: AI completion + MCP tool calling loop.

    Streams SSE events so tool calls appear in real-time:
      event: tool_call, each MCP tool invocation (immediate)
      event: result, MCP response (hidden and allowed to expand)
      event: error, on failure
    """
    body = request.get_json()
    messages = body.get("messages", [])

    if not messages:
        return jsonify({"error": "No messages provided"}), 400

    if not settings.AI_API_KEY:
        return jsonify({"error": "settings.AI_API_KEY not configured"}), 500

    # Fetch available MCP tools
    try:
        mcp_tools = get_mcp_tools()
        logger.info(f"MCP found {len(mcp_tools)} tools: {[t['name'] for t in mcp_tools]}")
    except Exception as e:
        logger.error(f"MCP connection error: {e}")
        mcp_tools = []

    openai_tools = mcp_tools_to_openai_format(mcp_tools) if mcp_tools else None
    if openai_tools:
        logger.info(f"Sending {len(openai_tools)} tools to {settings.AI_MODEL}")

    constitution = (
        "Reply in the user's language, concise, data first.\n"
        "DATA DISCIPLINE: every factual claim (numbers, names, dates, "
        "categories) MUST come from a tool result, never from your own "
        "knowledge.\n"
        "ADDING CONTEXT: you MAY add interpretation or context, but ONLY in a "
        "final, clearly separated section whose heading means 'not from the "
        "data' (e.g. 'Note (not from the data):'), written in the user's "
        "language. Never blend that commentary into the data-backed answer. "
        "If you have nothing data-backed to add, omit the section entirely - "
        "do not pad the reply."
    )

    parts = [constitution]
    if _mcp_instructions:
        parts.append(_mcp_instructions)
    else:
        # Fallback only when the server ships no doctrine of its own.
        parts.append(
            "Answer every question using at least one of the available tools. "
            "If no tool fits, call the fallback tool whose name ends in "
            "`no_tool_disponible` with a short reason and stop."
        )

    system_msg = {"role": "system", "content": "\n\n".join(parts)}
    messages = [system_msg] + messages

    def generate():
        # Tool-calling loop. First round forces a tool call; later rounds
        # let the model produce a final text reply once it has tool results.
        for round_idx in range(MAX_TOOL_ROUNDS):
            tool_choice = "required" if round_idx == 0 and openai_tools else "auto"
            try:
                result = ai_chat_completion(
                    messages, tools=openai_tools, tool_choice=tool_choice,
                )
            except httpx.HTTPStatusError as e:
                yield sse_event("error", {"error": f"AI provider error: {e.response.status_code}"})
                return

            choice = result["choices"][0]
            message = choice["message"]

            # If no tool calls, we're done
            tool_calls = message.get("tool_calls")
            if not tool_calls:
                logger.info("AI final response (no tool calls)")
                yield sse_event("result", {"reply": message.get("content", "")})
                return

            # Append assistant message with tool calls
            logger.info(f"AI tool calls requested: {[tc['function']['name'] for tc in tool_calls]}")
            messages.append(message)

            # Execute each tool call via MCP
            for tc in tool_calls:
                fn = tc["function"]
                tool_name = fn["name"]
                args = fn.get("arguments")
                try:
                    tool_args = json.loads(args) if args else {}
                except json.JSONDecodeError:
                    error = f"Invalid args: ({args}) for tool {tool_name}"
                    yield sse_event("error", {"message": error})
                    tool_args = {}

                yield sse_event("tool_call", {
                    "timestamp": datetime.now(timezone.utc).strftime("%H:%M:%S"),
                    "tool": tool_name,
                    "arguments": tool_args,
                })

                try:
                    tool_result = mcp_call_tool(tool_name, tool_args)
                except Exception as e:
                    tool_result = f"Error calling tool: {e}"
                    yield sse_event("error", {"message": tool_result})

                final_response = tool_result.get("content")[0].get("text")
                data = tool_result.get("structuredContent") or {}
                if data.get("force"):
                    yield sse_event("force", {"message": data["force"]})
                if data.get("table"):
                    yield sse_event("table", {"data": data.get("table"), "sources": data.get("sources")})
                for chart_item in data.get("charts", []):
                    yield sse_event("chart", {"data": chart_item, "sources": data.get("sources"), "error": None})

                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": final_response,
                    }
                )

        yield sse_event("error", {"message": "Maximum tool call rounds reached."})

    return Response(generate(), mimetype="text/event-stream")


@app.route("/about")
def about():
    """Serve the about page with the Pilot information."""
    return render_template("about.html")


@app.route("/how-to")
def how_to():
    """Serve the How to page with MCP tools information."""
    try:
        mcp_tools = get_mcp_tools()
    except Exception as e:
        logger.error(f"Failed to fetch MCP tools for about page: {e}")
        mcp_tools = []

    return render_template("how_to.html", tools=mcp_tools)


@app.route("/tools")
def list_tools():
    """Return the MCP tool catalog grouped by plugin, for the home-page drawer.

    The MCP server attaches ``_meta.plugin`` and ``_meta.plugin_metadata`` to
    every tool it registers through a plugin sub-registry — the latter is a
    dict whose currently-defined key is ``urls`` (more fields may be added
    server-side later).  This endpoint is a thin grouper; it does not know
    about specific plugins.  Each plugin group carries every URL the plugin
    declared (Homepage, Documentation, Repository, Issues, Changelog, …) and
    the UI renders one badge per URL.  Tools without any plugin meta land
    in a synthetic "core" group.
    """
    try:
        mcp_tools = get_mcp_tools(force_refresh=True)
    except Exception as e:
        logger.error(f"Failed to fetch MCP tools for /tools: {e}")
        return jsonify({"groups": [], "error": str(e)}), 502

    groups: dict[str, dict] = {}
    for tool in mcp_tools:
        meta = tool.get("_meta") or {}
        plugin = meta.get("plugin") or "core"
        plugin_metadata = meta.get("plugin_metadata") or {}
        group = groups.setdefault(
            plugin,
            {
                "plugin": plugin,
                "description": plugin_metadata.get("description") or "",
                "sample_questions": plugin_metadata.get("sample_questions") or [],
                "urls": plugin_metadata.get("urls") or [],
                "tools": [],
            },
        )
        display_name = tool["name"]
        if plugin != "core" and display_name.startswith(plugin + "_"):
            display_name = display_name[len(plugin) + 1:]
        group["tools"].append({
            "name": tool["name"],
            "display_name": display_name,
            "description": tool.get("description", ""),
        })

    # Stable order: core first if present, then plugins alphabetically.
    ordered = sorted(groups.values(), key=lambda g: (g["plugin"] != "core", g["plugin"]))
    for group in ordered:
        group["tools"].sort(key=lambda t: t["display_name"])
    return jsonify({"groups": ordered})


@app.route("/resources")
def list_resources_endpoint():
    """Return the MCP resource catalog grouped by plugin, for the resources drawer.

    The base server stamps ``_meta.plugin`` on every resource it registers
    through a plugin sub-registry (mirror of how tools work). This endpoint
    is a thin grouper that the UI can render without knowing about specific
    plugins.  Each resource carries its mime type, optional size, and any
    custom annotations the plugin attached (``source_url``, ``publisher``,
    ``year``, …) so the gateway can show an "Open original" link, a
    publisher badge, etc.
    """
    try:
        resources = mcp_list_resources()
    except Exception as e:
        logger.error(f"Failed to fetch MCP resources for /resources: {e}")
        return jsonify({"groups": [], "error": str(e)}), 502

    groups: dict[str, dict] = {}
    for r in resources:
        meta = r.get("_meta") or {}
        plugin = meta.get("plugin") or "core"
        plugin_metadata = meta.get("plugin_metadata") or {}
        annotations = meta.get("annotations") or {}
        group = groups.setdefault(
            plugin,
            {
                "plugin": plugin,
                "description": plugin_metadata.get("description") or "",
                "urls": plugin_metadata.get("urls") or [],
                "resources": [],
            },
        )
        group["resources"].append({
            "uri": r["uri"],
            "name": r.get("name") or r["uri"],
            "description": r.get("description", ""),
            "mime_type": r.get("mimeType", ""),
            "size": r.get("size"),
            "source_url": annotations.get("source_url"),
            "publisher": annotations.get("publisher"),
            "year": annotations.get("year"),
            "language": annotations.get("language"),
            "topics": annotations.get("topics") or [],
        })

    ordered = sorted(groups.values(), key=lambda g: (g["plugin"] != "core", g["plugin"]))
    for group in ordered:
        group["resources"].sort(key=lambda r: r["name"].lower())
    return jsonify({"groups": ordered})


@app.route("/resource")
def get_resource_endpoint():
    """Proxy a single MCP resource's content, with its declared mime type.

    Query string: ``?uri=<uri>``. For text resources, returns the raw text.
    For binary resources (PDF, image, …), returns the decoded bytes with a
    ``Content-Disposition: inline`` so the browser previews or downloads
    based on the mime type. Filename is derived from the URI's last segment.
    """
    uri = request.args.get("uri")
    if not uri:
        return jsonify({"error": "missing uri"}), 400

    try:
        contents = mcp_read_resource(uri)
    except Exception as e:
        logger.error(f"Failed to read MCP resource {uri}: {e}")
        return jsonify({"error": str(e)}), 502

    if not contents:
        return jsonify({"error": "no contents returned"}), 404

    first = contents[0]
    mime = first.get("mimeType", "application/octet-stream")
    parsed = urlparse(uri)
    filename = (parsed.path or "resource").rsplit("/", 1)[-1] or "resource"

    if "text" in first:
        # A text/uri-list resource is a pointer to an external page, not a
        # document: it holds a single URL, so send the browser there instead
        # of serving the text as a file.
        if mime == "text/uri-list":
            return redirect(first["text"].strip())
        return Response(first["text"], mimetype=mime)
    if "blob" in first:
        raw = base64.b64decode(first["blob"])
        return Response(
            raw,
            mimetype=mime,
            headers={"Content-Disposition": f'inline; filename="{filename}"'},
        )
    return jsonify({"error": "unrecognized content shape"}), 500


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logger.info(f"Webchat starting on http://{settings.WEBCHAT_HOST}:{settings.WEBCHAT_PORT}")
    logger.info(f"AI provider: {settings.AI_BASE_URL} (model: {settings.AI_MODEL})")
    logger.info(f"MCP server: {settings.MCP_URL}")

    # Warm the tool cache so the first user message isn't slow.
    try:
        get_mcp_tools()
        logger.info("MCP tool cache warmed at startup")
    except Exception as e:
        logger.warning(f"Could not warm MCP tool cache at startup: {e}")

    app.run(host=settings.WEBCHAT_HOST, port=settings.WEBCHAT_PORT)

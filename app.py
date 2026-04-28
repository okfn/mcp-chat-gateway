"""
Webchat - Simple chat UI that bridges an AI provider with MCP tools.

Dependencies: flask, httpx

AI provider is configurable via environment variables.
Any OpenAI-compatible API works (DeepSeek, OpenAI, Ollama, etc).
"""

from datetime import datetime, timezone
import json
import os
import httpx
from flask import (
    Flask,
    Response,
    jsonify,
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
    global _mcp_session_id
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


def ai_chat_completion(messages, tools=None):
    """Send a chat completion request to the AI provider."""
    payload = {
        "model": settings.AI_MODEL,
        "messages": messages,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

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
    return send_from_directory(os.path.dirname(__file__), "index.html")


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
        mcp_tools = mcp_list_tools()
        logger.info(f"MCP found {len(mcp_tools)} tools: {[t['name'] for t in mcp_tools]}")
    except Exception as e:
        logger.error(f"MCP connection error: {e}")
        mcp_tools = []

    openai_tools = mcp_tools_to_openai_format(mcp_tools) if mcp_tools else None
    if openai_tools:
        logger.info(f"Sending {len(openai_tools)} tools to {settings.AI_MODEL}")

    # Build system prompt telling the AI to use its tools
    tool_names = [t["name"] for t in mcp_tools] if mcp_tools else []
    system_msg = {
        "role": "system",
        "content": (
            "You are a specialized assistant that ONLY answers questions using the available tools. "
            "You MUST call at least one tool for every user question. "
            "Available tools: " + ", ".join(tool_names) + ". "
            "If none of the tools can answer the question, respond with: "
            '"We don\'t have any internal tool to answer your question."\n'
            "NEVER answer from your own knowledge. ONLY use tool results."
        ),
    }
    messages = [system_msg] + messages

    def generate():
        # Tool-calling loop
        for _ in range(MAX_TOOL_ROUNDS):
            try:
                result = ai_chat_completion(messages, tools=openai_tools)
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
                data = tool_result.get("structuredContent")
                if data.get("force"):
                    yield sse_event("force", {"message": data["force"]})
                if data.get("table"):
                    yield sse_event("table", {"data": data.get("table")})
                for chart_item in data.get("charts", []):
                    yield sse_event("chart", {"data": chart_item, "error": None})

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
    """Serve the about page with MCP tools information."""
    try:
        mcp_tools = mcp_list_tools()
    except Exception as e:
        logger.error(f"Failed to fetch MCP tools for about page: {e}")
        mcp_tools = []

    return render_template("about.html", tools=mcp_tools)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logger.info(f"Webchat starting on http://{settings.WEBCHAT_HOST}:{settings.WEBCHAT_PORT}")
    logger.info(f"AI provider: {settings.AI_BASE_URL} (model: {settings.AI_MODEL})")
    logger.info(f"MCP server: {settings.MCP_URL}")
    app.run(host=settings.WEBCHAT_HOST, port=settings.WEBCHAT_PORT)

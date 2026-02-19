"""
Webchat - Simple chat UI that bridges an AI provider with MCP tools.

Dependencies: flask, httpx

AI provider is configurable via environment variables.
Any OpenAI-compatible API works (DeepSeek, OpenAI, Ollama, etc).
"""

import json
import os
import httpx
from flask import Flask, jsonify, request, send_from_directory

import settings


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
    """Parse an MCP response, handling both JSON and SSE formats."""
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
    resp = httpx.post(
        settings.MCP_URL,
        json={
            "jsonrpc": "2.0",
            "id": 0,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {"name": "webchat", "version": "1.0"},
            },
        },
        headers=_mcp_headers(),
        timeout=30,
    )
    # Store session ID from response header
    session_id = resp.headers.get("mcp-session-id")
    if session_id:
        _mcp_session_id = session_id
        print(f"[MCP] Session initialized: {_mcp_session_id}")

    # Send initialized notification
    httpx.post(
        settings.MCP_URL,
        json={"jsonrpc": "2.0", "method": "notifications/initialized"},
        headers=_mcp_headers(),
        timeout=10,
    )
    return _parse_mcp_response(resp)


def mcp_list_tools():
    """Fetch the tool list from the MCP server using streamable HTTP."""
    global _mcp_session_id
    # Initialize session if needed
    if not _mcp_session_id:
        mcp_initialize()

    resp = httpx.post(
        settings.MCP_URL,
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
        headers=_mcp_headers(),
        timeout=30,
    )
    data = _parse_mcp_response(resp)
    return data.get("result", {}).get("tools", [])


def mcp_call_tool(name, arguments):
    """Call a tool on the MCP server and return its result."""
    resp = httpx.post(
        settings.MCP_URL,
        json={
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        },
        headers=_mcp_headers(),
        timeout=60,
    )
    data = _parse_mcp_response(resp)
    result = data.get("result", {})
    content_list = result.get("content", [])
    parts = []
    for item in content_list:
        if item.get("type") == "text":
            parts.append(item["text"])
        else:
            parts.append(json.dumps(item))
    return "\n".join(parts) if parts else json.dumps(result)


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

    resp = httpx.post(
        f"{settings.AI_BASE_URL}/chat/completions",
        json=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.AI_API_KEY}",
        },
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.route("/")
def index():
    """Serve the chat HTML page."""
    return send_from_directory(os.path.dirname(__file__), "index.html")


@app.route("/chat", methods=["POST"])
def chat():
    """Handle a chat request: AI completion + MCP tool calling loop."""
    body = request.get_json()
    messages = body.get("messages", [])

    if not messages:
        return jsonify({"error": "No messages provided"}), 400

    if not settings.AI_API_KEY:
        return jsonify({"error": "settings.AI_API_KEY not configured"}), 500

    # Fetch available MCP tools
    try:
        mcp_tools = mcp_list_tools()
        print(f"[MCP] Found {len(mcp_tools)} tools: {[t['name'] for t in mcp_tools]}")
    except Exception as e:
        print(f"[MCP] ERROR connecting to MCP server: {e}")
        mcp_tools = []

    openai_tools = mcp_tools_to_openai_format(mcp_tools) if mcp_tools else None
    if openai_tools:
        print(f"[AI] Sending {len(openai_tools)} tools to {settings.AI_MODEL}")

    # Build system prompt telling the AI to use its tools
    tool_names = [t["name"] for t in mcp_tools] if mcp_tools else []
    system_msg = {
        "role": "system",
        "content": (
            "You are a specialized assistant that ONLY answers questions using the available tools. "
            "You MUST call at least one tool for every user question. "
            "Available tools: " + ", ".join(tool_names) + ". "
            "If none of the tools can answer the question, respond EXACTLY with: "
            "\"No estamos listos para responder tu pregunta, solo respondemos consultas sobre el BCIE.\"\n"
            "NEVER answer from your own knowledge. ONLY use tool results."
        ),
    }
    messages = [system_msg] + messages

    # Tool-calling loop
    for _ in range(MAX_TOOL_ROUNDS):
        try:
            result = ai_chat_completion(messages, tools=openai_tools)
        except httpx.HTTPStatusError as e:
            return jsonify({"error": f"AI provider error: {e.response.status_code}"}), 502

        choice = result["choices"][0]
        message = choice["message"]

        # If no tool calls, we're done
        tool_calls = message.get("tool_calls")
        if not tool_calls:
            print("[AI] Final response (no tool calls)")
            return jsonify({"reply": message.get("content", "")})

        # Append assistant message with tool calls
        print(f"[AI] Tool calls requested: {[tc['function']['name'] for tc in tool_calls]}")
        messages.append(message)

        # Execute each tool call via MCP
        for tc in tool_calls:
            fn = tc["function"]
            tool_name = fn["name"]
            try:
                tool_args = json.loads(fn["arguments"]) if fn["arguments"] else {}
            except json.JSONDecodeError:
                tool_args = {}

            try:
                tool_result = mcp_call_tool(tool_name, tool_args)
            except Exception as e:
                tool_result = f"Error calling tool: {e}"

            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": tool_result,
                }
            )

    return jsonify({"reply": "Maximum tool call rounds reached."})


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print(f"Webchat starting on http://{settings.WEBCHAT_HOST}:{settings.WEBCHAT_PORT}")
    print(f"AI provider: {settings.AI_BASE_URL} (model: {settings.AI_MODEL})")
    print(f"MCP server:  {settings.MCP_URL}")
    app.run(host=settings.WEBCHAT_HOST, port=settings.WEBCHAT_PORT)

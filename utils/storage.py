"""
The chat gateway records conversations/messages/tool calls here.
If a storage plugin is installed (entry point: ``mcp_chat_storage`` group)
we use it. Otherwise, a `NullStorage` placeholder takes over that does nothing.

Persistence must never break the chat: every call below is wrapped so a backend
error is logged and swallowed.
"""

import importlib.metadata

from utils.debug import logger

ENTRY_POINT_GROUP = "mcp_chat_storage"


class NullStorage:
    """Placeholder backend used when no storage plugin is installed.

    Does nothing and announces it, so the gateway can tell there is no
    conversation history being recorded.
    """

    name = "null"
    enabled = False

    def __init__(self, reason="no storage backend installed"):
        self.reason = reason

    def connect(self):
        logger.warning(
            f"Chat storage DISABLED ({self.reason}). "
            f"Conversations are NOT being persisted. Install a plugin "
            f"(e.g. mcp-chat-storage-sqlite) to enable history."
        )

    def ensure_conversation(self, *args, **kwargs):
        pass

    def save_message(self, *args, **kwargs):
        pass

    def save_tool_call(self, *args, **kwargs):
        pass


def _discover_backend():
    """Find an installed storage backend via entry points, else NullStorage."""
    try:
        eps = list(importlib.metadata.entry_points(group=ENTRY_POINT_GROUP))
    except Exception as e:  # very old metadata APIs, etc.
        logger.warning(f"Could not enumerate storage backends: {e}")
        eps = []

    if not eps:
        return NullStorage("no storage backend installed")

    # Simple initial version: install only one backend; the first wins.
    chosen = eps[0]
    if len(eps) > 1:
        others = ", ".join(ep.name for ep in eps)
        logger.warning(
            f"Multiple storage backends installed [{others}]; using "
            f"{chosen.name!r}."
        )

    try:
        backend_cls = chosen.load()
        # backend_cls will be a class: SqliteChatStorage, PostgresChatStorage or others
        return backend_cls()
    except Exception as e:
        logger.error(f"Failed to load storage backend {chosen.name!r}: {e}")
        return NullStorage(f"backend {chosen.name!r} failed to load")


def _init_storage():
    """Discover and connect a backend. Never raises."""
    backend = _discover_backend()
    try:
        backend.connect()
    except Exception as e:
        logger.error(
            f"Storage backend {getattr(backend, 'name', '?')!r} failed to "
            f"connect: {e}. Persistence disabled."
        )
        backend = NullStorage(f"backend connect failed: {e}")
        # NullStorage.connect only logs; safe to call.
        backend.connect()
    else:
        if getattr(backend, "enabled", True):
            logger.info(f"Chat storage ENABLED via backend {backend.name!r}.")
    return backend


_backend = _init_storage()


# ---------------------------------------------------------------------------
# Public facade — app.py calls these. All swallow backend errors.
# ---------------------------------------------------------------------------


def is_enabled():
    """True if conversations are actually being persisted."""
    return bool(getattr(_backend, "enabled", True)) and not isinstance(_backend, NullStorage)


def backend_name():
    return getattr(_backend, "name", "unknown")


def ensure_conversation(conversation_id, metadata=None):
    try:
        _backend.ensure_conversation(conversation_id, metadata)
    except Exception as e:
        logger.error(f"storage.ensure_conversation failed: {e}")


def save_message(conversation_id, turn_index, role, content, created_at):
    try:
        _backend.save_message(conversation_id, turn_index, role, content, created_at)
    except Exception as e:
        logger.error(f"storage.save_message failed: {e}")


def save_tool_call(conversation_id, turn_index, seq, tool_name, arguments, result, created_at):
    try:
        _backend.save_tool_call(
            conversation_id, turn_index, seq, tool_name, arguments, result, created_at
        )
    except Exception as e:
        logger.error(f"storage.save_tool_call failed: {e}")

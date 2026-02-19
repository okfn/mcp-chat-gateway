"sk-264e67c110bf4b5dba6161203bcf6d0c"
import os

AI_BASE_URL = "https://api.deepseek.com/v1"
AI_API_KEY = "BUY-ME"
AI_MODEL = "deepseek-chat"
MCP_URL = "http://127.0.0.1:8063/"
WEBCHAT_HOST = "127.0.0.1"
WEBCHAT_PORT = 8064


# Optionally override settings with local_settings.py (not committed to git)
try:
    from local_settings import *  # noqa: F401 F403
    print(" - Loaded settings from local_settings.py")
except ImportError:
    pass

# after all, if the use want to use env vars, we can also override settings with environment variables
AI_BASE_URL = os.getenv("AI_BASE_URL", AI_BASE_URL)
AI_API_KEY = os.getenv("AI_API_KEY", AI_API_KEY)
AI_MODEL = os.getenv("AI_MODEL", AI_MODEL)
MCP_URL = os.getenv("MCP_URL", MCP_URL)
WEBCHAT_HOST = os.getenv("WEBCHAT_HOST", WEBCHAT_HOST)
WEBCHAT_PORT = int(os.getenv("WEBCHAT_PORT", WEBCHAT_PORT))

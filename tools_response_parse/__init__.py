import json

def parse_tool_response(response):
    """
    Parses the response from a tool and returns the relevant information.
    If the MCP tool creators send specific instruction we want to be able to parse it.
    The IA is not trustworthy, we want to give some power to MCP tool creators.

    MCP has structured output so we need to parse here the ToolOutput to meet the
    requirements of the UI.

    """
    response_dict = json.loads(response)

    data = {}
    final_response = ""
    if response_dict.get("table"):
        data["table"] = True
        data["table_data"] = response_dict.get("table")
    if response_dict.get("force"):
        data["force"] = response_dict.get("force")
    if response_dict.get("chart"):
        data["charts"] = [response_dict.get("chart")]
    if response_dict.get("content"):
        final_response = response_dict["content"]
    return data, final_response

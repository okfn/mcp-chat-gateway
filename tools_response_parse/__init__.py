from tools_response_parse.force import parse_force_response
from tools_response_parse.table import parse_table_response
from tools_response_parse.chart import parse_chart_response


def parse_tool_response(response):
    """
    Parses the response from a tool and returns the relevant information.
    If the MCP tool creators send specific instruction we want to be able to parse it.
    The IA is not trustworthy, we want to give some power to MCP tool creators.

    All parsers will pass data: dict, response: str
    """
    data = {}
    final_response = response
    # ============= Force ========================
    # MCP toool creators can force to print something in the screen to help users
    data, final_response = parse_force_response(data, response)

    # ============= Tables ========================
    # MCP tool creators can send data for us to render tables.
    data, final_response = parse_table_response(data, final_response)

    # ============= Charts ========================
    # MCP tool creators can send data for us to render charts.
    data, final_response = parse_chart_response(data, final_response)

    # ============= Downloads ========================
    # TODO

    return data, final_response

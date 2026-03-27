import json
import re


def parse_table_response(data, response):
    """
    Extract from raw response all code in between <table> and </table>
    and put it in data['table'].
    """

    pattern = r'<table>(.*?)</table>'
    matches = re.findall(pattern, response, re.DOTALL)
    if matches:
        data['table'] = matches[0].strip()
        # Remove the <table>...</table> part from the response
        response = re.sub(pattern, '', response, flags=re.DOTALL).strip()

        # What we expect in data['table'] is valid JSON with a list of rows
        # First row is the header, and the rest are the data rows. For example:
        # [
        #   ["Name", "Age", "City"],
        #   ["Alice", 30, "New York"],
        #   ["Bob", 25, "Los Angeles"]
        # ]

        try:
            data['table_data'] = json.loads(data['table'])
        except json.JSONDecodeError:
            data['table_error'] = 'Error parsing table JSON'

    return data, response

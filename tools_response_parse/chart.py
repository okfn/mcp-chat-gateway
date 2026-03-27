import json
import re


def parse_chart_response(data, response):
    """
    Extract from raw response all code in between <chart> and </chart>
    and put it in data['chart'].

    Expected JSON format:
    {
        "type": "bar",
        "title": "Monthly Revenue",
        "labels": ["Jan", "Feb", "Mar"],
        "values": [100, 200, 150],
        "beginAtZero": false (default true),
        "color": "#75adec",
        "borderColor": "#111050"
    }
    """

    pattern = r'<chart>(.*?)</chart>'
    matches = re.findall(pattern, response, re.DOTALL)
    if matches:
        data['chart'] = matches[0].strip()
        # Remove the <chart>...</chart> part from the response
        response = re.sub(pattern, '', response, flags=re.DOTALL).strip()

        try:
            data['chart_data'] = json.loads(data['chart'])
        except json.JSONDecodeError:
            data['chart_error'] = 'Error parsing chart JSON'

    return data, response

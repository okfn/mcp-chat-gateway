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
        # Remove all <chart>...</chart> from the response
        response = re.sub(pattern, '', response, flags=re.DOTALL).strip()

        # Parse all charts
        charts = []
        for match in matches:
            try:
                charts.append(json.loads(match.strip()))
            except json.JSONDecodeError:
                pass

        if charts:
            # Keep backward compat: first chart in chart/chart_data
            data['chart'] = matches[0].strip()
            data['chart_data'] = charts[0]
            # All charts in charts list
            data['charts'] = charts
        else:
            data['chart_error'] = 'Error parsing chart JSON'

    return data, response

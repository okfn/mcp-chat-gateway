import re


def parse_force_response(data, response):
    """
    Extract from raw response all code in between <force> and </force>
    and put it in data['force'].
    """

    pattern = r'<force>(.*?)</force>'
    matches = re.findall(pattern, response, re.DOTALL)
    if matches:
        data['force'] = matches[0].strip()
        # Remove the <force>...</force> part from the response
        response = re.sub(pattern, '', response, flags=re.DOTALL).strip()
    return data, response

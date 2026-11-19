"""A local account worker must still be authorized when it begins a search."""
import json
import os
import re
from urllib.parse import urlsplit
from urllib.request import Request, HTTPRedirectHandler, ProxyHandler, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def authorize_search():
    if os.environ.get("PLOA_ACCOUNT_WORKER") != "1":
        return
    try:
        url = os.environ.get("PLOA_ACCOUNT_AUTH_URL", "")
        target = urlsplit(url)
        if target.scheme != "http" or target.hostname != "127.0.0.1" or target.username or target.password or target.path != "/api/cloud/panel/agent-authorize" or target.query or target.fragment:
            raise ValueError()
        token = os.environ.get("PLOA_ACCOUNT_AUTH_TOKEN", "")
        if not re.fullmatch(r"[a-f0-9]{64}", token):
            raise ValueError()
        request = Request(url, data=json.dumps({"modules": ["search"]}).encode(), method="POST", headers={"Content-Type": "application/json", "Origin": f"http://{target.netloc}", "x-ploa-agent-lease": token})
        # Local authorization never follows a redirect or an environment proxy.
        with build_opener(ProxyHandler({}), NoRedirect()).open(request, timeout=15) as response:
            if json.load(response).get("authorized") is not True:
                raise ValueError()
    except Exception:
        raise PermissionError("O acesso da conta não pôde ser confirmado. Entre novamente antes de iniciar a busca.") from None

#!/usr/bin/env python3
"""One-shot loopback OAuth helper for the Calendar Agent.

Obtains a Google refresh_token bound to YOUR OAuth client (not OAuth
Playground's), using the loopback redirect flow. Writes the result to
~/.config/agent-manager/google-oauth.json (client_id + client_secret +
refresh_token), which the calendar-agent token manager reads.

Prereq: add  http://localhost:8765/  to the OAuth client's
"Authorized redirect URIs" in Google Cloud Console first.

Reads client_id/client_secret from the existing google-oauth.json if present,
otherwise from CLIENT_ID / CLIENT_SECRET env vars.

Run it, open the printed URL in a browser on this machine, consent, done.
"""
import http.server
import json
import os
import secrets
import sys
import threading
import urllib.parse
import urllib.request
import webbrowser

PORT = 8765
REDIRECT_URI = f"http://localhost:{PORT}/"
SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    "https://www.googleapis.com/auth/calendar.events.freebusy",
    "https://www.googleapis.com/auth/calendar.events.readonly",
    "https://www.googleapis.com/auth/gmail.readonly",
]
CRED_PATH = os.environ.get(
    "GOOGLE_OAUTH_CREDENTIALS",
    os.path.expanduser("~/.config/agent-manager/google-oauth.json"),
)
AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"


def load_client():
    cid = os.environ.get("CLIENT_ID")
    csec = os.environ.get("CLIENT_SECRET")
    if cid and csec:
        return cid, csec
    if os.path.exists(CRED_PATH):
        with open(CRED_PATH) as f:
            d = json.load(f)
        if d.get("client_id") and d.get("client_secret"):
            return d["client_id"], d["client_secret"]
    sys.exit(
        f"No client credentials. Set CLIENT_ID/CLIENT_SECRET env vars or put "
        f"client_id/client_secret in {CRED_PATH}"
    )


CLIENT_ID, CLIENT_SECRET = load_client()
STATE = secrets.token_urlsafe(16)
_result = {}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        qs = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(qs)
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        if params.get("state", [None])[0] != STATE:
            self.wfile.write(b"<h1>State mismatch. Aborted.</h1>")
            return
        if "error" in params:
            _result["error"] = params["error"][0]
            self.wfile.write(b"<h1>Authorization failed. Check the terminal.</h1>")
            return
        _result["code"] = params.get("code", [None])[0]
        self.wfile.write(
            b"<h1>Done. You can close this tab and return to the terminal.</h1>"
        )

    def log_message(self, *args):
        pass


def exchange(code):
    data = urllib.parse.urlencode(
        {
            "code": code,
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "redirect_uri": REDIRECT_URI,
            "grant_type": "authorization_code",
        }
    ).encode()
    req = urllib.request.Request(TOKEN_ENDPOINT, data=data)
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def main():
    auth_url = AUTH_ENDPOINT + "?" + urllib.parse.urlencode(
        {
            "client_id": CLIENT_ID,
            "redirect_uri": REDIRECT_URI,
            "response_type": "code",
            "scope": " ".join(SCOPES),
            "access_type": "offline",
            "prompt": "consent",
            "state": STATE,
        }
    )
    server = http.server.HTTPServer(("localhost", PORT), Handler)
    print("\n1. Make sure  http://localhost:8765/  is an Authorized redirect URI")
    print("   on the OAuth client in Google Cloud Console.\n")
    print("2. Open this URL in a browser and grant consent:\n")
    print(auth_url + "\n")
    try:
        webbrowser.open(auth_url)
    except Exception:
        pass
    print("Waiting for the OAuth redirect on", REDIRECT_URI, "...")
    while "code" not in _result and "error" not in _result:
        server.handle_request()
    if "error" in _result:
        sys.exit("OAuth error: " + _result["error"])
    tok = exchange(_result["code"])
    if "refresh_token" not in tok:
        sys.exit(
            "No refresh_token in response (got: "
            + ", ".join(tok.keys())
            + "). Re-run; the consent must include prompt=consent + offline access."
        )
    os.makedirs(os.path.dirname(CRED_PATH), exist_ok=True)
    out = {
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "refresh_token": tok["refresh_token"],
    }
    with open(CRED_PATH, "w") as f:
        json.dump(out, f, indent=2)
    os.chmod(CRED_PATH, 0o600)
    print("\nrefresh_token obtained and written to", CRED_PATH)
    print("scopes granted:", tok.get("scope", "(none)"))


if __name__ == "__main__":
    main()

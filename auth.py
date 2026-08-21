"""Phase 1 authorization: identity comes from a header set by the nginx/SSO
layer in front of this app (X-Remote-User by default - see
"remote_user_header" in settings.toml), not from any login flow of our own.
The app trusts whatever identity the reverse proxy has already established.

Write access is a hardcoded allowlist of user ids (settings.toml ->
writer_users). Everyone else can read but not create/edit/delete. This is
intentionally simple - a later phase can replace is_writer()'s source (e.g.
an AD group lookup) without touching anything that calls it.
"""

from fastapi import HTTPException, Request

from config import settings


def get_current_user(request: Request) -> str:
    header_name = settings.get("remote_user_header", "X-Remote-User")
    user = request.headers.get(header_name)
    if user:
        return user
    # Local dev has no reverse proxy in front of it to set the header - fall
    # back to a configured dev identity so testing doesn't need one. Nothing
    # is configured for [production], so a missing header there fails
    # closed (401) instead of silently granting anonymous access.
    dev_user = settings.get("dev_user")
    if dev_user:
        return dev_user
    raise HTTPException(status_code=401, detail=f"Kein Benutzer erkannt ({header_name}-Header fehlt).")


def is_writer(user: str) -> bool:
    return user in settings.get("writer_users", [])


def require_writer(request: Request) -> str:
    user = get_current_user(request)
    if not is_writer(user):
        raise HTTPException(status_code=403, detail="Keine Schreibrechte für diesen Anwendungsfall.")
    return user
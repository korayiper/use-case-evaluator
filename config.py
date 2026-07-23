"""Central settings object, shared by db.py (and anything else that needs
config later). Values come from settings.toml (committed, non-secret) and
.secrets.toml (gitignored, credentials only) - see .secrets.toml.example.

Which [environment] section is active is controlled by ENV_FOR_DYNACONF
(defaults to "development"); set it to "production" to pick up the mssql
section. Any setting can also be overridden with an APP_-prefixed env var,
e.g. APP_DB_BACKEND=mssql, without touching either file - handy for one-off
overrides in a container/systemd unit.
"""

from dynaconf import Dynaconf

settings = Dynaconf(
    envvar_prefix="APP",
    settings_files=["settings.toml", ".secrets.toml"],
    environments=True,
)
from logging.config import fileConfig

from alembic import context

# Reuses the app's own settings-driven engine/URL construction (db.py, which
# reads settings.toml/.secrets.toml via config.py) instead of a separately
# maintained connection string in alembic.ini - so alembic always targets
# whichever database the app itself would connect to for the active
# ENV_FOR_DYNACONF environment.
import db
from models import metadata

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode - emits SQL to stdout instead of
    executing against a live connection, so no DBAPI driver is required."""
    context.configure(
        url=str(db._engine_url()),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode, against db.ENGINE - the same engine
    the app itself uses."""
    with db.ENGINE.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

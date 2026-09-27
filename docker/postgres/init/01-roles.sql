-- Creates the three data-agent roles the first time the compose Postgres volume starts (02 §6.2).
-- Passwords come from the container environment (root .env.example); psql's \getenv reads them.
-- `tda db bootstrap` then creates the schema and base grants, and `alembic upgrade head` runs as tda_owner.
-- Keep the literals below out of the server log, even if a statement fails (superuser session settings).
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
SET log_min_duration_statement = -1;

\getenv owner_pw TDA_OWNER_PASSWORD
\getenv writer_pw TDA_WRITER_PASSWORD
\getenv reader_pw TDA_READER_PASSWORD

SELECT format('CREATE ROLE tda_owner LOGIN PASSWORD %L', :'owner_pw')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tda_owner') \gexec
SELECT format('CREATE ROLE tda_writer LOGIN PASSWORD %L', :'writer_pw')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tda_writer') \gexec
SELECT format('CREATE ROLE tda_reader LOGIN PASSWORD %L', :'reader_pw')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tda_reader') \gexec

-- The owner creates the tda schema during bootstrap; the others only connect.
SELECT format('GRANT CREATE, CONNECT ON DATABASE %I TO tda_owner', current_database()) \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO tda_writer, tda_reader', current_database()) \gexec

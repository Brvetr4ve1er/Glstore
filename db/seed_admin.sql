-- ============================================================
-- Bootstrap: SUPER_ADMIN seed for Ghir Laffaire
-- Auto-runs on a fresh DB volume via docker-entrypoint-initdb.d
-- ============================================================
--
-- Owner credentials (set 2026-04-25):
--   email:    brvetr4veler@gmail.com
--   password: brveadmin
--
-- The hash below is bcrypt(rounds=12) of "brveadmin".
-- To rotate: python -c "import bcrypt; print(bcrypt.hashpw(b'NEW_PW', bcrypt.gensalt(12)).decode())"
-- and replace the value, then re-run:
--   docker compose exec db psql -U glstore -d glstore -f /docker-entrypoint-initdb.d/01-seed_admin.sql

INSERT INTO admin_users (
    email, password_hash, full_name, role, is_active,
    failed_attempts, locked_until
)
VALUES (
    'brvetr4veler@gmail.com',
    '$2b$12$6L8xFwx5kmZ1hG9wkyuGkuwbXT//MscYvozjtovtXfqm9hedl6GNW',
    'Store Owner',
    'SUPER_ADMIN',
    true,
    0,
    NULL
)
ON CONFLICT (email) DO UPDATE SET
    password_hash   = EXCLUDED.password_hash,
    is_active       = true,
    failed_attempts = 0,
    locked_until    = NULL,
    role            = EXCLUDED.role;

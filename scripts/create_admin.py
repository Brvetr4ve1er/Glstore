"""
Bootstrap an admin user.

Usage:
    python -m scripts.create_admin                         # interactive
    python -m scripts.create_admin admin@ghirlaffaire.dz   # email arg, password prompted
    python -m scripts.create_admin admin@x.dz S3cret!      # both args (CI only — leaves history)

Reads DATABASE_URL from environment (or api.core.config defaults).
Idempotent: re-runs UPDATE password if email already exists.
"""
import asyncio
import getpass
import sys
from uuid import uuid4

import bcrypt
from sqlalchemy import text

from api.core.db import SessionLocal


async def upsert_admin(email: str, password: str, role: str = "SUPER_ADMIN", name: str = "Store Owner") -> None:
    pw_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")

    async with SessionLocal() as db:
        # Try insert; if conflict, update password + reactivate.
        result = await db.execute(
            text(
                """
                INSERT INTO admin_users (id, email, password_hash, full_name, role, is_active,
                                         failed_attempts, locked_until)
                VALUES (:id, :email, :hash, :name, :role, true, 0, NULL)
                ON CONFLICT (email) DO UPDATE SET
                    password_hash   = EXCLUDED.password_hash,
                    is_active       = true,
                    failed_attempts = 0,
                    locked_until    = NULL,
                    role            = EXCLUDED.role
                RETURNING id, (xmax = 0) AS inserted
                """
            ),
            {
                "id":    uuid4(),
                "email": email.lower().strip(),
                "hash":  pw_hash,
                "name":  name,
                "role":  role,
            },
        )
        row = result.first()
        await db.commit()
        if row and row[1]:
            print(f"  CREATED admin: {email} (role={role})")
        else:
            print(f"  UPDATED admin: {email} — password reset, account unlocked")


def main() -> None:
    email = sys.argv[1] if len(sys.argv) > 1 else input("Email: ").strip()
    if len(sys.argv) > 2:
        password = sys.argv[2]
    else:
        password = getpass.getpass("Password: ")
        confirm  = getpass.getpass("Confirm:  ")
        if password != confirm:
            print("ERROR: passwords do not match", file=sys.stderr)
            sys.exit(1)

    if len(password) < 8:
        print("ERROR: password must be at least 8 characters", file=sys.stderr)
        sys.exit(1)

    asyncio.run(upsert_admin(email, password))


if __name__ == "__main__":
    main()

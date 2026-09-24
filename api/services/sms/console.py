"""Development SMS sender: writes the message to the local terminal.

`print` to stderr, never the logger — the logger is what ships to log drains,
and a one-time code in a log drain is a credential in a log drain.
`get_sms_sender()` refuses to build this outside local development.
"""
from __future__ import annotations

import sys


class ConsoleSender:
    async def send(self, to_e164: str, body: str) -> None:
        print(f"\n[sms:console] -> {to_e164}\n    {body}\n", file=sys.stderr, flush=True)

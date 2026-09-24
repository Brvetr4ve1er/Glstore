"""The financing admin screens must not inherit the image queue's defect.

Audit Critical #3: the image review queue shipped approve / reject / primary
buttons that were icons only, with no accessible name. The financing queue is
the third screen built on that pattern, and the first carrying credit
decisions — so the rule is asserted, not remembered:

  · every button has visible text or an aria-label
  · every icon inside a button is aria-hidden (its text already names it)

Static, over the TSX source: there is no browser or DOM in this suite.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

ADMIN = Path(__file__).resolve().parents[1] / "admin" / "src"
SCREENS = [
    ADMIN / "pages" / "FinancingQueue.tsx",
    ADMIN / "pages" / "FinancingApplication.tsx",
    ADMIN / "pages" / "FinancingRules.tsx",
    ADMIN / "components" / "FinancingBits.tsx",
    ADMIN / "pages" / "Partners.tsx",
]

_OPEN = re.compile(r"<(Button|button)\b")
_SELF_CLOSING_TAG = re.compile(r"<[A-Z]\w*\b[^<>]*?/>", re.S)
_ICON = re.compile(r"<(?P<name>[A-Z]\w*)\b(?P<attrs>[^<>]*?)/>", re.S)
_NOT_ICONS = {"Spinner"}


def _buttons(path: Path) -> list[tuple[str, str]]:
    """(opening-tag attributes, children) for every button in the file.

    A scanner, not a regex: handlers like `onClick={() => { if (…) { … } }}`
    nest braces arbitrarily deep, and a regex that cannot follow them skips
    those buttons silently — exactly the ones a guard must not miss.
    """
    src = path.read_text(encoding="utf-8")
    found = []
    for m in _OPEN.finditer(src):
        tag, i, depth = m.group(1), m.end(), 0
        while i < len(src):
            c = src[i]
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
            elif c == ">" and depth == 0:
                break
            i += 1
        attrs = src[m.end():i]
        if attrs.rstrip().endswith("/"):
            found.append((attrs, ""))
            continue
        close = src.index(f"</{tag}>", i)
        found.append((attrs, src[i + 1:close]))
    return found


@pytest.mark.parametrize("path", SCREENS, ids=lambda p: p.name)
def test_every_button_has_an_accessible_name(path):
    for attrs, body in _buttons(path):
        visible = _SELF_CLOSING_TAG.sub("", body).strip()
        if not visible:
            assert "aria-label" in attrs, f"{path.name}: icon-only button without aria-label:\n{attrs[:200]}"


@pytest.mark.parametrize("path", SCREENS, ids=lambda p: p.name)
def test_icons_inside_buttons_are_decorative(path):
    for _, body in _buttons(path):
        for icon in _ICON.finditer(body):
            if icon.group("name") in _NOT_ICONS:
                continue
            assert 'aria-hidden="true"' in icon.group("attrs"), (
                f"{path.name}: <{icon.group('name')}> inside a button is not aria-hidden"
            )


ALL_ADMIN = sorted(ADMIN.rglob("*.tsx"))


@pytest.mark.parametrize("path", ALL_ADMIN, ids=lambda p: p.name)
def test_every_admin_button_has_an_accessible_name(path):
    """The naming rule, console-wide. The Phase F re-audit found audit
    Critical #3 still open — the image queue's compact card kept its three
    icon-only buttons — plus seven more unnamed icons (zoom, close, reset)
    on screens this guard did not cover."""
    for attrs, body in _buttons(path):
        visible = _SELF_CLOSING_TAG.sub("", body).strip()
        if not visible:
            assert "aria-label" in attrs, f"{path.name}: icon-only button without aria-label:\n{attrs[:200]}"


def test_the_console_wide_scan_is_not_vacuous():
    assert sum(len(_buttons(p)) for p in ALL_ADMIN) > 140


def test_the_login_password_toggle_is_reachable_and_named():
    """Audit Critical #4: the toggle had tabIndex={-1} and no name."""
    login = (ADMIN / "pages" / "Login.tsx").read_text(encoding="utf-8")
    assert "tabIndex={-1}" not in login
    assert "aria-label={showPw ?" in login
    assert 'htmlFor="admin-password"' in login and 'id="admin-password"' in login
    assert 'role="alert"' in login


def test_field_errors_are_described():
    """Audit Critical #2: an error shown under a field is tied to it."""
    ui = (ADMIN / "components" / "ui.tsx").read_text(encoding="utf-8")
    assert ui.count("aria-describedby={error ? `${fieldId}-error` : undefined}") == 2
    assert ui.count("id={`${fieldId}-error`}") == 2


def test_the_shared_modal_is_a_real_dialog():
    """Audit High #5: every admin dialog is this Modal, and it had no dialog
    role, no focus management and no way out by keyboard."""
    ui = (ADMIN / "components" / "ui.tsx").read_text(encoding="utf-8")
    modal = ui[ui.index("function useDialogFocus"):ui.index("// ── EmptyState")]
    for needle in ('role="dialog"', 'aria-modal="true"', "aria-labelledby={titleId}", "id={titleId}",
                   "e.key === 'Escape'", "e.key !== 'Tab'", "opener?.focus?.()"):
        assert needle in modal, needle


def test_error_boundaries_announce_themselves():
    """Audit High #6: the crash fallback was silent to a screen reader."""
    for app in ("admin", "storefront"):
        eb = (ADMIN.parents[1] / app / "src" / "components" / "ErrorBoundary.tsx").read_text(encoding="utf-8")
        assert 'role="alert"' in eb, app


def test_admin_honours_reduced_motion():
    """Audit High #8: the admin had no reduced-motion accommodation."""
    app = (ADMIN / "App.tsx").read_text(encoding="utf-8")
    css = (ADMIN / "index.css").read_text(encoding="utf-8")
    assert '<MotionConfig reducedMotion="user">' in app
    assert "prefers-reduced-motion: reduce" in app and "prefers-reduced-motion: reduce" in css


def test_the_scan_finds_every_button_including_ones_with_deep_handlers():
    """Exact counts ON PURPOSE: a scanner that silently skips a button is how
    the two above would pass while missing it. Adding a button fails this —
    confirm the new one is found and named, THEN update the number."""
    counts = {p.name: len(_buttons(p)) for p in SCREENS}
    assert counts["FinancingRules.tsx"] == 8, counts
    assert counts["FinancingApplication.tsx"] == 11, counts


def test_status_filters_expose_their_state():
    assert "aria-pressed={active}" in (ADMIN / "components" / "FinancingBits.tsx").read_text(encoding="utf-8")


def test_form_labels_are_tied_to_their_fields():
    """An unassociated <label> is only text; the field above it has no name."""
    ui = (ADMIN / "components" / "ui.tsx").read_text(encoding="utf-8")
    assert ui.count("htmlFor={fieldId}") == 3
    assert ui.count("id={fieldId}") >= 3


def test_the_shared_modal_close_button_is_named():
    assert 'aria-label="Fermer"' in (ADMIN / "components" / "ui.tsx").read_text(encoding="utf-8")

"""Spreadsheet-safe CSV cells (OWASP "CSV injection").

Excel, LibreOffice and Sheets evaluate a text cell that starts with `=`,
`+`, `-`, `@`, TAB or CR as a formula. Several exported columns carry text
taken from mail (sender names, addresses, labels, AI reasons), so a crafted
sender name such as `=HYPERLINK(...)` would run when the export is opened.
`row()` prefixes such a string cell with a single quote, which spreadsheets
read as "this is text"; numbers and empty cells pass through unchanged. A
trigger right after a `;` gets the quote too: European Excel splits a comma
.csv on `;` as well, and the part after it would start a formula.
"""

from __future__ import annotations

import re

TRIGGERS = ("=", "+", "-", "@", "\t", "\r")
# European Excel splits a comma .csv on `;` as well, so `x;=1+1` would open as
# two cells, the second one a formula: the same apostrophe goes after a `;`
_AFTER_SEMICOLON = re.compile(r";(?=[=+\-@\t\r])")


def cell(value):
    """One CSV cell: a string starting with a trigger character gets a
    leading `'`; anything else (ints and floats included, so a negative
    number stays a number) is returned as it is."""
    if isinstance(value, str):
        value = _AFTER_SEMICOLON.sub(";'", value)
        if value.startswith(TRIGGERS):
            return "'" + value
    return value


def row(values) -> list:
    """`cell()` applied to every value of one CSV row."""
    return [cell(v) for v in values]

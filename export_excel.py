"""Build an .xlsx workbook of prioritized use cases for download via
GET /api/export/prioritized.xlsx (see app.py) - the counterpart to
import_excel.py's CLI-driven Excel -> app import.
"""

import io

from openpyxl import Workbook
from openpyxl.utils import get_column_letter

COLUMNS = [
    ("Name", "name"),
    ("Ideengeber", "idea_initiator"),
    ("Nutzungskategorie", "use_category_label"),
    ("Wirtschaftlicher Nutzen", "economic_value_label"),
    ("Priorität", "priority"),
    ("Entwicklungsdauer", "development_time_label"),
    ("Go-Live", "golive_date"),
    ("Priorisiert", "prioritized_round"),
]


def build_prioritized_workbook(use_cases: list[dict]) -> io.BytesIO:
    wb = Workbook()
    ws = wb.active
    ws.title = "Priorisiert"

    headers = [label for label, _ in COLUMNS]
    ws.append(headers)
    for cell in ws[1]:
        cell.font = cell.font.copy(bold=True)

    for uc in use_cases:
        ws.append([uc.get(key) or "" for _, key in COLUMNS])

    # Rough auto-width: widest of the header or any cell in that column,
    # capped so one long name doesn't blow out the whole sheet.
    for i, (label, key) in enumerate(COLUMNS, start=1):
        widest = max([len(label)] + [len(str(uc.get(key) or "")) for uc in use_cases], default=len(label))
        ws.column_dimensions[get_column_letter(i)].width = max(12, min(45, widest + 2))

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return buffer

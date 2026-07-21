"""Scoring rules for AI use cases.

Each ordinal attribute has a fixed set of allowed values, each worth a fixed
number of points. Priority is simply the sum of the four points. German
display labels live here too, so the frontend has a single source of truth
for both the scoring and the German UI text.
"""

from collections import OrderedDict

# value -> points
VALUE_ADDED = OrderedDict([
    ("high", 5),
    ("medium", 3),
    ("low", 1),
])
VALUE_ADDED_LABELS = {"high": "Hoch", "medium": "Mittel", "low": "Tief"}
# Decision-support text shown to the user when choosing a class.
VALUE_ADDED_HELP = {
    "high": (
        "Mehr als 300 User profitieren von dem Use Case (Qualität/Zeitersparnis) oder "
        "durch den Use Case können mind. 1-2 Personalressourcen effektiv abgebaut werden."
    ),
    "medium": (
        "Mehr als 100 User profitieren von dem Use Case (Qualität/Zeitersparnis) und "
        "können dadurch massgebliche Zeit einsparen. Ein Abbau von Personalressourcen ist "
        "aber aufgrund der verteilten Einsparung nicht möglich."
    ),
    "low": (
        "Nur wenige User profitieren. Die Optimierung für den Einzelnen kann dabei gross "
        "sein, bleibt aber für die Bank unbedeutend."
    ),
}

# value -> (points, months) - months is used to place the use case on the
# timeline (start = golive_date - months).
DEVELOPMENT_TIME = OrderedDict([
    ("24 months", (1, 24)),
    ("12 months", (2, 12)),
    ("9 months", (3, 9)),
    ("6 months", (4, 6)),
    ("3 months", (5, 3)),
])
DEVELOPMENT_TIME_LABELS = {
    "24 months": "24 Monate",
    "12 months": "12 Monate",
    "9 months": "9 Monate",
    "6 months": "6 Monate",
    "3 months": "3 Monate",
}
DEVELOPMENT_TIME_DESCRIPTION = (
    "Als Entwicklungszeit wird die Dauer von Initial bis Einführung als Gesamtprojekt "
    "verstanden. (Inhaltliche Scope Klärung, Aufbau der Datenbasis, Technische "
    "Implementierung, Pilotierung und Roll-Out/Betriebliche Übergabe für Pflege und "
    "Unterhalt.)"
)
# Decision-support text shown to the user when choosing a class.
DEVELOPMENT_TIME_HELP = {
    "3 months": (
        "Einfache Einführung, aufbauend auf schon vorhandener Infrastruktur mit "
        "erfolgter Risikoabklärung. Sehr geringe Datenkomplexität etc."
    ),
    "6 months": (
        "Einführung begleitend, teilweise noch notwendige Risikoabklärung aber auch auf "
        "vorhandener Infrastruktur. Geringe Datenkomplexität etc."
    ),
    "9 months": (
        "Erste fehlende Infrastrukturkomponenten, Klärung durch Business tier/mittel. "
        "Testphase notwendig etc."
    ),
    "12 months": "Businesskomplexität mittel, fehlende Infrastrukturkomponenten etc.",
    "24 months": (
        "Komplexe Daten, fehlende Infrastruktur, hoher Abklärungsbedarf auf "
        "nichtfunktionalen Anforderungen, Businesskomplexität hoch etc."
    ),
}

PROCESS_CRITICALITY = OrderedDict([
    ("bcm_relevant", 1),
    ("high", 2),
    ("medium", 3),
    ("low", 4),
])
PROCESS_CRITICALITY_LABELS = {
    "bcm_relevant": "BCM-relevant",
    "high": "Hoch",
    "medium": "Mittel",
    "low": "Tief",
}
PROCESS_CRITICALITY_DESCRIPTION = (
    "Durch die Funktion werden kritische Prozesse tangiert. Ein Ausfall hat "
    "Konsequenzen die man alternativ auffangen muss. Ein längerer Funktionsausfall hat "
    "schwerwiegende Folgen."
)
# Decision-support text shown to the user when choosing a class.
PROCESS_CRITICALITY_HELP = {
    "low": "Keine Kritikalität.",
    "medium": "Ein Ausfall bedeutet kurzfristig Mehraufwand, kann aber gut verkraftet werden.",
    "high": (
        "Ein Ausfall führt zu erheblichen Einschränkungen auf dem Prozess und es muss "
        "mit Verzögerung bis zu Kundenauswirkungen gerechnet werden."
    ),
    "bcm_relevant": (
        "Die Funktion muss sehr zeitnah wieder sichergestellt sein, respektive eine "
        "Alternative bei Ausfall muss sofort gezogen werden können."
    ),
}

PROCESS_DEPENDENCY = OrderedDict([
    ("high", 1),
    ("medium", 2),
    ("low", 3),
    ("none", 4),
])
PROCESS_DEPENDENCY_LABELS = {"high": "Hoch", "medium": "Mittel", "low": "Tief", "none": "Keine"}
PROCESS_DEPENDENCY_DESCRIPTION = (
    "Die Integration und die Abhängigkeit von vielen Faktoren, Daten, Annahmen, "
    "Parametrierungen, Unsicherheiten sind vorhanden. Somit ist die Funktion und ihre "
    "Güte von sehr vielen Einflussfaktoren geprägt und muss laufend überwacht werden."
)
# Decision-support text shown to the user when choosing a class.
PROCESS_DEPENDENCY_HELP = {
    "none": "Es bestehen keine Abhängigkeiten.",
    "low": "Es bestehen geringe Abhängigkeiten mit unwesentlichem Einfluss auf das Ergebnis.",
    "medium": (
        "Es bestehen Abhängigkeiten die gepflegt sein müssen aber kontrollierbar und "
        "steuerbar sind."
    ),
    "high": (
        "Neue KI-Versionen, Änderungen der Datenquellen, Qualitätsmängel bei Daten, "
        "Interpretationen von Daten führen zu vielen Fragen bezüglich dem Ergebnis, "
        "welches nur wertvoll und brauchbar ist, wenn alle Zahnräder ineinander greifen."
    ),
}

# Purely descriptive - not part of the priority score.
USE_CATEGORY = OrderedDict([
    ("basis-ki", "Basis-KI"),
    ("ki-werkzeuge", "KI-Werkzeuge"),
    ("passiver agent", "Passiver Assistent"),
    ("reaktiver agent", "Reaktiver Agent"),
    ("autonomer agent", "Autonomer Agent"),
])
# No decision-support text defined yet for this attribute.
USE_CATEGORY_HELP = {}

# Whether the idea is achievable with today's AI at all, as opposed to
# science fiction. Always worth 0 points - it never contributes to the
# priority score, unlike the four scored attributes above. Best-to-worst
# order, used to rank/color the class in the UI (points can't do that job
# here since they're all 0).
AI_FEASIBILITY = OrderedDict([
    ("high", 0),
    ("medium", 0),
    ("low", 0),
])
AI_FEASIBILITY_LABELS = {"high": "Hoch", "medium": "Mittel", "low": "Tief"}
AI_FEASIBILITY_RANK = {"high": 3, "medium": 2, "low": 1}
AI_FEASIBILITY_DESCRIPTION = "Die KI-Fachstelle beurteilt die KI-Umsetzungschancen der Idee."
# Decision-support text shown to the user when choosing a class.
AI_FEASIBILITY_HELP = {
    "high": (
        "Die Idee ist mit heutigen KI-Technologien technisch gut umsetzbar. Das "
        "angestrebte Ergebnis ist realistisch erreichbar."
    ),
    "medium": (
        "Die Idee ist grundsätzlich umsetzbar, erfordert jedoch zusätzliche "
        "Voraussetzungen, Kompromisse oder einen erhöhten technischen Aufwand."
    ),
    "low": (
        "Die Idee ist mit den heute verfügbaren KI-Technologien nicht oder nur in "
        "unzureichender Qualität realisierbar."
    ),
}

MIN_PRIORITY = (
    min(VALUE_ADDED.values())
    + min(p for p, _ in DEVELOPMENT_TIME.values())
    + min(PROCESS_CRITICALITY.values())
    + min(PROCESS_DEPENDENCY.values())
)
MAX_PRIORITY = (
    max(VALUE_ADDED.values())
    + max(p for p, _ in DEVELOPMENT_TIME.values())
    + max(PROCESS_CRITICALITY.values())
    + max(PROCESS_DEPENDENCY.values())
)


def development_months(value: str) -> int:
    return DEVELOPMENT_TIME[value][1]


def points(value_added: str, development_time: str, process_criticality: str, process_dependency: str) -> int:
    return (
        VALUE_ADDED[value_added]
        + DEVELOPMENT_TIME[development_time][0]
        + PROCESS_CRITICALITY[process_criticality]
        + PROCESS_DEPENDENCY[process_dependency]
    )


def labels_for(
    value_added, development_time, process_criticality, process_dependency, use_category, ai_feasibility
) -> dict:
    return {
        "value_added_label": VALUE_ADDED_LABELS[value_added],
        "development_time_label": DEVELOPMENT_TIME_LABELS[development_time],
        "process_criticality_label": PROCESS_CRITICALITY_LABELS[process_criticality],
        "process_dependency_label": PROCESS_DEPENDENCY_LABELS[process_dependency],
        "use_category_label": USE_CATEGORY[use_category],
        "ai_feasibility_label": AI_FEASIBILITY_LABELS[ai_feasibility],
    }


def options_payload() -> dict:
    """Attribute options for the frontend: value, German label, point value,
    (for development_time) duration in months, and optional decision-support
    help text explaining when to pick that class."""
    return {
        "value_added": [
            {"value": k, "label": VALUE_ADDED_LABELS[k], "points": v, "help": VALUE_ADDED_HELP.get(k)}
            for k, v in VALUE_ADDED.items()
        ],
        "development_time": [
            {
                "value": k,
                "label": DEVELOPMENT_TIME_LABELS[k],
                "points": p,
                "months": m,
                "help": DEVELOPMENT_TIME_HELP.get(k),
            }
            for k, (p, m) in DEVELOPMENT_TIME.items()
        ],
        "process_criticality": [
            {
                "value": k,
                "label": PROCESS_CRITICALITY_LABELS[k],
                "points": v,
                "help": PROCESS_CRITICALITY_HELP.get(k),
            }
            for k, v in PROCESS_CRITICALITY.items()
        ],
        "process_dependency": [
            {
                "value": k,
                "label": PROCESS_DEPENDENCY_LABELS[k],
                "points": v,
                "help": PROCESS_DEPENDENCY_HELP.get(k),
            }
            for k, v in PROCESS_DEPENDENCY.items()
        ],
        "use_category": [
            {"value": k, "label": v, "help": USE_CATEGORY_HELP.get(k)} for k, v in USE_CATEGORY.items()
        ],
        "ai_feasibility": [
            {
                "value": k,
                "label": AI_FEASIBILITY_LABELS[k],
                "points": v,
                "rank": AI_FEASIBILITY_RANK[k],
                "help": AI_FEASIBILITY_HELP.get(k),
            }
            for k, v in AI_FEASIBILITY.items()
        ],
        "descriptions": {
            "development_time": DEVELOPMENT_TIME_DESCRIPTION,
            "process_criticality": PROCESS_CRITICALITY_DESCRIPTION,
            "process_dependency": PROCESS_DEPENDENCY_DESCRIPTION,
            "ai_feasibility": AI_FEASIBILITY_DESCRIPTION,
        },
        "min_priority": MIN_PRIORITY,
        "max_priority": MAX_PRIORITY,
    }
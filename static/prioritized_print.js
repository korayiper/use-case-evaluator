(() => {
  "use strict";

  const { el, formatDate } = Common;

  // Plain text, no colored chips - this is meant to be printed/saved as a
  // PDF, and chip background colors either burn ink unnecessarily or (more
  // likely) print invisibly if the browser's "background graphics" print
  // option is off, leaving blank cells. Plain text has neither problem.
  async function load() {
    const useCases = await fetch(`${window.API_BASE}/use-cases`).then((r) => r.json());
    const prioritized = useCases.filter((uc) => uc.status === "priorisiert").sort((a, b) => b.priority - a.priority);

    el("print-summary").textContent = `${prioritized.length} priorisierte Anwendungsfälle`;
    el("print-empty").hidden = prioritized.length > 0;

    const tbody = el("print-tbody");
    tbody.innerHTML = "";
    for (const uc of prioritized) {
      const tr = document.createElement("tr");
      for (const value of [
        uc.name,
        uc.idea_initiator,
        uc.use_category_label,
        uc.economic_value_label,
        uc.priority,
        uc.development_time_label,
        formatDate(uc.golive_date),
        uc.prioritized_round || "–",
      ]) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  el("print-btn").addEventListener("click", () => window.print());

  load();
})();

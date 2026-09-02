(() => {
  "use strict";

  const { el, textColorFor, statusColorForPoints, categoryColor } = Common;

  const STAGE_LABELS = { prioboard: "Phase: Prio-Board", board_of_management: "Phase: GL" };

  const state = {
    options: null,
    board: [],
    stage: "prioboard",
    currentUser: null,
    isWriter: false,
    isPrioboard: false,
    isDirector: false,
    canReorder: false,
    dragIndex: null,
  };

  async function loadCurrentUser() {
    const res = await fetch(`${window.API_BASE}/me`);
    const data = await res.json();
    state.currentUser = data.user;
    state.isWriter = data.is_writer;
    state.isPrioboard = data.is_prioboard;
    state.isDirector = data.is_director;
  }

  async function loadOptions() {
    const res = await fetch(`${window.API_BASE}/options`);
    state.options = await res.json();
  }

  // Voting happens on the use-case detail page now (every use case, not
  // just today's board contents) - this page is purely about ranking the
  // writer-curated session candidates.
  async function loadBoard() {
    const res = await fetch(`${window.API_BASE}/board`);
    const data = await res.json();
    state.stage = data.stage;
    state.board = data.use_cases;
    state.canReorder =
      (state.stage === "prioboard" && state.isPrioboard) ||
      (state.stage === "board_of_management" && state.isDirector);
    render();
  }

  async function persistOrder() {
    await fetch(`${window.API_BASE}/board/reorder`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ordered_ids: state.board.map((uc) => uc.id) }),
    });
  }

  // Same permission and endpoint as the list/detail page's session-candidate
  // toggle - writer-curated, not a prioboard/reorder action - just exposed
  // directly here so removing an obvious non-fit doesn't require a trip to
  // the detail page.
  async function removeFromBoard(uc) {
    if (!confirm(`"${uc.name}" von der Priorisierung entfernen?`)) return;
    const res = await fetch(`${window.API_BASE}/use-cases/${uc.id}/session-candidate`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidate: false }),
    });
    if (!res.ok) {
      await reportError(res, "Konnte nicht entfernt werden.");
      return;
    }
    await loadBoard();
  }

  async function reportError(res, fallback) {
    const body = await res.json().catch(() => ({}));
    alert(body.detail || fallback);
  }

  async function handoff() {
    const res = await fetch(`${window.API_BASE}/board/handoff`, { method: "PUT" });
    if (!res.ok) {
      await reportError(res, "Konnte nicht an die GL übergeben werden.");
      return;
    }
    await loadBoard();
  }

  async function finalize() {
    if (!confirm("Priorisierung jetzt abschliessen? Alle aktuellen Kandidaten werden als priorisiert markiert.")) {
      return;
    }
    const res = await fetch(`${window.API_BASE}/board/finalize`, { method: "PUT" });
    if (!res.ok) {
      await reportError(res, "Konnte die Priorisierung nicht abschliessen.");
      return;
    }
    await loadBoard();
  }

  function renderStageBar() {
    el("board-stage-chip").textContent = STAGE_LABELS[state.stage] || state.stage;
    el("board-handoff-btn").hidden = !(state.stage === "prioboard" && state.isPrioboard);
    el("board-finalize-btn").hidden = !(state.stage === "board_of_management" && state.isDirector);
    el("board-hint").hidden = !state.canReorder;
  }

  function render() {
    renderStageBar();
    const list = el("board-list");
    list.innerHTML = "";
    el("board-summary").textContent = `${state.board.length} Anwendungsfälle`;
    const empty = el("board-empty");
    empty.hidden = state.board.length > 0;
    if (!state.board.length) return;

    const { min_priority: minP, max_priority: maxP } = state.options;

    state.board.forEach((uc, index) => {
      const tr = document.createElement("tr");
      tr.className = "board-row";
      tr.draggable = state.canReorder;

      const rankTd = document.createElement("td");
      rankTd.className = "board-rank";
      rankTd.textContent = index + 1;
      tr.appendChild(rankTd);

      const nameTd = document.createElement("td");
      nameTd.className = "name-cell";
      nameTd.title = uc.name;
      const nameLink = document.createElement("a");
      nameLink.className = "table-link";
      nameLink.href = `${window.ROOT_PATH}/use-case/${uc.id}`;
      nameLink.textContent = uc.name;
      nameTd.appendChild(nameLink);
      tr.appendChild(nameTd);

      const categoryTd = document.createElement("td");
      const categoryChip = document.createElement("span");
      categoryChip.className = "chip attr-chip";
      const catColor = categoryColor(uc.use_category, state.options.use_category);
      categoryChip.style.background = catColor;
      categoryChip.style.color = textColorFor(catColor);
      categoryChip.textContent = uc.use_category_label;
      categoryTd.appendChild(categoryChip);
      tr.appendChild(categoryTd);

      const devTimeTd = document.createElement("td");
      const devTimeChip = document.createElement("span");
      devTimeChip.className = "chip attr-chip";
      const devTimeColor = statusColorForPoints(uc.development_time_points, state.options.development_time);
      devTimeChip.style.background = devTimeColor;
      devTimeChip.style.color = textColorFor(devTimeColor);
      devTimeChip.textContent = uc.development_time_label;
      devTimeTd.appendChild(devTimeChip);
      tr.appendChild(devTimeTd);

      const priorityTd = document.createElement("td");
      const priorityChip = document.createElement("span");
      priorityChip.className = "chip priority-chip";
      const pColor = Common.priorityColor(uc.priority, minP, maxP);
      priorityChip.style.background = pColor;
      priorityChip.style.color = textColorFor(pColor);
      priorityChip.textContent = uc.priority;
      priorityTd.appendChild(priorityChip);
      tr.appendChild(priorityTd);

      const evTd = document.createElement("td");
      const evChip = document.createElement("span");
      evChip.className = "chip attr-chip";
      // Color by the matched option's own fixed points, not the raw vote
      // median (uc.economic_value_points) - the median only rounds to
      // this label, it isn't it, so using it directly could color two
      // chips both reading e.g. "Hoch" differently.
      const evOpt = state.options.economic_value.find((o) => o.label === uc.economic_value_label);
      const evColor = statusColorForPoints(evOpt ? evOpt.points : uc.economic_value_points, state.options.economic_value);
      evChip.style.background = evColor;
      evChip.style.color = textColorFor(evColor);
      evChip.textContent = uc.economic_value_label;
      evTd.appendChild(evChip);
      tr.appendChild(evTd);

      const importantTd = document.createElement("td");
      if (uc.is_important) {
        const importantChip = document.createElement("span");
        importantChip.className = "chip status-chip";
        importantChip.textContent = `Wichtig (${uc.important_departments.length}/6)`;
        importantChip.title = uc.important_departments.join(", ");
        importantTd.appendChild(importantChip);
      } else {
        importantTd.textContent = "–";
        importantTd.className = "muted-text";
      }
      tr.appendChild(importantTd);

      const actionsTd = document.createElement("td");
      if (state.isWriter) {
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "btn btn-ghost";
        removeBtn.textContent = "Entfernen";
        removeBtn.addEventListener("click", () => removeFromBoard(uc));
        actionsTd.appendChild(removeBtn);
      }
      tr.appendChild(actionsTd);

      if (state.canReorder) {
        tr.addEventListener("dragstart", () => {
          state.dragIndex = index;
        });
        tr.addEventListener("dragover", (e) => e.preventDefault());
        tr.addEventListener("drop", async (e) => {
          e.preventDefault();
          if (state.dragIndex === null || state.dragIndex === index) return;
          const [moved] = state.board.splice(state.dragIndex, 1);
          state.board.splice(index, 0, moved);
          state.dragIndex = null;
          render();
          await persistOrder();
        });
      }

      list.appendChild(tr);
    });
  }

  (async function init() {
    await loadCurrentUser();
    await loadOptions();
    el("board-handoff-btn").addEventListener("click", handoff);
    el("board-finalize-btn").addEventListener("click", finalize);
    await loadBoard();
  })();
})();
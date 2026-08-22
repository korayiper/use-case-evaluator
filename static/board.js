(() => {
  "use strict";

  const { el, textColorFor, statusColorForPoints, categoryColor } = Common;

  const state = {
    options: null,
    board: [],
    currentUser: null,
    isPrioboard: false,
    isDirector: false,
    canReorder: false,
    dragIndex: null,
  };

  async function loadCurrentUser() {
    const res = await fetch(`${window.API_BASE}/me`);
    const data = await res.json();
    state.currentUser = data.user;
    state.isPrioboard = data.is_prioboard;
    state.isDirector = data.is_director;
    state.canReorder = state.isPrioboard || state.isDirector;
    el("board-hint").hidden = !state.canReorder;
  }

  async function loadOptions() {
    const res = await fetch(`${window.API_BASE}/options`);
    state.options = await res.json();
  }

  async function loadBoard() {
    const res = await fetch(`${window.API_BASE}/board`);
    state.board = await res.json();
    render();
  }

  function myVoteValue(uc) {
    const mine = uc.votes.find((v) => v.voter === state.currentUser);
    return mine ? mine.value : "";
  }

  async function submitVote(useCaseId, value) {
    await fetch(`${window.API_BASE}/use-cases/${useCaseId}/vote`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    await loadBoard();
  }

  async function persistOrder() {
    await fetch(`${window.API_BASE}/board/reorder`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ordered_ids: state.board.map((uc) => uc.id) }),
    });
  }

  function render() {
    const list = el("board-list");
    list.innerHTML = "";
    el("board-summary").textContent = `${state.board.length} Anwendungsfälle`;
    const empty = el("board-empty");
    empty.hidden = state.board.length > 0;
    if (!state.board.length) return;

    const { min_priority: minP, max_priority: maxP } = state.options;

    state.board.forEach((uc, index) => {
      const li = document.createElement("li");
      li.className = "board-row";
      li.draggable = state.canReorder;

      const rank = document.createElement("span");
      rank.className = "board-rank";
      rank.textContent = index + 1;
      li.appendChild(rank);

      const nameLink = document.createElement("a");
      nameLink.className = "table-link";
      nameLink.href = `${window.ROOT_PATH}/use-case/${uc.id}`;
      nameLink.textContent = uc.name;
      nameLink.style.flex = "1 1 auto";
      li.appendChild(nameLink);

      const categoryChip = document.createElement("span");
      categoryChip.className = "chip attr-chip";
      const catColor = categoryColor(uc.use_category, state.options.use_category);
      categoryChip.style.background = catColor;
      categoryChip.style.color = textColorFor(catColor);
      categoryChip.textContent = uc.use_category_label;
      li.appendChild(categoryChip);

      const priorityChip = document.createElement("span");
      priorityChip.className = "chip priority-chip";
      const pColor = Common.priorityColor(uc.priority, minP, maxP);
      priorityChip.style.background = pColor;
      priorityChip.style.color = textColorFor(pColor);
      priorityChip.textContent = uc.priority;
      li.appendChild(priorityChip);

      const evChip = document.createElement("span");
      evChip.className = "chip attr-chip";
      const evColor = statusColorForPoints(uc.economic_value_points, state.options.economic_value);
      evChip.style.background = evColor;
      evChip.style.color = textColorFor(evColor);
      evChip.textContent = `${uc.economic_value_label} (${uc.vote_count} Stimme${uc.vote_count === 1 ? "" : "n"})`;
      li.appendChild(evChip);

      if (state.isPrioboard) {
        const select = document.createElement("select");
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Ihre Stimme…";
        select.appendChild(placeholder);
        for (const opt of state.options.economic_value) {
          const option = document.createElement("option");
          option.value = opt.value;
          option.textContent = `${opt.label} (${opt.points}p)`;
          select.appendChild(option);
        }
        select.value = myVoteValue(uc);
        select.addEventListener("change", () => submitVote(uc.id, select.value));
        li.appendChild(select);
      }

      if (state.canReorder) {
        li.addEventListener("dragstart", () => {
          state.dragIndex = index;
        });
        li.addEventListener("dragover", (e) => e.preventDefault());
        li.addEventListener("drop", async (e) => {
          e.preventDefault();
          if (state.dragIndex === null || state.dragIndex === index) return;
          const [moved] = state.board.splice(state.dragIndex, 1);
          state.board.splice(index, 0, moved);
          state.dragIndex = null;
          render();
          await persistOrder();
        });
      }

      list.appendChild(li);
    });
  }

  (async function init() {
    await loadCurrentUser();
    await loadOptions();
    await loadBoard();
  })();
})();

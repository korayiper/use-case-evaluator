(() => {
  "use strict";

  const GUTTER_PX = 190; // reserved on the right of the timeline track for row labels
  const MIN_BAR_PX = 4;

  const state = {
    options: null,
    useCases: [],
    isWriter: false,
    sortKey: "priority",
    sortDir: "desc",
    filters: {
      search: "",
      use_category: [],
      value_added: [],
      development_time: [],
      process_criticality: [],
      process_dependency: [],
      ai_feasibility: [],
      economic_value: [],
    },
  };

  // toggle/menu element refs per filter key, filled in by buildMultiSelect()
  const filterUI = {};

  const FILTER_CONFIG = [
    { id: "filter-use-category", key: "use_category", label: "Nutzungskategorie" },
    { id: "filter-economic-value", key: "economic_value", label: "Wirtschaftlicher Nutzen" },
    { id: "filter-value-added", key: "value_added", label: "Breitenwirkung/Kultur" },
    { id: "filter-development-time", key: "development_time", label: "Entwicklungsdauer" },
    { id: "filter-process-criticality", key: "process_criticality", label: "Prozesskritikalität" },
    { id: "filter-process-dependency", key: "process_dependency", label: "Prozessabhängigkeit" },
    { id: "filter-ai-feasibility", key: "ai_feasibility", label: "KI-Umsetzbarkeit" },
  ];

  const DEFAULT_DESC = new Set([
    "value_added_points",
    "development_time_points",
    "process_criticality_points",
    "process_dependency_points",
    "ai_feasibility_rank",
    "economic_value_points",
    "priority",
  ]);

  // Color/format math and structured-text rendering live in common.js,
  // shared with use_case.js and board.js.
  const { el, statusColorForPoints, textColorFor, priorityColor, formatDate, svgEl, moveTooltip, hideTooltip } =
    Common;

  function categoryColor(value) {
    return Common.categoryColor(value, state.options.use_category);
  }

  // ---------- data loading ----------

  // Purely a UX nicety - hides controls the user has no rights to use.
  // The server enforces the actual permission check independently (403 on
  // POST/PUT for non-writers), so this can't be bypassed for real by
  // showing the button anyway (e.g. via devtools).
  async function loadCurrentUser() {
    const res = await fetch(`${window.API_BASE}/me`);
    const data = await res.json();
    state.isWriter = data.is_writer;
    el("toggle-add").hidden = !state.isWriter;
  }

  async function loadOptions() {
    const res = await fetch(`${window.API_BASE}/options`);
    state.options = await res.json();
    UseCaseForm.setOptions(state.options);
    setupFilters(); // builds the filter DOM (incl. its own help-btn/panel pairs) - must run before setupHelpPanels()
    Common.setupHelpPanels(state.options);
  }

  // ---------- filters ----------

  function filterToggleLabel(cfg) {
    const selected = state.filters[cfg.key];
    if (selected.length === 0) return `${cfg.label}: alle`;
    if (selected.length === 1) {
      const opt = state.options[cfg.key].find((o) => o.value === selected[0]);
      return `${cfg.label}: ${opt ? opt.label : selected[0]}`;
    }
    return `${cfg.label}: ${selected.length} ausgewählt`;
  }

  function buildMultiSelect(cfg) {
    filterUI[cfg.key] = Common.buildCheckboxDropdown(el(cfg.id), {
      options: state.options[cfg.key],
      isSelected: (v) => state.filters[cfg.key].includes(v),
      onToggle: (v, checked) => {
        state.filters[cfg.key] = checked
          ? [...state.filters[cfg.key], v]
          : state.filters[cfg.key].filter((x) => x !== v);
        render();
      },
      onClear: () => {
        state.filters[cfg.key] = [];
        render();
      },
      toggleLabel: () => filterToggleLabel(cfg),
      help: { field: cfg.key },
    });
  }

  function setupFilters() {
    for (const cfg of FILTER_CONFIG) {
      buildMultiSelect(cfg);
    }

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".ms-filter")) Common.closeAllFilterMenus();
    });

    el("f-search").addEventListener("input", (e) => {
      state.filters.search = e.target.value;
      render();
    });

    el("reset-filters").addEventListener("click", () => {
      state.filters.search = "";
      el("f-search").value = "";
      for (const cfg of FILTER_CONFIG) {
        state.filters[cfg.key] = [];
        const { toggle, menu } = filterUI[cfg.key];
        menu.querySelectorAll("input[type=checkbox]").forEach((cb) => (cb.checked = false));
        toggle.textContent = filterToggleLabel(cfg);
      }
      render();
    });
  }

  function filteredUseCases() {
    const { search, ...selectFilters } = state.filters;
    const term = search.trim().toLowerCase();
    return state.useCases.filter((uc) => {
      if (term && !`${uc.name} ${uc.idea_initiator}`.toLowerCase().includes(term)) return false;
      for (const [key, values] of Object.entries(selectFilters)) {
        if (values.length && !values.includes(uc[key])) return false;
      }
      return true;
    });
  }

  function updateFilterSummary() {
    const total = state.useCases.length;
    const shown = filteredUseCases().length;
    el("filter-summary").textContent =
      total === shown ? `${total} Anwendungsfälle` : `${shown} von ${total} Anwendungsfällen`;
  }

  function emptyStateText() {
    return state.useCases.length === 0
      ? "Noch keine Anwendungsfälle vorhanden."
      : "Keine Anwendungsfälle entsprechen den gewählten Filtern.";
  }

  async function loadUseCases() {
    const res = await fetch(`${window.API_BASE}/use-cases`);
    state.useCases = await res.json();
    UseCaseForm.setUseCases(state.useCases);
    render();
  }

  // ---------- sorting ----------

  function sortedUseCases() {
    const { sortKey, sortDir } = state;
    const factor = sortDir === "asc" ? 1 : -1;
    return filteredUseCases().sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av < bv) return -1 * factor;
      if (av > bv) return 1 * factor;
      return a.name.localeCompare(b.name);
    });
  }

  function render() {
    updateFilterSummary();
    renderTable();
    renderTimeline();
    renderGraph();
  }

  // ---------- table ----------

  function attrChip(label, value, options, key = "points") {
    const span = document.createElement("span");
    span.className = "chip attr-chip";
    const bg = statusColorForPoints(value, options, key);
    span.style.background = bg;
    span.style.color = textColorFor(bg);
    span.textContent = label;
    const opt = options.find((o) => o.label === label);
    if (opt && opt.help) span.title = opt.help;
    return span;
  }

  function attrCell(label, value, options, key = "points") {
    const td = document.createElement("td");
    td.appendChild(attrChip(label, value, options, key));
    return td;
  }

  function renderTable() {
    const tbody = el("use-case-tbody");
    tbody.innerHTML = "";

    for (const th of document.querySelectorAll("#use-case-table th[data-sort]")) {
      const key = th.dataset.sort;
      th.classList.toggle("sorted", key === state.sortKey);
      th.dataset.arrow = state.sortDir === "asc" ? "↑" : "↓";
    }

    const rows = sortedUseCases();
    const tableEmpty = el("table-empty");
    tableEmpty.hidden = rows.length > 0;
    tableEmpty.textContent = emptyStateText();

    const { min_priority: minP, max_priority: maxP, ...opts } = state.options;

    for (const uc of rows) {
      const tr = document.createElement("tr");

      const nameTd = document.createElement("td");
      const nameLink = document.createElement("a");
      nameLink.className = "table-link";
      nameLink.href = `${window.ROOT_PATH}/use-case/${uc.id}`;
      nameLink.textContent = uc.name;
      nameTd.appendChild(nameLink);
      const titleParts = [];
      if (uc.description) titleParts.push(`Beschreibung: ${uc.description}`);
      if (uc.value_added_description) titleParts.push(`Breitenwirkung/Kultur: ${uc.value_added_description}`);
      if (titleParts.length) nameTd.title = titleParts.join("\n");
      tr.appendChild(nameTd);

      const initiatorTd = document.createElement("td");
      initiatorTd.textContent = uc.idea_initiator;
      tr.appendChild(initiatorTd);

      const categoryTd = document.createElement("td");
      const categoryChip = document.createElement("span");
      categoryChip.className = "chip attr-chip";
      const catColor = categoryColor(uc.use_category);
      categoryChip.style.background = catColor;
      categoryChip.style.color = textColorFor(catColor);
      categoryChip.textContent = uc.use_category_label;
      const categoryOpt = opts.use_category.find((o) => o.value === uc.use_category);
      if (categoryOpt && categoryOpt.help) categoryChip.title = categoryOpt.help;
      categoryTd.appendChild(categoryChip);
      tr.appendChild(categoryTd);

      tr.appendChild(attrCell(uc.economic_value_label, uc.economic_value_points, opts.economic_value));
      tr.appendChild(attrCell(uc.value_added_label, uc.value_added_points, opts.value_added));
      tr.appendChild(attrCell(uc.development_time_label, uc.development_time_points, opts.development_time));
      tr.appendChild(attrCell(uc.process_criticality_label, uc.process_criticality_points, opts.process_criticality));
      tr.appendChild(attrCell(uc.process_dependency_label, uc.process_dependency_points, opts.process_dependency));
      tr.appendChild(attrCell(uc.ai_feasibility_label, uc.ai_feasibility_rank, opts.ai_feasibility, "rank"));

      const priorityTd = document.createElement("td");
      priorityTd.className = "priority-cell";
      const chip = document.createElement("span");
      chip.className = "chip priority-chip";
      chip.textContent = uc.priority;
      const pColor = priorityColor(uc.priority, minP, maxP);
      chip.style.background = pColor;
      chip.style.color = textColorFor(pColor);
      priorityTd.appendChild(chip);
      tr.appendChild(priorityTd);

      const startTd = document.createElement("td");
      if (uc.is_backlog) {
        const backlogChip = document.createElement("span");
        backlogChip.className = "chip backlog-chip";
        const bg = categoryColor(uc.use_category);
        backlogChip.style.background = bg;
        backlogChip.style.color = textColorFor(bg);
        backlogChip.textContent = "Backlog";
        backlogChip.title = "Start nach 2030 (Breitenwirkung/Kultur und/oder KI-Umsetzbarkeit sind Tief)";
        startTd.appendChild(backlogChip);
      } else {
        startTd.textContent = formatDate(uc.start_date);
      }
      tr.appendChild(startTd);

      const goliveTd = document.createElement("td");
      goliveTd.textContent = formatDate(uc.golive_date);
      tr.appendChild(goliveTd);

      const dependsTd = document.createElement("td");
      if (uc.depends_on_names.length) {
        dependsTd.textContent = uc.depends_on_names.join(", ");
        dependsTd.title = dependsTd.textContent;
      } else {
        dependsTd.textContent = "–";
        dependsTd.className = "muted-text";
      }
      tr.appendChild(dependsTd);

      tbody.appendChild(tr);
    }
  }

  // ---------- timeline ----------

  // Always quarter-aligned (Jan/Apr/Jul/Okt), not just "every N months from
  // wherever the data happens to start" - that's the fixed reporting-period
  // grid the business expects, regardless of the actual data range.
  function monthTicks(rangeStart, rangeEnd) {
    const startQuarterMonth = Math.floor(rangeStart.getMonth() / 3) * 3;
    const ticks = [];
    const cursor = new Date(rangeStart.getFullYear(), startQuarterMonth, 1);
    while (cursor <= rangeEnd) {
      ticks.push(new Date(cursor));
      cursor.setMonth(cursor.getMonth() + 3);
    }
    return ticks;
  }

  function formatTick(date) {
    return date.toLocaleDateString(Common.LOCALE, { month: "short", year: "numeric" });
  }

  function renderTimeline() {
    const container = el("timeline");
    container.innerHTML = "";

    const rows = sortedUseCases();
    const timelineEmpty = el("timeline-empty");
    timelineEmpty.hidden = rows.length > 0;
    timelineEmpty.textContent = emptyStateText();
    renderLegend();
    renderBacklogList(rows.filter((uc) => uc.is_backlog));
    const scheduled = rows.filter((uc) => !uc.is_backlog);
    if (scheduled.length === 0) {
      return;
    }

    let rangeStart = new Date(Math.min(...scheduled.map((r) => new Date(r.start_date))));
    let rangeEnd = new Date(Math.max(...scheduled.map((r) => new Date(r.golive_date))));
    const padDays = Math.max(14, Math.round((rangeEnd - rangeStart) / (1000 * 60 * 60 * 24) * 0.04));
    rangeStart = new Date(rangeStart.getTime() - padDays * 86400000);
    rangeEnd = new Date(rangeEnd.getTime() + padDays * 86400000);
    const totalMs = rangeEnd - rangeStart;

    const grid = document.createElement("div");
    grid.className = "timeline-grid";
    container.appendChild(grid);

    const gridWidth = Math.max(container.clientWidth, 720);
    const trackWidth = gridWidth - GUTTER_PX;
    const scaleX = (date) => ((date - rangeStart) / totalMs) * trackWidth;

    const axis = document.createElement("div");
    axis.className = "timeline-axis";
    for (const tick of monthTicks(rangeStart, rangeEnd)) {
      const tickEl = document.createElement("div");
      tickEl.className = "timeline-tick";
      tickEl.style.left = `${scaleX(tick)}px`;
      const label = document.createElement("span");
      label.className = "tick-label";
      label.textContent = formatTick(tick);
      tickEl.appendChild(label);
      axis.appendChild(tickEl);
    }
    grid.appendChild(axis);

    const rowsEl = document.createElement("div");
    rowsEl.className = "timeline-rows";

    const today = new Date();
    let todayLine = null;
    if (today >= rangeStart && today <= rangeEnd) {
      todayLine = document.createElement("div");
      todayLine.className = "timeline-today";
      todayLine.style.left = `${scaleX(today)}px`;
      todayLine.style.height = `${scheduled.length * 30}px`;
      todayLine.title = "Heute";
    }

    for (const uc of scheduled) {
      const row = document.createElement("div");
      row.className = "timeline-row";

      for (const tick of monthTicks(rangeStart, rangeEnd)) {
        const gridLine = document.createElement("div");
        gridLine.className = "row-gridline";
        gridLine.style.left = `${scaleX(tick)}px`;
        row.appendChild(gridLine);
      }

      const start = new Date(uc.start_date);
      const golive = new Date(uc.golive_date);
      const left = scaleX(start);
      const width = Math.max(MIN_BAR_PX, scaleX(golive) - left);

      const bar = document.createElement("div");
      bar.className = "timeline-bar";
      bar.style.left = `${left}px`;
      bar.style.width = `${width}px`;
      bar.style.background = categoryColor(uc.use_category);

      const label = document.createElement("span");
      label.className = "bar-label";
      label.textContent = `${uc.name} — Priorität ${uc.priority}`;
      bar.appendChild(label);

      bar.addEventListener("mouseenter", (e) => showTooltip(e, uc));
      bar.addEventListener("mousemove", (e) => moveTooltip(e));
      bar.addEventListener("mouseleave", hideTooltip);

      row.appendChild(bar);
      rowsEl.appendChild(row);
    }

    grid.appendChild(rowsEl);
    if (todayLine) grid.appendChild(todayLine);
  }

  // Backlog items have no real schedule (their start_date is a sentinel, not
  // a plan) - showing them as a duration bar on the date scale is misleading
  // (produces an unreadable sliver) and drags the whole scale out to 2030.
  // They get their own always-visible chip list instead, off the date axis.
  function renderBacklogList(backlogRows) {
    const section = el("timeline-backlog");
    const list = el("timeline-backlog-list");
    list.innerHTML = "";
    section.hidden = backlogRows.length === 0;
    if (backlogRows.length === 0) return;

    for (const uc of backlogRows) {
      const chip = document.createElement("span");
      chip.className = "chip backlog-chip";
      const bg = categoryColor(uc.use_category);
      chip.style.background = bg;
      chip.style.color = textColorFor(bg);
      chip.textContent = uc.name;
      chip.addEventListener("mouseenter", (e) => showTooltip(e, uc));
      chip.addEventListener("mousemove", (e) => moveTooltip(e));
      chip.addEventListener("mouseleave", hideTooltip);
      list.appendChild(chip);
    }
  }

  function renderLegend() {
    const legend = el("timeline-legend");
    legend.innerHTML = "";
    for (const opt of state.options.use_category) {
      const item = document.createElement("span");
      item.className = "legend-item";
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.background = categoryColor(opt.value);
      const label = document.createElement("span");
      label.textContent = opt.label;
      item.append(swatch, label);
      legend.appendChild(item);
    }
  }

  // ---------- tooltip ----------

  function showTooltip(e, uc) {
    const tooltip = el("tooltip");
    tooltip.innerHTML = "";
    const title = document.createElement("strong");
    title.textContent = uc.name;
    tooltip.appendChild(title);

    const categoryLine = document.createElement("div");
    const dot = document.createElement("span");
    dot.className = "legend-dot";
    dot.style.background = categoryColor(uc.use_category);
    categoryLine.appendChild(dot);
    categoryLine.append(`Nutzungskategorie: ${uc.use_category_label}`);
    tooltip.appendChild(categoryLine);

    const lines = [
      `Ideengeber: ${uc.idea_initiator}`,
      `Priorität: ${uc.priority}`,
      ...(uc.is_backlog ? ["Status: Backlog"] : []),
      `Breitenwirkung/Kultur: ${uc.value_added_label} (${uc.value_added_points}p)`,
      `Entwicklungsdauer: ${uc.development_time_label} (${uc.development_time_points}p)`,
      `Prozesskritikalität: ${uc.process_criticality_label} (${uc.process_criticality_points}p)`,
      `Prozessabhängigkeit: ${uc.process_dependency_label} (${uc.process_dependency_points}p)`,
      `KI-Umsetzbarkeit: ${uc.ai_feasibility_label}`,
      `Wirtschaftlicher Nutzen: ${uc.economic_value_label} (${uc.economic_value_points}p)`,
      `Start: ${formatDate(uc.start_date)}`,
      `Go-Live: ${formatDate(uc.golive_date)}`,
    ];
    if (uc.description) lines.push(`Beschreibung: ${uc.description}`);
    if (uc.value_added_description) lines.push(`Beschreibung Breitenwirkung/Kultur: ${uc.value_added_description}`);
    if (uc.depends_on_names.length) lines.push(`Abhängig von: ${uc.depends_on_names.join(", ")}`);
    for (const line of lines) {
      const p = document.createElement("div");
      p.textContent = line;
      tooltip.appendChild(p);
    }
    tooltip.hidden = false;
    moveTooltip(e);
  }

  // ---------- dependency graph ----------

  const GRAPH_COL_WIDTH = 220;
  const GRAPH_ROW_HEIGHT = 64;
  const GRAPH_NODE_W = 160;
  const GRAPH_NODE_H = 36;
  const GRAPH_MARGIN = 24;
  const GRAPH_COMPONENT_GAP = GRAPH_ROW_HEIGHT / 2;

  function nodesWithEdges() {
    const ids = new Set();
    for (const uc of state.useCases) {
      if (uc.depends_on.length) {
        ids.add(uc.id);
        for (const dep of uc.depends_on) ids.add(dep);
      }
    }
    return ids;
  }

  // level(root) = 0; level(x) = 1 + max(level(prerequisite)) over x's
  // depends_on. The `visiting` guard is defensive only - the server prevents
  // cycles, so it should never trigger in practice.
  function computeLevels(nodeIds, edgesByTarget) {
    const levels = new Map();
    const visiting = new Set();
    function levelOf(id) {
      if (levels.has(id)) return levels.get(id);
      if (visiting.has(id)) return 0;
      visiting.add(id);
      const preqs = edgesByTarget.get(id) || [];
      const level = preqs.length === 0 ? 0 : 1 + Math.max(...preqs.map(levelOf));
      visiting.delete(id);
      levels.set(id, level);
      return level;
    }
    for (const id of nodeIds) levelOf(id);
    return levels;
  }

  // Weakly-connected components (edge direction ignored) among nodeIds, so
  // unrelated dependency chains never share a row/column just because they
  // happen to have the same length - each chain gets grouped and stacked as
  // its own block, still left-to-right within itself.
  function computeComponents(nodeIds, edgesByTarget) {
    const adjacency = new Map();
    for (const id of nodeIds) adjacency.set(id, new Set());
    for (const [target, sources] of edgesByTarget) {
      for (const source of sources) {
        adjacency.get(target).add(source);
        adjacency.get(source).add(target);
      }
    }
    const seen = new Set();
    const components = [];
    for (const id of nodeIds) {
      if (seen.has(id)) continue;
      const component = [];
      const stack = [id];
      seen.add(id);
      while (stack.length) {
        const node = stack.pop();
        component.push(node);
        for (const neighbor of adjacency.get(node)) {
          if (!seen.has(neighbor)) {
            seen.add(neighbor);
            stack.push(neighbor);
          }
        }
      }
      components.push(component);
    }
    return components;
  }

  function edgePath(from, to) {
    const x1 = from.x + GRAPH_NODE_W / 2;
    const y1 = from.y;
    const x2 = to.x - GRAPH_NODE_W / 2;
    const y2 = to.y;
    const dx = Math.max(40, (x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }

  function truncateLabel(name, max = 22) {
    return name.length > max ? name.slice(0, max - 1) + "…" : name;
  }

  function renderGraph() {
    const svg = el("dependency-graph");
    Array.from(svg.children).forEach((c) => {
      if (c.tagName !== "defs") c.remove();
    });

    const nodeIds = nodesWithEdges();
    const byId = new Map(state.useCases.map((uc) => [uc.id, uc]));
    const hasBacklogNode = [...nodeIds].some((id) => byId.get(id).is_backlog);
    el("dependency-summary").textContent = hasBacklogNode
      ? `${nodeIds.size} von ${state.useCases.length} Anwendungsfällen haben Abhängigkeiten · gestrichelter Rahmen = Backlog`
      : `${nodeIds.size} von ${state.useCases.length} Anwendungsfällen haben Abhängigkeiten`;
    const emptyEl = el("dependency-empty");
    emptyEl.hidden = nodeIds.size > 0;
    if (nodeIds.size === 0) {
      svg.setAttribute("width", 0);
      svg.setAttribute("height", 0);
      return;
    }

    const edgesByTarget = new Map(
      [...nodeIds].map((id) => [id, byId.get(id).depends_on.filter((d) => nodeIds.has(d))])
    );

    // Group into connected components first, and lay out each as its own
    // block, stacked vertically - so unrelated dependency chains never end
    // up sharing a row/column just because they're the same length. Every
    // block still starts at the same left edge, so each chain reads
    // left-to-right on its own.
    const components = computeComponents(nodeIds, edgesByTarget);
    components.sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length;
      const nameOf = (component) => component.map((id) => byId.get(id).name).sort()[0];
      return nameOf(a).localeCompare(nameOf(b));
    });

    const positions = new Map();
    let maxLevelOverall = 0;
    let yCursor = GRAPH_MARGIN + GRAPH_NODE_H / 2;
    for (const component of components) {
      const levels = computeLevels(component, edgesByTarget);
      const byLevel = new Map();
      for (const id of component) {
        const lvl = levels.get(id);
        if (!byLevel.has(lvl)) byLevel.set(lvl, []);
        byLevel.get(lvl).push(id);
      }
      for (const ids of byLevel.values()) ids.sort((a, b) => byId.get(a).name.localeCompare(byId.get(b).name));

      maxLevelOverall = Math.max(maxLevelOverall, ...byLevel.keys());
      const componentRows = Math.max(...[...byLevel.values()].map((ids) => ids.length));

      for (const [lvl, ids] of byLevel) {
        ids.forEach((id, i) =>
          positions.set(id, {
            x: GRAPH_MARGIN + GRAPH_NODE_W / 2 + lvl * GRAPH_COL_WIDTH,
            y: yCursor + i * GRAPH_ROW_HEIGHT,
          })
        );
      }
      yCursor += componentRows * GRAPH_ROW_HEIGHT + GRAPH_COMPONENT_GAP;
    }

    const width = GRAPH_MARGIN * 2 + GRAPH_NODE_W + maxLevelOverall * GRAPH_COL_WIDTH;
    const height = yCursor - GRAPH_COMPONENT_GAP + GRAPH_NODE_H / 2 + GRAPH_MARGIN;
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    const edgeGroup = svgEl("g", { class: "dep-edges" });
    for (const id of nodeIds) {
      const uc = byId.get(id);
      const to = positions.get(id);
      for (const depId of uc.depends_on) {
        if (!nodeIds.has(depId)) continue;
        edgeGroup.appendChild(
          svgEl("path", {
            class: "dep-edge",
            d: edgePath(positions.get(depId), to),
            "marker-end": "url(#dep-arrow)",
          })
        );
      }
    }
    svg.appendChild(edgeGroup);

    const nodeGroup = svgEl("g", { class: "dep-nodes" });
    for (const id of nodeIds) {
      const uc = byId.get(id);
      const { x, y } = positions.get(id);
      const fill = categoryColor(uc.use_category);
      const g = svgEl("g", { class: uc.is_backlog ? "dep-node is-backlog" : "dep-node" });
      const rect = svgEl("rect", {
        class: uc.is_backlog ? "dep-node-rect is-backlog" : "dep-node-rect",
        x: x - GRAPH_NODE_W / 2,
        y: y - GRAPH_NODE_H / 2,
        width: GRAPH_NODE_W,
        height: GRAPH_NODE_H,
        rx: 6,
        fill,
      });
      const text = svgEl("text", {
        class: "dep-node-label",
        x,
        y,
        "text-anchor": "middle",
        "dominant-baseline": "middle",
        fill: textColorFor(fill),
      });
      text.textContent = truncateLabel(uc.name);
      g.append(rect, text);
      g.addEventListener("mouseenter", (e) => showTooltip(e, uc));
      g.addEventListener("mousemove", moveTooltip);
      g.addEventListener("mouseleave", hideTooltip);
      nodeGroup.appendChild(g);
    }
    svg.appendChild(nodeGroup);
  }

  // ---------- form ----------
  // Form markup and logic (open/close/submit) live in use_case_form.js,
  // shared with the detail page's inline editing - this page just wires its
  // own "+ Neuer Anwendungsfall" toggle to it.

  function setupForm() {
    const panel = el("add-panel");
    el("toggle-add").addEventListener("click", () => {
      if (panel.hidden) {
        UseCaseForm.openAdd();
      } else {
        UseCaseForm.close();
      }
    });
  }

  function setupSorting() {
    document.querySelectorAll("#use-case-table th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.sort;
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        } else {
          state.sortKey = key;
          state.sortDir = DEFAULT_DESC.has(key) ? "desc" : "asc";
        }
        render();
      });
    });
  }

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderTimeline, 150);
  });

  (async function init() {
    setupForm();
    setupSorting();
    UseCaseForm.init({ onSaved: loadUseCases });
    await loadCurrentUser();
    await loadOptions();
    await loadUseCases();
  })();
})();
(() => {
  "use strict";

  const GUTTER_PX = 190; // reserved on the right of the timeline track for row labels
  const MIN_BAR_PX = 4;
  const LOCALE = "de-DE";

  // Sequential blue ramp (ordinal-safe subset of the palette's 100-700 ramp),
  // used for the aggregate priority (magnitude, not "good/bad").
  const PRIORITY_RAMP = [
    "#86b6ef", "#6da7ec", "#5598e7", "#3987e5",
    "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#0d366b",
  ];

  // Status ramp (worst -> best) for the four scored attributes: red = few
  // points / unfavorable, green = many points / favorable. Interpolated so
  // it works for attributes with any number of levels (3 to 5).
  const STATUS_STOPS = [
    { t: 0.0, rgb: [0xd0, 0x3b, 0x3b] }, // critical
    { t: 0.33, rgb: [0xec, 0x83, 0x5a] }, // serious
    { t: 0.66, rgb: [0xfa, 0xb2, 0x19] }, // warning
    { t: 1.0, rgb: [0x0c, 0xa3, 0x0c] }, // good
  ];

  // Categorical palette, fixed order (identity, not magnitude) - used for
  // Nutzungskategorie. Assigned in this order, never cycled.
  const CATEGORY_PALETTE = [
    "#2a78d6", // blue
    "#008300", // green
    "#e87ba4", // magenta
    "#eda100", // yellow
    "#1baf7a", // aqua
    "#eb6834", // orange
    "#4a3aa7", // violet
    "#e34948", // red
  ];

  const state = {
    options: null,
    useCases: [],
    sortKey: "priority",
    sortDir: "desc",
    editingId: null,
    filters: {
      search: "",
      use_category: [],
      value_added: [],
      development_time: [],
      process_criticality: [],
      process_dependency: [],
      ai_feasibility: [],
    },
  };

  // toggle/menu element refs per filter key, filled in by buildMultiSelect()
  const filterUI = {};

  const FILTER_CONFIG = [
    { id: "filter-use-category", key: "use_category", label: "Nutzungskategorie" },
    { id: "filter-value-added", key: "value_added", label: "Mehrwert" },
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
    "priority",
  ]);

  const el = (id) => document.getElementById(id);

  function colorFromRamp(ramp, t) {
    const idx = Math.round(t * (ramp.length - 1));
    return ramp[Math.min(ramp.length - 1, Math.max(0, idx))];
  }

  function statusColor(t) {
    t = Math.min(1, Math.max(0, t));
    let a = STATUS_STOPS[0];
    let b = STATUS_STOPS[STATUS_STOPS.length - 1];
    for (let i = 0; i < STATUS_STOPS.length - 1; i++) {
      if (t >= STATUS_STOPS[i].t && t <= STATUS_STOPS[i + 1].t) {
        a = STATUS_STOPS[i];
        b = STATUS_STOPS[i + 1];
        break;
      }
    }
    const span = b.t - a.t || 1;
    const localT = (t - a.t) / span;
    const rgb = a.rgb.map((v, i) => Math.round(v + (b.rgb[i] - v) * localT));
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  }

  function pointsRange(options, key) {
    const pts = options.map((o) => o[key]);
    return [Math.min(...pts), Math.max(...pts)];
  }

  // `key` selects which numeric field drives the color: "points" for the
  // four scored attributes, or "rank" for attributes like ai_feasibility
  // whose points are always 0 and can't tell classes apart.
  function statusColorForPoints(value, options, key = "points") {
    const [min, max] = pointsRange(options, key);
    const t = max === min ? 1 : (value - min) / (max - min);
    return statusColor(t);
  }

  // Accepts either "#rrggbb" or "rgb(r, g, b)".
  function toRgbTriple(color) {
    if (color.startsWith("#")) {
      const bigint = parseInt(color.slice(1), 16);
      return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
    }
    return color.match(/\d+/g).map(Number);
  }

  // Relative luminance (sRGB) to pick readable text color on a fill.
  function textColorFor(color) {
    const [r, g, b] = toRgbTriple(color);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6 ? "#0b0b0b" : "#ffffff";
  }

  function priorityColor(priority, minP, maxP) {
    const t = maxP === minP ? 1 : (priority - minP) / (maxP - minP);
    return colorFromRamp(PRIORITY_RAMP, t);
  }

  function categoryColor(value) {
    const idx = state.options.use_category.findIndex((o) => o.value === value);
    return CATEGORY_PALETTE[Math.max(0, idx) % CATEGORY_PALETTE.length];
  }

  // ---------- data loading ----------

  async function loadOptions() {
    const res = await fetch("/api/options");
    state.options = await res.json();
    populateSelect("f-value-added", state.options.value_added, true);
    populateSelect("f-development-time", state.options.development_time, true);
    populateSelect("f-process-criticality", state.options.process_criticality, true);
    populateSelect("f-process-dependency", state.options.process_dependency, true);
    populateSelect("f-use-category", state.options.use_category, false);
    populateSelect("f-ai-feasibility", state.options.ai_feasibility, true);
    setupHelpPanels();
    setupFilters();
  }

  const HELP_FIELDS = [
    "use_category",
    "ai_feasibility",
    "value_added",
    "development_time",
    "process_criticality",
    "process_dependency",
  ];

  function setupHelpPanels() {
    for (const field of HELP_FIELDS) {
      const helpOptions = state.options[field].filter((o) => o.help);
      const description = (state.options.descriptions || {})[field];
      const btn = document.querySelector(`.help-btn[data-help="${field}"]`);
      const panel = el(`help-panel-${field}`);
      if (helpOptions.length === 0 && !description) {
        btn.hidden = true;
        continue;
      }
      panel.innerHTML = "";
      if (description) {
        const intro = document.createElement("p");
        intro.className = "help-intro";
        intro.textContent = description;
        panel.appendChild(intro);
      }
      const dl = document.createElement("dl");
      for (const opt of helpOptions) {
        const dt = document.createElement("dt");
        dt.textContent = opt.label;
        const dd = document.createElement("dd");
        dd.textContent = opt.help;
        dl.append(dt, dd);
      }
      panel.appendChild(dl);
      btn.hidden = false;
      btn.addEventListener("click", () => {
        panel.hidden = !panel.hidden;
      });
    }
  }

  function populateSelect(id, options, withPoints) {
    const select = el(id);
    select.innerHTML = "";
    for (const opt of options) {
      const option = document.createElement("option");
      option.value = opt.value;
      option.textContent = withPoints ? `${opt.label} (${opt.points}p)` : opt.label;
      select.appendChild(option);
    }
  }

  // ---------- filters ----------

  function closeAllFilterMenus() {
    document.querySelectorAll(".ms-filter-menu").forEach((m) => (m.hidden = true));
    document.querySelectorAll(".ms-filter-toggle").forEach((b) => b.classList.remove("active"));
  }

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
    const container = el(cfg.id);
    container.className = "ms-filter";
    container.innerHTML = "";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "ms-filter-toggle";
    toggle.textContent = filterToggleLabel(cfg);
    container.appendChild(toggle);

    const menu = document.createElement("div");
    menu.className = "ms-filter-menu";
    menu.hidden = true;

    for (const opt of state.options[cfg.key]) {
      const label = document.createElement("label");
      label.className = "ms-filter-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = opt.value;
      checkbox.addEventListener("change", () => {
        const selected = state.filters[cfg.key];
        state.filters[cfg.key] = checkbox.checked
          ? [...selected, opt.value]
          : selected.filter((v) => v !== opt.value);
        toggle.textContent = filterToggleLabel(cfg);
        render();
      });
      label.append(checkbox, document.createTextNode(opt.label));
      menu.appendChild(label);
    }

    const footer = document.createElement("div");
    footer.className = "ms-filter-footer";
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.textContent = "Zurücksetzen";
    clearBtn.addEventListener("click", () => {
      state.filters[cfg.key] = [];
      menu.querySelectorAll("input[type=checkbox]").forEach((cb) => (cb.checked = false));
      toggle.textContent = filterToggleLabel(cfg);
      render();
    });
    footer.appendChild(clearBtn);
    menu.appendChild(footer);
    container.appendChild(menu);

    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasOpen = !menu.hidden;
      closeAllFilterMenus();
      if (!wasOpen) {
        menu.hidden = false;
        toggle.classList.add("active");
      }
    });

    filterUI[cfg.key] = { toggle, menu };
  }

  function setupFilters() {
    for (const cfg of FILTER_CONFIG) {
      buildMultiSelect(cfg);
    }

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".ms-filter")) closeAllFilterMenus();
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
    const res = await fetch("/api/use-cases");
    state.useCases = await res.json();
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
      nameTd.textContent = uc.name;
      const titleParts = [];
      if (uc.description) titleParts.push(`Beschreibung: ${uc.description}`);
      if (uc.value_added_description) titleParts.push(`Mehrwert: ${uc.value_added_description}`);
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
      startTd.textContent = formatDate(uc.start_date);
      tr.appendChild(startTd);

      const goliveTd = document.createElement("td");
      goliveTd.textContent = formatDate(uc.golive_date);
      tr.appendChild(goliveTd);

      const actionsTd = document.createElement("td");
      const editBtn = document.createElement("button");
      editBtn.className = "btn-icon";
      editBtn.type = "button";
      editBtn.title = "Bearbeiten";
      editBtn.textContent = "✎";
      editBtn.addEventListener("click", () => openEditForm(uc));
      actionsTd.appendChild(editBtn);

      const delBtn = document.createElement("button");
      delBtn.className = "btn-icon";
      delBtn.type = "button";
      delBtn.title = "Löschen";
      delBtn.textContent = "✕";
      delBtn.addEventListener("click", () => deleteUseCase(uc.id));
      actionsTd.appendChild(delBtn);
      tr.appendChild(actionsTd);

      tbody.appendChild(tr);
    }
  }

  function formatDate(isoDate) {
    return new Date(isoDate).toLocaleDateString(LOCALE, { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  async function deleteUseCase(id) {
    if (!confirm("Diesen Anwendungsfall löschen?")) return;
    await fetch(`/api/use-cases/${id}`, { method: "DELETE" });
    await loadUseCases();
  }

  // ---------- timeline ----------

  function monthTicks(rangeStart, rangeEnd) {
    const totalMonths =
      (rangeEnd.getFullYear() - rangeStart.getFullYear()) * 12 +
      (rangeEnd.getMonth() - rangeStart.getMonth());
    const step = totalMonths > 36 ? 6 : totalMonths > 18 ? 3 : 1;

    const ticks = [];
    const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
    while (cursor <= rangeEnd) {
      ticks.push(new Date(cursor));
      cursor.setMonth(cursor.getMonth() + step);
    }
    return ticks;
  }

  function formatTick(date) {
    return date.toLocaleDateString(LOCALE, { month: "short", year: "numeric" });
  }

  function renderTimeline() {
    const container = el("timeline");
    container.innerHTML = "";

    const rows = sortedUseCases();
    const timelineEmpty = el("timeline-empty");
    timelineEmpty.hidden = rows.length > 0;
    timelineEmpty.textContent = emptyStateText();
    renderLegend();
    if (rows.length === 0) {
      return;
    }

    let rangeStart = new Date(Math.min(...rows.map((r) => new Date(r.start_date))));
    let rangeEnd = new Date(Math.max(...rows.map((r) => new Date(r.golive_date))));
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
      todayLine.style.height = `${rows.length * 30}px`;
      todayLine.title = "Heute";
    }

    for (const uc of rows) {
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
      `Mehrwert: ${uc.value_added_label} (${uc.value_added_points}p)`,
      `Entwicklungsdauer: ${uc.development_time_label} (${uc.development_time_points}p)`,
      `Prozesskritikalität: ${uc.process_criticality_label} (${uc.process_criticality_points}p)`,
      `Prozessabhängigkeit: ${uc.process_dependency_label} (${uc.process_dependency_points}p)`,
      `KI-Umsetzbarkeit: ${uc.ai_feasibility_label}`,
      `Start: ${formatDate(uc.start_date)}`,
      `Go-Live: ${formatDate(uc.golive_date)}`,
    ];
    if (uc.description) lines.push(`Beschreibung: ${uc.description}`);
    if (uc.value_added_description) lines.push(`Mehrwertbeschreibung: ${uc.value_added_description}`);
    for (const line of lines) {
      const p = document.createElement("div");
      p.textContent = line;
      tooltip.appendChild(p);
    }
    tooltip.hidden = false;
    moveTooltip(e);
  }

  function moveTooltip(e) {
    const tooltip = el("tooltip");
    const offset = 14;
    let x = e.clientX + offset;
    let y = e.clientY + offset;
    if (x + 280 > window.innerWidth) x = e.clientX - 280 - offset;
    if (y + 260 > window.innerHeight) y = e.clientY - 260 - offset;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }

  function hideTooltip() {
    el("tooltip").hidden = true;
  }

  // ---------- form ----------

  function closePanel() {
    const panel = el("add-panel");
    panel.hidden = true;
    el("add-form").reset();
    el("form-error").hidden = true;
    state.editingId = null;
  }

  function openAddForm() {
    state.editingId = null;
    el("add-form").reset();
    el("form-error").hidden = true;
    el("add-panel-title").textContent = "Neuer Anwendungsfall";
    el("submit-add").textContent = "Anwendungsfall speichern";
    el("add-panel").hidden = false;
    el("f-name").focus();
  }

  function openEditForm(uc) {
    const form = el("add-form");
    state.editingId = uc.id;
    el("form-error").hidden = true;
    form.name.value = uc.name;
    form.idea_initiator.value = uc.idea_initiator;
    form.description.value = uc.description || "";
    form.value_added_description.value = uc.value_added_description || "";
    form.use_category.value = uc.use_category;
    form.ai_feasibility.value = uc.ai_feasibility;
    form.value_added.value = uc.value_added;
    form.development_time.value = uc.development_time;
    form.process_criticality.value = uc.process_criticality;
    form.process_dependency.value = uc.process_dependency;
    form.golive_date.value = uc.golive_date;
    el("add-panel-title").textContent = "Anwendungsfall bearbeiten";
    el("submit-add").textContent = "Änderungen speichern";
    const panel = el("add-panel");
    panel.hidden = false;
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
    el("f-name").focus();
  }

  function setupForm() {
    const panel = el("add-panel");
    el("toggle-add").addEventListener("click", () => {
      if (panel.hidden) {
        openAddForm();
      } else {
        closePanel();
      }
    });
    el("cancel-add").addEventListener("click", closePanel);

    el("add-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;
      const errorEl = el("form-error");
      errorEl.hidden = true;

      const payload = {
        name: form.name.value.trim(),
        idea_initiator: form.idea_initiator.value.trim(),
        description: form.description.value.trim(),
        value_added_description: form.value_added_description.value.trim(),
        use_category: form.use_category.value,
        ai_feasibility: form.ai_feasibility.value,
        value_added: form.value_added.value,
        development_time: form.development_time.value,
        process_criticality: form.process_criticality.value,
        process_dependency: form.process_dependency.value,
        golive_date: form.golive_date.value,
      };

      const isEditing = state.editingId !== null;
      const url = isEditing ? `/api/use-cases/${state.editingId}` : "/api/use-cases";
      const method = isEditing ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        errorEl.textContent = body.detail
          ? JSON.stringify(body.detail)
          : "Der Anwendungsfall konnte nicht gespeichert werden. Bitte Eingaben prüfen.";
        errorEl.hidden = false;
        return;
      }

      closePanel();
      await loadUseCases();
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
    await loadOptions();
    await loadUseCases();
  })();
})();
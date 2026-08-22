(() => {
  "use strict";

  const { el, statusColorForPoints, textColorFor, categoryColor, formatDate, renderStructuredText } = Common;

  let options = null;
  let currentUseCase = null;

  function useCaseIdFromPath() {
    return location.pathname.split("/").filter(Boolean).pop();
  }

  function attrChip(label, value, opts, key = "points") {
    const span = document.createElement("span");
    span.className = "chip attr-chip";
    const bg = statusColorForPoints(value, opts, key);
    span.style.background = bg;
    span.style.color = textColorFor(bg);
    span.textContent = label;
    const opt = opts.find((o) => o.label === label);
    if (opt && opt.help) span.title = opt.help;
    return span;
  }

  function renderLinkList(container, ids, names) {
    container.innerHTML = "";
    if (!ids.length) {
      container.textContent = "–";
      container.className = "muted-text";
      return;
    }
    container.className = "detail-link-list";
    ids.forEach((id, i) => {
      const a = document.createElement("a");
      a.className = "table-link";
      a.href = `${window.ROOT_PATH}/use-case/${id}`;
      a.textContent = names[i];
      container.appendChild(a);
    });
  }

  function render(uc) {
    document.title = uc.name;
    el("uc-name").textContent = uc.name;
    el("uc-idea-initiator").textContent = uc.idea_initiator;

    const categoryChip = document.createElement("span");
    categoryChip.className = "chip attr-chip";
    const catColor = categoryColor(uc.use_category, options.use_category);
    categoryChip.style.background = catColor;
    categoryChip.style.color = textColorFor(catColor);
    categoryChip.textContent = uc.use_category_label;
    el("uc-use-category").replaceChildren(categoryChip);

    el("uc-economic-value").replaceChildren(
      attrChip(uc.economic_value_label, uc.economic_value_points, options.economic_value)
    );
    el("uc-value-added").replaceChildren(attrChip(uc.value_added_label, uc.value_added_points, options.value_added));
    el("uc-development-time").replaceChildren(
      attrChip(uc.development_time_label, uc.development_time_points, options.development_time)
    );
    el("uc-process-criticality").replaceChildren(
      attrChip(uc.process_criticality_label, uc.process_criticality_points, options.process_criticality)
    );
    el("uc-process-dependency").replaceChildren(
      attrChip(uc.process_dependency_label, uc.process_dependency_points, options.process_dependency)
    );
    el("uc-ai-feasibility").replaceChildren(
      attrChip(uc.ai_feasibility_label, uc.ai_feasibility_rank, options.ai_feasibility, "rank")
    );

    const priorityChip = document.createElement("span");
    priorityChip.className = "chip priority-chip";
    const { min_priority: minP, max_priority: maxP } = options;
    const pColor = Common.priorityColor(uc.priority, minP, maxP);
    priorityChip.style.background = pColor;
    priorityChip.style.color = textColorFor(pColor);
    priorityChip.textContent = uc.priority;
    el("uc-priority").replaceChildren(priorityChip);

    const startEl = el("uc-start");
    if (uc.is_backlog) {
      const backlogChip = document.createElement("span");
      backlogChip.className = "chip backlog-chip";
      const bg = categoryColor(uc.use_category, options.use_category);
      backlogChip.style.background = bg;
      backlogChip.style.color = textColorFor(bg);
      backlogChip.textContent = "Backlog";
      startEl.replaceChildren(backlogChip);
    } else {
      startEl.textContent = formatDate(uc.start_date);
    }
    el("uc-golive").textContent = formatDate(uc.golive_date);

    for (const [containerId, text] of [
      ["uc-description", uc.description],
      ["uc-value-added-description", uc.value_added_description],
    ]) {
      const container = el(containerId);
      renderStructuredText(container, text);
      if (!container.children.length) {
        container.textContent = "–";
        container.className = "muted-text";
      } else {
        container.className = "detail-text";
      }
    }

    renderLinkList(el("uc-depends-on"), uc.depends_on, uc.depends_on_names);
    renderLinkList(el("uc-dependents"), uc.dependent_ids, uc.dependent_names);
  }

  async function loadUseCase() {
    const id = useCaseIdFromPath();
    const [me, uc, useCases] = await Promise.all([
      fetch(`${window.API_BASE}/me`).then((r) => r.json()),
      fetch(`${window.API_BASE}/use-cases/${id}`).then((r) => r.json()),
      fetch(`${window.API_BASE}/use-cases`).then((r) => r.json()),
    ]);
    currentUseCase = uc;
    UseCaseForm.setUseCases(useCases);
    render(uc);
    el("uc-edit-link").hidden = !me.is_writer;
    el("uc-delete-link").hidden = !me.is_writer;
  }

  async function deleteCurrentUseCase() {
    if (!currentUseCase) return;
    if (!confirm("Diesen Anwendungsfall löschen?")) return;
    await fetch(`${window.API_BASE}/use-cases/${currentUseCase.id}`, { method: "DELETE" });
    location.href = `${window.ROOT_PATH}/`;
  }

  (async function init() {
    const res = await fetch(`${window.API_BASE}/options`);
    options = await res.json();
    UseCaseForm.setOptions(options);
    Common.setupHelpPanels(options); // safe to call once here - no filters on this page competing for the scan
    UseCaseForm.init({ onSaved: loadUseCase });

    el("uc-edit-link").addEventListener("click", () => {
      if (currentUseCase) UseCaseForm.openEdit(currentUseCase);
    });
    el("uc-delete-link").addEventListener("click", deleteCurrentUseCase);

    await loadUseCase();
  })();
})();

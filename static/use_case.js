(() => {
  "use strict";

  const { el, statusColorForPoints, textColorFor, categoryColor, formatDate, renderStructuredText } = Common;

  let options = null;
  let currentUseCase = null;
  let allUseCases = [];
  let isWriter = false;
  let myDepartments = [];
  let voteData = { votes: [], missing_departments: [] };

  const STATUS_LABELS = { neu: "Neu", priorisiert: "Priorisiert", in_umsetzung: "In Umsetzung" };

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

  // Builds a full update payload from the currently-loaded record (same
  // shape the full add/edit form submits), with just the given field(s)
  // overridden - reuses the existing full-record PUT endpoint rather than
  // needing a separate partial-update API.
  function buildPayload(overrides) {
    const uc = currentUseCase;
    return {
      name: uc.name,
      idea_initiator: uc.idea_initiator,
      description: uc.description,
      value_added_description: uc.value_added_description,
      use_category: uc.use_category,
      ai_feasibility: uc.ai_feasibility,
      value_added: uc.value_added,
      development_time: uc.development_time,
      process_criticality: uc.process_criticality,
      process_dependency: uc.process_dependency,
      golive_date: uc.golive_date,
      depends_on: uc.depends_on,
      ...overrides,
    };
  }

  async function saveField(overrides) {
    const res = await fetch(`${window.API_BASE}/use-cases/${currentUseCase.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload(overrides)),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message = body.detail
        ? typeof body.detail === "string"
          ? body.detail
          : JSON.stringify(body.detail)
        : "Der Wert konnte nicht gespeichert werden.";
      alert(message);
      return false;
    }
    await loadUseCase();
    return true;
  }

  async function saveStatus(status) {
    const res = await fetch(`${window.API_BASE}/use-cases/${currentUseCase.id}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.detail || "Der Status konnte nicht geändert werden.");
      return false;
    }
    await loadUseCase();
    return true;
  }

  // Any writer may move status in any direction, including backward (e.g.
  // undoing "in Umsetzung") - matches the server-side rule in
  // app.api_set_status. "priorisiert" is normally reached via the board's
  // finalize action instead; this is the manual-correction path.
  function attachStatusEdit(container, { value }) {
    if (!isWriter) return;
    container.classList.add("editable-field");
    container.title = "Klicken zum Bearbeiten";
    container.onclick = (e) => {
      if (e.target.closest("select, textarea, input, button")) return;
      let saving = false;
      const select = document.createElement("select");
      for (const [statusValue, label] of Object.entries(STATUS_LABELS)) {
        const option = document.createElement("option");
        option.value = statusValue;
        option.textContent = label;
        select.appendChild(option);
      }
      select.value = value;
      container.replaceChildren(select);
      select.focus();
      select.addEventListener("change", async () => {
        saving = true;
        await saveStatus(select.value);
      });
      select.addEventListener("blur", () => {
        if (!saving) render(currentUseCase);
      });
    };
  }

  async function saveVote(department, value) {
    const res = await fetch(`${window.API_BASE}/use-cases/${currentUseCase.id}/vote`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ department, value }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message = body.detail
        ? typeof body.detail === "string"
          ? body.detail
          : JSON.stringify(body.detail)
        : "Die Stimme konnte nicht gespeichert werden.";
      alert(message);
      return false;
    }
    await loadUseCase();
    return true;
  }

  // Click-to-edit for a vote row the logged-in user is allowed to cast (any
  // department in myDepartments - a user can represent more than one) - not
  // gated on isWriter like every other field here, since voting is a
  // prioboard action, independent of write access to the use case itself.
  function attachVoteEdit(container, { department, value }) {
    container.classList.add("editable-field");
    container.title = "Klicken zum Bearbeiten";
    container.onclick = (e) => {
      if (e.target.closest("select, textarea, input, button")) return;
      let saving = false;
      const select = document.createElement("select");
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Stimme abgeben…";
      select.appendChild(placeholder);
      for (const opt of options.economic_value) {
        const option = document.createElement("option");
        option.value = opt.value;
        option.textContent = `${opt.label} (${opt.points}p)`;
        select.appendChild(option);
      }
      select.value = value || "";
      container.replaceChildren(select);
      select.focus();
      select.addEventListener("change", async () => {
        saving = true;
        await saveVote(department, select.value);
      });
      select.addEventListener("blur", () => {
        if (!saving) render(currentUseCase);
      });
    };
  }

  function renderVoteBreakdown(container, uc) {
    const votesByDept = {};
    for (const v of voteData.votes) votesByDept[v.department] = v;
    const allDepts = [...voteData.votes.map((v) => v.department), ...voteData.missing_departments].sort();

    container.className = "vote-breakdown";
    container.replaceChildren();
    for (const dept of allDepts) {
      const row = document.createElement("div");
      row.className = "vote-row";
      const label = document.createElement("span");
      label.className = "vote-dept";
      label.textContent = dept;
      const valueEl = document.createElement("span");
      const vote = votesByDept[dept];
      if (vote) {
        const opt = options.economic_value.find((o) => o.value === vote.value);
        valueEl.textContent = opt ? `${opt.label} (${opt.points}p)` : vote.value;
      } else {
        valueEl.textContent = "Ausstehend";
        valueEl.className = "muted-text";
      }
      row.append(label, valueEl);
      container.appendChild(row);
      if (myDepartments.includes(dept)) {
        attachVoteEdit(valueEl, { department: dept, value: vote ? vote.value : "" });
      }
    }

    // Provisional the moment a single vote exists (matches the rest of the
    // app's "show the real, partial number rather than hiding it" stance) -
    // this is the same value that's already feeding the priority score.
    const summary = document.createElement("div");
    summary.className = "vote-summary";
    if (uc.vote_count > 0) {
      const prefix = uc.vote_count < 6 ? "Median (vorläufig)" : "Median";
      summary.textContent = `${prefix}: ${uc.economic_value_label} (${uc.economic_value_points}p)`;
    } else {
      summary.className += " muted-text";
      summary.textContent = "Median: Ausstehend";
    }
    container.appendChild(summary);
  }

  // Click-to-edit for a single-select field: swaps the display chip for a
  // <select> pre-filled with the current value; picking an option saves
  // immediately (there's no separate "done editing" moment for a select,
  // unlike free text - see attachTextEdit). Re-attaching on every render()
  // would stack listeners on the persistent container, so this uses
  // `.onclick =` assignment (replaces, never stacks) rather than
  // addEventListener.
  function attachSelectEdit(container, { fieldKey, value, fieldOptions, withPoints }) {
    if (!isWriter) return;
    container.classList.add("editable-field");
    container.title = "Klicken zum Bearbeiten";
    container.onclick = (e) => {
      if (e.target.closest("select, textarea, input, button")) return; // ignore bubbled clicks from controls already inside
      let saving = false;
      const select = document.createElement("select");
      for (const opt of fieldOptions) {
        const option = document.createElement("option");
        option.value = opt.value;
        option.textContent = withPoints ? `${opt.label} (${opt.points}p)` : opt.label;
        select.appendChild(option);
      }
      select.value = value;
      container.replaceChildren(select);
      select.focus();
      select.addEventListener("change", async () => {
        saving = true;
        await saveField({ [fieldKey]: select.value });
      });
      select.addEventListener("blur", () => {
        if (!saving) render(currentUseCase);
      });
    };
  }

  function attachInputEdit(container, { fieldKey, value }) {
    if (!isWriter) return;
    container.classList.add("editable-field");
    container.title = "Klicken zum Bearbeiten";
    container.onclick = (e) => {
      if (e.target.closest("select, textarea, input, button")) return; // ignore bubbled clicks from controls already inside
      let saving = false;
      const input = document.createElement("input");
      input.type = "text";
      input.value = value;
      container.replaceChildren(input);
      input.focus();
      input.select();
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") input.blur();
      });
      input.addEventListener("change", async () => {
        saving = true;
        await saveField({ [fieldKey]: input.value.trim() });
      });
      input.addEventListener("blur", () => {
        if (!saving) render(currentUseCase);
      });
    };
  }

  function attachDateEdit(container, { fieldKey, value }) {
    if (!isWriter) return;
    container.classList.add("editable-field");
    container.title = "Klicken zum Bearbeiten";
    container.onclick = (e) => {
      if (e.target.closest("select, textarea, input, button")) return; // ignore bubbled clicks from controls already inside
      let saving = false;
      const input = document.createElement("input");
      input.type = "date";
      input.value = value;
      container.replaceChildren(input);
      input.focus();
      input.addEventListener("change", async () => {
        saving = true;
        await saveField({ [fieldKey]: input.value });
      });
      input.addEventListener("blur", () => {
        if (!saving) render(currentUseCase);
      });
    };
  }

  // Click-to-edit for a free-text field: unlike a select, there's no
  // discrete "value changed" moment to save on, so this shows explicit
  // Speichern/Abbrechen buttons instead of auto-saving on blur (matches how
  // Jira itself treats multi-line text fields differently from selects).
  function attachTextEdit(container, { fieldKey, rawValue }) {
    if (!isWriter) return;
    container.classList.add("editable-field");
    container.title = "Klicken zum Bearbeiten";
    container.onclick = (e) => {
      if (e.target.closest("select, textarea, input, button")) return; // ignore bubbled clicks from controls already inside
      const textarea = document.createElement("textarea");
      textarea.rows = 4;
      textarea.value = rawValue || "";
      const actions = document.createElement("div");
      actions.className = "form-actions";
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn btn-ghost";
      cancelBtn.textContent = "Abbrechen";
      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "btn btn-primary";
      saveBtn.textContent = "Speichern";
      actions.append(cancelBtn, saveBtn);
      container.replaceChildren(textarea, actions);
      textarea.focus();
      cancelBtn.addEventListener("click", () => render(currentUseCase));
      saveBtn.addEventListener("click", async () => {
        await saveField({ [fieldKey]: textarea.value.trim() });
      });
    };
  }

  // Click-to-edit for depends_on: a multi-select, same "no discrete save
  // moment" problem as free text, so it gets the same explicit
  // Speichern/Abbrechen treatment rather than auto-save-per-toggle.
  //
  // Deliberately NOT Common.buildCheckboxDropdown here (unlike the filter
  // bar and the full form): that widget hides its options behind a
  // collapsed toggle, which only earns its keep when space is tight (7
  // filters side by side). Here we're already in a dedicated "editing this
  // field" state with the field's own width to work with, and the widget's
  // absolutely-positioned dropdown menu doesn't reserve layout space for
  // itself - in this narrow half-column slot it overlapped the
  // Speichern/Abbrechen row instead of pushing it down. A plain static
  // checkbox list avoids that entirely and shows every option at a glance.
  function attachDependsOnEdit(container, editBtn, { currentIds }) {
    if (!isWriter) return;
    editBtn.hidden = false;
    editBtn.onclick = () => {
      editBtn.hidden = true;
      const options = allUseCases
        .filter((uc) => uc.id !== currentUseCase.id)
        .map((uc) => ({ value: uc.id, label: uc.name }))
        .sort((a, b) => a.label.localeCompare(b.label));

      const list = document.createElement("div");
      list.className = "depends-on-picker";
      const checkboxes = options.map((opt) => {
        const label = document.createElement("label");
        label.className = "ms-filter-option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = opt.value;
        checkbox.checked = currentIds.includes(opt.value);
        label.append(checkbox, document.createTextNode(opt.label));
        list.appendChild(label);
        return checkbox;
      });

      const actions = document.createElement("div");
      actions.className = "form-actions";
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn btn-ghost";
      cancelBtn.textContent = "Abbrechen";
      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "btn btn-primary";
      saveBtn.textContent = "Speichern";
      actions.append(cancelBtn, saveBtn);
      container.replaceChildren(list, actions);

      cancelBtn.addEventListener("click", () => render(currentUseCase));
      saveBtn.addEventListener("click", async () => {
        const editingIds = checkboxes.filter((cb) => cb.checked).map((cb) => cb.value);
        await saveField({ depends_on: editingIds });
      });
    };
  }

  function render(uc) {
    document.title = uc.name;
    el("uc-name").textContent = uc.name;
    attachInputEdit(el("uc-name"), { fieldKey: "name", value: uc.name });
    el("uc-idea-initiator").textContent = uc.idea_initiator;
    attachInputEdit(el("uc-idea-initiator"), { fieldKey: "idea_initiator", value: uc.idea_initiator });

    const categoryChip = document.createElement("span");
    categoryChip.className = "chip attr-chip";
    const catColor = categoryColor(uc.use_category, options.use_category);
    categoryChip.style.background = catColor;
    categoryChip.style.color = textColorFor(catColor);
    categoryChip.textContent = uc.use_category_label;
    el("uc-use-category").replaceChildren(categoryChip);
    attachSelectEdit(el("uc-use-category"), {
      fieldKey: "use_category",
      value: uc.use_category,
      fieldOptions: options.use_category,
      withPoints: false,
    });

    renderVoteBreakdown(el("uc-economic-value"), uc);

    el("uc-value-added").replaceChildren(attrChip(uc.value_added_label, uc.value_added_points, options.value_added));
    attachSelectEdit(el("uc-value-added"), {
      fieldKey: "value_added",
      value: uc.value_added,
      fieldOptions: options.value_added,
      withPoints: true,
    });

    el("uc-development-time").replaceChildren(
      attrChip(uc.development_time_label, uc.development_time_points, options.development_time)
    );
    attachSelectEdit(el("uc-development-time"), {
      fieldKey: "development_time",
      value: uc.development_time,
      fieldOptions: options.development_time,
      withPoints: true,
    });

    el("uc-process-criticality").replaceChildren(
      attrChip(uc.process_criticality_label, uc.process_criticality_points, options.process_criticality)
    );
    attachSelectEdit(el("uc-process-criticality"), {
      fieldKey: "process_criticality",
      value: uc.process_criticality,
      fieldOptions: options.process_criticality,
      withPoints: true,
    });

    el("uc-process-dependency").replaceChildren(
      attrChip(uc.process_dependency_label, uc.process_dependency_points, options.process_dependency)
    );
    attachSelectEdit(el("uc-process-dependency"), {
      fieldKey: "process_dependency",
      value: uc.process_dependency,
      fieldOptions: options.process_dependency,
      withPoints: true,
    });

    el("uc-ai-feasibility").replaceChildren(
      attrChip(uc.ai_feasibility_label, uc.ai_feasibility_rank, options.ai_feasibility, "rank")
    );
    attachSelectEdit(el("uc-ai-feasibility"), {
      fieldKey: "ai_feasibility",
      value: uc.ai_feasibility,
      fieldOptions: options.ai_feasibility,
      withPoints: true,
    });

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
    attachDateEdit(el("uc-golive"), { fieldKey: "golive_date", value: uc.golive_date });

    for (const [containerId, fieldKey, text] of [
      ["uc-description", "description", uc.description],
      ["uc-value-added-description", "value_added_description", uc.value_added_description],
    ]) {
      const container = el(containerId);
      renderStructuredText(container, text);
      if (!container.children.length) {
        container.textContent = "–";
        container.className = "muted-text";
      } else {
        container.className = "detail-text";
      }
      attachTextEdit(container, { fieldKey, rawValue: text });
    }

    renderLinkList(el("uc-depends-on"), uc.depends_on, uc.depends_on_names);
    attachDependsOnEdit(el("uc-depends-on"), el("uc-depends-on-edit"), { currentIds: uc.depends_on });
    renderLinkList(el("uc-dependents"), uc.dependent_ids, uc.dependent_names);

    const statusEl = el("uc-status");
    statusEl.replaceChildren();
    const statusChip = document.createElement("span");
    statusChip.className = "chip status-chip";
    statusChip.textContent = STATUS_LABELS[uc.status] || uc.status;
    statusEl.appendChild(statusChip);
    if (uc.prioritized_round) {
      const roundInfo = document.createElement("p");
      roundInfo.className = "muted-text";
      roundInfo.textContent = `Priorisiert: ${uc.prioritized_round} (${formatDate(uc.prioritized_at.slice(0, 10))})`;
      statusEl.appendChild(roundInfo);
    }
    attachStatusEdit(statusEl, { value: uc.status });

    const candidateEl = el("uc-session-candidate");
    candidateEl.replaceChildren();
    if (isWriter) {
      const label = document.createElement("label");
      label.className = "checkbox-label";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = uc.is_session_candidate;
      checkbox.addEventListener("change", async () => {
        const wanted = checkbox.checked;
        const res = await fetch(`${window.API_BASE}/use-cases/${uc.id}/session-candidate`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidate: wanted }),
        });
        if (!res.ok) {
          alert("Konnte nicht gespeichert werden.");
          checkbox.checked = !wanted;
          return;
        }
        await loadUseCase();
      });
      label.append(checkbox, document.createTextNode(" Für Priorisierung vormerken"));
      candidateEl.appendChild(label);
      if (uc.vote_count < 6) {
        const warn = document.createElement("p");
        warn.className = "muted-text";
        warn.textContent = `Achtung: nicht vollständig bewertet (${uc.vote_count}/6 Stimmen)`;
        candidateEl.appendChild(warn);
      }
    } else {
      candidateEl.textContent = uc.is_session_candidate ? "Ja" : "Nein";
    }
  }

  async function loadUseCase() {
    const id = useCaseIdFromPath();
    const [me, uc, useCases, votes] = await Promise.all([
      fetch(`${window.API_BASE}/me`).then((r) => r.json()),
      fetch(`${window.API_BASE}/use-cases/${id}`).then((r) => r.json()),
      fetch(`${window.API_BASE}/use-cases`).then((r) => r.json()),
      fetch(`${window.API_BASE}/use-cases/${id}/votes`).then((r) => r.json()),
    ]);
    currentUseCase = uc;
    allUseCases = useCases;
    isWriter = me.is_writer;
    myDepartments = me.departments;
    voteData = votes;
    render(uc);
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
    Common.setupHelpPanels(options); // safe to call once here - no filters on this page competing for the scan

    el("uc-delete-link").addEventListener("click", deleteCurrentUseCase);

    await loadUseCase();
  })();
})();
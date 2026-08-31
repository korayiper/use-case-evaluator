// New-use-case form controller, used by the list page's
// "+ Neuer Anwendungsfall" flow. Editing existing use cases happens inline
// on the detail page instead (see use_case.js), not through this form.
window.UseCaseForm = (() => {
  "use strict";

  const { el, populateSelect, buildCheckboxDropdown } = Common;

  const SELECT_FIELDS = [
    { id: "f-value-added", key: "value_added", withPoints: true },
    { id: "f-development-time", key: "development_time", withPoints: true },
    { id: "f-process-criticality", key: "process_criticality", withPoints: true },
    { id: "f-process-dependency", key: "process_dependency", withPoints: true },
    { id: "f-use-category", key: "use_category", withPoints: false },
    { id: "f-ai-feasibility", key: "ai_feasibility", withPoints: true },
  ];

  const state = {
    options: null,
    useCases: [],
    formDependsOn: [],
    onSaved: null,
  };

  // Call once, when /api/options first resolves - populates the selects.
  // Doesn't wire help panels itself: the caller does that (via
  // Common.setupHelpPanels) once ALL of a page's help-btn/panel pairs exist
  // in the DOM - on the list page that's only true after setupFilters() has
  // also run, so this can't safely do it internally without either missing
  // the filter pairs or double-binding the form's if called again later.
  function setOptions(options) {
    state.options = options;
    for (const f of SELECT_FIELDS) populateSelect(f.id, options[f.key], f.withPoints);
  }

  // Call every time the use-case list (or its subset) is (re)loaded - just
  // updates the dependency picker's candidate list, no DOM side effects.
  function setUseCases(useCases) {
    state.useCases = useCases;
  }

  function buildDependencyPicker() {
    buildCheckboxDropdown(el("f-depends-on"), {
      options: state.useCases
        .map((uc) => ({ value: uc.id, label: uc.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      isSelected: (v) => state.formDependsOn.includes(v),
      onToggle: (v, checked) => {
        state.formDependsOn = checked
          ? [...state.formDependsOn, v]
          : state.formDependsOn.filter((x) => x !== v);
      },
      onClear: () => {
        state.formDependsOn = [];
      },
      toggleLabel: () =>
        state.formDependsOn.length === 0 ? "Keine Abhängigkeiten" : `${state.formDependsOn.length} ausgewählt`,
    });
  }

  function close() {
    const panel = el("add-panel");
    panel.hidden = true;
    el("add-form").reset();
    el("form-error").hidden = true;
    state.formDependsOn = [];
  }

  function openAdd() {
    state.formDependsOn = [];
    el("add-form").reset();
    el("form-error").hidden = true;
    el("add-panel").hidden = false;
    buildDependencyPicker();
    el("f-name").focus();
  }

  // onSaved(): called after a successful create, once the panel is already
  // closed - the caller decides what "refresh" means for its page.
  function init({ onSaved }) {
    state.onSaved = onSaved;
    el("cancel-add").addEventListener("click", close);

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
        depends_on: state.formDependsOn,
      };

      const res = await fetch(`${window.API_BASE}/use-cases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        errorEl.textContent = body.detail
          ? typeof body.detail === "string"
            ? body.detail
            : JSON.stringify(body.detail)
          : "Der Anwendungsfall konnte nicht gespeichert werden. Bitte Eingaben prüfen.";
        errorEl.hidden = false;
        return;
      }

      close();
      if (state.onSaved) await state.onSaved();
    });
  }

  return { setOptions, setUseCases, openAdd, close, init };
})();

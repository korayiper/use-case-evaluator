// Shared helpers used by every page's script (app.js, use_case.js, board.js) -
// color/format math and the structured-text renderer. Kept in one place so a
// tuning pass (e.g. a color-contrast fix) only has to happen once.
window.Common = (() => {
  "use strict";

  const LOCALE = "de-DE";

  // Sequential blue ramp (ordinal-safe subset of the palette's 100-700 ramp),
  // used for the aggregate priority (magnitude, not "good/bad").
  const PRIORITY_RAMP = [
    "#86b6ef", "#6da7ec", "#5598e7", "#3987e5",
    "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#0d366b",
  ];

  // Status ramp (worst -> best) for the scored attributes: red = few
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
    "#e34948", // red - was aqua, too close to green at a glance (5th slot = autonomer agent)
    "#eb6834", // orange
    "#4a3aa7", // violet
    "#1baf7a", // aqua
  ];

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
  // scored attributes, or "rank" for attributes like ai_feasibility whose
  // points are always 0 and can't tell classes apart.
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

  function categoryColor(value, useCategoryOptions) {
    const idx = useCategoryOptions.findIndex((o) => o.value === value);
    return CATEGORY_PALETTE[Math.max(0, idx) % CATEGORY_PALETTE.length];
  }

  function formatDate(isoDate) {
    return new Date(isoDate).toLocaleDateString(LOCALE, { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  const SVG_NS = "http://www.w3.org/2000/svg";

  function svgEl(tag, attrs = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  // Positions the shared #tooltip div near the cursor, flipping to the other
  // side of the pointer if it would overflow the viewport. Content-building
  // stays page-specific (what a tooltip shows differs per chart); this is
  // just the generic placement math.
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

  // Convention: blank-line-separated blocks -> <p>; a block becomes a <ul> of
  // <li> only if every non-empty line in it starts with "-" or "*" (marker +
  // following whitespace stripped); otherwise its lines join into one <p>.
  // Pure DOM construction - only ever textContent, never innerHTML with
  // user-supplied text.
  function renderStructuredText(container, text) {
    container.innerHTML = "";
    if (!text) return;
    for (const block of text.trim().split(/\n\s*\n/)) {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!lines.length) continue;
      if (lines.every((l) => /^[-*]\s+/.test(l))) {
        const ul = document.createElement("ul");
        for (const line of lines) {
          const li = document.createElement("li");
          li.textContent = line.replace(/^[-*]\s+/, "");
          ul.appendChild(li);
        }
        container.appendChild(ul);
      } else {
        const p = document.createElement("p");
        p.textContent = lines.join(" ");
        container.appendChild(p);
      }
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

  function closeAllFilterMenus() {
    document.querySelectorAll(".ms-filter-menu").forEach((m) => (m.hidden = true));
    document.querySelectorAll(".ms-filter-toggle").forEach((b) => b.classList.remove("active"));
  }

  // Generic checkbox-dropdown builder, shared by the filter bar and the
  // dependency picker. Selection state lives with the caller (via the
  // isSelected/onToggle/onClear callbacks) rather than in this function, so
  // it has no opinion on what's being selected. The change handler passes
  // back `opt.value` (the closed-over original, possibly-numeric value),
  // never `checkbox.value` (which DOM-stringifies it) - callers that compare
  // ids with strict equality (like dependency ids) depend on this.
  function buildCheckboxDropdown(container, { options, isSelected, onToggle, onClear, toggleLabel, help }) {
    container.className = "ms-filter";
    container.innerHTML = "";

    const headerRow = document.createElement("div");
    headerRow.className = "ms-filter-header";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "ms-filter-toggle";
    toggle.textContent = toggleLabel();
    headerRow.appendChild(toggle);

    if (help) {
      const panelId = `help-panel-filter-${help.field}`;
      const helpBtn = document.createElement("button");
      helpBtn.type = "button";
      helpBtn.className = "help-btn";
      helpBtn.dataset.help = help.field;
      helpBtn.dataset.panel = panelId;
      helpBtn.hidden = true; // setupHelpPanels() unhides it once populated
      helpBtn.textContent = "Was bedeutet das?";
      headerRow.appendChild(helpBtn);
    }
    container.appendChild(headerRow);

    if (help) {
      const panel = document.createElement("div");
      panel.className = "help-panel";
      panel.id = `help-panel-filter-${help.field}`;
      panel.hidden = true;
      container.appendChild(panel);
    }

    const menu = document.createElement("div");
    menu.className = "ms-filter-menu";
    menu.hidden = true;

    for (const opt of options) {
      const label = document.createElement("label");
      label.className = "ms-filter-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = isSelected(opt.value);
      checkbox.addEventListener("change", () => {
        onToggle(opt.value, checkbox.checked);
        toggle.textContent = toggleLabel();
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
      onClear();
      menu.querySelectorAll("input[type=checkbox]").forEach((cb) => (cb.checked = false));
      toggle.textContent = toggleLabel();
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

    return { toggle, menu };
  }

  // Wires up every help-btn/panel pair currently in the document, however
  // many exist per field - the add/edit form has one, each filter has its
  // own. Each button points at its own panel via data-panel (not DOM
  // adjacency: the form's button lives inside .field-label-row while its
  // panel is a sibling of that wrapper one level up - not next to each
  // other). Callers re-run this whenever new help-btn/panel pairs appear.
  function setupHelpPanels(options) {
    document.querySelectorAll(".help-btn[data-help]").forEach((btn) => {
      const field = btn.dataset.help;
      const panel = el(btn.dataset.panel);
      if (!panel) return;
      const helpOptions = options[field].filter((o) => o.help);
      const description = (options.descriptions || {})[field];
      if (helpOptions.length === 0 && !description) {
        btn.hidden = true;
        return;
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
    });
  }

  return {
    LOCALE,
    PRIORITY_RAMP,
    STATUS_STOPS,
    CATEGORY_PALETTE,
    el,
    colorFromRamp,
    statusColor,
    pointsRange,
    statusColorForPoints,
    toRgbTriple,
    textColorFor,
    priorityColor,
    categoryColor,
    formatDate,
    renderStructuredText,
    populateSelect,
    closeAllFilterMenus,
    buildCheckboxDropdown,
    setupHelpPanels,
    svgEl,
    moveTooltip,
    hideTooltip,
  };
})();

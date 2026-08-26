/* ============================================================
   TripMate AI — frontend
   Talks to:  POST /api/travel  { message, thread_id }
              GET  /health
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- dom ---------------- */

  var $ = function (id) { return document.getElementById(id); };

  var conversation = $("conversation");
  var messages     = $("messages");
  var hero         = $("hero");
  var input        = $("input");
  var composer     = $("composer");
  var sendBtn      = $("sendBtn");
  var builder      = $("builder");
  var sidebar      = $("sidebar");
  var scrim        = $("sidebarScrim");
  var tripList     = $("tripList");
  var tripListEmpty= $("tripListEmpty");
  var threadTitle  = $("threadTitle");
  var threadMeta   = $("threadMeta");
  var callsPill    = $("callsPill");
  var callsCount   = $("callsCount");
  var toastEl      = $("toast");

  /* ---------------- state ---------------- */

  var STORE_KEY = "tripmate.trips.v1";
  var THEME_KEY = "tripmate.theme";

  var trips = [];        // [{ id, threadId, title, updatedAt, turns: [{ q, result }] }]
  var activeId = null;
  var busy = false;

  var AGENTS = [
    { key: "flight",    label: "Flight agent",    hint: "Resolving airports, routes and fares" },
    { key: "hotel",     label: "Hotel agent",     hint: "Searching stays near your area" },
    { key: "weather",   label: "Weather agent",   hint: "Fetching current conditions and forecast" },
    { key: "itinerary", label: "Itinerary agent", hint: "Drafting a day-by-day plan" },
    { key: "final",     label: "Final agent",     hint: "Assembling your complete trip plan" }
  ];

  // rough share of total runtime per agent, used only to animate the stepper
  var AGENT_WEIGHTS = [0.22, 0.18, 0.14, 0.23, 0.23];
  var ESTIMATED_MS = 55000;

  /* ---------------- utils ---------------- */

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function icon(paths, cls) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    if (cls) svg.setAttribute("class", cls);
    var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", paths);
    svg.appendChild(p);
    return svg;
  }

  var toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    requestAnimationFrame(function () { toastEl.classList.add("show"); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("show");
      setTimeout(function () { toastEl.hidden = true; }, 250);
    }, 2400);
  }

  function scrollToEnd(smooth) {
    requestAnimationFrame(function () {
      conversation.scrollTo({ top: conversation.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    });
  }

  function titleFrom(text) {
    var t = String(text).replace(/\s+/g, " ").trim();
    return t.length > 46 ? t.slice(0, 46).trim() + "…" : t;
  }

  function formatWhen(ts) {
    var diff = Date.now() - ts;
    var min = Math.floor(diff / 60000);
    if (min < 1) return "just now";
    if (min < 60) return min + "m ago";
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + "h ago";
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  /* ---------------- storage ---------------- */

  function loadTrips() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      trips = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(trips)) trips = [];
    } catch (e) {
      trips = [];
    }
  }

  function saveTrips() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(trips.slice(0, 30)));
    } catch (e) {
      /* quota — not fatal, the session still works */
    }
  }

  function currentTrip() {
    for (var i = 0; i < trips.length; i++) {
      if (trips[i].id === activeId) return trips[i];
    }
    return null;
  }

  /* ---------------- theme ---------------- */

  function initTheme() {
    var stored = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch (e) {}
    var prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
    var theme = stored || (prefersLight ? "light" : "dark");
    document.documentElement.setAttribute("data-theme", theme);
  }

  $("themeToggle").addEventListener("click", function () {
    var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  });

  /* ---------------- sidebar (mobile) ---------------- */

  function openSidebar(open) {
    sidebar.classList.toggle("open", open);
    scrim.hidden = !open;
  }

  $("menuBtn").addEventListener("click", function () { openSidebar(true); });
  $("sidebarClose").addEventListener("click", function () { openSidebar(false); });
  scrim.addEventListener("click", function () { openSidebar(false); });

  /* ---------------- health ---------------- */

  function checkHealth() {
    var box = $("apiStatus");
    var dotText = box.querySelector(".status-text");

    fetch("/health", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)); })
      .then(function () {
        box.setAttribute("data-state", "ok");
        dotText.textContent = "API connected";
      })
      .catch(function () {
        box.setAttribute("data-state", "down");
        dotText.textContent = "API unreachable";
      });
  }

  /* ---------------- trip list ---------------- */

  function renderTripList() {
    tripList.innerHTML = "";
    tripListEmpty.hidden = trips.length > 0;

    trips.forEach(function (trip) {
      var li = el("li");
      var btn = el("button", "trip-item" + (trip.id === activeId ? " active" : ""));
      btn.type = "button";
      btn.title = trip.title;

      btn.appendChild(el("span", null, trip.title));

      var del = el("button", "trip-del", "×");
      del.type = "button";
      del.setAttribute("aria-label", "Delete trip");
      del.addEventListener("click", function (e) {
        e.stopPropagation();
        trips = trips.filter(function (t) { return t.id !== trip.id; });
        saveTrips();
        if (activeId === trip.id) startNewTrip();
        else renderTripList();
      });

      btn.appendChild(del);
      btn.addEventListener("click", function () {
        if (busy) { toast("Wait for the current plan to finish."); return; }
        openTrip(trip.id);
        openSidebar(false);
      });

      li.appendChild(btn);
      tripList.appendChild(li);
    });
  }

  /* ---------------- header ---------------- */

  function updateHeader() {
    var trip = currentTrip();

    if (!trip) {
      threadTitle.textContent = "New trip";
      threadMeta.textContent = "Describe where you want to go — five agents take it from there.";
      callsPill.hidden = true;
      return;
    }

    threadTitle.textContent = trip.title;

    var calls = 0;
    trip.turns.forEach(function (t) { calls += (t.result && t.result.llm_calls) || 0; });

    var bits = [trip.turns.length + (trip.turns.length === 1 ? " request" : " requests")];
    if (trip.updatedAt) bits.push(formatWhen(trip.updatedAt));
    if (trip.threadId) bits.push("thread " + String(trip.threadId).slice(-6));
    threadMeta.textContent = bits.join(" · ");

    callsPill.hidden = calls === 0;
    callsCount.textContent = calls;
  }

  /* ---------------- message rendering ---------------- */

  function renderUser(text) {
    var wrap = el("div", "msg msg-user");
    wrap.appendChild(el("div", "bubble-user", text));
    messages.appendChild(wrap);
    return wrap;
  }

  /* Agent fields are not always strings: MCP tools return content blocks
     (arrays of {type,text}) and raw tool payloads (objects). Coerce anything
     into renderable text rather than assuming .trim() exists. */
  function toText(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);

    if (Array.isArray(value)) {
      return value.map(toText).filter(Boolean).join("\n\n");
    }

    if (typeof value === "object") {
      // LangChain / MCP content block shapes
      if (typeof value.text === "string") return value.text;
      if (typeof value.content === "string") return value.content;
      if (Array.isArray(value.content)) return toText(value.content);

      try {
        return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
      } catch (e) {
        return String(value);
      }
    }

    return String(value);
  }

  function mdBlock(source, emptyText) {
    var box = el("div", "md");
    var text = toText(source).trim();

    if (!text) {
      var empty = el("div", "md-empty");
      empty.appendChild(icon("M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"));
      empty.appendChild(el("span", null, emptyText || "No data returned for this section."));
      box.appendChild(empty);
      return box;
    }

    box.innerHTML = window.MD.render(text);
    return box;
  }

  function toolButton(label, pathD, handler) {
    var b = el("button", "icon-btn sm");
    b.type = "button";
    b.title = label;
    b.setAttribute("aria-label", label);
    b.appendChild(icon(pathD));
    b.addEventListener("click", handler);
    return b;
  }

  function plainTextOf(result) {
    var out = ["# " + (result.__query || "Trip plan"), "", toText(result.answer)];

    [
      ["Itinerary", result.itinerary],
      ["Flights",   result.flight_results],
      ["Hotels",    result.hotel_results],
      ["Weather",   result.weather_results]
    ].forEach(function (pair) {
      var body = toText(pair[1]).trim();
      if (body) out.push("", "---", "", "## " + pair[0], "", body);
    });

    return out.join("\n");
  }

  function renderResult(result) {
    var card = el("article", "card");

    /* head */
    var head = el("div", "card-head");
    var avatar = el("div", "card-avatar");
    avatar.appendChild(icon("M17.8 19.2 16 11l3.5-3.5a2.1 2.1 0 0 0-3-3L13 8 4.8 6.2a.8.8 0 0 0-.8 1.3L8 11l-2 2-2.2-.5a.6.6 0 0 0-.6 1L5 16l2.5 1.8a.6.6 0 0 0 1-.6L8 15l2-2 3.5 4a.8.8 0 0 0 1.3-.8Z"));
    head.appendChild(avatar);

    var titleBox = el("div", "card-title");
    titleBox.appendChild(el("strong", null, "TripMate AI"));
    titleBox.appendChild(el("small", null,
      "Plan ready" + (result.llm_calls ? " · " + result.llm_calls + " LLM calls" : "")));
    head.appendChild(titleBox);

    var tools = el("div", "card-tools");

    tools.appendChild(toolButton("Copy plan", "M8 4h10a2 2 0 0 1 2 2v10M16 8H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2Z", function () {
      var text = plainTextOf(result);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { toast("Plan copied to clipboard"); },
          function () { toast("Could not copy"); }
        );
      } else {
        toast("Clipboard not available");
      }
    }));

    tools.appendChild(toolButton("Download as Markdown", "M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2", function () {
      var blob = new Blob([plainTextOf(result)], { type: "text/markdown;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "tripmate-plan.md";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }));

    tools.appendChild(toolButton("Print", "M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M6 14h12v7H6z", function () {
      window.print();
    }));

    head.appendChild(tools);
    card.appendChild(head);

    /* tabs */
    var sections = [
      { id: "plan",      label: "Plan",      dot: "dot-final",     content: result.answer,          empty: "The agent returned an empty response." },
      { id: "itinerary", label: "Itinerary", dot: "dot-itinerary", content: result.itinerary,       empty: "No itinerary was generated." },
      { id: "flights",   label: "Flights",   dot: "dot-flight",    content: result.flight_results,  empty: "No flight data returned." },
      { id: "hotels",    label: "Hotels",    dot: "dot-hotel",     content: result.hotel_results,   empty: "No hotel data returned." },
      { id: "weather",   label: "Weather",   dot: "dot-weather",   content: result.weather_results, empty: "No weather data returned. Add \"weather_results\" to the /api/travel response to show it here." }
    ];

    var tabsBar = el("div", "tabs");
    tabsBar.setAttribute("role", "tablist");
    var panels = [];

    sections.forEach(function (section, index) {
      var tab = el("button", "tab" + (index === 0 ? " active" : ""));
      tab.type = "button";
      tab.setAttribute("role", "tab");
      tab.appendChild(el("span", "dot " + section.dot));
      tab.appendChild(el("span", null, section.label));

      var panel = el("div", "panel" + (index === 0 ? " active" : ""));
      panel.setAttribute("role", "tabpanel");
      panel.appendChild(mdBlock(section.content, section.empty));

      tab.addEventListener("click", function () {
        tabsBar.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
        panels.forEach(function (p) { p.classList.remove("active"); });
        tab.classList.add("active");
        panel.classList.add("active");
      });

      tabsBar.appendChild(tab);
      panels.push(panel);
    });

    card.appendChild(tabsBar);
    panels.forEach(function (p) { card.appendChild(p); });

    var wrap = el("div", "msg");
    wrap.appendChild(card);
    messages.appendChild(wrap);
    return wrap;
  }

  function renderError(message, kind) {
    var card = el("article", "card error-card");
    var body = el("div", "error-body");
    body.appendChild(icon("M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z", "error-ico"));

    var copy = {
      server: {
        title: "The planner could not finish",
        detail: "The request reached the server but the agent run failed. Check the uvicorn console for the full traceback."
      },
      network: {
        title: "Could not reach the server",
        detail: "The request never completed. Check that uvicorn is still running."
      },
      render: {
        title: "The plan came back, but could not be displayed",
        detail: "The agents returned data in an unexpected shape. This is a frontend issue, not an agent failure."
      }
    }[kind || "server"];

    var textBox = el("div");
    textBox.appendChild(el("strong", null, copy.title));
    textBox.appendChild(el("p", null, copy.detail));
    textBox.appendChild(el("code", null, message));
    body.appendChild(textBox);

    card.appendChild(body);

    var wrap = el("div", "msg");
    wrap.appendChild(card);
    messages.appendChild(wrap);
    return wrap;
  }

  /* ---------------- pipeline (loading state) ---------------- */

  function renderPipeline() {
    var card = el("article", "card");
    var box = el("div", "pipeline");

    var head = el("div", "pipeline-head");
    head.appendChild(el("strong", null, "Agents are working"));
    var timer = el("span", null, "0s");
    head.appendChild(timer);
    box.appendChild(head);

    var steps = el("div", "steps");
    var nodes = AGENTS.map(function (agent) {
      var row = el("div", "step");
      row.appendChild(el("div", "step-icon"));
      var label = el("div", "step-label");
      label.appendChild(el("span", null, agent.label));
      row.appendChild(label);
      steps.appendChild(row);
      return row;
    });
    box.appendChild(steps);

    var track = el("div", "progress-track");
    var fill = el("div", "progress-fill");
    track.appendChild(fill);
    box.appendChild(track);

    card.appendChild(box);
    var wrap = el("div", "msg");
    wrap.appendChild(card);
    messages.appendChild(wrap);

    /* The backend returns one response at the end, so this stepper is an
       estimate of progress, not a live feed of agent events. */
    var started = Date.now();
    var current = -1;

    function advanceTo(index) {
      if (index === current) return;
      current = index;
      nodes.forEach(function (node, i) {
        node.classList.toggle("is-done", i < index);
        node.classList.toggle("is-active", i === index);
      });
      if (AGENTS[index]) head.querySelector("strong").textContent = AGENTS[index].hint;
    }

    advanceTo(0);

    var tick = setInterval(function () {
      var elapsed = Date.now() - started;
      timer.textContent = Math.floor(elapsed / 1000) + "s";

      var ratio = Math.min(elapsed / ESTIMATED_MS, 0.97);
      fill.style.width = (ratio * 100).toFixed(1) + "%";

      var acc = 0;
      var index = AGENTS.length - 1;
      for (var i = 0; i < AGENT_WEIGHTS.length; i++) {
        acc += AGENT_WEIGHTS[i];
        if (ratio < acc) { index = i; break; }
      }
      advanceTo(index);
    }, 500);

    return {
      node: wrap,
      finish: function () {
        clearInterval(tick);
        fill.style.width = "100%";
      }
    };
  }

  /* ---------------- sending ---------------- */

  function setBusy(state) {
    busy = state;
    sendBtn.disabled = state;
    sendBtn.classList.toggle("is-busy", state);
    input.disabled = state;
  }

  function send(text) {
    if (busy) return;

    var message = String(text == null ? input.value : text).trim();
    if (!message) return;

    hero.classList.add("is-hidden");
    input.value = "";
    autosize();
    setBusy(true);

    var trip = currentTrip();
    if (!trip) {
      trip = {
        id: "t_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        threadId: null,
        title: titleFrom(message),
        updatedAt: Date.now(),
        turns: []
      };
      trips.unshift(trip);
      activeId = trip.id;
      renderTripList();
    }

    renderUser(message);
    var pipeline = renderPipeline();
    scrollToEnd(true);

    fetch("/api/travel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: message, thread_id: trip.threadId })
    })
      .catch(function (e) {
        e.__kind = "network";
        throw e;
      })
      .then(function (response) {
        return response.json()
          .catch(function () { throw new Error("Server returned a non-JSON response (HTTP " + response.status + ")"); })
          .then(function (data) {
            if (!response.ok || data.success === false) {
              throw new Error(data.error || ("Request failed with HTTP " + response.status));
            }
            return data;
          });
      })
      .then(function (data) {
        pipeline.finish();
        pipeline.node.remove();

        data.__query = message;
        trip.threadId = data.thread_id || trip.threadId;
        trip.updatedAt = Date.now();
        trip.turns.push({ q: message, result: data });
        saveTrips();

        // A rendering bug here must not be reported as an agent failure.
        try {
          renderResult(data);
        } catch (e) {
          console.error("renderResult failed", e, data);
          renderError(e.message || String(e), "render");
        }

        renderTripList();
        updateHeader();
        scrollToEnd(true);
      })
      .catch(function (err) {
        pipeline.finish();
        if (pipeline.node.parentNode) pipeline.node.remove();
        renderError(err.message || String(err), err.__kind || "server");
        scrollToEnd(true);
        checkHealth();
      })
      .then(function () {
        setBusy(false);
        input.focus();
      });
  }

  /* ---------------- trips ---------------- */

  function startNewTrip() {
    activeId = null;
    messages.innerHTML = "";
    hero.classList.remove("is-hidden");
    renderTripList();
    updateHeader();
    input.focus();
  }

  function openTrip(id) {
    activeId = id;
    var trip = currentTrip();
    messages.innerHTML = "";

    if (!trip) return startNewTrip();

    hero.classList.add("is-hidden");
    trip.turns.forEach(function (turn) {
      renderUser(turn.q);
      renderResult(turn.result);
    });

    renderTripList();
    updateHeader();
    scrollToEnd(false);
  }

  $("newTripBtn").addEventListener("click", function () {
    if (busy) { toast("Wait for the current plan to finish."); return; }
    startNewTrip();
    openSidebar(false);
  });

  /* ---------------- composer ---------------- */

  function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 200) + "px";
  }

  input.addEventListener("input", autosize);

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  composer.addEventListener("submit", function (e) {
    e.preventDefault();
    send();
  });

  document.querySelectorAll(".suggestion").forEach(function (btn) {
    btn.addEventListener("click", function () {
      send(btn.getAttribute("data-prompt"));
    });
  });

  /* ---------------- trip builder ---------------- */

  var builderToggle = $("builderToggle");

  builderToggle.addEventListener("click", function () {
    var show = builder.hidden;
    builder.hidden = !show;
    builderToggle.classList.toggle("is-on", show);
    if (show) $("fFrom").focus();
  });

  document.querySelectorAll("#interestChips .chip").forEach(function (chip) {
    chip.addEventListener("click", function () { chip.classList.toggle("on"); });
  });

  $("builderClear").addEventListener("click", function () {
    ["fFrom", "fTo", "fDate", "fDays", "fPeople", "fBudget"].forEach(function (id) { $(id).value = ""; });
    document.querySelectorAll("#interestChips .chip").forEach(function (c) { c.classList.remove("on"); });
  });

  $("builderApply").addEventListener("click", function () {
    var from    = $("fFrom").value.trim();
    var to      = $("fTo").value.trim();
    var date    = $("fDate").value;
    var days    = $("fDays").value.trim();
    var people  = $("fPeople").value.trim();
    var budget  = $("fBudget").value.trim();

    var interests = [];
    document.querySelectorAll("#interestChips .chip.on").forEach(function (c) {
      interests.push(c.getAttribute("data-value"));
    });

    if (!to) {
      toast("Add a destination first.");
      $("fTo").focus();
      return;
    }

    var parts = ["Plan a"];
    if (days) parts.push(days + " day");
    parts.push("trip to " + to);
    if (from) parts.push("from " + from);

    if (date) {
      var d = new Date(date + "T00:00:00");
      if (!isNaN(d)) {
        parts.push("departing " + d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }));
      }
    }

    if (people) parts.push("for " + people + (people === "1" ? " traveller" : " travellers"));
    if (budget) parts.push("with a budget of " + budget);
    if (interests.length) parts.push("focused on " + interests.join(", "));

    var sentence = parts.join(" ") + ". Find flights, hotels, the weather outlook and a day-by-day itinerary.";

    input.value = sentence;
    autosize();
    builder.hidden = true;
    builderToggle.classList.remove("is-on");
    input.focus();
  });

  /* ---------------- boot ---------------- */

  initTheme();
  loadTrips();
  renderTripList();
  updateHeader();
  checkHealth();
  setInterval(checkHealth, 60000);
  autosize();
  input.focus();
})();

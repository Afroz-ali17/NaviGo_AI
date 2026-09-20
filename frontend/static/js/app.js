/* ============================================================
   NaviGo AI — frontend
   Talks to:  POST   /api/travel  { message, thread_id }
              GET    /api/config          credential status
              POST   /api/config          set session keys
              DELETE /api/config          fall back to server .env
              GET    /health
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
  var toastEl      = $("toast");

  var composerWrap = document.querySelector(".composer-wrap");

  var statusBtn    = $("apiStatus");
  var statusText   = statusBtn.querySelector(".status-text");

  var setupGate    = $("setupGate");
  var gateCreds    = $("gateCreds");
  var gateSub      = $("gateSub");
  var gateSave     = $("gateSave");

  var settingsModal = $("settingsModal");
  var settingsScrim = $("settingsScrim");
  var credList      = $("credList");
  var settingsSave  = $("settingsSave");

  /* ---------------- state ---------------- */

  var THEME_KEY = "navigo.theme";

  var threadId = null;   // LangGraph conversation thread for the current trip
  var busy = false;
  var config = null;     // last /api/config payload
  var savingConfig = false;

  /* One bar, not five rows. The backend answers once at the end, so these
     weights are an estimate of how long each stage takes - the label is
     indicative, not a live event feed. */
  var PHASES = [
    { label: "Fetching flights data",                weight: 0.18 },
    { label: "Searching train options (IRCTC / Rail)", weight: 0.18 },
    { label: "Searching hotels",                     weight: 0.18 },
    { label: "Checking the weather",                 weight: 0.14 },
    { label: "Building your itinerary",              weight: 0.16 },
    { label: "Writing your final plan",              weight: 0.16 }
  ];

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
    }, 2800);
  }

  function scrollToEnd(smooth) {
    requestAnimationFrame(function () {
      conversation.scrollTo({ top: conversation.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    });
  }

  /* ---------------- theme ---------------- */

  function initTheme() {
    var stored = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch (e) {}
    var prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
    document.documentElement.setAttribute("data-theme", stored || (prefersLight ? "light" : "dark"));
  }

  $("themeToggle").addEventListener("click", function () {
    var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  });

  /* ============================================================
     credentials / settings
     ============================================================ */

  function isReady() {
    return !!(config && config.ready);
  }

  /* The hero, the setup gate and the composer lock are all driven by one
     question: does the server have live credentials yet? */
  function updateEmptyState() {
    var hasMessages = messages.children.length > 0;
    var ready = isReady();

    setupGate.hidden = ready || hasMessages;
    hero.classList.toggle("is-hidden", !ready || hasMessages);

    composerWrap.classList.toggle("is-locked", !ready);
    input.disabled = !ready || busy;
    sendBtn.disabled = !ready || busy;
  }

  function applyConfig(data) {
    config = data;

    var missing = (data && data.missing) || [];

    if (data && data.ready) {
      statusBtn.setAttribute("data-state", "ok");
      statusText.textContent = "API connected";
      statusBtn.title = "All keys configured — open settings";
    } else {
      statusBtn.setAttribute("data-state", "setup");
      statusText.textContent = "No Live API";
      statusBtn.title = "No API keys configured — open settings";

      var labels = missing.map(function (name) {
        return (data.credentials[name] && data.credentials[name].label) || name;
      });

      gateSub.textContent = labels.length
        ? "The server has no " + joinAnd(labels) + " configured, so the agents cannot run. Add " +
          (labels.length === 1 ? "it" : "them") + " below to start planning."
        : "The server has no API keys configured, so the agents cannot run.";

      renderCreds(gateCreds);
    }

    if (!settingsModal.hidden) renderCreds(credList);

    updateEmptyState();
  }

  function joinAnd(list) {
    if (list.length <= 1) return list[0] || "";
    return list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
  }

  function markUnreachable() {
    config = null;
    statusBtn.setAttribute("data-state", "down");
    statusText.textContent = "API unreachable";
    statusBtn.title = "Could not reach the server";
    updateEmptyState();
  }

  function refreshConfig() {
    return fetch("/api/config", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)); })
      .then(applyConfig)
      .catch(markUnreachable);
  }

  /* Renders one row per credential into the given container, showing where
     the value comes from and letting the user override it for this session.
     Used by both the centred gate and the settings modal, so lookups are
     scoped to the container rather than done by global id. */
  function renderCreds(container) {
    container.innerHTML = "";

    if (!config || !config.credentials) {
      container.appendChild(el("p", "cred-loading", "Loading…"));
      return;
    }

    Object.keys(config.credentials).forEach(function (name) {
      var info = config.credentials[name];

      var row = el("div", "cred");

      var head = el("div", "cred-head");
      head.appendChild(el("label", "cred-label", info.label));

      var badgeText = info.source === "env" ? "From server .env"
                    : info.source === "session" ? "Set for this session"
                    : "Not configured";

      head.appendChild(el("span", "badge badge-" + (info.source || "missing"), badgeText));
      row.appendChild(head);

      row.appendChild(el("p", "cred-hint", info.hint));

      var field = el("div", "cred-field");
      var box = el("input", "cred-input");
      box.type = "password";
      box.placeholder = info.configured ? "•••••••• (leave blank to keep)" : info.placeholder;
      box.autocomplete = "off";
      box.spellcheck = false;
      box.setAttribute("data-cred", name);
      field.appendChild(box);

      var reveal = el("button", "icon-btn sm");
      reveal.type = "button";
      reveal.title = "Show / hide";
      reveal.setAttribute("aria-label", "Show or hide value");
      reveal.appendChild(icon("M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"));
      reveal.addEventListener("click", function () {
        box.type = box.type === "password" ? "text" : "password";
      });
      field.appendChild(reveal);

      row.appendChild(field);

      var err = el("p", "cred-error");
      err.setAttribute("data-error-for", name);
      err.hidden = true;
      row.appendChild(err);

      container.appendChild(row);
    });
  }

  var FIELD_BY_NAME = {
    GROQ_API_KEY: "groq_api_key",
    DATABASE_URL: "database_url"
  };

  var NAME_BY_FIELD = {
    groq_api_key: "GROQ_API_KEY",
    database_url: "DATABASE_URL"
  };

  function openSettings() {
    settingsModal.hidden = false;
    settingsScrim.hidden = false;
    renderCreds(credList);
    refreshConfig();

    var first = credList.querySelector(".cred-input");
    if (first) first.focus();
  }

  function closeSettings() {
    settingsModal.hidden = true;
    settingsScrim.hidden = true;
  }

  function setSavingConfig(state, button) {
    savingConfig = state;
    [settingsSave, gateSave].forEach(function (b) { b.disabled = state; });
    if (button) button.classList.toggle("is-busy", state);
  }

  function saveCredentials(container, button) {
    if (savingConfig) return;

    var payload = {};
    var anything = false;

    container.querySelectorAll(".cred-input").forEach(function (box) {
      var value = box.value.trim();
      if (!value) return;
      anything = true;
      payload[FIELD_BY_NAME[box.getAttribute("data-cred")]] = value;
    });

    container.querySelectorAll(".cred-error").forEach(function (n) { n.hidden = true; });

    if (!anything) {
      toast("Enter a key first.");
      var empty = container.querySelector(".cred-input");
      if (empty) empty.focus();
      return;
    }

    setSavingConfig(true, button);

    fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (response) {
        return response.json().then(function (data) { return { ok: response.ok, data: data }; });
      })
      .then(function (out) {
        if (!out.ok || out.data.success === false) {
          var errors = out.data.errors || {};
          var shown = 0;

          Object.keys(errors).forEach(function (field) {
            var node = container.querySelector('[data-error-for="' + NAME_BY_FIELD[field] + '"]');
            if (node) {
              node.textContent = errors[field];
              node.hidden = false;
              shown++;
            }
          });

          toast(shown ? "Check the highlighted field." : (out.data.error || "Could not save."));
          return;
        }

        applyConfig(out.data);
        toast(out.data.ready ? "Connected." : "Saved — one key still missing.");
      })
      .catch(function () {
        toast("Could not reach the server.");
      })
      .then(function () {
        setSavingConfig(false, button);
      });
  }

  function resetSettings() {
    if (savingConfig) return;
    setSavingConfig(true, settingsSave);

    fetch("/api/config", { method: "DELETE" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        applyConfig(data);
        renderCreds(credList);
        toast("Session keys cleared.");
      })
      .catch(function () { toast("Could not reach the server."); })
      .then(function () { setSavingConfig(false, settingsSave); });
  }

  $("settingsBtn").addEventListener("click", openSettings);
  statusBtn.addEventListener("click", openSettings);
  $("settingsClose").addEventListener("click", closeSettings);
  settingsScrim.addEventListener("click", closeSettings);
  settingsSave.addEventListener("click", function () { saveCredentials(credList, settingsSave); });
  gateSave.addEventListener("click", function () { saveCredentials(gateCreds, gateSave); });
  $("settingsReset").addEventListener("click", resetSettings);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !settingsModal.hidden) closeSettings();
  });

  /* ============================================================
     message rendering
     ============================================================ */

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
    return ["# " + (result.__query || "Trip plan"), "", toText(result.answer)].join("\n");
  }

  /* ---------------- interactive google maps (100% dynamic via API) ---------------- */

  var googleMapsApiKey = null;
  var googleMapsLoading = false;
  var googleMapsLoaded = false;
  var googleMapsCallbacks = [];

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  function loadGoogleMapsSdk(callback) {
    if (googleMapsLoaded && window.google && window.google.maps) {
      if (callback) callback();
      return;
    }
    if (callback) googleMapsCallbacks.push(callback);
    if (googleMapsLoading) return;
    googleMapsLoading = true;

    fetch("/api/maps/config")
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        if (!cfg || !cfg.enabled || !cfg.api_key) {
          googleMapsLoading = false;
          return;
        }
        googleMapsApiKey = cfg.api_key;
        var script = document.createElement("script");
        script.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(googleMapsApiKey) + "&libraries=places";
        script.async = true;
        script.defer = true;
        script.onload = function () {
          googleMapsLoaded = true;
          googleMapsLoading = false;
          while (googleMapsCallbacks.length) {
            var cb = googleMapsCallbacks.shift();
            try { cb(); } catch (e) { console.error("Maps callback error", e); }
          }
        };
        script.onerror = function () {
          googleMapsLoading = false;
          console.warn("Could not load Google Maps SDK script");
        };
        document.head.appendChild(script);
      })
      .catch(function (e) {
        googleMapsLoading = false;
        console.warn("Failed to fetch /api/maps/config", e);
      });
  }

  // Preload Google Maps SDK on startup
  loadGoogleMapsSdk();

  function extractTripPlaces(result) {
    var destination = "";
    var places = [];
    var seen = new Set();

    // 1. Extract destination city dynamically (no hardcoded cities)
    if (result.weather_results) {
      var cityMatch = String(result.weather_results).match(/"city":\s*"([^"]+)"/i);
      if (cityMatch && cityMatch[1]) {
        destination = cityMatch[1].trim();
      }
    }

    if (!destination && result.__query) {
      var toMatch = result.__query.match(/\bto\s+([A-Z][a-zA-Z\s]+?)(?:\s+from|\s+in|\s+with|\s+for|\s+on|,|\.|$)/i);
      if (toMatch && toMatch[1]) {
        destination = toMatch[1].trim();
      } else {
        var tripMatch = result.__query.match(/trip\s+to\s+([A-Z][a-zA-Z\s]+?)(?:\s+from|\s+in|\s+with|\s+for|\s+on|,|\.|$)/i);
        if (tripMatch && tripMatch[1]) destination = tripMatch[1].trim();
      }
    }

    if (!destination && result.itinerary) {
      var itinCityMatch = String(result.itinerary).match(/([A-Z][a-zA-Z\s]+?)\s+(?:Adventure|Itinerary|Trip|Getaway)/i);
      if (itinCityMatch && itinCityMatch[1]) destination = itinCityMatch[1].trim();
    }

    // 2. Extract hotels dynamically from hotel_results & markdown answer
    var hotelRegexes = [
      /\*\*(?:Hotel|Hostel|Resort|The\s+Local|Villa|Suites)\s+([^*]+?)\*\*/gi,
      /\*\*([^*]+?(?:Hotel|Hostel|Resort|Suites|Palace\s+Hotel))\*\*/gi
    ];
    for (var hr of hotelRegexes) {
      var bHotels = String(result.answer || "").matchAll(hr);
      for (var bh of bHotels) {
        var hName = (bh[1] || bh[0] || "").replace(/\*\*/g, "").trim();
        if (hName && hName.length > 3 && hName.length < 45 && !seen.has(hName.toLowerCase()) && places.length < 10) {
          seen.add(hName.toLowerCase());
          places.push({ name: hName, category: "hotel", label: "Hotel / Stay" });
        }
      }
    }

    if (result.hotel_results) {
      var rawHotels = String(result.hotel_results).matchAll(/(?:Hotel|Hostel|Resort|Suites|Inn)\s+([A-Za-z0-9\s\-&']{3,35})/gi);
      for (var rh of rawHotels) {
        var rName = (rh[0] || "").replace(/\\n|"/g, "").trim();
        if (rName && rName.length > 3 && !seen.has(rName.toLowerCase()) && places.length < 10) {
          seen.add(rName.toLowerCase());
          places.push({ name: rName, category: "hotel", label: "Hotel / Stay" });
        }
      }
    }

    // 3. Extract Sightseeing & Activities from Day-by-Day Itinerary dynamically
    var sightPatterns = [
      /\b(?:visit|explore|tour|see|stroll through)\s+([A-Z][a-zA-Z0-9\s\-&']{3,32}?)(?:\s*\(|\s*,|\s*\.|\s*—|\s*–|\s*\||\s*→|\s*<|\s*\n)/gi,
      /\b([A-Z][a-zA-Z\s]{2,28}?(?:Museum|Tower|Fort|Palace|Temple|Park|Gardens|Market|Mosque|Cathedral|Basilica|Castle|Colosseum|Shrine|Center|Square|Beach|Monument))\b/g
    ];

    for (var sp of sightPatterns) {
      var sMatches = String(result.answer || "").matchAll(sp);
      for (var sm of sMatches) {
        var sName = (sm[1] || sm[0] || "").replace(/^to\s+/i, "").trim();
        if (sName && sName.length > 3 && sName.length < 40 &&
            !/^(Flight|Morning|Afternoon|Evening|Hotel|Airport|Metro|Train|Railway|Option|Estimated|Total|Notes|Highlights|Schedule|Current|Forecast|Weather|Day\s*\d)/i.test(sName) &&
            !seen.has(sName.toLowerCase()) && places.length < 15) {
          seen.add(sName.toLowerCase());
          places.push({ name: sName, category: "sight", label: "Sight / Landmark" });
        }
      }
    }

    // 4. Extract Transit Hub dynamically
    var airportMatch = String(result.flight_results || result.answer || "").match(/([A-Z][a-zA-Z\s\-]{3,30}?\s*(?:Airport|International\s*Airport))\s*(?:\(([A-Z]{3})\))?/i);
    if (airportMatch && airportMatch[1]) {
      var apName = airportMatch[1].trim();
      if (!seen.has(apName.toLowerCase())) {
        seen.add(apName.toLowerCase());
        places.unshift({ name: apName, category: "transit", label: "Airport / Transit" });
      }
    }

    return {
      destination: destination,
      places: places
    };
  }

  function dynamicGeocode(address, callback) {
    if (window.google && window.google.maps && window.google.maps.Geocoder) {
      try {
        var gCoder = new google.maps.Geocoder();
        gCoder.geocode({ address: address }, function (results, status) {
          if (status === "OK" && results && results[0] && results[0].geometry) {
            var loc = results[0].geometry.location;
            callback({
              lat: loc.lat(),
              lng: loc.lng(),
              address: results[0].formatted_address || address
            });
            return;
          }
          fallbackGeocode(address, callback);
        });
        return;
      } catch (e) {
        fallbackGeocode(address, callback);
        return;
      }
    }
    fallbackGeocode(address, callback);
  }

  function fallbackGeocode(address, callback) {
    fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(address), {
      headers: { "Accept-Language": "en" }
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data && data.length > 0 && data[0].lat && data[0].lon) {
          callback({
            lat: parseFloat(data[0].lat),
            lng: parseFloat(data[0].lon),
            address: data[0].display_name
          });
        }
      })
      .catch(function (err) {
        console.warn("Geocoding failed for:", address, err);
      });
  }

  function renderMapCard(result, parentNode) {
    if (!googleMapsLoaded || !window.google || !window.google.maps) {
      loadGoogleMapsSdk(function () {
        renderMapCard(result, parentNode);
      });
      return;
    }

    var extracted = extractTripPlaces(result);
    var destination = extracted.destination;
    var places = extracted.places;

    if (!destination && places.length === 0) {
      return;
    }

    var section = el("section", "map-card-section");

    // Card Header
    var head = el("div", "map-card-header");
    var title = el("div", "map-card-title");
    title.innerHTML = '<span>📍</span><strong>Interactive Trip Map</strong>';
    var badge = el("span", "map-badge", destination ? destination : (places.length + " places"));
    title.appendChild(badge);
    head.appendChild(title);

    var actions = el("div", "map-card-actions");
    var fitBtn = el("button", "btn btn-ghost btn-sm", "Fit All Pins");
    fitBtn.type = "button";
    actions.appendChild(fitBtn);
    head.appendChild(actions);
    section.appendChild(head);

    // Map container
    var mapEl = el("div", "map-container");
    var loadingEl = el("div", "map-loading");
    loadingEl.innerHTML = '<span class="spinner"></span><span>Connecting to Google Maps API & geocoding locations…</span>';
    mapEl.appendChild(loadingEl);
    section.appendChild(mapEl);

    // Chips container
    var chipsEl = el("div", "map-chips-container");
    section.appendChild(chipsEl);

    parentNode.appendChild(section);

    // Initialize Google Map via API
    var bounds = new google.maps.LatLngBounds();
    var hasValidBounds = false;

    var isDark = document.documentElement.getAttribute("data-theme") === "dark";
    var darkMapStyle = isDark ? [
      { elementType: "geometry", stylers: [{ color: "#1e293b" }] },
      { elementType: "labels.text.stroke", stylers: [{ color: "#0f172a" }] },
      { elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
      { featureType: "road", elementType: "geometry", stylers: [{ color: "#334155" }] },
      { featureType: "water", elementType: "geometry", stylers: [{ color: "#0f172a" }] },
      { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#14532d" }] }
    ] : [];

    var map = new google.maps.Map(mapEl, {
      zoom: 12,
      center: { lat: 20.0, lng: 0.0 },
      styles: darkMapStyle,
      mapTypeControl: true,
      mapTypeControlOptions: {
        style: google.maps.MapTypeControlStyle.DROPDOWN_MENU
      },
      streetViewControl: true,
      fullscreenControl: true
    });

    var infoWindow = new google.maps.InfoWindow();

    fitBtn.addEventListener("click", function () {
      if (hasValidBounds) {
        map.fitBounds(bounds);
      }
    });

    var markerIcons = {
      hotel: "https://maps.google.com/mapfiles/ms/icons/purple-dot.png",
      sight: "https://maps.google.com/mapfiles/ms/icons/green-dot.png",
      transit: "https://maps.google.com/mapfiles/ms/icons/orange-dot.png"
    };

    // Geocode destination dynamically using Google Maps API (with dynamic fallback)
    var queryTarget = destination || (places.length ? places[0].name : "");
    if (queryTarget) {
      dynamicGeocode(queryTarget, function (destGeo) {
        if (loadingEl.parentNode) loadingEl.parentNode.removeChild(loadingEl);

        if (destGeo) {
          var destLatLng = new google.maps.LatLng(destGeo.lat, destGeo.lng);
          map.setCenter(destLatLng);
          map.setZoom(12);
          bounds.extend(destLatLng);
          hasValidBounds = true;
        }

        // Now geocode each place dynamically
        places.forEach(function (place) {
          var fullAddress = destination ? (place.name + ", " + destination) : place.name;
          dynamicGeocode(fullAddress, function (pGeo) {
            if (pGeo) {
              var pLatLng = new google.maps.LatLng(pGeo.lat, pGeo.lng);
              bounds.extend(pLatLng);
              hasValidBounds = true;
              map.fitBounds(bounds);

              var marker = new google.maps.Marker({
                map: map,
                position: pLatLng,
                title: place.name,
                icon: markerIcons[place.category] || markerIcons.sight,
                animation: google.maps.Animation.DROP
              });

              var dirUrl = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(fullAddress);
              var formattedAddr = pGeo.address || "";
              var contentHtml = '<div class="map-popup">' +
                '<span class="popup-cat ' + place.category + '">' + place.label + '</span>' +
                '<h4>' + escapeHtml(place.name) + '</h4>' +
                (formattedAddr ? '<p style="font-size:11.5px;color:#94a3b8;margin:2px 0 8px 0;">' + escapeHtml(formattedAddr) + '</p>' : '') +
                '<a href="' + dirUrl + '" target="_blank" rel="noopener noreferrer">Directions on Google Maps ↗</a>' +
                '</div>';

              function openThisMarker() {
                infoWindow.setContent(contentHtml);
                infoWindow.open(map, marker);
                map.panTo(pLatLng);
              }

              marker.addListener("click", openThisMarker);

              // Add quick-jump chip
              var chip = el("button", "map-place-chip");
              chip.type = "button";
              chip.innerHTML = '<span class="chip-dot ' + place.category + '"></span><span>' + escapeHtml(place.name) + '</span>';
              chip.addEventListener("click", openThisMarker);
              chipsEl.appendChild(chip);
            }
          });
        });
      });
    } else {
      if (loadingEl.parentNode) loadingEl.parentNode.removeChild(loadingEl);
    }
  }

  function renderResult(result) {
    var card = el("article", "card");

    /* head */
    var head = el("div", "card-head");
    var avatar = el("div", "card-avatar");
    avatar.appendChild(icon("M17.8 19.2 16 11l3.5-3.5a2.1 2.1 0 0 0-3-3L13 8 4.8 6.2a.8.8 0 0 0-.8 1.3L8 11l-2 2-2.2-.5a.6.6 0 0 0-.6 1L5 16l2.5 1.8a.6.6 0 0 0 1-.6L8 15l2-2 3.5 4a.8.8 0 0 0 1.3-.8Z"));
    head.appendChild(avatar);

    var titleBox = el("div", "card-title");
    titleBox.appendChild(el("strong", null, "NaviGo AI"));
    titleBox.appendChild(el("small", null, "Plan ready"));
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
      a.download = "navigo-plan.md";
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

    /* one message: the final assembled plan. The per-agent flight, hotel,
       weather and itinerary payloads still come back in the response and
       feed this answer, they are just not surfaced as separate tabs. */
    var body = el("div", "card-body");
    renderMapCard(result, body);
    body.appendChild(mdBlock(result.answer, "The agent returned an empty response."));
    card.appendChild(body);

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
        detail: "The request never completed. Check that the server is still running."
      },
      render: {
        title: "The plan came back, but could not be displayed",
        detail: "The agents returned data in an unexpected shape. This is a frontend issue, not an agent failure."
      },
      setup: {
        title: "Missing credentials",
        detail: "Add the required keys in Settings, or set them in the server's .env file."
      }
    }[kind || "server"];

    var textBox = el("div");
    textBox.appendChild(el("strong", null, copy.title));
    textBox.appendChild(el("p", null, copy.detail));
    textBox.appendChild(el("code", null, message));

    if (kind === "setup") {
      var open = el("button", "btn btn-soft btn-sm", "Open settings");
      open.type = "button";
      open.addEventListener("click", openSettings);
      textBox.appendChild(open);
    }

    body.appendChild(textBox);
    card.appendChild(body);

    var wrap = el("div", "msg");
    wrap.appendChild(card);
    messages.appendChild(wrap);
    return wrap;
  }

  /* ---------------- pipeline (loading state) ---------------- */

  function renderPipeline() {
    var card = el("article", "card progress-card");

    var head = el("div", "progress-head");
    var label = el("span", "progress-label", PHASES[0].label);
    var meta = el("span", "progress-meta");
    var pct = el("b", null, "0%");
    meta.appendChild(pct);
    meta.appendChild(el("span", "progress-sep", "·"));
    var timer = el("span", null, "0s");
    meta.appendChild(timer);
    head.appendChild(label);
    head.appendChild(meta);
    card.appendChild(head);

    var track = el("div", "progress-track");
    var fill = el("div", "progress-fill");
    track.appendChild(fill);
    card.appendChild(track);

    var wrap = el("div", "msg");
    wrap.appendChild(card);
    messages.appendChild(wrap);

    var started = Date.now();
    var currentPhase = -1;

    function tick() {
      var elapsed = Date.now() - started;

      // creep towards 97% so the bar never claims to be finished early
      var ratio = Math.min(elapsed / ESTIMATED_MS, 0.97);

      fill.style.width = (ratio * 100).toFixed(1) + "%";
      pct.textContent = Math.round(ratio * 100) + "%";
      timer.textContent = Math.floor(elapsed / 1000) + "s";

      var acc = 0;
      var index = PHASES.length - 1;
      for (var i = 0; i < PHASES.length; i++) {
        acc += PHASES[i].weight;
        if (ratio < acc) { index = i; break; }
      }

      if (index !== currentPhase) {
        currentPhase = index;
        label.textContent = PHASES[index].label;
      }
    }

    tick();
    var interval = setInterval(tick, 250);

    return {
      node: wrap,
      finish: function () {
        clearInterval(interval);
        fill.style.width = "100%";
        pct.textContent = "100%";
      }
    };
  }

  /* ---------------- sending ---------------- */

  function setBusy(state) {
    busy = state;
    sendBtn.classList.toggle("is-busy", state);
    updateEmptyState();
  }

  function send(text) {
    if (busy) return;

    var message = String(text == null ? input.value : text).trim();
    if (!message) return;

    if (!isReady()) {
      toast("No live API — add your keys first.");
      updateEmptyState();
      return;
    }

    input.value = "";
    autosize();
    setBusy(true);

    renderUser(message);
    updateEmptyState();
    var pipeline = renderPipeline();
    scrollToEnd(true);

    fetch("/api/travel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: message, thread_id: threadId })
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
              var err = new Error(data.error || ("Request failed with HTTP " + response.status));
              // 428 Precondition Required = a credential is missing.
              if (response.status === 428) err.__kind = "setup";
              throw err;
            }
            return data;
          });
      })
      .then(function (data) {
        pipeline.finish();
        pipeline.node.remove();

        data.__query = message;
        threadId = data.thread_id || threadId;

        // A rendering bug here must not be reported as an agent failure.
        try {
          renderResult(data);
        } catch (e) {
          console.error("renderResult failed", e, data);
          renderError(e.message || String(e), "render");
        }

        scrollToEnd(true);
      })
      .catch(function (err) {
        pipeline.finish();
        if (pipeline.node.parentNode) pipeline.node.remove();
        renderError(err.message || String(err), err.__kind || "server");
        scrollToEnd(true);
        refreshConfig();
      })
      .then(function () {
        setBusy(false);
        input.focus();
      });
  }

  /* ---------------- trips ---------------- */

  function startNewTrip() {
    if (busy) { toast("Wait for the current plan to finish."); return; }
    threadId = null;
    messages.innerHTML = "";
    updateEmptyState();
    if (isReady()) input.focus();
  }

  $("newTripBtn").addEventListener("click", startNewTrip);

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
  updateEmptyState();
  refreshConfig().then(function () {
    if (isReady()) input.focus();
  });
  setInterval(refreshConfig, 60000);
  autosize();
})();

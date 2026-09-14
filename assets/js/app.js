/* Jardévis — application devis & factures pour paysagistes.
   100% client-side, données dans le navigateur (localStorage).
   NOTE : v1 = stockage local (par appareil). La synchro cloud + comptes = phase 2 (backend). */
(function () {
  "use strict";

  var LS = "piscineo_v1";
  var FREE_LIMIT = 3; // documents max en gratuit

  /* ---------- Store ---------- */
  var db = load();
  var LOGGED_IN = !!localStorage.getItem("piscineo_token");
  function load() {
    try {
      var raw = localStorage.getItem(LS);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return {
      settings: {
        company: { nom: "", adresse: "", cp: "", ville: "", siret: "", tel: "", email: "", tvaNum: "", logo: "" },
        tva: 20, mentions: "", devisCounter: 1, factureCounter: 1, isPro: false, franchiseTva: false
      },
      clients: [],
      docs: []
    };
  }
  function save() { try { localStorage.setItem(LS, JSON.stringify(db)); } catch (e) {} }

  /* ---------- Helpers ---------- */
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(s) { return (s == null ? "" : String(s)).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function eur(n) { return (isFinite(n) ? n : 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }); }
  function num(v) { v = parseFloat(String(v).replace(",", ".")); return isFinite(v) ? v : 0; }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function frDate(iso) { if (!iso) return ""; var p = iso.split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : iso; }
  function addDays(iso, d) { var t = new Date(iso); t.setDate(t.getDate() + d); return t.toISOString().slice(0, 10); }
  function toast(msg) {
    var t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2200);
  }

  var PRESETS = ["Entretien mensuel piscine", "Nettoyage du bassin", "Traitement de l'eau", "Analyse & équilibrage de l'eau", "Hivernage", "Mise en service / déshivernage", "Remplacement pompe / filtration", "Réparation / pose de liner", "Pose de robot nettoyeur", "Installation pompe à chaleur", "Construction de bassin", "Terrassement piscine", "Margelles & plage", "Local technique", "Bâche / volet roulant", "Contrat d'entretien annuel", "Dépannage / SAV", "Détection de fuite"];

  /* ---------- Totals ---------- */
  function computeTotals(doc) {
    var ht = 0, tvaMap = {};
    (doc.lines || []).forEach(function (l) {
      var lineHT = num(l.qty) * num(l.pu);
      ht += lineHT;
      var rate = db.settings.franchiseTva ? 0 : num(l.tva);
      tvaMap[rate] = (tvaMap[rate] || 0) + lineHT * rate / 100;
    });
    var remise = num(doc.remise) || 0;
    var htNet = ht - remise;
    // recalcule la TVA proportionnellement si remise (simplifié : remise sur HT global)
    var factor = ht > 0 ? htNet / ht : 1;
    var tvaTotal = 0;
    Object.keys(tvaMap).forEach(function (r) { tvaMap[r] = tvaMap[r] * factor; tvaTotal += tvaMap[r]; });
    return { ht: htNet, htBrut: ht, remise: remise, tvaMap: tvaMap, tva: tvaTotal, ttc: htNet + tvaTotal };
  }

  /* ---------- Router ---------- */
  function go(hash) { location.hash = hash; }
  function router() {
    var h = (location.hash || "#dashboard").replace(/^#/, "");
    var parts = h.split("/");
    $$(".side-nav a").forEach(function (a) { a.classList.toggle("active", a.getAttribute("href") === "#" + parts[0]); });
    var view = $("#view");
    switch (parts[0]) {
      case "dashboard": return renderDashboard(view);
      case "clients": return renderClients(view);
      case "devis": return parts[1] ? renderList(view, "devis") : renderList(view, "devis");
      case "factures": return renderList(view, "facture");
      case "new": return renderEditor(view, parts[1] || "devis", null);
      case "edit": return renderEditor(view, null, parts[1]);
      case "doc": return renderDoc(view, parts[1]);
      case "settings": return renderSettings(view);
      default: return renderDashboard(view);
    }
    updateProTag();
  }

  function updateProTag() {
    var el = $("#plan-tag");
    if (!el) return;
    if (db.settings.isPro) { el.className = "plan-tag pro"; el.textContent = "Plan Pro ✓"; }
    else if (LOGGED_IN) { el.className = "plan-tag pro"; el.textContent = "Essai actif"; } else { el.className = "plan-tag free"; el.textContent = "Plan Gratuit"; }
  }

  /* ---------- Dashboard ---------- */
  function renderDashboard(v) {
    var devis = db.docs.filter(function (d) { return d.type === "devis"; });
    var factures = db.docs.filter(function (d) { return d.type === "facture"; });
    var now = new Date(); var ym = now.toISOString().slice(0, 7);
    var caMois = factures.filter(function (f) { return f.status === "paye" && (f.date || "").slice(0, 7) === ym; })
      .reduce(function (s, f) { return s + computeTotals(f).ttc; }, 0);
    var enAttente = factures.filter(function (f) { return f.status !== "paye"; })
      .reduce(function (s, f) { return s + computeTotals(f).ttc; }, 0);

    v.innerHTML =
      '<div class="page-head"><div><h1>Tableau de bord</h1><div class="sub">Bonjour ' + (esc(db.settings.company.nom) || "pisciniste") + ' 👋</div></div>' +
      '<div style="display:flex;gap:10px"><a class="btn btn-ghost" href="#new/facture">+ Facture</a><a class="btn btn-primary" href="#new/devis">+ Devis</a></div></div>' +
      '<div class="kpis">' +
        kpi("Devis créés", devis.length) +
        kpi("Factures", factures.length) +
        kpi("CA encaissé (ce mois)", eur(caMois), true) +
        kpi("En attente de paiement", eur(enAttente)) +
      '</div>' +
      recentPanel("Derniers devis", devis) +
      '<div style="height:20px"></div>' +
      recentPanel("Dernières factures", factures);

    if (!db.settings.company.nom) {
      v.insertAdjacentHTML("afterbegin",
        '<div class="panel" style="margin-bottom:20px;border-color:var(--green)"><div class="panel-body" style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap">' +
        '<div>👋 <strong>Bienvenue !</strong> Renseignez vos informations d\'entreprise pour qu\'elles apparaissent sur vos devis et factures.</div>' +
        '<a class="btn btn-primary btn-sm" href="#settings">Configurer mon entreprise</a></div></div>');
    }
  }
  function kpi(lbl, val, green) { return '<div class="kpi"><div class="lbl">' + lbl + '</div><div class="val' + (green ? ' green' : '') + '">' + val + '</div></div>'; }
  function recentPanel(title, list) {
    list = list.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }).slice(0, 5);
    var rows = list.length ? list.map(docRow).join("") :
      '<tr><td colspan="5"><div class="empty">Rien pour l\'instant.</div></td></tr>';
    return '<div class="panel"><div class="panel-head"><h2>' + title + '</h2></div>' +
      '<table class="data"><thead><tr><th>Numéro</th><th>Client</th><th>Date</th><th>Montant TTC</th><th>Statut</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function docRow(d) {
    var c = clientById(d.clientId);
    var t = computeTotals(d);
    return '<tr style="cursor:pointer" onclick="location.hash=\'#doc/' + d.id + '\'">' +
      '<td><strong>' + esc(d.number) + '</strong></td>' +
      '<td>' + esc(c ? c.nom : "—") + '</td>' +
      '<td>' + frDate(d.date) + '</td>' +
      '<td>' + eur(t.ttc) + '</td>' +
      '<td><span class="tag ' + d.status + '">' + statusLabel(d.status) + '</span></td></tr>';
  }
  function statusLabel(s) {
    return { brouillon: "Brouillon", envoye: "Envoyé", accepte: "Accepté", refuse: "Refusé", paye: "Payé", impaye: "Impayé" }[s] || s;
  }

  /* ---------- Clients ---------- */
  function clientById(id) { return db.clients.filter(function (c) { return c.id === id; })[0]; }
  function renderClients(v) {
    var rows = db.clients.length ? db.clients.map(function (c) {
      return '<tr><td><strong>' + esc(c.nom) + '</strong></td><td>' + esc(c.email || "—") + '</td><td>' + esc(c.tel || "—") + '</td>' +
        '<td>' + esc([c.cp, c.ville].filter(Boolean).join(" ")) + '</td>' +
        '<td style="text-align:right"><button class="btn btn-ghost btn-sm" data-edit="' + c.id + '">Modifier</button> ' +
        '<button class="btn btn-danger btn-sm" data-del="' + c.id + '">Suppr.</button></td></tr>';
    }).join("") : '<tr><td colspan="5"><div class="empty"><div class="big">🧑‍🌾</div>Aucun client. Ajoutez-en un pour créer un devis.</div></td></tr>';
    v.innerHTML =
      '<div class="page-head"><h1>Clients</h1><button class="btn btn-primary" id="add-client">+ Nouveau client</button></div>' +
      '<div class="panel"><table class="data"><thead><tr><th>Nom</th><th>Email</th><th>Téléphone</th><th>Ville</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    $("#add-client").onclick = function () { clientModal(); };
    $$("[data-edit]", v).forEach(function (b) { b.onclick = function () { clientModal(b.dataset.edit); }; });
    $$("[data-del]", v).forEach(function (b) { b.onclick = function () {
      if (confirm("Supprimer ce client ?")) { db.clients = db.clients.filter(function (c) { return c.id !== b.dataset.del; }); save(); renderClients(v); }
    }; });
  }
  function clientModal(id) {
    var c = id ? clientById(id) : { id: uid(), nom: "", email: "", tel: "", adresse: "", cp: "", ville: "" };
    var isNew = !id;
    openModal(
      '<h3>' + (isNew ? "Nouveau client" : "Modifier le client") + '</h3>' +
      '<div class="field"><label>Nom / Société *</label><input id="c-nom" value="' + esc(c.nom) + '"></div>' +
      '<div class="row2"><div class="field"><label>Email</label><input id="c-email" value="' + esc(c.email) + '"></div>' +
      '<div class="field"><label>Téléphone</label><input id="c-tel" value="' + esc(c.tel) + '"></div></div>' +
      '<div class="field"><label>Adresse</label><input id="c-adr" value="' + esc(c.adresse) + '"></div>' +
      '<div class="row2"><div class="field"><label>Code postal</label><input id="c-cp" value="' + esc(c.cp) + '"></div>' +
      '<div class="field"><label>Ville</label><input id="c-ville" value="' + esc(c.ville) + '"></div></div>' +
      '<button class="btn btn-primary btn-block" id="c-save">Enregistrer</button>',
      function () {
        $("#c-save").onclick = function () {
          c.nom = $("#c-nom").value.trim(); if (!c.nom) { toast("Le nom est requis"); return; }
          c.email = $("#c-email").value.trim(); c.tel = $("#c-tel").value.trim();
          c.adresse = $("#c-adr").value.trim(); c.cp = $("#c-cp").value.trim(); c.ville = $("#c-ville").value.trim();
          if (isNew) db.clients.push(c);
          save(); closeModal(); toast("Client enregistré"); router();
        };
      });
  }

  /* ---------- Liste devis/factures ---------- */
  function renderList(v, type) {
    var list = db.docs.filter(function (d) { return d.type === type; }).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    var title = type === "devis" ? "Devis" : "Factures";
    var rows = list.length ? list.map(docRow).join("") :
      '<tr><td colspan="5"><div class="empty"><div class="big">' + (type === "devis" ? "📝" : "🧾") + '</div>Aucun ' + (type === "devis" ? "devis" : "facture") + ' pour l\'instant.</div></td></tr>';
    v.innerHTML =
      '<div class="page-head"><h1>' + title + '</h1><a class="btn btn-primary" href="#new/' + type + '">+ Nouveau ' + (type === "devis" ? "devis" : "facture") + '</a></div>' +
      '<div class="panel"><table class="data"><thead><tr><th>Numéro</th><th>Client</th><th>Date</th><th>Montant TTC</th><th>Statut</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  /* ---------- Éditeur devis/facture ---------- */
  function renderEditor(v, type, editId) {
    var doc;
    if (editId) { doc = db.docs.filter(function (d) { return d.id === editId; })[0]; if (!doc) return go("#dashboard"); type = doc.type; }
    else {
      // gating gratuit
      if (!db.settings.isPro && !LOGGED_IN && db.docs.length >= FREE_LIMIT) { upgradeModal(); return go(type === "facture" ? "#factures" : "#devis"); }
      doc = { id: uid(), type: type, number: nextNumber(type), clientId: db.clients[0] ? db.clients[0].id : "",
        date: todayISO(), validity: addDays(todayISO(), 30), status: "brouillon",
        lines: [{ designation: "", qty: 1, unit: "u", pu: 0, tva: db.settings.tva }], remise: 0, notes: "", createdAt: Date.now(), _new: true };
    }
    var isDevis = type === "devis";
    v.innerHTML =
      '<div class="page-head"><div><h1>' + (editId ? "Modifier" : "Nouveau") + ' ' + (isDevis ? "devis" : "facture") + '</h1>' +
        '<div class="sub">N° ' + esc(doc.number) + '</div></div>' +
        '<div style="display:flex;gap:10px"><a class="btn btn-ghost" href="#' + (isDevis ? "devis" : "factures") + '">Annuler</a>' +
        '<button class="btn btn-primary" id="save-doc">Enregistrer</button></div></div>' +
      '<div class="panel"><div class="panel-body">' +
        '<div class="row3">' +
          '<div class="field"><label>Client *</label><select id="d-client">' + clientOptions(doc.clientId) + '</select>' +
            '<div class="hint"><a href="#clients">+ gérer les clients</a></div></div>' +
          '<div class="field"><label>Date</label><input type="date" id="d-date" value="' + doc.date + '"></div>' +
          '<div class="field"><label>' + (isDevis ? "Valable jusqu'au" : "Échéance") + '</label><input type="date" id="d-valid" value="' + (doc.validity || "") + '"></div>' +
        '</div>' +
        '<datalist id="presets">' + PRESETS.map(function (p) { return '<option value="' + esc(p) + '">'; }).join("") + '</datalist>' +
        '<table class="lines"><thead><tr><th class="col-desc">Désignation</th><th class="col-small">Qté</th><th class="col-small">Unité</th><th class="col-small num">P.U. HT</th>' +
          (db.settings.franchiseTva ? '' : '<th class="col-small num">TVA</th>') + '<th class="col-small num">Total HT</th><th class="col-x"></th></tr></thead>' +
          '<tbody id="lines-body"></tbody></table>' +
        '<button class="btn btn-ghost btn-sm" id="add-line" style="margin-top:10px">+ Ajouter une ligne</button>' +
        '<div class="row2" style="margin-top:20px"><div class="field"><label>Remise globale (€ HT)</label><input id="d-remise" class="num" value="' + (doc.remise || 0) + '"></div>' +
        '<div class="field"><label>Statut</label><select id="d-status">' + statusOptions(doc.status, type) + '</select></div></div>' +
        '<div class="field"><label>Notes / conditions</label><textarea id="d-notes" rows="2">' + esc(doc.notes) + '</textarea></div>' +
        '<div class="totals" id="totals"></div>' +
      '</div></div>';

    var lines = doc.lines.slice();
    function renderLines() {
      var tb = $("#lines-body"); tb.innerHTML = "";
      lines.forEach(function (l, i) {
        var tr = document.createElement("tr");
        tr.innerHTML =
          '<td><input list="presets" class="l-desc" value="' + esc(l.designation) + '" placeholder="Prestation…"></td>' +
          '<td><input class="num l-qty" value="' + esc(l.qty) + '"></td>' +
          '<td><input class="l-unit" value="' + esc(l.unit) + '" placeholder="u, m², ml, h…"></td>' +
          '<td><input class="num l-pu" value="' + esc(l.pu) + '"></td>' +
          (db.settings.franchiseTva ? '' : '<td><select class="l-tva"><option value="20"' + (num(l.tva) === 20 ? " selected" : "") + '>20%</option><option value="10"' + (num(l.tva) === 10 ? " selected" : "") + '>10%</option><option value="0"' + (num(l.tva) === 0 ? " selected" : "") + '>0%</option></select></td>') +
          '<td class="num l-total" style="padding-top:16px">' + eur(num(l.qty) * num(l.pu)) + '</td>' +
          '<td class="col-x"><button class="line-del">×</button></td>';
        tb.appendChild(tr);
        function sync() { l.designation = $(".l-desc", tr).value; l.qty = $(".l-qty", tr).value; l.unit = $(".l-unit", tr).value; l.pu = $(".l-pu", tr).value; if ($(".l-tva", tr)) l.tva = $(".l-tva", tr).value; $(".l-total", tr).textContent = eur(num(l.qty) * num(l.pu)); renderTotals(); }
        $$("input,select", tr).forEach(function (el) { el.addEventListener("input", sync); });
        $(".line-del", tr).onclick = function () { lines.splice(i, 1); if (!lines.length) lines.push({ designation: "", qty: 1, unit: "u", pu: 0, tva: db.settings.tva }); renderLines(); renderTotals(); };
      });
    }
    function renderTotals() {
      doc.lines = lines; doc.remise = $("#d-remise") ? $("#d-remise").value : 0;
      var t = computeTotals(doc);
      var tvaRows = Object.keys(t.tvaMap).filter(function (r) { return t.tvaMap[r] > 0; })
        .map(function (r) { return '<div class="row"><span>TVA ' + r + '%</span><span>' + eur(t.tvaMap[r]) + '</span></div>'; }).join("");
      $("#totals").innerHTML =
        '<div class="row"><span>Total HT</span><span>' + eur(t.htBrut) + '</span></div>' +
        (t.remise > 0 ? '<div class="row"><span>Remise</span><span>− ' + eur(t.remise) + '</span></div>' : '') +
        (db.settings.franchiseTva ? '<div class="row"><span>TVA</span><span>Non applicable</span></div>' : tvaRows) +
        '<div class="row grand"><span>Total ' + (db.settings.franchiseTva ? "" : "TTC") + '</span><span>' + eur(t.ttc) + '</span></div>';
    }
    renderLines(); renderTotals();
    $("#add-line").onclick = function () { lines.push({ designation: "", qty: 1, unit: "u", pu: 0, tva: db.settings.tva }); renderLines(); };
    $("#d-remise").addEventListener("input", renderTotals);

    $("#save-doc").onclick = function () {
      doc.clientId = $("#d-client").value;
      if (!doc.clientId) { toast("Ajoutez d'abord un client"); return; }
      doc.date = $("#d-date").value; doc.validity = $("#d-valid").value;
      doc.status = $("#d-status").value; doc.notes = $("#d-notes").value; doc.remise = num($("#d-remise").value);
      doc.lines = lines;
      if (doc._new) { delete doc._new; db.docs.push(doc); if (type === "devis") db.settings.devisCounter++; else db.settings.factureCounter++; }
      save(); toast((type === "devis" ? "Devis" : "Facture") + " enregistré"); go("#doc/" + doc.id);
    };
  }
  function clientOptions(sel) {
    if (!db.clients.length) return '<option value="">— aucun client —</option>';
    return db.clients.map(function (c) { return '<option value="' + c.id + '"' + (c.id === sel ? " selected" : "") + '>' + esc(c.nom) + '</option>'; }).join("");
  }
  function statusOptions(sel, type) {
    var opts = type === "devis" ? ["brouillon", "envoye", "accepte", "refuse"] : ["brouillon", "envoye", "paye", "impaye"];
    return opts.map(function (o) { return '<option value="' + o + '"' + (o === sel ? " selected" : "") + '>' + statusLabel(o) + '</option>'; }).join("");
  }
  function nextNumber(type) {
    var y = new Date().getFullYear();
    var n = type === "devis" ? db.settings.devisCounter : db.settings.factureCounter;
    return (type === "devis" ? "D" : "F") + y + "-" + String(n).padStart(4, "0");
  }

  /* ---------- Vue document (PDF / impression) ---------- */
  function renderDoc(v, id) {
    var doc = db.docs.filter(function (d) { return d.id === id; })[0];
    if (!doc) return go("#dashboard");
    var c = clientById(doc.clientId) || {};
    var s = db.settings.company;
    var t = computeTotals(doc);
    var isDevis = doc.type === "devis";
    var tvaRows = Object.keys(t.tvaMap).filter(function (r) { return t.tvaMap[r] > 0; })
      .map(function (r) { return '<div class="r"><span>TVA ' + r + '%</span><span>' + eur(t.tvaMap[r]) + '</span></div>'; }).join("");

    var lineRows = (doc.lines || []).map(function (l) {
      return '<tr><td>' + esc(l.designation) + '</td><td class="num">' + esc(l.qty) + '</td><td>' + esc(l.unit) + '</td>' +
        '<td class="num">' + eur(num(l.pu)) + '</td>' + (db.settings.franchiseTva ? '' : '<td class="num">' + num(l.tva) + '%</td>') +
        '<td class="num">' + eur(num(l.qty) * num(l.pu)) + '</td></tr>';
    }).join("");

    v.innerHTML =
      '<div class="print-bar no-print">' +
        '<a class="btn btn-ghost" href="#' + (isDevis ? "devis" : "factures") + '">← Retour</a>' +
        '<a class="btn btn-ghost" href="#edit/' + doc.id + '">✏️ Modifier</a>' +
        (isDevis ? '<button class="btn btn-ghost" id="to-facture">→ Convertir en facture</button>' : '') +
        '<button class="btn btn-primary" id="print-doc">⬇ Télécharger en PDF</button>' +
      '</div>' +
      '<div style="padding:24px;background:var(--bg-soft)"><div class="doc-a4" id="doc-print">' +
        '<div class="doc-top">' +
          '<div class="doc-company">' + (s.logo ? '<img class="doc-logo" src="' + s.logo + '"><br>' : '') +
            '<strong>' + (esc(s.nom) || "Votre entreprise") + '</strong><br>' +
            esc(s.adresse) + (s.adresse ? '<br>' : '') + esc([s.cp, s.ville].filter(Boolean).join(" ")) +
            (s.tel ? '<br>Tél : ' + esc(s.tel) : '') + (s.email ? '<br>' + esc(s.email) : '') +
            (s.siret ? '<br>SIRET : ' + esc(s.siret) : '') + (s.tvaNum ? '<br>TVA : ' + esc(s.tvaNum) : '') +
          '</div>' +
          '<div class="doc-title"><h2>' + (isDevis ? "DEVIS" : "FACTURE") + '</h2>' +
            '<div class="meta">N° ' + esc(doc.number) + '<br>Date : ' + frDate(doc.date) +
            (doc.validity ? '<br>' + (isDevis ? "Valable jusqu'au " : "Échéance : ") + frDate(doc.validity) : '') + '</div></div>' +
        '</div>' +
        '<div class="doc-parties"><div class="doc-box" style="visibility:hidden">.</div>' +
          '<div class="doc-box" style="text-align:right"><div class="cap">Adressé à</div><strong>' + (esc(c.nom) || "—") + '</strong><br>' +
            esc(c.adresse) + (c.adresse ? '<br>' : '') + esc([c.cp, c.ville].filter(Boolean).join(" ")) +
            (c.email ? '<br>' + esc(c.email) : '') + '</div></div>' +
        '<table class="doc-lines"><thead><tr><th>Désignation</th><th class="num">Qté</th><th>Unité</th><th class="num">P.U. HT</th>' +
          (db.settings.franchiseTva ? '' : '<th class="num">TVA</th>') + '<th class="num">Total HT</th></tr></thead><tbody>' + lineRows + '</tbody></table>' +
        '<div class="doc-totals">' +
          '<div class="r"><span>Total HT</span><span>' + eur(t.htBrut) + '</span></div>' +
          (t.remise > 0 ? '<div class="r"><span>Remise</span><span>− ' + eur(t.remise) + '</span></div>' : '') +
          (db.settings.franchiseTva ? '' : tvaRows) +
          '<div class="r g"><span>Total ' + (db.settings.franchiseTva ? "" : "TTC") + '</span><span>' + eur(t.ttc) + '</span></div>' +
        '</div>' +
        (doc.notes ? '<div style="clear:both;margin-top:24px;font-size:13px"><strong>Notes :</strong> ' + esc(doc.notes) + '</div>' : '<div style="clear:both"></div>') +
        '<div class="doc-legal">' +
          (db.settings.franchiseTva ? "TVA non applicable, art. 293 B du CGI.<br>" : "") +
          (isDevis ? "Devis gratuit. Bon pour accord, date et signature du client :" : "En votre aimable règlement. Merci de votre confiance.") +
          (db.settings.mentions ? '<br>' + esc(db.settings.mentions) : '') +
        '</div>' +
        ((db.settings.isPro || LOGGED_IN) ? '' : '<div class="doc-watermark">Réalisé avec Piscineo — piscineo.fr</div>') +
      '</div></div>';

    $("#print-doc").onclick = function () { window.print(); };
    if ($("#to-facture")) $("#to-facture").onclick = function () {
      if (!db.settings.isPro && !LOGGED_IN && db.docs.length >= FREE_LIMIT) { upgradeModal(); return; }
      var f = JSON.parse(JSON.stringify(doc));
      f.id = uid(); f.type = "facture"; f.number = nextNumber("facture"); f.status = "brouillon";
      f.date = todayISO(); f.validity = addDays(todayISO(), 30); f.createdAt = Date.now(); f.sourceDevisId = doc.id; delete f._new;
      db.docs.push(f); db.settings.factureCounter++; save(); toast("Facture créée depuis le devis"); go("#doc/" + f.id);
    };
  }

  /* ---------- Réglages ---------- */
  function renderSettings(v) {
    var s = db.settings.company;
    v.innerHTML =
      '<div class="page-head"><h1>Réglages</h1></div>' +
      '<div class="panel"><div class="panel-head"><h2>Mon entreprise</h2></div><div class="panel-body">' +
        '<div class="field"><label>Nom / Raison sociale</label><input id="s-nom" value="' + esc(s.nom) + '"></div>' +
        '<div class="field"><label>Adresse</label><input id="s-adr" value="' + esc(s.adresse) + '"></div>' +
        '<div class="row2"><div class="field"><label>Code postal</label><input id="s-cp" value="' + esc(s.cp) + '"></div>' +
        '<div class="field"><label>Ville</label><input id="s-ville" value="' + esc(s.ville) + '"></div></div>' +
        '<div class="row2"><div class="field"><label>Téléphone</label><input id="s-tel" value="' + esc(s.tel) + '"></div>' +
        '<div class="field"><label>Email</label><input id="s-email" value="' + esc(s.email) + '"></div></div>' +
        '<div class="row2"><div class="field"><label>SIRET</label><input id="s-siret" value="' + esc(s.siret) + '"></div>' +
        '<div class="field"><label>N° TVA intracom. (si applicable)</label><input id="s-tvanum" value="' + esc(s.tvaNum) + '"></div></div>' +
        '<div class="field"><label>Logo</label>' + (s.logo ? '<img src="' + s.logo + '" style="max-height:60px;display:block;margin-bottom:8px">' : '') +
          '<input type="file" id="s-logo" accept="image/*">' + (db.settings.isPro ? '' : '<div class="hint">🔒 Le logo sur vos documents est réservé au plan Pro.</div>') + '</div>' +
        '<div class="field"><label><input type="checkbox" id="s-franchise" ' + (db.settings.franchiseTva ? "checked" : "") + ' style="width:auto;margin-right:8px">Je suis en franchise de TVA (auto-entrepreneur, art. 293 B)</label></div>' +
        '<div class="field"><label>Mentions légales additionnelles (assurance décennale, conditions de paiement…)</label><textarea id="s-mentions" rows="2">' + esc(db.settings.mentions) + '</textarea></div>' +
        '<button class="btn btn-primary" id="s-save">Enregistrer</button>' +
      '</div></div>' +
      '<div style="height:20px"></div>' +
      '<div class="panel"><div class="panel-head"><h2>Abonnement</h2></div><div class="panel-body">' +
        '<p style="margin-top:0">Plan actuel : <span class="plan-tag ' + (db.settings.isPro ? "pro" : "free") + '">' + (db.settings.isPro ? "Pro" : "Gratuit") + '</span></p>' +
        (db.settings.isPro
          ? '<button class="btn btn-ghost" id="downgrade">Revenir au gratuit (démo)</button>'
          : '<p style="color:var(--text-soft)">Le plan gratuit est limité à ' + FREE_LIMIT + ' documents et ajoute une mention Jardévis sur les PDF.</p><button class="btn btn-primary" id="upgrade">✨ Passer à Pro</button>') +
      '</div></div>';

    $("#s-save").onclick = function () {
      s.nom = $("#s-nom").value.trim(); s.adresse = $("#s-adr").value.trim(); s.cp = $("#s-cp").value.trim(); s.ville = $("#s-ville").value.trim();
      s.tel = $("#s-tel").value.trim(); s.email = $("#s-email").value.trim(); s.siret = $("#s-siret").value.trim(); s.tvaNum = $("#s-tvanum").value.trim();
      db.settings.franchiseTva = $("#s-franchise").checked; db.settings.mentions = $("#s-mentions").value.trim();
      save(); toast("Réglages enregistrés"); updateProTag();
    };
    $("#s-logo").onchange = function (e) {
      if (!db.settings.isPro) { toast("Le logo est réservé au plan Pro"); upgradeModal(); e.target.value = ""; return; }
      var f = e.target.files[0]; if (!f) return;
      var r = new FileReader(); r.onload = function (ev) { s.logo = ev.target.result; save(); toast("Logo enregistré"); renderSettings(v); }; r.readAsDataURL(f);
    };
    if ($("#upgrade")) $("#upgrade").onclick = upgradeModal;
    if ($("#downgrade")) $("#downgrade").onclick = function () { db.settings.isPro = false; save(); updateProTag(); renderSettings(v); };
  }

  /* ---------- Upgrade (démo) ---------- */
  function upgradeModal() {
    openModal(
      '<button class="close" id="m-close">×</button>' +
      '<h3>Passez à Jardévis Pro</h3>' +
      '<div class="price-big">29 €<small style="font-size:16px;color:var(--text-soft);font-weight:600"> / mois</small></div>' +
      '<ul style="list-style:none;padding:0;margin:14px 0 20px;color:var(--text-soft)">' +
        '<li>✓ Devis &amp; factures <strong>illimités</strong></li>' +
        '<li>✓ <strong>Votre logo</strong> sur les documents</li>' +
        '<li>✓ PDF <strong>sans mention</strong> Jardévis</li>' +
        '<li>✓ Factures d\'entretien récurrentes <em>(à venir)</em></li>' +
      '</ul>' +
      '<div style="background:#fff8e1;border:1px solid #f2d98a;color:#7a5b00;border-radius:8px;padding:8px 12px;font-size:13px;margin-bottom:14px">Mode démo — le paiement en ligne (Stripe) sera branché en production. Ce bouton débloque Pro localement pour tester.</div>' +
      '<button class="btn btn-primary btn-block" id="m-pro">Débloquer Pro (démo)</button>',
      function () {
        $("#m-close").onclick = closeModal;
        $("#m-pro").onclick = function () { db.settings.isPro = true; save(); closeModal(); updateProTag(); toast("Bienvenue en Pro ✓"); router(); };
      });
  }

  /* ---------- Modal infra ---------- */
  function openModal(html, after) {
    closeModal();
    var b = document.createElement("div"); b.className = "modal-backdrop"; b.id = "modal-root";
    b.innerHTML = '<div class="modal">' + html + '</div>';
    b.addEventListener("click", function (e) { if (e.target === b) closeModal(); });
    document.body.appendChild(b);
    if (after) after();
  }
  function closeModal() { var m = $("#modal-root"); if (m) m.remove(); }

  /* ---------- Init ---------- */
  window.addEventListener("hashchange", router);
  document.addEventListener("DOMContentLoaded", function () { updateProTag(); router(); });
  if (document.readyState !== "loading") { updateProTag(); router(); }
})();

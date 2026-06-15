// The row of export controls shown in a chart message header. chat.js calls
// ChartExports.buildMenu(chartData, sources) and drops the fragment into the
// chart's <summary>, mirroring how table messages get their CSV links.
//
// Each button delegates to one ChartExports action (one file per action:
// chart/export-png.js, -clipboard.js, -html.js, -data.js, -spec.js).
// Must load AFTER those files and is the only chart-export file that touches
// i18n -- the actions themselves stay UI-free.

(function () {
  window.ChartExports = window.ChartExports || {};

  function t(key) {
    return window.i18n ? window.i18n.t(key) : null;
  }

  // <button> rather than <a>: there is nothing to download until the action
  // runs (PNG renders, HTML assembles, ... at click time). stopPropagation
  // keeps the click from toggling the surrounding <summary>.
  function actionButton(label, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chart-export";
    btn.textContent = label;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick(btn);
    });
    return btn;
  }

  // Temporarily swap the button label to give feedback ("Copied!" / "Failed").
  function flash(btn, text) {
    const original = btn.textContent;
    btn.textContent = text;
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = original;
      btn.disabled = false;
    }, 2000);
  }

  function failed(btn) {
    flash(btn, t("chat.chart.failed") || "Failed");
  }

  window.ChartExports.buildMenu = function (chartData, sources) {
    const frag = document.createDocumentFragment();

    frag.appendChild(actionButton(t("chat.chart.png") || "PNG", (btn) => {
      ChartExports.downloadPNG(chartData).catch(() => failed(btn));
    }));

    frag.appendChild(actionButton(t("chat.chart.copy") || "Copy image", (btn) => {
      ChartExports.copyToClipboard(chartData)
        .then(() => flash(btn, t("chat.chart.copied") || "Copied!"))
        .catch(() => flash(btn, t("chat.chart.copyFailed") || "Copy failed"));
    }));

    frag.appendChild(actionButton(t("chat.chart.html") || "Interactive HTML", (btn) => {
      ChartExports.downloadHTML(chartData, sources).catch(() => failed(btn));
    }));

    frag.appendChild(actionButton(t("chat.chart.csv") || "Data (CSV)", () => {
      ChartExports.downloadDataCSV(chartData, false);
    }));

    frag.appendChild(actionButton(t("chat.chart.csvExcel") || "Data (CSV Excel)", () => {
      ChartExports.downloadDataCSV(chartData, true);
    }));

    frag.appendChild(actionButton(t("chat.chart.spec") || "Spec (JSON)", () => {
      ChartExports.downloadSpec(chartData);
    }));

    return frag;
  };
})();

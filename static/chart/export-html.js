// Chart export: download a self-contained interactive HTML file.
//
// The file inlines BOTH the Chart.js library and our chart/render.js, plus
// the chart spec as JSON, so it opens offline, can be emailed, and keeps the
// Chart.js interactivity (tooltips, legend toggling). Because it embeds the
// same chart/render.js the chat page uses, the exported chart is rendered by
// the exact same code path as the live one.
//
// Adds ChartExports.downloadHTML(chartData, sources) -> Promise.

(function () {
  window.ChartExports = window.ChartExports || {};

  // Must match the <script> tag in templates/index.html so the fetch is
  // served from the browser's HTTP cache (the page already loaded it).
  const CHARTJS_URL = "https://cdn.jsdelivr.net/npm/chart.js@4";
  const RENDERER_URL = "/static/chart/render.js";

  let sourcesPromise = null;

  function fetchText(url) {
    return fetch(url).then((resp) => {
      if (!resp.ok) throw new Error("HTTP " + resp.status + " fetching " + url);
      return resp.text();
    });
  }

  // Fetch the two scripts once per session; on failure forget the promise so
  // the next click retries instead of caching the error.
  function loadScripts() {
    if (!sourcesPromise) {
      sourcesPromise = Promise.all([fetchText(CHARTJS_URL), fetchText(RENDERER_URL)]);
      sourcesPromise.catch(() => { sourcesPromise = null; });
    }
    return sourcesPromise;
  }

  function escapeHTML(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // A literal "</script" inside inlined JS would terminate our <script> block
  // early. Inserting a backslash before the "/" is a no-op inside JS strings
  // and regexes (the only places the sequence can legally appear).
  function escapeScriptEnd(js) {
    return js.replace(/<\/script/gi, "<\\/script");
  }

  function sourcesBlock(sources) {
    const links = (sources || []).filter(Boolean).map((url) =>
      '<a href="' + escapeHTML(url) + '" target="_blank" rel="noopener">'
      + escapeHTML(url) + "</a>");
    if (!links.length) return "";
    return '<footer class="chart-sources">' + links.join("<br>") + "</footer>\n";
  }

  function buildHTML(chartData, sources, chartjsSrc, rendererSrc) {
    // <-escaping "<" keeps the JSON from ever containing "</script".
    const dataJSON = JSON.stringify(chartData).replace(/</g, "\\u003c");
    const title = chartData.title || "Chart";
    return '<!DOCTYPE html>\n'
      + '<html lang="en">\n'
      + "<head>\n"
      + '<meta charset="utf-8">\n'
      + '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
      + "<title>" + escapeHTML(title) + "</title>\n"
      + "<style>\n"
      + "  body { font-family: sans-serif; margin: 24px; background: #fff; }\n"
      + "  .chart-box { position: relative; height: 75vh; min-height: 360px; max-width: 1200px; margin: 0 auto; }\n"
      + "  .chart-sources { max-width: 1200px; margin: 16px auto 0; font-size: 13px; color: #444; }\n"
      + "</style>\n"
      + "<script>" + escapeScriptEnd(chartjsSrc) + "</script>\n"
      + "<script>" + escapeScriptEnd(rendererSrc) + "</script>\n"
      + "</head>\n"
      + "<body>\n"
      + '<div class="chart-box"><canvas id="chart"></canvas></div>\n'
      + sourcesBlock(sources)
      + "<script>\n"
      + "var CHART_DATA = " + dataJSON + ";\n"
      + 'new Chart(document.getElementById("chart"), ChartRender.buildConfig(CHART_DATA));\n'
      + "</script>\n"
      + "</body>\n"
      + "</html>\n";
  }

  window.ChartExports.downloadHTML = function (chartData, sources) {
    return loadScripts().then(([chartjsSrc, rendererSrc]) => {
      const html = buildHTML(chartData, sources, chartjsSrc, rendererSrc);
      const filename = DownloadUtil.filenameSlug(chartData.title, "chart") + ".html";
      DownloadUtil.triggerDownload(html, "text/html;charset=utf-8", filename);
    });
  };
})();

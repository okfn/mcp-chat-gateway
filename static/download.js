// Browser "save file" helpers, shared by the table CSV links (chat.js) and
// the chart export buttons (chart-export-*.js).
//
// Exposes window.DownloadUtil = { buildDownloadLink, triggerDownload,
// filenameSlug }.

(function () {
  // Build an <a download> for content that exists ahead of time (table CSVs
  // are serialized when the message renders). A Blob URL (rather than a
  // data: URI) keeps large exports from hitting URL-length limits.
  // stopPropagation keeps the click from toggling the surrounding <summary>.
  function buildDownloadLink(content, mime, filename, label) {
    const link = document.createElement("a");
    link.className = "table-download";
    link.download = filename;
    link.textContent = label;
    const blob = new Blob([content], { type: mime });
    link.href = URL.createObjectURL(blob);
    link.addEventListener("click", (e) => e.stopPropagation());
    return link;
  }

  // Trigger a download for content generated at click time (a rendered PNG,
  // an assembled HTML file, ...). Accepts a Blob or a string.
  function triggerDownload(content, mime, filename) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoke after the click has been processed; revoking synchronously can
    // cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Turn a chart title into a safe filename stem ("Resultados por mes" ->
  // "resultados-por-mes"). Keeps Unicode letters so accented titles stay
  // readable; falls back when the title is empty or all punctuation.
  function filenameSlug(title, fallback) {
    const slug = String(title || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "");
    return slug || fallback;
  }

  window.DownloadUtil = { buildDownloadLink, triggerDownload, filenameSlug };
})();

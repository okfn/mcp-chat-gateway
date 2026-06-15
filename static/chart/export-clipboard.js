// Chart export: copy as a PNG image to the system clipboard, for pasting
// straight into slides / docs / email.
//
// Adds ChartExports.copyToClipboard(chartData) -> Promise. Rejects when the
// async Clipboard API is unavailable -- it requires a secure context, so
// HTTPS or localhost; plain http:// deployments get the rejection, which the
// menu surfaces as "Copy failed".

(function () {
  window.ChartExports = window.ChartExports || {};

  window.ChartExports.copyToClipboard = function (chartData) {
    if (!navigator.clipboard || !navigator.clipboard.write || !window.ClipboardItem) {
      return Promise.reject(new Error("Clipboard image API unavailable (needs HTTPS and a modern browser)"));
    }
    // Hand ClipboardItem the pending Promise rather than awaiting the blob
    // first: Safari only honors clipboard writes made synchronously inside
    // the user gesture, and an await would leave it.
    const item = new ClipboardItem({ "image/png": ChartRender.renderToBlob(chartData) });
    return navigator.clipboard.write([item]);
  };
})();

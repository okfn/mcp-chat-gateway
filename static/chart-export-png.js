// Chart export: download as a PNG image.
//
// Re-renders the chart offscreen at a fixed size and 2x pixel density (see
// ChartRender.renderToBlob), so the image quality does not depend on how the
// chart happens to be sized in the chat window.
//
// Adds ChartExports.downloadPNG(chartData) -> Promise.

(function () {
  window.ChartExports = window.ChartExports || {};

  window.ChartExports.downloadPNG = function (chartData) {
    return ChartRender.renderToBlob(chartData).then((blob) => {
      const filename = DownloadUtil.filenameSlug(chartData.title, "chart") + ".png";
      DownloadUtil.triggerDownload(blob, "image/png", filename);
    });
  };
})();

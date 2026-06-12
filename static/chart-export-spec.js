// Chart export: download the raw chart spec as JSON.
//
// This is the `chartData` object exactly as the MCP tool sent it (labels,
// datasets, type, colors...), for users who want to re-render the chart in
// their own tools.
//
// Adds ChartExports.downloadSpec(chartData).

(function () {
  window.ChartExports = window.ChartExports || {};

  window.ChartExports.downloadSpec = function (chartData) {
    const filename = DownloadUtil.filenameSlug(chartData.title, "chart") + ".json";
    DownloadUtil.triggerDownload(
      JSON.stringify(chartData, null, 2), "application/json", filename);
  };
})();

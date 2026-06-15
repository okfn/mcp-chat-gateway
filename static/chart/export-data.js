// Chart export: download the numbers behind the chart as CSV.
//
// Flattens the chart spec into a table -- one row per label, one column per
// dataset -- and reuses the shared CSV serializers, so both flavors exist
// just like for table messages: standard RFC 4180 and the Excel/Windows
// variant (BOM + semicolons).
//
// Adds ChartExports.downloadDataCSV(chartData, excel).

(function () {
  window.ChartExports = window.ChartExports || {};

  function toRows(chartData) {
    const labels = chartData.labels || [];
    // Single-series charts carry their numbers in `values` with no datasets.
    const datasets = (Array.isArray(chartData.datasets) && chartData.datasets.length > 0)
      ? chartData.datasets
      : [{ label: chartData.title || "value", data: chartData.values || [] }];
    const header = [""].concat(datasets.map((ds, i) => ds.label || "series " + (i + 1)));
    const rows = [header];
    labels.forEach((label, i) => {
      rows.push([label].concat(datasets.map((ds) => (ds.data || [])[i])));
    });
    return rows;
  }

  window.ChartExports.downloadDataCSV = function (chartData, excel) {
    const rows = toRows(chartData);
    const slug = DownloadUtil.filenameSlug(chartData.title, "chart-data");
    const content = excel ? CSVExport.toExcelCSV(rows) : CSVExport.toCSV(rows);
    const filename = excel ? slug + "-excel.csv" : slug + ".csv";
    DownloadUtil.triggerDownload(content, "text/csv;charset=utf-8", filename);
  };
})();

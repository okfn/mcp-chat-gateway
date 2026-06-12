// Chart rendering core: turns the chart spec sent by MCP tools (`chartData`,
// the `charts` entry of a tool's structuredContent) into a Chart.js config.
//
// This file is used in TWO places:
//   1. The live chat page (chat.js calls ChartRender.buildConfig).
//   2. Inlined verbatim into the self-contained HTML export
//      (chart-export-html.js fetches this file and embeds its source).
// Because of (2) it must stay dependency-free: only the Chart.js global,
// no i18n, no other /static helpers.
//
// Exposes window.ChartRender = { buildConfig, renderToBlob, CHART_COLORS,
// piePercentPlugin, whiteBackgroundPlugin }.

(function () {
  const CHART_COLORS = [
    "#4e79a7", "#f28e2b", "#e15759", "#76b7b2",
    "#59a14f", "#edc948", "#b07aa1", "#ff9da7",
    "#9c755f", "#bab0ac", "#a0cbe8", "#ffbe7d",
    "#8cd17d", "#b6992d", "#f1ce63", "#499894",
  ];

  // Chart.js plugin: draw percentage labels on top of pie/doughnut slices.
  // Skips slices smaller than 3% to avoid clutter. White text with a dark
  // outline so it stays readable on any slice color.
  const piePercentPlugin = {
    id: "piePercent",
    afterDatasetsDraw(chart) {
      const type = chart.config.type;
      if (type !== "pie" && type !== "doughnut") return;
      const dataset = chart.data.datasets[0];
      if (!dataset) return;
      const values = (dataset.data || []).map((v) => Number(v) || 0);
      const total = values.reduce((s, v) => s + v, 0);
      if (!total) return;
      const meta = chart.getDatasetMeta(0);
      const { ctx } = chart;
      ctx.save();
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      meta.data.forEach((arc, i) => {
        const pct = (values[i] / total) * 100;
        if (pct < 3) return;
        const { x, y, startAngle, endAngle, outerRadius, innerRadius } = arc.getProps(
          ["x", "y", "startAngle", "endAngle", "outerRadius", "innerRadius"],
          true,
        );
        const midAngle = (startAngle + endAngle) / 2;
        const radius = (innerRadius + outerRadius) / 2;
        const labelX = x + Math.cos(midAngle) * radius;
        const labelY = y + Math.sin(midAngle) * radius;
        const text = pct.toFixed(1) + "%";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.65)";
        ctx.strokeText(text, labelX, labelY);
        ctx.fillStyle = "#fff";
        ctx.fillText(text, labelX, labelY);
      });
      ctx.restore();
    },
  };
  if (typeof Chart !== "undefined") {
    Chart.register(piePercentPlugin);
  }

  // Chart.js plugin: paint a white background before drawing. The canvas is
  // transparent by default (the chat page fakes it with CSS), which makes
  // PNG/clipboard exports look broken on dark viewers. NOT registered
  // globally -- passed per-chart by renderToBlob.
  const whiteBackgroundPlugin = {
    id: "whiteBackground",
    beforeDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, chart.width, chart.height);
      ctx.restore();
    },
  };

  // Pure function: chartData spec -> Chart.js {type, data, options} config.
  // Any change to how charts look belongs here, so the live chat and the
  // HTML/PNG exports can never drift apart.
  function buildConfig(chartData) {
    const beginAtZero = chartData.beginAtZero !== false;
    const isStacked = chartData.stacked && Array.isArray(chartData.datasets);
    const chartType = chartData.type || "bar";
    const isLine = chartType === "line";

    let datasets;
    if (isStacked) {
      datasets = chartData.datasets.map((ds, i) => ({
        label: ds.label || "",
        data: ds.data || [],
        backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
        borderWidth: 1,
      }));
    } else if (Array.isArray(chartData.datasets) && chartData.datasets.length > 0) {
      datasets = chartData.datasets.map((ds, i) => {
        const fallback = CHART_COLORS[i % CHART_COLORS.length];
        const base = {
          label: ds.label || chartData.title || "",
          data: ds.data || [],
        };
        if (isLine) {
          const lineColor = ds.borderColor || ds.color || fallback;
          base.borderColor = lineColor;
          // For lines, fade the fill if backgroundColor wasn't explicit.
          base.backgroundColor = ds.backgroundColor
            || (typeof lineColor === "string" ? lineColor + "33" : lineColor);
          base.borderWidth = 2;
          base.pointRadius = 4;
          base.tension = 0.3;
          base.fill = false;
        } else {
          // For pie/doughnut, ds.backgroundColor is an array (one color per
          // slice). For bar, it's a string. Honor whatever the tool sent.
          base.backgroundColor = ds.backgroundColor || ds.color || fallback;
          base.borderColor = ds.borderColor || ds.color || fallback;
          base.borderWidth = 1;
        }
        return base;
      });
    } else {
      const base = {
        label: chartData.title || "",
        data: chartData.values || [],
      };
      if (isLine) {
        base.borderColor = "#04498f";
        base.backgroundColor = "#04498f33";
        base.borderWidth = 2;
        base.pointRadius = 4;
        base.tension = 0.3;
        base.fill = false;
      } else {
        base.backgroundColor = chartData.color || "#04498f";
        base.borderColor = chartData.borderColor || chartData.color || "#090824";
        base.borderWidth = 1;
      }
      datasets = [base];
    }

    return {
      type: chartType,
      data: {
        labels: chartData.labels || [],
        datasets: datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: chartData.title ? {
            display: true,
            text: chartData.title,
            font: { size: 14 },
          } : { display: false },
          legend: { display: isStacked || datasets.length > 1 || !!chartData.title },
        },
        scales: isStacked ? {
          x: { stacked: true },
          y: { stacked: true, beginAtZero: beginAtZero },
        } : {
          y: { beginAtZero: beginAtZero },
        },
      },
    };
  }

  // Render the chart to a PNG Blob on an offscreen canvas, independent of how
  // the live chart happens to be sized in the window. `scale` multiplies the
  // backing store (2x default) for print-quality output. Used by the PNG
  // download and the clipboard copy.
  function renderToBlob(chartData, opts) {
    opts = opts || {};
    return new Promise((resolve, reject) => {
      const canvas = document.createElement("canvas");
      canvas.width = opts.width || 1200;
      canvas.height = opts.height || 600;
      const config = buildConfig(chartData);
      // responsive:false makes Chart.js honor the canvas attributes (so the
      // canvas never needs to enter the DOM); animation:false draws the final
      // frame synchronously in the constructor.
      config.options.responsive = false;
      config.options.animation = false;
      config.options.devicePixelRatio = opts.scale || 2;
      config.plugins = [whiteBackgroundPlugin];
      const chart = new Chart(canvas, config);
      chart.canvas.toBlob((blob) => {
        chart.destroy();
        if (blob) resolve(blob);
        else reject(new Error("Canvas PNG encoding failed"));
      }, "image/png");
    });
  }

  window.ChartRender = {
    CHART_COLORS,
    piePercentPlugin,
    whiteBackgroundPlugin,
    buildConfig,
    renderToBlob,
  };
})();

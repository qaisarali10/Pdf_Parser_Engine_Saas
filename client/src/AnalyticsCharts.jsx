import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { EmptyState, SkeletonBlock } from "./ui.jsx";

// Recharts is the heaviest dependency in the client and only the dashboard
// charts need it, so this module is imported lazily to keep it out of the
// initial bundle.

// Every chart here plots a single series, so they all take the same brand hue.
// Giving each one its own colour encoded nothing — five hues implied five
// categories that do not exist. Measured against the white panel: this clears
// the 3:1 floor for marks at 4.16:1, where the brighter brand mint (#2ec9bb)
// manages only 2.06:1 and fails.
const SERIES = "#0d8b84";

// Grid and axis rules sit one shade off the surface and stay solid — dashing a
// grid reads as "threshold" when it is just a grid.
const GRID = "#e6e9ec";
const TICK = { fill: "#6b7682", fontSize: 11 };
const AXIS = { stroke: GRID };

function ChartPanel({ title, children, empty, loading }) {
  return (
    <section className="panel analytics-panel">
      <div className="panel-heading">
        <h2>{title}</h2>
      </div>
      {loading ? <SkeletonBlock /> : empty ? <EmptyState message={empty} /> : children}
    </section>
  );
}

function formatCompact(value) {
  return Number(value || 0).toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 1 });
}

// Product and distributor names run long enough that Recharts wraps a category
// tick onto three lines, and ten of those collide into an unreadable block.
// One clipped line per bar stays legible; the tooltip carries the full name.
function truncateTick(value) {
  const text = String(value ?? "");
  return text.length > 22 ? `${text.slice(0, 21).trimEnd()}…` : text;
}

function AnalyticsTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      {payload.map((item) => (
        <span key={item.dataKey}>{item.name}: {Number(item.value || 0).toLocaleString()}</span>
      ))}
    </div>
  );
}

export default function AnalyticsCharts({ charts, loading }) {
  const has = (rows) => Array.isArray(rows) && rows.length > 0;

  return (
    <div className="analytics-chart-grid">
      <ChartPanel title="Monthly Sales" loading={loading} empty={!has(charts.monthlySales) && "No monthly sales data yet."}>
        <ResponsiveContainer width="100%" height={270}>
          <LineChart data={charts.monthlySales} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={AXIS} />
            <YAxis tickFormatter={formatCompact} tick={TICK} tickLine={false} axisLine={false} width={46} />
            <Tooltip content={<AnalyticsTooltip />} cursor={{ stroke: GRID, strokeWidth: 1 }} />
            <Line
              type="monotone"
              dataKey="sales"
              name="Sales"
              stroke={SERIES}
              strokeWidth={2}
              dot={{ r: 3, fill: SERIES, strokeWidth: 0 }}
              activeDot={{ r: 5, fill: SERIES, stroke: "#fff", strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartPanel>

      <ChartPanel title="Weekly Sales" loading={loading} empty={!has(charts.weeklySales) && "No weekly sales data yet."}>
        <ResponsiveContainer width="100%" height={270}>
          <BarChart data={charts.weeklySales} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={AXIS} />
            <YAxis tickFormatter={formatCompact} tick={TICK} tickLine={false} axisLine={false} width={46} />
            <Tooltip content={<AnalyticsTooltip />} cursor={{ fill: "rgba(13, 139, 132, .07)" }} />
            <Bar dataKey="sales" name="Sales" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={38} />
          </BarChart>
        </ResponsiveContainer>
      </ChartPanel>

      <ChartPanel title="Top Products" loading={loading} empty={!has(charts.topProducts) && "No product sales data yet."}>
        <ResponsiveContainer width="100%" height={340}>
          <BarChart data={charts.topProducts} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 8 }}>
            <CartesianGrid stroke={GRID} horizontal={false} />
            <XAxis type="number" tickFormatter={formatCompact} tick={TICK} tickLine={false} axisLine={AXIS} />
            <YAxis
              type="category"
              dataKey="name"
              width={152}
              interval={0}
              tickFormatter={truncateTick}
              tick={TICK}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<AnalyticsTooltip />} cursor={{ fill: "rgba(13, 139, 132, .07)" }} />
            <Bar dataKey="sales" name="Sales" fill={SERIES} radius={[0, 4, 4, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </ChartPanel>

      <ChartPanel title="Top Distributors" loading={loading} empty={!has(charts.topDistributors) && "No distributor sales data yet."}>
        <ResponsiveContainer width="100%" height={340}>
          <BarChart data={charts.topDistributors} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 8 }}>
            <CartesianGrid stroke={GRID} horizontal={false} />
            <XAxis type="number" tickFormatter={formatCompact} tick={TICK} tickLine={false} axisLine={AXIS} />
            <YAxis
              type="category"
              dataKey="name"
              width={152}
              interval={0}
              tickFormatter={truncateTick}
              tick={TICK}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<AnalyticsTooltip />} cursor={{ fill: "rgba(13, 139, 132, .07)" }} />
            <Bar dataKey="sales" name="Sales" fill={SERIES} radius={[0, 4, 4, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </ChartPanel>

      <ChartPanel title="Upload Activity" loading={loading} empty={!has(charts.uploadActivity) && "No upload activity yet."}>
        <ResponsiveContainer width="100%" height={270}>
          <BarChart data={charts.uploadActivity} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={AXIS} />
            <YAxis allowDecimals={false} tick={TICK} tickLine={false} axisLine={false} width={46} />
            <Tooltip content={<AnalyticsTooltip />} cursor={{ fill: "rgba(13, 139, 132, .07)" }} />
            <Bar dataKey="uploads" name="Uploads" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={38} />
          </BarChart>
        </ResponsiveContainer>
      </ChartPanel>
    </div>
  );
}

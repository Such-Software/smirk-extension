/**
 * SVG Sparkline component for displaying price trends.
 * Renders a simple line chart without axes or labels.
 */

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  strokeColor?: string;
  fillColor?: string;
  strokeWidth?: number;
}

export function Sparkline({
  data,
  width = 280,
  height = 50,
  strokeColor = '#F7931A',
  fillColor = 'rgba(247, 147, 26, 0.1)',
  strokeWidth = 1.5,
}: SparklineProps) {
  if (!data || data.length < 2) {
    return (
      <div
        class="sparkline-empty"
        style={{ width: `${width}px`, height: `${height}px` }}
      >
        <span>No data yet</span>
      </div>
    );
  }

  // Calculate min/max for scaling
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1; // Avoid division by zero

  // Padding from edges
  const paddingX = 2;
  const paddingY = 4;
  const chartWidth = width - paddingX * 2;
  const chartHeight = height - paddingY * 2;

  // Generate points for the polyline
  const points = data.map((value, index) => {
    const x = paddingX + (index / (data.length - 1)) * chartWidth;
    const y = paddingY + chartHeight - ((value - min) / range) * chartHeight;
    return `${x},${y}`;
  });

  // Create the line path
  const linePath = `M ${points.join(' L ')}`;

  // Create the fill path (closes to bottom)
  const fillPath = `${linePath} L ${paddingX + chartWidth},${paddingY + chartHeight} L ${paddingX},${paddingY + chartHeight} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      class="sparkline"
    >
      {/* Gradient fill under the line */}
      <defs>
        <linearGradient id="sparkline-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.2" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Fill area */}
      <path
        d={fillPath}
        fill="url(#sparkline-gradient)"
      />

      {/* Line */}
      <path
        d={linePath}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* End dot */}
      <circle
        cx={paddingX + chartWidth}
        cy={paddingY + chartHeight - ((data[data.length - 1] - min) / range) * chartHeight}
        r={2.5}
        fill={strokeColor}
      />
    </svg>
  );
}

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

import { formatMoney, formatPercent, sliceColor } from '../utils/format'

function ChartTooltip({ active, payload, currency }) {
  if (!active || !payload?.length) return null
  const slice = payload[0].payload
  return (
    <div className="card px-3 py-2 text-sm shadow-lg">
      <p className="font-semibold">{slice.name}</p>
      <p className="text-muted">
        {formatMoney(slice.value, currency)} · {formatPercent(slice.percent, 1)}
      </p>
    </div>
  )
}

/**
 * The donut half of the budget overview.
 *
 * Split into its own module purely so Recharts — by far the heaviest dependency
 * in the app — can be code-split behind React.lazy. It is only ever needed on
 * the plan screen, and the dashboard should not pay for it.
 *
 * The chart is aria-hidden: it is decorative here because the adjacent legend
 * already lists every category and percentage as text.
 */
export default function BudgetDonut({ chartData, currency }) {
  return (
    <div className="h-56 min-w-0" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            innerRadius="58%"
            outerRadius="92%"
            paddingAngle={2}
            stroke="#fff"
            strokeWidth={2}
            isAnimationActive={false}
          >
            {chartData.map((slice, index) => (
              <Cell key={slice.name} fill={sliceColor(slice, index)} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip currency={currency} />} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

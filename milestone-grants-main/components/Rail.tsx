import type { CSSProperties } from "react";
import { fmt, type GrantView } from "../lib/chain";

interface Props { g: GrantView; selected: number; onSelect: (i: number) => void; symbol: string; decimals: number }

const STATE = ["Pending", "Waiting for review", "Released"];

/** The release rail: one segment per milestone, sized by amount. Filled = paid out. */
export default function Rail({ g, selected, onSelect, symbol, decimals }: Props) {
  const unit = 10n ** BigInt(Math.max(0, decimals - 4));
  return (
    <div className="rail" role="group" aria-label={`Milestones for grant ${g.id}`}>
      {g.milestones.map((m, i) => (
        <button
          key={i}
          type="button"
          className={`seg seg-${m.status}${selected === i ? " is-selected" : ""}`}
          style={{ flexGrow: Math.max(1, Number(m.amount / unit)), ["--i" as string]: i } as CSSProperties}
          aria-pressed={selected === i}
          aria-label={`Milestone ${i + 1}, ${fmt(m.amount, decimals)} ${symbol}, ${STATE[m.status]}`}
          onClick={() => onSelect(i)}
        >
          <span className="seg-n">{i + 1}</span>
          <span className="seg-amt">{fmt(m.amount, decimals)} <small>{symbol}</small></span>
          {m.status === 1 && (
            <span className="pips" aria-hidden="true">
              {Array.from({ length: g.threshold }, (_, k) => <i key={k} className={k < m.approvals ? "on" : ""} />)}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

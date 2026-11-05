"use client";
import { useMemo, useState, type FormEvent } from "react";
import { isAddress, isRepo, parseUnits, fmt, type Config } from "../lib/chain";
import { Cross, Plus } from "./Icons";

export interface NewGrantParams { recipient: string; repo: string; amounts: string[]; reviewers: string[]; threshold: number; days: number; token: string }
interface Props { cfg: Config; blocker: string | null; busy: boolean; onCreate: (p: NewGrantParams) => void }

const DAY_CHOICES = [7, 14, 30, 60];

export default function NewGrant({ cfg, blocker, busy, onCreate }: Props) {
  const [recipient, setRecipient] = useState("");
  const [repo, setRepo] = useState("");
  const [amounts, setAmounts] = useState<string[]>(["", ""]);
  const [reviewers, setReviewers] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [threshold, setThreshold] = useState(1);
  const [days, setDays] = useState(14);
  const [token, setToken] = useState("");

  const amountErr = (a: string) => { if (!a.trim()) return ""; try { return BigInt(parseUnits(a, cfg.nativeDecimals)) > 0n ? "" : "Must be more than 0."; } catch { return "Use a number like 1.5."; } };
  const parsed = amounts.filter((a) => a.trim() && !amountErr(a));
  const total = useMemo(() => parsed.reduce((s, a) => s + BigInt(parseUnits(a, cfg.nativeDecimals)), 0n), [parsed, cfg.nativeDecimals]);
  const t = Math.min(Math.max(1, threshold), Math.max(1, reviewers.length));
  const sym = token.trim() ? "token units" : cfg.nativeSymbol;

  const problems: string[] = [];
  if (!isAddress(recipient)) problems.push("Add the recipient's address.");
  if (!isRepo(repo)) problems.push("Add the GitHub repo as owner/name.");
  if (!parsed.length || parsed.length !== amounts.filter((a) => a.trim()).length) problems.push("Add at least one valid milestone amount.");
  if (!reviewers.length) problems.push("Add at least one reviewer.");
  if (token.trim() && !isAddress(token)) problems.push("The token address is not valid.");
  const reason = blocker ?? problems[0] ?? null;

  const addReviewer = () => {
    const v = draft.trim();
    if (!isAddress(v) || reviewers.some((r) => r.toLowerCase() === v.toLowerCase()) || reviewers.length >= 10) return;
    setReviewers([...reviewers, v]); setDraft("");
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (reason) return;
    onCreate({ recipient: recipient.trim(), repo: repo.trim(), amounts: parsed, reviewers, threshold: t, days, token: token.trim() });
  };
  const reclaimOn = new Date(Date.now() + days * 86400000).toLocaleDateString(undefined, { day: "numeric", month: "short" });

  return (
    <form className="panel" onSubmit={submit} id="new" noValidate>
      <h2>New grant</h2>
      <label>Who receives the funds
        <input className="mono" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x…" spellCheck={false} aria-invalid={recipient !== "" && !isAddress(recipient)} />
      </label>
      {recipient !== "" && !isAddress(recipient) && <p className="field-err">That is not a valid address.</p>}
      <label>GitHub repository
        <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/name" spellCheck={false} aria-invalid={repo !== "" && !isRepo(repo)} />
      </label>

      <fieldset>
        <legend>Milestones, paid in order</legend>
        {amounts.map((a, i) => (
          <div className="line" key={i}>
            <span className="line-n">{i + 1}</span>
            <input inputMode="decimal" value={a} onChange={(e) => setAmounts(amounts.map((x, k) => (k === i ? e.target.value : x)))} placeholder={`Amount in ${sym}`} aria-label={`Milestone ${i + 1} amount`} aria-invalid={!!amountErr(a)} />
            {amounts.length > 1 && <button type="button" className="icon" aria-label={`Remove milestone ${i + 1}`} onClick={() => setAmounts(amounts.filter((_, k) => k !== i))}><Cross /></button>}
          </div>
        ))}
        {amounts.map((a, i) => amountErr(a) && <p className="field-err" key={i}>Milestone {i + 1}: {amountErr(a)}</p>)}
        {amounts.length < 10 && <button type="button" className="btn btn-quiet" onClick={() => setAmounts([...amounts, ""])}><Plus /> Add milestone</button>}
      </fieldset>

      <fieldset>
        <legend>Reviewers</legend>
        {reviewers.length > 0 && (
          <ul className="chips">
            {reviewers.map((r) => (
              <li key={r}><span className="mono">{r.slice(0, 6)}…{r.slice(-4)}</span>
                <button type="button" className="icon" aria-label={`Remove reviewer ${r}`} onClick={() => setReviewers(reviewers.filter((x) => x !== r))}><Cross /></button></li>
            ))}
          </ul>
        )}
        <div className="line">
          <input className="mono" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addReviewer(); } }} placeholder="Reviewer address 0x…" spellCheck={false} aria-label="Reviewer address" />
          <button type="button" className="btn btn-quiet" onClick={addReviewer} disabled={!isAddress(draft)}>Add</button>
        </div>
        {reviewers.length > 0 && (
          <div className="stepper" role="group" aria-label="Approvals needed">
            <button type="button" className="icon" aria-label="Fewer approvals" onClick={() => setThreshold(Math.max(1, t - 1))} disabled={t <= 1}>−</button>
            <span><strong>{t}</strong> of {reviewers.length} must approve each milestone</span>
            <button type="button" className="icon" aria-label="More approvals" onClick={() => setThreshold(Math.min(reviewers.length, t + 1))} disabled={t >= reviewers.length}>+</button>
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>Deadline</legend>
        <div className="choices" role="radiogroup" aria-label="Days until the deadline">
          {DAY_CHOICES.map((d) => (
            <button key={d} type="button" role="radio" aria-checked={days === d} className={days === d ? "on" : ""} onClick={() => setDays(d)}>{d} days</button>
          ))}
        </div>
        <p className="hint">Anything not released by {reclaimOn} can be reclaimed by you.</p>
      </fieldset>

      <details className="more">
        <summary>Pay in a token instead of {cfg.nativeSymbol}</summary>
        <label>Token contract address
          <input className="mono" value={token} onChange={(e) => setToken(e.target.value)} placeholder="0x… (leave empty for native)" spellCheck={false} />
        </label>
        <p className="hint">You will approve the token transfer first, then fund the grant. Amounts use 18 decimals.</p>
      </details>

      <div className="summary">
        <span>{parsed.length} milestone{parsed.length === 1 ? "" : "s"}</span>
        <strong>{fmt(total, cfg.nativeDecimals)} {sym}</strong>
        <span>locked now</span>
      </div>
      <button className="btn btn-primary" disabled={busy || !!reason}>Fund grant</button>
      {reason && <p className="hint why">{reason}</p>}
    </form>
  );
}

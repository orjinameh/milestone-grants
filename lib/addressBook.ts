// The contract sees every account as a 20-byte address (pallet-revive derives it from the 5… account with a one-way
// hash), so on-chain data comes back as 0x…. This remembers, in this browser, which 5… account each 0x… belongs to
// (your own login, and any 5… address you typed as recipient or reviewer) so the app can show the Substrate form.
export type Book = Record<string, string>; // lowercase 0x… -> 5…
const KEY = "mg-address-book";

export function loadBook(): Book {
  try { const b = JSON.parse(localStorage.getItem(KEY) ?? "{}"); return b && typeof b === "object" ? b : {}; } catch { return {}; }
}
export function saveBook(b: Book) { try { localStorage.setItem(KEY, JSON.stringify(b)); } catch {} }

/** The address to show: the 5… form when known, otherwise the 0x… the chain gave us. */
export const shown = (book: Book, evm: string) => book[evm.toLowerCase()] ?? evm;
/** Tooltip with both forms. */
export const both = (book: Book, evm: string) => (book[evm.toLowerCase()] ? `${book[evm.toLowerCase()]}\nEVM ${evm}` : evm);

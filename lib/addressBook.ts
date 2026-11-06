// The contract stores accounts as 32-byte AccountId32 values (the public key behind a 5… address). This turns those
// ids into the 5… form for display; nothing is stored in the browser.
import { fromAccountId } from "./wallet";

export type Book = Record<string, string>; // lowercase AccountId hex -> 5… address

/** The 5… address to show for an id (falls back to the raw id only if encoding failed). */
export const shown = (book: Book, id: string) => book[id.toLowerCase()] ?? id;

/** Encodes every id once. The logged-in account keeps exactly the address string the wallet reported. */
export async function buildBook(ids: string[], ss58Format: number, own?: { id: string; ss58: string }): Promise<Book> {
  const book: Book = {};
  for (const id of new Set(ids.map((i) => i.toLowerCase()))) {
    try { book[id] = await fromAccountId(id, ss58Format); } catch { /* shown() falls back to the id */ }
  }
  if (own) book[own.id.toLowerCase()] = own.ss58;
  return book;
}

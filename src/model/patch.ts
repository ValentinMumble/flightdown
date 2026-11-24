/**
 * An item with some fields set and others taken out: what a patch does, on the server and in the browser alike. A
 * patch carries only the fields its writer changed, so it never puts back an old copy of the rest (a sortie's logs
 * added from the Mac while the phone held an older copy).
 */
export function patchItem<Item extends {id: string}>(
  item: Item,
  fields: Record<string, unknown>,
  drop: readonly string[] = [],
): Item {
  const next: Record<string, unknown> = {...item, ...fields, id: item.id};
  for (const key of drop) delete next[key];
  return next as Item;
}

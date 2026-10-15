declare const box: { name?: string } | undefined;
const name = box == null ? "" : box.name;

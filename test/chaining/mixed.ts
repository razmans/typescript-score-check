interface Box {
  name?: string;
}
declare const box: Box | undefined;
declare const other: string | undefined;

const manualAnd = box && box.name;
const manualTernary = box !== undefined ? box.name : "";
const modernChain = box?.name;
const modernDefault = other ?? "default";
const plainLogic = 1 > 0 && 2 > 1;

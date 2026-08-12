import { parseDecimal } from "./decimal.js";
export function effectiveCostTotal(accounting) {
    return accounting ? parseDecimal(accounting.costTotal) : undefined;
}
//# sourceMappingURL=sessions.js.map
/**
 * Pure payroll unit expansion — no external dependencies.
 * Extracted here so it can be imported by both payroll.js and tests.
 *
 * Employees with valid splits (sum === 100%) expand to one unit per split.
 * All others collapse to a single unit using preferredAsset / preferredChainId.
 */

/**
 * @param {Array<{
 *   id: string,
 *   salaryAmount: number,
 *   preferredAsset: string,
 *   preferredChainId: number,
 *   settleAddress: string,
 *   solanaAddress?: string,
 *   splits?: Array<{ percent: number, asset: string, chain_id: number, settleAddress?: string }>
 * }>} employees
 * @param {number} defaultChainId
 * @returns {Array}
 */
export function expandToPaymentUnits(employees, defaultChainId) {
  const units = [];
  for (const emp of employees) {
    const validSplits =
      emp.splits &&
      emp.splits.length > 0 &&
      emp.splits.reduce((s, x) => s + x.percent, 0) === 100;

    if (validSplits) {
      for (let i = 0; i < emp.splits.length; i++) {
        const s = emp.splits[i];
        units.push({
          ...emp,
          preferredAsset:     s.asset,
          preferredChainId:   s.chain_id || defaultChainId,
          salaryAmount:       Number(((emp.salaryAmount * s.percent) / 100).toFixed(6)),
          splitSettleAddress: s.settleAddress || null,
          _stepKey:           `${emp.id}_s${i}`,
          _splitLabel:        `split ${i + 1}/${emp.splits.length}`,
        });
      }
    } else {
      units.push({ ...emp, splitSettleAddress: null, _stepKey: emp.id, _splitLabel: null });
    }
  }
  return units;
}

/**
 * Resolve the effective delivery address for a payment unit.
 * Prefers the per-split custom wallet when set, otherwise falls back to
 * the employee's default settle address.
 *
 * @param {{ splitSettleAddress?: string|null, settleAddress: string, solanaAddress?: string }} unit
 * @param {'evm'|'sol'} type
 * @returns {string}
 */
export function effectiveAddress(unit, type = "evm") {
  if (type === "sol") return unit.solanaAddress || unit.settleAddress;
  return unit.splitSettleAddress || unit.settleAddress;
}

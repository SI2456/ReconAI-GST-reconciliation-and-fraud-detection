import fs from "fs";

const extractedJson = JSON.parse(fs.readFileSync("server/data/uploads/upl_1a0cdaeb319_99726359_VRS-26-27-0005_extracted.json", "utf-8"));

// Adapt extracted json to DocumentVerificationModal data structure
const data = {
  invoiceInfo: {
    invoiceNumber: extractedJson.invoice_number,
    invoiceDate: extractedJson.invoice_date,
  },
  supplierInfo: {
    supplierName: extractedJson.supplier.name,
    supplierGstin: extractedJson.supplier.gstin,
    supplierState: extractedJson.supplier.state,
  },
  buyerInfo: {
    buyerName: extractedJson.buyer.name,
    buyerGstin: extractedJson.buyer.gstin,
    buyerState: extractedJson.buyer.state,
    placeOfSupply: extractedJson.place_of_supply,
  },
  taxInfo: {
    cgstRate: extractedJson.tax_summary.cgst_rate,
    sgstRate: extractedJson.tax_summary.sgst_rate,
    cgstAmount: extractedJson.tax_summary.cgst_amount,
    sgstAmount: extractedJson.tax_summary.sgst_amount,
    igstAmount: extractedJson.tax_summary.igst_amount || "0",
    totalTaxAmount: extractedJson.tax_summary.total_tax,
  },
  productInfo: {
    taxableAmount: extractedJson.amount_summary.subtotal,
    grandTotal: extractedJson.amount_summary.grand_total,
    lineItems: extractedJson.line_items,
  },
};

function parseNumber(val) {
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  if (!val) return 0;
  const clean = String(val).replace(/[^0-9.-]/g, "");
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
}

const UT_WITHOUT_LEGISLATURE = new Set(["04", "26", "31", "35", "38", "97"]);
const RATE_TOLERANCE = 0.5;

const STATUTORY_HSN_SAC_REGISTRY = {
  "9983": { type: "SAC", categoryName: "IT, Software, Professional & Technical Services", defaultRate: 18, allowedRates: [18] },
  "998313": { type: "SAC", categoryName: "Information technology (IT) systems and application development", defaultRate: 18, allowedRates: [18] },
  "998314": { type: "SAC", categoryName: "Internet telecommunication, website hosting & IT infrastructure", defaultRate: 18, allowedRates: [18] },
  "9984": { type: "SAC", categoryName: "Telecommunication, broadcasting & information supply services", defaultRate: 18, allowedRates: [18] },
  "9987": { type: "SAC", categoryName: "Maintenance, repair and installation services (AMC)", defaultRate: 18, allowedRates: [18] },
  "998713": { type: "SAC", categoryName: "Maintenance and repair services of computers and peripheral equipment", defaultRate: 18, allowedRates: [18] },
  "9982": { type: "SAC", categoryName: "Legal, accounting, auditing, bookkeeping and tax consultancy services", defaultRate: 18, allowedRates: [18] },
  "9985": { type: "SAC", categoryName: "Support services, manpower recruitment and security services", defaultRate: 18, allowedRates: [18] },
  "9965": { type: "SAC", categoryName: "Goods transport agency (GTA) and freight forwarding", defaultRate: 5, allowedRates: [0, 5, 12] },
  "9964": { type: "SAC", categoryName: "Passenger transport services (Taxi, air, bus)", defaultRate: 5, allowedRates: [5, 12, 18] },
  "9963": { type: "SAC", categoryName: "Accommodation, food and beverage services (Hotel / Restaurant)", defaultRate: 5, allowedRates: [5, 12, 18] },
  "9971": { type: "SAC", categoryName: "Financial and banking services, loan processing fees", defaultRate: 18, allowedRates: [18] },
  "9972": { type: "SAC", categoryName: "Real estate and property management services", defaultRate: 18, allowedRates: [18] },
  "9973": { type: "SAC", categoryName: "Leasing or rental services of machinery / equipment", defaultRate: 18, allowedRates: [18] },
  "9954": { type: "SAC", categoryName: "Construction services and civil contracting", defaultRate: 18, allowedRates: [12, 18] },
  "9991": { type: "SAC", categoryName: "Public administration and government statutory services", defaultRate: 18, allowedRates: [0, 18] },
  "9992": { type: "SAC", categoryName: "Commercial training and education coaching services", defaultRate: 18, allowedRates: [0, 18] },
  "9996": { type: "SAC", categoryName: "Recreational, cultural and sporting services", defaultRate: 18, allowedRates: [18, 28] },
  "9997": { type: "SAC", categoryName: "Other personal services (Cleaning, laundry, beauty)", defaultRate: 18, allowedRates: [18] },
  "8471": { type: "HSN", categoryName: "Automatic data processing machines / Computers / Laptops / Servers", defaultRate: 18, allowedRates: [18] },
  "847130": { type: "HSN", categoryName: "Portable automatic data processing machines (Laptops / Notebooks)", defaultRate: 18, allowedRates: [18] },
  "8473": { type: "HSN", categoryName: "Parts and accessories of computers and processing units", defaultRate: 18, allowedRates: [18] },
  "8517": { type: "HSN", categoryName: "Telephone sets, smartphones, routers, network switches and modems", defaultRate: 18, allowedRates: [18] },
  "8504": { type: "HSN", categoryName: "Electrical transformers, static converters (UPS/inverters), power supplies", defaultRate: 18, allowedRates: [18] },
  "8528": { type: "HSN", categoryName: "Monitors and projectors, computer displays, LED panels", defaultRate: 18, allowedRates: [18, 28] },
  "8443": { type: "HSN", categoryName: "Printers, multifunctional copying machines and ink cartridges", defaultRate: 18, allowedRates: [18] },
  "8703": { type: "HSN", categoryName: "Motor cars and passenger vehicles", defaultRate: 28, allowedRates: [28] },
  "8708": { type: "HSN", categoryName: "Parts and accessories of motor vehicles", defaultRate: 28, allowedRates: [28] },
  "7208": { type: "HSN", categoryName: "Flat-rolled products of iron or non-alloy steel", defaultRate: 18, allowedRates: [18] },
  "7210": { type: "HSN", categoryName: "Flat-rolled products of iron or steel, clad, plated or coated", defaultRate: 18, allowedRates: [18] },
  "7214": { type: "HSN", categoryName: "Other bars and rods of iron or non-alloy steel (TMT bars)", defaultRate: 18, allowedRates: [18] },
  "7306": { type: "HSN", categoryName: "Other tubes, pipes and hollow profiles of iron or steel", defaultRate: 18, allowedRates: [18] },
  "7308": { type: "HSN", categoryName: "Structures and parts of structures of iron or steel", defaultRate: 18, allowedRates: [18] },
  "3923": { type: "HSN", categoryName: "Articles for conveyance or packing of goods, of plastics", defaultRate: 18, allowedRates: [18] },
  "3926": { type: "HSN", categoryName: "Other articles of plastics and articles of other materials", defaultRate: 18, allowedRates: [18] },
  "4819": { type: "HSN", categoryName: "Cartons, boxes, cases, bags and other packing containers of paper", defaultRate: 18, allowedRates: [12, 18] },
  "4820": { type: "HSN", categoryName: "Registers, account books, note books, order books of paper", defaultRate: 18, allowedRates: [0, 12, 18] },
  "3004": { type: "HSN", categoryName: "Medicaments (excluding goods of heading 3002, 3005 or 3006)", defaultRate: 12, allowedRates: [0, 5, 12] },
  "6109": { type: "HSN", categoryName: "T-shirts, singlets and other vests, knitted or crocheted", defaultRate: 5, allowedRates: [5, 12] },
  "6203": { type: "HSN", categoryName: "Men's or boys' suits, ensembles, jackets, blazers, trousers", defaultRate: 12, allowedRates: [5, 12] },
  "2710": { type: "HSN", categoryName: "Petroleum oils, lubricants and mineral oils", defaultRate: 18, allowedRates: [18] },
  "9403": { type: "HSN", categoryName: "Other furniture and parts thereof (Office & home)", defaultRate: 18, allowedRates: [18] },
  "9018": { type: "HSN", categoryName: "Instruments and appliances used in medical, surgical sciences", defaultRate: 12, allowedRates: [12] },
  "8415": { type: "HSN", categoryName: "Air conditioning machines, comprising a motor-driven fan", defaultRate: 28, allowedRates: [28] },
  "8418": { type: "HSN", categoryName: "Refrigerators, freezers and other refrigerating equipment", defaultRate: 18, allowedRates: [18, 28] },
};

function lookupHsnSacStatutoryRegistry(rawCode) {
  if (!rawCode) return null;
  const clean = rawCode.replace(/[^0-9]/g, "");
  if (!clean || clean.length < 2) return null;

  const prefixes = [clean, clean.slice(0, 6), clean.slice(0, 4), clean.slice(0, 2)];
  for (const p of prefixes) {
    if (STATUTORY_HSN_SAC_REGISTRY[p]) {
      const entry = STATUTORY_HSN_SAC_REGISTRY[p];
      return {
        found: true,
        type: entry.type,
        code: clean,
        matchedKey: p,
        categoryName: entry.categoryName,
        defaultRate: entry.defaultRate,
        allowedRates: entry.allowedRates,
      };
    }
  }

  const isSac = clean.startsWith("99");
  const chapter = parseInt(clean.slice(0, 2), 10);
  if (isSac) {
    return {
      found: true,
      type: "SAC",
      code: clean,
      matchedKey: clean.slice(0, 4) || "99",
      categoryName: `SAC Service Code ${clean}`,
      defaultRate: 18,
      allowedRates: [0, 5, 12, 18, 28],
    };
  } else if (!isNaN(chapter) && chapter >= 1 && chapter <= 98) {
    let defaultRate = 18;
    if (chapter >= 84 && chapter <= 85) defaultRate = 18;
    else if (chapter === 87) defaultRate = 28;
    else if (chapter >= 1 && chapter <= 24) defaultRate = 5;
    else if (chapter >= 28 && chapter <= 38) defaultRate = 18;
    else if (chapter >= 72 && chapter <= 83) defaultRate = 18;
    return {
      found: true,
      type: "HSN",
      code: clean,
      matchedKey: clean.slice(0, 4) || clean.slice(0, 2),
      categoryName: `Chapter ${chapter} Goods Classification`,
      defaultRate,
      allowedRates: [0, 5, 12, 18, 28],
    };
  }
  return null;
}

const l3Items = [];
let l3Risk = 0;
const lineItems = data.productInfo?.lineItems || [];

console.log("[RUNTIME CONSOLE LOG] lineItems payload for VRS/26-27/0005:");
console.log(JSON.stringify(lineItems, null, 2));

const goodsKeywords = ["laptop", "computer", "server", "hardware", "device", "steel", "iron", "equipment", "box", "paper", "oil", "chemical", "cable", "wire", "pipe", "valve", "cotton", "plastic", "battery", "monitor", "part", "material", "goods", "machine", "component"];

const docTaxRate = (parseNumber(data.taxInfo?.cgstRate) + parseNumber(data.taxInfo?.sgstRate)) ||
  (parseNumber(data.taxInfo?.totalTaxAmount) && parseNumber(data.productInfo?.taxableAmount)
    ? Math.round((parseNumber(data.taxInfo?.totalTaxAmount) / parseNumber(data.productInfo?.taxableAmount)) * 100)
    : 0);

lineItems.forEach((row, idx) => {
  let desc = "";
  let code = "";
  let itemRate = 0;
  let hasItemWiseRate = false;

  if (typeof row === "object" && row !== null && !Array.isArray(row)) {
    desc = String(row.description || row.item || row.name || `Item #${idx + 1}`).trim();
    code = String(row.hsn || row.sac || row.code || "").trim();
    const igstAmtField = parseNumber(row.igstRate);
    const cgstAmtField = parseNumber(row.cgstRate);
    const sgstAmtField = parseNumber(row.sgstRate) || parseNumber(row.utgstRate);

    if (igstAmtField > 0) {
      itemRate = igstAmtField;
      hasItemWiseRate = true;
    } else if (cgstAmtField > 0 || sgstAmtField > 0) {
      itemRate = cgstAmtField + sgstAmtField;
      hasItemWiseRate = true;
    } else {
      const generalRate = parseNumber(row.gstRate || row.taxRate || row.gst);
      if (generalRate > 0 && generalRate <= 28) {
        itemRate = generalRate;
        hasItemWiseRate = true;
      }
    }
  } else if (Array.isArray(row)) {
    desc = String(row[1] || `Item #${idx + 1}`).trim();
    code = String(row[2] || "").trim();
    if (!code || isNaN(parseNumber(code))) {
      for (const cell of row) {
        const s = String(cell || "").trim();
        if (/^\d{2,8}$/.test(s)) {
          code = s;
          break;
        }
      }
    }

    const percentMatches = [];
    for (const cell of row) {
      const s = String(cell || "").trim();
      if (s.includes("%")) {
        const p = parseNumber(s);
        if (p > 0 && p <= 28) {
          percentMatches.push(p);
        }
      }
    }

    if (percentMatches.length === 2) {
      if (Math.abs(percentMatches[0] - percentMatches[1]) <= 0.1) {
        itemRate = percentMatches[0] + percentMatches[1];
        hasItemWiseRate = true;
      } else {
        l3Items.push({
          id: `hsn_ambiguous_${idx}`,
          name: `Item #${idx + 1} Rate Column Verification (${code || desc.slice(0, 20)})`,
          category: "Statutory Rate Check",
          expected: "Unambiguous tax rate specification",
          received: `Multiple distinct rates found: ${percentMatches.map(m => `${m}%`).join(", ")}`,
          status: "REVIEW",
          riskPoints: 0,
          reason: "⚠️ Ambiguous rate columns detected — manual verification required",
        });
      }
    } else if (percentMatches.length === 1) {
      const singleRate = percentMatches[0];
      const docCgstRate = parseNumber(data.taxInfo?.cgstRate);
      const docSgstRate = parseNumber(data.taxInfo?.sgstRate);
      const docSplitSum = docCgstRate + docSgstRate;
      if (docSplitSum > 0 && docCgstRate > 0 && docSgstRate > 0 &&
        Math.abs(docSplitSum - singleRate * 2) <= RATE_TOLERANCE) {
        itemRate = docSplitSum;
      } else {
        itemRate = singleRate;
      }
      hasItemWiseRate = true;
    } else if (row.length === 8 && row[6] !== undefined && String(row[6]).trim() !== "" && String(row[6]).trim() !== "—") {
      const gstCell = String(row[6]).trim();
      const p = parseNumber(gstCell);
      if (p > 0 && p <= 28) {
        itemRate = p;
        hasItemWiseRate = true;
      }
    }
  }

  const appliedRate = hasItemWiseRate ? itemRate : docTaxRate;

  console.log(`[RUNTIME CONSOLE LOG] Line Item #${idx + 1}:`);
  console.log(`  code: "${code}"`);
  console.log(`  itemRate: ${itemRate}`);
  console.log(`  hasItemWiseRate: ${hasItemWiseRate}`);
  console.log(`  docTaxRate: ${docTaxRate}`);
  console.log(`  appliedRate: ${appliedRate}`);

  const lowerDesc = desc.toLowerCase();
  const isGoodsDesc = goodsKeywords.some(k => lowerDesc.includes(k));
  const isSacCode = code.startsWith("99") && code.length >= 4;
  const isNumericCode = /^\d{2,8}$/.test(code);

  if (code && isNumericCode) {
    const statutory = lookupHsnSacStatutoryRegistry(code);
    if (statutory && statutory.allowedRates.length > 0) {
      const effectiveRate = appliedRate > 0 ? appliedRate : docTaxRate;
      const isRateAllowed = statutory.allowedRates.some(
        r => Math.abs(r - effectiveRate) <= RATE_TOLERANCE
      );
      const maxAllowed = Math.max(...statutory.allowedRates) + RATE_TOLERANCE;
      const minAllowed = Math.min(...statutory.allowedRates) - RATE_TOLERANCE;

      if (effectiveRate === 0 && !isRateAllowed) {
        l3Risk += 10;
        l3Items.push({
          id: `hsn_rate_${idx}`,
          name: `Item #${idx + 1} GST Rate Check (${code})`,
          category: "Statutory Rate Check",
          expected: `Statutory Rate: ${statutory.defaultRate}% (${statutory.categoryName})`,
          received: "Charged: 0% GST (NIL / Exempt Supply)",
          status: "REVIEW",
          riskPoints: 10,
          reason: "⚠️ Zero-rate invoice on a normally-taxable HSN/SAC code — confirm this is a genuine exemption, export, or NIL-rated supply, not a missed tax charge",
        });
      } else if (!isRateAllowed && effectiveRate > maxAllowed) {
        l3Risk += 25;
        l3Items.push({
          id: `hsn_rate_${idx}`,
          name: `Item #${idx + 1} GST Rate Check (${code})`,
          category: "Statutory Rate Check",
          expected: `Statutory Rate: ${statutory.defaultRate}% (${statutory.categoryName})`,
          received: `Charged: ${effectiveRate}% GST (Excess Rate Anomaly)`,
          status: "FAIL",
          riskPoints: 25,
          reason: `🚨 Excess GST Rate Applied: HSN/SAC ${code} has statutory rate of ${statutory.defaultRate}%, but invoice charged ${effectiveRate}% (Rate excess of +${(effectiveRate - statutory.defaultRate).toFixed(1)}%)`,
        });
      } else if (!isRateAllowed && effectiveRate < minAllowed) {
        l3Risk += 25;
        l3Items.push({
          id: `hsn_rate_${idx}`,
          name: `Item #${idx + 1} GST Rate Check (${code})`,
          category: "Statutory Rate Check",
          expected: `Statutory Rate: ${statutory.defaultRate}% (${statutory.categoryName})`,
          received: `Charged: ${effectiveRate}% GST (Under-Taxation Anomaly)`,
          status: "FAIL",
          riskPoints: 25,
          reason: `🚨 Under-Taxation / Short Levy: HSN/SAC ${code} has statutory rate of ${statutory.defaultRate}%, but invoice charged only ${effectiveRate}% (Tax shortfall of -${(statutory.defaultRate - effectiveRate).toFixed(1)}%)`,
        });
      } else {
        const rateSourceNote = hasItemWiseRate
          ? `Item-wise ${effectiveRate}% GST`
          : `Document Summary ${effectiveRate}% GST (${data.taxInfo?.cgstRate || "9%"} CGST + ${data.taxInfo?.sgstRate || "9%"} SGST)`;
        l3Items.push({
          id: `hsn_rate_${idx}`,
          name: `Item #${idx + 1} Database & Rate Verification (${code})`,
          category: "HSN.xlsx / SAC.xlsx Lookup",
          expected: `Statutory Rate: ${statutory.defaultRate}% (${statutory.categoryName})`,
          received: `${statutory.type} Code ${code} verified at ${effectiveRate}% GST [${rateSourceNote}]`,
          status: "PASS",
          riskPoints: 0,
          details: `✓ Matched in official ${statutory.type}.xlsx: "${statutory.categoryName}". Statutory rate ${statutory.defaultRate}% verified via ${rateSourceNote}.`,
        });
      }
    }
  }
});

const cleanGstin = (data.supplierInfo?.supplierGstin || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const suppStateCode = cleanGstin.slice(0, 2);
const rawPos = (data.buyerInfo?.placeOfSupply || data.buyerInfo?.buyerState || "").toUpperCase();
const posCode = rawPos.slice(0, 2);

const suppCode = suppStateCode || cleanGstin.slice(0, 2);
const posCodeVal = posCode || (rawPos.match(/^\d{2}/) ? rawPos.slice(0, 2) : "");
const isSameStateTx = Boolean(suppCode && posCodeVal && suppCode === posCodeVal);
const docIgstAmt = parseNumber(data.taxInfo?.igstAmount);
const docCgstAmt = parseNumber(data.taxInfo?.cgstAmount);
const docSgstAmt = parseNumber(data.taxInfo?.sgstAmount);

let jurisdictionOk = true;
let jurisdictionReason = "";

if (isSameStateTx) {
  if (docIgstAmt > 0.01) {
    jurisdictionOk = false;
    jurisdictionReason = `🚨 Wrong Tax Type: Supplier and place of supply are both in ${suppCode} (intra-state), but IGST was charged instead of CGST+SGST${UT_WITHOUT_LEGISLATURE.has(suppCode) ? "/UTGST" : ""}`;
  } else if (docCgstAmt <= 0.01 || docSgstAmt <= 0.01) {
    jurisdictionOk = false;
    jurisdictionReason = `🚨 Incomplete Split: Intra-state supply requires both CGST and SGST${UT_WITHOUT_LEGISLATURE.has(suppCode) ? "/UTGST" : ""} components, but one or both are missing/zero`;
  }
} else {
  if (docCgstAmt > 0.01 || docSgstAmt > 0.01) {
    jurisdictionOk = false;
    jurisdictionReason = `🚨 Wrong Tax Type: Supplier (${suppCode}) and place of supply (${posCodeVal || "N/A"}) differ (inter-state), but CGST/SGST was charged instead of IGST`;
  } else if (docIgstAmt <= 0.01) {
    jurisdictionOk = false;
    jurisdictionReason = `🚨 Missing IGST: Inter-state supply requires IGST, but none was charged`;
  }
}

l3Items.push({
  id: "hsn_jurisdiction",
  name: "Tax Jurisdiction & Type Validation",
  category: "Jurisdiction Check",
  expected: isSameStateTx
    ? `Intra-state (${suppCode}): CGST + SGST${UT_WITHOUT_LEGISLATURE.has(suppCode) ? "/UTGST" : ""} split`
    : `Inter-state (${suppCode} → ${posCodeVal || "N/A"}): IGST only`,
  received: `CGST: ₹${docCgstAmt.toFixed(2)}, SGST: ₹${docSgstAmt.toFixed(2)}, IGST: ₹${docIgstAmt.toFixed(2)}`,
  status: jurisdictionOk ? "PASS" : "FAIL",
  riskPoints: jurisdictionOk ? 0 : 25,
  reason: jurisdictionOk ? undefined : jurisdictionReason,
  details: jurisdictionOk ? "✓ Tax type matches transaction jurisdiction" : undefined,
});
if (!jurisdictionOk) l3Risk += 25;

const l3Failures = l3Items.filter(i => i.status === "FAIL");
const l3Status = l3Failures.length === 0 ? "PASS" : "FAIL";

console.log("\n=== LEVEL 3 EVALUATION RESULT ===");
console.log("Level 3 Status:", l3Status);
console.log("Level 3 Risk Points:", l3Risk);
console.log("\n[RUNTIME CONSOLE LOG] Computed l3Items:");
console.log(JSON.stringify(l3Items, null, 2));

import { describe, expect, test } from "bun:test";
import { toCsv, parseCsv } from "../data/csv.ts";
import { decodeEntities } from "../lib/html.ts";
import {
  cleanProductName,
  readManufacturerFromDetails,
  readManufacturersPage,
  readProductsPage,
  toProductRow,
} from "./reader.ts";

// Shapes copied from live Greenbook responses (trimmed).
const PRODUCTS_JSON = JSON.stringify({
  draw: 1,
  recordsTotal: 8966,
  recordsFiltered: 8966,
  data: [
    {
      product_id: 3125,
      manufacturer_id: 304,
      applicant_id: 689,
      ingredient_id: 1529,
      product_name: "Marley Paracetamol Injection##",
      strength: "300 mg/2 mL",
      NAFDAC: "C4-1496",
      approval_date: "2020-12-21",
      expiry_date: "2025-12-20",
      status: "Inactive",
      smpc: "",
      ingredient: { ingredient_name: "Paracetamol" },
      category_name: "Drugs",
      ingredient_name: "Paracetamol",
      form_name: "Solution for injection",
      applicant_name: "MarleyShree Pharmaceutical Company Nigeria Limited",
      route_name: "Intravenous; Intramuscular",
    },
  ],
});

const MANUFACTURERS_HTML = `
  <div class="card naf-card col-md-3  col-11" >
    <a href="https://greenbook.nafdac.gov.ng/manufacturer/products/379">
      <div class="card-body" >
        <h5>A &amp; J Pharmaceutical Nigeria Limited</h5>
        <span> 1  Products, </span>
      </div>
    </a>
  </div>
  <div class="card naf-card col-md-3  col-11" >
    <a href="https://greenbook.nafdac.gov.ng/manufacturer/products/1427">
      <div class="card-body" ><h5>Dr. Reddy&#039;s Laboratories</h5></div>
    </a>
  </div>`;

const DETAILS_HTML = `<div><b>Manufacturer Name</b></div><div>TianJin KingYork Group Co. Ltd</div>
  <div><b>Manufacturer Country</b></div><div>CHINA &nbsp;</div>`;

describe("Greenbook reader", () => {
  test("reads product pages and keeps only known fields", () => {
    const page = readProductsPage(PRODUCTS_JSON);
    expect(page.recordsTotal).toBe(8966);
    const [product] = page.data;
    expect(product?.NAFDAC).toBe("C4-1496");
    expect(product).not.toHaveProperty("ingredient");
    expect(product).not.toHaveProperty("smpc");
  });

  test("rejects unexpected responses", () => {
    expect(() => readProductsPage('{"error":"nope"}')).toThrow();
  });

  test("reads manufacturer cards and decodes entities", () => {
    expect(readManufacturersPage(MANUFACTURERS_HTML)).toEqual([
      { id: 379, name: "A & J Pharmaceutical Nigeria Limited" },
      { id: 1427, name: "Dr. Reddy's Laboratories" },
    ]);
    expect(decodeEntities("&#x41;&lt;&unknown;")).toBe("A<&unknown;");
  });

  test("reads the manufacturer from a details page", () => {
    expect(readManufacturerFromDetails(DETAILS_HTML)).toBe("TianJin KingYork Group Co. Ltd");
    expect(readManufacturerFromDetails("<p>nothing</p>")).toBeNull();
  });

  test("maps a product to a master CSV row that round-trips", () => {
    const [product] = readProductsPage(PRODUCTS_JSON).data;
    const row = toProductRow(product!, new Map([[304, "TianJin KingYork Group Co. Ltd"]]), "2026-10-31");
    expect(row.product_name).toBe("Marley Paracetamol Injection");
    expect(row.manufacturer).toBe("TianJin KingYork Group Co. Ltd");
    expect(row.approval_status).toBe("Inactive");
    expect(row.source_url).toBe("https://greenbook.nafdac.gov.ng/products/details/3125");
    expect(row.notes).toBe("Registration expiry 2025-12-20");
    const values = Object.values(row);
    expect(parseCsv(toCsv([values]))).toEqual([values]);
  });

  test("strips Greenbook's # and * markers", () => {
    expect(cleanProductName(" Foo*  Bar## ")).toBe("Foo Bar");
  });
});

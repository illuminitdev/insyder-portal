
export const COUNTRIES: Array<{ code: string; name: string }> = [
  { code: "GB", name: "United Kingdom" },
  { code: "IE", name: "Ireland" },
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "BE", name: "Belgium" },
  { code: "DK", name: "Denmark" },
  { code: "FR", name: "France" },
  { code: "DE", name: "Germany" },
  { code: "IN", name: "India" },
  { code: "IT", name: "Italy" },
  { code: "NL", name: "Netherlands" },
  { code: "NO", name: "Norway" },
  { code: "PL", name: "Poland" },
  { code: "SG", name: "Singapore" },
  { code: "ES", name: "Spain" },
  { code: "SE", name: "Sweden" },
  { code: "CH", name: "Switzerland" },
];

const NAMES = new Map(COUNTRIES.map((c) => [c.code, c.name]));

/** "GB" → "United Kingdom"; unknown codes are shown as they are */
export const countryName = (code: string) => NAMES.get(code.toUpperCase()) ?? code;

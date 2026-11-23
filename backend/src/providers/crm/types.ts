/**
 * Provider-neutral CRM adapter (spec R8: "CRM integration behind an adapter"). HubSpot and
 * Salesforce implement it; another CRM is a new class implementing this interface, nothing else.
 */

/** Our opportunity stages (same keys as the opportunities table). Each CRM maps them to its own stage ids. */
export type CrmStageKey = "qualified" | "meeting" | "proposal" | "negotiation" | "won" | "lost";

export type CrmObjectType = "company" | "contact" | "deal";

export type CrmCompanyInput = { name: string; domain: string | null; country: string | null };
export type CrmContactInput = {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
};
export type CrmDealInput = {
  name: string;
  /** Provider stage id, already mapped from our opportunity stage */
  stageId: string;
  pipelineId: string;
  amount: number | null;
  currency: string;
};

export type CrmDealStage = { id: string; label: string; pipelineId: string; isClosed: boolean };

export type CrmDeal = { id: string; stageId: string | null; amount: number | null; currency: string | null; updatedAt: string | null };

/** HubSpot lifecycle stages a company can be imported by (Salesforce maps its own later). */
export const crmLifecycleStages = [
  "subscriber",
  "lead",
  "marketingqualifiedlead",
  "salesqualifiedlead",
  "opportunity",
  "customer",
  "evangelist",
  "other",
] as const;
export type CrmLifecycleStage = (typeof crmLifecycleStages)[number];

export type CrmImportFilter = { stages: string[] };

/** One CRM company as read for import. Only the fields Insyder needs; never notes or emails. */
export type CrmImportCompany = {
  id: string;
  name: string;
  domain: string | null;
  country: string | null;
  city: string | null;
  industry: string | null;
  employees: number | null;
  lifecycleStage: string | null;
};

export type CrmImportContact = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
};

export interface CrmProvider {
  readonly name: string;
  /** Field mapping (spec R8): our opportunity stage → this CRM's stage id */
  readonly stageMap: Record<CrmStageKey, string>;
  /** The pipeline new deals go into */
  readonly pipelineId: string;
  /** Which CRM account/org the credential reaches; used to verify a connection and label it */
  describeAccount(): Promise<{ id: string; label: string }>;
  /** Find an existing object so a first sync links to it instead of creating a duplicate */
  findCompanyByDomain(domain: string): Promise<string | null>;
  findContactByEmail(email: string): Promise<string | null>;
  createCompany(input: CrmCompanyInput): Promise<string>;
  updateCompany(id: string, input: CrmCompanyInput): Promise<void>;
  createContact(input: CrmContactInput): Promise<string>;
  updateContact(id: string, input: CrmContactInput): Promise<void>;
  createDeal(input: CrmDealInput): Promise<string>;
  updateDeal(id: string, input: CrmDealInput): Promise<void>;
  /** Idempotent: associating twice is a no-op */
  associate(from: CrmObjectType, fromId: string, to: CrmObjectType, toId: string): Promise<void>;
  /** Does the object still exist? A deleted CRM record is re-created rather than silently lost */
  exists(type: CrmObjectType, id: string): Promise<boolean>;
  getDeal(id: string): Promise<CrmDeal | null>;
  listDealStages(): Promise<CrmDealStage[]>;
  /** Currencies the CRM accepts for deal values; a deal in any other currency is blocked, never converted */
  currencies(): Promise<{ primary: string; all: string[] }>;
  /** Link to the object in the CRM's own UI, if the provider supports it */
  recordUrl(type: CrmObjectType, id: string): string | null;

  /* Import (read only). Optional: a CRM without these can't be imported from, and the button stays hidden. */
  countCompaniesForImport?(filter: CrmImportFilter): Promise<number>;
  listCompaniesForImport?(
    filter: CrmImportFilter,
    cursor: string | null,
    limit?: number,
  ): Promise<{ companies: CrmImportCompany[]; next: string | null }>;
  listCompanyContacts?(companyId: string, limit?: number): Promise<CrmImportContact[]>;
}

/** Normalized provider failure; `retryable` drives bounded retries in the job. */
export class CrmError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "CrmError";
  }
}

/**
 * ریپازیتوری کاتالوگ: خدمات، آگهی‌ها، نیازمندی‌ها و تطبیق‌ها.
 */
import { all, get, jsonParse, nowIso, run } from "@/db/client";
import { newId } from "@/lib/ids";

/* ── خدمات ───────────────────────────────────────────────────────── */

export interface ServiceRow {
  id: string;
  key: string;
  name: string;
  category: string;
  description: string | null;
  price: number;
  requires_subscription: number;
  requires_referral: number;
  workflow_key: string;
  required_documents: string;
  active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

type SqlScalar = string | number | null;

/** مقدار قابل اتصال به SQLite: آرایه/شیء → JSON، بولین → ۰/۱، undefined → پیش‌فرض */
function jsonOr(value: unknown, fallback: SqlScalar = null): SqlScalar {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return JSON.stringify(value);
}

export function listServices(onlyActive = false): ServiceRow[] {
  return all<ServiceRow>(
    `SELECT * FROM services ${onlyActive ? "WHERE active = 1" : ""} ORDER BY sort_order, name`,
  );
}

export function getServiceByKey(key: string): ServiceRow | null {
  return get<ServiceRow>("SELECT * FROM services WHERE key = ?", [key]);
}

export function upsertService(input: {
  key: string;
  name: string;
  category: string;
  description?: string | null;
  price?: number;
  requiresSubscription?: boolean;
  requiresReferral?: boolean;
  workflowKey: string;
  requiredDocuments?: string[];
  active?: boolean;
  sortOrder?: number;
}): string {
  const existing = getServiceByKey(input.key);
  const now = nowIso();
  const docs = JSON.stringify(input.requiredDocuments ?? []);
  if (existing) {
    run(
      `UPDATE services SET name = ?, category = ?, description = ?, price = ?, requires_subscription = ?,
        requires_referral = ?, workflow_key = ?, required_documents = ?, active = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`,
      [
        input.name,
        input.category,
        input.description ?? existing.description,
        input.price ?? existing.price,
        input.requiresSubscription === undefined ? existing.requires_subscription : input.requiresSubscription ? 1 : 0,
        input.requiresReferral === undefined ? existing.requires_referral : input.requiresReferral ? 1 : 0,
        input.workflowKey,
        docs,
        input.active === undefined ? existing.active : input.active ? 1 : 0,
        input.sortOrder ?? existing.sort_order,
        now,
        existing.id,
      ],
    );
    return existing.id;
  }
  const id = newId("svc");
  run(
    `INSERT INTO services (id, key, name, category, description, price, requires_subscription, requires_referral,
       workflow_key, required_documents, active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.key,
      input.name,
      input.category,
      input.description ?? null,
      input.price ?? 0,
      input.requiresSubscription ? 1 : 0,
      input.requiresReferral ? 1 : 0,
      input.workflowKey,
      docs,
      input.active === false ? 0 : 1,
      input.sortOrder ?? 0,
      now,
      now,
    ],
  );
  return id;
}

export function serviceRequiredDocuments(key: string): string[] {
  const service = getServiceByKey(key);
  return jsonParse<string[]>(service?.required_documents, []);
}

/* ── آگهی‌ها ─────────────────────────────────────────────────────── */

export interface ListingRow {
  id: string;
  case_id: string | null;
  external_id: string | null;
  source: string | null;
  owner_user_id: string | null;
  agent_user_id: string | null;
  deal_type: "rent" | "sale";
  property_type: string;
  city: string | null;
  district: string | null;
  address: string | null;
  area: number | null;
  rooms: number | null;
  year_built: number | null;
  price: number | null;
  deposit: number | null;
  rent: number | null;
  description: string | null;
  amenities: string;
  images: string;
  status: "draft" | "pending_review" | "published" | "paused" | "expired" | "closed";
  reject_reason: string | null;
  published_at: string | null;
  expires_at: string | null;
  views: number;
  created_at: string;
  updated_at: string;
}

export function findListingById(id: string): ListingRow | null {
  return get<ListingRow>("SELECT * FROM listings WHERE id = ?", [id]);
}

export function findListingByCase(caseId: string): ListingRow | null {
  return get<ListingRow>("SELECT * FROM listings WHERE case_id = ? ORDER BY created_at DESC LIMIT 1", [caseId]);
}

export function findListingByExternal(source: string, externalId: string): ListingRow | null {
  return get<ListingRow>("SELECT * FROM listings WHERE source = ? AND external_id = ?", [source, externalId]);
}

export function listListings(opts: { status?: string; search?: string; limit?: number; offset?: number } = {}): ListingRow[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (opts.status) {
    clauses.push("status = ?");
    params.push(opts.status);
  }
  if (opts.search) {
    clauses.push("(address LIKE ? OR district LIKE ? OR city LIKE ?)");
    const like = `%${opts.search}%`;
    params.push(like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(opts.limit ?? 100, opts.offset ?? 0);
  return all<ListingRow>(`SELECT * FROM listings ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`, params);
}

export function createListing(input: Record<string, unknown> & { caseId?: string | null }): string {
  const id = String(input.id ?? newId("lst"));
  const now = nowIso();
  run(
    `INSERT INTO listings (id, case_id, external_id, source, owner_user_id, agent_user_id, deal_type, property_type,
       city, district, address, area, rooms, year_built, price, deposit, rent, description, amenities, images,
       status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      jsonOr(input.caseId ?? input.case_id),
      jsonOr(input.external_id),
      jsonOr(input.source),
      jsonOr(input.owner_user_id),
      jsonOr(input.agent_user_id),
      jsonOr(input.deal_type, "rent"),
      jsonOr(input.property_type, "آپارتمان"),
      jsonOr(input.city),
      jsonOr(input.district),
      jsonOr(input.address),
      jsonOr(input.area),
      jsonOr(input.rooms),
      jsonOr(input.year_built),
      jsonOr(input.price),
      jsonOr(input.deposit),
      jsonOr(input.rent),
      jsonOr(input.description),
      jsonOr(input.amenities, "[]"),
      jsonOr(input.images, "[]"),
      jsonOr(input.status, "draft"),
      now,
      now,
    ],
  );
  return id;
}

export function updateListing(id: string, patch: Record<string, unknown>): void {
  const allowed = [
    "case_id", "external_id", "source", "owner_user_id", "agent_user_id", "deal_type", "property_type", "city",
    "district", "address", "area", "rooms", "year_built", "price", "deposit", "rent", "description", "amenities",
    "images", "status", "reject_reason", "published_at", "expires_at", "views",
  ];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => {
    const v = patch[k];
    if (v === undefined || v === null) return null as string | number | null;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "object") return JSON.stringify(v);
    return v as string | number;
  });
  run(`UPDATE listings SET ${sets}, updated_at = ? WHERE id = ?`, [...values, nowIso(), id]);
}

/* ── نیازمندی‌ها ─────────────────────────────────────────────────── */

export interface RequirementRow {
  id: string;
  case_id: string | null;
  external_id: string | null;
  source: string | null;
  requester_user_id: string | null;
  deal_type: "rent" | "sale";
  property_type: string | null;
  city: string | null;
  districts: string;
  budget_min: number | null;
  budget_max: number | null;
  area_min: number | null;
  area_max: number | null;
  rooms: number | null;
  description: string | null;
  access_level: "public" | "agents" | "staff";
  status: "open" | "matched" | "fulfilled" | "expired" | "cancelled";
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export function findRequirementById(id: string): RequirementRow | null {
  return get<RequirementRow>("SELECT * FROM requirements WHERE id = ?", [id]);
}

export function findRequirementByCase(caseId: string): RequirementRow | null {
  return get<RequirementRow>("SELECT * FROM requirements WHERE case_id = ? ORDER BY created_at DESC LIMIT 1", [caseId]);
}

export function findRequirementByExternal(source: string, externalId: string): RequirementRow | null {
  return get<RequirementRow>("SELECT * FROM requirements WHERE source = ? AND external_id = ?", [source, externalId]);
}

export function listRequirements(opts: { accessLevels?: string[]; status?: string; limit?: number } = {}): RequirementRow[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (opts.accessLevels?.length) {
    clauses.push(`access_level IN (${opts.accessLevels.map(() => "?").join(", ")})`);
    params.push(...opts.accessLevels);
  }
  if (opts.status) {
    clauses.push("status = ?");
    params.push(opts.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(opts.limit ?? 100);
  return all<RequirementRow>(`SELECT * FROM requirements ${where} ORDER BY updated_at DESC LIMIT ?`, params);
}

export function createRequirement(input: Record<string, unknown> & { caseId?: string | null; requesterUserId?: string | null }): string {
  const id = String(input.id ?? newId("req"));
  const now = nowIso();
  run(
    `INSERT INTO requirements (id, case_id, external_id, source, requester_user_id, deal_type, property_type, city,
       districts, budget_min, budget_max, area_min, area_max, rooms, description, access_level, status, expires_at,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      jsonOr(input.caseId ?? input.case_id),
      jsonOr(input.external_id),
      jsonOr(input.source),
      jsonOr(input.requesterUserId ?? input.requester_user_id),
      jsonOr(input.deal_type, "rent"),
      jsonOr(input.property_type),
      jsonOr(input.city),
      jsonOr(input.districts, "[]"),
      jsonOr(input.budget_min),
      jsonOr(input.budget_max),
      jsonOr(input.area_min),
      jsonOr(input.area_max),
      jsonOr(input.rooms),
      jsonOr(input.description),
      jsonOr(input.access_level, "staff"),
      jsonOr(input.status, "open"),
      jsonOr(input.expires_at),
      now,
      now,
    ],
  );
  return id;
}

export function updateRequirement(id: string, patch: Record<string, unknown>): void {
  const allowed = [
    "case_id", "external_id", "source", "requester_user_id", "deal_type", "property_type", "city", "districts",
    "budget_min", "budget_max", "area_min", "area_max", "rooms", "description", "access_level", "status", "expires_at",
  ];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => {
    const v = patch[k];
    if (v === undefined || v === null) return null as string | number | null;
    if (typeof v === "object") return JSON.stringify(v);
    return v as string | number;
  });
  run(`UPDATE requirements SET ${sets}, updated_at = ? WHERE id = ?`, [...values, nowIso(), id]);
}

export function replaceMatches(requirementId: string, matches: Array<{ listingId: string; score: number; note?: string }>): void {
  run("DELETE FROM requirement_matches WHERE requirement_id = ?", [requirementId]);
  const now = nowIso();
  for (const m of matches) {
    run(
      `INSERT INTO requirement_matches (id, requirement_id, listing_id, score, note, at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(requirement_id, listing_id) DO UPDATE SET score = excluded.score, note = excluded.note`,
      [newId("match"), requirementId, m.listingId, m.score, m.note ?? null, now],
    );
  }
}

export function listMatches(requirementId: string): Array<{ id: string; listing_id: string; score: number; note: string | null }> {
  return all("SELECT id, listing_id, score, note FROM requirement_matches WHERE requirement_id = ? ORDER BY score DESC", [
    requirementId,
  ]);
}

/** موتور تطبیق: آگهی‌های منتشرشده را با نیازمندی امتیازدهی می‌کند */
export function computeMatches(requirement: RequirementRow, limit = 10): Array<{ listingId: string; score: number; note: string }> {
  const listings = all<ListingRow>(
    "SELECT * FROM listings WHERE status = 'published' AND deal_type = ? LIMIT 200",
    [requirement.deal_type],
  );
  const districts = jsonParse<string[]>(requirement.districts, []);
  const results: Array<{ listingId: string; score: number; note: string }> = [];
  for (const listing of listings) {
    let score = 0;
    const reasons: string[] = [];
    if (requirement.city && listing.city === requirement.city) {
      score += 0.2;
      reasons.push("شهر یکسان");
    }
    if (districts.length && listing.district && districts.includes(listing.district)) {
      score += 0.25;
      reasons.push("محله موردنظر");
    }
    if (requirement.property_type && listing.property_type === requirement.property_type) {
      score += 0.1;
      reasons.push("نوع ملک");
    }
    if (requirement.area_min !== null && listing.area !== null && listing.area >= requirement.area_min) {
      if (requirement.area_max === null || listing.area <= requirement.area_max) {
        score += 0.15;
        reasons.push("متراژ");
      }
    }
    if (requirement.rooms !== null && listing.rooms !== null && listing.rooms >= requirement.rooms) {
      score += 0.1;
      reasons.push("تعداد اتاق");
    }
    const price = requirement.deal_type === "sale" ? listing.price : listing.rent;
    if (price !== null && requirement.budget_max !== null && price <= requirement.budget_max) {
      score += 0.2;
      reasons.push("بودجه");
    } else if (price !== null && requirement.budget_min !== null && price >= requirement.budget_min) {
      score += 0.05;
    }
    if (score >= 0.45) results.push({ listingId: listing.id, score: Number(score.toFixed(2)), note: reasons.join("، ") });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

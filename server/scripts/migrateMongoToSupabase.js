/**
 * One-off migration: copies every collection out of the old MongoDB database
 * and into the new Supabase project, remapping every ObjectId reference to
 * the uuid Postgres now uses. Safe to re-run: users are matched by email and
 * skipped if already migrated; other rows are matched by `legacy_id` where
 * one exists.
 *
 * Usage:
 *   MONGO_URI=mongodb://... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node server/scripts/migrateMongoToSupabase.js
 *
 * Password caveat: Supabase Auth hashes passwords with its own scheme and
 * offers no supported way to import an existing bcrypt hash through the
 * client library, so migrated users are created with a random temporary
 * password and immediately sent a "reset your password" email (unless
 * --no-reset-email is passed) so they can set a new one on first login.
 */
import "dotenv/config";
import crypto from "node:crypto";
import { MongoClient } from "mongodb";
import { env } from "../src/config/env.js";
import { createSupabaseAuthClient, supabaseAdmin } from "../src/services/supabaseClient.js";

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("Set MONGO_URI to the source MongoDB connection string.");
  process.exit(1);
}

const sendResetEmails = !process.argv.includes("--no-reset-email");
const db = supabaseAdmin();

function oid(value) {
  return value ? String(value) : null;
}

async function migrateUsers(mongoDb) {
  const users = await mongoDb.collection("users").find({}).toArray();
  const idMap = new Map(); // Mongo ObjectId string -> Supabase uuid
  let created = 0;
  let skipped = 0;

  const { data: existingList, error: listError } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw new Error(listError.message);
  const existingByEmail = new Map((existingList?.users || []).map((u) => [u.email, u.id]));

  for (const user of users) {
    const email = String(user.email || "").trim().toLowerCase();
    if (!email) continue;

    const existingId = existingByEmail.get(email);
    if (existingId) {
      idMap.set(oid(user._id), existingId);
      skipped += 1;
      continue;
    }

    const { data, error } = await db.auth.admin.createUser({
      email,
      password: crypto.randomBytes(24).toString("base64url"),
      email_confirm: Boolean(user.isVerified),
      user_metadata: { name: user.name || "" }
    });

    if (error) {
      console.error(`user ${email}: ${error.message}`);
      continue;
    }

    idMap.set(oid(user._id), data.user.id);
    await db.from("profiles").update({
      name: user.name || "",
      role: user.role === "admin" ? "admin" : "user"
    }).eq("id", data.user.id);
    created += 1;

    if (sendResetEmails) {
      const authClient = createSupabaseAuthClient();
      await authClient.auth.resetPasswordForEmail(email, {
        redirectTo: `${env.appUrl.replace(/\/$/, "")}/reset-password`
      });
    }
  }

  return { idMap, created, skipped };
}

async function migrateSimpleCollection(mongoDb, { collection, table, mapRow, idMap, legacyIdField = "legacyId" }) {
  const docs = await mongoDb.collection(collection).find({}).toArray();
  const localIdMap = new Map();
  let inserted = 0;
  let skipped = 0;

  for (const doc of docs) {
    const legacyId = doc[legacyIdField];
    if (legacyId !== undefined && legacyId !== null) {
      const { data: existing } = await db.from(table).select("id").eq("legacy_id", legacyId).maybeSingle();
      if (existing) {
        localIdMap.set(oid(doc._id), existing.id);
        skipped += 1;
        continue;
      }
    }

    const row = mapRow(doc, idMap);
    const { data, error } = await db.from(table).insert(row).select("id").single();
    if (error) {
      console.error(`${table} ${doc._id}: ${error.message}`);
      continue;
    }
    localIdMap.set(oid(doc._id), data.id);
    inserted += 1;
  }

  return { idMap: localIdMap, inserted, skipped };
}

async function run() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const mongoDb = client.db();

  try {
    console.log("Migrating users...");
    const { idMap: userIds, created: usersCreated, skipped: usersSkipped } = await migrateUsers(mongoDb);
    console.log(`  users: ${usersCreated} created, ${usersSkipped} already present`);

    const ownerId = (doc) => (doc.user ? userIds.get(oid(doc.user)) || null : null);

    console.log("Migrating companies...");
    const companies = await migrateSimpleCollection(mongoDb, {
      collection: "companies",
      table: "companies",
      idMap: userIds,
      mapRow: (doc) => ({ legacy_id: doc.legacyId ?? null, cname: doc.cname, user_id: ownerId(doc) })
    });
    console.log(`  companies: ${companies.inserted} inserted, ${companies.skipped} already present`);

    console.log("Migrating products...");
    const products = await migrateSimpleCollection(mongoDb, {
      collection: "products",
      table: "products",
      idMap: userIds,
      mapRow: (doc) => ({
        legacy_id: doc.legacyId ?? null,
        company_id: doc.company ? companies.idMap.get(oid(doc.company)) || null : null,
        pname: doc.pname,
        ptype: doc.ptype === "Trade" ? "Trade" : "Retail",
        user_id: ownerId(doc)
      })
    });
    console.log(`  products: ${products.inserted} inserted, ${products.skipped} already present`);

    console.log("Migrating distributors...");
    const distributors = await migrateSimpleCollection(mongoDb, {
      collection: "distributors",
      table: "distributors",
      idMap: userIds,
      mapRow: (doc) => ({
        legacy_id: doc.legacyId ?? null,
        company_id: doc.company ? companies.idMap.get(oid(doc.company)) || null : null,
        did: doc.did ?? 1,
        dname: doc.dname,
        area: doc.area || "",
        subarea: doc.subarea || "",
        cell: doc.cell || "",
        status: doc.status !== false,
        user_id: ownerId(doc)
      })
    });
    console.log(`  distributors: ${distributors.inserted} inserted, ${distributors.skipped} already present`);

    console.log("Migrating product aliases...");
    const aliases = await migrateSimpleCollection(mongoDb, {
      collection: "productaliases",
      table: "product_aliases",
      idMap: userIds,
      mapRow: (doc) => ({
        legacy_id: doc.legacyId ?? null,
        product_id: products.idMap.get(oid(doc.product)) || null,
        paname: doc.paname,
        user_id: ownerId(doc)
      })
    });
    console.log(`  product_aliases: ${aliases.inserted} inserted, ${aliases.skipped} already present`);

    console.log("Migrating product schemes...");
    const schemes = await migrateSimpleCollection(mongoDb, {
      collection: "productschemes",
      table: "product_schemes",
      idMap: userIds,
      mapRow: (doc) => ({
        legacy_id: doc.legacyId ?? null,
        product_id: products.idMap.get(oid(doc.product)) || null,
        schemeid: doc.schemeid,
        basepolicy: doc.basepolicy,
        bonuspolicy: doc.bonuspolicy,
        tp: doc.tp || 0,
        user_id: ownerId(doc)
      })
    });
    console.log(`  product_schemes: ${schemes.inserted} inserted, ${schemes.skipped} already present`);

    console.log("Migrating sales (this can take a while)...");
    const sales = await migrateSimpleCollection(mongoDb, {
      collection: "sales",
      table: "sales",
      idMap: userIds,
      mapRow: (doc) => ({
        legacy_id: doc.legacyId ?? null,
        distributor_id: distributors.idMap.get(oid(doc.distributor)) || null,
        product_id: products.idMap.get(oid(doc.product)) || null,
        alias: doc.alias,
        sqty: doc.sqty, sbonus: doc.sbonus, sprice: doc.sprice, salvalue: doc.salvalue,
        clqty: doc.clqty, clbonus: doc.clbonus, clvalue: doc.clvalue,
        pbase: doc.pbase, pbonus: doc.pbonus, tprice: doc.tprice,
        seg_base: doc.seg_base, seg_bonus: doc.seg_bonus, seg_bsunit: doc.seg_bsunit, seg_bnunit: doc.seg_bnunit,
        seg_slbase: doc.seg_slbase, seg_slbonus: doc.seg_slbonus, seg_slbsunit: doc.seg_slbsunit, seg_slbnunit: doc.seg_slbnunit,
        month: doc.month, year: doc.year, date: doc.date,
        user_id: ownerId(doc)
      })
    });
    console.log(`  sales: ${sales.inserted} inserted, ${sales.skipped} already present`);

    console.log("Migrating services...");
    const services = await migrateSimpleCollection(mongoDb, {
      collection: "services",
      table: "services",
      idMap: userIds,
      legacyIdField: "__none__",
      mapRow: (doc) => ({
        name: doc.name, category: doc.category || "Other", description: doc.description || "",
        price: doc.price || 0, status: doc.status !== false, user_id: ownerId(doc)
      })
    });
    console.log(`  services: ${services.inserted} inserted`);

    console.log("Migrating upload logs and audit logs (best-effort, no id remapping needed)...");
    const uploadLogs = await mongoDb.collection("uploadlogs").find({}).toArray();
    if (uploadLogs.length) {
      const { error } = await db.from("upload_logs").insert(uploadLogs.map((doc) => ({
        kind: doc.kind, filename: doc.filename || "", status: doc.status || "processed",
        row_count: doc.rowCount || 0, created: doc.created || 0, skipped: doc.skipped || 0,
        inserted: doc.inserted || 0, missing_count: doc.missingCount || 0,
        session_key: doc.sessionKey || "default", user_id: ownerId(doc), created_at: doc.createdAt
      })));
      if (error) console.error(`upload_logs: ${error.message}`);
    }

    const auditLogs = await mongoDb.collection("auditlogs").find({}).toArray();
    if (auditLogs.length) {
      const { error } = await db.from("audit_logs").insert(auditLogs.map((doc) => ({
        user_id: doc.user ? (userIds.get(oid(doc.user)) || String(doc.user)) : "",
        action: doc.action, resource: doc.resource, resource_id: doc.resourceId || "",
        metadata: doc.metadata || {}, ip_address: doc.ipAddress || "", user_agent: doc.userAgent || "",
        status: doc.status || "success", created_at: doc.createdAt
      })));
      if (error) console.error(`audit_logs: ${error.message}`);
    }
    console.log(`  upload_logs: ${uploadLogs.length}, audit_logs: ${auditLogs.length}`);

    console.log("\nDone. Migrated users were created with a random password" + (sendResetEmails ? " and sent a reset-password email." : " -- run with reset emails enabled or use the admin panel to set new passwords."));
  } finally {
    await client.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

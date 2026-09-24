import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { supabaseAdmin, supabaseConfigured } from "../services/supabaseClient.js";
import { SupabaseStore } from "../store/supabaseStore.js";
import { buildUserFilter, verifyOwnership, isAdmin } from "../utils/ownership.js";

// Integration test: needs a real (or local `supabase start`) Supabase
// project reachable via SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY. Skipped
// otherwise so the default unit-test run does not require live credentials.
const describeLive = supabaseConfigured() ? describe : describe.skip;

async function createTestUser(name, emailPrefix) {
  const db = supabaseAdmin();
  const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
  const { data, error } = await db.auth.admin.createUser({
    email, password: "password123!", email_confirm: true, user_metadata: { name }
  });
  if (error) throw new Error(error.message);
  await db.from("profiles").update({ name }).eq("id", data.user.id);
  return { _id: data.user.id, id: data.user.id, role: "user", email };
}

async function deleteTestUser(id) {
  await supabaseAdmin().auth.admin.deleteUser(id).catch(() => {});
}

describeLive("Multi-Tenancy Validation", () => {
  const store = new SupabaseStore();
  const db = supabaseAdmin();
  let userA, userB, admin;
  let userACompany, userADistributor, userAProduct, userAAlias, userAScheme, userASale;
  let userBCompany, userBProduct;

  before(async () => {
    userA = await createTestUser("User A", "usera");
    userB = await createTestUser("User B", "userb");
    admin = { _id: "admin", role: "admin" };

    // User A creates resources
    userACompany = await store.createCompany(userA, { cname: "User A Company" });
    userADistributor = await store.createDistributor(userA, {
      companyId: userACompany.id, dname: "User A Distributor", area: "Area A"
    });
    userAProduct = await store.createProduct(userA, {
      companyId: userACompany.id, pname: "User A Product", ptype: "Retail"
    });
    userAAlias = await store.createAlias(userA, { productId: userAProduct.id, paname: "User A Alias" });
    userAScheme = await store.createScheme(userA, {
      productId: userAProduct.id, schemeid: 1, basepolicy: 100, bonuspolicy: 10, tp: 150
    });
    userASale = await store.createSale(userA, {
      distributorId: userADistributor.id, productId: userAProduct.id, alias: userAAlias.paname,
      sqty: 10, sbonus: 1, sprice: 150, salvalue: 1500, clqty: 5, clbonus: 0, clvalue: 750,
      pbase: 100, pbonus: 10, tprice: 150, month: "jan", year: 2025
    });

    // User B creates resources
    userBCompany = await store.createCompany(userB, { cname: "User B Company" });
    userBProduct = await store.createProduct(userB, {
      companyId: userBCompany.id, pname: "User B Product", ptype: "Trade"
    });
  });

  after(async () => {
    await deleteTestUser(userA._id);
    await deleteTestUser(userB._id);
  });

  describe("Multi-Tenancy: User Isolation", () => {
    it("User A should see only their own companies", async () => {
      const userACompanies = await store.listCompanies(userA);
      const userBCompanies = await store.listCompanies(userB);

      assert.equal(userACompanies.length, 1, "User A should have 1 company");
      assert.equal(userBCompanies.length, 1, "User B should have 1 company");
      assert.equal(userACompanies[0].cname, "User A Company");
      assert.equal(userBCompanies[0].cname, "User B Company");
    });

    it("User A should NOT see User B's companies", async () => {
      const userACompanies = await store.listCompanies(userA);
      const userBCompanyNames = userACompanies.map(c => c.cname);
      assert.ok(!userBCompanyNames.includes("User B Company"), "User A should not see User B's company");
    });

    it("User A should see only their own products", async () => {
      const userAProducts = await store.listProducts(userA);
      const userBProducts = await store.listProducts(userB);
      assert.equal(userAProducts.length, 1, "User A should have 1 product");
      assert.equal(userBProducts.length, 1, "User B should have 1 product");
    });

    it("User A should NOT see User B's products", async () => {
      const userAProducts = await store.listProducts(userA);
      const productNames = userAProducts.map(p => p.pname);
      assert.ok(!productNames.includes("User B Product"), "User A should not see User B's product");
    });

    it("User A should see only their own sales", async () => {
      const userASales = await store.listSales(userA);
      const userBSales = await store.listSales(userB);
      assert.equal(userASales.length, 1, "User A should have 1 sale");
      assert.equal(userBSales.length, 0, "User B should have 0 sales");
    });

    it("User A should NOT access User B's product directly", async () => {
      const result = await store.getProduct(userA, userBProduct.id);
      assert.ok(result === null, "User A should not be able to access User B's product");
    });

    it("User A should access their own distributor", async () => {
      const result = await store.getDistributor(userA, userADistributor.id);
      assert.ok(result !== null, "User A should access their own distributor");
    });
  });

  describe("Multi-Tenancy: Admin Access", () => {
    it("Admin should see all companies", async () => {
      const allCompanies = await store.listCompanies(admin);
      assert.ok(allCompanies.length >= 2, "Admin should see at least 2 companies");
    });

    it("Admin should see all products", async () => {
      const allProducts = await store.listProducts(admin);
      assert.ok(allProducts.length >= 2, "Admin should see at least 2 products");
    });

    it("Admin should see all sales", async () => {
      const allSales = await store.listSales(admin);
      assert.ok(allSales.length >= 1, "Admin should see at least 1 sale");
    });

    it("Admin should access User A's product", async () => {
      const result = await store.getProduct(admin, userAProduct.id);
      assert.ok(result !== null, "Admin should access User A's product");
      assert.equal(result.pname, "User A Product");
    });

    it("Admin should access User B's product", async () => {
      const result = await store.getProduct(admin, userBProduct.id);
      assert.ok(result !== null, "Admin should access User B's product");
      assert.equal(result.pname, "User B Product");
    });
  });

  describe("Multi-Tenancy: CRUD Operations", () => {
    it("User A should create a new service", async () => {
      const service = await store.createService(userA, { name: "User A Service", category: "Testing", price: 100 });
      assert.ok(service !== null, "Service should be created");
      assert.equal(service.name, "User A Service");
    });

    it("User B should NOT see User A's service", async () => {
      const userBServices = await store.listServices(userB);
      const serviceNames = userBServices.map(s => s.name);
      assert.ok(!serviceNames.includes("User A Service"), "User B should not see User A's service");
    });

    it("Admin should see User A's service", async () => {
      const adminServices = await store.listServices(admin);
      const serviceNames = adminServices.map(s => s.name);
      assert.ok(serviceNames.includes("User A Service"), "Admin should see User A's service");
    });

    it("User A should create and update their own scheme", async () => {
      const updatedScheme = await store.createScheme(userA, {
        productId: userAProduct.id, schemeid: 2, basepolicy: 200, bonuspolicy: 20, tp: 200
      });
      assert.ok(updatedScheme !== null, "Scheme should be created");
      assert.equal(updatedScheme.schemeid, 2);
    });

    it("User B should NOT see User A's schemes", async () => {
      const userBSchemes = await store.listSchemes(userB);
      const schemeIds = userBSchemes.map(s => s.schemeid);
      assert.ok(!schemeIds.includes(1), "User B should not see User A's schemes");
    });

    it("User A should delete their own scheme", async () => {
      const schemes = await store.listSchemes(userA);
      const schemeToDelete = schemes[0];

      const deleted = await store.deleteScheme(userA, schemeToDelete.id);
      assert.ok(deleted, "User A should be able to delete their own scheme");

      const remainingSchemes = await store.listSchemes(userA);
      assert.equal(remainingSchemes.length, 1, "Should have 1 scheme remaining");
    });

    it("User B should NOT delete User A's scheme", async () => {
      const userASchemes = await store.listSchemes(userA);
      const schemeToDelete = userASchemes[0];

      const deleted = await store.deleteScheme(userB, schemeToDelete.id);
      assert.ok(!deleted, "User B should not be able to delete User A's scheme");
    });
  });

  describe("Multi-Tenancy: Ownership Helpers", () => {
    it("isAdmin() should correctly identify admin", () => {
      assert.ok(isAdmin(admin), "Should identify admin");
      assert.ok(!isAdmin(userA), "Should not identify regular user as admin");
      assert.ok(!isAdmin(null), "Should handle null user");
    });

    it("buildUserFilter() should return correct filters", () => {
      const adminFilter = buildUserFilter(admin);
      const userFilter = buildUserFilter(userA);

      assert.deepEqual(adminFilter, {}, "Admin filter should be empty");
      assert.deepEqual(userFilter, { user_id: userA._id }, "User filter should contain user ID");
    });

    it("verifyOwnership() should correctly validate ownership", () => {
      assert.ok(verifyOwnership(admin, { user_id: userA._id }), "Admin should own everything");
      assert.ok(verifyOwnership(userA, { user_id: userA._id }), "User should own their resources");
      assert.ok(!verifyOwnership(userA, { user_id: userB._id }), "User should not own others' resources");
      assert.ok(!verifyOwnership(userA, null), "Should handle null resource");
      assert.ok(!verifyOwnership(userA, {}), "Should handle resource without user");
    });
  });

  describe("Multi-Tenancy: Database Validation", () => {
    it("All companies should have a user_id", async () => {
      const { data } = await db.from("companies").select("*");
      assert.equal(data.filter(c => !c.user_id).length, 0, "All companies should have user_id");
    });

    it("All products should have a user_id", async () => {
      const { data } = await db.from("products").select("*");
      assert.equal(data.filter(p => !p.user_id).length, 0, "All products should have user_id");
    });

    it("All sales should have a user_id", async () => {
      const { data } = await db.from("sales").select("*");
      assert.equal(data.filter(s => !s.user_id).length, 0, "All sales should have user_id");
    });

    it("User A's resources should reference User A", async () => {
      const [{ data: companies }, { data: products }, { data: sales }] = await Promise.all([
        db.from("companies").select("*").eq("user_id", userA._id),
        db.from("products").select("*").eq("user_id", userA._id),
        db.from("sales").select("*").eq("user_id", userA._id)
      ]);
      assert.ok(companies.length > 0, "User A should have companies");
      assert.ok(products.length > 0, "User A should have products");
      assert.ok(sales.length > 0, "User A should have sales");
    });

    it("User B's resources should reference User B", async () => {
      const [{ data: companies }, { data: products }] = await Promise.all([
        db.from("companies").select("*").eq("user_id", userB._id),
        db.from("products").select("*").eq("user_id", userB._id)
      ]);
      assert.ok(companies.length > 0, "User B should have companies");
      assert.ok(products.length > 0, "User B should have products");
    });
  });

  describe("Multi-Tenancy: Security Validation", () => {
    it("Creating a product as User A does not modify User B's product", async () => {
      const result = await store.createProduct(userA, { companyId: userACompany.id, pname: "Hacked Product", ptype: "Retail" });
      assert.equal(result.pname, "Hacked Product", "Should create new product for User A");

      const updatedUserBProducts = await store.listProducts(userB);
      const userBProductNames = updatedUserBProducts.map(p => p.pname);
      assert.ok(!userBProductNames.includes("Hacked Product"), "User B's products should not be modified");
    });

    it("User A should NOT access User B's private data via ID manipulation", async () => {
      const result = await store.listDistributors(userA, { companyId: userBCompany.id });
      assert.equal(result.length, 0, "User A should not see User B's distributors");
    });

    it("User A should see only their own alias", async () => {
      const userAAliases = await store.listAliases(userA);
      const aliasNames = userAAliases.map(a => a.paname);
      assert.ok(aliasNames.includes("User A Alias"), "User A should see their own alias");
      assert.equal(userAAliases.length, 1, "User A should have exactly 1 alias");
    });

    it("User A should NOT see User B's schemes", async () => {
      const userASchemes = await store.listSchemes(userA);
      const userBSchemes = await store.listSchemes(userB);
      assert.ok(userASchemes.length >= 1, "User A should have at least 1 scheme");
      assert.equal(userBSchemes.length, 0, "User B should have 0 schemes");
    });

    it("Admin should bypass all restrictions", async () => {
      const adminCompanies = await store.listCompanies(admin);
      const adminProducts = await store.listProducts(admin);
      const adminSales = await store.listSales(admin);
      assert.ok(adminCompanies.length >= 2, "Admin should see all companies");
      assert.ok(adminProducts.length >= 2, "Admin should see all products");
      assert.ok(adminSales.length >= 1, "Admin should see all sales");
    });
  });

  describe("Multi-Tenancy: Summary Operations", () => {
    it("User A should see their own sales summary", async () => {
      const summary = await store.monthlySummary(userA, { month: "jan", year: 2025 });
      assert.ok(summary !== null, "Summary should be generated");
    });

    it("Admin should see all sales summaries", async () => {
      const summary = await store.monthlySummary(admin, { month: "jan", year: 2025 });
      assert.ok(summary !== null, "Admin should see sales summary");
    });

    // Asserting only Array.isArray() let a real defect through: the aggregation
    // used to $match on `user` after a $group that had already dropped the
    // field, so every non-admin got an empty list and the period picker was
    // blank for them. An empty array satisfied the old assertion.
    it("User A should see only their own sales periods", async () => {
      const periods = await store.summaryPeriods(userA);
      assert.deepEqual(
        periods.map((period) => ({ month: period.month, year: period.year, count: period.count })),
        [{ month: "jan", year: 2025, count: 1 }],
        "User A should see the period their own sale falls in"
      );
    });

    it("User B should see no sales periods of their own", async () => {
      assert.deepEqual(await store.summaryPeriods(userB), [], "User B has no sales, so no periods");
    });

    it("User A should see their own latest sales period", async () => {
      assert.deepEqual(await store.latestSalesPeriod(userA), { month: "jan", year: 2025 });
      assert.equal(await store.latestSalesPeriod(userB), null, "User B has no sales");
    });

    it("Admin should see all sales periods", async () => {
      const periods = await store.summaryPeriods(admin);
      assert.ok(
        periods.some((period) => period.month === "jan" && period.year === 2025),
        "Admin should see User A's period"
      );
    });
  });

  describe("Multi-Tenancy: File Activity", () => {
    it("User A should see only their own file activity", async () => {
      await store.recordFileActivity(userA, {
        kind: "test", filename: "test.xlsx", status: "processed",
        rowCount: 10, created: 10, skipped: 0, inserted: 10, missingCount: 0, sessionKey: "test-session"
      });

      const userAActivity = await store.listFileActivity(userA);
      const userBActivity = await store.listFileActivity(userB);
      assert.ok(userAActivity.length > 0, "User A should have file activity");
      assert.equal(userBActivity.length, 0, "User B should not see User A's activity");
    });

    it("Admin should see all file activity", async () => {
      const adminActivity = await store.listFileActivity(admin);
      assert.ok(adminActivity.length > 0, "Admin should see all file activity");
    });
  });

  describe("Multi-Tenancy: Missing Aliases", () => {
    it("User A should see only their own missing aliases", async () => {
      await store.recordMissingAliases(userA, "session-a", ["Product X", "Product Y"]);
      const userAMissing = await store.listMissingAliases(userA, { sessionKey: "session-a" });
      const userBMissing = await store.listMissingAliases(userB, { sessionKey: "session-a" });
      assert.ok(userAMissing.length > 0, "User A should see their missing aliases");
      assert.equal(userBMissing.length, 0, "User B should not see User A's missing aliases");
    });

    it("Admin should see all missing aliases", async () => {
      const adminMissing = await store.listMissingAliases(admin, { sessionKey: "session-a" });
      assert.ok(adminMissing.length > 0, "Admin should see all missing aliases");
    });

    it("User A should resolve their own missing aliases", async () => {
      await store.resolveMissingAlias(userA, "session-a", "Product X");
      const remaining = await store.listMissingAliases(userA, { sessionKey: "session-a" });
      assert.ok(!remaining.map(r => r.product).includes("Product X"), "Product X should be resolved");
    });
  });

  describe("Multi-Tenancy: Statistics", () => {
    it("User A and User B should see only their own statistics", async () => {
      const userAStats = await store.stats(userA);
      const userBStats = await store.stats(userB);
      assert.ok(userAStats.companies >= 1, "User A should have companies");
      assert.ok(userBStats.companies >= 1, "User B should have companies");
    });

    it("Admin should see global statistics", async () => {
      const adminStats = await store.stats(admin);
      assert.ok(adminStats.companies >= 2, "Admin should see all companies");
      assert.ok(adminStats.products >= 2, "Admin should see all products");
      assert.ok(adminStats.sales >= 1, "Admin should see all sales");
    });
  });

  describe("Multi-Tenancy: Edge Cases", () => {
    it("Should handle a user without a role property", async () => {
      const userWithoutRole = { _id: userA._id };
      const filter = buildUserFilter(userWithoutRole);
      assert.deepEqual(filter, { user_id: userA._id }, "Should treat as regular user");
    });

    it("Should prevent IDOR attacks", async () => {
      const result = await store.getProduct(userA, userBProduct.id);
      assert.ok(result === null, "Should return null for unauthorized access");
    });

    it("Should validate ownership on getDistributor", async () => {
      const userBDistributors = await store.listDistributors(userB);
      if (userBDistributors.length > 0) {
        const result = await store.getDistributor(userA, userBDistributors[0].id);
        assert.ok(result === null, "User A should not access User B's distributor");
      }
    });
  });

  // Runs last: these assert on cross-tenant side effects, so they must not
  // disturb the counts the earlier blocks check.
  describe("Multi-Tenancy: Destructive Operations", () => {
    it("An alias name used by one tenant does not block another", async () => {
      assert.equal(await store.aliasExists(userA, userAAlias.paname), true, "User A should see their own alias");
      assert.equal(
        await store.aliasExists(userB, userAAlias.paname),
        false,
        "An unscoped existence check leaks that another tenant holds this name"
      );
    });

    it("An admin scheme import must not delete other tenants' schemes", async () => {
      const { count: before } = await db.from("product_schemes").select("id", { count: "exact", head: true }).eq("user_id", userA._id);
      assert.ok(before > 0, "User A should start with at least one scheme");

      // buildUserFilter() returns {} for an admin, and replace_schemes() deletes
      // by exact user_id, so an admin import must only ever clear its own rows.
      await store.replaceSchemes(admin, []);

      const { count: after } = await db.from("product_schemes").select("id", { count: "exact", head: true }).eq("user_id", userA._id);
      assert.equal(after, before, "An admin import wiped User A's schemes");
    });
  });
});

describeLive("Performance Validation", () => {
  const store = new SupabaseStore();
  const db = supabaseAdmin();
  let perfUser, perfCompany, perfDistributor, perfProduct;

  // Scaled down from the MongoDB version: this now runs over the network
  // against Postgres/PostgREST rather than a local Mongo instance, so the
  // volumes and timing budgets are chosen to still exercise the user_id
  // indexes without turning every CI run into a multi-minute network job.
  const COMPANIES = 200;
  const PRODUCTS = 1000;
  const SALES = 5000;

  before(async () => {
    perfUser = await createTestUser("Performance User", "perf");

    perfCompany = await store.createCompany(perfUser, { cname: "Perf Company" });
    perfDistributor = await store.createDistributor(perfUser, { dname: "Perf Distributor" });
    perfProduct = await store.createProduct(perfUser, { pname: "Perf Product" });

    async function insertChunked(table, rows, size = 500) {
      for (let i = 0; i < rows.length; i += size) {
        const { error } = await db.from(table).insert(rows.slice(i, i + size));
        if (error) throw new Error(`${table}: ${error.message}`);
      }
    }

    await insertChunked("companies", Array.from({ length: COMPANIES }, (_, i) => ({
      user_id: perfUser._id, cname: `Company ${i}`
    })));

    await insertChunked("products", Array.from({ length: PRODUCTS }, (_, i) => ({
      user_id: perfUser._id, pname: `Product ${i}`, ptype: i % 2 === 0 ? "Retail" : "Trade"
    })));

    await insertChunked("sales", Array.from({ length: SALES }, (_, i) => ({
      user_id: perfUser._id,
      distributor_id: perfDistributor.id,
      product_id: perfProduct.id,
      alias: `Alias ${i}`,
      sqty: Math.floor(Math.random() * 100),
      sbonus: Math.floor(Math.random() * 10),
      sprice: Math.floor(Math.random() * 1000),
      salvalue: Math.floor(Math.random() * 10000),
      month: ["jan", "feb", "mar", "apr", "may", "jun"][i % 6],
      year: 2025
    })));
  });

  after(async () => {
    await deleteTestUser(perfUser._id);
  });

  it(`Should query ${COMPANIES} companies efficiently`, async () => {
    const start = Date.now();
    const companies = await store.listCompanies(perfUser);
    const duration = Date.now() - start;
    assert.ok(companies.length >= COMPANIES, "Should return all companies");
    assert.ok(duration < 5000, `Query should complete in < 5000ms (took ${duration}ms)`);
  });

  it(`Should query ${PRODUCTS} products efficiently`, async () => {
    const start = Date.now();
    const products = await store.listProducts(perfUser, { limit: PRODUCTS });
    const duration = Date.now() - start;
    assert.ok(products.length >= PRODUCTS, `Should return all products (got ${products.length})`);
    assert.ok(duration < 8000, `Query should complete in < 8000ms (took ${duration}ms)`);
  });

  it(`Should query ${SALES} sales efficiently`, async () => {
    const start = Date.now();
    const sales = await store.listSales(perfUser, { limit: SALES });
    const duration = Date.now() - start;
    assert.ok(sales.length >= SALES, `Should return all sales (got ${sales.length})`);
    assert.ok(duration < 15000, `Query should complete in < 15000ms (took ${duration}ms)`);
  });

  it("Should use indexes for user + month filtering", async () => {
    const start = Date.now();
    const sales = await store.listSales(perfUser, { month: "jan" });
    const duration = Date.now() - start;
    assert.ok(sales.length > 0, "Should return filtered sales");
    assert.ok(duration < 3000, `Indexed query should complete in < 3000ms (took ${duration}ms)`);
  });

  it("Should handle a statistics query efficiently", async () => {
    const start = Date.now();
    const stats = await store.stats(perfUser);
    const duration = Date.now() - start;
    assert.ok(stats.companies >= COMPANIES, "Stats should count all companies");
    assert.ok(duration < 5000, `Stats query should complete in < 5000ms (took ${duration}ms)`);
  });
});

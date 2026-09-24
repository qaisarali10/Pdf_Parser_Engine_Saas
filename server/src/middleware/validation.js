import { z } from "zod";

// Mirrors the Product.ptype enum. Multipart bodies arrive as strings, so this
// is the one place that decides which values the store is allowed to see.
const productType = z.enum(["Retail", "Trade"]);

export const schemas = {
  register: z.object({
    name: z.string().min(1, "Name is required").max(100),
    email: z.string().email("Invalid email address").max(100),
    password: z.string().min(6, "Password must be at least 6 characters").max(128)
  }),
  
  login: z.object({
    username: z.string().min(1, "Username is required"),
    password: z.string().min(1, "Password is required")
  }),

  // Administrator recovery: proves possession of ADMIN_RECOVERY_CODE.
  resetPassword: z.object({
    username: z.string().min(1, "Username is required"),
    recoveryCode: z.string().min(1, "Recovery code is required"),
    newPassword: z.string().min(12, "New password must be at least 12 characters").max(128)
  }),

  // Self-service reset for registered users: request a link, then consume it.
  forgotPassword: z.object({
    email: z.string().email("Invalid email address").max(100)
  }),

  // `tokenHash` is Supabase's `token_hash` query param from the recovery link.
  resetPasswordWithToken: z.object({
    tokenHash: z.string().min(10, "Invalid reset token").max(400),
    newPassword: z.string().min(8, "New password must be at least 8 characters").max(128)
  }),

  // `tokenHash` is Supabase's `token_hash` query param from the confirmation link.
  confirmEmail: z.object({
    tokenHash: z.string().min(10, "Invalid confirmation token").max(400)
  }),

  // Handed over by the client after an OAuth (Google, ...) redirect: the
  // session Supabase already issued, to be adopted into our own cookies.
  oauthSession: z.object({
    accessToken: z.string().min(10, "Invalid access token").max(4000),
    refreshToken: z.string().min(10, "Invalid refresh token").max(4000),
    expiresIn: z.coerce.number().int().min(1).max(86400).optional()
  }),

  // Administrator-set password, for someone who cannot receive mail.
  adminSetPassword: z.object({
    newPassword: z.string().min(8, "New password must be at least 8 characters").max(128)
  }),

  createCompany: z.object({
    cname: z.string().min(1, "Company name is required").max(200)
  }),

  // Every field the Network form submits has to be declared here. z.object()
  // strips keys it does not know about, so an omission does not fail loudly:
  // it silently discards what the user typed and saves a half-empty record.
  createDistributor: z.object({
    dname: z.string().min(1, "Distributor name is required").max(200),
    companyId: z.string().optional(),
    did: z.coerce.number().int().min(0).max(1_000_000).optional(),
    area: z.string().max(80).optional(),
    subarea: z.string().max(80).optional(),
    cell: z.string().max(40).optional(),
    status: z.boolean().optional()
  }),

  createProduct: z.object({
    pname: z.string().min(1, "Product name is required").max(200),
    companyId: z.string().optional(),
    ptype: productType.optional()
  }),

  createAlias: z.object({
    productId: z.string().min(1, "Product ID is required"),
    paname: z.string().min(1, "Alias name is required").max(200)
  }),

  createService: z.object({
    name: z.string().min(1, "Service name is required").max(200),
    category: z.string().max(80).optional(),
    description: z.string().max(500).optional(),
    price: z.coerce.number().min(0).optional(),
    status: z.boolean().optional()
  }),

  importCompanyProducts: z.object({
    companyId: z.string().min(1, "Company ID is required"),
    ptype: productType.optional()
  }),

  importProductAliases: z.object({
    productId: z.string().min(1, "Product ID is required")
  }),

  ssrUpload: z.object({
    distributorId: z.string().min(1, "Distributor ID is required"),
    month: z.string().optional(),
    year: z.coerce.number().int().min(2000).max(2100)
  }),

  createMissingAlias: z.object({
    productId: z.string().min(1, "Product ID is required"),
    missing: z.string().min(1, "Alias name is required").max(200)
  }),

  updateProfile: z.object({
    name: z.string().min(1, "Name is required").max(100),
    email: z.string().email("Invalid email address").max(100)
  }),

  changePassword: z.object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(6, "New password must be at least 6 characters").max(128)
  })
};

export function validate(schema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.issues || error.errors || [];
        return res.status(400).json({
          message: errors[0]?.message || "Validation failed",
          errors
        });
      }
      next(error);
    }
  };
}

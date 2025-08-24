// payments.no-trial.server.js
// Standalone server to create Stripe subscriptions WITHOUT any trial.
// Keeps your existing server.js unchanged.

import express from "express";
import cors from "cors";
import Stripe from "stripe";

const {
  STRIPE_SECRET,
  PORT = 4243,
  CORS_ORIGIN = "*" // set to your domain in production
} = process.env;

if (!STRIPE_SECRET) {
  console.error("❌ Missing STRIPE_SECRET in env.");
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET, { apiVersion: "2024-06-20" });
const app = express();

app.use(cors({
  origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN,
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());
app.options("*", cors());

app.get("/health", (_req, res) => res.json({ ok: true }));

/**
 * POST /api/stripe/subscribe
 * Body: { priceId, paymentMethodId, email }
 * Returns: { clientSecret, subscriptionId, status }
 *
 * Notes:
 *  - No trial is applied here.
 *  - We attach the PaymentMethod to a new customer and set it as default.
 *  - Subscription is created with `default_incomplete` so we can confirm on-page.
 */
app.post("/api/stripe/subscribe", async (req, res) => {
  try {
    const { priceId, paymentMethodId, email } = req.body || {};
    if (!priceId) return res.status(400).json({ error: "Missing priceId" });
    if (!paymentMethodId) return res.status(400).json({ error: "Missing paymentMethodId" });

    // 1) Create a customer (simple create; dedup/search optional)
    const customer = await stripe.customers.create({
      email: email || undefined
    });

    // 2) Attach PM and set default
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customer.id });
    await stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: paymentMethodId }
    });

    // 3) Create subscription WITHOUT trial
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      expand: ["latest_invoice.payment_intent"] // immediate PaymentIntent expected
    });

    const latest = subscription.latest_invoice;
    let clientSecret = null;
    if (latest && latest.payment_intent && typeof latest.payment_intent !== "string") {
      clientSecret = latest.payment_intent.client_secret;
    }

    if (!clientSecret) {
      return res.status(400).json({
        error: "Subscription created but no PaymentIntent client_secret was returned."
      });
    }

    res.json({
      clientSecret,
      subscriptionId: subscription.id,
      status: subscription.status
    });
  } catch (err) {
    console.error("Subscribe error:", err);
    res.status(400).json({ error: err.message || "Unknown error" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 No-trial Stripe server running on http://localhost:${PORT}`);
});

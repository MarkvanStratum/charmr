// subscriptions.js
import Stripe from "stripe";
import pkg from "pg";

const { Pool } = pkg;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

/* -------------------------------------------------------------------------
   PLAN & ENTITLEMENTS
---------------------------------------------------------------------------*/

// Map your Stripe price IDs here (fill in your real price ids)
export const PRICE_IDS = {
  PLUS_5_GBP_MONTH: process.env.PRICE_5_GBP_MONTH,       // £5/mo (gifts + images)
  PRO_20_GBP_MONTH: process.env.PRICE_20_GBP_MONTH,      // £20/mo (+ contact sharing)
  ULTRA_99_GBP_6MO: process.env.PRICE_99_GBP_6MO,        // £99/6mo (everything unlimited)
};

// Normalize to a "tier" string you can use everywhere in code.
export function tierFromStripePriceId(priceId) {
  switch (priceId) {
    case PRICE_IDS.PLUS_5_GBP_MONTH: return "plus";
    case PRICE_IDS.PRO_20_GBP_MONTH: return "pro";
    case PRICE_IDS.ULTRA_99_GBP_6MO: return "ultra";
    default: return "free";
  }
}

// One place that defines what each tier can do.
export function computeEntitlements({ tier = "free", status = "inactive", trialEnd = null, now = new Date() }) {
  const onTrial = trialEnd && new Date(trialEnd) > now;
  const isActive = status === "active" || status === "trialing" || onTrial;

  const base = {
    tier,
    status: isActive ? (onTrial ? "trialing" : "active") : "inactive",
    canSendGifts: false,
    canSendImages: false,
    // IMPORTANT: avoid Infinity because JSON → null; use a big finite number instead
    maxReceivedImagesUnblurred: 2, // non-paying: only first 2 visible
    canShareContacts: false,
  };

  if (!isActive) return base;

  if (tier === "plus") {
    return {
      ...base,
      canSendGifts: true,
      canSendImages: true,
      maxReceivedImagesUnblurred: 9999,
    };
  }
  if (tier === "pro") {
    return {
      ...base,
      canSendGifts: true,
      canSendImages: true,
      maxReceivedImagesUnblurred: 9999,
      canShareContacts: true,
    };
  }
  if (tier === "ultra") {
    return {
      ...base,
      canSendGifts: true,
      canSendImages: true,
      maxReceivedImagesUnblurred: 9999,
      canShareContacts: true,
    };
  }
  return base;
}

/* -------------------------------------------------------------------------
   DB
---------------------------------------------------------------------------*/

export async function ensureSubscriptionTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      tier TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'inactive',   -- 'active' | 'trialing' | 'past_due' | 'canceled' | 'inactive'
      current_period_end TIMESTAMP,
      trial_end TIMESTAMP,
      cancel_at_period_end BOOLEAN DEFAULT false,
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_unique
    ON subscriptions(user_id);
  `);
}

// Create/Update the row for a user.
export async function upsertSubscription(pool, { userId, stripeCustomerId, stripeSubscription, fallbackTier = "free" }) {
  // Derive fields from stripeSubscription if provided
  let tier = fallbackTier;
  let status = "inactive";
  let trial_end = null;
  let current_period_end = null;
  let cancel_at_period_end = false;
  let stripe_subscription_id = null;

  if (stripeSubscription) {
    const item = stripeSubscription.items?.data?.[0];
    const priceId = item?.price?.id;
    tier = tierFromStripePriceId(priceId);
    cancel_at_period_end = !!stripeSubscription.cancel_at_period_end;
    stripe_subscription_id = stripeSubscription.id;

    // Stripe statuses: trialing, active, past_due, canceled, unpaid, incomplete, incomplete_expired
    const s = stripeSubscription.status;
    if (s === "trialing") status = "trialing";
    else if (s === "active") status = "active";
    else if (s === "past_due") status = "past_due";
    else if (s === "canceled" || s === "unpaid" || s === "incomplete_expired") status = "canceled";
    else status = "inactive";

    if (stripeSubscription.trial_end) trial_end = new Date(stripeSubscription.trial_end * 1000);
    if (stripeSubscription.current_period_end) current_period_end = new Date(stripeSubscription.current_period_end * 1000);
  }

  await pool.query(
    `
    INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, tier, status, current_period_end, trial_end, cancel_at_period_end, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      stripe_customer_id = EXCLUDED.stripe_customer_id,
      stripe_subscription_id = EXCLUDED.stripe_subscription_id,
      tier = EXCLUDED.tier,
      status = EXCLUDED.status,
      current_period_end = EXCLUDED.current_period_end,
      trial_end = EXCLUDED.trial_end,
      cancel_at_period_end = EXCLUDED.cancel_at_period_end,
      updated_at = NOW();
  `,
    [userId, stripeCustomerId || null, stripe_subscription_id, tier, status, current_period_end, trial_end, cancel_at_period_end]
  );
}

export async function getUserSubscription(pool, userId) {
  const { rows } = await pool.query(`SELECT * FROM subscriptions WHERE user_id=$1`, [userId]);
  return rows[0] || null;
}

// Convenience to compute entitlements from DB row
export function entitlementsFromRow(row) {
  if (!row) return computeEntitlements({ tier: "free", status: "inactive" });
  return computeEntitlements({
    tier: row.tier,
    status: row.status,
    trialEnd: row.trial_end,
    now: new Date(),
  });
}

/* -------------------------------------------------------------------------
   Middleware
---------------------------------------------------------------------------*/

// Put this in front of routes like "send photo", "send gift", "share contact"
export function requireEntitlement(pool, capability) {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id; // assumes auth middleware sets req.user
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const sub = await getUserSubscription(pool, userId);
      const rights = entitlementsFromRow(sub);

      const gate = {
        send_gift: rights.canSendGifts,
        send_image: rights.canSendImages,
        share_contact: rights.canShareContacts,
      }[capability];

      if (!gate) {
        return res.status(402).json({
          // 402 Payment Required (semantically nice here)
          error: "Feature requires a higher plan",
          entitlements: rights,
        });
      }

      next();
    } catch (e) {
      console.error("Entitlement check failed:", e);
      res.status(500).json({ error: "Server error" });
    }
  };
}

/* -------------------------------------------------------------------------
   Stripe Webhook handler
---------------------------------------------------------------------------*/

export function stripeWebhookHandler(pool) {
  return async (req, res) => {
    let event;
    try {
      const sig = req.headers["stripe-signature"];
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          // Recommended: attach session metadata: { userId }
          const session = event.data.object;
          const customerId = session.customer;
          const subscriptionId = session.subscription;

          if (subscriptionId) {
            const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
            const userId = Number(session.metadata?.userId) || Number(stripeSub?.metadata?.userId);

            if (userId) {
              await upsertSubscription(pool, {
                userId,
                stripeCustomerId: customerId,
                stripeSubscription: stripeSub,
              });
            }
          }
          break;
        }

        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          const stripeSub = event.data.object;
          const customerId = stripeSub.customer;

          // Prefer metadata.userId that we set when creating the subscription
          let userId = Number(stripeSub?.metadata?.userId);

          // Fallback #1: Look up an existing row by customer id
          if (!userId) {
            const { rows } = await pool.query(
              `SELECT user_id FROM subscriptions WHERE stripe_customer_id = $1 LIMIT 1`,
              [customerId]
            );
            userId = rows?.[0]?.user_id ? Number(rows[0].user_id) : null;
          }

          // Fallback #2: Read Customer metadata (we set metadata.userId when creating the Customer)
          if (!userId && customerId) {
            try {
              const cust = await stripe.customers.retrieve(customerId);
              userId = Number(cust?.metadata?.userId) || null;
            } catch (e) {
              // ignore
            }
          }

          if (userId) {
            await upsertSubscription(pool, {
              userId,
              stripeCustomerId: customerId,
              stripeSubscription: stripeSub,
            });
          } else {
            console.warn(
              "Could not resolve userId for subscription event; customerId=",
              customerId,
              "subId=",
              stripeSub?.id
            );
          }
          break;
        }

        case "invoice.payment_failed": {
          // Disable features immediately on payment failure
          const invoice = event.data.object;
          const customerId = invoice.customer;

          await pool.query(
            `
            UPDATE subscriptions
              SET status='past_due', updated_at=NOW()
              WHERE stripe_customer_id=$1
          `,
            [customerId]
          );

          break;
        }
      }

      res.json({ received: true });
    } catch (e) {
      console.error("Webhook error:", e);
      res.status(500).send("Webhook handler failed");
    }
  };
}
